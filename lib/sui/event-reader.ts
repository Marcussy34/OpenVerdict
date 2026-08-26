import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { ResolutionEventVisibility } from "../engine/contract";
import type { Repository } from "../storage";

const OPENVERDICT_MODULES = [
  "agent_registry",
  "claim",
  "evidence",
  "jury",
  "settlement",
  "demo_binary_pool",
] as const;

const EVENT_KIND: Record<string, string> = {
  ClaimCreated: "claim_created",
  OutcomeProposed: "proposal_submitted",
  OutcomeChallenged: "challenge_submitted",
  CommitteeSelected: "committee_selected",
  EvidenceFrozen: "evidence_frozen",
  RunApproved: "run_approved",
  VoteCommitted: "vote_committed",
  VoteRevealed: "vote_revealed",
  ClaimFinalized: "claim_finalized",
  ClaimUnresolved: "claim_finalized",
  PayoutWithdrawn: "payout_withdrawn",
};

export interface SuiEventReaderOptions {
  client: SuiGrpcClient;
  packageId: string;
  repository: Repository;
  pollIntervalMs?: number;
}

/** Poll package Move events and append normalized, cursor-bearing records. */
export class SuiEventReader {
  readonly #client: SuiGrpcClient;
  readonly #packageId: string;
  readonly #repository: Repository;
  readonly #pollIntervalMs: number;

  constructor(options: SuiEventReaderOptions) {
    this.#client = options.client;
    this.#packageId = options.packageId;
    this.#repository = options.repository;
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
  }

  async pollOnce(): Promise<number> {
    let appended = 0;
    for (const moduleName of OPENVERDICT_MODULES) {
      const cursor = await this.#repository.latestSuiCursor(moduleName);
      const page = await this.#client.listEvents({
        filter: { emitModule: `${this.#packageId}::${moduleName}` },
        after: cursor ?? null,
        order: "ascending",
        limit: 50,
      });
      for (const event of page.events) {
        const name = event.eventType.split("::").at(-1)?.split("<", 1)[0] ?? "MoveEvent";
        const kind = EVENT_KIND[name];
        const claimId = optionalId(event.json?.claim_id);
        if (!kind || !claimId) continue;
        const payload = sanitizeMovePayload(event.json ?? {});
        payload.module = moduleName;
        payload.eventType = event.eventType;
        await this.#repository.appendResolutionEvent({
          eventId: `sui:${event.transactionDigest}:${event.eventIndex}`,
          claimId,
          phase: eventPhase(kind, event.json),
          kind,
          source: "SUI",
          visibility: eventVisibility(kind),
          occurredAt: new Date().toISOString(),
          transactionDigest: event.transactionDigest,
          ...(event.checkpoint === null
            ? {}
            : { checkpoint: Number(event.checkpoint) }),
          payload,
        });
        appended += 1;
      }
      if (page.endCursor !== null) {
        // Persist only after the full page is durable, so a crash cannot skip events.
        await this.#repository.saveSuiCursor(moduleName, page.endCursor);
      }
    }
    return appended;
  }

  async follow(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce();
      await wait(this.#pollIntervalMs, signal);
    }
  }
}

export function createSuiEventReader(options: SuiEventReaderOptions): SuiEventReader {
  return new SuiEventReader(options);
}

function eventVisibility(kind: string): ResolutionEventVisibility {
  if (kind === "vote_revealed" || kind === "claim_finalized") return "PUBLIC_NOW";
  return "PUBLIC_NOW";
}

function eventPhase(kind: string, json: Record<string, unknown> | null): string {
  const phase = json?.phase;
  if (phase === 1 || phase === "1") return "ROUND_1";
  if (phase === 2 || phase === "2") return "ROUND_2";
  return kind === "claim_created" ? "CREATE" : "CHAIN";
}

function sanitizeMovePayload(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "commitment"),
  );
}

function optionalId(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("0x")) return value;
  if (typeof value !== "object" || value === null) return undefined;
  for (const key of ["id", "bytes", "value"]) {
    const nested = optionalId((value as Record<string, unknown>)[key]);
    if (nested) return nested;
  }
  return undefined;
}

async function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

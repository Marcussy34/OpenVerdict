import { Client } from "pg";
import type { ClaimInspection } from "../lib/engine/contract";
import { wakeStamp } from "../lib/engine/wake";
import { CLAIM_STATE, type ClaimState } from "../lib/protocol";

/** States a hosted claim passes through between submission and its certificate. */
export const LIVE_CLAIM_STATES: readonly ClaimState[] = [
  CLAIM_STATE.REVIEW_REQUESTED,
  CLAIM_STATE.COMMIT_1,
  CLAIM_STATE.REVEAL_1,
  CLAIM_STATE.DISCUSSION,
  CLAIM_STATE.COMMIT_2,
  CLAIM_STATE.REVEAL_2,
];

export interface WorkerRuntimeOptions {
  name: string;
  /** Resolves true while a claim is in flight, which keeps the fast poll. */
  tick: () => Promise<void | boolean>;
  intervalMs?: number;
  idleIntervalMs?: number;
}

/**
 * Only claims in the given states, inspected one state at a time. The docket
 * is mostly finished claims; inspecting all of them every two seconds was a
 * few hundred queries per tick around the clock (Neon's egress alert).
 */
export async function listLiveClaims(
  engine: { listClaims(filter?: { state?: ClaimState }): Promise<ClaimInspection[]> },
  states: readonly ClaimState[],
): Promise<ClaimInspection[]> {
  const perState = await Promise.all(states.map((state) => engine.listClaims({ state })));
  return perState.flat();
}

// All workers share one Sui operator signer. Concurrent submissions equivocate
// its gas coin ("objects reserved for another transaction") and starve jury
// windows, so multi-process runs must be single-writer: with Postgres present,
// a session-scoped advisory lock serializes ticks across worker processes.
// The lock auto-releases if a worker dies; pglite runs are single-process
// already and skip it.
const TICK_LOCK_KEY = 1_869_640_753; // "ovt1"

class TickSerializer {
  private client: Client | null = null;

  constructor(private readonly url: string) {}

  private async connected(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ connectionString: this.url });
    await client.connect();
    // A dropped session releases its advisory locks server-side; just reconnect.
    client.on("error", () => {
      this.client = null;
    });
    this.client = client;
    return client;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.connected();
    // Transaction-level lock, not a session lock: behind a transaction-mode
    // pooler (Neon's pgbouncer) a session lock lands on whichever server
    // connection served that statement, the pooler then hands that
    // connection to other clients and routes the unlock elsewhere, and the
    // lock is stranded forever (every worker blocked, silent). An open
    // transaction pins one server connection for the whole tick, and the
    // lock ends with the COMMIT, or with the connection if the worker dies.
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [TICK_LOCK_KEY]);
      return await fn();
    } finally {
      try {
        await client.query("COMMIT");
      } catch {
        this.client = null;
      }
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }
}

/** Run a bounded polling tick until SIGINT/SIGTERM requests a clean stop. */
export async function runWorker(options: WorkerRuntimeOptions): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const intervalMs = options.intervalMs ?? numberEnv("OPENVERDICT_WORKER_POLL_MS", 2_000);
  // Between claims the database is polled slowly; a submitted claim touches
  // the wake file (lib/engine/wake.ts) and ends the slow wait at once.
  const idleIntervalMs =
    options.idleIntervalMs ?? numberEnv("OPENVERDICT_WORKER_IDLE_POLL_MS", 15_000);
  const dbUrl = process.env.DATABASE_URL?.trim();
  const serializer = dbUrl ? new TickSerializer(dbUrl) : null;

  try {
    while (!controller.signal.aborted) {
      let busy = true;
      const stampBefore = wakeStamp();
      try {
        busy = (await (serializer ? serializer.run(options.tick) : options.tick())) !== false;
      } catch (error) {
        // A phase deadline commonly makes a queue item temporarily ineligible.
        process.stderr.write(
          `${options.name}: ${errorCode(error)}: ${errorMessage(error)}\n`,
        );
      }
      if (busy) {
        await wait(intervalMs, controller.signal);
      } else {
        await waitForWake(idleIntervalMs, stampBefore, controller.signal);
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await serializer?.close();
  }
}

/** Process claims independently: one claim's failure (a Move abort on a
 * permanently stuck claim, a transient RPC error) must not starve the claims
 * after it in the list — head-of-line blocking here froze whole pipelines. */
export async function forEachClaim<T extends { claimId: string }>(
  name: string,
  claims: readonly T[],
  handle: (claim: T) => Promise<void>,
): Promise<void> {
  for (const claim of claims) {
    try {
      await handle(claim);
    } catch (error) {
      process.stderr.write(
        `${name}: claim ${claim.claimId.slice(0, 10)}…: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }
}

export function isWorkerEntrypoint(importMetaUrl: string): boolean {
  const path = process.argv[1];
  return path !== undefined && new URL(importMetaUrl).pathname === path;
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

/** Idle wait in one-second slices, cut short when the wake file changes. */
async function waitForWake(
  delayMs: number,
  stampBefore: number,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + delayMs;
  while (!signal.aborted && Date.now() < deadline) {
    await wait(Math.min(1_000, deadline - Date.now()), signal);
    if (wakeStamp() !== stampBefore) return;
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "WORKER_TICK_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

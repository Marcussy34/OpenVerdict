/**
 * Public claim auditor (docs/superpowers/specs/2026-09-03-audit-skill-design.md).
 *
 * Rebuilds the whole public record of one OpenVerdict claim from public
 * sources only (the app's API, Sui JSON-RPC, Walrus, GonkaRouter receipts)
 * and recomputes every hash a human cannot check by hand. No database, no
 * keys. Every network call goes through the injected fetch with a timeout;
 * a source that is down becomes UNAVAILABLE checks, never an exception.
 */
import { tableVotePromptSpecHash } from "../gonka/promptSpec";
import { buildEvidenceManifest } from "../evidence/manifest";
import type { ClaimInspection, FactCheckReport } from "../engine/contract";
import { computeVoteCommitment } from "../protocol/commitment";
import { CLAIM_RESULT, CLAIM_STATE, OUTCOME, type VoteOutcome } from "../protocol/constants";
import { fromHex, toHex } from "../protocol/hash";
import { agentProbabilityBps, computeTruthScoreBps } from "../protocol/truthScore";
import {
  deriveRunId,
  recomputeRunProof,
  type BrowserRunProof,
  type RunProofCheck,
} from "../verify/run-proof";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// The submission queue was removed: a claim is the only auditable target.
export type AuditTargetKind = "claim";

export type AuditTarget = {
  base: string;
  claimId: string;
  runId?: string;
  kind: AuditTargetKind;
};

export type AuditStatus = "PASS" | "FAIL" | "UNAVAILABLE" | "SKIPPED";

export type AuditGroup =
  | "votes"
  | "runs"
  | "receipts"
  | "walrus"
  | "chain"
  | "score"
  | "debate";

export type AuditCheck = {
  id: string;
  group: AuditGroup;
  label: string;
  status: AuditStatus;
  expected?: string;
  actual?: string;
  detail?: string;
  /** Where to look by hand when a source was unavailable. */
  url?: string;
};

export type AuditOptions = {
  fetch: typeof fetch;
  now?: () => number;
  rpcUrls?: string[];
  /** Per network call, default 20 s. */
  timeoutMs?: number;
  /** Pause before the one retry each RPC endpoint gets on a network failure. */
  rpcRetryDelayMs?: number;
  walrusAggregator?: string;
  receiptsBase?: string;
  /** Stop reading the event stream after this much silence, default 8 s. */
  eventsIdleMs?: number;
  /** Progress lines (the CLI prints them to stderr). */
  log?: (line: string) => void;
};

export type ClaimPhase = 1 | 2;

export type AuditClaimStatus =
  | "FINALIZED"
  | "IN_PROGRESS"
  | "VOIDED"
  | "GAVE_UP"
  | "CANCELLED";

export type VoteAudit = {
  phase: ClaimPhase;
  jurorIndex: number;
  jurySeatId: string;
  agentProfileId: string;
  modelId?: string;
  committed: boolean;
  revealed: boolean;
  failureStatus?: string;
  /** Commitment hex from the public record (auditBundle). */
  commitment?: string;
  onChainCommitment?: string;
  commitTx?: string;
  revealTx?: string;
  revealedVoteId?: string;
  /** The reveal transaction inputs, decoded. */
  reveal?: {
    outcome: number;
    confidenceBps: number;
    outputHash: string;
    runHash: string;
    salt: string;
    argumentBlobId?: string;
    resolvedBy: "move-call" | "positions";
  };
  /** Every preimage field, as hex strings, so a reader can redo C2. */
  preimage?: Record<string, string | number>;
  recomputedCommitment?: string;
  /** What the report (final round) or the inspection (any round) says. */
  reported?: { outcome: number; confidenceBps: number; valid?: boolean };
  onChainEvidenceRoot?: string;
  checks: AuditCheck[];
};

export type RunAudit = {
  runId: string;
  phase: ClaimPhase;
  jurorIndex: number;
  jurySeatId: string;
  agentProfileId: string;
  modelId?: string;
  role?: string;
  revealed: boolean;
  failure?: { status: string; message?: string };
  bundleVersion?: number;
  kind: "research" | "table-vote" | "legacy" | "none";
  hashes: {
    promptHash?: string;
    inputHash?: string;
    outputHash?: string;
    runHash?: string;
    toolTranscriptHash?: string;
    evidenceRoot?: string;
  };
  vote?: { outcome: string; confidenceBps: number };
  gateway?: { requestId?: string; devshardId?: string; model?: string; servedModel?: string };
  window?: { requestedAtMs: number; completedAtMs: number };
  receipt?: Record<string, unknown>;
  receiptUrl?: string;
  revealedBlobId?: string;
  sealedBlobId?: string;
  blobUrl?: string;
  citations: Array<{ url: string; quote: string }>;
  checks: AuditCheck[];
};

export type JurorRow = {
  jurorIndex: number;
  agentProfileId: string;
  modelId?: string;
  role?: string;
  owner?: string;
  seats: Partial<Record<ClaimPhase, string>>;
};

export type TimelineEntry = {
  atMs: number;
  at: string;
  event: string;
  detail: string;
  transactionDigest?: string;
};

export type DebateTurnRow = {
  ordinal: number;
  exchange: number;
  jurorIndex: number;
  jurySeatId: string;
  modelId?: string;
  stance?: string;
  confidenceBps?: number;
  status: string;
  argument: string;
  citations: number;
  /** V4 conversation fields; absent on turns that ran on spec V1 to V3. */
  specVersion?: string;
  answering?: number;
  question?: { seat: number; text: string };
};

export type ScoreTerm = {
  jurorIndex: number;
  jurySeatId: string;
  outcome: string;
  confidenceBps: number;
  probabilityBps: number;
  valid: boolean;
};

export type SourceFailure = { source: string; url: string; reason: string };

export type AuditSummaryCounts = {
  passed: number;
  failed: number;
  unavailable: number;
  skipped: number;
};

export type AuditResult = {
  version: 1;
  generatedAt: string;
  target: AuditTarget;
  status: AuditClaimStatus;
  claim: {
    claimId: string;
    link: string;
    statement: string;
    resolutionCriteria: string;
    mode: string;
    state: number;
    stateLabel: string;
    deadlines: Record<string, number>;
    twoRound: boolean;
    attempt?: {
      attempt: number;
      maxAttempts: number;
      status: string;
      verificationId: string;
      relaunchedAs?: string;
      relaunchLink?: string;
      gaveUpReason?: string;
      void?: Record<string, unknown>;
      previousAttempts: Array<{ claimId: string; attempt: number; status: string; voidReason?: string }>;
    };
    /** Plain-English description of what is pending, for non-final claims. */
    pending: string[];
  };
  verdict: {
    result: string | null;
    truthScoreBps: number | null;
    certificateId?: string;
    certificateTx?: string;
    finalPhase?: ClaimPhase;
    label: string;
    proves: string;
  };
  jury: JurorRow[];
  votes: VoteAudit[];
  runs: RunAudit[];
  claimChecks: AuditCheck[];
  timeline: TimelineEntry[];
  timelineSource: "events" | "record";
  debate?: {
    turns: DebateTurnRow[];
    convergedAfterExchange: number | null;
    phaseTwoRoot?: string;
    tableVotePromptHash: string;
  };
  score: {
    formula: string;
    terms: ScoreTerm[];
    sumBps: number;
    count: number;
    meanBps: number | null;
    reportBps: number | null;
    certificateBps: number | null;
  };
  certificate?: {
    objectId: string;
    fields: Record<string, unknown>;
    transactionDigest?: string;
    objectLink: string;
    transactionLink?: string;
  };
  urls: string[];
  sources: {
    inspection: ClaimInspection;
    report: FactCheckReport | null;
    agents: unknown[] | null;
    events: Array<Record<string, unknown>>;
    proofs: Record<string, unknown>;
    transactions: Record<string, unknown>;
    objects: Record<string, unknown>;
    receipts: Record<string, unknown>;
    manifests: Record<string, unknown>;
    walrus: Record<string, { status: number | null; reason?: string }>;
    failures: SourceFailure[];
  };
  summary: AuditSummaryCounts & { byGroup: Record<AuditGroup, AuditSummaryCounts> };
  exitCode: 0 | 1;
};

/** Thrown only when there is nothing to audit (bad input, claim not found, API down). */
export class AuditInputError extends Error {
  override readonly name = "AuditInputError";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_BASE = "https://app.openverdict.info";
export const DEFAULT_RPC_URLS = [
  "https://sui-testnet-rpc.publicnode.com",
  "https://fullnode.testnet.sui.io:443",
  // Testnet full nodes prune transactions after a few days; this archival
  // endpoint still served a 2026-09-02 commit when both above had dropped it.
  "https://sui-testnet-endpoint.blockvision.org",
];
export const DEFAULT_WALRUS_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";
export const DEFAULT_RECEIPTS_BASE = "https://api.gonkarouter.io/v1/receipts/";
const SUIVISION = "https://testnet.suivision.xyz";
// Transactions open on Suiscan, objects on SuiVision.
const SUISCAN = "https://suiscan.xyz/testnet";
// publicnode answers 403 to Node's default user agent.
const USER_AGENT = "Mozilla/5.0 (OpenVerdict audit)";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_EVENTS_IDLE_MS = 8_000;
// Never read a stream for longer than this, whatever arrives.
const EVENTS_MAX_MS = 90_000;
const RPC_CONCURRENCY = 4;
/** Public nodes drop a request now and then; one retry keeps a check from going UNAVAILABLE. */
const DEFAULT_RPC_RETRY_DELAY_MS = 300;
const WALRUS_CONCURRENCY = 2;
const RECEIPT_WINDOW_SLACK_MS = 60_000;
const QUORUM = 4;
const TRANSCRIPT_ARTIFACT = "urn:openverdict:deliberation-transcript";
const GROUPS: AuditGroup[] = ["votes", "runs", "receipts", "walrus", "chain", "score", "debate"];

/** Spec numbering of the recomputeRunProof checks (R1 to R15). */
const RUN_CHECK_NUMBERS: Record<RunProofCheck["key"], number> = {
  promptHash: 1,
  toolPolicyHash: 2,
  systemPrompt: 3,
  inputHash: 4,
  outputHash: 5,
  toolTranscriptHash: 6,
  citations: 7,
  challengeSearch: 8,
  bothSidesOpened: 9,
  citationSites: 10,
  counterEvidenceSummary: 11,
  opensPerTurn: 12,
  runHash: 13,
  sealEscrow: 14,
  sealedCore: 15,
};

const STATE_LABELS: Record<number, string> = {
  [CLAIM_STATE.CREATED]: "CREATED",
  [CLAIM_STATE.PROPOSED]: "PROPOSED",
  [CLAIM_STATE.CHALLENGED]: "CHALLENGED",
  [CLAIM_STATE.REVIEW_REQUESTED]: "REVIEW_REQUESTED",
  [CLAIM_STATE.COMMIT_1]: "COMMIT_1",
  [CLAIM_STATE.REVEAL_1]: "REVEAL_1",
  [CLAIM_STATE.DISCUSSION]: "DISCUSSION",
  [CLAIM_STATE.COMMIT_2]: "COMMIT_2",
  [CLAIM_STATE.REVEAL_2]: "REVEAL_2",
  [CLAIM_STATE.FINALIZED_UNCHALLENGED]: "FINALIZED_UNCHALLENGED",
  [CLAIM_STATE.FINALIZED_REVIEWED]: "FINALIZED_REVIEWED",
  [CLAIM_STATE.UNRESOLVED]: "UNRESOLVED",
  [CLAIM_STATE.CANCELLED]: "CANCELLED",
};

const OUTCOME_LABELS: Record<number, string> = {
  [OUTCOME.YES]: "YES",
  [OUTCOME.NO]: "NO",
  [OUTCOME.UNSURE]: "UNSURE",
};

const RESULT_CODES: Record<string, number> = {
  YES: CLAIM_RESULT.YES,
  NO: CLAIM_RESULT.NO,
  UNSURE: CLAIM_RESULT.UNSURE,
  UNRESOLVED: CLAIM_RESULT.UNRESOLVED,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function lowerHex(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.toLowerCase();
}

function sameHex(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

/** Tables show the first 10 characters; the JSON keeps full values. */
export function shortHex(value: string | undefined | null): string {
  if (!value) return "-";
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

/** UTC ISO without milliseconds. */
export function isoTime(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return "-";
  try {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return "-";
  }
}

function bpsToPercent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "-";
  return `${(bps / 100).toFixed(2)}`;
}

/**
 * Sui JSON-RPC renders a pure vector<u8> as a number array, or as a string
 * when the bytes happen to be valid UTF-8 (blob ids show up that way).
 */
function bytesFromRpcValue(value: unknown): Uint8Array | undefined {
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "number")) return undefined;
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
      try {
        return fromHex(value);
      } catch {
        return undefined;
      }
    }
    return new TextEncoder().encode(value);
  }
  return undefined;
}

function hexFromRpcValue(value: unknown): string | undefined {
  const bytes = bytesFromRpcValue(value);
  return bytes === undefined ? undefined : toHex(bytes);
}

/** Move Option<T> appears as a bare value, null, or {fields: {vec: [...]}}. */
function unwrapOption(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (isRecord(value)) {
    const fields = isRecord(value.fields) ? value.fields : value;
    if (Array.isArray(fields.vec)) return fields.vec[0];
    if ("Some" in fields) return fields.Some;
    if ("None" in fields) return undefined;
  }
  return value;
}

/** Tiny concurrency cap (no dependency): at most `size` tasks in flight. */
function createLimiter(size: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= size) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "timed out";
    const cause = (error as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? `: ${cause.message}` : "";
    return `${error.message}${causeText}`;
  }
  return String(error);
}

function check(
  id: string,
  group: AuditGroup,
  label: string,
  status: AuditStatus,
  rest: Partial<Pick<AuditCheck, "expected" | "actual" | "detail" | "url">> = {},
): AuditCheck {
  const entry: AuditCheck = { id, group, label, status };
  if (rest.expected !== undefined) entry.expected = rest.expected;
  if (rest.actual !== undefined) entry.actual = rest.actual;
  if (rest.detail !== undefined) entry.detail = rest.detail;
  if (rest.url !== undefined) entry.url = rest.url;
  return entry;
}

function outcomeLabel(code: number | undefined): string {
  return code === undefined ? "-" : (OUTCOME_LABELS[code] ?? `code ${code}`);
}

function outcomeCode(label: string | undefined): number | undefined {
  if (label === undefined) return undefined;
  const entry = Object.entries(OUTCOME_LABELS).find(([, value]) => value === label);
  return entry === undefined ? undefined : Number(entry[0]);
}

// Suiscan keeps the network in the path and calls the page /tx.
function suiscanTx(digest: string): string {
  return `${SUISCAN}/tx/${digest}`;
}

function suivisionObject(id: string): string {
  return `${SUIVISION}/object/${id}`;
}

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

// Submissions are no longer parked: the API either starts a jury or refuses.
const QUEUE_GONE =
  "queue links no longer exist: a submission either starts a jury at once or is refused";

/**
 * Accepts a claim link (/claims/<id>, /claims/<id>/report, /claims/<id>/runs/<runId>),
 * an /api/claims link, or a bare 0x id. A queue link is an input error.
 * `options.base` overrides the origin of a link (for another deployment).
 */
export function parseAuditTarget(
  input: string,
  options: { base?: string } = {},
): AuditTarget {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new AuditInputError("a claim link or id is required");
  const explicitBase = options.base ? normalizeBase(options.base) : undefined;

  if (HEX_ID.test(trimmed)) {
    return { base: explicitBase ?? DEFAULT_BASE, claimId: trimmed.toLowerCase(), kind: "claim" };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new AuditInputError(`not a claim link or id: ${trimmed}`);
  }
  const base = explicitBase ?? url.origin;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] === "api") segments.shift();

  if (segments[0] === "claims" && segments[1] !== undefined) {
    const claimId = segments[1];
    if (!HEX_ID.test(claimId)) throw new AuditInputError(`not a claim id: ${claimId}`);
    const target: AuditTarget = { base, claimId: claimId.toLowerCase(), kind: "claim" };
    if (segments[2] === "runs" && segments[3] !== undefined && HEX_ID.test(segments[3])) {
      target.runId = segments[3].toLowerCase();
    }
    return target;
  }
  if (segments[0] === "fact-check" && segments[1] === "queue") {
    throw new AuditInputError(QUEUE_GONE);
  }
  throw new AuditInputError(`not a claim link: ${trimmed}`);
}

function normalizeBase(base: string): string {
  const withScheme = base.includes("://") ? base : `https://${base}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new AuditInputError(`invalid base url: ${base}`);
  }
}

// ---------------------------------------------------------------------------
// Network layer: every call goes through the injected fetch with a timeout
// ---------------------------------------------------------------------------

type FetchOutcome =
  | { ok: true; status: number; body: unknown; text: string }
  | { ok: false; status: number | null; reason: string; body?: unknown };

type RpcOutcome =
  | { ok: true; result: unknown; url: string }
  | { ok: false; kind: "unavailable" | "not_found"; reason: string; url: string };

class Net {
  readonly urls = new Set<string>();
  readonly failures: SourceFailure[] = [];
  readonly rpcLimit = createLimiter(RPC_CONCURRENCY);
  readonly walrusLimit = createLimiter(WALRUS_CONCURRENCY);
  readonly receiptLimit = createLimiter(RPC_CONCURRENCY);
  readonly #rpcCache = new Map<string, Promise<RpcOutcome>>();
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #rpcRetryDelayMs: number;
  readonly #rpcUrls: string[];
  readonly #log: (line: string) => void;

  constructor(options: AuditOptions) {
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#rpcRetryDelayMs = options.rpcRetryDelayMs ?? DEFAULT_RPC_RETRY_DELAY_MS;
    this.#rpcUrls = options.rpcUrls ?? DEFAULT_RPC_URLS;
    this.#log = options.log ?? (() => {});
  }

  log(line: string): void {
    this.#log(line);
  }

  /** One HTTP call with a hard timeout; never throws. */
  async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; parse?: "json" | "text" | "none" } = {},
  ): Promise<FetchOutcome> {
    this.urls.add(init.method === "POST" ? `${url} (POST ${summarizeRpcBody(init.body)})` : url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: init.method ?? "GET",
        headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
        body: init.body,
        signal: controller.signal,
      });
      const text = init.parse === "none" ? "" : await response.text();
      let body: unknown = undefined;
      if (init.parse !== "none" && init.parse !== "text" && text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
      }
      if (!response.ok) {
        const message = isRecord(body) ? asString(body.message) ?? asString(body.error) : undefined;
        return {
          ok: false,
          status: response.status,
          reason: `HTTP ${response.status}${message ? ` (${message})` : ""}`,
          body,
        };
      }
      return { ok: true, status: response.status, body, text };
    } catch (error) {
      return { ok: false, status: null, reason: errorMessage(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  fail(source: string, url: string, reason: string): void {
    this.failures.push({ source, url, reason });
  }

  /** Sui JSON-RPC with endpoint rotation; results are cached per call. */
  rpc(method: string, params: unknown[]): Promise<RpcOutcome> {
    const key = JSON.stringify([method, params]);
    const cached = this.#rpcCache.get(key);
    if (cached) return cached;
    const pending = this.rpcLimit(() => this.#rpcUncached(method, params));
    this.#rpcCache.set(key, pending);
    return pending;
  }

  async #rpcUncached(method: string, params: unknown[]): Promise<RpcOutcome> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    let notFound: RpcOutcome | undefined;
    let lastReason = "no RPC endpoint configured";
    let lastUrl = this.#rpcUrls[0] ?? "";
    for (const url of this.#rpcUrls) {
      lastUrl = url;
      const init = { method: "POST", headers: { "content-type": "application/json" }, body };
      let outcome = await this.request(url, init);
      // A dropped connection (no HTTP status) or a rate limit (429) gets up
      // to two retries on the same endpoint, spaced out, before the next one
      // is tried: the fallback node may be worse, and a burst of parallel
      // checks trips the archival endpoint's limiter for a moment.
      for (let attempt = 1; attempt <= 2 && !outcome.ok && (outcome.status === null || outcome.status === 429); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, this.#rpcRetryDelayMs * attempt));
        outcome = await this.request(url, init);
      }
      if (!outcome.ok) {
        lastReason = outcome.reason;
        this.fail(`sui ${method}`, url, outcome.reason);
        continue;
      }
      const payload = isRecord(outcome.body) ? outcome.body : undefined;
      const error = payload && isRecord(payload.error) ? payload.error : undefined;
      if (error) {
        const message = asString(error.message) ?? "RPC error";
        // A deprecated method or a pruned node: try the next endpoint.
        if (/not found|could not find|does not exist/i.test(message) && !/method/i.test(message)) {
          notFound = { ok: false, kind: "not_found", reason: message, url };
          continue;
        }
        lastReason = message;
        this.fail(`sui ${method}`, url, message);
        continue;
      }
      const result = payload?.result;
      if (isRecord(result) && isRecord(result.error)) {
        const code = asString(result.error.code) ?? "error";
        notFound = { ok: false, kind: "not_found", reason: `object ${code}`, url };
        continue;
      }
      return { ok: true, result, url };
    }
    if (notFound) return notFound;
    return { ok: false, kind: "unavailable", reason: lastReason, url: lastUrl };
  }

  getTransactionBlock(digest: string): Promise<RpcOutcome> {
    return this.rpc("sui_getTransactionBlock", [digest, { showInput: true, showEvents: true }]);
  }

  getObject(objectId: string): Promise<RpcOutcome> {
    return this.rpc("sui_getObject", [objectId, { showContent: true, showPreviousTransaction: true }]);
  }

  /**
   * Read the SSE history and stop after claim_finalized, after `idleMs`
   * of silence, or after EVENTS_MAX_MS. The request is aborted afterwards.
   */
  async readEventStream(url: string, idleMs: number): Promise<{ events: Json[]; reason?: string }> {
    this.urls.add(url);
    const controller = new AbortController();
    const events: Json[] = [];
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "text/event-stream", "user-agent": USER_AGENT },
        signal: controller.signal,
      });
    } catch (error) {
      return { events, reason: errorMessage(error) };
    }
    if (!response.ok || !response.body) {
      controller.abort();
      return { events, reason: `HTTP ${response.status}` };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const startedAt = Date.now();
    let buffer = "";
    let finalized = false;
    let reason: string | undefined;
    const consume = (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.startsWith("data:")) {
          try {
            const parsed: unknown = JSON.parse(line.slice(5).trim());
            if (isRecord(parsed)) {
              events.push(parsed);
              if (parsed.kind === "claim_finalized") finalized = true;
            }
          } catch {
            // A partial or non-JSON data line is ignored.
          }
        }
        index = buffer.indexOf("\n");
      }
    };
    try {
      while (!finalized) {
        const remaining = EVENTS_MAX_MS - (Date.now() - startedAt);
        if (remaining <= 0) {
          reason = "stream cap reached";
          break;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const idle = new Promise<"idle">((resolve) => {
          timer = setTimeout(() => resolve("idle"), Math.min(idleMs, remaining));
        });
        const next = await Promise.race([reader.read(), idle]);
        if (timer) clearTimeout(timer);
        if (next === "idle") {
          reason = `no new line for ${Math.round(idleMs / 1000)} s`;
          break;
        }
        if (next.done) break;
        consume(decoder.decode(next.value, { stream: true }));
      }
      consume(decoder.decode());
    } catch (error) {
      reason = errorMessage(error);
    } finally {
      controller.abort();
      reader.cancel().catch(() => {});
    }
    return reason === undefined ? { events } : { events, reason };
  }
}

function summarizeRpcBody(body: string | undefined): string {
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      const first = asArray(parsed.params)[0];
      return `${asString(parsed.method) ?? ""} ${typeof first === "string" ? first : ""}`.trim();
    }
  } catch {
    // ignore
  }
  return "";
}

// ---------------------------------------------------------------------------
// Chain parsers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** The VoteCommitted event of a commit transaction, as hex. */
export function parseCommitEvent(
  transaction: unknown,
): { commitment: string; jurySeatId?: string; phase?: number; claimId?: string } | undefined {
  const events = isRecord(transaction) ? asArray(transaction.events) : [];
  for (const event of events) {
    if (!isRecord(event) || !/::jury::VoteCommitted$/.test(asString(event.type) ?? "")) continue;
    const json = isRecord(event.parsedJson) ? event.parsedJson : {};
    const commitment = hexFromRpcValue(json.commitment);
    if (commitment === undefined) continue;
    return {
      commitment,
      jurySeatId: lowerHex(asString(json.jury_seat_id)),
      phase: asNumber(json.phase),
      claimId: lowerHex(asString(json.claim_id)),
    };
  }
  return undefined;
}

export type RevealInputs = NonNullable<VoteAudit["reveal"]> & {
  event?: { outcome?: number; confidenceBps?: number; outputHash?: string; runHash?: string; revealedVoteId?: string };
};

/**
 * The reveal_vote inputs: outcome u8, confidence u16, output_hash, run_hash,
 * salt. Resolved through the MoveCall argument order (arguments 3 to 7 of
 * reveal_vote) and only then through the fixed input positions 3 to 7.
 */
export function parseRevealInputs(transaction: unknown): RevealInputs | undefined {
  if (!isRecord(transaction)) return undefined;
  const data = isRecord(transaction.transaction) ? transaction.transaction : undefined;
  const txData = data && isRecord(data.data) ? data.data : undefined;
  const inner = txData && isRecord(txData.transaction) ? txData.transaction : undefined;
  const inputs = inner ? asArray(inner.inputs) : [];
  const calls = inner ? asArray(inner.transactions) : [];

  const inputAt = (index: number | undefined) =>
    index === undefined ? undefined : (isRecord(inputs[index]) ? (inputs[index] as Json) : undefined);
  const pureAt = (index: number | undefined, valueType: string) => {
    const input = inputAt(index);
    if (!input || input.type !== "pure" || input.valueType !== valueType) return undefined;
    return input.value;
  };
  const decode = (order: number[], resolvedBy: RevealInputs["resolvedBy"]): RevealInputs | undefined => {
    const outcome = asNumber(pureAt(order[0], "u8"));
    const confidenceBps = asNumber(pureAt(order[1], "u16"));
    const outputHash = hexFromRpcValue(pureAt(order[2], "vector<u8>"));
    const runHash = hexFromRpcValue(pureAt(order[3], "vector<u8>"));
    const saltBytes = bytesFromRpcValue(pureAt(order[4], "vector<u8>"));
    if (
      outcome === undefined ||
      confidenceBps === undefined ||
      outputHash === undefined ||
      runHash === undefined ||
      saltBytes === undefined
    ) {
      return undefined;
    }
    const blob = pureAt(order[5], "vector<u8>");
    const blobBytes = bytesFromRpcValue(blob);
    const argumentBlobId =
      typeof blob === "string" ? blob : blobBytes ? new TextDecoder().decode(blobBytes) : undefined;
    return {
      outcome,
      confidenceBps,
      outputHash,
      runHash,
      salt: toHex(saltBytes),
      ...(argumentBlobId === undefined ? {} : { argumentBlobId }),
      resolvedBy,
    };
  };

  let parsed: RevealInputs | undefined;
  for (const call of calls) {
    const moveCall = isRecord(call) && isRecord(call.MoveCall) ? call.MoveCall : undefined;
    if (!moveCall || moveCall.function !== "reveal_vote") continue;
    const order = asArray(moveCall.arguments).map((argument) =>
      isRecord(argument) ? asNumber(argument.Input) : undefined,
    );
    const slice = order.slice(3, 9);
    if (slice.every((index): index is number => index !== undefined)) {
      parsed = decode(slice, "move-call");
    }
    break;
  }
  parsed ??= decode([3, 4, 5, 6, 7, 8], "positions");
  if (!parsed) return undefined;

  for (const event of asArray(transaction.events)) {
    if (!isRecord(event) || !/::jury::VoteRevealed$/.test(asString(event.type) ?? "")) continue;
    const json = isRecord(event.parsedJson) ? event.parsedJson : {};
    parsed.event = {
      outcome: asNumber(json.outcome),
      confidenceBps: asNumber(json.confidence_bps),
      outputHash: hexFromRpcValue(json.output_hash),
      runHash: hexFromRpcValue(json.run_hash),
      revealedVoteId: lowerHex(asString(json.revealed_vote_id)),
    };
    break;
  }
  return parsed;
}

/** Move object fields from a sui_getObject result, read defensively. */
export function parseObjectFields(
  object: unknown,
): { type?: string; fields: Json; previousTransaction?: string } | undefined {
  if (!isRecord(object)) return undefined;
  const data = isRecord(object.data) ? object.data : object;
  const content = isRecord(data.content) ? data.content : undefined;
  const fields = content && isRecord(content.fields) ? content.fields : undefined;
  if (!fields) return undefined;
  return {
    type: asString(content?.type),
    fields,
    previousTransaction: asString(data.previousTransaction),
  };
}

/** ResolutionCertificate fields normalized for the S2 comparison. */
export function parseCertificateFields(fields: Json): {
  claimId?: string;
  result?: number;
  truthScoreBps?: number;
  committeeId?: string;
  revealedVoteIds: string[];
  evidenceBundleIds: string[];
  finalizedAtMs?: number;
  packageVersion?: number;
} {
  const result = asNumber(unwrapOption(fields.result));
  const score = unwrapOption(fields.truth_score_bps);
  return {
    claimId: lowerHex(asString(fields.claim_id)),
    result,
    truthScoreBps: asNumber(score),
    committeeId: lowerHex(asString(unwrapOption(fields.committee_id))),
    revealedVoteIds: asArray(fields.revealed_vote_ids).map((id) => String(id).toLowerCase()),
    evidenceBundleIds: asArray(fields.evidence_bundle_ids).map((id) => String(id).toLowerCase()),
    finalizedAtMs: asNumber(fields.finalized_at_ms),
    packageVersion: asNumber(fields.package_version),
  };
}

/** The frozen manifest JSON on Walrus: recompute its Merkle root. */
export function recomputeManifestRoot(manifest: unknown): {
  root?: string;
  sourceUrls: string[];
  evidenceIds: string[];
  error?: string;
} {
  const items = isRecord(manifest) ? asArray(manifest.items).filter(isRecord) : [];
  const sourceUrls = items.map((item) => asString(item.sourceUrl) ?? "");
  const evidenceIds = items.map((item) => asString(item.evidenceId) ?? "");
  try {
    if (items.length === 0) throw new Error("the manifest has no items");
    const { root } = buildEvidenceManifest(
      items.map((item) => ({
        evidenceId: asString(item.evidenceId) ?? "",
        contentHash: fromHex(asString(item.contentHash) ?? ""),
        canonicalHash: fromHex(asString(item.canonicalHash) ?? ""),
      })),
    );
    return { root: toHex(root), sourceUrls, evidenceIds };
  } catch (error) {
    return { sourceUrls, evidenceIds, error: errorMessage(error) };
  }
}

type Receipt = {
  x_request_id?: string;
  x_devshard_id?: string;
  model?: string;
  created_at?: string;
  outcome?: string;
  status_code?: number;
};

/** R17: the provider receipt against what the sealed bundle recorded. */
export function compareReceipt(
  receipt: Receipt,
  expected: { requestId: string; model?: string; devshardId?: string; requestedAtMs?: number; completedAtMs?: number },
): { ok: boolean; issues: string[]; summary: string } {
  const issues: string[] = [];
  if (receipt.x_request_id !== undefined && receipt.x_request_id !== expected.requestId) {
    issues.push(`request id ${receipt.x_request_id} differs from ${expected.requestId}`);
  }
  if (expected.model !== undefined && receipt.model !== expected.model) {
    issues.push(`model ${receipt.model ?? "missing"} differs from ${expected.model}`);
  }
  if (expected.devshardId !== undefined && String(receipt.x_devshard_id ?? "") !== String(expected.devshardId)) {
    issues.push(`devshard ${receipt.x_devshard_id ?? "missing"} differs from ${expected.devshardId}`);
  }
  const createdAt = receipt.created_at ? Date.parse(receipt.created_at) : Number.NaN;
  if (Number.isNaN(createdAt)) {
    issues.push("created_at is missing or unreadable");
  } else if (expected.requestedAtMs !== undefined && expected.completedAtMs !== undefined) {
    // created_at carries whole seconds, so the window start is floored to the second.
    const windowStart = Math.floor(expected.requestedAtMs / 1000) * 1000;
    const windowEnd = expected.completedAtMs + RECEIPT_WINDOW_SLACK_MS;
    if (createdAt < windowStart || createdAt > windowEnd) {
      issues.push(`created_at ${isoTime(createdAt)} is outside ${isoTime(windowStart)} .. ${isoTime(windowEnd)}`);
    }
  }
  if (receipt.outcome !== undefined && receipt.outcome !== "success") {
    issues.push(`outcome ${receipt.outcome} (${receipt.status_code ?? "?"})`);
  }
  const summary = `model ${receipt.model ?? "?"}, devshard ${receipt.x_devshard_id ?? "?"}, created ${receipt.created_at ?? "?"}`;
  return { ok: issues.length === 0, issues, summary };
}

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

type Seat = {
  phase: ClaimPhase;
  jurySeatId: string;
  agentProfileId: string;
  jurorIndex: number;
  modelId?: string;
  role?: string;
  committed: boolean;
  revealed: boolean;
  outcome?: number;
  confidenceBps?: number;
  failureStatus?: string;
  runId: string;
  commitment?: string;
  commitTx?: string;
  revealTx?: string;
  revealedVoteId?: string;
  /** Disagreements between the events feed, the report and the proof. */
  notes: { commit?: string; reveal?: string };
  proof?: Json;
  proofReason?: string;
  /** The API answered 404: there is no run for this seat. */
  proofMissing?: boolean;
  commitTxData?: RpcOutcome;
  revealTxData?: RpcOutcome;
  revealInputs?: RevealInputs;
  revealedVote?: RpcOutcome;
};

type Bundle = {
  version?: number;
  audit: Json;
  gateway: Json;
  input: Json;
  validatedOutput: Json;
  promptHash?: string;
  runHash?: string;
  evidenceRoot?: string;
};

type World = {
  target: AuditTarget;
  base: string;
  claimId: string;
  inspection: ClaimInspection;
  report: FactCheckReport | null;
  bundle: Json;
  agents: Json[];
  events: Json[];
  eventsReason?: string;
  seats: Seat[];
  jurors: JurorRow[];
  rootsByPhase: Map<ClaimPhase, string>;
  manifestsByPhase: Map<ClaimPhase, { blobId?: string; body?: unknown; reason?: string; url?: string }>;
  certificate?: RpcOutcome;
  certificateId?: string;
  receipts: Map<string, FetchOutcome>;
  walrus: Map<string, FetchOutcome>;
  net: Net;
  now: number;
};

function auditBundleOf(report: FactCheckReport | null): Json {
  return report && isRecord(report.auditBundle) ? report.auditBundle : {};
}

function proofBundle(proof: Json | undefined): Bundle | undefined {
  if (!proof || !isRecord(proof.bundle)) return undefined;
  const bundle = proof.bundle;
  const audit = isRecord(bundle.audit) ? bundle.audit : {};
  const input = isRecord(bundle.input) ? bundle.input : {};
  const manifest = isRecord(input.evidenceManifest) ? input.evidenceManifest : {};
  return {
    version: asNumber(bundle.version),
    audit,
    gateway: isRecord(bundle.gateway) ? bundle.gateway : isRecord(proof.gateway) ? proof.gateway : {},
    input,
    validatedOutput: isRecord(bundle.validatedOutput) ? bundle.validatedOutput : {},
    promptHash: lowerHex(asString(bundle.promptHash)),
    runHash: lowerHex(asString(bundle.runHash)),
    evidenceRoot: lowerHex(asString(audit.evidenceRoot) ?? asString(manifest.root)),
  };
}

function claimLink(base: string, claimId: string): string {
  return `${base}/claims/${claimId}`;
}

/** Seats per phase from the inspection; phase-two seats map to the same juror. */
function buildSeats(world: Pick<World, "claimId" | "inspection" | "report" | "bundle" | "agents" | "events">): {
  seats: Seat[];
  jurors: JurorRow[];
} {
  const { inspection } = world;
  const statusBySeat = new Map(
    inspection.commitments.map((entry) => [entry.jurySeatId.toLowerCase(), entry]),
  );
  const rounds = (inspection.rounds ?? []).filter((round) => round.phase === 1 || round.phase === 2);
  const phaseSeatIds = new Map<ClaimPhase, string[]>();
  for (const round of rounds) {
    phaseSeatIds.set(round.phase, round.expectedJurySeatIds.map((id) => id.toLowerCase()));
  }
  if (!phaseSeatIds.has(1)) {
    const committee = isRecord(world.bundle.committee) ? world.bundle.committee : {};
    const fromCommittee = asArray(committee.jurySeatIds).map((id) => String(id).toLowerCase());
    const fromInspection = inspection.commitments.map((entry) => entry.jurySeatId.toLowerCase());
    phaseSeatIds.set(1, fromCommittee.length > 0 ? fromCommittee : fromInspection);
  }
  // Seats the inspection lists beyond the rounds (defensive) join their phase by order.
  const listed = new Set([...phaseSeatIds.values()].flat());
  const extra = inspection.commitments
    .map((entry) => entry.jurySeatId.toLowerCase())
    .filter((id) => !listed.has(id));
  if (extra.length > 0) {
    const first = phaseSeatIds.get(1) ?? [];
    const spill = first.length === 0 ? 1 : 2;
    phaseSeatIds.set(spill, [...(phaseSeatIds.get(spill) ?? []), ...extra]);
  }

  const agentsById = new Map(
    world.agents.map((agent) => [String(agent.agentProfileId ?? "").toLowerCase(), agent]),
  );
  const cardsById = new Map(
    (world.report?.agents ?? []).map((card) => [card.agentProfileId.toLowerCase(), card]),
  );
  const jurors: JurorRow[] = [];
  const jurorByAgent = new Map<string, JurorRow>();
  const seats: Seat[] = [];
  for (const phase of [1, 2] as const) {
    for (const jurySeatId of phaseSeatIds.get(phase) ?? []) {
      const status = statusBySeat.get(jurySeatId);
      const agentProfileId = (status?.agentProfileId ?? "").toLowerCase();
      const directory = agentsById.get(agentProfileId);
      const card = cardsById.get(agentProfileId);
      let juror = jurorByAgent.get(agentProfileId);
      if (!juror) {
        juror = {
          jurorIndex: jurors.length + 1,
          agentProfileId,
          seats: {},
          ...(status?.modelId ?? asString(directory?.modelId) ?? card?.modelId
            ? { modelId: status?.modelId ?? asString(directory?.modelId) ?? card?.modelId }
            : {}),
          ...(card?.role ?? asString(directory?.role) ? { role: card?.role ?? asString(directory?.role) } : {}),
          ...(card?.owner ?? asString(directory?.owner) ? { owner: card?.owner ?? asString(directory?.owner) } : {}),
        };
        jurors.push(juror);
        jurorByAgent.set(agentProfileId, juror);
      }
      juror.seats[phase] = jurySeatId;
      seats.push({
        phase,
        jurySeatId,
        agentProfileId,
        jurorIndex: juror.jurorIndex,
        ...(juror.modelId ? { modelId: juror.modelId } : {}),
        ...(juror.role ? { role: juror.role } : {}),
        committed: status?.committed ?? false,
        revealed: status?.revealed ?? false,
        ...(status?.outcome !== undefined ? { outcome: status.outcome } : {}),
        ...(status?.confidenceBps !== undefined ? { confidenceBps: status.confidenceBps } : {}),
        ...(status?.failureStatus ? { failureStatus: status.failureStatus } : {}),
        notes: {},
        runId: deriveRunId(world.claimId, jurySeatId, phase),
      });
    }
  }
  return { seats, jurors };
}

/**
 * Commit and reveal digests per seat and phase: the events feed first (it
 * covers every phase), the report's audit bundle and the proof as
 * cross-checks. A disagreement is noted on the seat and surfaced in C1/C2.
 */
function resolveDigests(world: World): void {
  const { bundle, events } = world;
  const commitByKey = new Map<string, Json>();
  for (const entry of asArray(bundle.commitments).filter(isRecord)) {
    const key = `${asNumber(entry.phase) ?? 1}:${String(entry.jurySeatId ?? "").toLowerCase()}`;
    commitByKey.set(key, entry);
  }
  const revealByRun = new Map<string, Json>();
  for (const entry of asArray(bundle.reveals).filter(isRecord)) {
    revealByRun.set(String(entry.runId ?? "").toLowerCase(), entry);
  }
  const eventBy = (kind: string, phase: number, seat: string): Json | undefined =>
    events.find((event) => {
      const payload = isRecord(event.payload) ? event.payload : {};
      return (
        event.kind === kind &&
        (asNumber(payload.phase) ?? 1) === phase &&
        String(payload.jury_seat_id ?? "").toLowerCase() === seat
      );
    });
  for (const seat of world.seats) {
    const recorded = commitByKey.get(`${seat.phase}:${seat.jurySeatId}`);
    const commitEvent = eventBy("vote_committed", seat.phase, seat.jurySeatId);
    const revealEvent = eventBy("vote_revealed", seat.phase, seat.jurySeatId);
    const reveal = revealByRun.get(seat.runId);
    const proofSui = seat.proof && isRecord(seat.proof.sui) ? seat.proof.sui : {};
    const proofCommit = isRecord(proofSui.commitment) ? proofSui.commitment : {};
    const proofReveal = isRecord(proofSui.reveal) ? proofSui.reveal : {};
    const commitment = lowerHex(asString(recorded?.commitment));
    if (commitment) seat.commitment = commitment;
    const commitTx = pickDigest([
      ["events", asString(commitEvent?.transactionDigest) ?? asString(isRecord(commitEvent?.payload) ? commitEvent.payload.transaction_digest : undefined)],
      ["report", asString(recorded?.transactionDigest)],
      ["proof", asString(proofCommit.transactionDigest)],
    ]);
    if (commitTx.digest) seat.commitTx = commitTx.digest;
    if (commitTx.note) seat.notes.commit = `commit transaction differs between sources: ${commitTx.note}`;
    const revealTx = pickDigest([
      ["events", asString(revealEvent?.transactionDigest) ?? asString(isRecord(revealEvent?.payload) ? revealEvent.payload.transaction_digest : undefined)],
      ["report", asString(reveal?.transactionDigest)],
      ["proof", asString(proofReveal.transactionDigest)],
    ]);
    if (revealTx.digest) seat.revealTx = revealTx.digest;
    if (revealTx.note) seat.notes.reveal = `reveal transaction differs between sources: ${revealTx.note}`;
    const revealedVoteId =
      asString(reveal?.revealedVoteId) ??
      asString(isRecord(revealEvent?.payload) ? revealEvent.payload.revealed_vote_id : undefined) ??
      asString(proofReveal.objectId);
    if (revealedVoteId) seat.revealedVoteId = revealedVoteId.toLowerCase();
    if (commitTx.digest && !seat.committed) seat.committed = true;
    if (revealTx.digest && !seat.revealed) seat.revealed = true;
  }
}

/** First source wins; a note lists every source when they do not agree. */
function pickDigest(candidates: Array<[string, string | undefined]>): { digest?: string; note?: string } {
  const present = candidates.filter((entry): entry is [string, string] => entry[1] !== undefined);
  const digest = present[0]?.[1];
  if (new Set(present.map(([, value]) => value)).size > 1) {
    return { digest, note: present.map(([source, value]) => `${source} ${value}`).join(", ") };
  }
  return digest === undefined ? {} : { digest };
}

/** Evidence root per phase from the record, the events, or the bundles. */
function resolveRoots(world: World): void {
  for (const entry of world.inspection.evidenceRoots) {
    if (entry.root) world.rootsByPhase.set(entry.phase, entry.root.toLowerCase());
  }
  for (const entry of asArray(world.bundle.evidence).filter(isRecord)) {
    const phase = asNumber(entry.phase);
    const root = lowerHex(asString(entry.root));
    if ((phase === 1 || phase === 2) && root && !world.rootsByPhase.has(phase)) {
      world.rootsByPhase.set(phase, root);
    }
  }
  for (const event of world.events) {
    if (event.kind !== "evidence_frozen") continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const phase = asNumber(payload.phase);
    const root = lowerHex(asString(payload.root) ?? asString(event.artifactHash));
    if ((phase === 1 || phase === 2) && root && !world.rootsByPhase.has(phase)) {
      world.rootsByPhase.set(phase, root);
    }
  }
  for (const seat of world.seats) {
    const bundle = proofBundle(seat.proof);
    if (bundle?.evidenceRoot && !world.rootsByPhase.has(seat.phase)) {
      world.rootsByPhase.set(seat.phase, bundle.evidenceRoot);
    }
  }
}

// ---------------------------------------------------------------------------
// Source gathering
// ---------------------------------------------------------------------------

function isNotFound(outcome: FetchOutcome): boolean {
  if (outcome.ok) return false;
  if (outcome.status === 404) return true;
  const message = isRecord(outcome.body) ? asString(outcome.body.message) ?? "" : "";
  return /not found/i.test(message) || /not found/i.test(outcome.reason);
}

async function gatherSources(
  target: AuditTarget,
  options: AuditOptions,
  net: Net,
): Promise<World> {
  const base = target.base;
  const claimId = target.claimId;
  const api = `${base}/api/claims/${claimId}`;
  const idleMs = options.eventsIdleMs ?? DEFAULT_EVENTS_IDLE_MS;

  net.log(`fetching claim ${claimId} from ${base}`);
  const inspectionOutcome = await net.request(api);
  if (!inspectionOutcome.ok) {
    if (isNotFound(inspectionOutcome)) {
      throw new AuditInputError(`claim not found: ${claimId} (${api})`);
    }
    throw new AuditInputError(`could not fetch ${api}: ${inspectionOutcome.reason}`);
  }
  if (!isRecord(inspectionOutcome.body) || typeof inspectionOutcome.body.claimId !== "string") {
    throw new AuditInputError(`unexpected response from ${api}`);
  }
  const inspection = inspectionOutcome.body as unknown as ClaimInspection;

  net.log("fetching report, agents and event history");
  const [reportOutcome, agentsOutcome, stream] = await Promise.all([
    net.request(`${api}/report`),
    net.request(`${base}/api/agents`),
    net.readEventStream(`${api}/events`, idleMs),
  ]);
  let report: FactCheckReport | null = null;
  if (reportOutcome.ok && isRecord(reportOutcome.body)) {
    report = reportOutcome.body as unknown as FactCheckReport;
  } else if (!reportOutcome.ok) {
    net.fail("report", `${api}/report`, reportOutcome.reason);
  }
  const agents =
    agentsOutcome.ok && isRecord(agentsOutcome.body) ? asArray(agentsOutcome.body.agents).filter(isRecord) : [];
  if (!agentsOutcome.ok) net.fail("agents", `${base}/api/agents`, agentsOutcome.reason);
  if (stream.reason && stream.events.length === 0) net.fail("events", `${api}/events`, stream.reason);

  const partial = { claimId, inspection, report, bundle: auditBundleOf(report), agents, events: stream.events };
  const { seats, jurors } = buildSeats(partial);
  const world: World = {
    target,
    base,
    claimId,
    inspection,
    report,
    bundle: partial.bundle,
    agents,
    events: stream.events,
    ...(stream.reason ? { eventsReason: stream.reason } : {}),
    seats,
    jurors,
    rootsByPhase: new Map(),
    manifestsByPhase: new Map(),
    receipts: new Map(),
    walrus: new Map(),
    net,
    now: (options.now ?? Date.now)(),
  };

  net.log(`fetching ${seats.length} run proofs`);
  await Promise.all(
    seats.map((seat) =>
      net.receiptLimit(async () => {
        const url = `${api}/runs/${seat.runId}/proof`;
        const outcome = await net.request(url);
        if (outcome.ok && isRecord(outcome.body) && typeof outcome.body.runId === "string") {
          seat.proof = outcome.body;
        } else {
          seat.proofReason = outcome.ok ? "unexpected proof payload" : outcome.reason;
          if (!outcome.ok && outcome.status === 404) seat.proofMissing = true;
          else net.fail("run proof", url, seat.proofReason);
        }
      }),
    ),
  );
  resolveDigests(world);
  resolveRoots(world);

  net.log("fetching commit and reveal transactions and the certificate from Sui");
  const certificateId =
    lowerHex(inspection.result?.certificateId) ??
    lowerHex(report?.sui.certificateId) ??
    lowerHex(asString(isRecord(world.bundle.certificate) ? world.bundle.certificate.certificateId : undefined));
  if (certificateId) world.certificateId = certificateId;
  await Promise.all([
    ...seats.flatMap((seat) => [
      seat.commitTx
        ? net.getTransactionBlock(seat.commitTx).then((outcome) => {
            seat.commitTxData = outcome;
          })
        : Promise.resolve(),
      seat.revealTx
        ? net.getTransactionBlock(seat.revealTx).then((outcome) => {
            seat.revealTxData = outcome;
            if (outcome.ok) {
              const inputs = parseRevealInputs(outcome.result);
              if (inputs) seat.revealInputs = inputs;
              const eventVoteId = inputs?.event?.revealedVoteId;
              if (eventVoteId && !seat.revealedVoteId) seat.revealedVoteId = eventVoteId;
            }
          })
        : Promise.resolve(),
    ]),
    certificateId
      ? net.getObject(certificateId).then((outcome) => {
          world.certificate = outcome;
        })
      : Promise.resolve(),
  ]);
  // The RevealedVote object carries the seat's bound evidence root on chain.
  await Promise.all(
    seats.map((seat) =>
      seat.revealedVoteId
        ? net.getObject(seat.revealedVoteId).then((outcome) => {
            seat.revealedVote = outcome;
          })
        : Promise.resolve(),
    ),
  );

  net.log("fetching provider receipts and Walrus blobs");
  const receiptsBase = options.receiptsBase ?? DEFAULT_RECEIPTS_BASE;
  const aggregator = (options.walrusAggregator ?? DEFAULT_WALRUS_AGGREGATOR).replace(/\/$/, "");
  const manifestBlobs = new Map<ClaimPhase, string>();
  for (const entry of asArray(world.bundle.evidence).filter(isRecord)) {
    const phase = asNumber(entry.phase);
    const blobId = asString(entry.manifestBlobId);
    if ((phase === 1 || phase === 2) && blobId) manifestBlobs.set(phase, blobId);
  }
  for (const event of world.events) {
    if (event.kind !== "evidence_frozen") continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const phase = asNumber(payload.phase);
    const blobId = asString(payload.manifest_blob_id);
    if ((phase === 1 || phase === 2) && blobId && !manifestBlobs.has(phase)) manifestBlobs.set(phase, blobId);
  }
  const blobUrl = (blobId: string) => `${aggregator}/v1/blobs/${blobId}`;
  await Promise.all([
    ...seats.map((seat) => {
      const bundle = proofBundle(seat.proof);
      const requestId = bundle ? asString(bundle.gateway.gatewayRequestId) ?? asString(bundle.audit.gatewayRequestId) : undefined;
      if (!requestId) return Promise.resolve();
      return net.receiptLimit(async () => {
        const url = `${receiptsBase}${encodeURIComponent(requestId)}`;
        const outcome = await net.request(url);
        world.receipts.set(requestId, outcome);
        if (!outcome.ok) net.fail("gonka receipt", url, outcome.reason);
      });
    }),
    ...[...manifestBlobs.entries()].map(([phase, blobId]) =>
      net.walrusLimit(async () => {
        const url = blobUrl(blobId);
        const outcome = await net.request(url);
        world.manifestsByPhase.set(phase, {
          blobId,
          url,
          ...(outcome.ok ? { body: outcome.body } : { reason: outcome.reason }),
        });
        if (!outcome.ok) net.fail("walrus manifest", url, outcome.reason);
      }),
    ),
    ...seats.map((seat) => {
      const blobId = seat.proof ? asString(seat.proof.revealedBlobId) ?? asString(seat.proof.sealedBlobId) : undefined;
      if (!blobId) return Promise.resolve();
      return net.walrusLimit(async () => {
        const url = blobUrl(blobId);
        const outcome = await net.request(url, { method: "HEAD", parse: "none" });
        world.walrus.set(blobId, outcome);
        if (!outcome.ok) net.fail("walrus blob", url, outcome.reason);
      });
    }),
  ]);
  return world;
}

// ---------------------------------------------------------------------------
// C1 to C3: votes and commitments
// ---------------------------------------------------------------------------

function rpcFailure(
  id: string,
  group: AuditGroup,
  label: string,
  outcome: RpcOutcome & { ok: false },
  url: string,
  what: string,
): AuditCheck {
  if (outcome.kind === "not_found") {
    return check(id, group, label, "FAIL", { detail: `${what} was not found on Sui (${outcome.reason})`, url });
  }
  return check(id, group, label, "UNAVAILABLE", { detail: `Sui RPC unavailable: ${outcome.reason}`, url });
}

function reportedVote(world: World, seat: Seat): VoteAudit["reported"] | undefined {
  const finalPhase = finalPhaseOf(world);
  const fromReport = world.report?.finalRoundVotes.find(
    (vote) => vote.jurySeatId.toLowerCase() === seat.jurySeatId,
  );
  if (fromReport && finalPhase === seat.phase) {
    const outcome = outcomeCode(fromReport.outcome);
    if (outcome !== undefined) {
      return { outcome, confidenceBps: fromReport.confidenceBps, valid: fromReport.valid };
    }
  }
  if (seat.outcome !== undefined && seat.confidenceBps !== undefined) {
    return { outcome: seat.outcome, confidenceBps: seat.confidenceBps };
  }
  const event = world.events.find((entry) => {
    const payload = isRecord(entry.payload) ? entry.payload : {};
    return (
      entry.kind === "vote_revealed" &&
      (asNumber(payload.phase) ?? 1) === seat.phase &&
      String(payload.jury_seat_id ?? "").toLowerCase() === seat.jurySeatId
    );
  });
  const payload = event && isRecord(event.payload) ? event.payload : undefined;
  const outcome = outcomeCode(asString(payload?.outcome));
  const confidenceBps = asNumber(payload?.confidence_bps);
  if (outcome !== undefined && confidenceBps !== undefined) {
    return { outcome, confidenceBps, ...(typeof payload?.valid === "boolean" ? { valid: payload.valid } : {}) };
  }
  return undefined;
}

function finalPhaseOf(world: World): ClaimPhase {
  const certificate = isRecord(world.bundle.certificate) ? world.bundle.certificate : undefined;
  const fromCertificate = asNumber(certificate?.finalPhase);
  if (fromCertificate === 1 || fromCertificate === 2) return fromCertificate;
  return world.seats.some((seat) => seat.phase === 2) ? 2 : 1;
}

function auditVotes(world: World): VoteAudit[] {
  return world.seats.map((seat) => auditVote(world, seat));
}

function auditVote(world: World, seat: Seat): VoteAudit {
  const vote: VoteAudit = {
    phase: seat.phase,
    jurorIndex: seat.jurorIndex,
    jurySeatId: seat.jurySeatId,
    agentProfileId: seat.agentProfileId,
    ...(seat.modelId ? { modelId: seat.modelId } : {}),
    committed: seat.committed,
    revealed: seat.revealed,
    ...(seat.failureStatus ? { failureStatus: seat.failureStatus } : {}),
    ...(seat.commitment ? { commitment: seat.commitment } : {}),
    ...(seat.commitTx ? { commitTx: seat.commitTx } : {}),
    ...(seat.revealTx ? { revealTx: seat.revealTx } : {}),
    ...(seat.revealedVoteId ? { revealedVoteId: seat.revealedVoteId } : {}),
    checks: [],
  };
  const labels = {
    C1: "Commitment on chain equals the record",
    C2: "Commitment recomputes from the reveal",
    C3: "Reveal matches the report",
  };
  const reported = reportedVote(world, seat);
  if (reported) vote.reported = reported;
  const revealedVote = seat.revealedVote?.ok ? parseObjectFields(seat.revealedVote.result) : undefined;
  const onChainRoot = revealedVote ? hexFromRpcValue(revealedVote.fields.evidence_root) : undefined;
  if (onChainRoot) vote.onChainEvidenceRoot = onChainRoot;

  if (!seat.committed) {
    const why = seat.failureStatus
      ? `the seat failed closed before committing (${seat.failureStatus}); it cast no vote`
      : "the seat has not committed a vote";
    for (const id of ["C1", "C2", "C3"] as const) {
      vote.checks.push(check(id, "votes", labels[id], "SKIPPED", { detail: why }));
    }
    return vote;
  }

  // C1: the VoteCommitted event in the commit transaction equals the record.
  const claimUrl = claimLink(world.base, world.claimId);
  if (!seat.commitTx) {
    vote.checks.push(
      check("C1", "votes", labels.C1, "UNAVAILABLE", {
        detail: "no commit transaction digest in any public source",
        url: claimUrl,
      }),
    );
  } else if (!seat.commitTxData || !seat.commitTxData.ok) {
    const outcome = seat.commitTxData ?? { ok: false as const, kind: "unavailable" as const, reason: "not fetched", url: "" };
    vote.checks.push(rpcFailure("C1", "votes", labels.C1, outcome, suiscanTx(seat.commitTx), "the commit transaction"));
  } else {
    const event = parseCommitEvent(seat.commitTxData.result);
    if (!event) {
      vote.checks.push(
        check("C1", "votes", labels.C1, "FAIL", {
          expected: seat.commitment,
          detail: "the transaction emits no VoteCommitted event",
          url: suiscanTx(seat.commitTx),
        }),
      );
    } else {
      vote.onChainCommitment = event.commitment;
      const seatMatches = event.jurySeatId === undefined || event.jurySeatId === seat.jurySeatId;
      const phaseMatches = event.phase === undefined || event.phase === seat.phase;
      if (!seat.commitment) {
        vote.checks.push(
          check("C1", "votes", labels.C1, "UNAVAILABLE", {
            actual: event.commitment,
            detail: "the report's audit bundle (the record side of this comparison) was not available",
            url: `${world.base}/api/claims/${world.claimId}/report`,
          }),
        );
      } else {
        const ok = sameHex(event.commitment, seat.commitment) && seatMatches && phaseMatches;
        const notes = [
          ...(ok ? [] : [!seatMatches ? "the event names another seat" : !phaseMatches ? "the event names another phase" : "the on-chain commitment differs from the record"]),
          ...(seat.notes.commit ? [seat.notes.commit] : []),
        ];
        vote.checks.push(
          check("C1", "votes", labels.C1, ok ? "PASS" : "FAIL", {
            expected: seat.commitment,
            actual: event.commitment,
            ...(notes.length > 0 ? { detail: notes.join("; ") } : {}),
            url: suiscanTx(seat.commitTx),
          }),
        );
      }
    }
  }

  if (!seat.revealed) {
    const chainStatus = world.inspection.attemptChain?.status;
    const why =
      chainStatus === "VOIDED" || chainStatus === "GAVE_UP"
        ? `the attempt was ${chainStatus === "VOIDED" ? "voided" : "abandoned"} before the reveal; the vote is not counted`
        : terminal(world)
          ? "the seat committed but never revealed (missed the reveal deadline); the vote is not counted"
          : "the seat has not revealed yet";
    vote.checks.push(check("C2", "votes", labels.C2, "SKIPPED", { detail: why }));
    vote.checks.push(check("C3", "votes", labels.C3, "SKIPPED", { detail: why }));
    return vote;
  }

  // C2: recompute the commitment from the reveal transaction inputs.
  const expectedCommitment = vote.onChainCommitment ?? seat.commitment;
  const root = world.rootsByPhase.get(seat.phase);
  if (!seat.revealTx) {
    vote.checks.push(
      check("C2", "votes", labels.C2, "UNAVAILABLE", {
        detail: "no reveal transaction digest in any public source",
        url: claimUrl,
      }),
    );
  } else if (!seat.revealTxData || !seat.revealTxData.ok) {
    const outcome = seat.revealTxData ?? { ok: false as const, kind: "unavailable" as const, reason: "not fetched", url: "" };
    vote.checks.push(rpcFailure("C2", "votes", labels.C2, outcome, suiscanTx(seat.revealTx), "the reveal transaction"));
  } else if (!seat.revealInputs) {
    vote.checks.push(
      check("C2", "votes", labels.C2, "FAIL", {
        detail: "the reveal_vote inputs could not be decoded from the transaction",
        url: suiscanTx(seat.revealTx),
      }),
    );
  } else if (!root) {
    vote.checks.push(
      check("C2", "votes", labels.C2, "UNAVAILABLE", {
        detail: `no evidence root for phase ${seat.phase} in any public source`,
        url: claimUrl,
      }),
    );
  } else {
    const inputs = seat.revealInputs;
    vote.reveal = {
      outcome: inputs.outcome,
      confidenceBps: inputs.confidenceBps,
      outputHash: inputs.outputHash,
      runHash: inputs.runHash,
      salt: inputs.salt,
      ...(inputs.argumentBlobId ? { argumentBlobId: inputs.argumentBlobId } : {}),
      resolvedBy: inputs.resolvedBy,
    };
    vote.preimage = {
      claim_id: world.claimId,
      agent_profile_id: seat.agentProfileId,
      jury_seat_id: seat.jurySeatId,
      phase: seat.phase,
      outcome: inputs.outcome,
      confidence_bps: inputs.confidenceBps,
      evidence_root: root,
      output_hash: inputs.outputHash,
      run_hash: inputs.runHash,
      salt: inputs.salt,
    };
    let recomputed: string | undefined;
    let failure: string | undefined;
    if (inputs.outcome !== OUTCOME.YES && inputs.outcome !== OUTCOME.NO && inputs.outcome !== OUTCOME.UNSURE) {
      failure = `outcome code ${inputs.outcome} is not YES, NO or UNSURE`;
    } else {
      try {
        recomputed = toHex(
          computeVoteCommitment({
            claim_id: world.claimId,
            agent_profile_id: seat.agentProfileId,
            jury_seat_id: seat.jurySeatId,
            phase: seat.phase,
            outcome: inputs.outcome as VoteOutcome,
            confidence_bps: inputs.confidenceBps,
            evidence_root: fromHex(root),
            output_hash: fromHex(inputs.outputHash),
            run_hash: fromHex(inputs.runHash),
            salt: fromHex(inputs.salt),
          }),
        );
        vote.recomputedCommitment = recomputed;
      } catch (error) {
        failure = errorMessage(error);
      }
    }
    if (failure !== undefined) {
      vote.checks.push(check("C2", "votes", labels.C2, "FAIL", { detail: failure, url: suiscanTx(seat.revealTx) }));
    } else if (!expectedCommitment) {
      vote.checks.push(
        check("C2", "votes", labels.C2, "UNAVAILABLE", {
          actual: recomputed,
          detail: "neither the commit transaction nor the record supplied a commitment to compare with",
          url: suiscanTx(seat.revealTx),
        }),
      );
    } else {
      const ok = sameHex(recomputed, expectedCommitment);
      const notes: string[] = [];
      if (onChainRoot && !sameHex(onChainRoot, root)) {
        notes.push(`the RevealedVote object binds root ${shortHex(onChainRoot)}, not ${shortHex(root)}`);
      }
      if (inputs.resolvedBy === "positions") notes.push("inputs resolved by fixed positions (no reveal_vote MoveCall found)");
      if (seat.notes.reveal) notes.push(seat.notes.reveal);
      vote.checks.push(
        check("C2", "votes", labels.C2, ok ? "PASS" : "FAIL", {
          expected: expectedCommitment,
          actual: recomputed,
          ...(notes.length > 0 || !ok ? { detail: [...(ok ? [] : ["the recomputed commitment differs: the revealed vote is not the committed one"]), ...notes].join("; ") } : {}),
          url: suiscanTx(seat.revealTx),
        }),
      );
    }
  }

  // C3: outcome and confidence on chain equal the report.
  if (!seat.revealInputs) {
    const status: AuditStatus = seat.revealTxData && !seat.revealTxData.ok && seat.revealTxData.kind === "not_found" ? "FAIL" : "UNAVAILABLE";
    vote.checks.push(
      check("C3", "votes", labels.C3, status, {
        ...(reported ? { expected: `${outcomeLabel(reported.outcome)} ${reported.confidenceBps} bps` } : {}),
        detail: "the reveal transaction inputs are not available",
        url: seat.revealTx ? suiscanTx(seat.revealTx) : claimUrl,
      }),
    );
  } else if (!reported) {
    vote.checks.push(
      check("C3", "votes", labels.C3, "UNAVAILABLE", {
        actual: `${outcomeLabel(seat.revealInputs.outcome)} ${seat.revealInputs.confidenceBps} bps`,
        detail: "no reported vote for this seat (report and inspection silent)",
        url: `${world.base}/api/claims/${world.claimId}/report`,
      }),
    );
  } else {
    const chain = seat.revealInputs;
    const eventAgrees =
      chain.event === undefined ||
      ((chain.event.outcome === undefined || chain.event.outcome === chain.outcome) &&
        (chain.event.confidenceBps === undefined || chain.event.confidenceBps === chain.confidenceBps));
    const ok = chain.outcome === reported.outcome && chain.confidenceBps === reported.confidenceBps && eventAgrees;
    vote.checks.push(
      check("C3", "votes", labels.C3, ok ? "PASS" : "FAIL", {
        expected: `${outcomeLabel(reported.outcome)} ${reported.confidenceBps} bps`,
        actual: `${outcomeLabel(chain.outcome)} ${chain.confidenceBps} bps`,
        ...(ok ? {} : { detail: eventAgrees ? "the reported vote differs from the on-chain reveal" : "the VoteRevealed event differs from the transaction inputs" }),
        ...(reported.valid === false ? { detail: "the report marks this reveal invalid (it does not enter the score)" } : {}),
        url: seat.revealTx ? suiscanTx(seat.revealTx) : claimUrl,
      }),
    );
  }
  return vote;
}

/** Terminal states: nothing more will happen to this claim. */
function terminal(world: World): boolean {
  const state = world.inspection.state;
  const chainStatus = world.inspection.attemptChain?.status;
  return (
    state >= CLAIM_STATE.FINALIZED_UNCHALLENGED ||
    chainStatus === "VOIDED" ||
    chainStatus === "GAVE_UP"
  );
}

// ---------------------------------------------------------------------------
// R1 to R18: juror runs
// ---------------------------------------------------------------------------

function approvedRunHash(world: World, runId: string): string | undefined {
  for (const entry of asArray(world.bundle.runApprovals).filter(isRecord)) {
    if (String(entry.runId ?? "").toLowerCase() === runId) return lowerHex(asString(entry.runHash));
  }
  for (const event of world.events) {
    if (event.kind !== "run_approved") continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    if (String(payload.run_id ?? event.runId ?? "").toLowerCase() === runId) {
      return lowerHex(asString(payload.run_hash) ?? asString(event.artifactHash));
    }
  }
  return undefined;
}

async function auditRuns(world: World): Promise<RunAudit[]> {
  const runs: RunAudit[] = [];
  for (const seat of world.seats) runs.push(await auditRun(world, seat));
  return runs;
}

async function auditRun(world: World, seat: Seat): Promise<RunAudit> {
  const proofUrl = `${world.base}/api/claims/${world.claimId}/runs/${seat.runId}/proof`;
  const run: RunAudit = {
    runId: seat.runId,
    phase: seat.phase,
    jurorIndex: seat.jurorIndex,
    jurySeatId: seat.jurySeatId,
    agentProfileId: seat.agentProfileId,
    ...(seat.modelId ? { modelId: seat.modelId } : {}),
    ...(seat.role ? { role: seat.role } : {}),
    revealed: false,
    kind: "none",
    hashes: {},
    citations: [],
    checks: [],
  };
  const proof = seat.proof;
  const skipAll = (status: AuditStatus, detail: string, url?: string) => {
    run.checks.push(check("R1-R18", "runs", "Run checks", status, { detail, ...(url ? { url } : {}) }));
  };
  if (!proof) {
    if (seat.failureStatus) {
      skipAll("SKIPPED", `the seat failed closed (${seat.failureStatus}); there is no run to check`);
    } else if (seat.proofMissing && !seat.revealed) {
      skipAll("SKIPPED", "no run proof exists for this seat yet (the run never started or was not recorded)");
    } else {
      skipAll("UNAVAILABLE", `the run proof could not be fetched: ${seat.proofReason ?? "unknown"}`, proofUrl);
    }
    return run;
  }
  const failure = isRecord(proof.failure) ? proof.failure : undefined;
  if (failure) {
    run.failure = { status: asString(failure.status) ?? "FAILED", ...(asString(failure.message) ? { message: asString(failure.message) } : {}) };
  }
  const sealedBlobId = asString(proof.sealedBlobId);
  const revealedBlobId = asString(proof.revealedBlobId);
  if (sealedBlobId) run.sealedBlobId = sealedBlobId;
  if (revealedBlobId) run.revealedBlobId = revealedBlobId;
  const bundle = proofBundle(proof);
  if (!bundle) {
    if (run.failure) {
      skipAll("SKIPPED", `the seat failed closed (${run.failure.status}${run.failure.message ? `: ${run.failure.message}` : ""}); no vote was cast`);
    } else {
      skipAll("SKIPPED", `the run is sealed and not revealed yet${sealedBlobId ? ` (sealed blob ${sealedBlobId})` : ""}`);
      if (sealedBlobId) run.checks.push(walrusCheck(world, sealedBlobId, "Sealed blob reachable on Walrus"));
    }
    return run;
  }

  run.revealed = true;
  run.bundleVersion = bundle.version;
  run.kind = bundle.version === 6 ? "table-vote" : bundle.version !== undefined && bundle.version >= 3 ? "research" : "legacy";
  const audit = bundle.audit;
  run.hashes = {
    ...(bundle.promptHash ? { promptHash: bundle.promptHash } : {}),
    ...(asString(audit.inputHash) ? { inputHash: asString(audit.inputHash)!.toLowerCase() } : {}),
    ...(asString(audit.outputHash) ? { outputHash: asString(audit.outputHash)!.toLowerCase() } : {}),
    ...(bundle.runHash ? { runHash: bundle.runHash } : {}),
    ...(asString(audit.toolTranscriptHash) ? { toolTranscriptHash: asString(audit.toolTranscriptHash)!.toLowerCase() } : {}),
    ...(bundle.evidenceRoot ? { evidenceRoot: bundle.evidenceRoot } : {}),
  };
  const outcome = asString(bundle.validatedOutput.outcome);
  const confidenceBps = asNumber(bundle.validatedOutput.confidenceBps);
  if (outcome && confidenceBps !== undefined) run.vote = { outcome, confidenceBps };
  const requestId = asString(bundle.gateway.gatewayRequestId) ?? asString(audit.gatewayRequestId);
  const devshardId = asString(bundle.gateway.devshardId) ?? asString(audit.devshardId);
  const servedModel = asString(audit.responseModelId) ?? asString(audit.modelId);
  run.gateway = {
    ...(requestId ? { requestId } : {}),
    ...(devshardId ? { devshardId } : {}),
    ...(asString(audit.modelId) ? { model: asString(audit.modelId) } : {}),
    ...(servedModel ? { servedModel } : {}),
  };
  const requestedAtMs = asNumber(audit.requestedAtMs);
  const completedAtMs = asNumber(audit.completedAtMs);
  if (requestedAtMs !== undefined && completedAtMs !== undefined) run.window = { requestedAtMs, completedAtMs };
  run.citations = asArray(bundle.validatedOutput.citations)
    .filter(isRecord)
    .slice(0, 2)
    .map((citation) => ({ url: asString(citation.url) ?? "", quote: asString(citation.quote) ?? "" }));

  // R1 to R15: the shared recomputation used by the verify page.
  let recomputedRunHash: string | undefined;
  try {
    const checks = await recomputeRunProof(proof as unknown as BrowserRunProof);
    for (const entry of checks) {
      const number = RUN_CHECK_NUMBERS[entry.key] ?? 0;
      const notApplicable = entry.expected === "not applicable";
      const status: AuditStatus = notApplicable ? "SKIPPED" : entry.ok ? "PASS" : "FAIL";
      if (entry.key === "runHash" && entry.actual) recomputedRunHash = entry.actual.toLowerCase();
      run.checks.push(
        check(`R${number}`, "runs", entry.label, status, {
          expected: entry.expected,
          actual: entry.actual ?? "-",
          ...(entry.detail ? { detail: entry.detail } : {}),
        }),
      );
    }
  } catch (error) {
    run.checks.push(check("R1-R15", "runs", "Run recomputation", "FAIL", { detail: errorMessage(error) }));
  }

  // R16: the approved run hash equals the recomputation and the reveal input.
  const approved = approvedRunHash(world, seat.runId);
  const revealRunHash = seat.revealInputs?.runHash;
  const recordedRunHash = bundle.runHash;
  if (!approved) {
    run.checks.push(
      check("R16", "chain", "Run hash approved on chain", "UNAVAILABLE", {
        ...(recomputedRunHash ? { actual: recomputedRunHash } : {}),
        detail: "no run approval in the public record for this run",
        url: claimLink(world.base, world.claimId),
      }),
    );
  } else {
    const recomputeOk = recomputedRunHash !== undefined && sameHex(approved, recomputedRunHash) && sameHex(approved, recordedRunHash);
    if (revealRunHash === undefined) {
      const revealState = seat.revealTxData && !seat.revealTxData.ok ? seat.revealTxData.kind : seat.revealTx ? "unavailable" : "missing";
      run.checks.push(
        check("R16", "chain", "Run hash approved on chain", recomputeOk ? (revealState === "not_found" ? "FAIL" : "UNAVAILABLE") : "FAIL", {
          expected: approved,
          actual: recomputedRunHash ?? "-",
          detail: recomputeOk
            ? revealState === "not_found"
              ? "approval and recomputation agree, but the reveal transaction was not found on Sui"
              : "approval and recomputation agree; the reveal transaction input could not be fetched to confirm the on-chain value"
            : "the approved run hash differs from the recomputed run hash",
          url: seat.revealTx ? suiscanTx(seat.revealTx) : claimLink(world.base, world.claimId),
        }),
      );
    } else {
      const ok = recomputeOk && sameHex(approved, revealRunHash);
      run.checks.push(
        check("R16", "chain", "Run hash approved on chain", ok ? "PASS" : "FAIL", {
          expected: approved,
          actual: `${recomputedRunHash ?? "-"} (recomputed), ${revealRunHash} (reveal input)`,
          ...(ok ? {} : { detail: "the approved, recomputed and revealed run hashes do not all agree" }),
          url: seat.revealTx ? suiscanTx(seat.revealTx) : claimLink(world.base, world.claimId),
        }),
      );
    }
  }

  // R17: the provider's own receipt.
  if (!requestId) {
    run.checks.push(check("R17", "receipts", "Provider receipt", "UNAVAILABLE", { detail: "the bundle records no gateway request id" }));
  } else {
    const url = `${DEFAULT_RECEIPTS_BASE}${encodeURIComponent(requestId)}`;
    run.receiptUrl = url;
    const outcome = world.receipts.get(requestId);
    if (!outcome) {
      run.checks.push(check("R17", "receipts", "Provider receipt", "UNAVAILABLE", { detail: "receipt not fetched", url }));
    } else if (!outcome.ok) {
      const why = outcome.status === 404 ? "the gateway has no receipt for this request id" : outcome.status === 429 ? "the gateway rate-limited the lookup" : outcome.reason;
      run.checks.push(check("R17", "receipts", "Provider receipt", "UNAVAILABLE", { detail: why, url }));
    } else if (!isRecord(outcome.body)) {
      run.checks.push(check("R17", "receipts", "Provider receipt", "UNAVAILABLE", { detail: "the receipt is not JSON", url }));
    } else {
      run.receipt = outcome.body;
      const comparison = compareReceipt(outcome.body as Receipt, {
        requestId,
        ...(servedModel ? { model: servedModel } : {}),
        ...(devshardId ? { devshardId } : {}),
        ...(requestedAtMs !== undefined ? { requestedAtMs } : {}),
        ...(completedAtMs !== undefined ? { completedAtMs } : {}),
      });
      run.checks.push(
        check("R17", "receipts", "Provider receipt", comparison.ok ? "PASS" : "FAIL", {
          expected: `model ${servedModel ?? "?"}, devshard ${devshardId ?? "?"}, created ${isoTime(requestedAtMs)} .. ${isoTime(completedAtMs === undefined ? undefined : completedAtMs + RECEIPT_WINDOW_SLACK_MS)}`,
          actual: comparison.summary,
          ...(comparison.ok ? {} : { detail: comparison.issues.join("; ") }),
          url,
        }),
      );
    }
  }

  // R18: the revealed blob is on Walrus.
  const blobId = revealedBlobId ?? sealedBlobId;
  if (!blobId) {
    run.checks.push(check("R18", "walrus", "Revealed blob reachable on Walrus", "UNAVAILABLE", { detail: "the proof names no revealed blob" }));
  } else {
    run.checks.push(walrusCheck(world, blobId, revealedBlobId ? "Revealed blob reachable on Walrus" : "Sealed blob reachable on Walrus"));
    run.blobUrl = `${DEFAULT_WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
  }
  return run;
}

function walrusCheck(world: World, blobId: string, label: string): AuditCheck {
  const url = `${DEFAULT_WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
  const outcome = world.walrus.get(blobId);
  if (!outcome) return check("R18", "walrus", label, "UNAVAILABLE", { detail: "blob not fetched", url });
  if (outcome.ok) return check("R18", "walrus", label, "PASS", { expected: "HTTP 200", actual: `HTTP ${outcome.status}`, url });
  if (outcome.status === 404) {
    return check("R18", "walrus", label, "FAIL", { expected: "HTTP 200", actual: "HTTP 404", detail: "the aggregator has no such blob", url });
  }
  return check("R18", "walrus", label, "UNAVAILABLE", { expected: "HTTP 200", detail: outcome.reason, url });
}

// ---------------------------------------------------------------------------
// S1 to S4 and D1 to D3: claim level
// ---------------------------------------------------------------------------

function recordedResult(world: World): string | undefined {
  const fromInspection = world.inspection.result?.result;
  if (fromInspection) return fromInspection;
  const label = world.report?.label;
  return label && label !== "PENDING" ? label : undefined;
}

function recordedScoreBps(world: World): number | null {
  const fromInspection = world.inspection.result?.truthScoreBps;
  if (fromInspection !== undefined && fromInspection !== null) return fromInspection;
  const certificate = isRecord(world.bundle.certificate) ? world.bundle.certificate : undefined;
  const fromBundle = asNumber(certificate?.truthScoreBps);
  return fromBundle ?? null;
}

function scoreTerms(world: World): ScoreTerm[] {
  const finalPhase = finalPhaseOf(world);
  const seatsByIndex = new Map(world.seats.filter((seat) => seat.phase === finalPhase).map((seat) => [seat.jurySeatId, seat]));
  if (world.report && world.report.finalRoundVotes.length > 0) {
    return world.report.finalRoundVotes.map((vote) => {
      const seat = seatsByIndex.get(vote.jurySeatId.toLowerCase());
      const code = outcomeCode(vote.outcome);
      return {
        jurorIndex: seat?.jurorIndex ?? 0,
        jurySeatId: vote.jurySeatId.toLowerCase(),
        outcome: vote.outcome,
        confidenceBps: vote.confidenceBps,
        probabilityBps: code === undefined ? 0 : agentProbabilityBps(code as VoteOutcome, vote.confidenceBps),
        valid: vote.valid,
      };
    }).sort((left, right) => left.jurorIndex - right.jurorIndex);
  }
  return [...seatsByIndex.values()]
    .filter((seat) => seat.revealed && seat.outcome !== undefined && seat.confidenceBps !== undefined)
    .map((seat) => ({
      jurorIndex: seat.jurorIndex,
      jurySeatId: seat.jurySeatId,
      outcome: outcomeLabel(seat.outcome),
      confidenceBps: seat.confidenceBps!,
      probabilityBps: agentProbabilityBps(seat.outcome as VoteOutcome, seat.confidenceBps!),
      valid: true,
    }));
}

function buildScore(world: World): AuditResult["score"] {
  const terms = scoreTerms(world);
  const valid = terms.filter((term) => term.valid);
  const sumBps = valid.reduce((total, term) => total + term.probabilityBps, 0);
  let meanBps: number | null = null;
  try {
    meanBps = computeTruthScoreBps(
      valid.map((term) => ({ outcome: (outcomeCode(term.outcome) ?? OUTCOME.UNSURE) as VoteOutcome, confidenceBps: term.confidenceBps })),
    );
  } catch {
    meanBps = null;
  }
  const reportScore = world.report?.truthScore;
  return {
    formula:
      world.report?.truthScoreFormula ??
      "confidence is read as the juror's probability that its own vote is correct; mean(YES confidence, NO (10000-confidence), UNSURE 5000) over valid reveals, rounded half-up; displayed as basis-points / 100",
    terms,
    sumBps,
    count: valid.length,
    meanBps,
    reportBps: reportScore === null || reportScore === undefined ? null : Math.round(reportScore * 100),
    certificateBps: recordedScoreBps(world),
  };
}

function auditClaimChecks(world: World, score: AuditResult["score"], votes: VoteAudit[], runs: RunAudit[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const result = recordedResult(world);
  const finalPhase = finalPhaseOf(world);
  const reportUrl = `${world.base}/api/claims/${world.claimId}/report`;

  // S1: the truth score is plain arithmetic over the valid final-round reveals.
  if (result === undefined) {
    checks.push(check("S1", "score", "Truth score recomputed", "SKIPPED", { detail: "the claim has no certificate yet" }));
  } else if (score.count === 0) {
    checks.push(
      check("S1", "score", "Truth score recomputed", world.report ? "FAIL" : "UNAVAILABLE", {
        expected: `${score.certificateBps ?? "-"} bps`,
        detail: world.report ? "no valid final-round reveal to score" : "the report (final-round votes) was not available",
        url: reportUrl,
      }),
    );
  } else {
    const ok =
      score.meanBps !== null &&
      score.meanBps === score.certificateBps &&
      (score.reportBps === null || score.reportBps === score.meanBps);
    checks.push(
      check("S1", "score", "Truth score recomputed", ok ? "PASS" : "FAIL", {
        expected: `${score.certificateBps ?? "-"} bps (certificate), ${score.reportBps ?? "-"} bps (report)`,
        actual: `${score.meanBps ?? "-"} bps = round((${score.sumBps}) / ${score.count})`,
        ...(ok ? {} : { detail: "the recomputed mean differs from the recorded score" }),
      }),
    );
  }

  // S2: the certificate object on Sui carries the result.
  const certificateId = world.certificateId;
  if (!certificateId) {
    checks.push(
      check("S2", "chain", "Certificate on Sui", result === undefined ? "SKIPPED" : "FAIL", {
        detail: result === undefined ? "the claim is not finalized" : "the claim is finalized but no certificate id is in the public record",
      }),
    );
  } else if (!world.certificate || !world.certificate.ok) {
    const outcome = world.certificate ?? { ok: false as const, kind: "unavailable" as const, reason: "not fetched", url: "" };
    checks.push(rpcFailure("S2", "chain", "Certificate on Sui", outcome, suivisionObject(certificateId), "the certificate object"));
  } else {
    const object = parseObjectFields(world.certificate.result);
    if (!object) {
      checks.push(check("S2", "chain", "Certificate on Sui", "FAIL", { detail: "the object has no Move content", url: suivisionObject(certificateId) }));
    } else {
      const fields = parseCertificateFields(object.fields);
      const expectedCode = result === undefined ? undefined : RESULT_CODES[result];
      const issues: string[] = [];
      if (object.type && !/::jury::ResolutionCertificate$/.test(object.type)) issues.push(`object type ${object.type}`);
      if (fields.claimId !== undefined && fields.claimId !== world.claimId) issues.push("claim_id names another claim");
      if (expectedCode !== undefined && fields.result !== expectedCode) issues.push(`result ${fields.result ?? "?"} is not ${result} (${expectedCode})`);
      if ((fields.truthScoreBps ?? null) !== score.certificateBps) issues.push(`truth_score_bps ${fields.truthScoreBps ?? "none"} is not ${score.certificateBps ?? "none"}`);
      const recordedVoteIds = (world.report?.sui.revealedVoteIds ?? []).map((id) => id.toLowerCase());
      if (recordedVoteIds.length > 0) {
        const chainSet = new Set(fields.revealedVoteIds);
        const same = recordedVoteIds.length === chainSet.size && recordedVoteIds.every((id) => chainSet.has(id));
        if (!same) issues.push("revealed_vote_ids differ from the report");
      }
      checks.push(
        check("S2", "chain", "Certificate on Sui", issues.length === 0 ? "PASS" : "FAIL", {
          expected: `result ${result ?? "?"} (${expectedCode ?? "?"}), truth_score_bps ${score.certificateBps ?? "none"}`,
          actual: `result ${fields.result ?? "?"}, truth_score_bps ${fields.truthScoreBps ?? "none"}, ${fields.revealedVoteIds.length} revealed votes`,
          ...(issues.length === 0 ? {} : { detail: issues.join("; ") }),
          url: suivisionObject(certificateId),
        }),
      );
    }
  }

  // S3: four matching valid reveals settle YES or NO; otherwise UNRESOLVED.
  const tally = { YES: 0, NO: 0, UNSURE: 0 };
  for (const term of score.terms) {
    if (term.valid && term.outcome in tally) tally[term.outcome as keyof typeof tally] += 1;
  }
  const threshold = (["YES", "NO", "UNSURE"] as const).find((label) => tally[label] >= QUORUM);
  const expectedResult =
    threshold === "YES" || threshold === "NO"
      ? threshold
      : threshold === "UNSURE" || finalPhase === 2
        ? "UNRESOLVED"
        : "no quorum in round one (the cascade continues)";
  const tallyText = `YES ${tally.YES}, NO ${tally.NO}, UNSURE ${tally.UNSURE} of ${score.count} valid reveals in round ${finalPhase}`;
  if (result === undefined) {
    checks.push(check("S3", "score", "Quorum rule", "SKIPPED", { actual: tallyText, detail: "the claim has no result yet" }));
  } else if (score.count === 0) {
    checks.push(check("S3", "score", "Quorum rule", world.report ? "FAIL" : "UNAVAILABLE", { expected: result, detail: world.report ? "no valid reveal to tally" : "the report was not available", url: reportUrl }));
  } else {
    const ok = expectedResult === result;
    checks.push(
      check("S3", "score", "Quorum rule", ok ? "PASS" : "FAIL", {
        expected: `${expectedResult} from ${tallyText}`,
        actual: `${result} recorded`,
        ...(ok ? {} : { detail: "the recorded result does not follow the quorum rule" }),
      }),
    );
  }

  // S4: one evidence root per phase, agreed by every source, with its manifest on Walrus.
  const phases = [...new Set<ClaimPhase>([...world.rootsByPhase.keys(), ...world.manifestsByPhase.keys()])].sort();
  for (const phase of phases) {
    const sources = new Map<string, string>();
    const inspectionRoot = world.inspection.evidenceRoots.find((entry) => entry.phase === phase)?.root;
    if (inspectionRoot) sources.set("claim record", inspectionRoot.toLowerCase());
    const bundleRoot = asArray(world.bundle.evidence).filter(isRecord).find((entry) => asNumber(entry.phase) === phase);
    if (bundleRoot && asString(bundleRoot.root)) sources.set("report", asString(bundleRoot.root)!.toLowerCase());
    const frozen = world.events.find((event) => event.kind === "evidence_frozen" && asNumber(isRecord(event.payload) ? event.payload.phase : undefined) === phase);
    const frozenRoot = frozen ? lowerHex(asString(isRecord(frozen.payload) ? frozen.payload.root : undefined) ?? asString(frozen.artifactHash)) : undefined;
    if (frozenRoot) sources.set("evidence_frozen event", frozenRoot);
    for (const seat of world.seats.filter((entry) => entry.phase === phase)) {
      const bundle = proofBundle(seat.proof);
      if (bundle?.evidenceRoot) sources.set(`juror ${seat.jurorIndex} run`, bundle.evidenceRoot);
      const onChain = votes.find((vote) => vote.jurySeatId === seat.jurySeatId && vote.phase === phase)?.onChainEvidenceRoot;
      if (onChain) sources.set(`juror ${seat.jurorIndex} RevealedVote on Sui`, onChain);
    }
    const distinct = [...new Set(sources.values())];
    const reference = frozenRoot ?? inspectionRoot?.toLowerCase() ?? distinct[0];
    if (distinct.length === 0) {
      checks.push(check("S4.root", "chain", `Evidence root agreed, phase ${phase}`, "UNAVAILABLE", { detail: "no source reports a root for this phase" }));
    } else {
      const ok = distinct.length === 1;
      checks.push(
        check("S4.root", "chain", `Evidence root agreed, phase ${phase}`, ok ? "PASS" : "FAIL", {
          expected: reference,
          actual: ok ? `${distinct[0]} (${sources.size} sources agree: ${describeRootSources([...sources.keys()])})` : [...sources.entries()].map(([name, root]) => `${name} ${shortHex(root)}`).join("; "),
          ...(ok ? {} : { detail: "the sources disagree on the frozen evidence root" }),
        }),
      );
    }
    const manifest = world.manifestsByPhase.get(phase);
    const label = `Evidence manifest on Walrus, phase ${phase}`;
    if (!manifest) {
      checks.push(check("S4.manifest", "walrus", label, "UNAVAILABLE", { detail: "no manifest blob id in the public record" }));
    } else if (manifest.reason !== undefined) {
      const missing = /HTTP 404/.test(manifest.reason);
      checks.push(check("S4.manifest", "walrus", label, missing ? "FAIL" : "UNAVAILABLE", { expected: "HTTP 200", detail: manifest.reason, ...(manifest.url ? { url: manifest.url } : {}) }));
    } else {
      const recomputed = recomputeManifestRoot(manifest.body);
      const phaseRoot = world.rootsByPhase.get(phase);
      if (recomputed.root === undefined) {
        checks.push(check("S4.manifest", "walrus", label, "PASS", { expected: "HTTP 200", actual: "HTTP 200", detail: `reachable; root not recomputed (${recomputed.error ?? "unknown format"})`, ...(manifest.url ? { url: manifest.url } : {}) }));
      } else {
        const ok = phaseRoot === undefined || sameHex(recomputed.root, phaseRoot);
        checks.push(
          check("S4.manifest", "walrus", label, ok ? "PASS" : "FAIL", {
            expected: phaseRoot ?? "-",
            actual: `${recomputed.root} recomputed from ${recomputed.evidenceIds.length} items`,
            ...(ok ? {} : { detail: "the manifest on Walrus does not hash to the frozen root" }),
            ...(manifest.url ? { url: manifest.url } : {}),
          }),
        );
      }
    }
  }

  checks.push(diversityRow(world));

  if (isTwoRound(world)) checks.push(...auditDebate(world, runs));
  return checks;
}

/**
 * S5: how many model families sat, and how many the registry demanded when
 * this committee was drawn. Informational only: a jury the chain accepted is
 * a valid jury, degraded or not, so this row never fails. It is the audit's
 * copy of the CommitteeDiversity event, recomputed from the seats.
 */
function diversityRow(world: World): AuditCheck {
  // Move counts distinct model hashes, and the catalog runs one model per
  // family, so distinct models is the family count the chain checked.
  const models = new Set(
    world.jurors
      .map((juror) => juror.modelId)
      .filter((modelId): modelId is string => modelId !== undefined),
  );
  const required = world.inspection.jury?.requiredFamilies;
  if (models.size === 0) {
    return check("S5", "chain", "Model families drawn", "UNAVAILABLE", {
      detail: "no seat on this claim names its model",
    });
  }
  const degraded = models.size < 3;
  return check("S5", "chain", "Model families drawn", "PASS", {
    actual: `families drawn: ${models.size}${
      required === undefined ? "" : ` (registry required ${required} at the draw)`
    }`,
    detail: degraded
      ? "degraded mode: fewer than three model families judged this claim"
      : "the full three model families judged this claim",
  });
}

/** "claim record, report, 5 juror runs, 5 RevealedVote objects on Sui" instead of 13 names. */
function describeRootSources(names: string[]): string {
  const runs = names.filter((name) => / run$/.test(name)).length;
  const objects = names.filter((name) => /RevealedVote on Sui$/.test(name)).length;
  const rest = names.filter((name) => !/ run$/.test(name) && !/RevealedVote on Sui$/.test(name));
  return [
    ...rest,
    ...(runs > 0 ? [`${runs} juror run${runs === 1 ? "" : "s"}`] : []),
    ...(objects > 0 ? [`${objects} RevealedVote object${objects === 1 ? "" : "s"} on Sui`] : []),
  ].join(", ");
}

function isTwoRound(world: World): boolean {
  const state = world.inspection.state;
  return (
    world.seats.some((seat) => seat.phase === 2) ||
    world.rootsByPhase.has(2) ||
    (world.inspection.deliberation?.length ?? 0) > 0 ||
    (state >= CLAIM_STATE.DISCUSSION && state <= CLAIM_STATE.REVEAL_2) ||
    finalPhaseOf(world) === 2
  );
}

function debateTurns(world: World): DebateTurnRow[] {
  const seatIndex = new Map(world.seats.map((seat) => [seat.jurySeatId, seat.jurorIndex]));
  const fromInspection = world.inspection.deliberation ?? [];
  const source: Json[] =
    fromInspection.length > 0
      ? (fromInspection as unknown as Json[])
      : world.events.filter((event) => event.kind === "DELIBERATION_TURN").map((event) => (isRecord(event.payload) ? event.payload : {}));
  return source
    .map((turn) => {
      const jurySeatId = String(turn.jurySeatId ?? "").toLowerCase();
      return {
        ordinal: asNumber(turn.ordinal) ?? 0,
        exchange: asNumber(turn.exchange) ?? 0,
        jurorIndex: seatIndex.get(jurySeatId) ?? (asNumber(turn.seatIndex) !== undefined ? asNumber(turn.seatIndex)! + 1 : 0),
        jurySeatId,
        ...(asString(turn.modelId) ? { modelId: asString(turn.modelId) } : {}),
        ...(asString(turn.stance) ? { stance: asString(turn.stance) } : {}),
        ...(asNumber(turn.confidenceBps) !== undefined ? { confidenceBps: asNumber(turn.confidenceBps) } : {}),
        status: asString(turn.status) ?? "SPOKEN",
        argument: asString(turn.argument) ?? "",
        citations: asArray(turn.citations).length,
        ...(asString(turn.specVersion) ? { specVersion: asString(turn.specVersion) } : {}),
        ...(asNumber(turn.answering) !== undefined ? { answering: asNumber(turn.answering)! } : {}),
        ...(isRecord(turn.question) && asNumber(turn.question.seat) !== undefined && asString(turn.question.text)
          ? { question: { seat: asNumber(turn.question.seat)!, text: asString(turn.question.text)! } }
          : {}),
      };
    })
    .sort((left, right) => left.ordinal - right.ordinal);
}

function auditDebate(world: World, runs: RunAudit[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const turns = debateTurns(world);
  const state = world.inspection.state;
  if (turns.length === 0) {
    checks.push(
      check("D1", "debate", "Debate transcript", state <= CLAIM_STATE.DISCUSSION ? "SKIPPED" : "FAIL", {
        detail: state <= CLAIM_STATE.DISCUSSION ? "the debate has not produced a turn yet" : "a two-round claim without a debate transcript",
      }),
    );
  } else {
    const spoken = turns.filter((turn) => turn.status === "SPOKEN").length;
    // The turns name the deliberation contract they ran on; V1 to V3 name none.
    const specVersion = turns.find((turn) => turn.specVersion !== undefined)?.specVersion;
    const contract = specVersion === undefined
      ? " on deliberation spec V1 to V3"
      : ` on deliberation spec V${specVersion}`;
    checks.push(
      check("D1", "debate", "Debate transcript", "PASS", {
        expected: "turns with seat, exchange, stance, confidence and status",
        actual: `${turns.length} turns (${spoken} SPOKEN, ${turns.length - spoken} SKIPPED) over ${new Set(turns.map((turn) => turn.exchange)).size} exchanges${contract}`,
      }),
    );
  }

  const manifest = world.manifestsByPhase.get(2);
  const phaseTwoRoot = world.rootsByPhase.get(2);
  if (manifest?.body !== undefined) {
    const recomputed = recomputeManifestRoot(manifest.body);
    const present = recomputed.sourceUrls.includes(TRANSCRIPT_ARTIFACT);
    checks.push(
      check("D2", "debate", "Transcript frozen in the phase-two evidence", present ? "PASS" : "FAIL", {
        expected: `${TRANSCRIPT_ARTIFACT} in the phase-two manifest`,
        actual: present ? `present (root ${shortHex(phaseTwoRoot)})` : `absent from ${recomputed.sourceUrls.length} manifest items`,
        ...(manifest.url ? { url: manifest.url } : {}),
      }),
    );
  } else {
    // Without the manifest, the report's evidence list and a round-two bundle still name the artifact.
    const artifact = world.report?.evidence.find((entry) => entry.sourceUrl === TRANSCRIPT_ARTIFACT);
    const phaseTwoBundles = world.seats.filter((seat) => seat.phase === 2).map((seat) => proofBundle(seat.proof)).filter((bundle): bundle is Bundle => bundle !== undefined);
    if (phaseTwoRoot === undefined) {
      checks.push(check("D2", "debate", "Transcript frozen in the phase-two evidence", "SKIPPED", { detail: "the phase-two evidence is not frozen yet" }));
    } else if (!artifact || phaseTwoBundles.length === 0) {
      checks.push(
        check("D2", "debate", "Transcript frozen in the phase-two evidence", "UNAVAILABLE", {
          detail: "the phase-two manifest could not be read from Walrus and no revealed round-two bundle lists it",
          ...(manifest?.url ? { url: manifest.url } : {}),
        }),
      );
    } else {
      const bound = phaseTwoBundles.some((bundle) => {
        const manifestItems = isRecord(bundle.input.evidenceManifest) ? asArray(bundle.input.evidenceManifest.items) : [];
        return manifestItems.some((item) => isRecord(item) && item.evidenceId === artifact.evidenceId);
      });
      checks.push(
        check("D2", "debate", "Transcript frozen in the phase-two evidence", bound ? "PASS" : "FAIL", {
          expected: `${TRANSCRIPT_ARTIFACT} (${shortHex(artifact.evidenceId)}) in the round-two manifest`,
          actual: bound ? "listed in a revealed round-two bundle's manifest" : "not listed in any revealed round-two bundle",
        }),
      );
    }
  }

  const expectedPromptHash = tableVotePromptSpecHash();
  const tableVotes = runs.filter((run) => run.phase === 2 && run.revealed);
  const v6 = tableVotes.filter((run) => run.kind === "table-vote");
  if (tableVotes.length === 0) {
    checks.push(check("D3", "debate", "Table votes bind the pinned prompt", "SKIPPED", { expected: expectedPromptHash, detail: "no revealed round-two run yet" }));
  } else if (v6.length === 0) {
    checks.push(
      check("D3", "debate", "Table votes bind the pinned prompt", "SKIPPED", {
        expected: expectedPromptHash,
        detail: `round two ran as research bundles (v${tableVotes[0]?.bundleVersion ?? "?"}), before the table vote existed; nothing to compare`,
      }),
    );
  } else {
    const wrong = v6.filter((run) => !sameHex(run.hashes.promptHash, expectedPromptHash));
    checks.push(
      check("D3", "debate", "Table votes bind the pinned prompt", wrong.length === 0 ? "PASS" : "FAIL", {
        expected: expectedPromptHash,
        actual: wrong.length === 0 ? `${v6.length} table-vote runs bind it` : wrong.map((run) => `juror ${run.jurorIndex}: ${shortHex(run.hashes.promptHash)}`).join("; "),
      }),
    );
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Timeline, status, assembly
// ---------------------------------------------------------------------------

const TIMELINE_KINDS = new Set([
  "claim_created",
  "evidence_frozen",
  "committee_selected",
  "run_approved",
  "vote_committed",
  "vote_revealed",
  "phase_changed",
  "DELIBERATION_TURN",
  "debate_converged",
  "output_repaired",
  "inference_failed",
  "claim_finalized",
  "attempt_voided",
  "claim_voided",
]);

function buildTimeline(world: World): { entries: TimelineEntry[]; source: "events" | "record" } {
  const seatIndex = new Map(world.seats.map((seat) => [seat.jurySeatId, seat.jurorIndex]));
  const runIndex = new Map(world.seats.map((seat) => [seat.runId, seat.jurorIndex]));
  const entries: TimelineEntry[] = [];
  for (const event of world.events) {
    const kind = asString(event.kind) ?? "";
    if (!TIMELINE_KINDS.has(kind)) continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const atMs = Date.parse(asString(event.occurredAt) ?? "") || asNumber(payload.atMs) || 0;
    const seat = String(payload.jury_seat_id ?? payload.jurySeatId ?? "").toLowerCase();
    const runId = String(payload.run_id ?? event.runId ?? "").toLowerCase();
    const juror = seatIndex.get(seat) ?? runIndex.get(runId);
    const who = juror === undefined ? "" : `juror ${juror}`;
    let detail = "";
    switch (kind) {
      case "claim_created":
        detail = `package ${shortHex(asString(payload.package_id))}`;
        break;
      case "evidence_frozen":
        detail = `phase ${asNumber(payload.phase) ?? "?"} root ${shortHex(asString(payload.root))}`;
        break;
      case "committee_selected":
        detail = `${asArray(payload.jury_seat_ids).length} seats, committee ${shortHex(asString(payload.committee_id))}`;
        break;
      case "run_approved":
        detail = `${who} run hash ${shortHex(asString(payload.run_hash))}`;
        break;
      case "vote_committed":
        detail = `${who} phase ${asNumber(payload.phase) ?? "?"}`;
        break;
      case "vote_revealed":
        detail = `${who} ${asString(payload.outcome) ?? "?"} ${asNumber(payload.confidence_bps) ?? "?"} bps${payload.valid === false ? " (invalid)" : ""}`;
        break;
      case "phase_changed":
        detail = `${asString(payload.previous_phase) ?? "?"} to ${asString(payload.new_phase) ?? "?"}`;
        break;
      case "DELIBERATION_TURN":
        detail = `${who || "juror"} exchange ${asNumber(payload.exchange) ?? "?"} ${asString(payload.status) ?? ""}${asString(payload.stance) ? ` ${asString(payload.stance)}` : ""}`.trim();
        break;
      case "debate_converged":
        detail = `after exchange ${asNumber(payload.exchange) ?? asNumber(payload.convergedAfterExchange) ?? "?"}`;
        break;
      case "output_repaired":
        detail = `${who} field ${asString(payload.field) ?? "?"}`;
        break;
      case "inference_failed":
        detail = `${who || "run"} ${asString(payload.category) ?? "failed"}`;
        break;
      case "claim_finalized":
        detail = `${asString(payload.outcome) ?? "?"}, score ${asNumber(payload.truth_score_bps) ?? "-"} bps, certificate ${shortHex(asString(payload.certificate_id))}`;
        break;
      default:
        detail = asString(payload.reason) ?? "";
    }
    entries.push({
      atMs,
      at: isoTime(atMs),
      event: kind,
      detail,
      ...(asString(event.transactionDigest) ? { transactionDigest: asString(event.transactionDigest) } : {}),
    });
  }
  if (entries.length > 0) return { entries, source: "events" };

  // No event history: rebuild what the record and the chain can tell.
  for (const seat of world.seats) {
    const commit = seat.commitTxData?.ok && isRecord(seat.commitTxData.result) ? asNumber(seat.commitTxData.result.timestampMs) : undefined;
    if (commit !== undefined && seat.commitTx) {
      entries.push({ atMs: commit, at: isoTime(commit), event: "vote_committed", detail: `juror ${seat.jurorIndex} phase ${seat.phase}`, transactionDigest: seat.commitTx });
    }
    const reveal = seat.revealTxData?.ok && isRecord(seat.revealTxData.result) ? asNumber(seat.revealTxData.result.timestampMs) : undefined;
    if (reveal !== undefined && seat.revealTx) {
      entries.push({ atMs: reveal, at: isoTime(reveal), event: "vote_revealed", detail: `juror ${seat.jurorIndex} ${outcomeLabel(seat.revealInputs?.outcome)} ${seat.revealInputs?.confidenceBps ?? "?"} bps`, transactionDigest: seat.revealTx });
    }
  }
  const certificate = world.certificate?.ok ? parseObjectFields(world.certificate.result) : undefined;
  const finalizedAt = certificate ? parseCertificateFields(certificate.fields).finalizedAtMs : undefined;
  if (finalizedAt !== undefined) {
    entries.push({ atMs: finalizedAt, at: isoTime(finalizedAt), event: "claim_finalized", detail: `${recordedResult(world) ?? "?"}, certificate ${shortHex(world.certificateId)}`, ...(world.inspection.result?.digest ? { transactionDigest: world.inspection.result.digest } : {}) });
  }
  entries.sort((left, right) => left.atMs - right.atMs);
  return { entries, source: "record" };
}

function classify(world: World): { status: AuditClaimStatus; pending: string[] } {
  const { inspection } = world;
  const chain = inspection.attemptChain;
  const state = inspection.state;
  const pending: string[] = [];
  if (chain?.status === "VOIDED") {
    const why = chain.void;
    pending.push(
      `attempt ${chain.attempt} of ${chain.maxAttempts} was voided${why ? `: ${why.reason}${why.message ? ` (${why.message})` : ""}${why.modelId ? `, juror model ${why.modelId}` : ""}${why.phase ? `, phase ${why.phase}` : ""}` : ""}`,
    );
    pending.push(
      chain.relaunchedAs
        ? `relaunched as attempt ${chain.attempt + 1}: ${claimLink(world.base, chain.relaunchedAs)}`
        : "no relaunch recorded yet (the engine relaunches once the model weather clears)",
    );
    return { status: "VOIDED", pending };
  }
  if (chain?.status === "GAVE_UP") {
    pending.push(`the verification gave up after ${chain.attempt} of ${chain.maxAttempts} attempts${chain.gaveUpReason ? `: ${chain.gaveUpReason}` : ""}`);
    return { status: "GAVE_UP", pending };
  }
  if (state === CLAIM_STATE.CANCELLED) return { status: "CANCELLED", pending: ["the claim was cancelled"] };
  if (state >= CLAIM_STATE.FINALIZED_UNCHALLENGED && state <= CLAIM_STATE.UNRESOLVED) {
    return { status: "FINALIZED", pending };
  }
  const phase: ClaimPhase = state >= CLAIM_STATE.DISCUSSION ? 2 : 1;
  const seats = world.seats.filter((seat) => seat.phase === phase);
  const committed = seats.filter((seat) => seat.committed).length;
  const revealed = seats.filter((seat) => seat.revealed).length;
  const failed = seats.filter((seat) => seat.failureStatus).length;
  const deadline = (key: keyof ClaimInspection["deadlines"]) =>
    `${isoTime(inspection.deadlines[key])}${inspection.deadlines[key] < world.now ? " (passed)" : ""}`;
  switch (state) {
    case CLAIM_STATE.COMMIT_1:
    case CLAIM_STATE.COMMIT_2:
      pending.push(`round ${phase} commit: ${committed} of ${seats.length} seats committed${failed > 0 ? `, ${failed} failed closed` : ""}; deadline ${deadline(phase === 1 ? "firstCommitDeadlineMs" : "secondCommitDeadlineMs")}`);
      break;
    case CLAIM_STATE.REVEAL_1:
    case CLAIM_STATE.REVEAL_2:
      pending.push(`round ${phase} reveal: ${revealed} of ${committed} committed seats revealed; deadline ${deadline(phase === 1 ? "firstRevealDeadlineMs" : "secondRevealDeadlineMs")}`);
      break;
    case CLAIM_STATE.DISCUSSION:
      pending.push(`round one reached no quorum; the jury is debating in public (${debateTurns(world).length} turns so far); discussion deadline ${deadline("discussionDeadlineMs")}`);
      break;
    default:
      pending.push(`state ${STATE_LABELS[state] ?? state}; the jury has not been seated for a round yet`);
  }
  return { status: "IN_PROGRESS", pending };
}

function summarize(checks: AuditCheck[]): AuditResult["summary"] {
  const empty = (): AuditSummaryCounts => ({ passed: 0, failed: 0, unavailable: 0, skipped: 0 });
  const byGroup = Object.fromEntries(GROUPS.map((group) => [group, empty()])) as Record<AuditGroup, AuditSummaryCounts>;
  const total = empty();
  for (const entry of checks) {
    const bucket = byGroup[entry.group];
    const key = entry.status === "PASS" ? "passed" : entry.status === "FAIL" ? "failed" : entry.status === "UNAVAILABLE" ? "unavailable" : "skipped";
    bucket[key] += 1;
    total[key] += 1;
  }
  return { ...total, byGroup };
}

function allChecks(result: Pick<AuditResult, "votes" | "runs" | "claimChecks">): AuditCheck[] {
  return [...result.votes.flatMap((vote) => vote.checks), ...result.runs.flatMap((run) => run.checks), ...result.claimChecks];
}

function provesSentence(result: Pick<AuditResult, "status" | "summary" | "votes" | "runs" | "verdict">): string {
  const finalPhase = result.verdict.finalPhase ?? 1;
  const passing = (vote: VoteAudit) => vote.checks.every((entry) => entry.status === "PASS");
  const counted = result.votes.filter((vote) => vote.phase === finalPhase && passing(vote)).length;
  const earlier = result.votes.filter((vote) => vote.phase !== finalPhase && passing(vote)).length;
  const runsOk = result.runs.filter((run) => run.revealed && run.checks.every((entry) => entry.status === "PASS" || entry.status === "SKIPPED")).length;
  if (result.status !== "FINALIZED") {
    return `This claim is not settled (${result.status.toLowerCase().replace("_", " ")}); the checks above cover only the record that exists so far.`;
  }
  if (result.summary.failed > 0) {
    return `${result.summary.failed} check(s) FAILED: the public record does not fully support this certificate; read the failing rows before trusting the result.`;
  }
  const unavailable = result.summary.unavailable > 0 ? ` (${result.summary.unavailable} check(s) could not be completed because a source was unavailable)` : "";
  const roundOne = earlier > 0 ? ` (plus ${earlier} round-one reveal(s) that fed the debate)` : "";
  return `Every reachable check passed: ${counted} counted vote(s)${roundOne} were committed on Sui before any reveal and recompute from the revealed inputs, ${runsOk} juror run(s) bind their prompt, input, output and evidence root, and the certificate on Sui carries the ${result.verdict.result} result with the recomputed score${unavailable}.`;
}

/**
 * Audit one claim from public sources only.
 * Throws AuditInputError when there is nothing to audit; every other failure
 * is reported inside the result as UNAVAILABLE checks.
 */
/** One row of the public board (GET {base}/api/claims). */
export type BoardRow = {
  claimId: string;
  link: string;
  state: number;
  stateLabel: string;
  statement: string;
  result?: string;
  truthScoreBps?: number;
  attempt?: string;
};

/**
 * List the claims the observer publishes, newest first, for "show me all the
 * verdicts": one line per claim with its state, result, score and attempt.
 */
export async function listBoard(
  base: string,
  options: { fetch: typeof fetch; limit?: number },
): Promise<BoardRow[]> {
  const url = `${normalizeBase(base)}/api/claims?limit=${options.limit ?? 50}`;
  const response = await options.fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new AuditInputError(`board request failed: HTTP ${response.status} (${url})`);
  const body = (await response.json()) as unknown;
  // The observer may ignore the limit, so it is applied here as well.
  const claims = (isRecord(body) ? asArray(body.claims) : []).slice(0, options.limit ?? 50);
  return claims.filter(isRecord).map((claim) => {
    const claimId = asString(claim.claimId) ?? "";
    const state = asNumber(claim.state) ?? -1;
    const result = isRecord(claim.result) ? claim.result : undefined;
    const chain = isRecord(claim.attemptChain) ? claim.attemptChain : undefined;
    const attempt = chain
      ? `${asNumber(chain.attempt) ?? "?"} of ${asNumber(chain.maxAttempts) ?? "?"} ${asString(chain.status) ?? ""}`.trim()
      : undefined;
    return {
      claimId,
      link: claimLink(normalizeBase(base), claimId),
      state,
      stateLabel: STATE_LABELS[state] ?? `state ${state}`,
      statement: asString(claim.statement) ?? "",
      ...(result && asString(result.result) ? { result: asString(result.result) } : {}),
      ...(result && asNumber(result.truthScoreBps) !== undefined
        ? { truthScoreBps: asNumber(result.truthScoreBps) }
        : {}),
      ...(attempt ? { attempt } : {}),
    };
  });
}

/** Markdown table of the board, the shape the skill presents before auditing. */
export function renderBoard(rows: BoardRow[]): string {
  const header = [
    "| # | Claim | State | Result | Attempt | Statement |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const lines = rows.map((row, index) => {
    const score = row.truthScoreBps === undefined ? "" : ` ${bpsToPercent(row.truthScoreBps)}`;
    const result = row.result ? `${row.result}${score}` : "-";
    const statement = row.statement.replace(/\|/g, "\\|").slice(0, 90);
    return `| ${index + 1} | ${shortHex(row.claimId)} | ${row.stateLabel} | ${result} | ${row.attempt ?? "-"} | ${statement} |`;
  });
  const links = rows.map((row, index) => `- ${index + 1}: ${row.claimId} ${row.link}`);
  return [
    `# OpenVerdict board (${rows.length} claims, newest first)`,
    "",
    ...header,
    ...lines,
    "",
    "Full ids and links:",
    ...links,
    "",
  ].join("\n");
}

export async function auditClaim(target: AuditTarget, options: AuditOptions): Promise<AuditResult> {
  const net = new Net(options);
  const now = (options.now ?? Date.now)();

  const world = await gatherSources(target, options, net);
  net.log("recomputing commitments, run hashes and the score");
  const votes = auditVotes(world);
  const runs = await auditRuns(world);
  const score = buildScore(world);
  const claimChecks = auditClaimChecks(world, score, votes, runs);
  const { status, pending } = classify(world);
  const timeline = buildTimeline(world);
  const inspection = world.inspection;
  const chain = inspection.attemptChain;
  const result = recordedResult(world) ?? null;
  const certificateObject = world.certificate?.ok ? parseObjectFields(world.certificate.result) : undefined;
  const summary = summarize(allChecks({ votes, runs, claimChecks }));
  const twoRound = isTwoRound(world);

  const audit: AuditResult = {
    version: 1,
    generatedAt: isoTime(now),
    target,
    status,
    claim: {
      claimId: world.claimId,
      link: claimLink(world.base, world.claimId),
      statement: inspection.statement,
      resolutionCriteria: inspection.resolutionCriteria,
      mode: inspection.mode === 1 ? "DIRECT_REVIEW" : inspection.mode === 2 ? "OPTIMISTIC_SETTLEMENT" : `mode ${inspection.mode}`,
      state: inspection.state,
      stateLabel: STATE_LABELS[inspection.state] ?? `state ${inspection.state}`,
      deadlines: { ...inspection.deadlines },
      twoRound,
      ...(chain
        ? {
            attempt: {
              attempt: chain.attempt,
              maxAttempts: chain.maxAttempts,
              status: chain.status,
              verificationId: chain.verificationId,
              ...(chain.relaunchedAs ? { relaunchedAs: chain.relaunchedAs, relaunchLink: claimLink(world.base, chain.relaunchedAs) } : {}),
              ...(chain.gaveUpReason ? { gaveUpReason: chain.gaveUpReason } : {}),
              ...(chain.void ? { void: { ...chain.void } } : {}),
              previousAttempts: chain.previousAttempts.map((attempt) => ({ ...attempt })),
            },
          }
        : {}),
      pending,
    },
    verdict: {
      result,
      truthScoreBps: score.certificateBps,
      ...(world.certificateId ? { certificateId: world.certificateId } : {}),
      ...(inspection.result?.digest ? { certificateTx: inspection.result.digest } : {}),
      ...(result ? { finalPhase: finalPhaseOf(world) } : {}),
      label: result ?? (status === "IN_PROGRESS" ? "PENDING" : status),
      proves: "",
    },
    jury: world.jurors,
    votes,
    runs,
    claimChecks,
    timeline: timeline.entries,
    timelineSource: timeline.source,
    ...(twoRound
      ? {
          debate: {
            turns: debateTurns(world),
            convergedAfterExchange: inspection.debateConvergedAfterExchange ?? null,
            ...(world.rootsByPhase.get(2) ? { phaseTwoRoot: world.rootsByPhase.get(2) } : {}),
            tableVotePromptHash: tableVotePromptSpecHash(),
          },
        }
      : {}),
    score,
    ...(world.certificateId
      ? {
          certificate: {
            objectId: world.certificateId,
            fields: certificateObject ? { ...certificateObject.fields } : {},
            ...(inspection.result?.digest ?? certificateObject?.previousTransaction
              ? { transactionDigest: inspection.result?.digest ?? certificateObject?.previousTransaction }
              : {}),
            objectLink: suivisionObject(world.certificateId),
            ...(inspection.result?.digest ? { transactionLink: suiscanTx(inspection.result.digest) } : {}),
          },
        }
      : {}),
    urls: [...net.urls],
    sources: {
      inspection,
      report: world.report,
      agents: world.agents,
      events: world.events,
      proofs: Object.fromEntries(world.seats.filter((seat) => seat.proof).map((seat) => [seat.runId, seat.proof])),
      transactions: Object.fromEntries(
        world.seats.flatMap((seat) => [
          ...(seat.commitTx && seat.commitTxData?.ok ? [[seat.commitTx, seat.commitTxData.result] as const] : []),
          ...(seat.revealTx && seat.revealTxData?.ok ? [[seat.revealTx, seat.revealTxData.result] as const] : []),
        ]),
      ),
      objects: Object.fromEntries([
        ...(world.certificateId && world.certificate?.ok ? [[world.certificateId, world.certificate.result] as const] : []),
        ...world.seats.flatMap((seat) => (seat.revealedVoteId && seat.revealedVote?.ok ? [[seat.revealedVoteId, seat.revealedVote.result] as const] : [])),
      ]),
      receipts: Object.fromEntries([...world.receipts.entries()].filter(([, outcome]) => outcome.ok).map(([id, outcome]) => [id, outcome.ok ? outcome.body : null])),
      manifests: Object.fromEntries([...world.manifestsByPhase.entries()].map(([phase, manifest]) => [`phase-${phase}`, manifest.body ?? { blobId: manifest.blobId, reason: manifest.reason }])),
      walrus: Object.fromEntries([...world.walrus.entries()].map(([blobId, outcome]) => [blobId, outcome.ok ? { status: outcome.status } : { status: outcome.status, reason: outcome.reason }])),
      failures: net.failures,
    },
    summary,
    exitCode: summary.failed > 0 ? 1 : 0,
  };
  if (world.eventsReason && world.events.length > 0) {
    audit.sources.failures.push({ source: "events", url: `${world.base}/api/claims/${world.claimId}/events`, reason: `stream stopped early: ${world.eventsReason}` });
  }
  audit.verdict.proves = provesSentence(audit);
  return audit;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export type RenderOptions = {
  /** Where the JSON dump was written, for the Data section. */
  jsonPath?: string;
  /** Put this run first with its full table; list the others briefly. */
  runId?: string;
};

function cell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: Array<Array<string | number | undefined | null>>): string {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

function checkRows(checks: AuditCheck[]): string {
  return table(
    ["Check", "Label", "Expected", "Actual", "Result", "Note"],
    checks.map((entry) => [
      entry.id,
      entry.label,
      shortValue(entry.expected),
      shortValue(entry.actual),
      entry.status,
      [entry.detail, entry.url && entry.status !== "PASS" ? `check by hand: ${entry.url}` : undefined].filter(Boolean).join("; ") || undefined,
    ]),
  );
}

/** Shorten every 0x hash inside a free-text cell. */
function shortValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/0x[0-9a-fA-F]{12,}/g, (hex) => shortHex(hex));
}

function groupLine(summary: AuditResult["summary"]): string {
  return GROUPS.filter((group) => {
    const counts = summary.byGroup[group];
    return counts.passed + counts.failed + counts.unavailable + counts.skipped > 0;
  })
    .map((group) => {
      const counts = summary.byGroup[group];
      return `${group} ${counts.passed}/${counts.failed}/${counts.unavailable}/${counts.skipped}`;
    })
    .join(", ");
}

function statusWord(status: AuditStatus | undefined): string {
  return status === "PASS" ? "MATCH" : status === "FAIL" ? "MISMATCH" : status === "UNAVAILABLE" ? "UNAVAILABLE" : "SKIPPED";
}

/** The verdict card alone (the --quiet output). */
export function renderVerdictCard(result: AuditResult): string {
  const { claim, verdict, summary } = result;
  const lines: string[] = [`# OpenVerdict audit: ${claim.statement}`, "", "## Verdict card"];
  const attempt = claim.attempt
    ? `attempt ${claim.attempt.attempt} of ${claim.attempt.maxAttempts} (${claim.attempt.status})`
    : "single attempt";
  lines.push(`- Claim id: ${claim.claimId}, link ${claim.link}, state ${claim.stateLabel}, mode ${claim.mode}, ${attempt}`);
  if (result.status === "FINALIZED") {
    lines.push(
      `- Result: ${verdict.result ?? "-"}, truth score ${bpsToPercent(verdict.truthScoreBps)} (${verdict.truthScoreBps ?? "-"} bps), certificate ${verdict.certificateId ?? "-"}${verdict.certificateId ? ` (${suivisionObject(verdict.certificateId)})` : ""}${verdict.finalPhase === 2 ? ", settled in round two after the cascade" : ""}`,
    );
  } else {
    lines.push(`- Result: ${verdict.label} (no certificate yet)`);
  }
  // Degraded mode belongs beside the verdict, not only in the check table.
  const jury = result.sources.inspection.jury;
  if (jury?.degraded) {
    lines.push(
      `- Jury: ${jury.familyCount} model families (degraded mode), registry required ${jury.requiredFamilies} at the draw`,
    );
  }
  for (const line of claim.pending) lines.push(`- Status: ${line}`);
  if (claim.attempt) {
    for (const previous of claim.attempt.previousAttempts) {
      lines.push(`- Earlier attempt ${previous.attempt}: ${previous.status}${previous.voidReason ? ` (${previous.voidReason})` : ""}, ${claimLink(result.target.base, previous.claimId)}`);
    }
    if (claim.attempt.relaunchLink) lines.push(`- Relaunched as: ${claim.attempt.relaunchLink} (audit that link for the live attempt)`);
  }
  lines.push(`- Checks: passed ${summary.passed}, failed ${summary.failed}, unavailable ${summary.unavailable}, skipped ${summary.skipped}`);
  lines.push(`- Per group (passed/failed/unavailable/skipped): ${groupLine(summary) || "none"}`);
  lines.push(`- ${verdict.proves}`);
  return lines.join("\n");
}

function renderTimeline(result: AuditResult): string {
  if (result.timeline.length === 0) return "No event history was available.";
  const note = result.timelineSource === "record" ? "Rebuilt from the record and the chain (the event stream was unavailable).\n\n" : "";
  return (
    note +
    table(
      ["Time (UTC)", "Event", "Detail", "Transaction"],
      result.timeline.map((entry) => [entry.at, entry.event, entry.detail, entry.transactionDigest ? shortHex(entry.transactionDigest) : "-"]),
    )
  );
}

function renderJury(result: AuditResult): string {
  const rows = result.jury.map((juror) => {
    const vote = (phase: ClaimPhase) => {
      const entry = result.votes.find((item) => item.agentProfileId === juror.agentProfileId && item.phase === phase);
      if (!entry) return juror.seats[phase] ? "-" : "n/a";
      if (!entry.committed) return entry.failureStatus ? `failed (${entry.failureStatus})` : "not committed";
      if (!entry.revealed) return "committed, not revealed";
      const reveal = entry.reveal ?? (entry.reported ? { outcome: entry.reported.outcome, confidenceBps: entry.reported.confidenceBps } : undefined);
      return reveal ? `${outcomeLabel(reveal.outcome)} ${reveal.confidenceBps} bps` : "revealed";
    };
    const commitment = result.votes
      .filter((item) => item.agentProfileId === juror.agentProfileId)
      .map((item) => statusWord(item.checks.find((entry) => entry.id === "C2")?.status))
      .join(" / ");
    const runSummary = result.runs
      .filter((item) => item.agentProfileId === juror.agentProfileId)
      .map((item) => {
        const counts = summarize(item.checks.filter((entry) => entry.group === "runs" || entry.group === "chain"));
        return `${counts.passed} pass, ${counts.failed} fail${counts.unavailable ? `, ${counts.unavailable} unavailable` : ""}${counts.skipped ? `, ${counts.skipped} skipped` : ""}`;
      })
      .join(" / ");
    const receipt = result.runs
      .filter((item) => item.agentProfileId === juror.agentProfileId)
      .map((item) => item.checks.find((entry) => entry.id === "R17")?.status ?? "SKIPPED")
      .join(" / ");
    return [
      juror.jurorIndex,
      juror.modelId ?? "-",
      juror.role ?? "-",
      vote(1),
      result.claim.twoRound ? vote(2) : "n/a",
      commitment || "-",
      runSummary || "-",
      receipt || "-",
    ];
  });
  return table(["Juror", "Model", "Role", "Round 1 vote", "Round 2 vote", "Commitment check", "Run checks", "Receipt"], rows);
}

function renderVotes(result: AuditResult): string {
  const blocks: string[] = [];
  for (const vote of result.votes) {
    const c2 = vote.checks.find((entry) => entry.id === "C2");
    blocks.push(`### Juror ${vote.jurorIndex}, phase ${vote.phase}: ${statusWord(c2?.status)}`);
    const facts = [
      `- Seat ${vote.jurySeatId}, agent ${vote.agentProfileId}${vote.modelId ? `, model ${vote.modelId}` : ""}`,
      `- Commitment (record): ${vote.commitment ?? "-"}; on chain: ${vote.onChainCommitment ?? "-"}`,
      `- Commit tx: ${vote.commitTx ? `${vote.commitTx} (${suiscanTx(vote.commitTx)})` : "-"}`,
      `- Reveal tx: ${vote.revealTx ? `${vote.revealTx} (${suiscanTx(vote.revealTx)})` : "-"}`,
      `- Recomputed commitment: ${vote.recomputedCommitment ?? "-"}`,
    ];
    if (vote.preimage) {
      facts.push(`- Preimage: ${Object.entries(vote.preimage).map(([key, value]) => `${key} ${typeof value === "string" ? shortHex(value) : value}`).join(", ")}`);
    }
    blocks.push(facts.join("\n"));
    blocks.push(checkRows(vote.checks));
  }
  return blocks.join("\n\n") || "No seats were found for this claim.";
}

function renderRun(run: RunAudit, full: boolean): string {
  const title = `### Juror ${run.jurorIndex}, phase ${run.phase}, run ${shortHex(run.runId)}${run.kind === "table-vote" ? " (table vote)" : ""}`;
  const counts = summarize(run.checks);
  if (!full) {
    return `${title}\n- ${run.revealed ? `${run.vote ? `${run.vote.outcome} ${run.vote.confidenceBps} bps, ` : ""}run hash ${shortHex(run.hashes.runHash)}` : run.failure ? `failed closed (${run.failure.status})` : "not revealed"}; checks passed ${counts.passed}, failed ${counts.failed}, unavailable ${counts.unavailable}, skipped ${counts.skipped}`;
  }
  const lines = [title, `- Run id: ${run.runId}${run.modelId ? `, model ${run.modelId}` : ""}${run.role ? `, role ${run.role}` : ""}${run.bundleVersion ? `, bundle v${run.bundleVersion}` : ""}`];
  if (run.failure) lines.push(`- Failed closed: ${run.failure.status}${run.failure.message ? ` (${run.failure.message})` : ""}`);
  if (run.vote) lines.push(`- Vote: ${run.vote.outcome} ${run.vote.confidenceBps} bps`);
  lines.push(
    `- Prompt hash ${run.hashes.promptHash ?? "-"}`,
    `- Input hash ${run.hashes.inputHash ?? "-"}; output hash ${run.hashes.outputHash ?? "-"}; run hash ${run.hashes.runHash ?? "-"}`,
    `- Evidence root ${run.hashes.evidenceRoot ?? "-"}${run.hashes.toolTranscriptHash ? `; tool transcript hash ${run.hashes.toolTranscriptHash}` : ""}`,
  );
  if (run.gateway?.requestId) {
    lines.push(`- Gateway request ${run.gateway.requestId}, devshard ${run.gateway.devshardId ?? "-"}, served model ${run.gateway.servedModel ?? "-"}${run.window ? `, ran ${isoTime(run.window.requestedAtMs)} to ${isoTime(run.window.completedAtMs)}` : ""}`);
  }
  if (run.receipt) {
    const receipt = run.receipt as Receipt & { total_tokens?: number; duration_ms?: number };
    lines.push(`- Receipt: model ${receipt.model ?? "-"}, devshard ${receipt.x_devshard_id ?? "-"}, created ${receipt.created_at ?? "-"}, outcome ${receipt.outcome ?? "-"} (${receipt.status_code ?? "-"}), tokens ${receipt.total_tokens ?? "-"}, duration ${receipt.duration_ms ?? "-"} ms; ${run.receiptUrl ?? ""}`);
  } else if (run.receiptUrl) {
    lines.push(`- Receipt: not confirmed; ${run.receiptUrl}`);
  }
  if (run.blobUrl) lines.push(`- ${run.revealedBlobId ? "Revealed" : "Sealed"} blob: ${run.blobUrl}`);
  for (const citation of run.citations) lines.push(`- Cites ${citation.url}: "${citation.quote.replace(/\s+/g, " ").slice(0, 200)}"`);
  lines.push("", checkRows(run.checks));
  return lines.join("\n");
}

function renderRuns(result: AuditResult, options: RenderOptions): string {
  const highlighted = options.runId ?? result.target.runId;
  const runs = [...result.runs].sort((left, right) => {
    if (highlighted) {
      if (left.runId === highlighted) return -1;
      if (right.runId === highlighted) return 1;
    }
    return left.phase - right.phase || left.jurorIndex - right.jurorIndex;
  });
  if (runs.length === 0) return "No juror runs exist yet.";
  const blocks: string[] = [];
  if (highlighted && !runs.some((run) => run.runId === highlighted)) {
    blocks.push(`Run ${highlighted} is not one of this claim's runs; all runs are listed in full.`);
  }
  for (const run of runs) blocks.push(renderRun(run, highlighted === undefined || run.runId === highlighted || !runs.some((entry) => entry.runId === highlighted)));
  return blocks.join("\n\n");
}

function renderDebate(result: AuditResult): string {
  const debate = result.debate;
  if (!debate) return "";
  const lines = ["## Debate and round two", ""];
  if (debate.turns.length === 0) {
    lines.push("No debate turns were recorded.");
  } else {
    lines.push(
      table(
        ["Ordinal", "Exchange", "Juror", "Answers", "Model", "Stance", "Confidence", "Status", "Argument", "Citations"],
        debate.turns.map((turn) => [
          turn.ordinal,
          turn.exchange,
          turn.jurorIndex || "-",
          turn.answering === undefined
            ? "-"
            // From V4 on a seat number is the juror number; older rows are 0-based.
            : turn.specVersion === undefined
              ? `seat ${turn.answering}`
              : `juror ${turn.answering}`,
          turn.modelId ?? "-",
          turn.stance ?? "-",
          turn.confidenceBps === undefined ? "-" : `${turn.confidenceBps} bps`,
          turn.status,
          turn.argument.replace(/\s+/g, " ").slice(0, 160) + (turn.argument.length > 160 ? "…" : ""),
          turn.citations,
        ]),
      ),
    );
  }
  lines.push("");
  const v4 = debate.turns.some((turn) => turn.specVersion !== undefined);
  lines.push(
    v4
      ? "- Seat numbers: from deliberation spec V4 on, a seat number is the juror number (seat 1 is juror 1)."
      : "- Seat numbers: a V1 to V3 transcript numbers seats from 0, so juror n holds seat n minus one.",
  );
  const questions = debate.turns.filter((turn) => turn.question !== undefined);
  if (questions.length > 0) {
    lines.push("");
    lines.push("Questions put to a named seat:");
    for (const turn of questions) {
      const asker = turn.jurorIndex > 0 ? `Juror ${turn.jurorIndex}` : "An unknown juror";
      lines.push(`- ${asker} asked juror ${turn.question?.seat}: ${turn.question?.text}`);
    }
    lines.push("");
  }
  lines.push(`- Convergence: ${debate.convergedAfterExchange === null ? "the debate did not converge early" : `converged after exchange ${debate.convergedAfterExchange}`}`);
  lines.push(`- Phase-two evidence root: ${debate.phaseTwoRoot ?? "-"}`);
  lines.push(`- Pinned table-vote prompt hash: ${debate.tableVotePromptHash}`);
  const checks = result.claimChecks.filter((entry) => entry.group === "debate");
  if (checks.length > 0) lines.push("", checkRows(checks));
  return lines.join("\n");
}

function renderScore(result: AuditResult): string {
  const { score } = result;
  const lines = [`Formula: ${score.formula || "-"}`, ""];
  if (score.terms.length === 0) {
    lines.push("No final-round reveal to score yet.");
  } else {
    lines.push(
      table(
        ["Juror", "Seat", "Vote", "Confidence", "Mapped probability", "Counted"],
        score.terms.map((term) => [term.jurorIndex || "-", shortHex(term.jurySeatId), term.outcome, `${term.confidenceBps} bps`, `${term.probabilityBps} bps`, term.valid ? "yes" : "no (invalid reveal)"]),
      ),
      "",
      `- Sum ${score.sumBps} bps over ${score.count} counted reveal(s); mean ${score.meanBps ?? "-"} bps = ${bpsToPercent(score.meanBps)} (rounded half-up)`,
      `- Certificate: ${score.certificateBps ?? "-"} bps; report: ${score.reportBps ?? "-"} bps; result ${result.verdict.result ?? "pending"}`,
    );
  }
  const checks = result.claimChecks.filter((entry) => entry.group === "score");
  if (checks.length > 0) lines.push("", checkRows(checks));
  return lines.join("\n");
}

function renderCertificate(result: AuditResult): string {
  const certificate = result.certificate;
  const checks = result.claimChecks.filter((entry) => entry.group === "chain" || entry.group === "walrus");
  if (!certificate) {
    return ["No certificate exists for this claim yet.", checks.length > 0 ? `\n${checkRows(checks)}` : ""].join("\n");
  }
  const fields = Object.entries(certificate.fields)
    .filter(([key]) => key !== "id")
    .map(([key, value]) => `- ${key}: ${formatField(value)}`);
  const lines = [
    `- Object id: ${certificate.objectId} (${certificate.objectLink})`,
    `- Transaction: ${certificate.transactionDigest ?? "-"}${certificate.transactionLink ? ` (${certificate.transactionLink})` : ""}`,
    ...(fields.length > 0 ? ["- Fields on chain:", ...fields.map((line) => `  ${line}`)] : ["- Fields on chain: not fetched"]),
  ];
  if (checks.length > 0) lines.push("", checkRows(checks));
  return lines.join("\n");
}

function formatField(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number")) return hexFromRpcValue(value) ?? "-";
    return value.map((item) => formatField(item)).join(", ");
  }
  if (isRecord(value)) {
    const unwrapped = unwrapOption(value);
    return unwrapped === value ? JSON.stringify(value) : formatField(unwrapped);
  }
  return value === undefined || value === null ? "none" : String(value);
}

function renderProves(result: AuditResult): string {
  const counted = result.votes.filter((vote) => vote.revealed && vote.phase === (result.verdict.finalPhase ?? 1)).length;
  const runsBound = result.runs.filter((run) => run.revealed && run.checks.some((entry) => entry.id === "R13" && entry.status === "PASS")).length;
  const receipts = result.runs.filter((run) => run.checks.some((entry) => entry.id === "R17" && entry.status === "PASS")).length;
  const receiptsUnavailable = result.runs.filter((run) => run.checks.some((entry) => entry.id === "R17" && entry.status === "UNAVAILABLE")).length;
  const votesOk = result.votes.filter((vote) => vote.revealed && ["C1", "C2"].every((id) => vote.checks.find((entry) => entry.id === id)?.status === "PASS")).length;
  const scoreOk = result.claimChecks.find((entry) => entry.id === "S1")?.status === "PASS";
  const certificateOk = result.claimChecks.find((entry) => entry.id === "S2")?.status === "PASS";
  const lines = [
    "This audit proves, from public data only:",
    `- (a) every counted vote was committed on Sui as a hash before any reveal, and the hash recomputes from the revealed vote, so no vote was changed after the fact: ${votesOk} of ${counted} counted vote(s) recomputed here.`,
    `- (b) each juror run is bound to its prompt, input, output, tool transcript and evidence root by the run hash the chain approved before the vote: ${runsBound} run hash(es) recomputed here.`,
    `- (c) the provider's own receipt confirms the model and shard for each run: ${receipts} receipt(s) confirmed${receiptsUnavailable > 0 ? `, ${receiptsUnavailable} unavailable` : ""}.`,
    `- (d) the score is plain arithmetic over the reveals: ${scoreOk ? `${result.score.meanBps ?? "-"} bps recomputed from ${result.score.count} reveal(s)` : "not confirmed by this run"}.`,
    `- (e) the certificate on Sui carries that result: ${certificateOk ? `${result.verdict.result} with ${result.verdict.truthScoreBps ?? "-"} bps at ${shortHex(result.verdict.certificateId)}` : "not confirmed by this run"}.`,
    "",
    "It does not prove:",
    "- that the model's reasoning is correct; that is what the evidence trail and the sealed research are for, read them;",
    "- that the web sources are true;",
    "- that the operator could not have withheld a claim from the jury; a withheld claim simply has no certificate.",
    "A re-run of a juror is a separate live check on the app's verify page and depends on GonkaRouter availability.",
  ];
  return lines.join("\n");
}

/** The full dossier, with the fixed headings the skill reads. */
export function renderMarkdown(result: AuditResult, options: RenderOptions = {}): string {
  const sections = [
    renderVerdictCard(result),
    "## Timeline",
    renderTimeline(result),
    "## Jury",
    renderJury(result),
    "## Votes and commitments",
    renderVotes(result),
    "## Juror runs",
    renderRuns(result, options),
  ];
  if (result.debate) sections.push(renderDebate(result));
  sections.push(
    "## Truth score",
    renderScore(result),
    "## Certificate on Sui",
    renderCertificate(result),
    "## What this audit proves and what it does not",
    renderProves(result),
    "## Data",
    [
      `- JSON dump: ${options.jsonPath ?? "not written (pass --json <file>)"}`,
      `- Generated ${result.generatedAt}`,
      ...(result.sources.failures.length > 0 ? ["- Sources that failed:", ...result.sources.failures.map((failure) => `  - ${failure.source}: ${failure.reason} (${failure.url})`)] : []),
      "- API URLs used:",
      ...result.urls.map((url) => `  - ${url}`),
    ].join("\n"),
  );
  return `${sections.join("\n\n")}\n`;
}

export function renderJson(result: AuditResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

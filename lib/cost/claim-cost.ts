/**
 * What one verification costs, measured from public data only.
 *
 * Same discipline as `lib/audit/audit-claim.ts`: no database, no keys, no
 * private endpoints. Everything here comes from four public places.
 *
 *  - the public API on app.openverdict.info (the claim record, the run proofs);
 *  - Sui JSON-RPC (gas used by every transaction, the claim object, the Walrus
 *    Blob objects and the register and certify transactions that created them);
 *  - the Walrus SDK's `storageCost` helper, which reads the live system object
 *    for the price per storage unit and the shard count;
 *  - the run bundles themselves, which carry every model attempt and every
 *    research step of every seat.
 *
 * No price is written into this file. Without `--sui-usd` and friends the tool
 * reports native units (MIST, FROST, tokens, credits) and nothing else.
 */
import {
  DEFAULT_BASE,
  DEFAULT_RPC_URLS,
  auditClaim,
  listBoard,
  type AuditTarget,
} from "../audit/audit-claim";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** publicnode answers 403 to Node's default user agent, same as the auditor. */
const USER_AGENT = "Mozilla/5.0 (OpenVerdict cost)";
const DEFAULT_TIMEOUT_MS = 30_000;
/** One page of `suix_queryTransactionBlocks`; 50 is the public node ceiling. */
const TX_PAGE = 50;
/** One page of `suix_getOwnedObjects`. */
const OBJECT_PAGE = 50;
/** Guard against an unbounded sweep of an address with a huge history. */
const MAX_TX_PAGES = 400;

/** Firecrawl's published credit table (firecrawl.dev/pricing, read 2026-09-05). */
export const FIRECRAWL_CREDITS_PER_SEARCH = 2;
export const FIRECRAWL_CREDITS_PER_OPEN = 1;

/** 1 SUI is 1e9 MIST; 1 WAL is 1e9 FROST. */
export const MIST_PER_SUI = 1_000_000_000;
export const FROST_PER_WAL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The steps a reader recognises on the claim page, in lifecycle order. */
export type GasGroup =
  | "creation"
  | "committee"
  | "evidence"
  | "run-approval"
  | "vote-commit"
  | "phase"
  | "reveal"
  | "finalize"
  | "walrus-register"
  | "walrus-certify"
  | "other";

export const GAS_GROUP_ORDER: readonly GasGroup[] = [
  "creation",
  "committee",
  "evidence",
  "run-approval",
  "vote-commit",
  "phase",
  "reveal",
  "finalize",
  "walrus-register",
  "walrus-certify",
  "other",
];

/** Plain-English label for each group, used by the table. */
export const GAS_GROUP_LABEL: Record<GasGroup, string> = {
  creation: "Claim creation",
  committee: "Committee draw",
  evidence: "Evidence freeze",
  "run-approval": "Run approval, one per seat",
  "vote-commit": "Vote commitment, one per seat",
  phase: "Phase change",
  reveal: "Vote reveal, one per seat",
  finalize: "Finalize and certificate",
  "walrus-register": "Walrus register, one per blob",
  "walrus-certify": "Walrus certify, one per blob",
  other: "Other protocol transactions",
};

/** One transaction's gas, as Sui reports it. */
export type GasEntry = {
  digest: string;
  group: GasGroup;
  event: string;
  atMs?: number;
  computationCost: number;
  storageCost: number;
  storageRebate: number;
  nonRefundableStorageFee: number;
  /** computation + storage - rebate, what the sender actually paid. */
  netMist: number;
  /** WAL spent by the sender in this transaction, in FROST (Walrus writes). */
  walFrost: number;
};

/** Gas for one group, summed. */
export type GasGroupTotal = {
  group: GasGroup;
  label: string;
  transactions: number;
  netMist: number;
  walFrost: number;
};

/** What one model family was asked to do, across every attempt of every seat. */
export type ModelUsage = {
  modelId: string;
  /** Every call the engine made, accepted or not. */
  calls: number;
  /** Calls that returned a usage record; the rest were provider errors. */
  billedCalls: number;
  inputTokens: number;
  outputTokens: number;
};

/** Search and page-open work, counted from the sealed transcripts. */
export type ResearchUsage = {
  searches: number;
  cachedSearches: number;
  opens: number;
  cachedOpens: number;
  failedOpens: number;
  /** Searches and opens that actually reached Firecrawl. */
  billedSearches: number;
  billedOpens: number;
  credits: number;
};

/** Why a blob exists. Each kind is one `walrus.put` in the engine. */
export type BlobKind =
  | "claim-statement"
  | "resolution-criteria"
  | "evidence-artifact"
  | "evidence-manifest"
  | "sealed-run-bundle"
  | "revealed-run-bundle"
  | "opened-page";

export const BLOB_KIND_LABEL: Record<BlobKind, string> = {
  "claim-statement": "Claim statement",
  "resolution-criteria": "Resolution criteria",
  "evidence-artifact": "Evidence artifact, raw and canonical",
  "evidence-manifest": "Evidence manifest",
  "sealed-run-bundle": "Sealed run bundle, one per seat",
  "revealed-run-bundle": "Revealed run bundle, one per seat",
  "opened-page": "Opened page, canonical text",
};

/** One blob the claim wrote, before the chain is consulted. */
export type BlobRef = {
  kind: BlobKind;
  blobId: string;
  /** Present when the claim record names the Sui object the write created. */
  objectId?: string;
};

/** One blob after the chain and the Walrus SDK have been consulted. */
export type BlobCost = BlobRef & {
  /** Unencoded bytes, from the Blob object or the aggregator. */
  size?: number;
  /** Reserved encoded bytes, from the Blob object's Storage resource. */
  encodedSize?: number;
  startEpoch?: number;
  endEpoch?: number;
  /** What the SDK says the write should have cost, in FROST. */
  quotedStorageFrost?: number;
  quotedWriteFrost?: number;
  /** What the register transaction actually debited, in FROST. */
  paidFrost?: number;
  registerDigest?: string;
  certifyDigest?: string;
  registerNetMist?: number;
  certifyNetMist?: number;
  /** Set when the Blob object could not be found from public data. */
  unresolved?: string;
};

/** Everything measured for one claim, in native units. */
export type ClaimCostMeasurement = {
  claimId: string;
  link: string;
  statement: string;
  state: number;
  stateLabel: string;
  attempt?: number;
  attemptStatus?: string;
  result: string | null;
  truthScoreBps: number | null;
  startedAtMs?: number;
  settledAtMs?: number;
  seats: number;
  /** Committee budget escrowed at creation, in MIST, from the claim object. */
  creationBudgetMist?: number;
  gas: GasEntry[];
  gasByGroup: GasGroupTotal[];
  protocolGasMist: number;
  walrusGasMist: number;
  totalGasMist: number;
  blobs: BlobCost[];
  walPaidFrost: number;
  walQuotedFrost: number;
  models: ModelUsage[];
  research: ResearchUsage;
  /** Anything public data could not answer, one line each. */
  notes: string[];
};

/** Prices, all optional; without them the report stays in native units. */
export type CostRates = {
  suiUsd?: number;
  walUsd?: number;
  /** USD per million tokens, by model id, with "*" as the fallback. */
  gonkaUsdPerMillionTokens?: Record<string, number>;
  firecrawlUsdPerCredit?: number;
};

/** One priced line of the table. */
export type CostLine = {
  component: string;
  pays: string;
  quantity: string;
  unitPrice: string;
  nativeCost: string;
  usd?: number;
};

/** Native totals converted to USD, where a rate was supplied. */
export type CostUsd = {
  gas?: number;
  walrus?: number;
  inference?: number;
  research?: number;
  total?: number;
};

// ---------------------------------------------------------------------------
// Pure arithmetic
// ---------------------------------------------------------------------------

/** Which lifecycle step a timeline event belongs to. */
export function gasGroupForEvent(event: string): GasGroup {
  switch (event) {
    case "claim_created":
      return "creation";
    case "committee_selected":
      return "committee";
    case "evidence_frozen":
      return "evidence";
    case "run_approved":
      return "run-approval";
    case "vote_committed":
      return "vote-commit";
    case "phase_changed":
      return "phase";
    case "vote_revealed":
      return "reveal";
    case "claim_finalized":
    case "claim_voided":
      return "finalize";
    default:
      return "other";
  }
}

/** What the sender paid: computation plus storage, less the storage rebate. */
export function netGasMist(gasUsed: {
  computationCost: string | number;
  storageCost: string | number;
  storageRebate: string | number;
}): number {
  return (
    Number(gasUsed.computationCost) +
    Number(gasUsed.storageCost) -
    Number(gasUsed.storageRebate)
  );
}

/** Gas grouped by lifecycle step, in the order the page prints them. */
export function summariseGas(entries: readonly GasEntry[]): GasGroupTotal[] {
  const totals = new Map<GasGroup, GasGroupTotal>();
  for (const entry of entries) {
    const current = totals.get(entry.group) ?? {
      group: entry.group,
      label: GAS_GROUP_LABEL[entry.group],
      transactions: 0,
      netMist: 0,
      walFrost: 0,
    };
    current.transactions += 1;
    current.netMist += entry.netMist;
    current.walFrost += entry.walFrost;
    totals.set(entry.group, current);
  }
  return GAS_GROUP_ORDER.flatMap((group) => {
    const total = totals.get(group);
    return total ? [total] : [];
  });
}

/** One attempt of one seat, as the run bundle records it. */
export type AttemptRecord = {
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Tokens by model across every attempt of every seat. A repair turn and a
 * failed hedge are model time the operator paid for, so both are counted; an
 * attempt that never reached a model reports no tokens and only raises the
 * call count.
 */
export function summariseModels(
  attempts: readonly AttemptRecord[],
): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  for (const attempt of attempts) {
    const modelId = attempt.modelId ?? "unknown";
    const usage = byModel.get(modelId) ?? {
      modelId,
      calls: 0,
      billedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    usage.calls += 1;
    const input = attempt.inputTokens;
    const output = attempt.outputTokens;
    if (typeof input === "number" || typeof output === "number") {
      usage.billedCalls += 1;
      usage.inputTokens += input ?? 0;
      usage.outputTokens += output ?? 0;
    }
    byModel.set(modelId, usage);
  }
  return [...byModel.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

/** One research step of one seat, as the sealed transcript records it. */
export type ResearchStep = {
  action?: "search" | "open" | string;
  /** True when the shared per-claim cache answered, so no provider call ran. */
  cached?: boolean;
  /** True when the step returned an error rather than a page. */
  failed?: boolean;
};

/**
 * Search and open counts. A step the per-claim cache answered cost nothing:
 * the first seat to ask paid for it and the other four read the same bytes.
 * A failed open returned no page, and Firecrawl's credit table charges per
 * page returned, so failures are counted apart and not billed.
 */
export function summariseResearch(steps: readonly ResearchStep[]): ResearchUsage {
  const usage: ResearchUsage = {
    searches: 0,
    cachedSearches: 0,
    opens: 0,
    cachedOpens: 0,
    failedOpens: 0,
    billedSearches: 0,
    billedOpens: 0,
    credits: 0,
  };
  for (const step of steps) {
    if (step.action === "search") {
      usage.searches += 1;
      if (step.cached === true) usage.cachedSearches += 1;
      else if (step.failed !== true) usage.billedSearches += 1;
      continue;
    }
    if (step.action !== "open") continue;
    usage.opens += 1;
    if (step.failed === true) usage.failedOpens += 1;
    else if (step.cached === true) usage.cachedOpens += 1;
    else usage.billedOpens += 1;
  }
  usage.credits =
    usage.billedSearches * FIRECRAWL_CREDITS_PER_SEARCH +
    usage.billedOpens * FIRECRAWL_CREDITS_PER_OPEN;
  return usage;
}

/** Tokens across every model, prompt and completion together. */
export function totalTokens(models: readonly ModelUsage[]): number {
  return models.reduce(
    (sum, model) => sum + model.inputTokens + model.outputTokens,
    0,
  );
}

/** USD for one model's tokens, or undefined when no rate covers it. */
export function modelUsd(
  model: ModelUsage,
  rates: CostRates,
): number | undefined {
  const table = rates.gonkaUsdPerMillionTokens;
  if (!table) return undefined;
  const price = table[model.modelId] ?? table["*"];
  if (price === undefined) return undefined;
  return ((model.inputTokens + model.outputTokens) / 1_000_000) * price;
}

/** The four component totals in USD, each present only if its rate was given. */
export function priceMeasurement(
  measurement: ClaimCostMeasurement,
  rates: CostRates,
): CostUsd {
  const usd: CostUsd = {};
  if (rates.suiUsd !== undefined) {
    usd.gas = (measurement.totalGasMist / MIST_PER_SUI) * rates.suiUsd;
  }
  if (rates.walUsd !== undefined) {
    usd.walrus = (measurement.walPaidFrost / FROST_PER_WAL) * rates.walUsd;
  }
  const inference = measurement.models.map((model) => modelUsd(model, rates));
  if (inference.length > 0 && inference.every((value) => value !== undefined)) {
    usd.inference = inference.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  if (rates.firecrawlUsdPerCredit !== undefined) {
    usd.research = measurement.research.credits * rates.firecrawlUsdPerCredit;
  }
  const parts = [usd.gas, usd.walrus, usd.inference, usd.research];
  if (parts.every((value) => value !== undefined)) {
    usd.total = parts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return usd;
}

/** Blobs grouped by kind, so the table has one line per kind. */
export function summariseBlobs(
  blobs: readonly BlobCost[],
): Array<{
  kind: BlobKind;
  label: string;
  count: number;
  bytes: number;
  paidFrost: number;
  quotedFrost: number;
  gasMist: number;
}> {
  const byKind = new Map<
    BlobKind,
    { kind: BlobKind; label: string; count: number; bytes: number; paidFrost: number; quotedFrost: number; gasMist: number }
  >();
  for (const blob of blobs) {
    const row = byKind.get(blob.kind) ?? {
      kind: blob.kind,
      label: BLOB_KIND_LABEL[blob.kind],
      count: 0,
      bytes: 0,
      paidFrost: 0,
      quotedFrost: 0,
      gasMist: 0,
    };
    row.count += 1;
    row.bytes += blob.size ?? 0;
    row.paidFrost += blob.paidFrost ?? 0;
    row.quotedFrost += (blob.quotedStorageFrost ?? 0) + (blob.quotedWriteFrost ?? 0);
    row.gasMist += (blob.registerNetMist ?? 0) + (blob.certifyNetMist ?? 0);
    byKind.set(blob.kind, row);
  }
  const order: BlobKind[] = [
    "claim-statement",
    "resolution-criteria",
    "evidence-artifact",
    "evidence-manifest",
    "opened-page",
    "sealed-run-bundle",
    "revealed-run-bundle",
  ];
  return order.flatMap((kind) => {
    const row = byKind.get(kind);
    return row ? [row] : [];
  });
}

// ---------------------------------------------------------------------------
// Reading the public record
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Every model attempt of every seat, from the run proofs in an audit result. */
export function attemptsFromProofs(
  proofs: Record<string, unknown>,
): AttemptRecord[] {
  const attempts: AttemptRecord[] = [];
  for (const proof of Object.values(proofs)) {
    if (!isRecord(proof)) continue;
    const bundle = isRecord(proof.bundle) ? proof.bundle : undefined;
    const list = Array.isArray(bundle?.attempts) ? bundle.attempts : [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const audit = isRecord(raw.audit) ? raw.audit : {};
      attempts.push({
        ...(asString(audit.modelId) === undefined
          ? {}
          : { modelId: asString(audit.modelId) as string }),
        ...(asNumber(audit.inputTokens) === undefined
          ? {}
          : { inputTokens: asNumber(audit.inputTokens) as number }),
        ...(asNumber(audit.outputTokens) === undefined
          ? {}
          : { outputTokens: asNumber(audit.outputTokens) as number }),
      });
    }
  }
  return attempts;
}

/** Every research step of every seat, from the sealed transcripts. */
export function stepsFromProofs(proofs: Record<string, unknown>): ResearchStep[] {
  const steps: ResearchStep[] = [];
  for (const proof of Object.values(proofs)) {
    if (!isRecord(proof)) continue;
    const bundle = isRecord(proof.bundle) ? proof.bundle : undefined;
    const transcript = isRecord(bundle?.transcript) ? bundle.transcript : undefined;
    const list = Array.isArray(transcript?.steps) ? transcript.steps : [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const action = isRecord(raw.action) ? asString(raw.action.action) : undefined;
      if (action !== "search" && action !== "open") continue;
      const result = isRecord(raw.result) ? raw.result : {};
      steps.push({
        action,
        ...(typeof result.cached === "boolean" ? { cached: result.cached } : {}),
        failed: result.tool === "error",
      });
    }
  }
  return steps;
}

/**
 * The parts of an audit result the blob inventory reads. Narrow on purpose,
 * so the inventory can be tested without building a whole audit.
 */
export type AuditResultLike = {
  runs: ReadonlyArray<{ sealedBlobId?: string; revealedBlobId?: string }>;
  sources: {
    manifests: Record<string, unknown>;
    report: unknown;
    proofs: Record<string, unknown>;
  };
};

/** Every blob the claim wrote, one entry per `walrus.put`. */
export function blobsFromAudit(
  audit: AuditResultLike,
  claimObject: { statementBlobId?: string; criteriaBlobId?: string },
): BlobRef[] {
  const blobs: BlobRef[] = [];
  if (claimObject.statementBlobId) {
    blobs.push({ kind: "claim-statement", blobId: claimObject.statementBlobId });
  }
  if (claimObject.criteriaBlobId) {
    blobs.push({ kind: "resolution-criteria", blobId: claimObject.criteriaBlobId });
  }

  // The evidence manifest of each phase, and the artifacts it hashes. The
  // engine writes an artifact twice, raw bytes then canonical text, so both
  // object ids are listed even when the two blobs hold identical bytes.
  for (const manifest of Object.values(audit.sources.manifests)) {
    if (!isRecord(manifest)) continue;
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const raw = asString(item.rawWalrusBlobId);
      const canonical = asString(item.canonicalWalrusBlobId);
      if (raw) {
        blobs.push({
          kind: "evidence-artifact",
          blobId: raw,
          ...(asString(item.rawWalrusObjectId) === undefined
            ? {}
            : { objectId: asString(item.rawWalrusObjectId) as string }),
        });
      }
      if (canonical) {
        blobs.push({
          kind: "evidence-artifact",
          blobId: canonical,
          ...(asString(item.canonicalWalrusObjectId) === undefined
            ? {}
            : { objectId: asString(item.canonicalWalrusObjectId) as string }),
        });
      }
    }
  }
  const report = isRecord(audit.sources.report) ? audit.sources.report : undefined;
  const bundle = isRecord(report?.auditBundle) ? report.auditBundle : undefined;
  const evidence = Array.isArray(bundle?.evidence) ? bundle.evidence : [];
  for (const entry of evidence) {
    if (!isRecord(entry)) continue;
    const manifestBlobId = asString(entry.manifestBlobId);
    if (manifestBlobId) {
      blobs.push({ kind: "evidence-manifest", blobId: manifestBlobId });
    }
  }

  // Per seat: the sealed bundle published before the commit and the plaintext
  // bundle published at the reveal.
  for (const run of audit.runs) {
    if (run.sealedBlobId) {
      blobs.push({ kind: "sealed-run-bundle", blobId: run.sealedBlobId });
    }
    if (run.revealedBlobId) {
      blobs.push({ kind: "revealed-run-bundle", blobId: run.revealedBlobId });
    }
  }

  // Pages the jury opened. The page store writes each distinct page once for
  // the whole claim, so the same page opened by five seats is one blob.
  const openedPages = new Set<string>();
  for (const proof of Object.values(audit.sources.proofs)) {
    if (!isRecord(proof)) continue;
    const runBundle = isRecord(proof.bundle) ? proof.bundle : undefined;
    const transcript = isRecord(runBundle?.transcript) ? runBundle.transcript : undefined;
    const opened = Array.isArray(transcript?.opened) ? transcript.opened : [];
    for (const page of opened) {
      if (!isRecord(page)) continue;
      const blobId = asString(page.canonicalWalrusBlobId);
      if (blobId) openedPages.add(blobId);
    }
  }
  for (const blobId of openedPages) {
    blobs.push({ kind: "opened-page", blobId });
  }
  return blobs;
}

// ---------------------------------------------------------------------------
// Sui JSON-RPC
// ---------------------------------------------------------------------------

export type RpcOptions = {
  fetch: typeof fetch;
  rpcUrl: string;
  timeoutMs?: number;
  log?: (line: string) => void;
};

/** One JSON-RPC call, with the public node's user agent requirement honoured. */
export async function rpc<T>(
  options: RpcOptions,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await options.fetch(options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const json = (await response.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "rpc error"}`);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

type SuiTransaction = {
  digest: string;
  timestampMs?: string;
  effects?: {
    gasUsed?: {
      computationCost: string;
      storageCost: string;
      storageRebate: string;
      nonRefundableStorageFee: string;
    };
  };
  balanceChanges?: Array<{
    owner?: { AddressOwner?: string };
    coinType?: string;
    amount?: string;
  }>;
  /** Present with `showInput`; the programmable block, commands and inputs. */
  transaction?: {
    data?: {
      sender?: string;
      transaction?: {
        inputs?: Array<{ type?: string; valueType?: string; value?: unknown }>;
        transactions?: unknown[];
      };
    };
  };
};

/**
 * WAL a Walrus register transaction spent, read from its own inputs.
 *
 * The public node returns balance changes for only a small fraction of the
 * requests that ask for them, but it always returns the programmable block.
 * The SDK splits the exact amounts it is about to spend, hands one to
 * `system::reserve_space` and the other to `system::register_blob`, and
 * destroys the zero remainders, so those two split amounts are the whole WAL
 * cost of the write and they are readable every time.
 */
export function walFromRegisterInputs(transaction: SuiTransaction): number | undefined {
  const block = transaction.transaction?.data?.transaction;
  const commands = block?.transactions;
  const inputs = block?.inputs;
  if (!Array.isArray(commands) || !Array.isArray(inputs)) return undefined;
  let total = 0;
  let found = false;
  for (const command of commands) {
    if (!isRecord(command)) continue;
    const call = isRecord(command.MoveCall) ? command.MoveCall : undefined;
    if (call?.module !== "system") continue;
    if (call.function !== "reserve_space" && call.function !== "register_blob") continue;
    const args = Array.isArray(call.arguments) ? call.arguments : [];
    for (const argument of args) {
      if (!isRecord(argument)) continue;
      const nested = argument.NestedResult;
      if (!Array.isArray(nested)) continue;
      const [commandIndex, resultIndex] = nested as [number, number];
      const source = commands[commandIndex];
      if (!isRecord(source)) continue;
      const split = source.SplitCoins;
      // A split of the gas coin pays the upload relay tip, never a Walrus
      // call, so only splits a Walrus command consumes are read here.
      if (!Array.isArray(split)) continue;
      const amounts = split[1];
      if (!Array.isArray(amounts)) continue;
      const amount = amounts[resultIndex];
      if (!isRecord(amount) || typeof amount.Input !== "number") continue;
      const value = asNumber(inputs[amount.Input]?.value);
      if (value === undefined) continue;
      total += value;
      found = true;
    }
  }
  return found ? total : undefined;
}

/** WAL spent by `address` in one transaction, in FROST, as a positive number. */
function walSpent(transaction: SuiTransaction, address?: string): number {
  let frost = 0;
  for (const change of transaction.balanceChanges ?? []) {
    if (!change.coinType?.endsWith("::wal::WAL")) continue;
    if (address && change.owner?.AddressOwner !== address) continue;
    const amount = Number(change.amount ?? 0);
    if (amount < 0) frost += -amount;
  }
  return frost;
}

/** Gas and WAL for a list of digests, in the order they were given. */
export async function fetchTransactionCosts(
  options: RpcOptions,
  digests: readonly string[],
): Promise<Map<string, { netMist: number; walFrost: number; atMs?: number; gasUsed: GasEntry }>> {
  const found = new Map<string, { netMist: number; walFrost: number; atMs?: number; gasUsed: GasEntry }>();
  for (let index = 0; index < digests.length; index += TX_PAGE) {
    const page = digests.slice(index, index + TX_PAGE);
    for (const transaction of await fetchTransactions(options, page)) {
      const gasUsed = transaction.effects?.gasUsed;
      if (!gasUsed) continue;
      const atMs = transaction.timestampMs === undefined ? undefined : Number(transaction.timestampMs);
      const entry: GasEntry = {
        digest: transaction.digest,
        group: "other",
        event: "",
        ...(atMs === undefined ? {} : { atMs }),
        computationCost: Number(gasUsed.computationCost),
        storageCost: Number(gasUsed.storageCost),
        storageRebate: Number(gasUsed.storageRebate),
        nonRefundableStorageFee: Number(gasUsed.nonRefundableStorageFee),
        netMist: netGasMist(gasUsed),
        walFrost: walSpent(transaction),
      };
      found.set(transaction.digest, {
        netMist: entry.netMist,
        walFrost: entry.walFrost,
        ...(atMs === undefined ? {} : { atMs }),
        gasUsed: entry,
      });
    }
  }
  return found;
}

/** The claim object's own fields: the two blob ids and the escrowed budget. */
export async function fetchClaimObject(
  options: RpcOptions,
  claimId: string,
): Promise<{ statementBlobId?: string; criteriaBlobId?: string; creationBudgetMist?: number }> {
  const object = await rpc<{ data?: { content?: { fields?: Record<string, unknown> } } }>(
    options,
    "sui_getObject",
    [claimId, { showContent: true }],
  );
  const fields = object.data?.content?.fields;
  if (!fields) return {};
  // Move stores the blob ids as ASCII byte vectors.
  const decode = (value: unknown): string | undefined => {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    return String.fromCharCode(...value.map((byte) => Number(byte)));
  };
  const statementBlobId = decode(fields.statement_blob_id);
  const criteriaBlobId = decode(fields.criteria_blob_id);
  const creationBudgetMist = asNumber(fields.creation_budget);
  return {
    ...(statementBlobId === undefined ? {} : { statementBlobId }),
    ...(criteriaBlobId === undefined ? {} : { criteriaBlobId }),
    ...(creationBudgetMist === undefined ? {} : { creationBudgetMist }),
  };
}

type SuiObject = {
  data?: {
    objectId: string;
    type?: string;
    owner?: { AddressOwner?: string };
    content?: { fields?: Record<string, unknown> };
  };
};

/** A Walrus Blob object, read straight from the chain. */
export type WalrusBlobObject = {
  objectId: string;
  blobIdInt: string;
  size: number;
  encodedSize: number;
  startEpoch: number;
  endEpoch: number;
  owner?: string;
  type?: string;
};

function parseBlobObject(object: SuiObject["data"]): WalrusBlobObject | undefined {
  const fields = object?.content?.fields;
  if (!object || !fields) return undefined;
  const storage = isRecord(fields.storage) ? fields.storage : undefined;
  const storageFields = isRecord(storage?.fields) ? storage.fields : undefined;
  const blobIdInt = asString(fields.blob_id);
  const size = asNumber(fields.size);
  const encodedSize = asNumber(storageFields?.storage_size);
  const startEpoch = asNumber(storageFields?.start_epoch);
  const endEpoch = asNumber(storageFields?.end_epoch);
  if (blobIdInt === undefined || size === undefined) return undefined;
  return {
    objectId: object.objectId,
    blobIdInt,
    size,
    encodedSize: encodedSize ?? 0,
    startEpoch: startEpoch ?? 0,
    endEpoch: endEpoch ?? 0,
    ...(object.owner?.AddressOwner === undefined ? {} : { owner: object.owner.AddressOwner }),
    ...(object.type === undefined ? {} : { type: object.type }),
  };
}

/** Read specific Sui objects, batched. */
export async function fetchBlobObjects(
  options: RpcOptions,
  objectIds: readonly string[],
): Promise<WalrusBlobObject[]> {
  const out: WalrusBlobObject[] = [];
  for (let index = 0; index < objectIds.length; index += OBJECT_PAGE) {
    const page = objectIds.slice(index, index + OBJECT_PAGE);
    const objects = await rpc<SuiObject[]>(options, "sui_multiGetObjects", [
      page,
      { showContent: true, showOwner: true, showType: true },
    ]);
    for (const object of objects) {
      const parsed = parseBlobObject(object.data);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/** Every Blob object one writer lane still owns. */
export async function fetchOwnedBlobObjects(
  options: RpcOptions,
  owner: string,
  blobType: string,
): Promise<WalrusBlobObject[]> {
  const out: WalrusBlobObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TX_PAGES; page += 1) {
    const result: { data: SuiObject[]; hasNextPage: boolean; nextCursor: string | null } =
      await rpc(options, "suix_getOwnedObjects", [
        owner,
        {
          filter: { StructType: blobType },
          options: { showContent: true, showOwner: true, showType: true },
        },
        cursor,
        OBJECT_PAGE,
      ]);
    for (const object of result.data) {
      const parsed = parseBlobObject(object.data);
      if (parsed) out.push(parsed);
    }
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

/** The register and certify transactions that created one Blob object. */
export async function fetchBlobTransactions(
  options: RpcOptions,
  objectId: string,
): Promise<SuiTransaction[]> {
  const result: { data: SuiTransaction[] } = await rpc(
    options,
    "suix_queryTransactionBlocks",
    [
      {
        filter: { ChangedObject: objectId },
        // showInput carries the WAL the write paid; see walFromRegisterInputs.
        options: { showEffects: true, showBalanceChanges: true, showInput: true },
      },
      null,
      10,
      false,
    ],
  );
  return result.data;
}

/** Every transaction one address sent, summed. Used for the whole-run total. */
export type AddressTotals = {
  address: string;
  transactions: number;
  netMist: number;
  walFrost: number;
  /** Transactions the public node has pruned, so their gas is not counted. */
  unreadable: number;
  firstAtMs?: number;
  lastAtMs?: number;
};

export async function sweepAddress(
  options: RpcOptions,
  address: string,
): Promise<AddressTotals> {
  const totals: AddressTotals = {
    address,
    transactions: 0,
    netMist: 0,
    walFrost: 0,
    unreadable: 0,
  };
  // Digests first, effects second. A public node refuses a page whose options
  // ask for balance changes when one transaction in it has empty effects, so
  // the two steps are kept apart and a single unreadable transaction is
  // skipped rather than losing the whole address.
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TX_PAGES; page += 1) {
    const result: { data: Array<{ digest: string }>; hasNextPage: boolean; nextCursor: string | null } =
      await rpc(options, "suix_queryTransactionBlocks", [
        { filter: { FromAddress: address }, options: {} },
        cursor,
        TX_PAGE,
        // Ascending, so the first page starts at the address's first transaction.
        false,
      ]);
    const digests = result.data.map((row) => row.digest);
    let readable = await fetchTransactions(options, digests);
    if (readable.length === 0 && digests.length > 0) {
      // The public endpoint is a pool and its members keep different history,
      // so one more ask often turns a whole empty page into a full one.
      readable = await fetchTransactions(options, digests);
    }
    // A public node prunes old transactions; those are counted, not guessed at.
    totals.unreadable += digests.length - readable.length;
    for (const transaction of readable) {
      const gasUsed = transaction.effects?.gasUsed;
      if (!gasUsed) continue;
      totals.transactions += 1;
      totals.netMist += netGasMist(gasUsed);
      totals.walFrost += walSpent(transaction, address);
      const atMs = transaction.timestampMs === undefined ? undefined : Number(transaction.timestampMs);
      if (atMs !== undefined) {
        totals.firstAtMs = totals.firstAtMs === undefined ? atMs : Math.min(totals.firstAtMs, atMs);
        totals.lastAtMs = totals.lastAtMs === undefined ? atMs : Math.max(totals.lastAtMs, atMs);
      }
    }
    options.log?.(`swept ${totals.transactions} transactions of ${address.slice(0, 10)}`);
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return totals;
}

/**
 * Effects for a batch of digests.
 *
 * A public node prunes old transactions and then refuses any page that asks
 * for balance changes, because it cannot derive them from empty effects. The
 * retry asks for effects alone, keeps the transactions that still have gas and
 * fetches balance changes for those, so one pruned transaction costs one extra
 * call rather than fifty.
 */
async function fetchTransactions(
  options: RpcOptions,
  digests: readonly string[],
): Promise<SuiTransaction[]> {
  if (digests.length === 0) return [];
  const multiGet = (batch: readonly string[], withBalances: boolean): Promise<SuiTransaction[]> =>
    rpc<SuiTransaction[]>(options, "sui_multiGetTransactionBlocks", [
      [...batch],
      { showEffects: true, ...(withBalances ? { showBalanceChanges: true } : {}) },
    ]);
  try {
    return await multiGet(digests, true);
  } catch {
    let shallow: SuiTransaction[];
    try {
      shallow = await multiGet(digests, false);
    } catch {
      return fetchTransactionsOneByOne(options, digests);
    }
    const readable = shallow.filter((transaction) => transaction.effects?.gasUsed);
    if (readable.length === 0) return [];
    try {
      return await multiGet(
        readable.map((transaction) => transaction.digest),
        true,
      );
    } catch {
      // Gas without the WAL column beats losing the transactions entirely.
      return readable;
    }
  }
}

/** Last resort, when even a batch of effects is refused. */
async function fetchTransactionsOneByOne(
  options: RpcOptions,
  digests: readonly string[],
): Promise<SuiTransaction[]> {
  const out: SuiTransaction[] = [];
  for (const digest of digests) {
    try {
      out.push(
        await rpc<SuiTransaction>(options, "sui_getTransactionBlock", [
          digest,
          { showEffects: true, showBalanceChanges: true },
        ]),
      );
    } catch {
      // One unreadable transaction must not cost the whole sweep.
      options.log?.(`skipped unreadable transaction ${digest}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Walrus prices
// ---------------------------------------------------------------------------

/** The live Walrus prices, read once per process from the system object. */
export type WalrusPrices = {
  shards: number;
  storagePricePerUnit: number;
  writePricePerUnit: number;
  epoch: number;
  epochDurationMs: number;
  /** Quote one blob of `size` bytes held for `epochs` epochs, in FROST. */
  quote: (size: number, epochs: number) => Promise<{ storageFrost: number; writeFrost: number }>;
  /**
   * The transaction that certified a blob, asked of the storage nodes
   * themselves. This is how a blob id leads back to the lane that paid for it
   * when the claim record does not name the Sui object.
   */
  certifyDigest: (blobId: string) => Promise<string | undefined>;
};

/**
 * The Walrus SDK's own cost helper, on the JSON-RPC transport. The encoded
 * size of a blob is not a number to compute by hand, so the SDK does it and
 * multiplies by the live price from the system object.
 */
export async function loadWalrusPrices(rpcUrl: string): Promise<WalrusPrices> {
  const [{ SuiJsonRpcClient }, { WalrusClient }] = await Promise.all([
    import("@mysten/sui/jsonRpc"),
    import("@mysten/walrus"),
  ]);
  const suiClient = new SuiJsonRpcClient({ url: rpcUrl, network: "testnet" });
  const client = new WalrusClient({ network: "testnet", suiClient });
  const [systemState, stakingState] = await Promise.all([
    client.systemState(),
    client.stakingState(),
  ]);
  return {
    shards: Number(systemState.committee.n_shards),
    storagePricePerUnit: Number(systemState.storage_price_per_unit_size),
    writePricePerUnit: Number(systemState.write_price_per_unit_size),
    epoch: Number(stakingState.epoch),
    epochDurationMs: Number(stakingState.epoch_duration),
    quote: async (size, epochs) => {
      const cost = await client.storageCost(size, epochs);
      return {
        storageFrost: Number(cost.storageCost),
        writeFrost: Number(cost.writeCost),
      };
    },
    certifyDigest: async (blobId) => {
      const status = await client.getVerifiedBlobStatus({ blobId });
      return status.type === "permanent" ? status.statusEvent.txDigest : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Measuring one claim
// ---------------------------------------------------------------------------

export type MeasureOptions = {
  fetch: typeof fetch;
  base?: string;
  rpcUrl?: string;
  /** Extra Walrus writer lanes, when the claim names none of its own. */
  lanes?: readonly string[];
  timeoutMs?: number;
  log?: (line: string) => void;
  /** Skips the Walrus SDK quote, for a fast run or an offline test. */
  skipWalrusQuote?: boolean;
};

/** Everything one claim cost, measured. */
export async function measureClaimCost(
  target: AuditTarget,
  options: MeasureOptions,
): Promise<ClaimCostMeasurement> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URLS[0] ?? "";
  const rpcOptions: RpcOptions = {
    fetch: options.fetch,
    rpcUrl,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.log === undefined ? {} : { log: options.log }),
  };
  const notes: string[] = [];

  options.log?.(`auditing ${target.claimId}`);
  const audit = await auditClaim(target, {
    fetch: options.fetch,
    rpcUrls: [rpcUrl],
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  // 1. The claim object: the two creation blobs and the escrowed budget.
  const claimObject = await fetchClaimObject(rpcOptions, audit.claim.claimId);

  // 2. Gas for every protocol transaction in the timeline.
  const timeline = audit.timeline.filter((entry) => entry.transactionDigest);
  const digests = [...new Set(timeline.map((entry) => entry.transactionDigest as string))];
  options.log?.(`reading gas for ${digests.length} protocol transactions`);
  const costs = await fetchTransactionCosts(rpcOptions, digests);
  const gas: GasEntry[] = [];
  for (const entry of timeline) {
    const digest = entry.transactionDigest as string;
    const cost = costs.get(digest);
    if (!cost) {
      notes.push(`transaction ${digest} was not readable from ${rpcUrl}`);
      continue;
    }
    gas.push({ ...cost.gasUsed, group: gasGroupForEvent(entry.event), event: entry.event });
  }

  // 3. Every blob the claim wrote, resolved to its Sui object.
  const blobRefs = blobsFromAudit(audit, claimObject);
  const blobs = await resolveBlobCosts(rpcOptions, blobRefs, {
    ...(options.lanes === undefined ? {} : { lanes: options.lanes }),
    windowStartMs: audit.timeline[0]?.atMs,
    windowEndMs: audit.timeline[audit.timeline.length - 1]?.atMs,
    ...(options.skipWalrusQuote === true ? { skipWalrus: true } : {}),
    ...(options.log === undefined ? {} : { log: options.log }),
    rpcUrl,
    notes,
  });
  for (const blob of blobs) {
    if (blob.registerDigest) {
      gas.push({
        digest: blob.registerDigest,
        group: "walrus-register",
        event: `walrus register ${blob.kind}`,
        computationCost: 0,
        storageCost: 0,
        storageRebate: 0,
        nonRefundableStorageFee: 0,
        netMist: blob.registerNetMist ?? 0,
        walFrost: blob.paidFrost ?? 0,
      });
    }
    if (blob.certifyDigest) {
      gas.push({
        digest: blob.certifyDigest,
        group: "walrus-certify",
        event: `walrus certify ${blob.kind}`,
        computationCost: 0,
        storageCost: 0,
        storageRebate: 0,
        nonRefundableStorageFee: 0,
        netMist: blob.certifyNetMist ?? 0,
        walFrost: 0,
      });
    }
  }

  // 4. Model attempts and research steps, from the sealed bundles.
  const models = summariseModels(attemptsFromProofs(audit.sources.proofs));
  const research = summariseResearch(stepsFromProofs(audit.sources.proofs));

  const gasByGroup = summariseGas(gas);
  const walrusGasMist = gasByGroup
    .filter((row) => row.group === "walrus-register" || row.group === "walrus-certify")
    .reduce((sum, row) => sum + row.netMist, 0);
  const totalGasMist = gas.reduce((sum, entry) => sum + entry.netMist, 0);

  return {
    claimId: audit.claim.claimId,
    link: audit.claim.link,
    statement: audit.claim.statement,
    state: audit.claim.state,
    stateLabel: audit.claim.stateLabel,
    ...(audit.claim.attempt === undefined
      ? {}
      : { attempt: audit.claim.attempt.attempt, attemptStatus: audit.claim.attempt.status }),
    result: audit.verdict.result,
    truthScoreBps: audit.verdict.truthScoreBps,
    ...(audit.timeline[0]?.atMs === undefined ? {} : { startedAtMs: audit.timeline[0].atMs }),
    ...(audit.timeline[audit.timeline.length - 1]?.atMs === undefined
      ? {}
      : { settledAtMs: audit.timeline[audit.timeline.length - 1]?.atMs as number }),
    seats: audit.runs.length,
    ...(claimObject.creationBudgetMist === undefined
      ? {}
      : { creationBudgetMist: claimObject.creationBudgetMist }),
    gas,
    gasByGroup,
    protocolGasMist: totalGasMist - walrusGasMist,
    walrusGasMist,
    totalGasMist,
    blobs,
    walPaidFrost: blobs.reduce((sum, blob) => sum + (blob.paidFrost ?? 0), 0),
    walQuotedFrost: blobs.reduce(
      (sum, blob) => sum + (blob.quotedStorageFrost ?? 0) + (blob.quotedWriteFrost ?? 0),
      0,
    ),
    models,
    research,
    notes,
  };
}

type ResolveOptions = {
  lanes?: readonly string[];
  windowStartMs?: number;
  windowEndMs?: number;
  skipWalrus?: boolean;
  log?: (line: string) => void;
  rpcUrl: string;
  notes: string[];
};

/** Writes start before claim creation and land shortly after the last event. */
const WINDOW_SLACK_BEFORE_MS = 10 * 60_000;
const WINDOW_SLACK_AFTER_MS = 5 * 60_000;
/** A deployment runs a handful of writer lanes; stop looking after this many. */
const MAX_LANE_LOOKUPS = 8;

/**
 * Turn a list of blob ids into measured costs.
 *
 * A Walrus write is two Sui transactions, register then certify, paid by one
 * of the operator's writer lanes. The claim record names the Sui object for
 * evidence artifacts only, so the other blobs are found by listing what each
 * lane owns. A blob whose lane is still unknown is looked up at the storage
 * nodes, whose certify transaction names the lane, and the next pass resolves
 * every other blob that lane wrote.
 */
async function resolveBlobCosts(
  rpcOptions: RpcOptions,
  refs: readonly BlobRef[],
  options: ResolveOptions,
): Promise<BlobCost[]> {
  // The chain stores a blob id as a u256; the SDK turns it back into the
  // base64url string the aggregator and the claim record use.
  const { blobIdFromInt } = await import("@mysten/walrus");
  const walrus = options.skipWalrus ? undefined : await loadWalrusPrices(options.rpcUrl);

  // The evidence artifacts name their objects, which names the first writer
  // lane and the exact Blob struct type, so no address is hardcoded here.
  const knownObjectIds = refs.flatMap((ref) => (ref.objectId ? [ref.objectId] : []));
  const seeded = knownObjectIds.length > 0 ? await fetchBlobObjects(rpcOptions, knownObjectIds) : [];
  const byBlobId = new Map<string, WalrusBlobObject[]>();
  const remember = (object: WalrusBlobObject): void => {
    const blobId = blobIdFromInt(BigInt(object.blobIdInt));
    const list = byBlobId.get(blobId) ?? [];
    if (list.some((known) => known.objectId === object.objectId)) return;
    list.push(object);
    byBlobId.set(blobId, list);
  };
  for (const object of seeded) remember(object);

  let blobType = seeded[0]?.type;
  const lanes = new Set<string>();
  const addLane = async (lane: string): Promise<void> => {
    if (lanes.has(lane) || !blobType) return;
    lanes.add(lane);
    options.log?.(`listing Walrus blobs owned by ${lane.slice(0, 10)}`);
    for (const object of await fetchOwnedBlobObjects(rpcOptions, lane, blobType)) remember(object);
  };
  for (const object of seeded) if (object.owner) await addLane(object.owner);
  for (const lane of options.lanes ?? []) await addLane(lane);

  // Any blob still without an object belongs to a lane nobody has named yet.
  const untraceable = new Set<string>();
  for (let lookup = 0; lookup < MAX_LANE_LOOKUPS; lookup += 1) {
    const missing = refs.find(
      (ref) => !untraceable.has(ref.blobId) && (byBlobId.get(ref.blobId) ?? []).length === 0,
    );
    if (!missing || !walrus) break;
    options.log?.(`asking Walrus which lane certified ${missing.blobId.slice(0, 10)}`);
    let lane: string | undefined;
    try {
      const digest = await walrus.certifyDigest(missing.blobId);
      lane = digest === undefined ? undefined : await fetchTransactionSender(rpcOptions, digest);
      if (lane && blobType === undefined) {
        // No evidence artifact named an object, so learn the type from this write.
        blobType = await fetchBlobTypeFromOwner(rpcOptions, lane);
      }
    } catch (error) {
      options.notes.push(
        `Walrus did not report a status for blob ${missing.blobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!lane || lanes.has(lane)) {
      options.notes.push(`blob ${missing.blobId} could not be traced to a writer lane`);
      untraceable.add(missing.blobId);
      continue;
    }
    await addLane(lane);
  }

  const inWindow = (atMs: number | undefined): boolean => {
    if (atMs === undefined) return true;
    const from =
      options.windowStartMs === undefined ? undefined : options.windowStartMs - WINDOW_SLACK_BEFORE_MS;
    const to =
      options.windowEndMs === undefined ? undefined : options.windowEndMs + WINDOW_SLACK_AFTER_MS;
    if (from !== undefined && atMs < from) return false;
    if (to !== undefined && atMs > to) return false;
    return true;
  };

  // One ChangedObject query per Blob object, cached: the same object is a
  // candidate for several refs when a claim writes the same bytes twice.
  const writes = new Map<string, { register?: SuiTransaction; certify?: SuiTransaction }>();
  const writesFor = async (
    objectId: string,
  ): Promise<{ register?: SuiTransaction; certify?: SuiTransaction }> => {
    const cached = writes.get(objectId);
    if (cached) return cached;
    const sorted = [...(await fetchBlobTransactions(rpcOptions, objectId))].sort(
      (a, b) => Number(a.timestampMs ?? 0) - Number(b.timestampMs ?? 0),
    );
    const found = {
      ...(sorted[0] === undefined ? {} : { register: sorted[0] }),
      ...(sorted[1] === undefined ? {} : { certify: sorted[1] }),
    };
    writes.set(objectId, found);
    return found;
  };

  const used = new Set<string>();
  const out: BlobCost[] = [];
  for (const ref of refs) {
    const cost: BlobCost = { ...ref };
    const candidates = (byBlobId.get(ref.blobId) ?? []).filter(
      (object) => !used.has(object.objectId),
    );
    // The claim record's own object id wins; otherwise take a write made while
    // this claim was running, so a page two claims opened is not double counted.
    let chosen = candidates.find((object) => object.objectId === ref.objectId);
    if (!chosen) {
      for (const candidate of candidates) {
        const write = await writesFor(candidate.objectId);
        const atMs =
          write.register?.timestampMs === undefined ? undefined : Number(write.register.timestampMs);
        if (inWindow(atMs)) {
          chosen = candidate;
          break;
        }
      }
    }
    if (!chosen && candidates.length > 0) {
      chosen = candidates[0];
      options.notes.push(
        `blob ${ref.blobId} was matched to a write made outside this claim's window`,
      );
    }
    if (!chosen) {
      cost.unresolved = "no Blob object found for this blob id";
      out.push(cost);
      continue;
    }
    used.add(chosen.objectId);
    cost.objectId = chosen.objectId;
    cost.size = chosen.size;
    cost.encodedSize = chosen.encodedSize;
    cost.startEpoch = chosen.startEpoch;
    cost.endEpoch = chosen.endEpoch;

    const write = await writesFor(chosen.objectId);
    const registerGas = write.register?.effects?.gasUsed;
    if (write.register && registerGas) {
      const register = write.register;
      cost.registerDigest = register.digest;
      cost.registerNetMist = netGasMist(registerGas);
      // The balance change is the plainer reading, so it wins when the node
      // returns one. It usually does not, and the split amounts inside the
      // transaction say the same thing.
      const fromBalances = walSpent(register);
      const fromInputs = walFromRegisterInputs(register);
      cost.paidFrost = fromBalances > 0 ? fromBalances : fromInputs ?? 0;
      if (fromBalances > 0 && fromInputs !== undefined && fromBalances !== fromInputs) {
        options.notes.push(
          `register transaction ${register.digest} split ${fromInputs} FROST but moved ${fromBalances} FROST`,
        );
      }
      if (cost.paidFrost === 0) {
        options.notes.push(`register transaction ${register.digest} reported no WAL spend`);
      }
    }
    if (write.certify?.effects?.gasUsed) {
      cost.certifyDigest = write.certify.digest;
      cost.certifyNetMist = netGasMist(write.certify.effects.gasUsed);
    }
    if (walrus && chosen.endEpoch > chosen.startEpoch) {
      const quote = await walrus.quote(chosen.size, chosen.endEpoch - chosen.startEpoch);
      cost.quotedStorageFrost = quote.storageFrost;
      cost.quotedWriteFrost = quote.writeFrost;
    }
    out.push(cost);
  }
  return out;
}

/** Who signed a transaction. */
async function fetchTransactionSender(
  rpcOptions: RpcOptions,
  digest: string,
): Promise<string | undefined> {
  const transaction = await rpc<{ transaction?: { data?: { sender?: string } } }>(
    rpcOptions,
    "sui_getTransactionBlock",
    [digest, { showInput: true }],
  );
  return transaction.transaction?.data?.sender;
}

/** The Blob struct type, learned from any Blob object a lane owns. */
async function fetchBlobTypeFromOwner(
  rpcOptions: RpcOptions,
  owner: string,
): Promise<string | undefined> {
  const result: { data: SuiObject[] } = await rpc(rpcOptions, "suix_getOwnedObjects", [
    owner,
    { options: { showType: true } },
    null,
    OBJECT_PAGE,
  ]);
  return result.data.find((object) => object.data?.type?.endsWith("::blob::Blob"))?.data?.type;
}

// ---------------------------------------------------------------------------
// The whole run
// ---------------------------------------------------------------------------

/** Every claim on the public board, and every address that paid for it. */
export type RunTotals = {
  generatedAt: string;
  claims: ClaimCostMeasurement[];
  addresses: AddressTotals[];
  operator: string;
  lanes: string[];
  agents: string[];
  totals: {
    transactions: number;
    netMist: number;
    walFrost: number;
    unreadable: number;
    firstAtMs?: number;
    lastAtMs?: number;
    inputTokens: number;
    outputTokens: number;
    credits: number;
    blobs: number;
    stakeMist: number;
  };
  notes: string[];
};

/** Board rows, newest first, straight from the public API. */
export async function boardTargets(
  base: string,
  options: MeasureOptions,
): Promise<AuditTarget[]> {
  const rows = await listBoard(base, { fetch: options.fetch, limit: 100 });
  return rows.map((row) => ({
    kind: "claim" as const,
    claimId: row.claimId,
    base,
    link: `${base}/claims/${row.claimId}`,
  }));
}

/** Agent seat owners and their stakes, from the public agents endpoint. */
export async function fetchAgentOwners(
  base: string,
  options: MeasureOptions,
): Promise<{ owners: string[]; stakeMist: number }> {
  const response = await options.fetch(`${base}/api/agents`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`agents: HTTP ${response.status}`);
  const json = (await response.json()) as { agents?: unknown[] };
  const owners = new Set<string>();
  let stakeMist = 0;
  for (const agent of json.agents ?? []) {
    if (!isRecord(agent)) continue;
    const owner = asString(agent.owner);
    if (owner) owners.add(owner);
    stakeMist += asNumber(agent.stakeMist) ?? 0;
  }
  return { owners: [...owners], stakeMist };
}

/**
 * What the whole production run has cost. Sums every transaction sent by the
 * operator, by the Walrus writer lanes and by the seat keys, plus the model
 * and research work of every attempt on the board.
 */
export async function measureRunTotals(options: MeasureOptions & { operator: string }): Promise<RunTotals> {
  const base = options.base ?? DEFAULT_BASE;
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URLS[0] ?? "";
  const rpcOptions: RpcOptions = {
    fetch: options.fetch,
    rpcUrl,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.log === undefined ? {} : { log: options.log }),
  };
  const notes: string[] = [];

  const targets = await boardTargets(base, options);
  const claims: ClaimCostMeasurement[] = [];
  for (const target of targets) {
    claims.push(await measureClaimCost(target, options));
  }

  // Lanes are whoever owns the Blob objects the claims wrote.
  const lanes = new Set<string>(options.lanes ?? []);
  const laneObjectIds = claims.flatMap((claim) =>
    claim.blobs.flatMap((blob) => (blob.objectId ? [blob.objectId] : [])),
  );
  for (const object of await fetchBlobObjects(rpcOptions, laneObjectIds.slice(0, 200))) {
    if (object.owner) lanes.add(object.owner);
  }

  const { owners, stakeMist } = await fetchAgentOwners(base, options);
  const addresses = [options.operator, ...lanes, ...owners];
  const totals: AddressTotals[] = [];
  for (const address of addresses) {
    totals.push(await sweepAddress(rpcOptions, address));
  }

  const summed = totals.reduce(
    (accumulator, entry) => ({
      transactions: accumulator.transactions + entry.transactions,
      netMist: accumulator.netMist + entry.netMist,
      walFrost: accumulator.walFrost + entry.walFrost,
      unreadable: accumulator.unreadable + entry.unreadable,
      firstAtMs:
        entry.firstAtMs === undefined
          ? accumulator.firstAtMs
          : Math.min(accumulator.firstAtMs ?? entry.firstAtMs, entry.firstAtMs),
      lastAtMs:
        entry.lastAtMs === undefined
          ? accumulator.lastAtMs
          : Math.max(accumulator.lastAtMs ?? entry.lastAtMs, entry.lastAtMs),
    }),
    { transactions: 0, netMist: 0, walFrost: 0, unreadable: 0 } as {
      transactions: number;
      netMist: number;
      walFrost: number;
      unreadable: number;
      firstAtMs?: number;
      lastAtMs?: number;
    },
  );

  if (summed.unreadable > 0) {
    notes.push(
      `${summed.unreadable} transactions were not returned by ${rpcUrl} and are not counted`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    claims,
    addresses: totals,
    operator: options.operator,
    lanes: [...lanes],
    agents: owners,
    totals: {
      ...summed,
      inputTokens: claims.reduce(
        (sum, claim) => sum + claim.models.reduce((n, model) => n + model.inputTokens, 0),
        0,
      ),
      outputTokens: claims.reduce(
        (sum, claim) => sum + claim.models.reduce((n, model) => n + model.outputTokens, 0),
        0,
      ),
      credits: claims.reduce((sum, claim) => sum + claim.research.credits, 0),
      blobs: claims.reduce((sum, claim) => sum + claim.blobs.length, 0),
      stakeMist,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Thousands separators, and at most `digits` decimals. */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A USD amount, with enough decimals to stay non-zero for small figures. */
export function formatUsd(value: number | undefined): string {
  if (value === undefined) return "";
  if (value === 0) return "$0";
  const digits = Math.abs(value) >= 0.01 ? 4 : 8;
  return `$${value.toFixed(digits)}`;
}

/** SUI from MIST, WAL from FROST. */
export function formatSui(mist: number): string {
  return `${(mist / MIST_PER_SUI).toFixed(6)} SUI`;
}

export function formatWal(frost: number): string {
  return `${(frost / FROST_PER_WAL).toFixed(6)} WAL`;
}

/** The Markdown table the documentation page prints, for one claim. */
export function renderClaimCost(
  measurement: ClaimCostMeasurement,
  rates: CostRates,
): string {
  const usd = priceMeasurement(measurement, rates);
  const lines: string[] = [];
  lines.push(`# Cost of ${measurement.claimId}`);
  lines.push("");
  lines.push(`- Statement: ${measurement.statement}`);
  lines.push(
    `- State: ${measurement.stateLabel}${
      measurement.result ? `, result ${measurement.result}` : ""
    }${measurement.attempt === undefined ? "" : `, attempt ${measurement.attempt} ${measurement.attemptStatus ?? ""}`.trimEnd()}`,
  );
  lines.push(`- Seats: ${measurement.seats}`);
  lines.push("");

  lines.push("## Sui gas");
  lines.push("");
  lines.push("| Step | Transactions | Gas (MIST) | Gas (SUI) |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of measurement.gasByGroup) {
    lines.push(
      `| ${row.label} | ${row.transactions} | ${formatNumber(row.netMist)} | ${formatSui(row.netMist)} |`,
    );
  }
  lines.push(
    `| **Total** | ${measurement.gas.length} | ${formatNumber(measurement.totalGasMist)} | ${formatSui(measurement.totalGasMist)} |`,
  );
  lines.push("");

  lines.push("## Walrus storage");
  lines.push("");
  lines.push("| Blob | Count | Bytes | Paid (FROST) | SDK quote (FROST) |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of summariseBlobs(measurement.blobs)) {
    lines.push(
      `| ${row.label} | ${row.count} | ${formatNumber(row.bytes)} | ${formatNumber(row.paidFrost)} | ${formatNumber(row.quotedFrost)} |`,
    );
  }
  lines.push(
    `| **Total** | ${measurement.blobs.length} | | ${formatNumber(measurement.walPaidFrost)} | ${formatNumber(measurement.walQuotedFrost)} |`,
  );
  lines.push("");

  lines.push("## GonkaRouter inference");
  lines.push("");
  lines.push("| Model | Calls | Priced calls | Prompt tokens | Completion tokens | USD |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const model of measurement.models) {
    lines.push(
      `| ${model.modelId} | ${model.calls} | ${model.billedCalls} | ${formatNumber(model.inputTokens)} | ${formatNumber(model.outputTokens)} | ${formatUsd(modelUsd(model, rates))} |`,
    );
  }
  lines.push(
    `| **Total** | ${measurement.models.reduce((n, m) => n + m.calls, 0)} | ${measurement.models.reduce((n, m) => n + m.billedCalls, 0)} | ${formatNumber(measurement.models.reduce((n, m) => n + m.inputTokens, 0))} | ${formatNumber(measurement.models.reduce((n, m) => n + m.outputTokens, 0))} | ${formatUsd(usd.inference)} |`,
  );
  lines.push("");

  lines.push("## Web research");
  lines.push("");
  lines.push("| Step | Total | Served from cache | Failed | Sent to Firecrawl | Credits |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  const research = measurement.research;
  lines.push(
    `| Search | ${research.searches} | ${research.cachedSearches} | 0 | ${research.billedSearches} | ${research.billedSearches * FIRECRAWL_CREDITS_PER_SEARCH} |`,
  );
  lines.push(
    `| Open | ${research.opens} | ${research.cachedOpens} | ${research.failedOpens} | ${research.billedOpens} | ${research.billedOpens * FIRECRAWL_CREDITS_PER_OPEN} |`,
  );
  lines.push(`| **Total** | | | | | ${research.credits} |`);
  lines.push("");

  lines.push("## One claim, all four components");
  lines.push("");
  lines.push("| Component | Native cost | USD |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Sui gas | ${formatSui(measurement.totalGasMist)} | ${formatUsd(usd.gas)} |`);
  lines.push(`| Walrus storage | ${formatWal(measurement.walPaidFrost)} | ${formatUsd(usd.walrus)} |`);
  lines.push(
    `| GonkaRouter inference | ${formatNumber(totalTokens(measurement.models))} tokens | ${formatUsd(usd.inference)} |`,
  );
  lines.push(
    `| Web research | ${research.credits} credits | ${formatUsd(usd.research)} |`,
  );
  lines.push(`| **Total** | | ${formatUsd(usd.total)} |`);
  lines.push("");

  if (measurement.notes.length > 0) {
    lines.push("## Not measurable from public data");
    lines.push("");
    for (const note of measurement.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** The whole-run table. */
export function renderRunTotals(totals: RunTotals, rates: CostRates): string {
  const lines: string[] = [];
  lines.push("# The whole production run");
  lines.push("");
  lines.push(
    `- Claims on the board ${totals.claims.length}, addresses swept ${totals.addresses.length}, transactions read ${formatNumber(totals.totals.transactions)}, pruned by the node ${formatNumber(totals.totals.unreadable)}`,
  );
  if (totals.totals.firstAtMs !== undefined && totals.totals.lastAtMs !== undefined) {
    lines.push(
      `- Range: ${new Date(totals.totals.firstAtMs).toISOString()} to ${new Date(totals.totals.lastAtMs).toISOString()}`,
    );
  }
  lines.push("");
  lines.push("| Item | Quantity | Native | USD |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| Sui gas, every address | ${formatNumber(totals.totals.transactions)} transactions | ${formatSui(totals.totals.netMist)} | ${formatUsd(rates.suiUsd === undefined ? undefined : (totals.totals.netMist / MIST_PER_SUI) * rates.suiUsd)} |`,
  );
  lines.push(
    `| Walrus storage | ${formatNumber(totals.totals.blobs)} blobs on the board | ${formatWal(totals.totals.walFrost)} | ${formatUsd(rates.walUsd === undefined ? undefined : (totals.totals.walFrost / FROST_PER_WAL) * rates.walUsd)} |`,
  );
  const tokens = totals.totals.inputTokens + totals.totals.outputTokens;
  const perMillion = rates.gonkaUsdPerMillionTokens?.["*"];
  lines.push(
    `| GonkaRouter inference | ${formatNumber(tokens)} tokens | ${formatNumber(tokens)} tokens | ${formatUsd(perMillion === undefined ? undefined : (tokens / 1_000_000) * perMillion)} |`,
  );
  lines.push(
    `| Web research | ${formatNumber(totals.totals.credits)} credits | ${formatNumber(totals.totals.credits)} credits | ${formatUsd(rates.firecrawlUsdPerCredit === undefined ? undefined : totals.totals.credits * rates.firecrawlUsdPerCredit)} |`,
  );
  lines.push(
    `| Seat stakes, refundable | ${totals.agents.length} seats | ${formatSui(totals.totals.stakeMist)} | ${formatUsd(rates.suiUsd === undefined ? undefined : (totals.totals.stakeMist / MIST_PER_SUI) * rates.suiUsd)} |`,
  );
  lines.push("");
  lines.push("| Address | Transactions | Pruned | Gas (SUI) | WAL | From | To |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const address of totals.addresses) {
    if (address.transactions === 0 && address.unreadable === 0) continue;
    lines.push(
      `| ${address.address} | ${formatNumber(address.transactions)} | ${formatNumber(address.unreadable)} | ${formatSui(address.netMist)} | ${formatWal(address.walFrost)} | ${address.firstAtMs === undefined ? "" : new Date(address.firstAtMs).toISOString()} | ${address.lastAtMs === undefined ? "" : new Date(address.lastAtMs).toISOString()} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * `--gonka-usd-per-mtoken 0.0012` prices every model the same, which is what
 * GonkaRouter publishes today; `model=price,model=price` prices them apart.
 */
export function parseModelPrices(raw: string): Record<string, number> {
  const table: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const split = trimmed.lastIndexOf("=");
    const key = split === -1 ? "*" : trimmed.slice(0, split).trim();
    const price = Number(split === -1 ? trimmed : trimmed.slice(split + 1).trim());
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`--gonka-usd-per-mtoken expects a price, got ${trimmed}`);
    }
    table[key === "" ? "*" : key] = price;
  }
  if (Object.keys(table).length === 0) {
    throw new Error("--gonka-usd-per-mtoken expects at least one price");
  }
  return table;
}

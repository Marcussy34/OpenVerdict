import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import type { TxResult } from "../engine/contract";
import type { OpenVerdictSuiClient } from "./client";

export interface ExecutedMoveEvent {
  packageId: string;
  module: string;
  eventType: string;
  sender: string;
  json: Record<string, unknown> | null;
}

export interface ExecutedTxResult extends TxResult {
  moveEvents: ExecutedMoveEvent[];
}

export class SuiTransactionExecutionError extends Error {
  override readonly name = "SuiTransactionExecutionError";
  readonly code = "SUI_TRANSACTION_FAILED" as const;
  readonly digest?: string;

  constructor(message: string, digest?: string) {
    super(message);
    this.digest = digest;
  }
}

// Rejections for a transaction built against an outdated owned-object version
// (usually a gas coin another transaction just spent from). Fullnodes and
// validators phrase it differently across releases; every wording names the
// object, so recovery can refetch it authoritatively.
const STALE_OBJECT_PATTERNS = [
  /Object ID (0x[0-9a-f]+) Version \S+ Digest \S+ is not available for consumption/i,
  /object (0x[0-9a-f]+) version \S+ \(\S+\) is unavailable for consumption/i,
  /needs to be rebuilt because object (0x[0-9a-f]+)/i,
  /provided version doesn't match for object (0x[0-9a-f]+)/i,
];
// Equivocation: another transaction from the same sender holds the object
// lock (usually the shared gas coin). "reserved" is the fullnode's wording
// while that tx is in flight; "already locked by a different transaction" is
// the validators' wording, seen right after our own Walrus certify tx when
// the fullnode's coin index still reports the version that tx consumed.
// Both clear once the other tx settles, so rebuild with fresh gas versions.
const RESERVED_OBJECT_PATTERN =
  /reserved for another transaction|already locked by a different transaction/i;

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // The gRPC transport delivers validator rejections percent-encoded
  // ("already%20locked%20by%20a%20different%20transaction"), which no
  // pattern above matched, so those never retried.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function staleObjectId(error: unknown): string | undefined {
  const text = errorText(error);
  for (const pattern of STALE_OBJECT_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

// The gas coin each sender last paid with. The fullnode's owned-object index
// (what gas selection reads) lags its object store by seconds under load, so
// a build right after our own transaction can pick the version that
// transaction consumed; pinning from getObject (authoritative) avoids it.
const gasCoinBySender = new Map<string, string>();

const SUI_COIN_TYPE = "0x2::sui::SUI";
/** Below this a coin is dust that would abort the first transaction to use it. */
const GAS_SLOT_MIN_BALANCE_MIST = 100_000_000n;

/**
 * Which of the sender's SUI coins this process pays with. The three workers
 * and the web run as separate processes on one operator key, so each pins a
 * distinct coin (start-production.mjs sets 0, 1, 2 and 3) and their
 * transactions never equivocate a shared one. Unset, or pointing past the
 * coins that exist, keeps the previous behaviour: the builder selects gas.
 * The slot applies to whichever key the process signs with; a Walrus writer
 * holds one coin, so it either pins that coin or falls through unchanged.
 */
function operatorGasSlot(): number | undefined {
  const raw = process.env.OPENVERDICT_OPERATOR_GAS_SLOT?.trim();
  if (!raw) return undefined;
  const slot = Number(raw);
  return Number.isInteger(slot) && slot >= 0 ? slot : undefined;
}

/**
 * The coin at this process's slot. Ordering has to agree across processes or
 * two of them would pin the same coin, so coins are sorted by object id, not
 * by balance or by whatever order the index returns.
 */
async function slotGasCoin(
  client: OpenVerdictSuiClient,
  sender: string,
): Promise<string | undefined> {
  const slot = operatorGasSlot();
  if (slot === undefined) return undefined;
  const listed = await client.core.listCoins({ owner: sender, coinType: SUI_COIN_TYPE });
  const pinnable = listed.objects
    .filter((coin) => BigInt(coin.balance) >= GAS_SLOT_MIN_BALANCE_MIST)
    .map((coin) => coin.objectId)
    .sort();
  return pinnable[slot];
}

async function pinKnownGas(
  client: OpenVerdictSuiClient,
  sender: string,
  transaction: Transaction,
): Promise<void> {
  if ((transaction.getData().gasData.payment ?? []).length > 0) return;
  let objectId = gasCoinBySender.get(sender);
  if (objectId === undefined) {
    // Nothing paid yet in this process: take the configured slot, so the very
    // first transaction already avoids the other processes' coins.
    try {
      objectId = await slotGasCoin(client, sender);
    } catch {
      return;
    }
    if (objectId === undefined) return;
    gasCoinBySender.set(sender, objectId);
  }
  try {
    const fresh = await client.core.getObject({ objectId, include: {} });
    transaction.setGasPayment([
      { objectId, version: fresh.object.version, digest: fresh.object.digest },
    ]);
  } catch {
    // The coin was merged or split away; let the builder select afresh.
    gasCoinBySender.delete(sender);
  }
}

/**
 * Wait until the owned-object index reports the sender's gas coin at its
 * current version, so the next build that selects gas from that index (the
 * Walrus SDK's register and certify transactions do) sees fresh state.
 */
export async function waitForGasIndex(
  client: OpenVerdictSuiClient,
  sender: string,
  timeoutMs = 6_000,
): Promise<void> {
  let objectId = gasCoinBySender.get(sender);
  if (objectId === undefined) {
    // Nothing built through executeAndWait yet in this process (a worker's
    // first operations are Walrus writes): learn the coin this process will
    // pay with, its configured slot when it has one, else the largest.
    try {
      objectId = await slotGasCoin(client, sender);
      if (objectId === undefined) {
        const listed = await client.core.listCoins({ owner: sender, coinType: SUI_COIN_TYPE });
        const largest = [...listed.objects].sort((a, b) =>
          BigInt(b.balance) > BigInt(a.balance) ? 1 : -1,
        )[0];
        if (largest === undefined) return;
        objectId = largest.objectId;
      }
      gasCoinBySender.set(sender, objectId);
    } catch {
      return;
    }
  }
  try {
    const fresh = await client.core.getObject({ objectId, include: {} });
    const target = BigInt(fresh.object.version);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const listed = await client.core.listCoins({ owner: sender, coinType: "0x2::sui::SUI" });
      const coin = listed.objects.find((entry) => entry.objectId === objectId);
      if (coin !== undefined && BigInt(coin.version) >= target) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch {
    // Best effort only; the retry path still repins on a stale rejection.
  }
}

/** Sign, execute, wait for indexing, and normalize the Sui v2 result union.
 * Multi-process stacks share sender gas coins (workers + web all sign as the
 * operator), so a build can race another process's spend and pin a stale gas
 * version. On that specific rejection, refetch the named coin's current
 * version from the fullnode, pin it as gas payment, and retry (bounded). */
export async function executeAndWait(
  client: OpenVerdictSuiClient,
  signer: Signer,
  transactionOrFactory: Transaction | (() => Transaction),
): Promise<ExecutedTxResult> {
  const sender = signer.toSuiAddress();
  const makeTransaction = (): Transaction => {
    const tx =
      typeof transactionOrFactory === "function"
        ? transactionOrFactory()
        : transactionOrFactory;
    // CLI 1.52 cannot decode SDK 2.26's simulation-only ValidDuring expiration.
    if (client.network === "localnet") tx.setGasBudgetIfNotSet(2_000_000_000);
    return tx;
  };
  let transaction = makeTransaction();
  await pinKnownGas(client, sender, transaction);
  let submitted: Awaited<ReturnType<Signer["signAndExecuteTransaction"]>>;
  for (let attempt = 1; ; attempt += 1) {
    try {
      submitted = await signer.signAndExecuteTransaction({ transaction, client });
      const paidWith = transaction.getData().gasData.payment?.[0]?.objectId;
      if (paidWith !== undefined) gasCoinBySender.set(sender, paidWith);
      break;
    } catch (error) {
      // Five seats finishing together approve five runs and write five
      // sealed bundles on one gas coin; the budget below rides out the burst.
      if (attempt >= 8) throw error;
      const staleId = staleObjectId(error);
      const reserved = RESERVED_OBJECT_PATTERN.test(errorText(error));
      if (!staleId && !reserved) throw error;
      // The prior build's resolved input/gas versions are baked into the
      // Transaction, so a retry MUST rebuild from scratch; a factory gives a
      // clean rebuild, a plain Transaction can only have its gas repinned.
      const priorGas = (transaction.getData().gasData.payment ?? []).map(
        (ref) => ref.objectId,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      transaction = makeTransaction();
      // Pin gas at its authoritative current version (coin listings can lag;
      // getObject does not). Never pin a stale NON-gas input as gas — a stale
      // EvidenceCap once ended up as "payment" that way and poisoned retries.
      const gasIds = reserved || (staleId && priorGas.includes(staleId)) ? priorGas : [];
      if (gasIds.length > 0) {
        const freshRefs = await Promise.all(
          gasIds.map(async (objectId) => {
            const fresh = await client.core.getObject({ objectId, include: {} });
            return {
              objectId,
              version: fresh.object.version,
              digest: fresh.object.digest,
            };
          }),
        );
        transaction.setGasPayment(freshRefs);
      }
    }
  }
  assertSuccessful(submitted);

  const settled = await client.core.waitForTransaction({
    result: submitted,
    include: { effects: true, events: true, objectTypes: true },
  });
  assertSuccessful(settled);

  const value = settled.Transaction;
  const objectIds = collectObjectIds(
    value.effects?.changedObjects ?? [],
    value.objectTypes ?? {},
  );
  return {
    digest: value.digest,
    ...(Object.keys(objectIds).length === 0 ? {} : { objectIds }),
    moveEvents: (value.events ?? []).map((event) => ({
      packageId: event.packageId,
      module: event.module,
      eventType: event.eventType,
      sender: event.sender,
      json: event.json,
    })),
  };
}

function assertSuccessful<Include extends object>(
  result:
    | { $kind: "Transaction"; Transaction: { digest: string } }
    | {
        $kind: "FailedTransaction";
        FailedTransaction: {
          digest: string;
          status: { error: { message: string } | null };
        };
      },
): asserts result is { $kind: "Transaction"; Transaction: { digest: string } } & Include {
  if (result.$kind === "FailedTransaction") {
    throw new SuiTransactionExecutionError(
      result.FailedTransaction.status.error?.message ?? "Sui transaction failed",
      result.FailedTransaction.digest,
    );
  }
}

interface ChangedObjectLike {
  objectId: string;
  idOperation: string;
  outputState: string;
}

function collectObjectIds(
  changedObjects: ChangedObjectLike[],
  objectTypes: Record<string, string>,
): Record<string, string> {
  const ids: Record<string, string> = {};
  const counts = new Map<string, number>();
  let createdIndex = 0;

  for (const object of changedObjects) {
    if (object.idOperation !== "Created") continue;
    ids[`created${createdIndex}`] = object.objectId;
    createdIndex += 1;
    const type = objectTypes[object.objectId];
    if (!type) continue;
    const name = objectName(type);
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    ids[count === 1 ? name : `${name}${count}`] = object.objectId;
  }
  return ids;
}

function objectName(type: string): string {
  const struct = (type.split("::").at(-1) ?? "object").split("<", 1)[0] ?? "object";
  return struct.charAt(0).toLowerCase() + struct.slice(1);
}

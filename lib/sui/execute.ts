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

// Validator rejection for a transaction built against an outdated owned-object
// version (usually a gas coin another process just spent from). The message
// names the exact object, so recovery can refetch it authoritatively.
const STALE_OBJECT_PATTERN =
  /Object ID (0x[0-9a-f]+) Version \S+ Digest \S+ is not available for consumption/i;
// Equivocation: another transaction from the same sender holds the object
// lock (usually the shared gas coin). "reserved" is the fullnode's wording
// while that tx is in flight; "already locked by a different transaction" is
// the validators' wording, seen right after our own Walrus certify tx when
// the fullnode's coin index still reports the version that tx consumed.
// Both clear once the other tx settles, so rebuild with fresh gas versions.
const RESERVED_OBJECT_PATTERN =
  /reserved for another transaction|already locked by a different transaction/i;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function staleObjectId(error: unknown): string | undefined {
  return STALE_OBJECT_PATTERN.exec(errorText(error))?.[1];
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
  let submitted: Awaited<ReturnType<Signer["signAndExecuteTransaction"]>>;
  for (let attempt = 1; ; attempt += 1) {
    try {
      submitted = await signer.signAndExecuteTransaction({ transaction, client });
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      const staleId = staleObjectId(error);
      const reserved = RESERVED_OBJECT_PATTERN.test(errorText(error));
      if (!staleId && !reserved) throw error;
      // The prior build's resolved input/gas versions are baked into the
      // Transaction, so a retry MUST rebuild from scratch; a factory gives a
      // clean rebuild, a plain Transaction can only have its gas repinned.
      const priorGas = (transaction.getData().gasData.payment ?? []).map(
        (ref) => ref.objectId,
      );
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
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

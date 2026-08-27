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

function staleObjectId(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_OBJECT_PATTERN.exec(message)?.[1];
}

/** Sign, execute, wait for indexing, and normalize the Sui v2 result union.
 * Multi-process stacks share sender gas coins (workers + web all sign as the
 * operator), so a build can race another process's spend and pin a stale gas
 * version. On that specific rejection, refetch the named coin's current
 * version from the fullnode, pin it as gas payment, and retry (bounded). */
export async function executeAndWait(
  client: OpenVerdictSuiClient,
  signer: Signer,
  transaction: Transaction,
): Promise<ExecutedTxResult> {
  // CLI 1.52 cannot decode SDK 2.26's simulation-only ValidDuring expiration.
  if (client.network === "localnet") {
    transaction.setGasBudgetIfNotSet(2_000_000_000);
  }
  let submitted: Awaited<ReturnType<Signer["signAndExecuteTransaction"]>>;
  for (let attempt = 1; ; attempt += 1) {
    try {
      submitted = await signer.signAndExecuteTransaction({ transaction, client });
      break;
    } catch (error) {
      const objectId = attempt < 4 ? staleObjectId(error) : undefined;
      if (!objectId) throw error;
      const fresh = await client.core.getObject({ objectId, include: {} });
      transaction.setGasPayment([
        {
          objectId,
          version: fresh.object.version,
          digest: fresh.object.digest,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
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

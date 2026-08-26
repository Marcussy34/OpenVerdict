import {
  assertValidWalrusBlobId,
  type WalrusStore,
} from "./store";

export interface WalrusStorageReference {
  blobId: string;
  objectId: string;
  endEpoch: number;
}

export type WalrusRetentionStatus = "CURRENT" | "RENEWAL_DUE" | "EXPIRED";

export interface WalrusRetentionEvaluation {
  status: WalrusRetentionStatus;
  remainingEpochs: number;
}

export interface WalrusRenewalRequest {
  blobId: string;
  objectId: string;
  targetEndEpoch: number;
}

export interface WalrusRenewalReceipt {
  endEpoch: number;
  transactionDigest?: string;
}

export type WalrusRenewalExecutor = (
  request: WalrusRenewalRequest,
) => Promise<WalrusRenewalReceipt>;

export interface RenewableWalrusStore extends WalrusStore {
  renew: WalrusRenewalExecutor;
}

export interface WalrusRenewalAlert {
  code: "WALRUS_RENEWAL_FAILED";
  blobId: string;
  objectId: string;
  previousEndEpoch: number;
  targetEndEpoch: number;
  occurredAt: number;
  detail: string;
}

export class WalrusRenewalError extends Error {
  override readonly name: string = "WalrusRenewalError";
  readonly code = "WALRUS_RENEWAL_FAILED" as const;
  readonly alert: WalrusRenewalAlert;

  constructor(alert: WalrusRenewalAlert, options?: ErrorOptions) {
    super(`Walrus renewal failed: ${alert.detail}`, options);
    this.alert = alert;
  }
}

export function serializeWalrusStorageReference(
  reference: WalrusStorageReference,
): string {
  validateReference(reference);
  return JSON.stringify({
    blobId: reference.blobId,
    objectId: reference.objectId,
    endEpoch: reference.endEpoch,
  });
}

export function parseWalrusStorageReference(
  serialized: string,
): WalrusStorageReference {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Walrus storage reference is not valid JSON", {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Walrus storage reference must be an object");
  }
  if (!("blobId" in value) || typeof value.blobId !== "string") {
    throw new Error("Walrus storage reference has an invalid blob ID");
  }
  if (!("objectId" in value) || typeof value.objectId !== "string") {
    throw new Error("Walrus storage reference has an invalid object ID");
  }
  if (!("endEpoch" in value) || typeof value.endEpoch !== "number") {
    throw new Error("Walrus storage reference has an invalid end epoch");
  }

  const reference = {
    blobId: value.blobId,
    objectId: value.objectId,
    endEpoch: value.endEpoch,
  };
  validateReference(reference);
  return reference;
}

export function evaluateWalrusRetention(
  reference: WalrusStorageReference,
  epochs: { currentEpoch: number; requiredThroughEpoch: number },
): WalrusRetentionEvaluation {
  validateReference(reference);
  assertValidWalrusEpoch(epochs.currentEpoch, "current epoch");
  assertValidWalrusEpoch(epochs.requiredThroughEpoch, "required epoch");
  const remainingEpochs = Math.max(0, reference.endEpoch - epochs.currentEpoch);

  if (epochs.currentEpoch >= reference.endEpoch) {
    return { status: "EXPIRED", remainingEpochs };
  }
  if (reference.endEpoch < epochs.requiredThroughEpoch) {
    return { status: "RENEWAL_DUE", remainingEpochs };
  }
  return { status: "CURRENT", remainingEpochs };
}

export async function renewWalrusRetention(options: {
  reference: WalrusStorageReference;
  targetEndEpoch: number;
  renew: WalrusRenewalExecutor;
  onFailure: (alert: WalrusRenewalAlert) => void | Promise<void>;
}): Promise<{
  reference: WalrusStorageReference;
  transactionDigest?: string;
}> {
  validateReference(options.reference);
  assertValidWalrusEpoch(options.targetEndEpoch, "target end epoch");
  if (options.targetEndEpoch <= options.reference.endEpoch) {
    throw new Error("target end epoch must extend the current retention period");
  }

  try {
    const receipt = await options.renew({
      blobId: options.reference.blobId,
      objectId: options.reference.objectId,
      targetEndEpoch: options.targetEndEpoch,
    });
    assertValidWalrusEpoch(receipt.endEpoch, "renewed end epoch");
    if (receipt.endEpoch < options.targetEndEpoch) {
      throw new RenewalResultError("renewal did not reach the requested end epoch");
    }
    const renewedReference = {
      ...options.reference,
      endEpoch: receipt.endEpoch,
    };
    return receipt.transactionDigest === undefined
      ? { reference: renewedReference }
      : {
          reference: renewedReference,
          transactionDigest: receipt.transactionDigest,
        };
  } catch (error) {
    const alert: WalrusRenewalAlert = {
      code: "WALRUS_RENEWAL_FAILED",
      blobId: options.reference.blobId,
      objectId: options.reference.objectId,
      previousEndEpoch: options.reference.endEpoch,
      targetEndEpoch: options.targetEndEpoch,
      occurredAt: Date.now(),
      detail:
        error instanceof RenewalResultError
          ? error.message
          : "renewal executor failed",
    };
    try {
      await options.onFailure(alert);
    } catch (alertError) {
      throw new WalrusRenewalError(alert, {
        cause: new AggregateError([error, alertError], "renewal and alerting failed"),
      });
    }
    throw new WalrusRenewalError(alert, { cause: error });
  }
}

class RenewalResultError extends Error {
  override readonly name: string = "RenewalResultError";
}

export function assertValidWalrusObjectId(objectId: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(objectId)) {
    throw new Error("Walrus object ID must be a 32-byte 0x-prefixed hex value");
  }
}

export function assertValidWalrusEpoch(epoch: number, label: string): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateReference(reference: WalrusStorageReference): void {
  assertValidWalrusBlobId(reference.blobId);
  assertValidWalrusObjectId(reference.objectId);
  assertValidWalrusEpoch(reference.endEpoch, "end epoch");
}

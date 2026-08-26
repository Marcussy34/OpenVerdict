export interface WalrusPutOptions {
  identifier?: string;
  tags?: Record<string, string>;
  epochs?: number;
  deletable?: boolean;
  owner?: string;
}

export interface WalrusPutResult {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
}

export interface WalrusStore {
  put(bytes: Uint8Array, opts?: WalrusPutOptions): Promise<WalrusPutResult>;
  get(blobId: string): Promise<Uint8Array>;
}

export class WalrusNotFoundError extends Error {
  override readonly name: string = "WalrusNotFoundError";
  readonly code = "WALRUS_NOT_FOUND" as const;
  readonly blobId: string;

  constructor(blobId: string, options?: ErrorOptions) {
    super(`Walrus blob not found: ${blobId}`, options);
    this.blobId = blobId;
  }
}

export class WalrusInvalidBlobIdError extends Error {
  override readonly name: string = "WalrusInvalidBlobIdError";
  readonly code = "WALRUS_INVALID_BLOB_ID" as const;
  readonly blobId: string;

  constructor(blobId: string) {
    super("Walrus blob ID must be an unpadded base64url 32-byte digest");
    this.blobId = blobId;
  }
}

/** Prevent path traversal locally and malformed IDs reaching the real client. */
export function assertValidWalrusBlobId(blobId: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(blobId)) {
    throw new WalrusInvalidBlobIdError(blobId);
  }
}

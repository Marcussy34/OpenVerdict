export interface WalrusPutOptions {
  /**
   * Honored only by backends that store per-file metadata. The real,
   * raw-blob-backed store and the local store carry no file metadata, so
   * they accept these for interface parity with callers but ignore them.
   */
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

/** Where the Walrus clock stands; needed to translate blob end epochs to Sui epochs. */
export type WalrusEpochInfo = { currentEpoch: number; epochDurationMs: number };

export interface WalrusStore {
  put(bytes: Uint8Array, opts?: WalrusPutOptions): Promise<WalrusPutResult>;
  get(blobId: string): Promise<Uint8Array>;
  /** Real stores report the Walrus epoch; local stores omit it (no retention clock). */
  epochInfo?(): Promise<WalrusEpochInfo>;
  /**
   * Content address of `bytes` exactly as `put` would report it, without
   * writing. Lets a caller hand out the blob id before the upload finishes.
   */
  blobIdFor?(bytes: Uint8Array): Promise<string>;
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

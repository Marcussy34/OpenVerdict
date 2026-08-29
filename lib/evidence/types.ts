export const RETRIEVAL_REJECTION_CODE = {
  INVALID_POLICY: "INVALID_POLICY",
  INVALID_URL: "INVALID_URL",
  UNSUPPORTED_SCHEME: "UNSUPPORTED_SCHEME",
  DISALLOWED_NETWORK_TARGET: "DISALLOWED_NETWORK_TARGET",
  DNS_RESOLUTION_FAILED: "DNS_RESOLUTION_FAILED",
  TIMEOUT: "TIMEOUT",
  REDIRECT_LOOP: "REDIRECT_LOOP",
  TOO_MANY_REDIRECTS: "TOO_MANY_REDIRECTS",
  INVALID_REDIRECT: "INVALID_REDIRECT",
  HTTP_ERROR: "HTTP_ERROR",
  SIZE_LIMIT_EXCEEDED: "SIZE_LIMIT_EXCEEDED",
  UNSUPPORTED_MIME_TYPE: "UNSUPPORTED_MIME_TYPE",
  RETRIEVAL_FAILED: "RETRIEVAL_FAILED",
} as const;

export type RetrievalRejectionCode =
  (typeof RETRIEVAL_REJECTION_CODE)[keyof typeof RETRIEVAL_REJECTION_CODE];

export interface RetrievalPolicy {
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  allowedMime: string[];
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type EvidenceResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface RetrievalDependencies {
  resolver: EvidenceResolver;
  fetchImpl: typeof fetch;
}

export interface RetrievedArtifact {
  httpStatus: number;
  finalUrl: string;
  retrievedAt: number;
  mimeType: string;
  byteLength: number;
  contentHash: Uint8Array;
  bytes: Uint8Array;
}

export interface RetrievalRejection {
  rejectionCode: RetrievalRejectionCode;
  detail: string;
}

export type EvidenceSourceClass =
  | "PRIMARY"
  | "OFFICIAL_RECORD"
  | "INDEPENDENT"
  | "USER_SUBMITTED"
  | "DISCOVERED";

export type EvidenceRetrievalStatus = "PENDING" | "ACCEPTED" | "REJECTED";

/** Persisted evidence record from PRD section 21.1. */
export interface EvidenceItem {
  evidenceId: string;
  submittedBy: `0x${string}`;
  submittedAt: number;
  sourceUrl: string;
  sourceClass: EvidenceSourceClass;
  retrievalStatus: EvidenceRetrievalStatus;
  retrievedAt?: number;
  finalUrl?: string;
  mimeType?: string;
  byteLength?: number;
  rawSha256?: string;
  rawWalrusBlobId?: string;
  rawWalrusObjectId?: `0x${string}`;
  canonicalTextHash?: string;
  canonicalWalrusBlobId?: string;
  canonicalWalrusObjectId?: `0x${string}`;
  walrusEndEpoch?: number;
  title?: string;
  excerpt?: string;
  rejectionCode?: string;
}

/** Hash-bearing fields are the authenticated EvidenceLeafV1 payload. */
export interface EvidenceManifestItem {
  evidenceId: string;
  contentHash: Uint8Array;
  canonicalHash: Uint8Array;
  sourceUrl?: string;
  finalUrl?: string;
  mimeType?: string;
  byteLength?: number;
  retrievedAt?: number;
  parserVersion?: string;
  rawWalrusBlobId?: string;
  rawWalrusObjectId?: `0x${string}`;
  canonicalWalrusBlobId?: string;
  canonicalWalrusObjectId?: `0x${string}`;
  walrusEndEpoch?: number;
}

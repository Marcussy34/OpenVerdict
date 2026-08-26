import { bcs } from "@mysten/sui/bcs";
import { blake2b256, toHex } from "../protocol/hash";
import type { EvidenceManifestItem } from "./types";

const HASH_LENGTH = 32;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

// Kept local because lib/protocol does not currently export this leaf schema.
const EvidenceLeafV1Bcs = bcs.struct("EvidenceLeafV1", {
  evidence_id: bcs.vector(bcs.u8()),
  content_hash: bcs.vector(bcs.u8()),
  canonical_hash: bcs.vector(bcs.u8()),
});

export class EvidenceManifestError extends Error {
  override readonly name: string = "EvidenceManifestError";
}

export class DuplicateEvidenceContentError extends EvidenceManifestError {
  override readonly name = "DuplicateEvidenceContentError";
  readonly hashField: "contentHash" | "canonicalHash";
  readonly evidenceIds: readonly [string, string];

  constructor(
    hashField: "contentHash" | "canonicalHash",
    firstEvidenceId: string,
    duplicateEvidenceId: string,
  ) {
    super(
      `duplicate ${hashField} for evidence ${firstEvidenceId} and ${duplicateEvidenceId}`,
    );
    this.hashField = hashField;
    this.evidenceIds = [firstEvidenceId, duplicateEvidenceId];
  }
}

export function computeEvidenceRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    throw new EvidenceManifestError("an evidence root requires at least one leaf");
  }

  let level = leaves.map((leaf) => blake2b256(leaf));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(blake2b256(concatBytes(left, right)));
    }
    level = next;
  }
  return level[0]!;
}

export function buildEvidenceManifest(
  items: readonly EvidenceManifestItem[],
): { root: Uint8Array; manifestJson: string } {
  if (items.length === 0) {
    throw new EvidenceManifestError("an evidence manifest requires at least one item");
  }

  const sortedItems = [...items].sort(compareEvidenceId);
  validateManifestItems(sortedItems);
  const leaves = sortedItems.map(serializeLeaf);

  return {
    root: computeEvidenceRoot(leaves),
    manifestJson: JSON.stringify({
      version: 1,
      hashAlgorithm: "blake2b-256",
      leafEncoding: "bcs::EvidenceLeafV1",
      items: sortedItems.map(toManifestJsonItem),
    }),
  };
}

function serializeLeaf(item: EvidenceManifestItem): Uint8Array {
  return EvidenceLeafV1Bcs.serialize({
    evidence_id: textEncoder.encode(item.evidenceId),
    content_hash: item.contentHash,
    canonical_hash: item.canonicalHash,
  }).toBytes();
}

function validateManifestItems(items: readonly EvidenceManifestItem[]): void {
  const evidenceIds = new Set<string>();
  const contentHashes = new Map<string, string>();
  const canonicalHashes = new Map<string, string>();

  for (const item of items) {
    if (item.evidenceId.length === 0) {
      throw new EvidenceManifestError("evidenceId must not be empty");
    }
    if (fatalTextDecoder.decode(textEncoder.encode(item.evidenceId)) !== item.evidenceId) {
      throw new EvidenceManifestError("evidenceId must be well-formed Unicode");
    }
    if (evidenceIds.has(item.evidenceId)) {
      throw new EvidenceManifestError(`duplicate evidenceId: ${item.evidenceId}`);
    }
    evidenceIds.add(item.evidenceId);
    validateHash("contentHash", item.contentHash, item.evidenceId);
    validateHash("canonicalHash", item.canonicalHash, item.evidenceId);
    registerHash(contentHashes, item.contentHash, "contentHash", item.evidenceId);
    registerHash(
      canonicalHashes,
      item.canonicalHash,
      "canonicalHash",
      item.evidenceId,
    );
  }
}

function validateHash(
  field: "contentHash" | "canonicalHash",
  value: Uint8Array,
  evidenceId: string,
): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== HASH_LENGTH) {
    throw new EvidenceManifestError(
      `${field} for evidence ${evidenceId} must be ${HASH_LENGTH} bytes`,
    );
  }
}

function registerHash(
  seen: Map<string, string>,
  hash: Uint8Array,
  field: "contentHash" | "canonicalHash",
  evidenceId: string,
): void {
  const key = toHex(hash);
  const firstEvidenceId = seen.get(key);
  if (firstEvidenceId !== undefined) {
    throw new DuplicateEvidenceContentError(field, firstEvidenceId, evidenceId);
  }
  seen.set(key, evidenceId);
}

function compareEvidenceId(
  left: EvidenceManifestItem,
  right: EvidenceManifestItem,
): number {
  return compareBytes(
    textEncoder.encode(left.evidenceId),
    textEncoder.encode(right.evidenceId),
  );
}

function toManifestJsonItem(item: EvidenceManifestItem): Record<string, unknown> {
  return compactObject({
    evidenceId: item.evidenceId,
    contentHash: toHex(item.contentHash),
    canonicalHash: toHex(item.canonicalHash),
    sourceUrl: item.sourceUrl,
    finalUrl: item.finalUrl,
    mimeType: item.mimeType,
    byteLength: item.byteLength,
    retrievedAt: item.retrievedAt,
    parserVersion: item.parserVersion,
    rawWalrusBlobId: item.rawWalrusBlobId,
    rawWalrusObjectId: item.rawWalrusObjectId,
    canonicalWalrusBlobId: item.canonicalWalrusBlobId,
    canonicalWalrusObjectId: item.canonicalWalrusObjectId,
    walrusEndEpoch: item.walrusEndEpoch,
  });
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

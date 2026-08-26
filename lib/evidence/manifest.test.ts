import { describe, expect, it } from "vitest";
import { blake2b256, toHex } from "../protocol/hash";
import {
  DuplicateEvidenceContentError,
  EvidenceManifestError,
  buildEvidenceManifest,
  computeEvidenceRoot,
} from "./manifest";
import type { EvidenceManifestItem } from "./types";

const sequence = (start: number): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, index) => start + index);

const itemA: EvidenceManifestItem = {
  evidenceId: "a",
  contentHash: sequence(0),
  canonicalHash: sequence(32),
  sourceUrl: "https://one.example/evidence",
};

const itemB: EvidenceManifestItem = {
  evidenceId: "b",
  contentHash: sequence(64),
  canonicalHash: sequence(96),
  sourceUrl: "https://two.example/evidence",
};

describe("computeEvidenceRoot", () => {
  it("hashes a single BCS leaf directly", () => {
    const leaf = Uint8Array.of(1, 2, 3);
    expect(computeEvidenceRoot([leaf])).toEqual(blake2b256(leaf));
  });

  it("duplicates the final node on odd Merkle levels", () => {
    const leaves = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)];
    const hashes = leaves.map(blake2b256);
    const left = blake2b256(concat(hashes[0]!, hashes[1]!));
    const right = blake2b256(concat(hashes[2]!, hashes[2]!));

    expect(computeEvidenceRoot(leaves)).toEqual(
      blake2b256(concat(left, right)),
    );
  });

  it("rejects an empty leaf set", () => {
    expect(() => computeEvidenceRoot([])).toThrow(EvidenceManifestError);
  });
});

describe("buildEvidenceManifest", () => {
  it("matches a fixed BCS and Merkle vector", () => {
    const result = buildEvidenceManifest([itemB, itemA]);

    expect(toHex(result.root)).toBe(
      "0xf1e8bd63e10d6b64a62e95891efbfb9428a39bbdf08fd4e7a2357afec548093f",
    );
    expect(JSON.parse(result.manifestJson)).toEqual({
      version: 1,
      hashAlgorithm: "blake2b-256",
      leafEncoding: "bcs::EvidenceLeafV1",
      items: [
        {
          evidenceId: "a",
          contentHash:
            "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
          canonicalHash:
            "0x202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
          sourceUrl: "https://one.example/evidence",
        },
        {
          evidenceId: "b",
          contentHash:
            "0x404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f",
          canonicalHash:
            "0x606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f",
          sourceUrl: "https://two.example/evidence",
        },
      ],
    });
  });

  it("is reproducible and independent of input order", () => {
    const first = buildEvidenceManifest([itemA, itemB]);
    const second = buildEvidenceManifest([itemB, itemA]);

    expect(second.root).toEqual(first.root);
    expect(second.manifestJson).toBe(first.manifestJson);
  });

  it("changes the frozen root when one content byte changes", () => {
    const phaseOne = buildEvidenceManifest([itemA, itemB]);
    const changed = {
      ...itemB,
      contentHash: Uint8Array.from(itemB.contentHash),
    };
    changed.contentHash[31] = changed.contentHash[31]! ^ 1;
    const phaseTwo = buildEvidenceManifest([itemA, changed]);

    expect(phaseTwo.root).not.toEqual(phaseOne.root);
  });

  it.each([
    ["the same URL", "https://one.example/evidence"],
    ["a different URL", "https://mirror.example/evidence"],
  ])("rejects duplicate raw content from %s", (_label, sourceUrl) => {
    const duplicate = {
      ...itemB,
      evidenceId: "duplicate",
      contentHash: Uint8Array.from(itemA.contentHash),
      sourceUrl,
    };

    expect(() => buildEvidenceManifest([itemA, duplicate])).toThrow(
      DuplicateEvidenceContentError,
    );
  });

  it("rejects duplicate canonical content", () => {
    const duplicate = {
      ...itemB,
      canonicalHash: Uint8Array.from(itemA.canonicalHash),
    };

    expect(() => buildEvidenceManifest([itemA, duplicate])).toThrow(
      DuplicateEvidenceContentError,
    );
  });

  it("rejects duplicate evidence IDs and malformed hashes", () => {
    expect(() =>
      buildEvidenceManifest([{ ...itemA }, { ...itemB, evidenceId: "a" }]),
    ).toThrow(EvidenceManifestError);
    expect(() =>
      buildEvidenceManifest([{ ...itemA, contentHash: Uint8Array.of(1) }]),
    ).toThrow(EvidenceManifestError);
  });

  it("rejects evidence IDs that are not well-formed Unicode", () => {
    expect(() =>
      buildEvidenceManifest([{ ...itemA, evidenceId: "\ud800" }]),
    ).toThrow(EvidenceManifestError);
  });
});

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

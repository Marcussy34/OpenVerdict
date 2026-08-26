import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blake2b256 } from "../protocol/hash";
import { createLocalWalrusStore } from "./local";
import {
  WalrusInvalidBlobIdError,
  WalrusNotFoundError,
  type WalrusStore,
} from "./store";

const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("createLocalWalrusStore", () => {
  it("round-trips bytes under their BLAKE2b-256 base64url ID", async () => {
    const { directory, store } = await createStore();
    const bytes = encoder.encode("immutable public evidence");
    const expectedBlobId = Buffer.from(blake2b256(bytes)).toString("base64url");

    const receipt = await store.put(bytes);

    expect(receipt).toEqual({ blobId: expectedBlobId });
    expect(await store.get(receipt.blobId)).toEqual(bytes);
    expect(await readdir(directory)).toEqual([expectedBlobId]);
  });

  it("persists content across store instances", async () => {
    const { directory, store } = await createStore();
    const bytes = encoder.encode("persistent bytes");
    const { blobId } = await store.put(bytes);

    const reopened = createLocalWalrusStore(directory);
    expect(await reopened.get(blobId)).toEqual(bytes);
  });

  it("deduplicates concurrent writes and leaves no temporary files", async () => {
    const { directory, store } = await createStore();
    const bytes = encoder.encode("same immutable content");

    const receipts = await Promise.all(
      Array.from({ length: 16 }, () => store.put(bytes)),
    );
    const files = await readdir(directory);

    expect(new Set(receipts.map((receipt) => receipt.blobId)).size).toBe(1);
    expect(files).toEqual([receipts[0]!.blobId]);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("uses distinct IDs for distinct bytes, including empty content", async () => {
    const { store } = await createStore();
    const first = await store.put(new Uint8Array());
    const second = await store.put(Uint8Array.of(0));

    expect(first.blobId).not.toBe(second.blobId);
    expect(await store.get(first.blobId)).toEqual(new Uint8Array());
  });

  it.each([
    "raw",
    "canonical",
    "manifest",
    "argument",
    "run",
    "tool",
  ])("round-trips a %s artifact", async (artifactKind) => {
    const { store } = await createStore();
    const bytes = encoder.encode(`${artifactKind} artifact bytes`);

    const { blobId } = await store.put(bytes, {
      identifier: `${artifactKind}.bin`,
    });

    expect(await store.get(blobId)).toEqual(bytes);
  });

  it("throws a typed not-found error", async () => {
    const { store } = await createStore();
    const validMissingId = Buffer.alloc(32, 7).toString("base64url");

    await expect(store.get(validMissingId)).rejects.toMatchObject({
      name: "WalrusNotFoundError",
      code: "WALRUS_NOT_FOUND",
      blobId: validMissingId,
    });
    await expect(store.get(validMissingId)).rejects.toBeInstanceOf(
      WalrusNotFoundError,
    );
  });

  it("rejects path traversal and malformed blob IDs", async () => {
    const { store } = await createStore();

    await expect(store.get("../../package.json")).rejects.toBeInstanceOf(
      WalrusInvalidBlobIdError,
    );
    await expect(store.get("not-a-digest")).rejects.toMatchObject({
      code: "WALRUS_INVALID_BLOB_ID",
    });
  });
});

async function createStore(): Promise<{
  directory: string;
  store: WalrusStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "openverdict-walrus-"));
  temporaryDirectories.push(directory);
  return { directory, store: createLocalWalrusStore(directory) };
}

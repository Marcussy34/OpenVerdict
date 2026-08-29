import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { NotFoundError as WalrusSdkNotFoundError } from "@mysten/walrus";
import { describe, expect, it, vi } from "vitest";
import { createRealWalrusStore } from "./real";
import { WalrusNotFoundError, type WalrusStore } from "./store";

// Hoisted so vi.mock's factory (itself hoisted above these imports) can see
// the same references the tests assert against.
const { writeBlobMock, readBlobMock, writeFilesMock, getFilesMock } = vi.hoisted(
  () => ({
    writeBlobMock: vi.fn(),
    readBlobMock: vi.fn(),
    writeFilesMock: vi.fn(),
    getFilesMock: vi.fn(),
  }),
);

// Replace the walrus client extension with an in-memory fake: no real network
// I/O, and it lets tests assert exactly which SDK methods the store calls.
vi.mock("@mysten/walrus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mysten/walrus")>();
  return {
    ...actual,
    walrus: () => ({
      name: "walrus" as const,
      register: () => ({
        writeBlob: writeBlobMock,
        readBlob: readBlobMock,
        writeFiles: writeFilesMock,
        getFiles: getFilesMock,
      }),
    }),
  };
});

const testConfig = {
  network: "testnet" as const,
  baseUrl: "https://fullnode.testnet.sui.io:443",
  epochs: 3,
};

describe("createRealWalrusStore", () => {
  it("constructs the current Sui gRPC client extension without network I/O", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const store = requireWalrusStore(
        createRealWalrusStore({
          ...testConfig,
          signer: Ed25519Keypair.generate(),
          uploadRelay: {
            host: "https://upload-relay.testnet.walrus.space",
            sendTip: { max: 1_000 },
          },
        }),
      );

      expect(store).toMatchObject({
        put: expect.any(Function),
        get: expect.any(Function),
        renew: expect.any(Function),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects invalid construction settings before creating a client", () => {
    const baseConfig = { ...testConfig, signer: Ed25519Keypair.generate() };

    expect(() => createRealWalrusStore({ ...baseConfig, epochs: 0 })).toThrow(
      /epochs/i,
    );
    expect(() =>
      createRealWalrusStore({ ...baseConfig, baseUrl: "not a URL" }),
    ).toThrow(/baseUrl/i);
  });

  it("puts and gets back identical bytes via raw blobs, never quilts", async () => {
    writeBlobMock.mockReset().mockResolvedValue({
      blobId: "A".repeat(43),
      blobObject: { id: "0xabc", storage: { end_epoch: 42 } },
    });
    const bytes = new TextEncoder().encode("hello raw blob");
    readBlobMock.mockReset().mockResolvedValue(bytes);

    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
    });

    // identifier/tags are accepted (callers, and the local store, pass them)
    // but a raw-blob store has nowhere to put file metadata, so they must be
    // ignored rather than rejected.
    const putResult = await store.put(bytes, {
      identifier: "ignored.bin",
      tags: { ignored: "true" },
    });
    expect(putResult).toEqual({ blobId: "A".repeat(43), objectId: "0xabc", endEpoch: 42 });
    expect(writeBlobMock).toHaveBeenCalledWith(
      expect.objectContaining({ blob: bytes, epochs: 3, deletable: false }),
    );

    const gotBytes = await store.get(putResult.blobId);
    expect(gotBytes).toEqual(bytes);
    expect(readBlobMock).toHaveBeenCalledWith({ blobId: putResult.blobId });

    expect(writeFilesMock).not.toHaveBeenCalled();
    expect(getFilesMock).not.toHaveBeenCalled();
  });

  it("maps the SDK not-found error from readBlob to WalrusNotFoundError", async () => {
    readBlobMock.mockReset().mockRejectedValue(
      new WalrusSdkNotFoundError(404, {}, "not found"),
    );

    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
    });

    const blobId = "B".repeat(43);
    await expect(store.get(blobId)).rejects.toBeInstanceOf(WalrusNotFoundError);
    expect(getFilesMock).not.toHaveBeenCalled();
  });
});

function requireWalrusStore(store: WalrusStore): WalrusStore {
  return store;
}

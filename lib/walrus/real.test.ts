import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { NotFoundError as WalrusSdkNotFoundError } from "@mysten/walrus";
import { describe, expect, it, vi } from "vitest";
import { createRealWalrusStore } from "./real";
import { WalrusNotFoundError, type WalrusStore } from "./store";

// Hoisted so vi.mock's factory (itself hoisted above these imports) can see
// the same references the tests assert against.
const {
  writeBlobMock,
  writeBlobFlowMock,
  readBlobMock,
  writeFilesMock,
  getFilesMock,
  stakingStateMock,
  resetMock,
} = vi.hoisted(() => ({
    writeBlobMock: vi.fn(),
    writeBlobFlowMock: vi.fn(),
    readBlobMock: vi.fn(),
    writeFilesMock: vi.fn(),
    getFilesMock: vi.fn(),
    stakingStateMock: vi.fn(),
    resetMock: vi.fn(),
  }));

// The store drives the SDK's step-wise flow; the fake flow funnels every
// write into writeBlobMock (called at register time with the blob and the
// register options) so the tests keep asserting one call per attempt.
writeBlobFlowMock.mockImplementation(({ blob }: { blob: Uint8Array }) => {
  let pending:
    | Promise<{ blobId: string; blobObject: { id: string; storage: { end_epoch: number } } }>
    | undefined;
  return {
    encode: async () => undefined,
    register: (options: { epochs: number; deletable: boolean; owner: string }) => {
      pending = Promise.resolve().then(() => writeBlobMock({ blob, ...options }));
      pending.catch(() => undefined);
      return {};
    },
    upload: async () => undefined,
    certify: () => ({}),
    getBlob: async () => {
      if (!pending) throw new Error("register must run before getBlob");
      return pending;
    },
  };
});

// The store executes the flow's register and certify transactions through
// the shared executor; here it only has to invoke the transaction factory.
vi.mock("../sui/execute", () => ({
  executeAndWait: vi.fn(async (_client: unknown, _signer: unknown, txOrFactory: unknown) => {
    if (typeof txOrFactory === "function") (txOrFactory as () => unknown)();
    return { digest: "fake-digest", moveEvents: [] };
  }),
  waitForGasIndex: vi.fn(async () => undefined),
}));

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
        writeBlobFlow: writeBlobFlowMock,
        readBlob: readBlobMock,
        writeFiles: writeFilesMock,
        getFiles: getFilesMock,
        stakingState: stakingStateMock,
        reset: resetMock,
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

  it("reports and caches Walrus epoch information for 60 seconds", async () => {
    resetMock.mockReset();
    stakingStateMock
      .mockReset()
      .mockResolvedValueOnce({ epoch: 240, epoch_duration: "86400000" })
      .mockResolvedValueOnce({ epoch: 241, epoch_duration: "86400000" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const store = createRealWalrusStore({
        ...testConfig,
        signer: Ed25519Keypair.generate(),
      });
      const epochInfo = store.epochInfo;
      if (!epochInfo) throw new Error("expected real store epoch information");

      await expect(epochInfo()).resolves.toEqual({
        currentEpoch: 240,
        epochDurationMs: 86_400_000,
      });
      expect(resetMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(60_999);
      await expect(epochInfo()).resolves.toEqual({
        currentEpoch: 240,
        epochDurationMs: 86_400_000,
      });
      expect(resetMock).toHaveBeenCalledTimes(1);
      expect(stakingStateMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(61_000);
      await expect(epochInfo()).resolves.toEqual({
        currentEpoch: 241,
        epochDurationMs: 86_400_000,
      });
      expect(resetMock).toHaveBeenCalledTimes(2);
      expect(stakingStateMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
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

  it("retries a stale-object write with a rebuilt Walrus transaction", async () => {
    const staleError = new Error("Walrus write failed", {
      cause: new Error(
        "Transaction needs to be rebuilt because object 0xabc is unavailable for consumption",
      ),
    });
    writeBlobMock.mockReset().mockRejectedValueOnce(staleError).mockResolvedValueOnce({
      blobId: "C".repeat(43),
      blobObject: { id: "0xdef", storage: { end_epoch: 51 } },
    });
    const sleep = vi
      .fn<(milliseconds: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
      sleep,
    });

    await expect(store.put(new Uint8Array([1]))).resolves.toEqual({
      blobId: "C".repeat(43),
      objectId: "0xdef",
      endEpoch: 51,
    });
    expect(writeBlobMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_500);
  });

  it("does not retry an unrelated Walrus write error", async () => {
    const error = new Error("insufficient WAL");
    writeBlobMock.mockReset().mockRejectedValue(error);
    const sleep = vi
      .fn<(milliseconds: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
      sleep,
    });

    await expect(store.put(new Uint8Array([2]))).rejects.toBe(error);
    expect(writeBlobMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("runs concurrent writes one at a time", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    writeBlobMock
      .mockReset()
      .mockImplementationOnce(async () => {
        order.push("first-start");
        await firstGate;
        order.push("first-end");
        return { blobId: "A".repeat(43), blobObject: { id: "0x1", storage: { end_epoch: 9 } } };
      })
      .mockImplementationOnce(async () => {
        order.push("second-start");
        return { blobId: "B".repeat(43), blobObject: { id: "0x2", storage: { end_epoch: 9 } } };
      });
    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
    });

    const first = store.put(new Uint8Array([1]));
    const second = store.put(new Uint8Array([2]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The second write has not started while the first is still in flight.
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("rethrows the last stale-object error after eight write attempts", async () => {
    // Every wording the fullnode and validators use for a coin another
    // write (ours or a sibling's) just moved.
    const wordings = [
      "object is unavailable for consumption",
      "transaction needs to be rebuilt",
      "ObjectVersionUnavailableForConsumption",
      "Object (0x21) already locked by a different transaction: TransactionDigest(abc)",
      "provided version doesn't match for object 0x21, provided: 1 actual: 2",
      "objects reserved for another transaction",
      "object is unavailable for consumption",
      "transaction needs to be rebuilt",
    ];
    const staleErrors = wordings.map((message) => new Error(message));
    writeBlobMock.mockReset();
    for (const error of staleErrors) writeBlobMock.mockRejectedValueOnce(error);
    const sleep = vi
      .fn<(milliseconds: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const store = createRealWalrusStore({
      ...testConfig,
      signer: Ed25519Keypair.generate(),
      sleep,
    });

    await expect(store.put(new Uint8Array([3]))).rejects.toBe(staleErrors[7]);
    expect(writeBlobMock).toHaveBeenCalledTimes(8);
    expect(sleep).toHaveBeenCalledTimes(7);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_500);
    expect(sleep).toHaveBeenNthCalledWith(2, 3_000);
    expect(sleep).toHaveBeenNthCalledWith(7, 10_500);
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

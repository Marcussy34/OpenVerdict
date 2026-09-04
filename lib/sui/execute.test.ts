import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it, vi } from "vitest";
import { executeAndWait } from "./execute";

describe("executeAndWait", () => {
  it("sets an explicit localnet gas budget before the signer builds", async () => {
    const client = new SuiJsonRpcClient({
      network: "localnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    const transaction = new Transaction();
    vi.spyOn(signer, "signAndExecuteTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "submitted" },
    } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);

    await executeAndWait(client, signer, transaction);

    expect(transaction.getData()).toMatchObject({
      gasData: { budget: "2000000000" },
    });
  });

  it("rebuilds and retries when validators report the gas coin already locked", async () => {
    const client = new SuiJsonRpcClient({
      network: "testnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    // The validators' wording, seen right after our own Walrus certify tx
    // while the fullnode's coin index still reports the consumed version.
    const locked = new Error(
      "Transaction is rejected as invalid by more than 1/3 of validators by stake (non-retriable). Non-retriable errors: [Object (0xdba0339f14877799f829e0b07e262c47d77122d41b884cd3cd273b8fef77cfa8, SequenceNumber(996334867), o#2S1TSUBQUYd1RyZyS7zakBmtaMCJgaj5BbJnjkdgNXbw) already locked by a different transaction: TransactionDigest(7hrAHmFLWW7k5LiB5AHfa76ZXyrsiZ9qhhB7DrPMXDrJ) with 6942 stake].",
    );
    const execute = vi
      .spyOn(signer, "signAndExecuteTransaction")
      .mockRejectedValueOnce(locked)
      .mockResolvedValue({
        $kind: "Transaction",
        Transaction: { digest: "submitted" },
      } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);
    let builds = 0;
    const factory = (): Transaction => {
      builds += 1;
      return new Transaction();
    };

    const result = await executeAndWait(client, signer, factory);

    expect(result.digest).toBe("settled");
    expect(execute).toHaveBeenCalledTimes(2);
    // The second attempt signs a freshly built transaction, not the rejected one.
    expect(builds).toBe(2);
  });

  it.each([
    "Transaction is rejected as invalid by more than 1/3 of validators by stake (non-retriable). Non-retriable errors: [Transaction needs to be rebuilt because object 0xdba0339f14877799f829e0b07e262c47d77122d41b884cd3cd273b8fef77cfa8 version 0x3b6310bb (C3ZC4SJWvjCeeAtAFYQSGXknKRS2enYjQv5gtZKmkgoe) is unavailable for consumption with 6942 stake].",
    "provided version doesn't match for object 0x21305b77ebe47c29007b063029986ce0b75b8e7e4b35743b8c04235a96e9791d, provided: 996347965 actual: 0x3b631165",
    // The gRPC transport percent-encodes validator rejections.
    "Transaction%20is%20rejected%20as%20invalid%20by%20more%20than%201/3%20of%20validators%20by%20stake%20(non-retriable).%20Non-retriable%20errors:%20[Object%20(0xdba0339f14877799f829e0b07e262c47d77122d41b884cd3cd273b8fef77cfa8,%20SequenceNumber(996543668),%20o%235GbQg7Fpwqicy3uoNa13UyUPM7v2Tn4FdVjVNLGYQTCf)%20already%20locked%20by%20a%20different%20transaction:%20TransactionDigest(HoApeRJReKXUfF43BxKwXz6KtuiK69JtuC4DmfsUVWRs)]",
  ])("rebuilds and retries the stale-object wording: %s", async (message) => {
    const client = new SuiJsonRpcClient({
      network: "testnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    const execute = vi
      .spyOn(signer, "signAndExecuteTransaction")
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue({
        $kind: "Transaction",
        Transaction: { digest: "submitted" },
      } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);

    const result = await executeAndWait(client, signer, () => new Transaction());

    expect(result.digest).toBe("settled");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("pins the coin at this process's gas slot, sorted so processes never share one", async () => {
    const client = new SuiJsonRpcClient({
      network: "testnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    // Deliberately out of order, and with one dust coin no slot may take.
    vi.spyOn(client.core, "listCoins").mockResolvedValue({
      objects: [
        { objectId: "0xcc", balance: "2000000000" },
        { objectId: "0xaa", balance: "2000000000" },
        { objectId: "0x11", balance: "1000" },
        { objectId: "0xbb", balance: "2000000000" },
      ],
      hasNextPage: false,
      cursor: null,
    } as never);
    vi.spyOn(client.core, "getObject").mockResolvedValue({
      object: { version: "42", digest: "coin-digest" },
    } as never);
    vi.spyOn(signer, "signAndExecuteTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "submitted" },
    } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);
    const transaction = new Transaction();
    process.env.OPENVERDICT_OPERATOR_GAS_SLOT = "1";

    try {
      await executeAndWait(client, signer, transaction);
    } finally {
      delete process.env.OPENVERDICT_OPERATOR_GAS_SLOT;
    }

    expect(transaction.getData().gasData.payment).toEqual([
      {
        objectId: `0x${"00".repeat(31)}bb`,
        version: "42",
        digest: "coin-digest",
      },
    ]);
  });

  it("leaves gas selection to the builder when no slot is configured", async () => {
    const client = new SuiJsonRpcClient({
      network: "testnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    const listCoins = vi.spyOn(client.core, "listCoins");
    vi.spyOn(signer, "signAndExecuteTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "submitted" },
    } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);
    const transaction = new Transaction();

    await executeAndWait(client, signer, transaction);

    expect(listCoins).not.toHaveBeenCalled();
    expect(transaction.getData().gasData.payment).toBeNull();
  });

  it("keeps today's behaviour when the slot points past the coins that exist", async () => {
    const client = new SuiJsonRpcClient({
      network: "testnet",
      url: "http://127.0.0.1:9000",
    });
    const signer = new Ed25519Keypair();
    vi.spyOn(client.core, "listCoins").mockResolvedValue({
      objects: [{ objectId: "0xaa", balance: "2000000000" }],
      hasNextPage: false,
      cursor: null,
    } as never);
    const getObject = vi.spyOn(client.core, "getObject");
    vi.spyOn(signer, "signAndExecuteTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "submitted" },
    } as never);
    vi.spyOn(client.core, "waitForTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: {
        digest: "settled",
        effects: { changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    } as never);
    const transaction = new Transaction();
    process.env.OPENVERDICT_OPERATOR_GAS_SLOT = "3";

    try {
      await executeAndWait(client, signer, transaction);
    } finally {
      delete process.env.OPENVERDICT_OPERATOR_GAS_SLOT;
    }

    expect(getObject).not.toHaveBeenCalled();
    expect(transaction.getData().gasData.payment).toBeNull();
  });
});

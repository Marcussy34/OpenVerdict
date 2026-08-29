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
});

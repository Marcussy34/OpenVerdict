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
});

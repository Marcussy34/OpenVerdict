import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it, vi } from "vitest";
import type { OpenVerdictSuiClient } from "./client";
import { sponsorAndExecute } from "./sponsor";

const gasCoin = {
  objectId: `0x${"31".repeat(32)}`,
  version: "7",
  digest: "11111111111111111111111111111111",
  owner: { $kind: "AddressOwner", AddressOwner: `0x${"32".repeat(32)}` },
  type: "0x2::coin::Coin<0x2::sui::SUI>",
  balance: "50000000",
} as const;

describe("sponsorAndExecute", () => {
  it("assembles coin-sponsored bytes and executes with both signatures", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const sponsorKeypair = new Ed25519Keypair();
    const tx = new Transaction();
    tx.transferObjects(
      [
        tx.objectRef({
          objectId: `0x${"41".repeat(32)}`,
          version: "3",
          digest: "11111111111111111111111111111111",
        }),
      ],
      senderKeypair.toSuiAddress(),
    );

    const effects = { gasUsed: { computationCost: "1" } };
    const execute = vi.spyOn(client.core, "executeTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "sponsored-digest", effects },
      protoJson: undefined,
    } as never);

    const result = await sponsorAndExecute({
      client,
      tx,
      senderKeypair,
      sponsorKeypair,
      gasBudget: 10_000_000,
    });

    expect(result).toEqual({ digest: "sponsored-digest", effects });
    expect(execute).toHaveBeenCalledOnce();
    const execution = execute.mock.calls[0]?.[0];
    expect(execution?.signatures).toHaveLength(2);
    const built = Transaction.from(execution?.transaction ?? new Uint8Array()).getData();
    expect(built.sender).toBe(senderKeypair.toSuiAddress());
    expect(built.gasData.owner).toBe(sponsorKeypair.toSuiAddress());
    expect(built.gasData.budget).toBe("10000000");
    expect(built.gasData.payment).toEqual([
      {
        objectId: gasCoin.objectId,
        version: gasCoin.version,
        digest: gasCoin.digest,
      },
    ]);
  });

  it("rejects before signing when the sponsor has no usable gas coins", async () => {
    const client = mockClient([]);
    const senderKeypair = new Ed25519Keypair();
    const sponsorKeypair = new Ed25519Keypair();
    const tx = new Transaction();
    tx.transferObjects(
      [
        tx.objectRef({
          objectId: `0x${"42".repeat(32)}`,
          version: "4",
          digest: "11111111111111111111111111111111",
        }),
      ],
      senderKeypair.toSuiAddress(),
    );
    const senderSign = vi.spyOn(senderKeypair, "signTransaction");
    const sponsorSign = vi.spyOn(sponsorKeypair, "signTransaction");
    const execute = vi.spyOn(client.core, "executeTransaction");

    await expect(
      sponsorAndExecute({ client, tx, senderKeypair, sponsorKeypair }),
    ).rejects.toThrow(/sponsor has no usable SUI gas coins/i);
    expect(senderSign).not.toHaveBeenCalled();
    expect(sponsorSign).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

function mockClient(coins: typeof gasCoin[]): OpenVerdictSuiClient {
  const client = new SuiJsonRpcClient({
    network: "localnet",
    url: "http://127.0.0.1:9000",
  });
  vi.spyOn(client.core, "listCoins").mockResolvedValue({
    objects: coins,
    hasNextPage: false,
    cursor: null,
  });
  vi.spyOn(client.core, "resolveTransactionPlugin").mockReturnValue(
    async (transactionData, _options, next) => {
      transactionData.gasData.price = "1000";
      await next();
    },
  );
  return client;
}

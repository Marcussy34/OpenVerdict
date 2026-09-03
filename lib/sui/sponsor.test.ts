import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { describe, expect, it, vi } from "vitest";
import type { OpenVerdictSuiClient } from "./client";
import {
  sponsorAndExecute,
  sponsorAndExecuteWithFallback,
  sponsorWithGasStationAndExecute,
} from "./sponsor";

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

const SPONSORED_TX_BYTES = toBase64(new Uint8Array([9, 8, 7, 6, 5]));

function transferTx(sender: Ed25519Keypair, objectByte: string): Transaction {
  const tx = new Transaction();
  tx.transferObjects(
    [
      tx.objectRef({
        objectId: `0x${objectByte.repeat(32)}`,
        version: "3",
        digest: "11111111111111111111111111111111",
      }),
    ],
    sender.toSuiAddress(),
  );
  return tx;
}

function gasStationResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        txBytes: SPONSORED_TX_BYTES,
        txDigest: "HvtKY9RwuE7NC4gLauLFPY3h5qepEy8R7aZHnc4gJu6G",
        signature: "c3BvbnNvclNpZw==",
        expireAtTime: 1695267721,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("sponsorWithGasStationAndExecute", () => {
  it("sends the kind to Shinami and executes the returned bytes with both signatures", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const tx = transferTx(senderKeypair, "43");
    const fetchImpl = vi.fn().mockResolvedValue(gasStationResponse());

    const effects = { gasUsed: { computationCost: "1" } };
    const execute = vi.spyOn(client.core, "executeTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "gas-station-digest", effects },
      protoJson: undefined,
    } as never);

    const result = await sponsorWithGasStationAndExecute({
      client,
      tx,
      senderKeypair,
      gasStation: { accessKey: "test-key" },
      gasBudget: 50_000_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ digest: "gas-station-digest", effects });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("gas_sponsorTransactionBlock");
    expect(body.params[1]).toBe(senderKeypair.toSuiAddress());
    expect(body.params[2]).toBe(50_000_000);
    // The kind the gas station saw is exactly what the local build produced.
    expect(body.params[0]).toBe(
      toBase64(await tx.build({ client, onlyTransactionKind: true })),
    );

    const execution = execute.mock.calls[0]?.[0];
    expect(execution?.transaction).toEqual(fromBase64(SPONSORED_TX_BYTES));
    expect(execution?.signatures).toHaveLength(2);
    expect(execution?.signatures?.[1]).toBe("c3BvbnNvclNpZw==");
  });

  it("raises a sponsored-transaction error when execution fails on chain", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const fetchImpl = vi.fn().mockResolvedValue(gasStationResponse());
    vi.spyOn(client.core, "executeTransaction").mockResolvedValue({
      $kind: "FailedTransaction",
      FailedTransaction: {
        digest: "failed-digest",
        status: { error: { message: "InsufficientGas" } },
      },
    } as never);

    await expect(
      sponsorWithGasStationAndExecute({
        client,
        tx: transferTx(senderKeypair, "44"),
        senderKeypair,
        gasStation: { accessKey: "test-key" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/InsufficientGas/);
  });
});

describe("sponsorAndExecuteWithFallback", () => {
  it("uses the gas station when it answers", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const sponsorKeypair = new Ed25519Keypair();
    const fetchImpl = vi.fn().mockResolvedValue(gasStationResponse());
    const sponsorSign = vi.spyOn(sponsorKeypair, "signTransaction");
    const warn = vi.fn();
    vi.spyOn(client.core, "executeTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "gas-station-digest", effects: {} },
      protoJson: undefined,
    } as never);

    const result = await sponsorAndExecuteWithFallback({
      client,
      tx: transferTx(senderKeypair, "45"),
      senderKeypair,
      gasStation: { accessKey: "test-key" },
      sponsorKeypair,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn },
    });

    expect(result.digest).toBe("gas-station-digest");
    // The operator never signs while the gas station is healthy.
    expect(sponsorSign).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once and pays from operator coins when the gas station fails", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const sponsorKeypair = new Ed25519Keypair();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("service unavailable", { status: 503 }));
    const warn = vi.fn();
    const execute = vi.spyOn(client.core, "executeTransaction").mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: "operator-digest", effects: {} },
      protoJson: undefined,
    } as never);

    const result = await sponsorAndExecuteWithFallback({
      client,
      tx: transferTx(senderKeypair, "46"),
      senderKeypair,
      gasStation: { accessKey: "super-secret-key" },
      sponsorKeypair,
      gasBudget: 10_000_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn },
    });

    expect(result.digest).toBe("operator-digest");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("gas station unavailable");
    expect(warn.mock.calls[0]?.[0]).not.toContain("super-secret-key");
    const built = Transaction.from(
      execute.mock.calls[0]?.[0]?.transaction ?? new Uint8Array(),
    ).getData();
    expect(built.gasData.owner).toBe(sponsorKeypair.toSuiAddress());
  });

  it("rethrows when the gas station fails and no operator sponsor exists", async () => {
    const client = mockClient([gasCoin]);
    const senderKeypair = new Ed25519Keypair();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("service unavailable", { status: 503 }));

    await expect(
      sponsorAndExecuteWithFallback({
        client,
        tx: transferTx(senderKeypair, "47"),
        senderKeypair,
        gasStation: { accessKey: "test-key" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger: { warn: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: "SHINAMI_HTTP_ERROR" });
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

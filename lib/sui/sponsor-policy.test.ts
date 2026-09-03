import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import {
  Inputs,
  Transaction,
  TransactionCommands,
  TransactionDataBuilder,
} from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { describe, expect, it, vi } from "vitest";
import type { OpenVerdictSuiClient } from "./client";
import { MAX_SPONSORED_COMMANDS, validateSponsoredKind } from "./sponsor-policy";

const PACKAGE_ID = `0x${"15".repeat(32)}`;
const REGISTRY_ID = `0x${"40".repeat(32)}`;
const POOL_ID = `0x${"50".repeat(32)}`;
const CLOCK_ID = "0x6";
const COIN_TYPE = "0x2::sui::SUI";
const SENDER = `0x${"ab".repeat(32)}`;

function policy() {
  return { packageId: PACKAGE_ID };
}

function coinRef(byte: string) {
  return {
    objectId: `0x${byte.repeat(32)}`,
    version: "9",
    digest: "11111111111111111111111111111111",
  };
}

/** The shape the pool panel produces: split a stake off an owned coin, enter. */
function poolEntry(): Transaction {
  const tx = new Transaction();
  const [stake] = tx.splitCoins(tx.object(tx.objectRef(coinRef("61"))), [
    tx.pure.u64(1_000n),
  ]);
  tx.moveCall({
    target: `${PACKAGE_ID}::demo_binary_pool::enter`,
    typeArguments: [COIN_TYPE],
    arguments: [
      tx.object(tx.sharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false })),
      tx.object(tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true })),
      stake!,
      tx.pure.u8(1),
      tx.object(tx.sharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false })),
    ],
  });
  return tx;
}

async function kindOf(tx: Transaction): Promise<string> {
  tx.setSender(SENDER);
  return toBase64(await tx.build({ onlyTransactionKind: true }));
}

/** Client stub good enough to resolve a CoinWithBalance intent offline. */
function coinClient(coins: { objectId: string; version: string; digest: string; balance: string }[], addressBalance: string): OpenVerdictSuiClient {
  const client = new SuiJsonRpcClient({
    network: "testnet",
    url: "http://127.0.0.1:9000",
  });
  const coinBalance = coins.reduce((total, coin) => total + BigInt(coin.balance), 0n);
  vi.spyOn(client.core, "getBalance").mockResolvedValue({
    balance: {
      coinType: COIN_TYPE,
      balance: String(coinBalance + BigInt(addressBalance)),
      coinBalance: String(coinBalance),
      addressBalance,
    },
  } as never);
  vi.spyOn(client.core, "listCoins").mockResolvedValue({
    objects: coins.map((coin) => ({
      ...coin,
      owner: { $kind: "AddressOwner", AddressOwner: SENDER },
      type: `0x2::coin::Coin<${COIN_TYPE}>`,
    })),
    hasNextPage: false,
    cursor: null,
  } as never);
  vi.spyOn(client.core, "resolveTransactionPlugin").mockReturnValue(
    async (transactionData, _options, next) => {
      transactionData.gasData.price = "1000";
      await next();
    },
  );
  return client;
}

describe("validateSponsoredKind", () => {
  it("accepts a pool entry that splits the stake off an owned coin", async () => {
    expect(validateSponsoredKind(await kindOf(poolEntry()), policy())).toEqual({
      ok: true,
    });
  });

  it("accepts what tx.coin({ useGasCoin: false }) really builds from owned coins", async () => {
    const client = coinClient(
      [
        { ...coinRef("62"), balance: "600" },
        { ...coinRef("63"), balance: "600" },
      ],
      "0",
    );
    const tx = new Transaction();
    const stake = tx.coin({ balance: 1_000n, type: COIN_TYPE, useGasCoin: false });
    tx.moveCall({
      target: `${PACKAGE_ID}::demo_binary_pool::enter`,
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.sharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false }),
        tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true }),
        stake,
        tx.pure.u8(2),
        tx.sharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false }),
      ],
    });
    tx.setSender(SENDER);

    const kind = toBase64(await tx.build({ client, onlyTransactionKind: true }));

    expect(validateSponsoredKind(kind, policy())).toEqual({ ok: true });
  });

  it("accepts the address-balance variant of the same intent", async () => {
    const client = coinClient([], "5000");
    const tx = new Transaction();
    const stake = tx.coin({ balance: 1_000n, type: COIN_TYPE, useGasCoin: false });
    tx.moveCall({
      target: `${PACKAGE_ID}::demo_binary_pool::enter`,
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.sharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false }),
        tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true }),
        stake,
        tx.pure.u8(1),
        tx.sharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false }),
      ],
    });
    tx.setSender(SENDER);

    const kind = toBase64(await tx.build({ client, onlyTransactionKind: true }));

    expect(validateSponsoredKind(kind, policy())).toEqual({ ok: true });
  });

  it("accepts the exact-coin variant, which ends in coin::destroy_zero", async () => {
    const client = coinClient([{ ...coinRef("68"), balance: "1000" }], "0");
    const tx = new Transaction();
    const stake = tx.coin({ balance: 1_000n, type: COIN_TYPE, useGasCoin: false });
    tx.moveCall({
      target: `${PACKAGE_ID}::demo_binary_pool::enter`,
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.sharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false }),
        tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true }),
        stake,
        tx.pure.u8(1),
        tx.sharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false }),
      ],
    });
    tx.setSender(SENDER);

    const kind = toBase64(await tx.build({ client, onlyTransactionKind: true }));

    expect(validateSponsoredKind(kind, policy())).toEqual({ ok: true });
  });

  it("rejects a move call into another package", async () => {
    const tx = new Transaction();
    tx.moveCall({
      target: `0x${"99".repeat(32)}::drainer::take`,
      arguments: [tx.object(tx.objectRef(coinRef("64")))],
    });

    expect(validateSponsoredKind(await kindOf(tx), policy())).toEqual({
      ok: false,
      reason: "move call drainer::take is not sponsorable",
    });
  });

  it("rejects another module or function inside our own package", async () => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::demo_binary_pool::settle`,
      arguments: [tx.object(tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true }))],
    });

    expect(validateSponsoredKind(await kindOf(tx), policy())).toMatchObject({
      ok: false,
    });
  });

  it("rejects a transfer smuggled in beside the entry", async () => {
    const tx = poolEntry();
    tx.transferObjects([tx.object(tx.objectRef(coinRef("65")))], SENDER);

    expect(validateSponsoredKind(await kindOf(tx), policy())).toEqual({
      ok: false,
      reason: "command TransferObjects is not sponsorable",
    });
  });

  it("rejects any reference to the gas coin", async () => {
    const tx = new Transaction();
    const [stake] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000n)]);
    tx.moveCall({
      target: `${PACKAGE_ID}::demo_binary_pool::enter`,
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.object(tx.sharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false })),
        tx.object(tx.sharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true })),
        stake!,
        tx.pure.u8(1),
        tx.object(tx.sharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false })),
      ],
    });

    expect(validateSponsoredKind(await kindOf(tx), policy())).toEqual({
      ok: false,
      reason: "transaction kind references the gas coin",
    });
  });

  it("rejects a withdrawal that names the sponsor as the source", () => {
    // Hand-assembled: no builder API produces a Sponsor withdrawal, which is
    // exactly why the route must refuse one that arrives over the wire.
    const builder = new TransactionDataBuilder();
    const funds = builder.addInput(
      "withdrawal",
      Inputs.FundsWithdrawal({
        reservation: { $kind: "MaxAmountU64", MaxAmountU64: "1000" },
        typeArg: { $kind: "Balance", Balance: COIN_TYPE },
        withdrawFrom: { $kind: "Sponsor", Sponsor: true },
      }),
    );
    builder.commands.push(
      TransactionCommands.MoveCall({
        target: "0x2::coin::redeem_funds",
        typeArguments: [COIN_TYPE],
        arguments: [funds],
      }),
      TransactionCommands.MoveCall({
        target: `${PACKAGE_ID}::demo_binary_pool::enter`,
        typeArguments: [COIN_TYPE],
        arguments: [
          builder.addInput(
            "object",
            Inputs.SharedObjectRef({ objectId: REGISTRY_ID, initialSharedVersion: 1, mutable: false }),
          ),
          builder.addInput(
            "object",
            Inputs.SharedObjectRef({ objectId: POOL_ID, initialSharedVersion: 1, mutable: true }),
          ),
          { $kind: "Result", Result: 0 },
          builder.addInput("pure", Inputs.Pure(new Uint8Array([1]))),
          builder.addInput(
            "object",
            Inputs.SharedObjectRef({ objectId: CLOCK_ID, initialSharedVersion: 1, mutable: false }),
          ),
        ],
      }),
    );

    const kind = toBase64(builder.build({ onlyTransactionKind: true }));

    expect(validateSponsoredKind(kind, policy())).toEqual({
      ok: false,
      reason: "transaction kind withdraws funds from the sponsor",
    });
  });

  it("rejects a kind with more commands than the cap", async () => {
    const tx = new Transaction();
    const coin = tx.object(tx.objectRef(coinRef("66")));
    for (let index = 0; index <= MAX_SPONSORED_COMMANDS; index += 1) {
      tx.splitCoins(coin, [tx.pure.u64(1n)]);
    }

    expect(validateSponsoredKind(await kindOf(tx), policy())).toEqual({
      ok: false,
      reason: `transaction kind has more than ${MAX_SPONSORED_COMMANDS} commands`,
    });
  });

  it("rejects coin plumbing with no pool entry at all", async () => {
    const tx = new Transaction();
    tx.splitCoins(tx.object(tx.objectRef(coinRef("67"))), [tx.pure.u64(1n)]);

    expect(validateSponsoredKind(await kindOf(tx), policy())).toEqual({
      ok: false,
      reason: "transaction kind does not call demo_binary_pool::enter",
    });
  });

  it("rejects bytes that do not decode as a transaction kind", () => {
    expect(validateSponsoredKind("not-base64-at-all!!", policy())).toEqual({
      ok: false,
      reason: "transaction bytes are not a valid TransactionKind",
    });
    expect(validateSponsoredKind(new Uint8Array([255, 255, 255]), policy())).toEqual({
      ok: false,
      reason: "transaction bytes are not a valid TransactionKind",
    });
  });
});

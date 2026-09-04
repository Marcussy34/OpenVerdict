import type { SuiClientTypes } from "@mysten/sui/client";
import { normalizeStructTag, parseStructTag } from "@mysten/sui/utils";
import {
  MAINNET_WALRUS_PACKAGE_CONFIG,
  TESTNET_WALRUS_PACKAGE_CONFIG,
} from "@mysten/walrus";

/** The Sui core calls the balance helpers need, on any client shape. */
export interface CoinReadingClient {
  core: {
    listCoins(
      options: SuiClientTypes.ListCoinsOptions,
    ): Promise<SuiClientTypes.ListCoinsResponse>;
    getObject(
      options: SuiClientTypes.GetObjectOptions,
    ): Promise<SuiClientTypes.GetObjectResponse>;
    getMoveFunction(
      options: SuiClientTypes.GetMoveFunctionOptions,
    ): Promise<SuiClientTypes.GetMoveFunctionResponse>;
  };
}

export const SUI_COIN_TYPE = "0x2::sui::SUI";

/** Enough SUI and WAL to pay for at least one register plus certify pair. */
export const WRITER_SUI_FLOOR_MIST = 50_000_000n;
export const WRITER_WAL_FLOOR_FROST = 50_000_000n;

/** What the funding script tops a writer up to when it is below the floor. */
export const WRITER_SUI_TARGET_MIST = 300_000_000n;
export const WRITER_WAL_TARGET_FROST = 500_000_000n;

/** Total balance an address holds of one coin type, in the coin's base units. */
export async function coinBalance(
  client: CoinReadingClient,
  owner: string,
  coinType: string,
): Promise<bigint> {
  let cursor: string | null = null;
  let total = 0n;
  do {
    const page: SuiClientTypes.ListCoinsResponse = await client.core.listCoins({
      owner,
      coinType,
      ...(cursor === null ? {} : { cursor }),
    });
    for (const coin of page.objects) total += BigInt(coin.balance);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null);
  return total;
}

/**
 * The WAL coin type. It is not a constant in the Walrus SDK: the SDK reads it
 * from the staking module's stake function so a redeployed WAL package keeps
 * working, and this repeats that derivation. WALRUS_WAL_COIN_TYPE overrides it
 * when a network moves faster than the SDK's package config.
 */
export async function walCoinType(
  client: CoinReadingClient,
  network: "testnet" | "mainnet",
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const override = env.WALRUS_WAL_COIN_TYPE?.trim();
  if (override) return normalizeStructTag(override);
  const systemObjectId =
    network === "mainnet"
      ? MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId
      : TESTNET_WALRUS_PACKAGE_CONFIG.systemObjectId;
  const system = await client.core.getObject({ objectId: systemObjectId, include: {} });
  const packageId = parseStructTag(system.object.type).address;
  const { function: stake } = await client.core.getMoveFunction({
    packageId,
    moduleName: "staking",
    name: "stake_with_pool",
  });
  // stake_with_pool(pool, Coin<WAL>, ...): the coin's type argument is WAL.
  const coin = stake.parameters[1]?.body;
  const argument = coin?.$kind === "datatype" ? coin.datatype.typeParameters[0] : undefined;
  if (argument?.$kind !== "datatype") {
    throw new Error("could not resolve the WAL coin type from the Walrus staking module");
  }
  return normalizeStructTag(argument.datatype.typeName);
}

export interface WriterBalances {
  address: string;
  sui: bigint;
  wal: bigint;
}

/** Both balances a Walrus writer needs before it can sign its own writes. */
export async function writerBalances(
  client: CoinReadingClient,
  address: string,
  walType: string,
): Promise<WriterBalances> {
  const [sui, wal] = await Promise.all([
    coinBalance(client, address, SUI_COIN_TYPE),
    coinBalance(client, address, walType),
  ]);
  return { address, sui, wal };
}

/**
 * How much a writer is short of its target, or 0 when it still sits above the
 * floor. Topping up only below the floor keeps the funding run idempotent: a
 * writer just above it is left alone rather than nudged every time.
 */
export function topUpAmount(held: bigint, floor: bigint, target: bigint): bigint {
  return held >= floor ? 0n : target - held;
}

/** Nine-decimal base units rendered for a human, never rounded to zero silently. */
export function formatUnits(amount: bigint, decimals = 9): string {
  const negative = amount < 0n;
  const scale = 10n ** BigInt(decimals);
  const value = negative ? -amount : amount;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, 4);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

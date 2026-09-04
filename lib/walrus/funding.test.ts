import { describe, expect, it, vi } from "vitest";
import {
  WRITER_SUI_FLOOR_MIST,
  WRITER_SUI_TARGET_MIST,
  coinBalance,
  formatUnits,
  topUpAmount,
  walCoinType,
  writerBalances,
  type CoinReadingClient,
} from "./funding";

const WAL = "0x8190b0::wal::WAL";

function client(overrides: {
  coins?: Record<string, Array<{ objectId: string; balance: string }>>;
  pages?: Array<{ objects: Array<{ objectId: string; balance: string }>; hasNextPage: boolean; cursor: string | null }>;
  systemType?: string;
  stakeParameter?: unknown;
}): CoinReadingClient {
  const pages = overrides.pages ? [...overrides.pages] : undefined;
  return {
    core: {
      listCoins: vi.fn(async ({ coinType }: { coinType?: string }) => {
        if (pages) {
          return pages.shift() ?? { objects: [], hasNextPage: false, cursor: null };
        }
        return {
          objects: overrides.coins?.[coinType ?? ""] ?? [],
          hasNextPage: false,
          cursor: null,
        };
      }),
      getObject: vi.fn(async () => ({
        object: { type: overrides.systemType ?? "0xabc::system::System" },
      })),
      getMoveFunction: vi.fn(async () => ({
        function: { parameters: [{}, { body: overrides.stakeParameter }] },
      })),
    },
  } as unknown as CoinReadingClient;
}

describe("coinBalance", () => {
  it("sums every page of a coin type", async () => {
    const reader = client({
      pages: [
        { objects: [{ objectId: "0x1", balance: "10" }], hasNextPage: true, cursor: "next" },
        { objects: [{ objectId: "0x2", balance: "32" }], hasNextPage: false, cursor: null },
      ],
    });

    await expect(coinBalance(reader, "0xowner", WAL)).resolves.toBe(42n);
    expect(reader.core.listCoins).toHaveBeenCalledTimes(2);
  });
});

describe("writerBalances", () => {
  it("reads SUI and WAL for one writer", async () => {
    const reader = client({
      coins: {
        "0x2::sui::SUI": [{ objectId: "0x1", balance: "300000000" }],
        [WAL]: [{ objectId: "0x2", balance: "500000000" }],
      },
    });

    await expect(writerBalances(reader, "0xwriter", WAL)).resolves.toEqual({
      address: "0xwriter",
      sui: 300_000_000n,
      wal: 500_000_000n,
    });
  });
});

describe("walCoinType", () => {
  it("reads the type argument of the staking module's stake function", async () => {
    const reader = client({
      stakeParameter: {
        $kind: "datatype",
        datatype: {
          typeName: "0x2::coin::Coin",
          typeParameters: [
            { $kind: "datatype", datatype: { typeName: WAL, typeParameters: [] } },
          ],
        },
      },
    });

    await expect(walCoinType(reader, "testnet", {})).resolves.toBe(
      "0x00000000000000000000000000000000000000000000000000000000008190b0::wal::WAL",
    );
  });

  it("prefers an explicit override without touching the chain", async () => {
    const reader = client({});

    await expect(
      walCoinType(reader, "testnet", { WALRUS_WAL_COIN_TYPE: `0x2::wal::WAL` }),
    ).resolves.toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000002::wal::WAL",
    );
    expect(reader.core.getMoveFunction).not.toHaveBeenCalled();
  });

  it("fails loudly when the staking signature does not name a coin", async () => {
    const reader = client({ stakeParameter: { $kind: "u64" } });

    await expect(walCoinType(reader, "testnet", {})).rejects.toThrow(/WAL coin type/);
  });
});

describe("topUpAmount", () => {
  it("leaves a writer above the floor alone, so funding is idempotent", () => {
    expect(topUpAmount(WRITER_SUI_FLOOR_MIST, WRITER_SUI_FLOOR_MIST, WRITER_SUI_TARGET_MIST)).toBe(0n);
  });

  it("tops a short writer up to the target, not to the floor", () => {
    expect(topUpAmount(0n, WRITER_SUI_FLOOR_MIST, WRITER_SUI_TARGET_MIST)).toBe(
      WRITER_SUI_TARGET_MIST,
    );
    expect(
      topUpAmount(10_000_000n, WRITER_SUI_FLOOR_MIST, WRITER_SUI_TARGET_MIST),
    ).toBe(WRITER_SUI_TARGET_MIST - 10_000_000n);
  });
});

describe("formatUnits", () => {
  it("renders nine-decimal base units without rounding to zero", () => {
    expect(formatUnits(0n)).toBe("0.0000");
    expect(formatUnits(1n)).toBe("0.0000");
    expect(formatUnits(300_000_000n)).toBe("0.3000");
    expect(formatUnits(37_123_456_789n)).toBe("37.1234");
  });
});

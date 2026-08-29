import { describe, expect, it } from "vitest";

import { toChainRetentionEpoch } from "./retention-epoch";

const DAY = 86_400_000;

describe("toChainRetentionEpoch", () => {
  it("maps ten Walrus epochs ahead to ten Sui epochs ahead when both epochs last a day", () => {
    expect(
      toChainRetentionEpoch({
        walrusEndEpoch: 250,
        walrusCurrentEpoch: 240,
        walrusEpochDurationMs: DAY,
        suiCurrentEpoch: 900,
        suiEpochDurationMs: DAY,
      }),
    ).toBe(910);
  });

  it("scales by the epoch length ratio (mainnet: Walrus 14 days, Sui 1 day)", () => {
    expect(
      toChainRetentionEpoch({
        walrusEndEpoch: 11,
        walrusCurrentEpoch: 10,
        walrusEpochDurationMs: 14 * DAY,
        suiCurrentEpoch: 500,
        suiEpochDurationMs: DAY,
      }),
    ).toBe(514);
  });

  it("rounds partial Sui epochs up", () => {
    expect(
      toChainRetentionEpoch({
        walrusEndEpoch: 11,
        walrusCurrentEpoch: 10,
        walrusEpochDurationMs: DAY + 1,
        suiCurrentEpoch: 500,
        suiEpochDurationMs: DAY,
      }),
    ).toBe(502);
  });

  it("never answers below the next Sui epoch, even for an already expired Walrus epoch", () => {
    expect(
      toChainRetentionEpoch({
        walrusEndEpoch: 100,
        walrusCurrentEpoch: 240,
        walrusEpochDurationMs: DAY,
        suiCurrentEpoch: 900,
        suiEpochDurationMs: DAY,
      }),
    ).toBe(901);
    expect(
      toChainRetentionEpoch({
        walrusEndEpoch: 241,
        walrusCurrentEpoch: 240,
        walrusEpochDurationMs: DAY,
        suiCurrentEpoch: 900,
        suiEpochDurationMs: DAY,
        minimumEpochsAhead: 3,
      }),
    ).toBe(903);
  });

  it("rejects invalid inputs", () => {
    const valid = {
      walrusEndEpoch: 250,
      walrusCurrentEpoch: 240,
      walrusEpochDurationMs: DAY,
      suiCurrentEpoch: 900,
      suiEpochDurationMs: DAY,
    };
    expect(() => toChainRetentionEpoch({ ...valid, walrusEndEpoch: -1 })).toThrow(RangeError);
    expect(() =>
      toChainRetentionEpoch({ ...valid, walrusCurrentEpoch: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => toChainRetentionEpoch({ ...valid, walrusEpochDurationMs: 0 })).toThrow(RangeError);
    expect(() => toChainRetentionEpoch({ ...valid, suiEpochDurationMs: 0 })).toThrow(RangeError);
    expect(() => toChainRetentionEpoch({ ...valid, suiCurrentEpoch: Number.NaN })).toThrow(RangeError);
    expect(() => toChainRetentionEpoch({ ...valid, minimumEpochsAhead: -1 })).toThrow(RangeError);
  });
});

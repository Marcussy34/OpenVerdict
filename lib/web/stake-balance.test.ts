import { describe, expect, it } from "vitest";

import { MIN_STAKE_MIST, isBelowMinimumStake } from "./stake-balance";

describe("isBelowMinimumStake", () => {
  it("mirrors the Move minimum of 0.1 SUI", () => {
    expect(MIN_STAKE_MIST).toBe("100000000");
  });

  it("is true below the minimum and false at or above it", () => {
    expect(isBelowMinimumStake("0")).toBe(true);
    expect(isBelowMinimumStake("20000000")).toBe(true); // 0.02 SUI
    expect(isBelowMinimumStake("99999999")).toBe(true);
    expect(isBelowMinimumStake(MIN_STAKE_MIST)).toBe(false);
    expect(isBelowMinimumStake("100000001")).toBe(false);
    expect(isBelowMinimumStake("5000000000")).toBe(false);
  });

  it("never blocks the button on an unread or unreadable balance", () => {
    // A failed read is null and a malformed one is not a balance: both must
    // leave the stake button alone rather than locking a funded wallet out.
    for (const value of [null, undefined, "", " ", "-1", "0.1", "1e9", "abc"]) {
      expect(isBelowMinimumStake(value)).toBe(false);
    }
  });

  it("stays exact past the safe integer range", () => {
    // Ten billion SUI in MIST is well beyond Number.MAX_SAFE_INTEGER.
    expect(isBelowMinimumStake("10000000000000000000")).toBe(false);
  });

  it("accepts a minimum from the prepared reservation", () => {
    expect(isBelowMinimumStake("150000000", "200000000")).toBe(true);
    expect(isBelowMinimumStake("150000000", "100000000")).toBe(false);
    // A malformed minimum is ignored rather than trusted.
    expect(isBelowMinimumStake("0", "not-a-number")).toBe(false);
  });
});

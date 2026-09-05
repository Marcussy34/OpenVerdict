import { describe, expect, it } from "vitest";

import {
  MAX_STAKE_MIST,
  MIN_STAKE_MIST,
  isBelowMinimumStake,
  isStakeAmountOutOfRange,
  stakeAmountToMist,
} from "./stake-balance";

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

  it("measures the wallet against the amount the staker chose", () => {
    // Half a SUI in the field: a wallet holding 0.3 SUI can no longer stake,
    // even though it clears the 0.1 SUI minimum.
    const chosen = stakeAmountToMist("0.5");
    expect(chosen).toBe("500000000");
    expect(isBelowMinimumStake("300000000", chosen ?? MIN_STAKE_MIST)).toBe(true);
    expect(isBelowMinimumStake("300000000")).toBe(false);
  });
});

describe("stakeAmountToMist", () => {
  it("converts a decimal SUI amount to whole MIST", () => {
    expect(stakeAmountToMist("0.1")).toBe("100000000");
    expect(stakeAmountToMist("0.5")).toBe("500000000");
    expect(stakeAmountToMist("1")).toBe("1000000000");
    expect(stakeAmountToMist("2.25")).toBe("2250000000");
    expect(stakeAmountToMist(" 1000 ")).toBe(MAX_STAKE_MIST);
    // Nine decimals is one MIST, the smallest thing a stake can name.
    expect(stakeAmountToMist("0.000000001")).toBe("1");
  });

  it("refuses anything that is not a plain decimal amount", () => {
    for (const value of ["", " ", "abc", "-1", "1e9", ".5", "1.", "0.1234567891", "1,5"]) {
      expect(stakeAmountToMist(value)).toBeNull();
    }
  });
});

describe("isStakeAmountOutOfRange", () => {
  it("holds the 0.1 SUI floor and the 1000 SUI ceiling", () => {
    expect(isStakeAmountOutOfRange(MIN_STAKE_MIST)).toBe(false);
    expect(isStakeAmountOutOfRange("500000000")).toBe(false);
    expect(isStakeAmountOutOfRange(MAX_STAKE_MIST)).toBe(false);
    expect(isStakeAmountOutOfRange("99999999")).toBe(true);
    expect(isStakeAmountOutOfRange("1000000000001")).toBe(true);
  });

  it("treats an unparsable amount as out of range", () => {
    // The card refuses rather than guessing: null comes from a bad field.
    expect(isStakeAmountOutOfRange(null)).toBe(true);
    expect(isStakeAmountOutOfRange(stakeAmountToMist("abc"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { formatSui } from "./format-sui";

describe("formatSui", () => {
  it("renders a whole number of SUI without a decimal point", () => {
    expect(formatSui("0")).toBe("0");
    expect(formatSui("1000000000")).toBe("1");
  });

  it("keeps up to four decimals and drops the trailing zeros", () => {
    expect(formatSui("100000000")).toBe("0.1");
    expect(formatSui("1500000000")).toBe("1.5");
    expect(formatSui("1234567890")).toBe("1.2345");
  });

  it("cuts below the fourth decimal rather than rounding up", () => {
    // 0.000099999 SUI is not 0.0001: the number must never read higher than
    // the balance is.
    expect(formatSui("99999")).toBe("0");
    expect(formatSui("999999999")).toBe("0.9999");
  });

  it("groups thousands", () => {
    expect(formatSui("12345678000000000")).toBe("12,345,678");
  });

  it("stays exact past the safe integer range", () => {
    // Ten billion SUI in MIST is far beyond Number.MAX_SAFE_INTEGER, which is
    // why the conversion never touches a JavaScript number.
    expect(formatSui("10000000000123456789")).toBe("10,000,000,000.1234");
  });

  it("returns null for anything that is not a whole number of MIST", () => {
    for (const value of ["", " ", "-1", "1.5", "0x10", "1e9", "abc"]) {
      expect(formatSui(value)).toBeNull();
    }
  });
});

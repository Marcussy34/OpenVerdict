import { describe, expect, it } from "vitest";
import { blake2b256, fromHex, toHex } from "./hash";

describe("blake2b256", () => {
  it("matches the well-known BLAKE2b-256 vector for empty input", () => {
    // blake2b-256("") — published reference vector
    expect(toHex(blake2b256(new Uint8Array(0)))).toBe(
      "0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
    );
  });

  it("matches the reference vector for 'abc'", () => {
    // blake2b-256("abc") — published reference vector
    expect(toHex(blake2b256(new TextEncoder().encode("abc")))).toBe(
      "0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
    );
  });

  it("round-trips hex", () => {
    const bytes = blake2b256(new TextEncoder().encode("openverdict"));
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  it("rejects malformed hex", () => {
    expect(() => fromHex("0xabc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
  });
});

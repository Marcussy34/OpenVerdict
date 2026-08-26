import { describe, expect, it } from "vitest";
import { canonicalJsonBytes, canonicalJsonString } from "./canonical";

describe("canonical JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value = {
      z: 1,
      a: { y: true, x: [3, { b: 2, a: 1 }] },
    };

    expect(canonicalJsonString(value)).toBe(
      '{"a":{"x":[3,{"a":1,"b":2}],"y":true},"z":1}',
    );
  });

  it("produces identical UTF-8 bytes for different insertion orders", () => {
    expect(canonicalJsonBytes({ b: "é", a: 1 })).toEqual(
      canonicalJsonBytes({ a: 1, b: "é" }),
    );
  });

  it("rejects non-JSON values", () => {
    expect(() => canonicalJsonBytes({ value: undefined })).toThrow(/JSON/i);
    expect(() => canonicalJsonBytes(Number.NaN)).toThrow(/finite/i);
  });
});

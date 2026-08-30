import { describe, expect, it } from "vitest";
import { parseSealIdentity, sealIdentityHex, sealInnerId } from "./identity";

const CLAIM = "0x387a344bd5b23c50638421875e0dbaa483597eb2064c05741b5059b1fa121785";
const SEAT = "0x8f9fb2a8210afd239b72ea815c75e507d16c313d75a24f3b0b4bf2a088c416ff";

describe("seal identity", () => {
  it("round-trips claim, seat, phase and deadline", () => {
    const hex = sealIdentityHex({ claimId: CLAIM, jurySeatId: SEAT, phase: 2, deadlineMs: 1_788_100_027_005 });
    expect(hex.startsWith("0x")).toBe(true);
    expect(hex.length).toBe(2 + 73 * 2);
    expect(parseSealIdentity(hex)).toEqual({
      claimId: CLAIM,
      jurySeatId: SEAT,
      phase: 2,
      deadlineMs: 1_788_100_027_005,
    });
  });

  it("lays the bytes out as address, address, u8, u64 little endian", () => {
    const hex = sealIdentityHex({ claimId: CLAIM, jurySeatId: SEAT, phase: 1, deadlineMs: 258 });
    const body = hex.slice(2);
    expect(body.slice(0, 64)).toBe(CLAIM.slice(2));
    expect(body.slice(64, 128)).toBe(SEAT.slice(2));
    expect(body.slice(128, 130)).toBe("01");
    // 258 = 0x0102 as a little-endian u64
    expect(body.slice(130)).toBe("0201000000000000");
  });

  it("rejects malformed identities", () => {
    expect(() => parseSealIdentity("0x0102")).toThrow(/73 bytes/);
    const hex = sealIdentityHex({ claimId: CLAIM, jurySeatId: SEAT, phase: 1, deadlineMs: 1 });
    expect(() => parseSealIdentity(`${hex}00`)).toThrow(/73 bytes/);
    expect(() => sealIdentityHex({ claimId: CLAIM, jurySeatId: SEAT, phase: 3 as 1, deadlineMs: 1 })).toThrow(/phase/);
  });

  it("strips the prefix for the SDK", () => {
    expect(sealInnerId("0xabcd")).toBe("abcd");
    expect(sealInnerId("abcd" as `0x${string}`)).toBe("abcd");
  });
});

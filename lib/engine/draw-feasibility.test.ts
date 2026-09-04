import { describe, expect, it } from "vitest";

import { rosterAdmitsDraw, rosterCanSeat, type DrawSeat } from "./draw-feasibility";

/** One seat; owners are distinct because each seat holds its own signing key. */
function seat(
  owner: string,
  modelId: string,
  role: string,
  active = true,
): DrawSeat {
  return { owner: `0x${owner}`, modelId, role, active };
}

/**
 * The seven seats live on testnet on 2026-09-04: every SOURCE_AUTHENTICITY
 * seat runs deepseek, the four skeptics run two other families.
 */
function demoSeven(): DrawSeat[] {
  return [
    seat("a1", "deepseek", "SOURCE_AUTHENTICITY"),
    seat("a2", "deepseek", "SOURCE_AUTHENTICITY"),
    seat("a3", "deepseek", "SOURCE_AUTHENTICITY"),
    seat("b1", "minimax", "SKEPTIC"),
    seat("b2", "minimax", "SKEPTIC"),
    seat("c1", "kimi", "SKEPTIC"),
    seat("c2", "kimi", "SKEPTIC"),
  ];
}

const stakedDeepseekSkeptic = seat("d1", "deepseek", "SKEPTIC");

describe("rosterAdmitsDraw", () => {
  it("accepts the seven demo seats", () => {
    expect(rosterAdmitsDraw(demoSeven())).toEqual({ ok: true });
  });

  it("accepts the eight seats of the incident", () => {
    // A committee of two deepseek sources, two minimax and one kimi skeptic
    // exists whether or not the staked skeptic is on the roster: an extra
    // record can never remove a committee, so only the greedy draw stalled.
    expect(
      rosterAdmitsDraw([...demoSeven(), stakedDeepseekSkeptic]),
    ).toEqual({ ok: true });
  });

  it("refuses fewer than seven active seats", () => {
    const roster = demoSeven().slice(0, 6);
    expect(rosterAdmitsDraw(roster)).toEqual({
      ok: false,
      reason: "fewer than seven active seats (6 active)",
    });
  });

  it("counts only active seats", () => {
    const roster = [...demoSeven(), stakedDeepseekSkeptic];
    roster[6] = { ...roster[6]!, active: false };
    roster[7] = { ...roster[7]!, active: false };
    expect(rosterAdmitsDraw(roster)).toEqual({
      ok: false,
      reason: "fewer than seven active seats (6 active)",
    });
  });

  it("refuses a roster that runs one model family", () => {
    const roster = demoSeven().map((record) => ({ ...record, modelId: "deepseek" }));
    expect(rosterAdmitsDraw(roster)).toEqual({
      ok: false,
      reason: "no valid committee: only one model family among active seats",
    });
  });

  it("refuses a roster with no source seat", () => {
    const roster = demoSeven().map((record) => ({ ...record, role: "SKEPTIC" }));
    expect(rosterAdmitsDraw(roster)).toEqual({
      ok: false,
      reason: "no valid committee: no active seat holds the SOURCE_AUTHENTICITY role",
    });
  });

  it("refuses a roster whose only two source seats are both needed on the jury", () => {
    // Five seats means three skeptics and two sources (the role cap is three),
    // which leaves no source free for the reserve pair.
    const roster = [
      seat("a1", "deepseek", "SOURCE_AUTHENTICITY"),
      seat("a2", "deepseek", "SOURCE_AUTHENTICITY"),
      seat("b1", "minimax", "SKEPTIC"),
      seat("b2", "minimax", "SKEPTIC"),
      seat("c1", "kimi", "SKEPTIC"),
      seat("c2", "kimi", "SKEPTIC"),
      seat("d1", "qwen", "SKEPTIC"),
    ];
    expect(rosterAdmitsDraw(roster).ok).toBe(false);
  });

  it("refuses a roster whose seats do not hold seven distinct signing keys", () => {
    const roster = [...demoSeven(), seat("c2", "qwen", "SOURCE_AUTHENTICITY")];
    roster[0] = { ...roster[0]!, owner: roster[1]!.owner };
    expect(rosterAdmitsDraw(roster).ok).toBe(false);
  });
});

describe("rosterCanSeat", () => {
  it("refuses the staked deepseek skeptic of the incident", () => {
    const result = rosterCanSeat(demoSeven(), stakedDeepseekSkeptic);

    // Seating it spends one of the two deepseek slots, so only one source can
    // sit, and the other four seats would all be skeptics: one over the cap.
    expect(result).toEqual({
      ok: false,
      reason:
        "a deepseek SKEPTIC seat cannot be seated on any valid committee: " +
        "every SOURCE_AUTHENTICITY seat runs deepseek and the draw seats at " +
        "most 2 deepseek jurors; stake on a SOURCE_AUTHENTICITY seat, or on " +
        "another model family, instead",
    });
  });

  it("accepts a minimax source seat on the same roster", () => {
    expect(
      rosterCanSeat(demoSeven(), seat("d1", "minimax", "SOURCE_AUTHENTICITY")),
    ).toEqual({ ok: true });
  });

  it("accepts a deepseek skeptic once another family carries a source seat", () => {
    const roster = demoSeven();
    roster[2] = seat("a3", "minimax", "SOURCE_AUTHENTICITY");
    expect(rosterCanSeat(roster, stakedDeepseekSkeptic)).toEqual({ ok: true });
  });

  it("accepts a seat on a model family the roster does not run yet", () => {
    expect(
      rosterCanSeat(demoSeven(), seat("d1", "qwen", "SKEPTIC")),
    ).toEqual({ ok: true });
  });

  it("refuses a deactivated seat", () => {
    expect(
      rosterCanSeat(demoSeven(), seat("d1", "minimax", "SKEPTIC", false)),
    ).toEqual({ ok: false, reason: "the seat is not active" });
  });

  it("replaces a roster record that already holds the candidate's key", () => {
    // Restaking seat a1's key as a skeptic leaves two source seats, and both
    // would have to sit on the jury, so no source is left for the reserves.
    const result = rosterCanSeat(demoSeven(), seat("a1", "deepseek", "SKEPTIC"));
    expect(result).toEqual({
      ok: false,
      reason:
        "a deepseek SKEPTIC seat cannot be seated on any valid committee: " +
        "every SOURCE_AUTHENTICITY seat runs deepseek and the draw seats at " +
        "most 2 deepseek jurors; stake on a SOURCE_AUTHENTICITY seat instead",
    });
  });
});

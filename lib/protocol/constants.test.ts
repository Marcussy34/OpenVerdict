import { describe, expect, it } from "vitest";
import { CLAIM_MODE, CLAIM_RESULT, CLAIM_STATE, OUTCOME } from "./constants";

describe("protocol constants", () => {
  it("matches the Move outcome and result codes", () => {
    expect(OUTCOME).toEqual({ NONE: 0, YES: 1, NO: 2, UNSURE: 3 });
    expect(CLAIM_RESULT).toEqual({
      NONE: 0,
      YES: 1,
      NO: 2,
      UNSURE: 3,
      UNRESOLVED: 4,
    });
  });

  it("matches the Move mode and lifecycle state codes", () => {
    expect(CLAIM_MODE).toEqual({
      DIRECT_REVIEW: 1,
      OPTIMISTIC_SETTLEMENT: 2,
    });
    expect(CLAIM_STATE).toEqual({
      CREATED: 0,
      PROPOSED: 1,
      CHALLENGED: 2,
      REVIEW_REQUESTED: 3,
      COMMIT_1: 4,
      REVEAL_1: 5,
      DISCUSSION: 6,
      COMMIT_2: 7,
      REVEAL_2: 8,
      FINALIZED_UNCHALLENGED: 9,
      FINALIZED_REVIEWED: 10,
      UNRESOLVED: 11,
      CANCELLED: 12,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { ClaimInspection } from "./contract";
import { CLAIM_MODE, CLAIM_STATE } from "../protocol";
import { isStrandedDiscussion } from "./claim-lifecycle";

const NOW = 1_000_000;

function claim(overrides: {
  state: number;
  secondRevealDeadlineMs?: number;
  secondCommitDeadlineMs?: number;
  discussionDeadlineMs?: number;
  phases?: (1 | 2)[];
}): ClaimInspection {
  return {
    claimId: "0xclaim",
    mode: CLAIM_MODE.DIRECT_REVIEW,
    state: overrides.state as ClaimInspection["state"],
    statement: "",
    resolutionCriteria: "",
    deadlines: {
      secondRevealDeadlineMs: overrides.secondRevealDeadlineMs ?? NOW + 60_000,
      secondCommitDeadlineMs: overrides.secondCommitDeadlineMs ?? NOW + 45_000,
      discussionDeadlineMs: overrides.discussionDeadlineMs ?? NOW + 30_000,
    } as ClaimInspection["deadlines"],
    evidenceRoots: (overrides.phases ?? [1]).map((phase) => ({
      phase,
      root: "0x00",
      bundleId: `bundle-${phase}`,
    })),
    commitments: [],
  } as ClaimInspection;
}

describe("isStrandedDiscussion", () => {
  it("returns false for non-discussion states", () => {
    expect(isStrandedDiscussion(claim({ state: CLAIM_STATE.CREATED }), NOW)).toBe(false);
    expect(isStrandedDiscussion(claim({ state: CLAIM_STATE.COMMIT_1 }), NOW)).toBe(false);
    expect(isStrandedDiscussion(claim({ state: CLAIM_STATE.REVEAL_1 }), NOW)).toBe(false);
    expect(
      isStrandedDiscussion(
        claim({ state: CLAIM_STATE.REVEAL_2, secondRevealDeadlineMs: NOW - 1 }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.FINALIZED_REVIEWED,
          discussionDeadlineMs: NOW - 1,
          secondCommitDeadlineMs: NOW - 1,
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.UNRESOLVED,
          discussionDeadlineMs: NOW - 1,
          secondCommitDeadlineMs: NOW - 1,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false for discussion before every deadline", () => {
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.DISCUSSION,
          discussionDeadlineMs: NOW + 30_000,
          secondCommitDeadlineMs: NOW + 45_000,
          phases: [1],
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("returns true for discussion past secondCommitDeadlineMs", () => {
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.DISCUSSION,
          discussionDeadlineMs: NOW - 120_000,
          secondCommitDeadlineMs: NOW - 1,
          phases: [1, 2],
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("returns true for discussion past discussionDeadlineMs without a phase-2 root", () => {
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.DISCUSSION,
          discussionDeadlineMs: NOW - 1,
          secondCommitDeadlineMs: NOW + 45_000,
          phases: [1],
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("returns false for discussion past discussionDeadlineMs with a phase-2 root but before secondCommitDeadlineMs", () => {
    expect(
      isStrandedDiscussion(
        claim({
          state: CLAIM_STATE.DISCUSSION,
          discussionDeadlineMs: NOW - 1,
          secondCommitDeadlineMs: NOW + 45_000,
          phases: [1, 2],
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ClaimInspection } from "../lib/engine/contract";
import { CLAIM_MODE, CLAIM_STATE } from "../lib/protocol";
import { isDead, urgency } from "./resolution-worker";

const NOW = 1_000_000;

function claim(overrides: {
  state: number;
  secondRevealDeadlineMs?: number;
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

describe("resolution worker triage", () => {
  it("skips claims that can never change on chain again", () => {
    expect(isDead(claim({ state: CLAIM_STATE.FINALIZED_REVIEWED }), NOW)).toBe(true);
    expect(isDead(claim({ state: CLAIM_STATE.UNRESOLVED }), NOW)).toBe(true);
    // Every deadline has passed: no phase can be entered or finalized.
    expect(
      isDead(claim({ state: CLAIM_STATE.REVEAL_1, secondRevealDeadlineMs: NOW - 1 }), NOW),
    ).toBe(true);
    // Discussion closed without phase-two evidence: round two cannot open.
    expect(
      isDead(
        claim({ state: CLAIM_STATE.DISCUSSION, discussionDeadlineMs: NOW - 1, phases: [1] }),
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps claims that still have a move available", () => {
    expect(isDead(claim({ state: CLAIM_STATE.REVEAL_1 }), NOW)).toBe(false);
    expect(isDead(claim({ state: CLAIM_STATE.COMMIT_1 }), NOW)).toBe(false);
    // Discussion closed with phase-two evidence bound: round two can open.
    expect(
      isDead(
        claim({ state: CLAIM_STATE.DISCUSSION, discussionDeadlineMs: NOW - 1, phases: [1, 2] }),
        NOW,
      ),
    ).toBe(false);
    expect(isDead(claim({ state: CLAIM_STATE.DISCUSSION }), NOW)).toBe(false);
  });

  it("orders reveal phases before commit and selection, then the rest", () => {
    const states = [
      CLAIM_STATE.DISCUSSION,
      CLAIM_STATE.COMMIT_2,
      CLAIM_STATE.REVEAL_1,
      CLAIM_STATE.REVIEW_REQUESTED,
      CLAIM_STATE.REVEAL_2,
    ];
    const ordered = [...states].sort((a, b) => urgency(a) - urgency(b));
    expect(ordered.slice(0, 2)).toEqual([CLAIM_STATE.REVEAL_1, CLAIM_STATE.REVEAL_2]);
    expect(ordered.slice(2, 4)).toEqual([CLAIM_STATE.COMMIT_2, CLAIM_STATE.REVIEW_REQUESTED]);
    expect(ordered[4]).toBe(CLAIM_STATE.DISCUSSION);
  });
});

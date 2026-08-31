import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimInspection } from "../lib/engine/contract";
import { CLAIM_MODE, CLAIM_STATE } from "../lib/protocol";
import {
  allExpectedSeatsCommitted,
  allExpectedSeatsRevealed,
  backoffDelayMs,
  isDead,
  resolveClaim,
  urgency,
} from "./resolution-worker";

const NOW = 1_000_000;

function claim(overrides: {
  state: number;
  secondRevealDeadlineMs?: number;
  secondCommitDeadlineMs?: number;
  discussionDeadlineMs?: number;
  phases?: (1 | 2)[];
  round?: {
    phase: 1 | 2;
    expected: number;
    committed: number;
    revealed: number;
  };
}): ClaimInspection {
  const expectedJurySeatIds = Array.from(
    { length: overrides.round?.expected ?? 0 },
    (_, index) => `seat-${index}`,
  );
  return {
    claimId: "0xclaim",
    mode: CLAIM_MODE.DIRECT_REVIEW,
    state: overrides.state as ClaimInspection["state"],
    statement: "",
    resolutionCriteria: "",
    deadlines: {
      firstCommitDeadlineMs: NOW + 15_000,
      firstRevealDeadlineMs: NOW + 20_000,
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
    ...(overrides.round === undefined
      ? {}
      : {
          rounds: [
            {
              phase: overrides.round.phase,
              expectedJurySeatIds,
              committedJurySeatIds: expectedJurySeatIds.slice(
                0,
                overrides.round.committed,
              ),
              revealedJurySeatIds: expectedJurySeatIds.slice(
                0,
                overrides.round.revealed,
              ),
            },
          ],
        }),
  } as ClaimInspection;
}

function resolutionEngine(inspected: ClaimInspection) {
  return {
    selectCommittee: vi.fn(async () => ({ digest: "select" })),
    advance: vi.fn(async () => null),
    votesReveal: vi.fn(async () => []),
    finalize: vi.fn(async () => ({
      claimId: inspected.claimId,
      result: "YES" as const,
      truthScoreBps: 9_000,
      certificateId: "certificate",
      digest: "finalize",
    })),
    inspect: vi.fn(async () => inspected),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolution worker triage", () => {
  it("skips claims that can never change on chain again", () => {
    expect(isDead(claim({ state: CLAIM_STATE.FINALIZED_REVIEWED }), NOW)).toBe(true);
    expect(isDead(claim({ state: CLAIM_STATE.UNRESOLVED }), NOW)).toBe(true);
    // Discussion closed without phase-two evidence: round two cannot open.
    expect(
      isDead(
        claim({ state: CLAIM_STATE.DISCUSSION, discussionDeadlineMs: NOW - 1, phases: [1] }),
        NOW,
      ),
    ).toBe(true);
    // Round two must open before its own commit deadline (jury.move), so a
    // discussion still open after it is stranded even with phase-two roots.
    expect(
      isDead(
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

  it("fails closed unless every expected seat is ready", () => {
    const partial = claim({
      state: CLAIM_STATE.COMMIT_1,
      round: { phase: 1, expected: 5, committed: 4, revealed: 4 },
    });
    const complete = claim({
      state: CLAIM_STATE.REVEAL_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 5 },
    });

    expect(allExpectedSeatsCommitted(partial, 1)).toBe(false);
    expect(allExpectedSeatsRevealed(partial, 1)).toBe(false);
    expect(allExpectedSeatsCommitted(complete, 1)).toBe(true);
    expect(allExpectedSeatsRevealed(complete, 1)).toBe(true);
  });

  it("advances a fully committed round before its commit deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const ready = claim({
      state: CLAIM_STATE.COMMIT_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 0 },
    });
    const engine = resolutionEngine(ready);

    await resolveClaim(engine, ready);

    expect(engine.advance).toHaveBeenCalledWith(ready.claimId);
  });

  it("keeps a partial commit round closed before its deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const partial = claim({
      state: CLAIM_STATE.COMMIT_1,
      round: { phase: 1, expected: 5, committed: 4, revealed: 0 },
    });
    const engine = resolutionEngine(partial);

    await resolveClaim(engine, partial);

    expect(engine.advance).not.toHaveBeenCalled();
  });

  it("keeps the commit deadline fallback for a missing seat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const partial = claim({
      state: CLAIM_STATE.COMMIT_1,
      round: { phase: 1, expected: 5, committed: 4, revealed: 0 },
    });
    partial.deadlines.firstCommitDeadlineMs = NOW - 3_000;
    const engine = resolutionEngine(partial);

    await resolveClaim(engine, partial);

    expect(engine.advance).toHaveBeenCalledWith(partial.claimId);
  });

  it("finalizes a fully revealed round before its reveal deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const beforeReveal = claim({
      state: CLAIM_STATE.REVEAL_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 4 },
    });
    const complete = claim({
      state: CLAIM_STATE.REVEAL_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 5 },
    });
    const engine = resolutionEngine(complete);

    await resolveClaim(engine, beforeReveal);

    expect(engine.votesReveal).toHaveBeenCalledWith(beforeReveal.claimId, 1);
    expect(engine.finalize).toHaveBeenCalledWith(beforeReveal.claimId);
    expect(engine.advance).not.toHaveBeenCalled();
  });

  it("does not finalize a partial reveal round before its deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const partial = claim({
      state: CLAIM_STATE.REVEAL_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 4 },
    });
    const engine = resolutionEngine(partial);

    await resolveClaim(engine, partial);

    expect(engine.votesReveal).toHaveBeenCalledWith(partial.claimId, 1);
    expect(engine.finalize).not.toHaveBeenCalled();
  });

  it("keeps the reveal deadline fallback for a missing reveal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const partial = claim({
      state: CLAIM_STATE.REVEAL_1,
      round: { phase: 1, expected: 5, committed: 5, revealed: 4 },
    });
    partial.deadlines.firstRevealDeadlineMs = NOW - 3_000;
    const engine = resolutionEngine(partial);

    await resolveClaim(engine, partial);

    expect(engine.finalize).toHaveBeenCalledWith(partial.claimId);
  });

  it("keeps claims that still have a move available", () => {
    expect(isDead(claim({ state: CLAIM_STATE.REVEAL_1 }), NOW)).toBe(false);
    expect(isDead(claim({ state: CLAIM_STATE.COMMIT_1 }), NOW)).toBe(false);
    // A reveal phase past its deadline is exactly when finalize is allowed.
    expect(
      isDead(claim({ state: CLAIM_STATE.REVEAL_2, secondRevealDeadlineMs: NOW - 1 }), NOW),
    ).toBe(false);
    // Discussion closed with phase-two evidence bound: round two can open.
    expect(
      isDead(
        claim({ state: CLAIM_STATE.DISCUSSION, discussionDeadlineMs: NOW - 1, phases: [1, 2] }),
        NOW,
      ),
    ).toBe(false);
    expect(isDead(claim({ state: CLAIM_STATE.DISCUSSION }), NOW)).toBe(false);
  });

  it("backs off a failing claim exponentially up to ten minutes", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(5)).toBe(480_000);
    expect(backoffDelayMs(6)).toBe(600_000);
    expect(backoffDelayMs(20)).toBe(600_000);
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

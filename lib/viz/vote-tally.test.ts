import { describe, expect, it } from "vitest";

import type { ClaimInspection, ResolutionEvent } from "../engine/contract";
import { CLAIM_STATE } from "../protocol/constants";
import { voteTally } from "./vote-tally";

const T0 = Date.UTC(2026, 8, 2, 3, 38, 0);
const ROUND_ONE = ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5"];
const ROUND_TWO = ["seat-6", "seat-7", "seat-8", "seat-9", "seat-10"];

function seat(
  jurySeatId: string,
  flags: { committed?: boolean; revealed?: boolean } = {},
): ClaimInspection["commitments"][number] {
  return {
    jurySeatId,
    agentProfileId: `agent-${jurySeatId}`,
    committed: flags.committed ?? false,
    revealed: flags.revealed ?? false,
  };
}

function event(sequence: number, kind: string, atMs: number, jurySeatId: string): ResolutionEvent {
  return {
    eventId: `event-${sequence}`,
    claimId: "claim-1",
    sequence,
    phase: "INFERENCE_1",
    kind,
    source: "ENGINE",
    visibility: "PUBLIC_NOW",
    occurredAt: new Date(atMs).toISOString(),
    payload: { jurySeatId },
  };
}

// Round one: three seats seal and reveal, two fail closed.
const ROUND_ONE_EVENTS: ResolutionEvent[] = [
  event(1, "vote_committed", T0 + 60_000, "seat-2"),
  event(2, "vote_committed", T0 + 70_000, "seat-4"),
  event(3, "vote_committed", T0 + 80_000, "seat-5"),
  event(4, "vote_revealed", T0 + 200_000, "seat-2"),
  event(5, "vote_revealed", T0 + 201_000, "seat-4"),
  event(6, "vote_revealed", T0 + 202_000, "seat-5"),
];
// Round two: the table-vote seats start working at T0 + 400s, four seal.
const ROUND_TWO_EVENTS: ResolutionEvent[] = [
  event(7, "inference_completed", T0 + 400_000, "seat-6"),
  event(8, "vote_committed", T0 + 420_000, "seat-6"),
  event(9, "vote_committed", T0 + 421_000, "seat-7"),
  event(10, "vote_committed", T0 + 422_000, "seat-8"),
  event(11, "vote_committed", T0 + 423_000, "seat-9"),
  event(12, "vote_revealed", T0 + 500_000, "seat-6"),
  event(13, "vote_revealed", T0 + 501_000, "seat-7"),
  event(14, "vote_revealed", T0 + 502_000, "seat-8"),
  event(15, "vote_revealed", T0 + 503_000, "seat-9"),
];

const ONE_ROUND = {
  state: CLAIM_STATE.FINALIZED_REVIEWED,
  commitments: [
    seat("seat-1"),
    seat("seat-2", { committed: true, revealed: true }),
    seat("seat-3"),
    seat("seat-4", { committed: true, revealed: true }),
    seat("seat-5", { committed: true, revealed: true }),
  ],
};

const TWO_ROUNDS = {
  state: CLAIM_STATE.UNRESOLVED,
  commitments: [
    ...ONE_ROUND.commitments,
    seat("seat-6", { committed: true, revealed: true }),
    seat("seat-7", { committed: true, revealed: true }),
    seat("seat-8", { committed: true, revealed: true }),
    seat("seat-9", { committed: true, revealed: true }),
    seat("seat-10"),
  ],
  rounds: [
    {
      phase: 1 as const,
      expectedJurySeatIds: ROUND_ONE,
      committedJurySeatIds: ["seat-2", "seat-4", "seat-5"],
      revealedJurySeatIds: ["seat-2", "seat-4", "seat-5"],
    },
    {
      phase: 2 as const,
      expectedJurySeatIds: ROUND_TWO,
      committedJurySeatIds: ROUND_TWO.slice(0, 4),
      revealedJurySeatIds: ROUND_TWO.slice(0, 4),
    },
  ],
};

describe("voteTally", () => {
  it("counts the record's flags when no replay runs", () => {
    expect(voteTally(ONE_ROUND, ROUND_ONE_EVENTS)).toEqual({
      round: 1,
      rounds: 1,
      seats: 5,
      sealed: 3,
      revealed: 3,
    });
  });

  it("follows the replay cursor through round one", () => {
    expect(voteTally(ONE_ROUND, ROUND_ONE_EVENTS, T0 + 10_000)).toMatchObject({
      sealed: 0,
      revealed: 0,
    });
    expect(voteTally(ONE_ROUND, ROUND_ONE_EVENTS, T0 + 75_000)).toMatchObject({
      sealed: 2,
      revealed: 0,
    });
    expect(voteTally(ONE_ROUND, ROUND_ONE_EVENTS, T0 + 201_000)).toMatchObject({
      sealed: 3,
      revealed: 2,
    });
  });

  it("shows one round at a time, never both added together", () => {
    // Settled after two rounds: the deciding round is in view.
    expect(voteTally(TWO_ROUNDS, [...ROUND_ONE_EVENTS, ...ROUND_TWO_EVENTS])).toEqual({
      round: 2,
      rounds: 2,
      seats: 5,
      sealed: 4,
      revealed: 4,
    });
    // During the debate the completed first round stays in view.
    expect(
      voteTally({ ...TWO_ROUNDS, state: CLAIM_STATE.DISCUSSION }, ROUND_ONE_EVENTS),
    ).toMatchObject({ round: 1, rounds: 2, sealed: 3, revealed: 3 });
  });

  it("switches to round two when its seats start working in a replay", () => {
    const events = [...ROUND_ONE_EVENTS, ...ROUND_TWO_EVENTS];
    expect(voteTally(TWO_ROUNDS, events, T0 + 300_000)).toEqual({
      round: 1,
      rounds: 2,
      seats: 5,
      sealed: 3,
      revealed: 3,
    });
    expect(voteTally(TWO_ROUNDS, events, T0 + 400_000)).toMatchObject({
      round: 2,
      sealed: 0,
      revealed: 0,
    });
    expect(voteTally(TWO_ROUNDS, events, T0 + 422_500)).toMatchObject({
      round: 2,
      sealed: 3,
      revealed: 0,
    });
    expect(voteTally(TWO_ROUNDS, events, T0 + 600_000)).toMatchObject({
      round: 2,
      sealed: 4,
      revealed: 4,
    });
  });

  it("keeps the flag counts for a record without vote events", () => {
    expect(voteTally(ONE_ROUND, [], T0 + 10_000)).toMatchObject({ sealed: 3, revealed: 3 });
  });
});

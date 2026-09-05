import type { ClaimInspection, ResolutionEvent } from "../engine/contract";
import { CLAIM_STATE } from "../protocol/constants";
import { eventSeatId, eventTime } from "./deliberation-graph";

/** Sealed and revealed votes of the round in view, as the rail's two tiles say them. */
export type VoteTally = {
  /** The round the counts describe. */
  round: 1 | 2;
  /** Rounds the record holds, so a two-round claim can say "round 1 of 2". */
  rounds: 1 | 2;
  /** Seats drawn for that round, the denominator. */
  seats: number;
  sealed: number;
  revealed: number;
};

type TallyClaim = Pick<ClaimInspection, "state" | "commitments" | "rounds">;

/**
 * Counts one round's votes, never both rounds added together. Without a
 * cursor the record's own flags count: round two is in view once its sealed
 * ballot opened (state COMMIT_2 and later), round one before that, so the
 * debate window still shows the completed first round. With a replay cursor
 * `atMs` only the vote events at or before that moment count, and round two
 * comes into view with its first seat event, the moment the graph shows the
 * table-vote seats. A record with no vote events keeps the flag counts, so
 * an old claim's tiles never sit at zero during a replay.
 */
export function voteTally(
  claim: TallyClaim,
  events: readonly ResolutionEvent[],
  atMs?: number,
): VoteTally {
  const phaseTwoSeats = new Set(
    claim.rounds?.find((round) => round.phase === 2)?.expectedJurySeatIds ?? [],
  );
  const roundOne = claim.commitments.filter((seat) => !phaseTwoSeats.has(seat.jurySeatId));
  const roundTwo = claim.commitments.filter((seat) => phaseTwoSeats.has(seat.jurySeatId));
  const rounds: 1 | 2 = roundTwo.length > 0 ? 2 : 1;

  const voteEvents = events.filter(
    (event) => event.kind === "vote_committed" || event.kind === "vote_revealed",
  );
  if (atMs === undefined || voteEvents.length === 0) {
    const round: 1 | 2 = rounds === 2 && claim.state >= CLAIM_STATE.COMMIT_2 ? 2 : 1;
    const seats = round === 2 ? roundTwo : roundOne;
    return {
      round,
      rounds,
      seats: seats.length,
      sealed: seats.filter((seat) => seat.committed).length,
      revealed: seats.filter((seat) => seat.revealed).length,
    };
  }

  // Round two opens with its first seat event, the moment the graph shows its seats.
  let roundTwoOpensAt: number | undefined;
  for (const event of events) {
    const seatId = eventSeatId(event);
    if (seatId === undefined || !phaseTwoSeats.has(seatId)) continue;
    const at = eventTime(event);
    if (at !== undefined && (roundTwoOpensAt === undefined || at < roundTwoOpensAt)) {
      roundTwoOpensAt = at;
    }
  }
  const round: 1 | 2 =
    rounds === 2 && roundTwoOpensAt !== undefined && atMs >= roundTwoOpensAt ? 2 : 1;
  const seats = round === 2 ? roundTwo : roundOne;
  const seatIds = new Set(seats.map((seat) => seat.jurySeatId));

  // Distinct seats with that event at or before the cursor.
  const seatsWith = (kind: string): number => {
    const done = new Set<string>();
    for (const event of voteEvents) {
      if (event.kind !== kind) continue;
      const seatId = eventSeatId(event);
      const at = eventTime(event);
      if (seatId === undefined || !seatIds.has(seatId) || at === undefined || at > atMs) continue;
      done.add(seatId);
    }
    return done.size;
  };

  return {
    round,
    rounds,
    seats: seats.length,
    sealed: seatsWith("vote_committed"),
    revealed: seatsWith("vote_revealed"),
  };
}

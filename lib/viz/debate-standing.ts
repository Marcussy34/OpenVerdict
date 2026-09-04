/**
 * Where the table stands after the public debate: the counts per stance, the
 * seats that moved and how the debate ended, derived from the turns and the
 * round-one outcomes (docs/superpowers/specs/2026-09-04-deliberation-conversation-design.md).
 *
 * Pure and clock-free, and no model call: every line here is arithmetic over
 * the record. Seat numbers are the record's own, the phase-1 seat order the
 * engine numbers turns by, so the counts read with the same numbers the
 * jurors use inside their arguments.
 *
 * This is a description of the discussion, never a verdict: the sealed table
 * vote of round two decides the claim.
 */
import type { DeliberationTurnPublic } from "../engine/contract";

export type DebateStance = "YES" | "NO" | "UNSURE";

/** One round-one debater: its number in the debate and where it started. */
export type DebateStandingSeat = {
  jurySeatId: string;
  /** The seat number the debate itself uses (its place in the phase-1 order). */
  seatIndex: number;
  /** The seat's revealed round-one stance, absent when it never revealed. */
  outcome?: DebateStance;
};

/** One seat changing its stance, and the point it answered when it did. */
export type DebateMove = {
  /** The turn that moved, so a bubble can find its own move. */
  ordinal: number;
  seatIndex: number;
  exchange: 1 | 2 | 3;
  from: DebateStance;
  to: DebateStance;
  /** The seat whose point moved it: the one it answered, else the one that
   *  spoke before it. Null only when nobody had spoken yet. */
  afterSeatIndex: number | null;
};

export type DebateEnding =
  /** No turn has been spoken yet. */
  | { kind: "none" }
  /** Still going: the exchange now under way. */
  | { kind: "running"; exchange: 1 | 2 | 3 }
  /** A whole exchange passed with nobody moving. */
  | { kind: "converged"; exchange: 1 | 2 | 3 }
  /** The debate used its exchanges without converging. */
  | { kind: "exhausted"; exchanges: 1 | 2 | 3 };

export type DebateStanding = {
  /** Counts per stance, largest first; only stances a seat actually holds. */
  counts: { stance: DebateStance; count: number }[];
  /** Each debater's stance now: its last spoken one, else its round-one vote. */
  stanceBySeat: Map<number, DebateStance>;
  moves: DebateMove[];
  /** The same moves, keyed by the turn that made them. */
  moveByOrdinal: Map<number, DebateMove>;
  ending: DebateEnding;
  /** Exchanges in which every debater has had a turn, counted from the first. */
  completeExchanges: number;
  spokenTurns: number;
  skippedTurns: number;
};

/** Ties break the way the protocol lists outcomes, so counts are stable. */
const STANCE_ORDER: readonly DebateStance[] = ["YES", "NO", "UNSURE"];

/**
 * The table as it stands. `running` keeps the card honest during a live
 * debate and during a replay: the ending is only read off the record once
 * every turn is in.
 */
export function debateStanding(input: {
  seats: readonly DebateStandingSeat[];
  turns: readonly DeliberationTurnPublic[];
  /** True while more turns are still to come (live, or mid-replay). */
  running?: boolean;
  convergedAfterExchange?: 1 | 2 | 3 | null;
}): DebateStanding {
  const { seats, running = false } = input;
  const seatIndexes = new Set(seats.map((seat) => seat.seatIndex));
  const indexBySeatId = new Map(seats.map((seat) => [seat.jurySeatId, seat.seatIndex]));
  const turns = [...input.turns].sort((left, right) => left.ordinal - right.ordinal);

  // Everyone starts on their round-one vote; a spoken turn moves them.
  const stanceBySeat = new Map<number, DebateStance>();
  for (const seat of seats) {
    if (seat.outcome !== undefined) stanceBySeat.set(seat.seatIndex, seat.outcome);
  }

  const moves: DebateMove[] = [];
  let spokenTurns = 0;
  let skippedTurns = 0;
  let lastSpeaker: number | null = null;
  for (const turn of turns) {
    const seatIndex = indexBySeatId.get(turn.jurySeatId);
    if (turn.status === "SKIPPED") {
      skippedTurns += 1;
      continue;
    }
    spokenTurns += 1;
    if (seatIndex === undefined || turn.stance === undefined) continue;
    const from = stanceBySeat.get(seatIndex);
    if (from !== undefined && from !== turn.stance) {
      // A V4 turn names the point it answers, which is the point that moved
      // it; older turns only have the speaker before them.
      const answering =
        typeof turn.answering === "number" && seatIndexes.has(turn.answering)
          ? turn.answering
          : null;
      moves.push({
        ordinal: turn.ordinal,
        seatIndex,
        exchange: turn.exchange,
        from,
        to: turn.stance,
        afterSeatIndex: answering ?? lastSpeaker,
      });
    }
    stanceBySeat.set(seatIndex, turn.stance);
    lastSpeaker = seatIndex;
  }

  const tally = new Map<DebateStance, number>();
  for (const stance of stanceBySeat.values()) {
    tally.set(stance, (tally.get(stance) ?? 0) + 1);
  }
  const counts = [...tally.entries()]
    .map(([stance, count]) => ({ stance, count }))
    .sort(
      (left, right) =>
        right.count - left.count
        || STANCE_ORDER.indexOf(left.stance) - STANCE_ORDER.indexOf(right.stance),
    );

  return {
    counts,
    stanceBySeat,
    moves,
    moveByOrdinal: new Map(moves.map((move) => [move.ordinal, move])),
    ending: endingOf(turns, seats.length, running, input.convergedAfterExchange ?? null),
    completeExchanges: completeExchanges(turns, seats.length),
    spokenTurns,
    skippedTurns,
  };
}

/** Exchanges where every debater has a turn, counted from the first one. */
function completeExchanges(
  turns: readonly DeliberationTurnPublic[],
  debaters: number,
): number {
  if (debaters === 0) return 0;
  let complete = 0;
  for (const exchange of [1, 2, 3] as const) {
    const spoke = new Set(
      turns.filter((turn) => turn.exchange === exchange).map((turn) => turn.jurySeatId),
    );
    if (spoke.size < debaters) break;
    complete += 1;
  }
  return complete;
}

function endingOf(
  turns: readonly DeliberationTurnPublic[],
  debaters: number,
  running: boolean,
  convergedAfterExchange: 1 | 2 | 3 | null,
): DebateEnding {
  const last = turns.at(-1);
  if (last === undefined) return running ? { kind: "running", exchange: 1 } : { kind: "none" };
  const complete = completeExchanges(turns, debaters);
  // Convergence is a recorded fact, but only once the exchange that reached
  // it is whole here: a replay must not announce an ending it has not shown.
  if (convergedAfterExchange !== null && complete >= convergedAfterExchange) {
    return { kind: "converged", exchange: convergedAfterExchange };
  }
  if (running) {
    // The exchange under way: the last turn's, or the next one when that
    // exchange is already full.
    const exchange = complete >= last.exchange && last.exchange < 3
      ? ((last.exchange + 1) as 1 | 2 | 3)
      : last.exchange;
    return { kind: "running", exchange };
  }
  if (convergedAfterExchange !== null) {
    return { kind: "converged", exchange: convergedAfterExchange };
  }
  return { kind: "exhausted", exchanges: last.exchange };
}

/** "4 NO, 1 UNSURE"; the empty string before any seat holds a stance. */
export function standingCountsText(counts: readonly { stance: DebateStance; count: number }[]): string {
  return counts.map((entry) => `${entry.count} ${entry.stance}`).join(", ");
}

/** "Seat 2 moved from YES to UNSURE after Seat 5's turn." */
export function moveSentence(move: DebateMove, seatLabel: (index: number) => string): string {
  const after =
    move.afterSeatIndex === null ? "" : ` after ${seatLabel(move.afterSeatIndex)}'s turn`;
  return `${seatLabel(move.seatIndex)} moved from ${move.from} to ${move.to}${after}.`;
}

/** One sentence for how the debate ended, or where it has got to. */
export function endingSentence(ending: DebateEnding): string {
  switch (ending.kind) {
    case "converged":
      return `The debate stopped after exchange ${ending.exchange}: nobody moved.`;
    case "exhausted":
      return ending.exchanges === 3
        ? "The debate ran its three exchanges."
        : `The debate ended after exchange ${ending.exchanges}.`;
    case "running":
      return `Exchange ${ending.exchange} of 3.`;
    default:
      return "The debate has not started.";
  }
}

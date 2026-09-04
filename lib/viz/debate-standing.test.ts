import { describe, expect, it } from "vitest";

import type { DeliberationTurnPublic } from "../engine/contract";
import {
  debateStanding,
  endingSentence,
  moveSentence,
  standingCountsText,
  type DebateStandingSeat,
} from "./debate-standing";

const START_MS = Date.parse("2026-09-04T00:00:00.000Z");

/** Five debaters, three YES and two NO, numbered as the record numbers them. */
const SEATS: DebateStandingSeat[] = [
  { jurySeatId: "seat-0", seatIndex: 0, outcome: "NO" },
  { jurySeatId: "seat-1", seatIndex: 1, outcome: "YES" },
  { jurySeatId: "seat-2", seatIndex: 2, outcome: "NO" },
  { jurySeatId: "seat-3", seatIndex: 3, outcome: "YES" },
  { jurySeatId: "seat-4", seatIndex: 4, outcome: "YES" },
];

let ordinal = 0;
function turn(
  seatIndex: number,
  exchange: 1 | 2 | 3,
  overrides: Partial<DeliberationTurnPublic> = {},
): DeliberationTurnPublic {
  const at = ordinal;
  ordinal += 1;
  return {
    claimId: "claim-1",
    jurySeatId: `seat-${seatIndex}`,
    agentProfileId: `agent-${seatIndex}`,
    ordinal: at,
    exchange,
    argument: "an argument",
    citations: [],
    status: "SPOKEN",
    atMs: START_MS + at * 1_000,
    ...overrides,
  };
}

/** One full exchange in seat order, everyone holding their stance. */
function heldExchange(
  exchange: 1 | 2 | 3,
  stances: readonly ("YES" | "NO" | "UNSURE")[],
): DeliberationTurnPublic[] {
  return stances.map((stance, seatIndex) => turn(seatIndex, exchange, { stance }));
}

function seatLabel(index: number): string {
  return `Seat ${index}`;
}

describe("where the table stands", () => {
  it("counts the stances a debate ends on and names who moved", () => {
    ordinal = 0;
    const turns = [
      ...heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
      // Seat 2 answers seat 1 and changes to YES; the rest hold.
      turn(0, 2, { stance: "NO", answering: 4 }),
      turn(1, 2, { stance: "YES", answering: 0 }),
      turn(2, 2, { stance: "YES", answering: 1 }),
      turn(3, 2, { stance: "YES", answering: 2 }),
      turn(4, 2, { stance: "YES", answering: 3 }),
    ];

    const standing = debateStanding({
      seats: SEATS,
      turns,
      convergedAfterExchange: null,
    });

    expect(standing.counts).toEqual([
      { stance: "YES", count: 4 },
      { stance: "NO", count: 1 },
    ]);
    expect(standingCountsText(standing.counts)).toBe("4 YES, 1 NO");
    expect(standing.moves).toEqual([
      {
        ordinal: 7,
        seatIndex: 2,
        exchange: 2,
        from: "NO",
        to: "YES",
        afterSeatIndex: 1,
      },
    ]);
    expect(moveSentence(standing.moves[0]!, seatLabel)).toBe(
      "Seat 2 moved from NO to YES after Seat 1's turn.",
    );
    // The move is findable from the turn that made it, for its own bubble.
    expect(standing.moveByOrdinal.get(7)?.from).toBe("NO");
    expect(standing.completeExchanges).toBe(2);
    expect(standing.spokenTurns).toBe(10);
    expect(standing.skippedTurns).toBe(0);
  });

  it("falls back to the seat that spoke before, for turns with no answering", () => {
    ordinal = 0;
    const turns = [
      turn(0, 1, { stance: "NO" }),
      turn(1, 1, { stance: "YES" }),
      // A V1 to V3 turn carries no answering field at all.
      turn(2, 1, { stance: "YES" }),
    ];

    const standing = debateStanding({ seats: SEATS, turns });

    expect(standing.moves).toMatchObject([
      { seatIndex: 2, from: "NO", to: "YES", afterSeatIndex: 1 },
    ]);
    // Nobody had spoken before the opener, so an opening move has no author.
    ordinal = 0;
    const opener = debateStanding({
      seats: SEATS,
      turns: [turn(0, 1, { stance: "UNSURE" })],
    });
    expect(opener.moves).toMatchObject([{ seatIndex: 0, afterSeatIndex: null }]);
  });

  it("reads as running while turns are still to come, and counts what is in", () => {
    ordinal = 0;
    const turns = [
      ...heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
      turn(0, 2, { stance: "UNSURE", answering: 4 }),
    ];

    const standing = debateStanding({ seats: SEATS, turns, running: true });

    expect(standing.ending).toEqual({ kind: "running", exchange: 2 });
    expect(endingSentence(standing.ending)).toBe("Exchange 2 of 3.");
    expect(standingCountsText(standing.counts)).toBe("3 YES, 1 NO, 1 UNSURE");
    expect(standing.completeExchanges).toBe(1);

    // A finished exchange with nothing after it still points at the next one.
    ordinal = 0;
    const between = debateStanding({
      seats: SEATS,
      turns: heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
      running: true,
    });
    expect(between.ending).toEqual({ kind: "running", exchange: 2 });
  });

  it("announces convergence only once the exchange that reached it is whole", () => {
    // Mid-replay: the record knows it converged, the viewer has not seen it.
    ordinal = 0;
    const midway = debateStanding({
      seats: SEATS,
      turns: heldExchange(1, ["NO", "YES", "NO"]),
      running: true,
      convergedAfterExchange: 1,
    });
    expect(midway.ending).toEqual({ kind: "running", exchange: 1 });

    // The whole exchange is in, so the ending is the record's, live or not.
    ordinal = 0;
    const whole = debateStanding({
      seats: SEATS,
      turns: heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
      running: true,
      convergedAfterExchange: 1,
    });
    expect(whole.ending).toEqual({ kind: "converged", exchange: 1 });
  });

  it("says how the debate ended: converged, or out of exchanges", () => {
    ordinal = 0;
    const converged = debateStanding({
      seats: SEATS,
      turns: [
        ...heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
        ...heldExchange(2, ["NO", "YES", "NO", "YES", "YES"]),
      ],
      convergedAfterExchange: 2,
    });
    expect(converged.ending).toEqual({ kind: "converged", exchange: 2 });
    expect(endingSentence(converged.ending)).toBe(
      "The debate stopped after exchange 2: nobody moved.",
    );

    ordinal = 0;
    const exhausted = debateStanding({
      seats: SEATS,
      turns: [
        ...heldExchange(1, ["NO", "YES", "NO", "YES", "YES"]),
        ...heldExchange(2, ["NO", "YES", "NO", "YES", "YES"]),
        ...heldExchange(3, ["NO", "YES", "NO", "YES", "YES"]),
      ],
    });
    expect(exhausted.ending).toEqual({ kind: "exhausted", exchanges: 3 });
    expect(endingSentence(exhausted.ending)).toBe("The debate ran its three exchanges.");

    expect(debateStanding({ seats: SEATS, turns: [] }).ending).toEqual({ kind: "none" });
  });

  it("never lets a skipped turn move a seat, and still completes its exchange", () => {
    ordinal = 0;
    const turns = [
      turn(0, 1, { stance: "NO" }),
      turn(1, 1, { stance: "YES" }),
      turn(2, 1, { status: "SKIPPED", failureStatus: "TIMEOUT", argument: "" }),
      turn(3, 1, { stance: "YES" }),
      turn(4, 1, { stance: "YES" }),
    ];

    const standing = debateStanding({ seats: SEATS, turns });

    // Seat 2 keeps the NO it revealed in round one: silence is not a move.
    expect(standing.stanceBySeat.get(2)).toBe("NO");
    expect(standing.moves).toEqual([]);
    expect(standing.skippedTurns).toBe(1);
    expect(standing.spokenTurns).toBe(4);
    expect(standing.completeExchanges).toBe(1);
  });

  it("ignores a turn from a seat outside the debate", () => {
    ordinal = 0;
    const standing = debateStanding({
      seats: SEATS.slice(0, 2),
      turns: [turn(0, 1, { stance: "UNSURE" }), turn(7, 1, { stance: "YES" })],
    });

    expect(standing.counts).toEqual([
      { stance: "YES", count: 1 },
      { stance: "UNSURE", count: 1 },
    ]);
    expect(standing.stanceBySeat.has(7)).toBe(false);
  });
});

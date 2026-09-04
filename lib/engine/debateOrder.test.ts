import { describe, expect, it } from "vitest";

import {
  debateSpeakingOrder,
  effectiveStancesBeforeExchange,
  nextDebateTurn,
  pendingQuestionFor,
  type DebateSeat,
  type DebateStance,
  type DebateTurnFacts,
} from "./debateOrder";

const ROLES = ["SKEPTIC", "SOURCE_AUTHENTICITY", "ANALYST", "ANALYST", "SKEPTIC"];

function seats(count: number, roles: string[] = ROLES): DebateSeat[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    jurySeatId: `seat-${seatIndex}`,
    seatIndex,
    role: roles[seatIndex] ?? "ANALYST",
  }));
}

function stanceMap(...stances: DebateStance[]): Map<string, DebateStance> {
  return new Map(stances.map((stance, index) => [`seat-${index}`, stance]));
}

function turn(
  seatIndex: number,
  ordinal: number,
  exchange: 1 | 2 | 3,
  extra: Partial<DebateTurnFacts> = {},
): DebateTurnFacts {
  return {
    jurySeatId: `seat-${seatIndex}`,
    ordinal,
    exchange,
    status: "SPOKEN",
    stance: "YES",
    ...extra,
  };
}

function order(
  seatList: DebateSeat[],
  roundOneStances: Map<string, DebateStance>,
  turns: DebateTurnFacts[] = [],
  exchange: 1 | 2 | 3 = 1,
): number[] {
  const realized: number[] = [];
  const record = [...turns];
  for (;;) {
    const plan = nextDebateTurn({
      seats: seatList,
      turns: record,
      roundOneStances,
      exchange,
    });
    if (plan === undefined) break;
    realized.push(plan.seat.seatIndex);
    record.push(turn(plan.seat.seatIndex, plan.ordinal, exchange));
  }
  return realized;
}

describe("debateSpeakingOrder", () => {
  it("opens with the lowest seat of the smallest side and alternates", () => {
    expect(
      debateSpeakingOrder(
        seats(5),
        stanceMap("YES", "YES", "NO", "YES", "NO"),
      ).map((seat) => seat.seatIndex),
    ).toEqual([2, 0, 4, 1, 3]);
  });

  it("lets the SKEPTIC seat open a unanimous jury", () => {
    expect(
      debateSpeakingOrder(
        seats(5, ["ANALYST", "ANALYST", "SKEPTIC", "ANALYST", "ANALYST"]),
        stanceMap("NO", "NO", "NO", "NO", "NO"),
      ).map((seat) => seat.seatIndex),
    ).toEqual([2, 0, 1, 3, 4]);
  });

  it("falls back to the lowest seat when a unanimous jury has no SKEPTIC", () => {
    expect(
      debateSpeakingOrder(
        seats(3, ["ANALYST", "ANALYST", "ANALYST"]),
        stanceMap("YES", "YES", "YES"),
      ).map((seat) => seat.seatIndex),
    ).toEqual([0, 1, 2]);
  });

  it("breaks a tie between equal sides on the lowest seat index", () => {
    expect(
      debateSpeakingOrder(
        seats(4),
        stanceMap("YES", "NO", "YES", "NO"),
      ).map((seat) => seat.seatIndex),
    ).toEqual([0, 1, 2, 3]);
  });

  it("treats a third stance as its own side", () => {
    expect(
      debateSpeakingOrder(
        seats(5),
        stanceMap("YES", "YES", "NO", "UNSURE", "UNSURE"),
      ).map((seat) => seat.seatIndex),
    ).toEqual([2, 0, 1, 3, 4]);
  });
});

describe("effectiveStancesBeforeExchange", () => {
  it("uses round one before the first exchange", () => {
    const stances = effectiveStancesBeforeExchange(
      seats(2),
      [],
      stanceMap("YES", "NO"),
      1,
    );
    expect([...stances]).toEqual([
      ["seat-0", "YES"],
      ["seat-1", "NO"],
    ]);
  });

  it("uses the latest spoken stance and keeps it through a skipped turn", () => {
    const turns = [
      turn(0, 0, 1, { stance: "NO" }),
      turn(1, 1, 1, { status: "SKIPPED", stance: undefined }),
    ];
    const stances = effectiveStancesBeforeExchange(
      seats(2),
      turns,
      stanceMap("YES", "YES"),
      2,
    );
    expect([...stances]).toEqual([
      ["seat-0", "NO"],
      ["seat-1", "YES"],
    ]);
  });
});

describe("nextDebateTurn", () => {
  it("realizes the alternating order across a whole exchange", () => {
    expect(order(seats(5), stanceMap("YES", "YES", "NO", "YES", "NO"))).toEqual([
      2, 0, 4, 1, 3,
    ]);
  });

  it("hands the floor to a seat that was asked a question", () => {
    const seatList = seats(5);
    const roundOne = stanceMap("YES", "YES", "NO", "YES", "NO");
    const turns = [
      turn(2, 0, 1, { question: { seat: 3, text: "Which clause decides it?" } }),
    ];
    const plan = nextDebateTurn({
      seats: seatList,
      turns,
      roundOneStances: roundOne,
      exchange: 1,
    });
    expect(plan?.seat.seatIndex).toBe(3);
    expect(plan?.pendingQuestion).toEqual({
      from: 2,
      text: "Which clause decides it?",
    });
    expect(plan?.answering).toBe(2);
    expect(plan?.ordinal).toBe(1);
    // The rest of the exchange keeps the base order minus the seat pulled forward.
    expect(order(seatList, roundOne, turns)).toEqual([3, 0, 4, 1]);
  });

  it("carries a question to the next exchange when its target already spoke", () => {
    const seatList = seats(2);
    const roundOne = stanceMap("YES", "NO");
    const turns = [
      turn(0, 0, 1),
      turn(1, 1, 1, { question: { seat: 0, text: "Where is the date?" } }),
    ];
    const plan = nextDebateTurn({
      seats: seatList,
      turns,
      roundOneStances: roundOne,
      exchange: 2,
    });
    expect(plan?.seat.seatIndex).toBe(0);
    expect(plan?.pendingQuestion).toEqual({
      from: 1,
      text: "Where is the date?",
    });
    expect(plan?.answering).toBe(1);
    expect(plan?.ordinal).toBe(2);
  });

  it("stops delivering a question once its target has had a turn", () => {
    const seatList = seats(2);
    const turns = [
      turn(0, 0, 1),
      turn(1, 1, 1, { question: { seat: 0, text: "Where is the date?" } }),
      turn(0, 2, 2),
    ];
    expect(
      pendingQuestionFor(
        seatList[0]!,
        turns,
        new Map(seatList.map((seat) => [seat.jurySeatId, seat.seatIndex])),
      ),
    ).toBeUndefined();
  });

  it("resumes an exchange where a restart left it", () => {
    const seatList = seats(5);
    const roundOne = stanceMap("YES", "YES", "NO", "YES", "NO");
    const persisted = [turn(2, 0, 1), turn(0, 1, 1)];
    const plan = nextDebateTurn({
      seats: seatList,
      turns: persisted,
      roundOneStances: roundOne,
      exchange: 1,
    });
    expect(plan?.seat.seatIndex).toBe(4);
    expect(plan?.ordinal).toBe(2);
    expect(order(seatList, roundOne, persisted)).toEqual([4, 1, 3]);
  });

  it("gives a skipped seat its slot and lets the next seat open the debate", () => {
    const seatList = seats(2);
    const roundOne = stanceMap("YES", "NO");
    const turns = [turn(0, 0, 1, { status: "SKIPPED", stance: undefined })];
    const plan = nextDebateTurn({
      seats: seatList,
      turns,
      roundOneStances: roundOne,
      exchange: 1,
    });
    expect(plan?.seat.seatIndex).toBe(1);
    expect(plan?.opensDebate).toBe(true);
    expect(plan?.answering).toBe(0);
    expect(plan?.lastSpeakerThisExchange).toBeNull();
  });

  it("returns undefined once every debater has spoken in the exchange", () => {
    expect(
      nextDebateTurn({
        seats: seats(2),
        turns: [turn(0, 0, 1), turn(1, 1, 1)],
        roundOneStances: stanceMap("YES", "NO"),
        exchange: 1,
      }),
    ).toBeUndefined();
  });

  it("opens the debate with no seat to answer when the jury is unanimous", () => {
    const plan = nextDebateTurn({
      seats: seats(3, ["ANALYST", "ANALYST", "ANALYST"]),
      turns: [],
      roundOneStances: stanceMap("YES", "YES", "YES"),
      exchange: 1,
    });
    expect(plan?.seat.seatIndex).toBe(0);
    expect(plan?.opensDebate).toBe(true);
    expect(plan?.answering).toBeNull();
  });

  it("points the opener of a later exchange at the seat that argued the other side", () => {
    const seatList = seats(3);
    const roundOne = stanceMap("YES", "NO", "NO");
    const turns = [
      turn(1, 0, 1, { stance: "NO" }),
      turn(0, 1, 1, { stance: "YES" }),
      turn(2, 2, 1, { stance: "NO" }),
    ];
    const plan = nextDebateTurn({
      seats: seatList,
      turns,
      roundOneStances: roundOne,
      exchange: 2,
    });
    // Seat 0 is now the minority of one, so it opens and answers the last
    // seat that argued the other side.
    expect(plan?.seat.seatIndex).toBe(0);
    expect(plan?.opensDebate).toBe(false);
    expect(plan?.answering).toBe(2);
    expect(plan?.lastSpeakerThisExchange).toBeNull();
    expect(plan?.mostRecentSpeaker).toBe(2);
  });

  it("never asks a seat to answer itself", () => {
    const seatList = seats(2);
    const turns = [
      turn(0, 0, 1, { stance: "YES" }),
      turn(1, 1, 1, { status: "SKIPPED", stance: undefined }),
    ];
    const plan = nextDebateTurn({
      seats: seatList,
      turns,
      roundOneStances: stanceMap("YES", "YES"),
      exchange: 2,
    });
    expect(plan?.seat.seatIndex).toBe(0);
    expect(plan?.answering).not.toBe(0);
    expect(plan?.opensDebate).toBe(true);
  });
});

/**
 * Who speaks next in the public round-two debate (deliberation spec V4).
 *
 * Pure functions over the debaters and the turns already persisted, so a
 * worker that restarts mid-exchange rebuilds exactly the same conversation:
 * no seat speaks twice and none is skipped. Dissenting seats open each
 * exchange and the sides alternate; a seat that is asked a question speaks
 * next and answers it first.
 */

export type DebateStance = "YES" | "NO" | "UNSURE";

export type DebateSeat = {
  jurySeatId: string;
  seatIndex: number;
  /** Manifest role; only SKEPTIC changes the order, and only when unanimous. */
  role: string;
};

/** A question one turn put to a named seat. */
export type DebateQuestion = { seat: number; text: string };

/** The same question seen by its recipient: `from` is the seat that asked. */
export type PendingDebateQuestion = { from: number; text: string };

/** The persisted facts of one turn that the order of the next depends on. */
export type DebateTurnFacts = {
  jurySeatId: string;
  ordinal: number;
  exchange: 1 | 2 | 3;
  status: "SPOKEN" | "SKIPPED";
  stance?: DebateStance;
  question?: DebateQuestion;
};

export type DebateTurnPlan = {
  seat: DebateSeat;
  exchange: 1 | 2 | 3;
  ordinal: number;
  /** The seat this turn is expected to answer; null only when it opens the debate. */
  answering: number | null;
  /** Quoted in the instructions when a seat put a question to this one. */
  pendingQuestion?: PendingDebateQuestion;
  /** True only while no other seat has spoken anywhere in this debate. */
  opensDebate: boolean;
  /** Last seat to speak before this turn, across exchanges (V3 semantics). */
  mostRecentSpeaker: number | null;
  /** Last seat to speak in this exchange, null when this turn opens it. */
  lastSpeakerThisExchange: number | null;
};

const SKEPTIC_ROLE = "SKEPTIC";

/** Each seat's stance entering an exchange: its last spoken stance, else round one. */
export function effectiveStancesBeforeExchange(
  seats: readonly DebateSeat[],
  turns: readonly DebateTurnFacts[],
  roundOneStances: ReadonlyMap<string, DebateStance>,
  exchange: 1 | 2 | 3,
): Map<string, DebateStance> {
  const stances = new Map<string, DebateStance>();
  for (const seat of seats) {
    const previous = [...turns]
      .filter(
        (turn) =>
          turn.jurySeatId === seat.jurySeatId &&
          turn.exchange < exchange &&
          turn.status === "SPOKEN" &&
          turn.stance !== undefined,
      )
      .sort((left, right) => left.ordinal - right.ordinal)
      .at(-1);
    const stance = previous?.stance ?? roundOneStances.get(seat.jurySeatId);
    if (stance !== undefined) stances.set(seat.jurySeatId, stance);
  }
  return stances;
}

/**
 * The base order for one exchange: a minority-stance seat opens, then the
 * sides alternate by seat index, then whatever is left in seat index order.
 * A unanimous jury is opened by its SKEPTIC seat, else by the lowest index.
 */
export function debateSpeakingOrder(
  seats: readonly DebateSeat[],
  stances: ReadonlyMap<string, DebateStance>,
): DebateSeat[] {
  const bySeatIndex = [...seats].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  );
  if (bySeatIndex.length <= 1) return bySeatIndex;

  const groups = new Map<string, DebateSeat[]>();
  for (const seat of bySeatIndex) {
    // Seats with no known stance form their own side rather than joining one.
    const key = stances.get(seat.jurySeatId) ?? "UNKNOWN";
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [seat]);
    else group.push(seat);
  }
  const sides = [...groups.values()].sort(
    (left, right) =>
      left.length - right.length ||
      (left[0]?.seatIndex ?? 0) - (right[0]?.seatIndex ?? 0),
  );

  const [minority, ...others] = sides;
  if (minority === undefined) return bySeatIndex;
  if (others.length === 0) {
    // Unanimous: the SKEPTIC seat opens, everyone else follows in seat order.
    const opener =
      bySeatIndex.find((seat) => seat.role === SKEPTIC_ROLE) ?? bySeatIndex[0]!;
    return [opener, ...bySeatIndex.filter((seat) => seat !== opener)];
  }

  const majority = others
    .flat()
    .sort((left, right) => left.seatIndex - right.seatIndex);
  const order: DebateSeat[] = [];
  let minorityIndex = 0;
  let majorityIndex = 0;
  while (minorityIndex < minority.length && majorityIndex < majority.length) {
    order.push(minority[minorityIndex++]!, majority[majorityIndex++]!);
  }
  order.push(...minority.slice(minorityIndex), ...majority.slice(majorityIndex));
  return order;
}

/**
 * The most recent question addressed to this seat that it has not had a turn
 * to answer. Covers both the hand-off inside an exchange and a question
 * carried to the next exchange because its target had already spoken.
 */
export function pendingQuestionFor(
  seat: DebateSeat,
  turns: readonly DebateTurnFacts[],
  seatIndexById: ReadonlyMap<string, number>,
): PendingDebateQuestion | undefined {
  const ownLastOrdinal = turns
    .filter((turn) => turn.jurySeatId === seat.jurySeatId)
    .reduce((latest, turn) => Math.max(latest, turn.ordinal), -1);
  const asked = [...turns]
    .filter(
      (turn) =>
        turn.status === "SPOKEN" &&
        turn.question?.seat === seat.seatIndex &&
        turn.jurySeatId !== seat.jurySeatId &&
        turn.ordinal > ownLastOrdinal,
    )
    .sort((left, right) => left.ordinal - right.ordinal)
    .at(-1);
  const from = asked === undefined
    ? undefined
    : seatIndexById.get(asked.jurySeatId);
  return asked?.question === undefined || from === undefined
    ? undefined
    : { from, text: asked.question.text };
}

/** The next turn of an exchange, or undefined once every debater has spoken. */
export function nextDebateTurn(input: {
  seats: readonly DebateSeat[];
  turns: readonly DebateTurnFacts[];
  roundOneStances: ReadonlyMap<string, DebateStance>;
  exchange: 1 | 2 | 3;
}): DebateTurnPlan | undefined {
  const { seats, turns, roundOneStances, exchange } = input;
  if (seats.length === 0) return undefined;
  const thisExchange = [...turns]
    .filter((turn) => turn.exchange === exchange)
    .sort((left, right) => left.ordinal - right.ordinal);
  const alreadySpoke = new Set(thisExchange.map((turn) => turn.jurySeatId));
  const remaining = seats.filter((seat) => !alreadySpoke.has(seat.jurySeatId));
  if (remaining.length === 0) return undefined;

  const seatIndexById = new Map(
    seats.map((entry) => [entry.jurySeatId, entry.seatIndex]),
  );
  const stances = effectiveStancesBeforeExchange(
    seats,
    turns,
    roundOneStances,
    exchange,
  );
  // A question to a seat that has not spoken yet pulls that seat forward.
  const lastTurn = thisExchange.at(-1);
  const handOff =
    lastTurn?.status === "SPOKEN" && lastTurn.question !== undefined
      ? remaining.find(
          (seat) => seat.seatIndex === lastTurn.question?.seat,
        )
      : undefined;
  const order = debateSpeakingOrder(seats, stances);
  const seat =
    handOff ??
    order.find((candidate) =>
      remaining.some((entry) => entry.jurySeatId === candidate.jurySeatId),
    ) ??
    remaining[0]!;

  const spokenBefore = [...turns]
    .filter((turn) => turn.status === "SPOKEN")
    .sort((left, right) => left.ordinal - right.ordinal);
  const spokenByOthers = spokenBefore.filter(
    (turn) => turn.jurySeatId !== seat.jurySeatId,
  );
  const lastOther = spokenByOthers.at(-1);
  const lastOtherThisExchange = spokenByOthers
    .filter((turn) => turn.exchange === exchange)
    .at(-1);
  // The opener of a later exchange answers whoever last argued the other side.
  const lastOpposingOther = spokenByOthers
    .filter(
      (turn) =>
        stances.get(turn.jurySeatId) !== undefined &&
        stances.get(turn.jurySeatId) !== stances.get(seat.jurySeatId),
    )
    .at(-1);
  const lowestOpposingSeat = [...seats]
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .find(
      (candidate) =>
        candidate.jurySeatId !== seat.jurySeatId &&
        stances.get(candidate.jurySeatId) !== undefined &&
        stances.get(candidate.jurySeatId) !== stances.get(seat.jurySeatId),
    );

  const pendingQuestion = pendingQuestionFor(seat, turns, seatIndexById);
  const answering =
    pendingQuestion?.from ??
    seatIndexOf(lastOtherThisExchange, seatIndexById) ??
    seatIndexOf(lastOpposingOther, seatIndexById) ??
    seatIndexOf(lastOther, seatIndexById) ??
    lowestOpposingSeat?.seatIndex ??
    null;

  return {
    seat,
    exchange,
    ordinal: (exchange - 1) * seats.length + thisExchange.length,
    answering,
    ...(pendingQuestion === undefined ? {} : { pendingQuestion }),
    opensDebate: lastOther === undefined,
    mostRecentSpeaker: seatIndexOf(spokenBefore.at(-1), seatIndexById) ?? null,
    lastSpeakerThisExchange:
      seatIndexOf(
        spokenBefore.filter((turn) => turn.exchange === exchange).at(-1),
        seatIndexById,
      ) ?? null,
  };
}

function seatIndexOf(
  turn: DebateTurnFacts | undefined,
  seatIndexById: ReadonlyMap<string, number>,
): number | undefined {
  return turn === undefined ? undefined : seatIndexById.get(turn.jurySeatId);
}

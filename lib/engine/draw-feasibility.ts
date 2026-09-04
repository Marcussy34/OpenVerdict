/**
 * Does the active roster admit a committee the Move draw could seat?
 *
 * This mirrors `select_committee` in move/openverdict/sources/jury.move:
 * `can_add_selected` ("One seat per operational key, two per model. Stakers are
 * uncapped", `count_model(selected, ...) < 2 && count_role(selected, ...) < 3`),
 * `selected_diversity_valid` (`models.length() >= 3 && has_skeptic &&
 * has_source`) and `can_add_reserve` (a reserve shares no profile or owner with
 * the seats or the other reserve, its role must be SKEPTIC or
 * SOURCE_AUTHENTICITY, and `count_role(reserves, role) > 0` rules out two
 * reserves in the same role). The chain enforces these caps; this file exists so
 * a stake can be refused before any money moves, so it must change whenever
 * jury.move does.
 *
 * The Move draw hashes the model id and the `OPENVERDICT_ROLE_` prefixed role,
 * so comparing the labels here is the same comparison. Weight is not modelled:
 * every registry record carries the same weight and deactivation clears
 * `active` instead.
 */

/** jury.move COMMITTEE_SIZE. */
const COMMITTEE_SIZE = 5;
/** jury.move RESERVE_COUNT. */
const RESERVE_COUNT = 2;
/** can_add_selected: count_model(selected, model) < 2. */
const MAX_SEATS_PER_MODEL = 2;
/** can_add_selected: count_role(selected, role) < 3. */
const MAX_SEATS_PER_ROLE = 3;
/** selected_diversity_valid: models.length() >= 3. */
const MIN_MODEL_FAMILIES = 3;

const SKEPTIC = "SKEPTIC";
const SOURCE_AUTHENTICITY = "SOURCE_AUTHENTICITY";

/** One active or deactivated seat as the draw sees it. */
export interface DrawSeat {
  owner: string;
  modelId: string;
  role: string;
  active: boolean;
}

export type DrawFeasibility = { ok: true } | { ok: false; reason: string };

/**
 * True when at least one committee of five seats plus two reserves satisfies
 * every draw rule. This is an existence test, not the greedy draw: the chain
 * restarts a stalled draw, so a roster that admits a committee gets one.
 */
export function rosterAdmitsDraw(records: DrawSeat[]): DrawFeasibility {
  const seats = activeSeats(records);
  if (seats.length < COMMITTEE_SIZE + RESERVE_COUNT) {
    return {
      ok: false,
      reason: `fewer than seven active seats (${seats.length} active)`,
    };
  }
  if (search(seats, [])) return { ok: true };
  return { ok: false, reason: `no valid committee: ${shortfall(seats)}` };
}

/**
 * True when at least one valid committee seats the candidate itself. A seat no
 * committee can hold is a seat that never votes and never earns, so a stake on
 * it is refused even though the roster still draws a jury without it.
 * `records` is the roster before the stake; a record sharing the candidate's
 * owner is replaced by the candidate.
 */
export function rosterCanSeat(
  records: DrawSeat[],
  candidate: DrawSeat,
): DrawFeasibility {
  const seat = normalize(candidate);
  if (!seat.active) return { ok: false, reason: "the seat is not active" };
  const seats = [seat, ...activeSeats(records).filter((s) => s.owner !== seat.owner)];
  if (search(seats, [seat], 1)) return { ok: true };
  return {
    ok: false,
    reason: `a ${candidate.modelId} ${candidate.role} seat cannot be seated on any valid committee: ${seatShortfall(seats, seat)}${alternatives(seats, seat)}`,
  };
}

type Seat = DrawSeat;

function normalize(record: DrawSeat): Seat {
  // Sui addresses are compared case-insensitively everywhere in the engine.
  return { ...record, owner: record.owner.toLowerCase() };
}

function activeSeats(records: DrawSeat[]): Seat[] {
  return records.filter((record) => record.active).map(normalize);
}

/**
 * Depth-first over the roster in index order: every committee is tried once,
 * and the caps prune most of the tree long before five seats are chosen.
 */
function search(seats: Seat[], chosen: Seat[], start = 0): boolean {
  if (chosen.length === COMMITTEE_SIZE) {
    return isDiverse(chosen) && reservesExist(seats, chosen);
  }
  if (seats.length - start < COMMITTEE_SIZE - chosen.length) return false;
  for (let i = start; i < seats.length; i += 1) {
    const seat = seats[i]!;
    if (!canAddSeat(chosen, seat)) continue;
    chosen.push(seat);
    if (search(seats, chosen, i + 1)) return true;
    chosen.pop();
  }
  return false;
}

/** can_add_selected, minus the profile check: one owner is one seat here. */
function canAddSeat(chosen: Seat[], seat: Seat): boolean {
  return (
    !chosen.some((held) => held.owner === seat.owner) &&
    count(chosen, (held) => held.modelId === seat.modelId) < MAX_SEATS_PER_MODEL &&
    count(chosen, (held) => held.role === seat.role) < MAX_SEATS_PER_ROLE
  );
}

/** selected_diversity_valid. */
function isDiverse(chosen: Seat[]): boolean {
  return (
    distinct(chosen.map((seat) => seat.modelId)).length >= MIN_MODEL_FAMILIES &&
    chosen.some((seat) => seat.role === SKEPTIC) &&
    chosen.some((seat) => seat.role === SOURCE_AUTHENTICITY)
  );
}

/**
 * can_add_reserve: two reserves outside the committee, one SKEPTIC and one
 * SOURCE_AUTHENTICITY (their roles must differ and no other role qualifies),
 * owned by two different keys. Reserves carry no model cap.
 */
function reservesExist(seats: Seat[], chosen: Seat[]): boolean {
  const free = seats.filter((seat) => !chosen.some((held) => held.owner === seat.owner));
  const skeptics = free.filter((seat) => seat.role === SKEPTIC);
  const sources = free.filter((seat) => seat.role === SOURCE_AUTHENTICITY);
  return skeptics.some((skeptic) =>
    sources.some((source) => source.owner !== skeptic.owner),
  );
}

/** Why no committee at all, in plain words. */
function shortfall(seats: Seat[]): string {
  const families = distinct(seats.map((seat) => seat.modelId)).length;
  if (families < MIN_MODEL_FAMILIES) {
    return `only ${families === 1 ? "one model family" : `${families} model families`} among active seats`;
  }
  if (!seats.some((seat) => seat.role === SKEPTIC)) {
    return "no active seat holds the SKEPTIC role";
  }
  if (!seats.some((seat) => seat.role === SOURCE_AUTHENTICITY)) {
    return "no active seat holds the SOURCE_AUTHENTICITY role";
  }
  return capsSentence();
}

/** Why this one seat can never be drawn, in plain words. */
function seatShortfall(seats: Seat[], seat: Seat): string {
  if (seats.length < COMMITTEE_SIZE + RESERVE_COUNT) {
    return `fewer than seven active seats (${seats.length} active)`;
  }
  const partnerRole = seat.role === SKEPTIC ? SOURCE_AUTHENTICITY : SKEPTIC;
  const partners = seats.filter((other) => other.role === partnerRole);
  // The 2026-09-04 incident exactly: seating it spends one of the two slots its
  // model family gets, and the role it needs alongside runs on nothing else.
  if (
    partners.length > 0 &&
    partners.every((other) => other.modelId === seat.modelId)
  ) {
    return `every ${partnerRole} seat runs ${seat.modelId} and the draw seats at most ${MAX_SEATS_PER_MODEL} ${seat.modelId} jurors`;
  }
  return capsSentence();
}

function capsSentence(): string {
  return (
    "the draw caps (one seat per signing key, two seats per model family, " +
    "three seats per role, three model families, one SKEPTIC and one " +
    "SOURCE_AUTHENTICITY, plus two reserves in different roles) admit none"
  );
}

/** What the staker could stake on instead, tested rather than guessed. */
function alternatives(seats: Seat[], seat: Seat): string {
  const rest = seats.filter((other) => other.owner !== seat.owner);
  const seatable = (swap: Partial<Seat>): boolean => {
    const probe = { ...seat, ...swap };
    return search([probe, ...rest], [probe], 1);
  };
  const partnerRole = seat.role === SKEPTIC ? SOURCE_AUTHENTICITY : SKEPTIC;
  const roleWorks = seatable({ role: partnerRole });
  // "Another model family" is only worth suggesting if one on the roster works.
  const modelWorks = distinct(rest.map((other) => other.modelId))
    .filter((modelId) => modelId !== seat.modelId)
    .some((modelId) => seatable({ modelId }));
  if (roleWorks && modelWorks) {
    return `; stake on a ${partnerRole} seat, or on another model family, instead`;
  }
  if (roleWorks) return `; stake on a ${partnerRole} seat instead`;
  if (modelWorks) return "; stake on another model family instead";
  return "";
}

function count<T>(values: T[], match: (value: T) => boolean): number {
  return values.reduce((total, value) => (match(value) ? total + 1 : total), 0);
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

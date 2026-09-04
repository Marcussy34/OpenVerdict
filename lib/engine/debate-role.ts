/**
 * Which debate role a juror seat gets when its staker names none.
 *
 * Research is identical for every seat: the role is stamped into the seat's
 * manifest and only sets the juror's instructions in a round-two debate, so
 * nobody picks it any more. The engine keeps the pool balanced instead, which
 * also keeps SKEPTIC and SOURCE_AUTHENTICITY seats coming (jury.move
 * `selected_diversity_valid` needs one of each on every committee).
 */
import { ZKLOGIN_AGENT_ROLES, type ZkLoginAgentRole } from "./zklogin";

/** Ties go to the role earliest here; a role added later ranks last on ties. */
const TIE_BREAK: readonly string[] = [
  "INVESTIGATOR",
  "SKEPTIC",
  "SOURCE_AUTHENTICITY",
];

/** One registry seat, as the assignment counts it. */
export interface RoleSeat {
  modelId: string;
  role: string;
  active: boolean;
}

/**
 * The roles, least represented first among the ACTIVE seats that run `modelId`.
 * Only the same model is counted: a committee takes at most two seats per model
 * family, so balance inside a family is what keeps a role available. Callers
 * that can refuse a role (the draw feasibility check) walk the whole list.
 */
export function rankDebateRoles(
  seats: RoleSeat[],
  modelId: string,
): ZkLoginAgentRole[] {
  const held = seats.filter((seat) => seat.active && seat.modelId === modelId);
  const count = (role: string): number =>
    held.reduce((total, seat) => (seat.role === role ? total + 1 : total), 0);
  return [...ZKLOGIN_AGENT_ROLES].sort(
    (a, b) => count(a) - count(b) || tieBreak(a) - tieBreak(b),
  );
}

/** The role the engine stamps on a seat whose staker named none. */
export function assignDebateRole(
  seats: RoleSeat[],
  modelId: string,
): ZkLoginAgentRole {
  return rankDebateRoles(seats, modelId)[0]!;
}

function tieBreak(role: string): number {
  const index = TIE_BREAK.indexOf(role);
  return index === -1 ? TIE_BREAK.length : index;
}

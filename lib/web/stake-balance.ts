/**
 * The one rule that decides whether a connected wallet can post a seat bond.
 *
 * Kept pure and free of any client import so the stake card can ask the
 * question without pulling the engine into the browser bundle, and so the
 * threshold itself is unit-tested rather than eyeballed in the UI.
 *
 * The arithmetic is integer throughout: a wallet balance in MIST can exceed
 * Number.MAX_SAFE_INTEGER, so nothing here converts to a JavaScript number.
 */

/**
 * agent_registry MIN_STAKE_MIST (0.1 SUI), mirrored from
 * move/openverdict/sources/agent_registry.move and lib/engine/engine.ts. The
 * transaction always posts the amount the prepare route returned; this copy
 * exists only to answer "can this wallet afford a seat" before that call.
 */
export const MIN_STAKE_MIST = "100000000";

/** A decimal MIST string as the RPC returns it, and nothing else. */
function isMist(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

/**
 * True only when the balance is known and genuinely under the minimum.
 *
 * An unknown, unread or malformed balance returns false on purpose: a failed
 * balance read must never be the reason a staker cannot press the button.
 */
export function isBelowMinimumStake(
  balanceMist: string | null | undefined,
  minimumMist: string = MIN_STAKE_MIST,
): boolean {
  if (!isMist(balanceMist) || !isMist(minimumMist)) return false;
  return BigInt(balanceMist) < BigInt(minimumMist);
}

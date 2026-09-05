/**
 * The rules that decide what a connected wallet may post as a seat bond: the
 * amount it is allowed to choose, and whether it can afford the one it chose.
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

/**
 * The ceiling the prepare route enforces (MAX_STAKE_MIST in lib/engine/
 * engine.ts): 1000 SUI. A seat's draw weight caps at ten times the minimum, so
 * a bigger number buys nothing and a typo would lock real money on a seat.
 */
export const MAX_STAKE_MIST = "1000000000000";

/** MIST in one SUI, for the amount field's own conversion. */
const MIST_PER_SUI = 1_000_000_000n;

/**
 * A decimal SUI amount from the stake card's amount field, as whole MIST.
 *
 * Returns null for anything that is not a plain non-negative decimal with at
 * most nine places, so the card refuses the value rather than sending a guess.
 * Integer throughout, like everything else here: no float ever touches a stake.
 */
export function stakeAmountToMist(sui: string): string | null {
  const trimmed = sui.trim();
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return (BigInt(whole) * MIST_PER_SUI + BigInt(fraction.padEnd(9, "0"))).toString();
}

/** True when the amount is outside the range a prepare will accept. */
export function isStakeAmountOutOfRange(amountMist: string | null): boolean {
  if (!isMist(amountMist)) return true;
  const amount = BigInt(amountMist);
  return amount < BigInt(MIN_STAKE_MIST) || amount > BigInt(MAX_STAKE_MIST);
}

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

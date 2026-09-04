/**
 * MIST to SUI, for display only.
 *
 * The arithmetic is integer throughout: a balance in MIST can be larger than a
 * JavaScript number holds exactly (ten billion SUI is 1e19 MIST, well past
 * Number.MAX_SAFE_INTEGER), and a wallet balance must never be rounded by the
 * conversion itself.
 */

/** MIST in one SUI. */
const MIST_PER_SUI = 1_000_000_000n;

/** SUI carries nine decimals; four is as many as a balance needs to read. */
const MAX_DECIMALS = 4;

/**
 * "1,234.5678" for an amount in MIST: thousands grouped, trailing zeros gone,
 * anything below the fourth decimal cut rather than rounded, so the number
 * never reads higher than the balance is.
 *
 * Returns null when the string is not a whole number of MIST, which is the
 * caller's signal to show nothing rather than a wrong number.
 */
export function formatSui(mist: string): string | null {
  // The RPC returns a decimal integer string; anything else is not a balance.
  if (!/^\d+$/.test(mist)) return null;
  const total = BigInt(mist);
  const decimals = (total % MIST_PER_SUI)
    .toString()
    .padStart(9, "0")
    .slice(0, MAX_DECIMALS)
    .replace(/0+$/, "");
  const whole = (total / MIST_PER_SUI).toLocaleString("en-US");
  return decimals ? `${whole}.${decimals}` : whole;
}

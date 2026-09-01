/**
 * Explorer formatting shared by the claims directory and its grid tiles, so a
 * claim reads the same whichever shape it is drawn in.
 *
 * app/fact-check/page.tsx still carries its own mirrored copy of these; it was
 * left alone rather than pulled into a change it is not part of.
 */

import type { ClaimInspection } from "@/lib/engine/contract";

/** Outcome chip colours, keyed by verdict. */
export const OUTCOME_CHIP: Record<string, string> = {
  YES: "bg-yes/10 text-yes",
  NO: "bg-no/10 text-no",
  UNSURE: "bg-unsure/10 text-unsure",
  UNRESOLVED: "bg-muted text-muted-foreground",
};

/** Object ids are too long to show whole; keep the ends, elide the middle. */
export function shortClaimId(claimId: string): string {
  return claimId.length <= 14
    ? claimId
    : `${claimId.slice(0, 8)}…${claimId.slice(-4)}`;
}

/** Truth score as a percentage string, or null while the claim is unsettled. */
export function truthScoreOf(claim: ClaimInspection): string | null {
  const bps = claim.result?.truthScoreBps;
  if (bps === null || bps === undefined) return null;
  const score = bps / 100;
  return Number.isInteger(score) ? score.toFixed(0) : score.toFixed(2);
}

/** Coarse relative time. Empty string before the clock is available (SSR). */
export function timeAgo(now: number | null, atMs: number | undefined): string {
  if (now === null || atMs === undefined) return "";
  const delta = Math.max(0, now - atMs);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

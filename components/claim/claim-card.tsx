"use client";

import Link from "next/link";
import { StateBadge } from "./state-badge";
import { OUTCOME_CHIP, shortClaimId, timeAgo } from "./claim-format";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { useNow } from "@/components/use-now";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";

interface ClaimCardProps {
  claim: ClaimInspection;
}

/**
 * One claim as a square tile for the directory's grid view.
 *
 * Deliberately spare. At four across there is room for the lifecycle state,
 * the verdict, the statement itself and the identifiers, and nothing else
 * earns its place — the mode tag, seat strip, deadline and counts all live on
 * the claim's own page. The whole tile is the link, so nothing inside it
 * competes for the click.
 */
export function ClaimCard({ claim }: ClaimCardProps) {
  const now = useNow();
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  const ago = timeAgo(now, claim.deadlines?.evidenceCutoffMs);
  // Only a claim that went through a jury round has a score; the protocol
  // never invents one, so the dial appears exactly when there is one to show.
  const scoreBps = claim.result?.truthScoreBps ?? null;
  const scored = scoreBps !== null;

  return (
    <Link
      href={`/claims/${claim.claimId}`}
      className="ov-edge ov-lift group flex aspect-square flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 transition-colors hover:border-sea/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {/* Where it stands on the left, what it settled on to the right. */}
      <div className="flex items-start justify-between gap-2">
        <StateBadge state={claim.state} stranded={stranded} size="sm" />
        {claim.result && !scored && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums",
              OUTCOME_CHIP[claim.result.result] ?? OUTCOME_CHIP.UNRESOLVED,
            )}
          >
            {claim.result.result}
          </span>
        )}
      </div>

      {/* The claim itself leads. It yields two lines to the dial when there is
          one, and takes the tile's whole middle when there is not. */}
      <p
        className={cn(
          "text-[15px] leading-snug font-medium text-ocean transition-colors group-hover:text-primary",
          scored ? "line-clamp-3" : "line-clamp-5",
        )}
      >
        {claim.statement}
      </p>

      {/* The settled score, dial and all. `compact` drops the tier chip: the
          dial's own colour already says which way it went. */}
      {scored && (
        <div className="flex justify-center">
          <VerdictGauge scoreBps={scoreBps} size={110} compact />
        </div>
      )}

      {/* Identifiers sit on the baseline, quiet. mt-auto pins them there so a
          short statement hugs the badge instead of floating mid-tile. */}
      <div className="mt-auto flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span className="truncate">{shortClaimId(claim.claimId)}</span>
        {ago && <span className="shrink-0">{ago}</span>}
      </div>
    </Link>
  );
}

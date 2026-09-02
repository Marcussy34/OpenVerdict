"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ClaimInspection } from "@/lib/engine/contract";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { useNow } from "@/components/use-now";
import { cn } from "@/lib/utils";
import { Play, DocumentText } from "@/components/icons";

interface FeaturedVerificationsProps {
  claims: ClaimInspection[];
}

// Featured claims prioritize definitive YES or NO outcomes (+3),
// debate-tested verifications from round two (+2), and scored claims (+1).
// Ties break by recency from the newest-first claims array.
function scoreClaim(claim: ClaimInspection): number {
  if (!claim.result) return 0;
  let score = 0;
  if (claim.result.result === "YES" || claim.result.result === "NO") {
    score += 3;
  }
  if (claim.state === 10 || claim.state === 11) {
    score += 2;
  }
  if (claim.result.truthScoreBps !== null && claim.result.truthScoreBps !== undefined) {
    score += 1;
  }
  return score;
}

function formatTruthScore(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "no score";
  const score = bps / 100;
  return `${score.toFixed(1)} / 100`;
}

function getOutcomeChipClass(result: string): string {
  switch (result) {
    case "YES":
      return "border-yes/30 bg-yes/10 text-yes";
    case "NO":
      return "border-no/30 bg-no/10 text-no";
    case "UNSURE":
    case "UNRESOLVED":
    default:
      return "border-unsure/30 bg-unsure/10 text-unsure";
  }
}

export function FeaturedVerifications({ claims }: FeaturedVerificationsProps) {
  const now = useNow();

  const featured = useMemo(() => {
    const eligible = claims.filter((claim) => {
      const finished = claim.state >= 9 && claim.state !== 12;
      const hasResult = Boolean(claim.result);
      const isDead =
        claim.attemptChain?.status === "VOIDED" ||
        claim.attemptChain?.status === "GAVE_UP";
      const isStranded = now !== null && isStrandedDiscussion(claim, now);
      return finished && hasResult && !isDead && !isStranded;
    });

    return eligible
      .map((claim, originalIndex) => ({
        claim,
        score: scoreClaim(claim),
        originalIndex,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.originalIndex - b.originalIndex;
      })
      .slice(0, 3)
      .map((entry) => entry.claim);
  }, [claims, now]);

  if (featured.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <p className="ov-micro ov-micro-sm text-muted-foreground">
        Featured verifications
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {featured.map((claim) => {
          const result = claim.result!;
          const isRoundTwo = claim.state === 10 || claim.state === 11;
          const scoreText = formatTruthScore(result.truthScoreBps);
          const claimHref = `/claims/${encodeURIComponent(claim.claimId)}`;

          return (
            <div
              key={claim.claimId}
              className="ov-edge ov-lift group relative flex flex-col justify-between rounded-2xl border border-border bg-card p-5 transition-colors hover:border-sea/40"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "ov-micro ov-micro-sm inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                      getOutcomeChipClass(result.result),
                    )}
                  >
                    {result.result}
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    {scoreText}
                  </span>
                </div>

                <p className="line-clamp-2 text-[15px] font-medium leading-snug text-ocean">
                  {claim.statement}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="ov-micro ov-micro-sm rounded border border-border/70 bg-surface px-2 py-0.5 text-muted-foreground">
                    5 jurors
                  </span>
                  <span className="ov-micro ov-micro-sm rounded border border-border/70 bg-surface px-2 py-0.5 text-muted-foreground">
                    sealed votes
                  </span>
                  {isRoundTwo && (
                    <>
                      <span className="ov-micro ov-micro-sm rounded border border-border/70 bg-surface px-2 py-0.5 text-muted-foreground">
                        debate
                      </span>
                      {/* "second vote" holds for claims settled before the table vote existed. */}
                      <span className="ov-micro ov-micro-sm rounded border border-border/70 bg-surface px-2 py-0.5 text-muted-foreground">
                        second vote
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 border-t border-border/70 pt-3">
                <Link
                  href={`${claimHref}?replay=1`}
                  className="ov-micro inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  <Play size="13" variant="Bold" />
                  Watch replay
                </Link>
                <Link
                  href={`${claimHref}/report`}
                  className="ov-micro inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-ocean"
                >
                  <DocumentText size="13" variant="Bold" />
                  Report
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

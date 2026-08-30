"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { SeatStrip, outcomeLabel, seatStateOf } from "@/components/viz/seat-seal";
import { HashChip } from "@/components/viz/hash-chip";
import { StatusPill } from "@/components/viz/live-dot";
import { StateBadge } from "./state-badge";
import { Button } from "@/components/ui/button";
import type { ClaimInspection } from "@/lib/engine/contract";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { useNow } from "@/components/use-now";
import { ArrowRight, Award, Eye } from "@/components/icons";

/**
 * The hero's proof exhibit: a real claim from the running engine rendered as a
 * finished verdict card — dial, jury seats, certificate id. Judges see the
 * product's output before they read a single sentence of marketing.
 */
export function VerdictSpotlight({ claim }: { claim: ClaimInspection }) {
  const reduce = useReducedMotion();
  const seats = (claim.commitments ?? []).map((c) => ({
    state: seatStateOf(c),
    outcome: outcomeLabel(c.outcome),
  }));
  const finalized = claim.state >= 9;
  const scoreBps = claim.result?.truthScoreBps ?? null;
  const now = useNow();
  const stranded = now !== null && isStrandedDiscussion(claim, now);

  return (
    <motion.aside
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduce ? 0 : 0.65,
        delay: reduce ? 0 : 0.12,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="ov-edge relative isolate overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sea to-transparent"
      />

      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <span className="ov-micro ov-micro-sm flex items-center gap-2 text-muted-foreground">
          <Award size="14" variant="Bold" className="text-primary" />
          {finalized ? "Latest settled verdict" : "Live jury round"}
        </span>
        <StatusPill
          tone={finalized ? "chain" : "sealed"}
          label={finalized ? "On-chain" : "Sealed"}
          pulse={!finalized}
        />
      </header>

      <div className="space-y-4 px-5 py-5">
        <div className="flex justify-center">
          <VerdictGauge
            scoreBps={scoreBps}
            size={210}
            emptyTitle="•••"
            emptyLabel={"Sealed until\nthe reveal phase"}
            emptyChip="Commitments sealed"
          />
        </div>

        <p className="line-clamp-3 text-center text-sm leading-relaxed font-medium text-ocean">
          “{claim.statement}”
        </p>

        <div className="flex justify-center">
          <StateBadge state={claim.state} stranded={stranded} size="sm" />
        </div>

        {seats.length > 0 && (
          <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <SeatStrip seats={seats} />
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="space-y-1">
            <dt className="ov-micro ov-micro-sm text-muted-foreground">
              Claim object
            </dt>
            <dd>
              <HashChip value={claim.claimId} tone="chain" head={6} tail={4} />
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="ov-micro ov-micro-sm text-muted-foreground">
              {claim.result?.certificateId ? "Certificate" : "Committee"}
            </dt>
            <dd>
              <HashChip
                value={claim.result?.certificateId ?? claim.committeeId}
                tone={claim.result?.certificateId ? "yes" : "sealed"}
                head={6}
                tail={4}
              />
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3.5">
        <Button asChild variant="outline" size="sm" className="min-h-[38px] flex-1 font-semibold">
          <Link href={`/claims/${claim.claimId}/observe`}>
            <Eye size="15" variant="Bold" />
            Observe live
          </Link>
        </Button>
        <Button asChild size="sm" className="min-h-[38px] flex-1 font-semibold">
          <Link href={`/claims/${claim.claimId}`}>
            Full report
            <ArrowRight size="15" variant="Bold" />
          </Link>
        </Button>
      </div>
    </motion.aside>
  );
}

/** Loading skeleton with the spotlight's exact silhouette, to avoid layout shift. */
export function VerdictSpotlightSkeleton() {
  return (
    <div className="ov-edge h-[560px] animate-pulse rounded-3xl border border-border bg-card" />
  );
}

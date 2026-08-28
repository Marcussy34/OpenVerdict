"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StateBadge } from "./state-badge";
import { TruthScore } from "./truth-score";
import { TimeDisplay } from "@/components/time-display";
import { HashChip } from "@/components/viz/hash-chip";
import { SeatStrip, outcomeLabel, seatStateOf } from "@/components/viz/seat-seal";
import { MetaTag } from "@/components/viz/page-header";
import type { ClaimInspection } from "@/lib/engine/contract";
import { CLAIM_MODE } from "@/lib/protocol/constants";
import { Eye, ArrowRight, DocumentText, Judge, Clock } from "@/components/icons";

interface ClaimCardProps {
  claim: ClaimInspection;
}

export function ClaimCard({ claim }: ClaimCardProps) {
  const isDirectReview = claim.mode === CLAIM_MODE.DIRECT_REVIEW;
  const isTerminal = claim.state >= 9;
  const truthScore = claim.result?.truthScoreBps ?? null;

  const seats = (claim.commitments ?? []).map((c) => ({
    state: seatStateOf(c),
    outcome: outcomeLabel(c.outcome),
  }));

  return (
    <article className="ov-edge ov-lift group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card hover:border-sea/40">
      {/* Header: mode + lifecycle state */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaTag tone={isDirectReview ? "chain" : "default"}>
            {isDirectReview ? "Direct review" : "Optimistic"}
          </MetaTag>
          <StateBadge state={claim.state} size="sm" />
        </div>
        <span className="ov-micro ov-micro-sm text-unsure">
          Experimental
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-4 py-4">
        {/* Statement */}
        <div className="space-y-1.5">
          <Link
            href={`/claims/${claim.claimId}`}
            className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <h3 className="line-clamp-3 text-[15px] leading-snug font-semibold text-ocean transition-colors group-hover:text-primary">
              {claim.statement}
            </h3>
          </Link>
          <HashChip value={claim.claimId} label="claim" tone="muted" head={8} tail={6} />
        </div>

        {/* Jury seat strip — the commit/reveal state at a glance */}
        {seats.length > 0 ? (
          <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <SeatStrip seats={seats} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 text-[11px] text-muted-foreground">
            Committee not yet drawn.
          </div>
        )}

        {/* Proposed vs settled outcome */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
          <div className="bg-card px-3 py-2">
            <dt className="ov-micro ov-micro-sm text-muted-foreground">
              Proposed
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-ocean">
              {claim.proposedOutcome ?? "—"}
            </dd>
          </div>
          <div className="bg-card px-3 py-2">
            <dt className="ov-micro ov-micro-sm text-muted-foreground">
              Result
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-ocean">
              {claim.result?.result ? (
                <span className="text-yes">{claim.result.result}</span>
              ) : isTerminal ? (
                "Finalized"
              ) : (
                "In progress"
              )}
            </dd>
          </div>
        </dl>

        {/* Consensus metric */}
        <div className="flex items-center justify-between gap-2">
          <span className="ov-micro ov-micro-sm text-muted-foreground">
            Consensus
          </span>
          <TruthScore scoreBps={truthScore} size="sm" showFormulaButton={false} />
        </div>

        {/* Deadline */}
        {claim.deadlines && (
          <div className="space-y-1 border-t border-border pt-3">
            <span className="ov-micro ov-micro-sm flex items-center gap-1.5 text-muted-foreground">
              <Clock size="12" variant="Bold" />
              {claim.state <= 1 ? "Challenge deadline" : "Next milestone"}
            </span>
            <TimeDisplay
              timestampMs={
                claim.state <= 1
                  ? claim.deadlines.challengeDeadlineMs
                  : claim.deadlines.firstRevealDeadlineMs
              }
            />
          </div>
        )}

        {/* Counts */}
        <div className="mt-auto flex items-center justify-between pt-1 font-mono text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <DocumentText size="12" variant="Bold" />
            {claim.evidenceRoots?.length ?? 0} evidence bundle
            {(claim.evidenceRoots?.length ?? 0) === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Judge size="12" variant="Bold" />
            {claim.commitments?.length ?? 0} jury commitments
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button asChild variant="outline" size="sm" className="min-h-[38px] flex-1 font-semibold">
          <Link href={`/claims/${claim.claimId}/observe`}>
            <Eye size="15" variant="Bold" />
            Observer
          </Link>
        </Button>
        <Button asChild size="sm" className="min-h-[38px] flex-1 font-semibold">
          <Link href={`/claims/${claim.claimId}`}>
            Report
            <ArrowRight size="15" variant="Bold" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBadge } from "./state-badge";
import { TruthScore } from "./truth-score";
import { TimeDisplay } from "@/components/time-display";
import type { ClaimInspection } from "@/lib/engine/contract";
import { CLAIM_MODE } from "@/lib/protocol/constants";
import { Eye, ArrowRight, DocumentText, Link21, Clock } from "iconsax-react";

interface ClaimCardProps {
  claim: ClaimInspection;
}

export function ClaimCard({ claim }: ClaimCardProps) {
  const isDirectReview = claim.mode === CLAIM_MODE.DIRECT_REVIEW;
  const isTerminal =
    claim.state === 9 || claim.state === 10 || claim.state === 11 || claim.state === 12;

  const truthScore = claim.result?.truthScoreBps ?? null;

  return (
    <Card className="flex flex-col justify-between border-border/80 hover:border-primary/50 transition-all duration-200 shadow-xs hover:shadow-md bg-card">
      <CardHeader className="space-y-3 pb-3">
        {/* Top metadata row: Mode + State + Experimental badge */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="text-[11px] font-semibold uppercase tracking-wider"
            >
              {isDirectReview ? "Direct Review" : "Optimistic Dispute"}
            </Badge>
            <StateBadge state={claim.state} size="sm" />
          </div>

          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] py-0 px-1.5"
          >
            Experimental
          </Badge>
        </div>

        {/* Claim statement */}
        <div className="space-y-1">
          <Link
            href={`/claims/${claim.claimId}`}
            className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          >
            <h3 className="text-base font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-3">
              {claim.statement}
            </h3>
          </Link>
          <span className="text-[11px] font-mono text-muted-foreground block truncate">
            ID: {claim.claimId}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3.5 text-xs text-muted-foreground pb-4">
        {/* Proposed Outcome & Final Result */}
        <div className="grid grid-cols-2 gap-2 bg-muted/40 p-2.5 rounded-lg border border-border/40">
          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Proposed
            </span>
            <span className="font-semibold text-foreground">
              {claim.proposedOutcome ? claim.proposedOutcome : "Awaiting Proposal"}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Result
            </span>
            <span className="font-semibold text-foreground">
              {claim.result?.result ? (
                <span className="text-primary font-bold">{claim.result.result}</span>
              ) : isTerminal ? (
                "Finalized"
              ) : (
                "In Progress"
              )}
            </span>
          </div>
        </div>

        {/* Truth Score */}
        <div className="pt-1 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Consensus Metric:</span>
          <TruthScore scoreBps={truthScore} size="sm" showFormulaButton={false} />
        </div>

        {/* Deadlines info */}
        {claim.deadlines && (
          <div className="space-y-1 border-t border-border/40 pt-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock size="14" variant="Bold" className="shrink-0" />
              <span>
                {claim.state <= 1 ? "Challenge Deadline:" : "Next Milestone:"}
              </span>
            </div>
            <div className="pl-5">
              <TimeDisplay
                timestampMs={
                  claim.state <= 1
                    ? claim.deadlines.challengeDeadlineMs
                    : claim.deadlines.firstRevealDeadlineMs
                }
              />
            </div>
          </div>
        )}

        {/* Evidence Roots & Committee info */}
        <div className="flex items-center justify-between text-[11px] pt-1 text-muted-foreground">
          <span className="flex items-center gap-1">
            <DocumentText size="13" variant="Bold" />
            <span>{claim.evidenceRoots?.length ?? 0} Evidence Bundles</span>
          </span>
          <span className="flex items-center gap-1">
            <Link21 size="13" variant="Bold" />
            <span>{claim.commitments?.length ?? 0} Jury Commitments</span>
          </span>
        </div>
      </CardContent>

      <CardFooter className="pt-2 border-t border-border/60 flex items-center justify-between gap-2">
        <Link href={`/claims/${claim.claimId}/observe`} className="flex-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs font-semibold min-h-[40px] hover:bg-accent flex items-center justify-center gap-1.5"
          >
            <Eye size="15" variant="Bold" />
            <span>Observer</span>
          </Button>
        </Link>

        <Link href={`/claims/${claim.claimId}`} className="flex-1">
          <Button
            size="sm"
            className="w-full text-xs font-semibold min-h-[40px] flex items-center justify-center gap-1.5"
          >
            <span>Details</span>
            <ArrowRight size="15" variant="Bold" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}

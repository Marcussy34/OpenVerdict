"use client";

import { TimeDisplay } from "@/components/time-display";
import { Badge } from "@/components/ui/badge";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  TickCircle,
  Clock,
  CloseCircle,
  Link21,
  DocumentText,
  ShieldTick,
  Activity,
  Lock,
  Unlock,
  Judge,
} from "iconsax-react";

interface TimelineProps {
  claim: ClaimInspection;
}

interface TimelineStep {
  id: string;
  title: string;
  description: string;
  status: "completed" | "in_progress" | "pending" | "failed";
  timestampMs?: number | string;
  txDigest?: string;
  artifactHash?: string;
  icon: typeof Clock;
}

export function ClaimTimeline({ claim }: TimelineProps) {
  // Derive milestone steps based on claim state & recorded events
  const state = claim.state;

  const steps: TimelineStep[] = [
    {
      id: "created",
      title: "Claim Created",
      description: `Statement submitted with criteria in mode: ${claim.mode === 1 ? "Direct Review" : "Optimistic Settlement"}.`,
      status: "completed",
      icon: DocumentText,
    },
    {
      id: "proposal",
      title: claim.proposedOutcome ? `Proposed: ${claim.proposedOutcome}` : "Outcome Proposal",
      description: claim.proposedOutcome
        ? `Bonded proposal submitted with proposed outcome ${claim.proposedOutcome}.`
        : "Awaiting initial proposal from creator/market participant.",
      status: claim.proposedOutcome ? "completed" : state > 1 ? "completed" : "in_progress",
      icon: Judge,
    },
    {
      id: "review_start",
      title: claim.mode === 1 ? "Direct Review Triggered" : "Claim Challenged",
      description:
        claim.mode === 1
          ? "Direct fact-check review requested; proceeding to committee selection."
          : state >= 2
            ? "Proposal challenged with counter-evidence."
            : "Subject to challenge window before optimistic finality.",
      status: state >= 2 || claim.mode === 1 ? "completed" : "pending",
      icon: Activity,
    },
    {
      id: "committee",
      title: "Committee Selected",
      description: claim.committeeId
        ? `5 independent AI jury seats drawn via Sui native randomness (Committee ID: ${claim.committeeId.slice(0, 10)}...).`
        : "5 diverse agents drawn from registry with max 2 per model and max 1 per human owner.",
      status: state >= 4 || claim.committeeId ? "completed" : state >= 2 ? "in_progress" : "pending",
      icon: ShieldTick,
    },
    {
      id: "evidence_freeze_1",
      title: "Evidence Phase 1 Frozen",
      description: claim.evidenceRoots?.length
        ? `Evidence manifest frozen into Merkle root ${claim.evidenceRoots[0]?.root?.slice(0, 12)}...`
        : "Public source URLs & text retrieved, sanitized, and stored on Walrus.",
      status: claim.evidenceRoots?.length ? "completed" : state >= 4 ? "in_progress" : "pending",
      artifactHash: claim.evidenceRoots?.[0]?.root,
      icon: DocumentText,
    },
    {
      id: "commit_1",
      title: "Phase 1: Commitments Submitted",
      description: "5 sealed Blake2b-256 commitments submitted on-chain by selected jurors.",
      status: state >= 5 ? "completed" : state === 4 ? "in_progress" : "pending",
      icon: Lock,
    },
    {
      id: "reveal_1",
      title: "Phase 1: Votes Revealed",
      description: "Votes & confidence opened on-chain; salt validated against sealed commitment.",
      status: state >= 6 ? "completed" : state === 5 ? "in_progress" : "pending",
      icon: Unlock,
    },
    ...(state >= 6 && state <= 8
      ? [
          {
            id: "discussion",
            title: "Discussion & Phase 2 Debate",
            description: "Phase 1 threshold not satisfied; second round discussion & evidence review initiated.",
            status: state >= 8 ? "completed" : "in_progress",
            icon: Activity,
          } as TimelineStep,
          {
            id: "commit_reveal_2",
            title: "Phase 2: Commitments & Reveals",
            description: "Second round deliberation votes committed and revealed.",
            status: state >= 9 ? "completed" : state === 7 || state === 8 ? "in_progress" : "pending",
            icon: Lock,
          } as TimelineStep,
        ]
      : []),
    {
      id: "finalization",
      title: claim.result?.result ? `Finalized: ${claim.result.result}` : "Resolution Certificate",
      description: claim.result
        ? `Consensus reached with Truth Score ${claim.result.truthScoreBps !== null ? Math.round(claim.result.truthScoreBps / 100) + "/100" : "N/A"}. Immutable certificate minted.`
        : state === 11
          ? "Terminal state reached without 4-of-5 consensus. Outcome UNRESOLVED; refund tickets issued."
          : "4-of-5 jury consensus threshold calculation and payout settlement.",
      status: claim.result || state >= 9 ? "completed" : "pending",
      txDigest: claim.result?.digest,
      icon: claim.result ? TickCircle : state === 11 ? CloseCircle : Clock,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="relative pl-6 sm:pl-8 border-l-2 border-border/80 space-y-8">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isDone = step.status === "completed";
          const isCurrent = step.status === "in_progress";

          return (
            <div key={step.id} className="relative group">
              {/* Step indicator circle node */}
              <div
                className={`absolute -left-[31px] sm:-left-[39px] top-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background transition-all ${
                  isDone
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : isCurrent
                      ? "border-primary bg-primary/10 text-primary animate-pulse"
                      : "border-muted-foreground/40 text-muted-foreground bg-muted"
                }`}
              >
                <Icon size="14" variant="Bold" />
              </div>

              {/* Step Content */}
              <div className="space-y-1.5 bg-card/60 p-3.5 rounded-lg border border-border/60 hover:border-border transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-muted-foreground">
                      Step {idx + 1}
                    </span>
                    <h4 className="text-sm font-semibold text-foreground">{step.title}</h4>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[11px] font-medium capitalize ${
                      isDone
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : isCurrent
                          ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                          : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? "Completed" : isCurrent ? "In Progress" : "Pending"}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {step.description}
                </p>

                {/* Evidence Artifact / Transaction link */}
                {(step.artifactHash || step.txDigest || step.timestampMs) && (
                  <div className="pt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground border-t border-border/40">
                    {step.timestampMs && <TimeDisplay timestampMs={step.timestampMs} />}
                    {step.artifactHash && (
                      <span className="flex items-center gap-1">
                        <DocumentText size="12" variant="Bold" />
                        <span>Artifact: {step.artifactHash.slice(0, 14)}...</span>
                      </span>
                    )}
                    {step.txDigest && (
                      <span className="flex items-center gap-1 text-primary">
                        <Link21 size="12" variant="Bold" />
                        <span>Tx: {step.txDigest.slice(0, 14)}...</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

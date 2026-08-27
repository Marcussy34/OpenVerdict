"use client";

import { motion, useReducedMotion } from "motion/react";
import { TimeDisplay } from "@/components/time-display";
import { HashChip } from "@/components/viz/hash-chip";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  TickCircle,
  Clock,
  CloseCircle,
  DocumentText,
  ShieldTick,
  Activity,
  Lock,
  Unlock,
  Judge,
} from "@/components/icons";

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

const NODE_CLASS = {
  completed: "border-yes/45 bg-yes/10 text-yes",
  in_progress: "border-sea/60 bg-sea/12 text-primary",
  pending: "border-border bg-surface text-muted-foreground",
  failed: "border-no/45 bg-no/10 text-no",
} as const;

const STATUS_CHIP = {
  completed: "border-yes/30 bg-yes/8 text-yes",
  in_progress: "border-sea/35 bg-sea/10 text-primary",
  pending: "border-border bg-surface text-muted-foreground",
  failed: "border-no/30 bg-no/8 text-no",
} as const;

const STATUS_LABEL = {
  completed: "Completed",
  in_progress: "In progress",
  pending: "Pending",
  failed: "Failed",
} as const;

/**
 * The claim lifecycle as a real stepper: a spine whose filled portion tracks
 * protocol progress, icon nodes per milestone, and a card carrying the artefact
 * hash / tx digest that milestone produced.
 */
export function ClaimTimeline({ claim }: TimelineProps) {
  const reduce = useReducedMotion();
  const state = claim.state;

  const steps: TimelineStep[] = [
    {
      id: "created",
      title: "Claim created",
      description: `Statement submitted with resolution criteria in ${claim.mode === 1 ? "direct review" : "optimistic settlement"} mode.`,
      status: "completed",
      icon: DocumentText,
    },
    {
      id: "proposal",
      title: claim.proposedOutcome ? `Proposed: ${claim.proposedOutcome}` : "Outcome proposal",
      description: claim.proposedOutcome
        ? `Bonded proposal submitted with proposed outcome ${claim.proposedOutcome}.`
        : "Awaiting an initial proposal from the creator or a market participant.",
      status: claim.proposedOutcome ? "completed" : state > 1 ? "completed" : "in_progress",
      icon: Judge,
    },
    {
      id: "review_start",
      title: claim.mode === 1 ? "Direct review triggered" : "Claim challenged",
      description:
        claim.mode === 1
          ? "Direct fact-check review requested; proceeding straight to committee selection."
          : state >= 2
            ? "Proposal challenged with counter-evidence."
            : "Subject to the challenge window before optimistic finality.",
      status: state >= 2 || claim.mode === 1 ? "completed" : "pending",
      icon: Activity,
    },
    {
      id: "committee",
      title: "Committee selected",
      description: claim.committeeId
        ? "Five independent AI jury seats drawn via Sui native randomness."
        : "Five diverse agents drawn from the registry: max 2 per model, max 1 per human owner.",
      status: state >= 4 || claim.committeeId ? "completed" : state >= 2 ? "in_progress" : "pending",
      artifactHash: claim.committeeId,
      icon: ShieldTick,
    },
    {
      id: "evidence_freeze_1",
      title: "Evidence phase 1 frozen",
      description: claim.evidenceRoots?.length
        ? "Evidence manifest frozen into an on-chain Merkle root and stored on Walrus."
        : "Public source URLs and text retrieved, sanitized, and stored on Walrus.",
      status: claim.evidenceRoots?.length ? "completed" : state >= 4 ? "in_progress" : "pending",
      artifactHash: claim.evidenceRoots?.[0]?.root,
      icon: DocumentText,
    },
    {
      id: "commit_1",
      title: "Phase 1 · commitments submitted",
      description:
        "Five sealed Blake2b-256 commitments submitted on-chain by the selected jurors.",
      status: state >= 5 ? "completed" : state === 4 ? "in_progress" : "pending",
      icon: Lock,
    },
    {
      id: "reveal_1",
      title: "Phase 1 · votes revealed",
      description:
        "Votes and confidences opened on-chain; each salt is validated against the sealed commitment.",
      status: state >= 6 ? "completed" : state === 5 ? "in_progress" : "pending",
      icon: Unlock,
    },
    ...(state >= 6 && state <= 8
      ? [
          {
            id: "discussion",
            title: "Discussion & phase 2 debate",
            description:
              "Phase 1 threshold not satisfied; a second discussion and evidence round was initiated.",
            status: state >= 8 ? "completed" : "in_progress",
            icon: Activity,
          } as TimelineStep,
          {
            id: "commit_reveal_2",
            title: "Phase 2 · commitments & reveals",
            description: "Second-round deliberation votes committed and revealed.",
            status:
              state >= 9 ? "completed" : state === 7 || state === 8 ? "in_progress" : "pending",
            icon: Lock,
          } as TimelineStep,
        ]
      : []),
    {
      id: "finalization",
      title: claim.result?.result ? `Finalized: ${claim.result.result}` : "Resolution certificate",
      description: claim.result
        ? `Consensus reached with Truth Score ${
            claim.result.truthScoreBps !== null
              ? `${Math.round(claim.result.truthScoreBps / 100)}/100`
              : "N/A"
          }. Immutable certificate minted on Sui.`
        : state === 11
          ? "Terminal state reached without 4-of-5 consensus. Outcome UNRESOLVED; refund tickets issued."
          : "4-of-5 jury consensus threshold calculation and payout settlement.",
      status: claim.result || state >= 9 ? "completed" : state === 11 ? "failed" : "pending",
      txDigest: claim.result?.digest,
      artifactHash: claim.result?.certificateId,
      icon: claim.result ? TickCircle : state === 11 ? CloseCircle : Clock,
    },
  ];

  const lastDone = steps.reduce(
    (acc, step, i) => (step.status === "completed" || step.status === "in_progress" ? i : acc),
    0,
  );
  const fillPercent = steps.length > 1 ? (lastDone / (steps.length - 1)) * 100 : 0;

  return (
    <div className="relative pl-9">
      {/* Spine: a muted track with a Sui-blue fill up to the live milestone. */}
      <div aria-hidden className="absolute top-3 bottom-3 left-[13px] w-0.5 rounded-full bg-border" />
      <motion.div
        aria-hidden
        className="absolute top-3 left-[13px] w-0.5 origin-top rounded-full bg-gradient-to-b from-yes via-yes to-sea"
        initial={reduce ? false : { height: 0 }}
        whileInView={reduce ? undefined : { height: `calc(${fillPercent}% - 0px)` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={reduce ? { height: `${fillPercent}%` } : undefined}
      />

      <ol className="space-y-3">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <motion.li
              key={step.id}
              className="relative"
              initial={reduce ? false : { opacity: 0, x: 8 }}
              whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "0px 0px 20% 0px" }}
              transition={{ duration: 0.4, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Node */}
              <span
                className={cn(
                  "absolute top-3 -left-9 grid size-7 place-items-center rounded-full border-2 bg-card",
                  NODE_CLASS[step.status],
                  step.status === "in_progress" && "ov-breathe",
                )}
              >
                <Icon size="13" variant="Bold" />
              </span>

              <div className="rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-sea/35">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-muted-foreground tabular-nums">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-sm font-semibold text-ocean">{step.title}</h3>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase",
                      STATUS_CHIP[step.status],
                    )}
                  >
                    {STATUS_LABEL[step.status]}
                  </span>
                </div>

                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>

                {(step.artifactHash || step.txDigest || step.timestampMs) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
                    {step.timestampMs && <TimeDisplay timestampMs={step.timestampMs} />}
                    {step.artifactHash && (
                      <HashChip value={step.artifactHash} label="artifact" tone="muted" />
                    )}
                    {step.txDigest && (
                      <HashChip value={step.txDigest} label="tx" tone="chain" head={8} />
                    )}
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

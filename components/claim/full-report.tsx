"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/claim/state-badge";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { ClaimTimeline } from "@/components/claim/timeline";
import { TimeDisplay } from "@/components/time-display";
import { MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { SeatSeal, outcomeLabel, seatStateOf } from "@/components/viz/seat-seal";
import { ModelBadge } from "@/components/viz/model-badge";
import { logoFamily } from "@/components/viz/model-logo";
import { Reveal } from "@/components/viz/reveal";
import { RunProof } from "@/components/claim/run-proof";
import { cn } from "@/lib/utils";
import { deriveRunId } from "@/lib/verify/run-proof";
import { researchFeed } from "@/lib/viz/research-feed";
import { juryFamiliesLabel } from "@/lib/web/weather-copy";
import { computeTruthScoreBps, agentProbabilityBps } from "@/lib/protocol/truthScore";
import { OUTCOME } from "@/lib/protocol/constants";
import type {
  ClaimInspection,
  FactCheckReport,
  ResolutionEvent,
} from "@/lib/engine/contract";
import {
  DocumentText,
  ShieldTick,
  Clock,
  Judge,
  Award,
  DocumentDownload,
  ArrowDown2,
  Refresh,
  Link21,
  Global,
  Cpu,
  InfoCircle,
} from "@/components/icons";

/** The settled label wears its own outcome's colour, never a fixed green. */
const LABEL_STYLE: Record<string, { tile: string; text: string }> = {
  YES: { tile: "border-yes/25 bg-yes/6", text: "text-yes" },
  NO: { tile: "border-no/25 bg-no/6", text: "text-no" },
  UNSURE: { tile: "border-unsure/25 bg-unsure/6", text: "text-unsure" },
};

/** A label with no verdict behind it (UNRESOLVED, PENDING) stays plain ink. */
const NEUTRAL_LABEL = { tile: "border-border bg-surface", text: "text-ocean" };

/**
 * The whole report, panel by panel: every attempt, object, deadline, evidence
 * manifest, seat, run proof, vote and hash the record holds. The summary view
 * reads the same data and shows only the verdict; this is the long form behind
 * `?view=full`, and it takes the data the page already fetched so nothing is
 * loaded twice.
 */
export function FullReport({
  claim,
  report,
  events,
  stranded,
}: {
  claim: ClaimInspection;
  report: FactCheckReport | null;
  events: readonly ResolutionEvent[];
  /** The discussion window closed without a second round. */
  stranded: boolean;
}) {
  /** Merge on-chain seat state with the post-reveal agent card for each seat. */
  const seats = useMemo(() => {
    return (claim.commitments ?? []).map((c, i) => {
      const card = report?.agents.find((a) => a.agentProfileId === c.agentProfileId);
      // The engine stores five ordered seats per phase.
      const phase = i < 5 ? 1 : 2;
      return {
        index: i + 1,
        phase,
        runId: deriveRunId(claim.claimId, c.jurySeatId, phase),
        state: seatStateOf(c),
        // Present only for a seat that failed before committing.
        failureStatus: c.failureStatus,
        outcome: outcomeLabel(c.outcome ?? card?.outcome),
        confidenceBps: c.confidenceBps ?? card?.confidenceBps,
        agentProfileId: c.agentProfileId,
        jurySeatId: c.jurySeatId,
        modelId: card?.modelId,
        role: card?.role,
        reasoning: card?.reasoning,
        gonkaRequestId: card?.gonkaRequestId,
      };
    });
  }, [claim, report]);

  /** The live research feed, per seat: this lane's public tool calls in order. */
  const researchSteps = useMemo(() => researchFeed(events), [events]);

  /** Compute outcome agreement and spread across valid final-round votes. */
  const agreementSummary = useMemo(() => {
    if (!report || !report.finalRoundVotes || report.finalRoundVotes.length === 0) {
      return null;
    }
    const validVotes = report.finalRoundVotes.filter((v) => v.valid);
    if (validVotes.length === 0) return null;

    // Count outcomes among valid votes
    const counts: Record<"YES" | "NO" | "UNSURE", number> = {
      YES: 0,
      NO: 0,
      UNSURE: 0,
    };
    for (const v of validVotes) {
      counts[v.outcome] = (counts[v.outcome] || 0) + 1;
    }

    const maxCount = Math.max(counts.YES, counts.NO, counts.UNSURE);
    // Find outcomes with max count to detect ties
    const topOutcomes = (Object.keys(counts) as Array<"YES" | "NO" | "UNSURE">).filter(
      (k) => counts[k] === maxCount,
    );

    const total = validVotes.length;
    const outcomeText =
      topOutcomes.length === 1
        ? `${maxCount} of ${total} ${topOutcomes[0]}`
        : `${total} votes, split`;

    // Min and max mapped probabilities on a 0 to 100 scale with two decimals
    const mappedProbs = validVotes.map(
      (v) => agentProbabilityBps(OUTCOME[v.outcome], v.confidenceBps) / 100,
    );
    const minProb = Math.min(...mappedProbs).toFixed(2);
    const maxProb = Math.max(...mappedProbs).toFixed(2);

    return `${outcomeText} · spread ${minProb} to ${maxProb}`;
  }, [report]);

  /** Compute valid vote sum and mean for the score derivation breakdown table. */
  const scoreDerivation = useMemo(() => {
    if (
      !report ||
      report.truthScore === null ||
      !report.finalRoundVotes ||
      report.finalRoundVotes.length === 0
    ) {
      return null;
    }
    const validVotes = report.finalRoundVotes.filter((v) => v.valid);
    const sumBps = validVotes.reduce(
      (total, v) => total + agentProbabilityBps(OUTCOME[v.outcome], v.confidenceBps),
      0,
    );
    const meanBps = computeTruthScoreBps(
      validVotes.map((v) => ({
        outcome: OUTCOME[v.outcome],
        confidenceBps: v.confidenceBps,
      })),
    );
    const score = meanBps !== null ? meanBps / 100 : null;

    return {
      validVotes,
      sumBps,
      meanBps,
      score,
    };
  }, [report]);

  const downloadAuditBundle = useCallback(() => {
    if (!report?.auditBundle) return;
    const blob = new Blob([JSON.stringify(report.auditBundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openverdict-audit-${claim.claimId.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, claim.claimId]);

  const isTerminal = claim.state >= 9;
  const isDirectReview = claim.mode === 1;
  const revealedCount = claim.commitments?.filter((c) => c.revealed).length ?? 0;
  const sealedCount = claim.commitments?.filter((c) => c.committed).length ?? 0;
  const verification = claim.verification;
  const attemptStopped = claim.attemptChain?.status === "VOIDED"
    || claim.attemptChain?.status === "GAVE_UP";
  const attemptRows = claim.attemptChain === undefined
    ? []
    : [
        ...claim.attemptChain.previousAttempts,
        {
          claimId: claim.claimId,
          attempt: claim.attemptChain.attempt,
          status: claim.attemptChain.status,
          voidReason: claim.attemptChain.gaveUpReason ?? claim.attemptChain.void?.reason,
        },
      ];
  const labelStyle =
    report === null ? NEUTRAL_LABEL : (LABEL_STYLE[report.label] ?? NEUTRAL_LABEL);

  return (
    <div className="space-y-8">
      {/* The mode and lifecycle state the summary's title block does not carry. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="ov-micro ov-micro-sm text-muted-foreground">
            {isDirectReview ? "Direct review" : "Optimistic settlement"}
          </span>
          <StateBadge
            state={claim.state}
            stranded={stranded}
            attemptStatus={claim.attemptChain?.status}
          />
        </div>
        {stranded && !attemptStopped && (
          <p className="text-xs text-muted-foreground">
            The discussion window closed without a second round, so this claim can no longer resolve.
          </p>
        )}
      </div>

      {claim.attemptChain !== undefined ? (
        <Panel
          label="Verification attempts"
          icon={Refresh}
          tone={attemptStopped ? "default" : "chain"}
          action={
            <MetaTag
              tone={attemptStopped ? "default" : "chain"}
              className={attemptStopped ? "border-no/30 bg-no/8 text-no" : undefined}
            >
              Attempt {claim.attemptChain.attempt} of {claim.attemptChain.maxAttempts}
            </MetaTag>
          }
        >
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {attemptRows.map((attempt) => (
              <li
                key={attempt.claimId}
                className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="ov-micro ov-micro-sm text-muted-foreground">
                  Attempt {attempt.attempt}
                </span>
                <Link
                  href={`/claims/${attempt.claimId}`}
                  className="inline-flex min-h-10 min-w-0 items-center break-all font-mono text-[11px] font-semibold text-ocean transition-colors hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {attempt.claimId}
                </Link>
                <span className={cn(
                  // ACTIVE is "in progress", so it takes the accent rather than
                  // amber, which the palette keeps for the UNSURE verdict.
                  "w-fit px-2 py-0.5 text-[10px] font-bold",
                  attempt.status === "SETTLED"
                    ? "bg-yes/10 text-yes"
                    : attempt.status === "ACTIVE"
                      ? "bg-sea/12 text-primary"
                      : "bg-no/10 text-no",
                )}>
                  {attempt.status}
                </span>
                <p className="text-xs text-muted-foreground sm:col-start-2 sm:col-span-2">
                  {attempt.voidReason ?? "No void reason"}
                </p>
              </li>
            ))}
          </ul>
          {claim.attemptChain.relaunchedAs !== undefined ? (
            <Link
              href={`/claims/${claim.attemptChain.relaunchedAs}`}
              className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-primary transition-colors hover:text-ocean hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Refresh size="14" variant="Bold" />
              View relaunched attempt {Math.min(
                claim.attemptChain.attempt + 1,
                claim.attemptChain.maxAttempts,
              )}
            </Link>
          ) : null}
        </Panel>
      ) : null}

      {/* ------------------------------------------------ Assertion + verdict */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          label="Claim assertion"
          icon={DocumentText}
          tone="primary"
          className="lg:col-span-2"
          action={
            <MetaTag tone="chain">
              Mode {isDirectReview ? "1 · direct" : "2 · optimistic"}
            </MetaTag>
          }
        >
          <div className="space-y-4">
            <p className="text-lg leading-snug font-semibold text-ocean sm:text-xl">
              {claim.statement}
            </p>

            {claim.resolutionCriteria && (
              <Well>
                <FieldLabel className="mb-1">Resolution criteria</FieldLabel>
                <p className="text-xs leading-relaxed text-foreground/85">
                  {claim.resolutionCriteria}
                </p>
              </Well>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <FieldLabel>Claim object</FieldLabel>
                <HashChip value={claim.claimId} kind="object" tone="chain" head={10} tail={8} />
              </div>
              <div className="space-y-1">
                <FieldLabel>Committee object</FieldLabel>
                <HashChip value={claim.committeeId} kind="object" tone="sealed" head={10} tail={8} />
              </div>
              <div className="space-y-1">
                <FieldLabel>Proposed outcome</FieldLabel>
                <p className="text-sm font-semibold text-ocean">
                  {claim.proposedOutcome ?? "None recorded"}
                </p>
              </div>
              <div className="space-y-1">
                <FieldLabel>Seat progress</FieldLabel>
                <p className="text-sm font-semibold text-ocean tabular-nums">
                  {revealedCount} revealed · {sealedCount} sealed / {claim.commitments?.length ?? 0}
                </p>
              </div>
              {/* Only a degraded jury adds a field here: three families is the
                  rule, and the record says so only when it was lowered. */}
              {claim.jury?.degraded && (
                <div className="space-y-1">
                  <FieldLabel>Model families</FieldLabel>
                  <p className="text-sm font-semibold text-muted-foreground">
                    {juryFamiliesLabel(claim.jury)}
                  </p>
                </div>
              )}
            </div>

            {/* Independent recomputation report (verify=1) */}
            {verification && (
              <div className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3">
                {(
                  [
                    ["Commitments", verification.commitmentsRecomputed],
                    ["Truth Score", verification.truthScoreRecomputed],
                    ["Evidence roots", verification.evidenceRootsRecomputed],
                  ] as const
                ).map(([label, ok]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        // A failed check is a failure, not an UNSURE verdict.
                        "grid size-5 place-items-center rounded-full",
                        ok ? "bg-yes/12 text-yes" : "bg-destructive/12 text-destructive",
                      )}
                    >
                      <ShieldTick size="12" variant="Bold" />
                    </span>
                    <span className="ov-micro ov-micro-sm text-muted-foreground">
                      {label} {ok ? "recomputed" : "unverified"}
                    </span>
                  </div>
                ))}
                {verification.issues.length > 0 && (
                  <p className="text-[11px] text-no sm:col-span-3">
                    Issues: {verification.issues.join("; ")}
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel label="Consensus truth score" icon={Award}>
          <div className="flex flex-col items-center gap-4">
            <VerdictGauge
              scoreBps={claim.result?.truthScoreBps ?? null}
              size={208}
              emptyTitle={sealedCount > 0 ? "•••" : "N/A"}
              emptyLabel={
                sealedCount > 0
                  ? "Sealed until\nthe reveal phase"
                  : "Not independently\nreviewed"
              }
              emptyChip={sealedCount > 0 ? "Commitments sealed" : "No jury round"}
            />
            <div className="w-full space-y-2 border-t border-border pt-3">
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Computed by deterministic integer arithmetic over the terminal valid jury
                round. A model never rates the result.
              </p>
              <Link
                href="/learn"
                className="block text-center text-[11px] font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Read the scoring formula
              </Link>
            </div>
          </div>
        </Panel>
      </div>

      {/* --------------------------------------------------------- Deadlines */}
      {claim.deadlines && (
        <Panel label="Epoch deadlines (UTC & local)" icon={Clock} tone="chain">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Challenge deadline", claim.deadlines.challengeDeadlineMs],
                ["Phase 1 commit cutoff", claim.deadlines.firstCommitDeadlineMs],
                ["Phase 1 reveal cutoff", claim.deadlines.firstRevealDeadlineMs],
                ["Discussion cutoff", claim.deadlines.discussionDeadlineMs],
              ] as const
            ).map(([label, ms]) => (
              <div key={label} className="rounded-xl border border-border bg-surface p-3">
                <FieldLabel className="mb-1.5">{label}</FieldLabel>
                <TimeDisplay timestampMs={ms} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------- Evidence */}
      <Panel
        label="Admitted evidence manifests"
        icon={DocumentText}
        action={
          <MetaTag>
            {claim.evidenceRoots?.length ?? 0} bundle
            {(claim.evidenceRoots?.length ?? 0) === 1 ? "" : "s"} frozen
          </MetaTag>
        }
      >
        {!claim.evidenceRoots || claim.evidenceRoots.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No evidence bundles frozen yet. Evidence retrieval is pending.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {claim.evidenceRoots.map((bundle) => (
              <div
                key={bundle.bundleId}
                className="ov-lift space-y-2.5 rounded-xl border border-border bg-surface p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ocean">
                    Phase {bundle.phase} evidence bundle
                  </span>
                  <MetaTag tone="chain">Merkle frozen</MetaTag>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Merkle root</FieldLabel>
                  <HashChip value={bundle.root} kind="hash" tone="chain" full />
                  <FieldLabel className="pt-1">Bundle id</FieldLabel>
                  <HashChip value={bundle.bundleId} kind="object" tone="muted" full />
                </div>
                <Link
                  href={`/evidence/${encodeURIComponent(bundle.bundleId)}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  View artifact metadata &amp; blob hashes
                  <Link21 size="12" variant="Bold" />
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Retrieved artifacts, only present once the public report exists. */}
        {report && report.evidence.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <FieldLabel>Retrieved artifacts</FieldLabel>
            <ul className="space-y-2">
              {report.evidence.map((item) => (
                <li
                  key={item.evidenceId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  {/* A step marker, not a link: muted ink, one palette. */}
                  <Global size="13" variant="Bold" className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">
                    {item.sourceUrl || "Pasted text submission"}
                  </span>
                  <HashChip value={item.evidenceId} label="id" kind="id" tone="muted" />
                  <HashChip value={item.blobId} label="blob" kind="blob" tone="muted" />
                  <HashChip value={item.contentHash} kind="hash" tone="muted" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {report && report.submittedUrls.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-border pt-4">
            <FieldLabel>Submitted source URLs</FieldLabel>
            <ul className="space-y-1">
              {report.submittedUrls.map((url) => (
                <li key={url} className="truncate font-mono text-[11px] text-muted-foreground">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------------- Jury seats */}
      <Panel
        label="Jury commit-reveal seats"
        icon={Judge}
        tone={revealedCount > 0 ? "yes" : "sealed"}
        action={
          <MetaTag tone={revealedCount > 0 ? "yes" : "sealed"}>
            {revealedCount} / {claim.commitments?.length ?? 5} revealed
          </MetaTag>
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Strict pre-reveal redaction: each seat&apos;s vote preimage stays sealed on-chain
          until the reveal phase opens it. Nothing here is inferred by the observer.
        </p>

        {seats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-center text-xs text-muted-foreground">
            Awaiting committee selection through Sui native randomness.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {seats.map((seat) => (
                <SeatSeal
                  key={seat.jurySeatId}
                  seatIndex={seat.index}
                  state={seat.state}
                  outcome={seat.outcome}
                  confidenceBps={seat.confidenceBps}
                  agentProfileId={seat.agentProfileId}
                  jurySeatId={seat.jurySeatId}
                  modelId={seat.modelId}
                  role={seat.role}
                  reasoning={seat.reasoning}
                  gonkaRequestId={seat.gonkaRequestId}
                  failureStatus={seat.failureStatus}
                  researchSteps={researchSteps.get(seat.jurySeatId)}
                />
              ))}
            </div>

            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <FieldLabel>Juror run proofs</FieldLabel>
              {seats.map((seat) => (
                <RunProof
                  key={`proof-${seat.jurySeatId}`}
                  claimId={claim.claimId}
                  runId={seat.runId}
                  seatLabel={`Seat ${seat.index}, phase ${seat.phase}`}
                />
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* --------------------------------------------------------- Timeline */}
      <Panel label="Resolution lifecycle" icon={Clock}>
        <ClaimTimeline claim={claim} />
      </Panel>

      {/* -------------------------------------- Certificate & audit bundle */}
      {isTerminal && report && (
        <Reveal>
          <Panel
            label="Public verification report & audit bundle"
            icon={Award}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={downloadAuditBundle}
                className="min-h-[36px] font-semibold"
              >
                <DocumentDownload size="14" variant="Bold" />
                Download JSON
              </Button>
            }
          >
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className={cn("rounded-xl border p-3", labelStyle.tile)}>
                  <FieldLabel className="mb-1">Settled label</FieldLabel>
                  <p className={cn("text-xl font-semibold", labelStyle.text)}>{report.label}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <FieldLabel className="mb-1">Truth score</FieldLabel>
                  <p className="text-xl font-semibold text-ocean tabular-nums">
                    {report.truthScore === null ? "N/A" : report.truthScore}
                    <span className="ml-1 text-xs text-muted-foreground">/100</span>
                  </p>
                  {agreementSummary && (
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {agreementSummary}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <FieldLabel className="mb-1">Final round votes</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {report.finalRoundVotes.map((v, i) => (
                      <span
                        key={i}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                          v.outcome === "YES"
                            ? "bg-yes/10 text-yes"
                            : v.outcome === "NO"
                              ? "bg-no/10 text-no"
                              : "bg-unsure/10 text-unsure",
                        )}
                      >
                        {v.outcome} {Math.round(v.confidenceBps / 100)}%
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <Well className="space-y-4">
                {scoreDerivation && (
                  <div className="space-y-2">
                    <FieldLabel>How the score is computed</FieldLabel>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left text-xs">
                        <thead className="border-b border-border text-[11px] font-medium text-muted-foreground">
                          <tr>
                            <th className="pb-2 pr-3 font-medium">Seat</th>
                            <th className="pb-2 pr-3 font-medium">Vote</th>
                            <th className="pb-2 pr-3 font-medium">Confidence</th>
                            <th className="pb-2 font-medium text-right">Mapped probability</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {report.finalRoundVotes.map((v, i) => {
                            // Map revealed outcome and confidence into basis-point probability
                            const mappedProbBps = agentProbabilityBps(
                              OUTCOME[v.outcome],
                              v.confidenceBps,
                            );
                            return (
                              <tr
                                key={v.jurySeatId || i}
                                className={cn(!v.valid && "opacity-50")}
                              >
                                <td className="py-2.5 pr-3 align-top font-mono text-xs">
                                  <span>{v.jurySeatId.slice(0, 10)}</span>
                                  {!v.valid && (
                                    <span className="mt-0.5 block font-sans text-[10px] italic text-muted-foreground">
                                      excluded: reveal did not match its commitment
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 pr-3 align-top">
                                  <span
                                    className={cn(
                                      "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                                      v.outcome === "YES"
                                        ? "bg-yes/10 text-yes"
                                        : v.outcome === "NO"
                                          ? "bg-no/10 text-no"
                                          : "bg-unsure/10 text-unsure",
                                    )}
                                  >
                                    {v.outcome}
                                  </span>
                                </td>
                                <td className="py-2.5 pr-3 align-top tabular-nums">
                                  <span className="font-semibold text-foreground">
                                    {v.confidenceBps / 100}%
                                  </span>
                                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                                    {v.confidenceBps} bps
                                  </span>
                                </td>
                                <td className="py-2.5 align-top text-right tabular-nums">
                                  <div className="font-mono font-semibold text-foreground">
                                    {(mappedProbBps / 100).toFixed(2)}
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground">
                                    {v.outcome === "YES"
                                      ? "= confidence"
                                      : v.outcome === "NO"
                                        ? `10000 - ${v.confidenceBps}`
                                        : "fixed 5000"}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t border-border text-xs">
                          <tr className="border-b border-border/40">
                            <td colSpan={2} className="py-2 font-semibold text-muted-foreground">
                              Sum
                            </td>
                            <td
                              colSpan={2}
                              className="py-2 text-right font-mono font-semibold tabular-nums text-foreground"
                            >
                              {scoreDerivation.sumBps} bps
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={2} className="py-2 font-semibold text-muted-foreground">
                              Mean
                            </td>
                            <td
                              colSpan={2}
                              className="py-2 text-right font-mono font-semibold tabular-nums text-foreground"
                            >
                              {scoreDerivation.sumBps} / {scoreDerivation.validVotes.length} ={" "}
                              {scoreDerivation.meanBps} bps, score{" "}
                              {scoreDerivation.score !== null ? scoreDerivation.score : "N/A"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                <div className={cn(scoreDerivation && "border-t border-border/60 pt-3")}>
                  <FieldLabel className="mb-1">Truth score formula</FieldLabel>
                  <p className="text-[13px] leading-relaxed text-foreground/85">
                    {report.truthScoreFormula}
                  </p>
                </div>
              </Well>

              {/* Public reasoning traces: every check the jurors published. */}
              <div className="space-y-2">
                <FieldLabel>Public reasoning traces</FieldLabel>
                {report.agents.map((agent, index) => (
                  <details
                    key={agent.agentProfileId}
                    className="group rounded-xl border border-border bg-card open:bg-surface"
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
                      <ArrowDown2
                        size="13"
                        variant="Bold"
                        className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      />
                      {/* A seat marker, not a link: muted ink, one palette. */}
                      <Cpu size="13" variant="Bold" className="shrink-0 text-muted-foreground" />
                      <ModelBadge
                        modelId={agent.modelId}
                        variant={report.agents
                          .slice(0, index)
                          .filter((other) => logoFamily(other.modelId) === logoFamily(agent.modelId))
                          .length}
                      />
                      <span
                        className={cn(
                          "ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                          agent.outcome === "YES"
                            ? "bg-yes/10 text-yes"
                            : agent.outcome === "NO"
                              ? "bg-no/10 text-no"
                              : "bg-unsure/10 text-unsure",
                        )}
                      >
                        {agent.outcome} · {agent.confidenceBps} bps
                      </span>
                    </summary>

                    <div className="space-y-2.5 border-t border-border px-3 py-3">
                      <p className="text-[11px] leading-relaxed text-foreground/80 italic">
                        “{agent.reasoning}”
                      </p>
                      <ol className="space-y-1.5">
                        {agent.publicReasoningTrace.map((trace, i) => (
                          <li
                            key={i}
                            className="rounded-lg border border-border bg-card px-2.5 py-2 text-[11px]"
                          >
                            <p className="font-semibold text-ocean">{trace.check}</p>
                            <p className="text-muted-foreground">{trace.finding}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span
                                className={cn(
                                  "ov-micro ov-micro-sm rounded px-1 py-px",
                                  trace.assessment === "SUPPORTS"
                                    ? "bg-yes/10 text-yes"
                                    : trace.assessment === "CONTRADICTS"
                                      ? "bg-no/10 text-no"
                                      : "bg-unsure/10 text-unsure",
                                )}
                              >
                                {trace.assessment}
                              </span>
                              {trace.evidenceIds?.map((eid) => (
                                <HashChip key={eid} value={eid} label="ev" kind="id" tone="muted" />
                              ))}
                            </div>
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                        <HashChip
                          value={agent.agentProfileId}
                          label="agent"
                          kind="object"
                          tone="muted"
                        />
                        <HashChip value={agent.owner} label="owner" kind="account" tone="muted" />
                        <HashChip
                          value={agent.gonkaRequestId}
                          label="gonka"
                          kind="id"
                          tone="muted"
                        />
                      </div>
                    </div>
                  </details>
                ))}
              </div>

              {/* Sui Move objects */}
              <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
                <FieldLabel>Sui Move protocol objects</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className="ov-micro ov-micro-sm text-muted-foreground">
                      Claim object
                    </span>
                    <HashChip value={report.sui.claimObjectId} kind="object" tone="chain" full />
                  </div>
                  {report.sui.committeeId && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Committee object
                      </span>
                      <HashChip value={report.sui.committeeId} kind="object" tone="sealed" full />
                    </div>
                  )}
                  {report.sui.certificateId && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Certificate object
                      </span>
                      <HashChip value={report.sui.certificateId} kind="object" tone="chain" full />
                    </div>
                  )}
                  {report.evidenceRoot && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Evidence root
                      </span>
                      <HashChip value={report.evidenceRoot} kind="hash" tone="chain" full />
                    </div>
                  )}
                </div>
                <div className="space-y-1 border-t border-border pt-2">
                  <span className="ov-micro ov-micro-sm text-muted-foreground">
                    Revealed vote objects ({report.sui.revealedVoteIds?.length ?? 0})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {report.sui.revealedVoteIds?.map((vid) => (
                      <HashChip key={vid} value={vid} kind="object" tone="muted" />
                    ))}
                  </div>
                </div>
                {claim.result?.digest && (
                  <div className="space-y-1 border-t border-border pt-2">
                    <span className="ov-micro ov-micro-sm text-muted-foreground">
                      Finalization transaction
                    </span>
                    <HashChip value={claim.result.digest} kind="tx" tone="chain" full />
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </Reveal>
      )}

      {/* -------------------------------------------- Security boundary note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        {/* A note marker, not a link: muted ink, one palette. */}
        <InfoCircle size="16" variant="Bold" className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-ocean">Read-only projection.</strong> This page
          holds no signer and cannot advance protocol state, trigger inference, or derive
          unrevealed votes. Every value above is read from on-chain Move objects, Walrus blobs
          and public resolution events.
        </p>
      </div>
    </div>
  );
}

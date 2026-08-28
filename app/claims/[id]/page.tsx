"use client";

import { useState, useEffect, use, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/claim/state-badge";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { ClaimTimeline } from "@/components/claim/timeline";
import { TimeDisplay } from "@/components/time-display";
import { PositionPanel } from "@/components/pool/position-panel";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { SeatSeal, outcomeLabel, seatStateOf } from "@/components/viz/seat-seal";
import { ModelBadge } from "@/components/viz/model-badge";
import { Reveal } from "@/components/viz/reveal";
import { cn } from "@/lib/utils";
import type { ClaimInspection, FactCheckReport } from "@/lib/engine/contract";
import {
  DocumentText,
  Eye,
  ShieldTick,
  Warning2,
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

interface ClaimDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ClaimDetailPage({ params }: ClaimDetailPageProps) {
  const { id } = use(params);

  const [claim, setClaim] = useState<ClaimInspection | null>(null);
  const [report, setReport] = useState<FactCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      setNotFound(false);

      const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
      if (inspectRes.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (inspectRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!inspectRes.ok) {
        setEngineOffline(true);
        return;
      }

      const inspectData: ClaimInspection = await inspectRes.json();
      setClaim(inspectData);

      if (inspectData.state >= 9) {
        try {
          const reportRes = await fetch(`/api/claims/${encodeURIComponent(id)}/report`);
          if (reportRes.ok) setReport(await reportRes.json());
        } catch {
          /* report is optional — the inspection view stands on its own */
        }
      }
    } catch {
      setEngineOffline(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
        if (ignore) return;
        if (inspectRes.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (inspectRes.status === 404) {
          setNotFound(true);
          return;
        }
        if (!inspectRes.ok) {
          setEngineOffline(true);
          return;
        }

        const inspectData: ClaimInspection = await inspectRes.json();
        if (!ignore) setClaim(inspectData);

        if (inspectData.state >= 9) {
          try {
            const reportRes = await fetch(`/api/claims/${encodeURIComponent(id)}/report`);
            if (reportRes.ok) {
              const reportData = await reportRes.json();
              if (!ignore) setReport(reportData);
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        if (!ignore) setEngineOffline(true);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, [id]);

  /** Merge on-chain seat state with the post-reveal agent card for each seat. */
  const seats = useMemo(() => {
    if (!claim) return [];
    return (claim.commitments ?? []).map((c, i) => {
      const card = report?.agents.find((a) => a.agentProfileId === c.agentProfileId);
      return {
        index: i + 1,
        state: seatStateOf(c),
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

  const downloadAuditBundle = () => {
    if (!report?.auditBundle) return;
    const blob = new Blob([JSON.stringify(report.auditBundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openverdict-audit-${id.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6 px-5 py-16 md:px-7">
        <div className="h-9 w-52 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-56 animate-pulse rounded-2xl bg-surface" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (engineOffline) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-unsure/10 text-unsure">
          <Warning2 size="26" variant="Bold" />
        </span>
        <h1 className="text-xl font-semibold text-ocean">Engine offline (503)</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          The OpenVerdict verification engine backend is offline or not wired yet. Claim data
          cannot be retrieved from the active RPC node.
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => loadData()}>
            <Refresh size="14" variant="Bold" />
            Retry
          </Button>
          <Button asChild size="sm" className="min-h-[40px]">
            <Link href="/verify">Independent verifier</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !claim) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-ocean">Claim not found</h1>
        <p className="text-sm text-muted-foreground">
          No claim exists with this object id.
        </p>
        <HashChip value={id} full className="max-w-md" />
        <Button asChild size="sm" className="mt-2 min-h-[40px]">
          <Link href="/claims">Back to claims directory</Link>
        </Button>
      </div>
    );
  }

  const isTerminal = claim.state >= 9;
  const isDirectReview = claim.mode === 1;
  const revealedCount = claim.commitments?.filter((c) => c.revealed).length ?? 0;
  const sealedCount = claim.commitments?.filter((c) => c.committed).length ?? 0;
  const verification = claim.verification;

  return (
    <div className="space-y-8 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        backHref="/claims"
        backLabel="All claims"
        eyebrow={isDirectReview ? "Direct review" : "Optimistic settlement"}
        title="Claim report"
        icon={Judge}
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={claim.state} />
            <ExperimentalTag />
          </div>
        }
        actions={
          <>
            <Button asChild size="sm" className="min-h-[40px] px-4 font-semibold shadow-xs">
              <Link href={`/claims/${encodeURIComponent(claim.claimId)}/observe`}>
                <Eye size="15" variant="Bold" />
                Live observer
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-[40px] font-semibold">
              <Link href="/verify">
                <ShieldTick size="15" variant="Bold" />
                Verify proofs
              </Link>
            </Button>
          </>
        }
      />

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
                <HashChip value={claim.claimId} tone="chain" head={10} tail={8} />
              </div>
              <div className="space-y-1">
                <FieldLabel>Committee object</FieldLabel>
                <HashChip value={claim.committeeId} tone="sealed" head={10} tail={8} />
              </div>
              <div className="space-y-1">
                <FieldLabel>Proposed outcome</FieldLabel>
                <p className="text-sm font-semibold text-ocean">
                  {claim.proposedOutcome ?? "— none recorded"}
                </p>
              </div>
              <div className="space-y-1">
                <FieldLabel>Seat progress</FieldLabel>
                <p className="text-sm font-semibold text-ocean tabular-nums">
                  {revealedCount} revealed · {sealedCount} sealed / {claim.commitments?.length ?? 0}
                </p>
              </div>
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
                        "grid size-5 place-items-center rounded-full",
                        ok ? "bg-yes/12 text-yes" : "bg-unsure/12 text-unsure",
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

        <Panel label="Consensus truth score" icon={Award} tone="yes">
          <div className="flex flex-col items-center gap-4">
            <VerdictGauge
              scoreBps={claim.result?.truthScoreBps ?? null}
              size={208}
              emptyTitle={sealedCount > 0 ? "•••" : "——"}
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
                round — never by asking a model to rate the result.
              </p>
              <Link
                href="/learn"
                className="block text-center text-[11px] font-semibold text-primary hover:underline"
              >
                Read the scoring formula
              </Link>
            </div>
          </div>
        </Panel>
      </div>

      {/* Wallet-gated economic actions; claim reading remains anonymous. */}
      <PositionPanel />

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
            {claim.evidenceRoots.map((bundle, idx) => (
              <div
                key={idx}
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
                  <HashChip value={bundle.root} tone="chain" full />
                  <FieldLabel className="pt-1">Bundle id</FieldLabel>
                  <HashChip value={bundle.bundleId} tone="muted" full />
                </div>
                <Link
                  href={`/evidence/${encodeURIComponent(bundle.bundleId)}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
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
                  <Global size="13" variant="Bold" className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">
                    {item.sourceUrl || "Pasted text submission"}
                  </span>
                  <HashChip value={item.evidenceId} label="id" tone="muted" />
                  <HashChip value={item.blobId} label="blob" tone="muted" />
                  <HashChip value={item.contentHash} label="hash" tone="muted" />
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
              />
            ))}
          </div>
        )}
      </Panel>

      {/* --------------------------------------------------------- Timeline */}
      <Panel label="Resolution lifecycle (PRD §26.3)" icon={Clock}>
        <ClaimTimeline claim={claim} />
      </Panel>

      {/* -------------------------------------- Certificate & audit bundle */}
      {isTerminal && report && (
        <Reveal>
          <Panel
            label="Public fact-check report & audit bundle"
            icon={Award}
            tone="yes"
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
                <div className="rounded-xl border border-yes/25 bg-yes/6 p-3">
                  <FieldLabel className="mb-1">Settled label</FieldLabel>
                  <p className="text-xl font-semibold text-yes">{report.label}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <FieldLabel className="mb-1">Truth score</FieldLabel>
                  <p className="text-xl font-semibold text-ocean tabular-nums">
                    {report.truthScore === null ? "——" : report.truthScore}
                    <span className="ml-1 text-xs text-muted-foreground">/100</span>
                  </p>
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

              <Well>
                <FieldLabel className="mb-1">Truth score formula</FieldLabel>
                <p className="text-[13px] leading-relaxed text-foreground/85">
                  {report.truthScoreFormula}
                </p>
              </Well>

              {/* Public reasoning traces — every check the jurors published. */}
              <div className="space-y-2">
                <FieldLabel>Public reasoning traces</FieldLabel>
                {report.agents.map((agent) => (
                  <details
                    key={agent.agentProfileId}
                    className="group rounded-xl border border-border bg-card open:bg-surface"
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-surface">
                      <ArrowDown2
                        size="13"
                        variant="Bold"
                        className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      />
                      <Cpu size="13" variant="Bold" className="shrink-0 text-primary" />
                      <ModelBadge modelId={agent.modelId} />
                      <span className="font-semibold text-ocean">
                        {agent.role.replace(/_/g, " ")}
                      </span>
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
                                <HashChip key={eid} value={eid} label="ev" tone="muted" />
                              ))}
                            </div>
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                        <HashChip value={agent.agentProfileId} label="agent" tone="muted" />
                        <HashChip value={agent.owner} label="owner" tone="muted" />
                        <HashChip value={agent.gonkaRequestId} label="gonka" tone="muted" />
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
                    <HashChip value={report.sui.claimObjectId} tone="chain" full />
                  </div>
                  {report.sui.committeeId && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Committee object
                      </span>
                      <HashChip value={report.sui.committeeId} tone="sealed" full />
                    </div>
                  )}
                  {report.sui.certificateId && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Certificate object
                      </span>
                      <HashChip value={report.sui.certificateId} tone="yes" full />
                    </div>
                  )}
                  {report.evidenceRoot && (
                    <div className="space-y-1">
                      <span className="ov-micro ov-micro-sm text-muted-foreground">
                        Evidence root
                      </span>
                      <HashChip value={report.evidenceRoot} tone="chain" full />
                    </div>
                  )}
                </div>
                <div className="space-y-1 border-t border-border pt-2">
                  <span className="ov-micro ov-micro-sm text-muted-foreground">
                    Revealed vote objects ({report.sui.revealedVoteIds?.length ?? 0})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {report.sui.revealedVoteIds?.map((vid) => (
                      <HashChip key={vid} value={vid} tone="muted" />
                    ))}
                  </div>
                </div>
                {claim.result?.digest && (
                  <div className="space-y-1 border-t border-border pt-2">
                    <span className="ov-micro ov-micro-sm text-muted-foreground">
                      Finalization transaction
                    </span>
                    <HashChip value={claim.result.digest} tone="chain" full />
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </Reveal>
      )}

      {/* -------------------------------------------- Security boundary note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        <InfoCircle size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
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

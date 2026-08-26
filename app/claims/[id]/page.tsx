"use client";

import { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateBadge } from "@/components/claim/state-badge";
import { TruthScore } from "@/components/claim/truth-score";
import { ClaimTimeline } from "@/components/claim/timeline";
import { AgentCard } from "@/components/agents/agent-card";
import { TimeDisplay } from "@/components/time-display";
import { PositionPanel } from "@/components/pool/position-panel";
import type { ClaimInspection, FactCheckReport } from "@/lib/engine/contract";
import {
  DocumentText,
  Eye,
  ShieldTick,
  Lock,
  Unlock,
  Warning2,
  Clock,
  Judge,
  Award,
  ArrowDown2,
  Refresh,
} from "iconsax-react";

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

      // 1. Fetch inspection
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

      // 2. Fetch report if terminal/finalized
      if (inspectData.state >= 9) {
        try {
          const reportRes = await fetch(`/api/claims/${encodeURIComponent(id)}/report`);
          if (reportRes.ok) {
            const reportData = await reportRes.json();
            setReport(reportData);
          }
        } catch {
          // Report optional / graceful fallback
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
            // Ignore report error
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

  const downloadAuditBundle = () => {
    if (!report?.auditBundle) return;
    const jsonStr = JSON.stringify(report.auditBundle, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openverdict-audit-${id.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-16 px-4 space-y-6">
        <div className="h-10 w-48 bg-muted animate-pulse rounded" />
        <div className="h-40 bg-muted/60 animate-pulse rounded-xl" />
        <div className="h-64 bg-muted/40 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (engineOffline) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4 text-center space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 mx-auto">
          <Warning2 size="28" variant="Bold" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Engine Offline (503)</h2>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          The OpenVerdict verification engine backend is offline or not wired yet. Claim data cannot be retrieved from the active RPC node.
        </p>
        <div className="pt-2 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            <Refresh size="14" variant="Bold" className="mr-1.5" />
            Retry
          </Button>
          <Link href="/verify">
            <Button size="sm">Independent Verifier</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (notFound || !claim) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4 text-center space-y-4">
        <h2 className="text-xl font-bold text-foreground">Claim Not Found</h2>
        <p className="text-xs text-muted-foreground">
          No claim exists with ID <span className="font-mono">{id}</span>.
        </p>
        <Link href="/claims">
          <Button size="sm">Back to Claims Directory</Button>
        </Link>
      </div>
    );
  }

  const isTerminal = claim.state >= 9;
  const isDirectReview = claim.mode === 1;

  return (
    <div className="max-w-6xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* 1. Header Navigation & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/claims"
              className="text-xs text-muted-foreground hover:text-foreground font-medium"
            >
              ← All Claims
            </Link>
            <span className="text-muted-foreground text-xs">•</span>
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">
              {claim.claimId}
            </span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Claim Inspection</h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <Link href={`/claims/${encodeURIComponent(claim.claimId)}/observe`}>
            <Button size="sm" className="min-h-[40px] px-4 font-semibold shadow-xs">
              <Eye size="16" variant="Bold" className="mr-1.5" />
              Live Visual Observer
            </Button>
          </Link>

          <Link href="/verify">
            <Button variant="outline" size="sm" className="min-h-[40px] px-3 font-semibold text-xs">
              <ShieldTick size="15" variant="Bold" className="mr-1" />
              Verify Proofs
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. Statement & Primary Metadata Hero */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-semibold uppercase tracking-wider">
              {isDirectReview ? "Direct Review" : "Optimistic Settlement"}
            </Badge>
            <StateBadge state={claim.state} size="md" />
          </div>

          <div className="text-xs text-muted-foreground font-mono">
            Mode: {isDirectReview ? "1 (Direct)" : "2 (Optimistic)"}
          </div>
        </div>

        {/* Statement assertion */}
        <div className="space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Claim Assertion
          </span>
          <p className="text-lg sm:text-xl font-bold text-foreground leading-snug">
            {claim.statement}
          </p>
        </div>

        {/* Resolution criteria */}
        {claim.resolutionCriteria && (
          <div className="space-y-1 bg-muted/40 p-3.5 rounded-lg border border-border/40 text-xs">
            <span className="font-bold text-muted-foreground uppercase text-[10px] tracking-wider block">
              Resolution Criteria
            </span>
            <p className="text-foreground/90 font-medium leading-relaxed">
              {claim.resolutionCriteria}
            </p>
          </div>
        )}

        {/* Truth score bar (if finalized) */}
        <div className="pt-2">
          <TruthScore
            scoreBps={claim.result?.truthScoreBps ?? null}
            size="lg"
            showFormulaButton={true}
          />
        </div>
      </div>

      {/* Wallet-gated economic actions; claim reading remains anonymous. */}
      <PositionPanel />

      {/* 3. Deadlines & On-Chain Parameters */}
      {claim.deadlines && (
        <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Clock size="15" variant="Bold" className="text-primary" />
            Epoch Deadlines (UTC &amp; Local)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-muted/40 p-2.5 rounded-lg border border-border/40 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Challenge Deadline
              </span>
              <div>
                <TimeDisplay timestampMs={claim.deadlines.challengeDeadlineMs} />
              </div>
            </div>

            <div className="bg-muted/40 p-2.5 rounded-lg border border-border/40 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Phase 1 Commit Cutoff
              </span>
              <div>
                <TimeDisplay timestampMs={claim.deadlines.firstCommitDeadlineMs} />
              </div>
            </div>

            <div className="bg-muted/40 p-2.5 rounded-lg border border-border/40 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Phase 1 Reveal Cutoff
              </span>
              <div>
                <TimeDisplay timestampMs={claim.deadlines.firstRevealDeadlineMs} />
              </div>
            </div>

            <div className="bg-muted/40 p-2.5 rounded-lg border border-border/40 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                Discussion Cutoff
              </span>
              <div>
                <TimeDisplay timestampMs={claim.deadlines.discussionDeadlineMs} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Evidence Bundles Section */}
      <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <DocumentText size="16" variant="Bold" className="text-primary" />
            Admitted Evidence Manifests
          </h3>
          <span className="text-xs font-mono text-muted-foreground">
            {claim.evidenceRoots?.length ?? 0} Bundle(s) Frozen
          </span>
        </div>

        {(!claim.evidenceRoots || claim.evidenceRoots.length === 0) ? (
          <p className="text-xs text-muted-foreground italic">
            No evidence bundles frozen yet. Evidence retrieval is pending.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {claim.evidenceRoots.map((bundle, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg border border-border/60 bg-muted/30 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Phase {bundle.phase} Evidence Bundle
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    Bundle ID: {bundle.bundleId.slice(0, 8)}...
                  </Badge>
                </div>

                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Merkle Root:</span>
                    <span className="text-foreground font-semibold truncate max-w-[180px]">
                      {bundle.root}
                    </span>
                  </div>
                </div>

                <Link
                  href={`/evidence/${encodeURIComponent(bundle.bundleId)}`}
                  className="block pt-1 text-[11px] text-primary hover:underline font-semibold"
                >
                  View Artifact Metadata &amp; Blob Hashes →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Commitments & Jury Deliberation Status */}
      <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Judge size="16" variant="Bold" className="text-primary" />
              Jury Commit-Reveal Seats (5 Jurors)
            </h3>
            <p className="text-xs text-muted-foreground">
              Strict pre-reveal redaction: commitments are sealed until opened on-chain.
            </p>
          </div>

          <Badge variant="outline" className="text-xs font-mono">
            {claim.commitments?.filter((c) => c.revealed).length ?? 0} / 5 Revealed
          </Badge>
        </div>

        {(!claim.commitments || claim.commitments.length === 0) ? (
          <div className="p-4 text-center text-xs text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
            Awaiting committee selection through Sui native randomness.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {claim.commitments.map((seat, idx) => {
              const isRev = seat.revealed;
              const isComm = seat.committed;

              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-xs space-y-2 ${
                    isRev
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : isComm
                        ? "border-indigo-500/40 bg-indigo-500/5"
                        : "border-border/60 bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-foreground">Seat #{idx + 1}</span>
                    {isRev ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-500/10 border-emerald-500/30">
                        <Unlock size="10" variant="Bold" className="mr-0.5" />
                        Revealed
                      </Badge>
                    ) : isComm ? (
                      <Badge variant="outline" className="text-[10px] text-indigo-700 bg-indigo-500/10 border-indigo-500/30">
                        <Lock size="10" variant="Bold" className="mr-0.5" />
                        Sealed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground bg-muted">
                        Pending
                      </Badge>
                    )}
                  </div>

                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    Agent: {seat.agentProfileId?.slice(0, 10)}...
                  </div>

                  {isRev && seat.outcome ? (
                    <div className="font-bold text-xs text-foreground">
                      Vote: {seat.outcome === 1 ? "YES" : seat.outcome === 2 ? "NO" : "UNSURE"}
                    </div>
                  ) : isComm ? (
                    <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      🔒 Preimage Sealed
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Ordered Event Timeline */}
      <div className="rounded-xl border border-border/80 bg-card p-6 shadow-xs space-y-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Clock size="16" variant="Bold" className="text-primary" />
          Resolution Lifecycle Timeline (PRD §26.3)
        </h3>

        <ClaimTimeline claim={claim} />
      </div>

      {/* 7. Final Fact-Check Report & Audit Bundle (Post-Finalization) */}
      {isTerminal && report && (
        <div className="rounded-2xl border-2 border-primary/30 bg-card p-6 shadow-md space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Award size="22" variant="Bold" className="text-primary" />
                Public Fact-Check Report &amp; Audit Bundle
              </h2>
              <p className="text-xs text-muted-foreground">
                Authoritative on-chain certificate minted on Sui with Walrus permanent proofs.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={downloadAuditBundle}
              className="text-xs font-semibold min-h-[38px]"
            >
              <ArrowDown2 size="14" variant="Bold" className="mr-1.5" />
              Download JSON Audit Bundle
            </Button>
          </div>

          {/* 5 Agent Cards Grid */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Jury Card Breakdown (5 AI Models)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {report.agents.map((agentCard, idx) => (
                <AgentCard
                  key={idx}
                  reportCard={agentCard}
                  showVoteDetails={true}
                />
              ))}
            </div>
          </div>

          {/* Sui On-chain Objects */}
          <div className="bg-muted/40 p-4 rounded-xl border border-border/60 space-y-2 text-xs font-mono">
            <span className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground block">
              Sui Move Protocol Objects
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Claim Object: {report.sui.claimObjectId}</div>
              {report.sui.committeeId && <div>Committee Object: {report.sui.committeeId}</div>}
              {report.sui.certificateId && <div>Certificate Object: {report.sui.certificateId}</div>}
              <div>Revealed Votes: {report.sui.revealedVoteIds?.length ?? 0} object(s)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

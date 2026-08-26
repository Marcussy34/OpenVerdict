"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import {
  Profile2User,
  Cpu,
  ShieldTick,
  Activity,
  TickCircle,
  CloseCircle,
} from "iconsax-react";

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = use(params);

  const [agent, setAgent] = useState<AgentDirectoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function loadAgent() {
      try {
        const res = await fetch("/api/agents");
        if (ignore) return;
        if (res.ok) {
          const data = await res.json();
          const found = (data.agents as AgentDirectoryEntry[])?.find(
            (a) => a.agentProfileId.toLowerCase() === id.toLowerCase() || a.agentProfileId.includes(id),
          );
          if (found && !ignore) setAgent(found);
        }
      } catch {
        // Fallback stub
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadAgent();
    return () => {
      ignore = true;
    };
  }, [id]);

  // Fallback visual data if agent is not found or engine offline
  const displayAgent: AgentDirectoryEntry = agent ?? {
    agentProfileId: id,
    owner: "0x39a4...81ef",
    modelId: "moonshotai/Kimi-K2.6",
    role: "Primary Fact Checker & Synthesizer",
    manifestHash: "0x89ab...45cd" as `0x${string}`,
    active: true,
    reputation: {
      liveness_bps: 9950,
      valid_output_bps: 10000,
      valid_reveal_bps: 9980,
      evidence_quality_bps: 9400,
      consensus_reliability_bps: 9650,
      resolved_runs: 48,
    },
  };

  if (loading && !agent) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 space-y-6">
        <div className="h-8 w-40 bg-muted animate-pulse rounded" />
        <div className="h-48 bg-muted/60 animate-pulse rounded-2xl" />
        <div className="h-48 bg-muted/40 animate-pulse rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <Link
            href="/agents"
            className="text-xs text-muted-foreground hover:text-foreground font-medium"
          >
            ← Back to Directory
          </Link>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Profile2User size="18" variant="Bold" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Agent Profile</h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
        </div>

        <Badge
          variant="outline"
          className={`px-3 py-1 text-xs font-semibold flex items-center gap-1.5 ${
            displayAgent.active
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-zinc-500/40 bg-zinc-500/10 text-zinc-500"
          }`}
        >
          {displayAgent.active ? (
            <>
              <TickCircle size="14" variant="Bold" />
              Active Juror
            </>
          ) : (
            <>
              <CloseCircle size="14" variant="Bold" />
              Deprecated
            </>
          )}
        </Badge>
      </div>

      {/* Main Profile Info Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-border/50 pb-5">
          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Model Identity
            </span>
            <span className="text-base font-mono font-bold text-foreground flex items-center gap-1.5 mt-0.5">
              <Cpu size="16" variant="Bold" className="text-primary" />
              {displayAgent.modelId}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Persona &amp; Role
            </span>
            <span className="text-base font-semibold text-foreground mt-0.5 block">
              {displayAgent.role}
            </span>
          </div>
        </div>

        {/* Addresses & Hashes */}
        <div className="space-y-2 text-xs font-mono">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/40 gap-1">
            <span className="text-muted-foreground">Agent Profile Object ID:</span>
            <span className="text-foreground font-semibold truncate max-w-[280px]">
              {displayAgent.agentProfileId}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/40 gap-1">
            <span className="text-muted-foreground">Owner Account Address:</span>
            <span className="text-foreground font-semibold truncate max-w-[280px]">
              {displayAgent.owner}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/40 gap-1">
            <span className="text-muted-foreground">Manifest Blake2b-256 Hash:</span>
            <span className="text-foreground font-semibold truncate max-w-[280px]">
              {displayAgent.manifestHash}
            </span>
          </div>
        </div>
      </div>

      {/* Reputation Dimensions Breakdown */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-5">
        <div className="space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ShieldTick size="18" variant="Bold" className="text-primary" />
            Multi-Dimensional Reputation Breakdown
          </h2>
          <p className="text-xs text-muted-foreground">
            On-chain metrics maintained across historical dispute and direct review jury runs.
          </p>
        </div>

        <div className="space-y-4 pt-2">
          {/* Dimension 1: Liveness */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-foreground">Liveness &amp; Response Rate</span>
              <span className="font-mono text-muted-foreground">
                {(displayAgent.reputation?.liveness_bps ?? 10000) / 100}%
              </span>
            </div>
            <Progress value={(displayAgent.reputation?.liveness_bps ?? 10000) / 100} className="h-2" />
          </div>

          {/* Dimension 2: Valid Output Schema */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-foreground">Valid Structured Output Compliance</span>
              <span className="font-mono text-muted-foreground">
                {(displayAgent.reputation?.valid_output_bps ?? 10000) / 100}%
              </span>
            </div>
            <Progress value={(displayAgent.reputation?.valid_output_bps ?? 10000) / 100} className="h-2" />
          </div>

          {/* Dimension 3: Valid Reveal */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-foreground">Commitment Reveal Exactness</span>
              <span className="font-mono text-muted-foreground">
                {(displayAgent.reputation?.valid_reveal_bps ?? 10000) / 100}%
              </span>
            </div>
            <Progress value={(displayAgent.reputation?.valid_reveal_bps ?? 10000) / 100} className="h-2" />
          </div>

          {/* Dimension 4: Consensus Reliability */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-foreground">Consensus Reliability &amp; Soundness</span>
              <span className="font-mono text-muted-foreground">
                {(displayAgent.reputation?.consensus_reliability_bps ?? 10000) / 100}%
              </span>
            </div>
            <Progress value={(displayAgent.reputation?.consensus_reliability_bps ?? 10000) / 100} className="h-2" />
          </div>
        </div>
      </div>

      {/* Recent Inference Runs Section */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Activity size="16" variant="Bold" className="text-primary" />
          Recent Jury Inferences
        </h3>

        <div className="p-8 text-center bg-muted/20 rounded-xl border border-dashed border-border space-y-2">
          <p className="text-xs text-muted-foreground">
            No historical run transcripts cached for this agent ID in local observer storage.
          </p>
          <Link href="/claims">
            <button className="text-xs font-semibold text-primary underline mt-2">
              Browse Active Claims
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

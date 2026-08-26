"use client";

import { Badge } from "@/components/ui/badge";
import type { AgentRunSummary, CommitmentStatus, AgentCard } from "@/lib/engine/contract";
import {
  Cpu,
  Lock,
  Unlock,
  ShieldTick,
  ShieldCross,
  Warning2,
  Activity,
  Clock,
} from "iconsax-react";

interface AgentLaneProps {
  seatIndex: number;
  modelId?: string;
  role?: string;
  agentProfileId?: string;
  commitment?: CommitmentStatus;
  runSummary?: AgentRunSummary;
  revealedCard?: AgentCard;
  isRevealed?: boolean;
}

export function AgentLane({
  seatIndex,
  modelId = "moonshotai/Kimi-K2.6",
  role = "Juror Agent",
  agentProfileId,
  commitment,
  runSummary,
  revealedCard,
  isRevealed = false,
}: AgentLaneProps) {
  // Determine state of this juror lane
  // States: WAITING -> RUNNING -> COMMITTED (SEALED) -> REVEALED
  const hasRevealed = isRevealed || commitment?.revealed || !!revealedCard?.outcome;
  const isCommitted = commitment?.committed || !!runSummary || hasRevealed;
  const isRunning = !isCommitted && !!agentProfileId;

  // Outcome styling (Post-reveal ONLY)
  let outcomeBadge = null;
  if (hasRevealed && (revealedCard?.outcome || commitment?.outcome)) {
    const outcome = revealedCard?.outcome ?? (commitment?.outcome === 1 ? "YES" : commitment?.outcome === 2 ? "NO" : "UNSURE");
    const conf = revealedCard?.confidenceBps ?? commitment?.confidenceBps ?? 8500;

    let colorClass = "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    let Icon = Warning2;

    if (outcome === "YES") {
      colorClass = "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
      Icon = ShieldTick;
    } else if (outcome === "NO") {
      colorClass = "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
      Icon = ShieldCross;
    }

    outcomeBadge = (
      <Badge variant="outline" className={`px-2.5 py-1 text-xs font-bold flex items-center gap-1.5 ${colorClass}`}>
        <Icon size="14" variant="Bold" />
        <span>
          {outcome} ({Math.round(conf / 100)}% conf)
        </span>
      </Badge>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-all ${
        hasRevealed
          ? "border-emerald-500/40 bg-card shadow-xs"
          : isCommitted
            ? "border-indigo-500/40 bg-card/90"
            : isRunning
              ? "border-blue-500/40 bg-blue-500/5 animate-pulse"
              : "border-border/60 bg-muted/30"
      }`}
    >
      {/* Header: Seat Number + Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-mono font-bold">
            #{seatIndex}
          </span>
          <span className="text-xs font-semibold text-foreground truncate max-w-[140px] sm:max-w-[200px]">
            {role}
          </span>
        </div>

        {/* State Badge */}
        {hasRevealed ? (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1"
          >
            <Unlock size="12" variant="Bold" />
            Revealed
          </Badge>
        ) : isCommitted ? (
          <Badge
            variant="outline"
            className="border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold flex items-center gap-1"
          >
            <Lock size="12" variant="Bold" />
            Sealed
          </Badge>
        ) : isRunning ? (
          <Badge
            variant="outline"
            className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-[11px] font-medium flex items-center gap-1"
          >
            <Activity size="12" variant="Bold" />
            Running
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] text-muted-foreground bg-muted flex items-center gap-1">
            <Clock size="12" variant="Bold" />
            Waiting
          </Badge>
        )}
      </div>

      {/* Model ID & Agent Profile */}
      <div className="space-y-1 bg-muted/40 p-2.5 rounded-lg border border-border/40 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-1">
            <Cpu size="13" variant="Bold" />
            Model:
          </span>
          <span className="font-mono font-bold text-foreground truncate max-w-[160px]">
            {modelId}
          </span>
        </div>
        {agentProfileId && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
            <span>Agent Profile:</span>
            <span className="font-mono truncate max-w-[140px]">{agentProfileId}</span>
          </div>
        )}
      </div>

      {/* Sealed vs Revealed Content */}
      {hasRevealed ? (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">{outcomeBadge}</div>

          {revealedCard?.reasoning && (
            <p className="text-xs text-foreground/80 italic line-clamp-2 bg-background p-2 rounded border border-border/50">
              &quot;{revealedCard.reasoning}&quot;
            </p>
          )}

          {revealedCard?.gonkaRequestId && (
            <div className="text-[10px] font-mono text-muted-foreground truncate">
              Gonka ID: {revealedCard.gonkaRequestId}
            </div>
          )}
        </div>
      ) : isCommitted ? (
        /* Strict Pre-Reveal Redaction: sealed state only */
        <div className="space-y-1.5 py-1 text-xs text-muted-foreground bg-indigo-500/5 p-2.5 rounded-lg border border-indigo-500/20">
          <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-medium">
            <Lock size="14" variant="Bold" />
            <span>Commitment Sealed (Blake2b-256)</span>
          </div>
          <p className="text-[11px] leading-tight text-muted-foreground">
            Vote and reasoning preimage are cryptographically sealed on-chain until the reveal phase.
          </p>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-2 text-center">
          Awaiting jury execution
        </div>
      )}

      {/* Latency & Attempt */}
      {runSummary && (
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground border-t border-border/40 pt-2">
          <span>Latency: {runSummary.latencyMs}ms</span>
          <span>Attempt #{runSummary.attempt}</span>
        </div>
      )}
    </div>
  );
}

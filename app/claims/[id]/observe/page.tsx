"use client";

import { useState, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PhaseRail } from "@/components/observer/phase-rail";
import { AgentLane } from "@/components/observer/agent-lane";
import { EventRow } from "@/components/observer/event-row";
import { useClaimEvents } from "@/components/use-claim-events";
import type { ResolutionEventSource } from "@/lib/engine/contract";
import {
  Eye,
  Activity,
  Warning2,
  Filter,
  ShieldTick,
  InfoCircle,
  Refresh,
  Lock,
  Judge,
} from "iconsax-react";

interface ObservePageProps {
  params: Promise<{ id: string }>;
}

const DEFAULT_MODELS = [
  { modelId: "moonshotai/Kimi-K2.6", role: "Primary Fact Checker" },
  { modelId: "deepseek-v4-flash", role: "Adversarial Auditor" },
  { modelId: "minimax-m2-7", role: "Evidence Verification Juror" },
  { modelId: "deepseek-v4-flash", role: "Corroboration Juror" },
  { modelId: "moonshotai/Kimi-K2.6", role: "Summary & Synthesis Juror" },
];

export default function ObservePage({ params }: ObservePageProps) {
  const { id } = use(params);

  const { events, status, isDelayed, error, reconnect } = useClaimEvents(id);

  const [selectedSource, setSelectedSource] = useState<ResolutionEventSource | "ALL">("ALL");

  // Determine current phase from latest event
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const currentPhase = latestEvent?.phase ?? "EVIDENCE";

  // Filter events
  const filteredEvents = events.filter((ev) => {
    if (selectedSource === "ALL") return true;
    return ev.source === selectedSource;
  });

  return (
    <div className="max-w-7xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* 1. Header & Read-Only Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/claims/${encodeURIComponent(id)}`}
              className="text-xs text-muted-foreground hover:text-foreground font-medium"
            >
              ← Claim Overview
            </Link>
            <span className="text-muted-foreground text-xs">•</span>
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
              {id}
            </span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Eye size="18" variant="Bold" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              Live Resolution Observer
            </h1>
            <Badge
              variant="outline"
              className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-[10px] font-semibold"
            >
              Read-Only
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
        </div>

        {/* Live Stream Connection Status indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 rounded-lg border border-border/60 text-xs">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "connected"
                  ? "bg-emerald-500 animate-pulse"
                  : isDelayed
                    ? "bg-amber-500 animate-pulse"
                    : status === "connecting"
                      ? "bg-blue-500 animate-pulse"
                      : "bg-red-500"
              }`}
            />
            <span className="font-mono capitalize font-medium text-foreground">
              {status === "connected"
                ? "Live Stream"
                : isDelayed
                  ? "Delayed Data"
                  : status}
            </span>
          </div>

          <Link href="/verify">
            <Button variant="outline" size="sm" className="min-h-[38px] text-xs font-semibold">
              <ShieldTick size="15" variant="Bold" className="mr-1" />
              Verify Proofs
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. Delayed Data Warning per PRD §34.3 */}
      {isDelayed && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100">
          <Warning2 size="20" variant="Bold" className="text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold text-sm">Delayed Observer Data</AlertTitle>
          <AlertDescription className="text-xs space-y-2 mt-1">
            <p>
              {error || "The event stream is currently reconnecting or the backend indexer is delayed. Per protocol specifications, the UI does not guess or interpolate intermediate state."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={reconnect}
              className="h-8 text-xs font-semibold border-amber-500/40"
            >
              <Refresh size="12" variant="Bold" className="mr-1" />
              Force Stream Reconnect
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 3. Phase Rail Progression */}
      <PhaseRail currentPhase={currentPhase} />

      {/* 4. Five Agent Activity Lanes (PRD §26.8 layout) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Judge size="16" variant="Bold" className="text-primary" />
              Five Juror Activity Lanes
            </h2>
            <p className="text-xs text-muted-foreground">
              Multi-model diversity: ≥3 distinct model families with sealed Blake2b-256 commitments.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
            <Lock size="14" variant="Bold" />
            <span>Pre-reveal Redaction Active</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {DEFAULT_MODELS.map((m, idx) => (
            <AgentLane
              key={idx}
              seatIndex={idx + 1}
              modelId={m.modelId}
              role={m.role}
              agentProfileId={`0x7a8${idx}…`}
            />
          ))}
        </div>
      </div>

      {/* 5. Live Resolution Event Log (PRD §26.8 & §29.12) */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Activity size="18" variant="Bold" className="text-primary" />
              Resolution Event Stream
            </h2>
            <p className="text-xs text-muted-foreground">
              Real-time one-way log of verified engine, GonkaRouter, evidence, and Sui blockchain events.
            </p>
          </div>

          {/* Source Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter size="14" variant="Bold" className="text-muted-foreground" />
            {(
              [
                "ALL",
                "ENGINE",
                "GONKA_ROUTER",
                "TOOL",
                "EVIDENCE",
                "SUI",
              ] as const
            ).map((src) => (
              <button
                key={src}
                onClick={() => setSelectedSource(src)}
                className={`rounded px-2.5 py-1 text-[11px] font-mono font-semibold transition-colors ${
                  selectedSource === src
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>

        {/* Event List */}
        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center space-y-2 bg-muted/20 rounded-xl border border-dashed border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto">
              <InfoCircle size="18" variant="Bold" />
            </div>
            <p className="text-xs text-muted-foreground">
              {events.length === 0
                ? "Connecting to live SSE stream... No events received yet."
                : "No events match the selected source filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {filteredEvents.map((ev) => (
              <EventRow key={ev.eventId || ev.sequence} event={ev} />
            ))}
          </div>
        )}
      </div>

      {/* 6. Observer Boundary Footer Notice */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <InfoCircle size="15" variant="Bold" className="text-primary" />
          Observer Guarantees &amp; Security Boundary
        </span>
        <p className="leading-relaxed">
          The observer contains no signer and cannot advance protocol state, trigger model inferences, or derive unrevealed votes. If this observer frontend is stopped or disconnected, the underlying Sui Move protocol and headless verification engine continue without interruption.
        </p>
      </div>
    </div>
  );
}

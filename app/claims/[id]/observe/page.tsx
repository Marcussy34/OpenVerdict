"use client";

import { useState, use, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PhaseRail, phaseIndexOf } from "@/components/observer/phase-rail";
import { AgentLane } from "@/components/observer/agent-lane";
import { EventRow } from "@/components/observer/event-row";
import { useClaimEvents } from "@/components/use-claim-events";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { StatusPill } from "@/components/viz/live-dot";
import { HashChip } from "@/components/viz/hash-chip";
import { StateBadge } from "@/components/claim/state-badge";
import { modelFamily } from "@/components/viz/model-badge";
import { outcomeLabel, seatStateOf, type SeatState } from "@/components/viz/seat-seal";
import { cn } from "@/lib/utils";
import type {
  ClaimInspection,
  AgentDirectoryEntry,
  ResolutionEventSource,
} from "@/lib/engine/contract";
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
} from "@/components/icons";

interface ObservePageProps {
  params: Promise<{ id: string }>;
}

const SOURCE_FILTERS = ["ALL", "ENGINE", "GONKA_ROUTER", "TOOL", "EVIDENCE", "SUI"] as const;

export default function ObservePage({ params }: ObservePageProps) {
  const { id } = use(params);
  const { events, status, isDelayed, error, reconnect } = useClaimEvents(id);

  const [selectedSource, setSelectedSource] = useState<ResolutionEventSource | "ALL">("ALL");
  const [claim, setClaim] = useState<ClaimInspection | null>(null);
  const [agents, setAgents] = useState<AgentDirectoryEntry[]>([]);

  // Read-only lookups: the authoritative seat state lives in the claim
  // inspection, and model/role identity in the agent registry. Without these the
  // lanes could only guess, which is how they used to read "awaiting jury
  // execution" while five commitments were already sealed on-chain.
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const [claimRes, agentsRes] = await Promise.all([
          fetch(`/api/claims/${encodeURIComponent(id)}`),
          fetch("/api/agents"),
        ]);
        if (ignore) return;
        if (claimRes.ok) setClaim(await claimRes.json());
        if (agentsRes.ok) {
          const data = await agentsRes.json();
          if (!ignore) setAgents(data.agents ?? []);
        }
      } catch {
        /* the observer degrades to the event stream alone */
      }
    })();
    return () => {
      ignore = true;
    };
  }, [id]);

  const agentsById = useMemo(() => {
    const map = new Map<string, AgentDirectoryEntry>();
    for (const agent of agents) map.set(agent.agentProfileId, agent);
    return map;
  }, [agents]);

  /** Latest public event per seat, used for the "running" state and lane footer. */
  const seatActivity = useMemo(() => {
    const map = new Map<
      string,
      { kind: string; running: boolean; latencyMs?: number; attempt?: number }
    >();
    for (const ev of events) {
      if (!ev.actorId) continue;
      const payload = ev.payload as Record<string, unknown>;
      const statusValue = typeof payload.status === "string" ? payload.status : undefined;
      map.set(ev.actorId, {
        kind: ev.kind,
        running: ev.kind === "agent_activity" && statusValue === "RUNNING",
        latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : undefined,
        attempt: typeof payload.attempt === "number" ? payload.attempt : undefined,
      });
    }
    return map;
  }, [events]);

  /** Seats come from the on-chain commitments; identity from the registry. */
  const seats = useMemo(() => {
    const commitments = claim?.commitments ?? [];
    return commitments.map((c, i) => {
      const agent = agentsById.get(c.agentProfileId);
      const activity = seatActivity.get(c.agentProfileId);
      const base = seatStateOf(c);
      const state: SeatState = base === "pending" && activity?.running ? "running" : base;
      return {
        key: c.jurySeatId || `${i}`,
        index: i + 1,
        state,
        outcome: outcomeLabel(c.outcome),
        confidenceBps: c.confidenceBps,
        agentProfileId: c.agentProfileId,
        jurySeatId: c.jurySeatId,
        modelId: agent?.modelId,
        role: agent?.role,
        lastEventKind: activity?.kind,
        latencyMs: activity?.latencyMs,
        attempt: activity?.attempt,
      };
    });
  }, [claim, agentsById, seatActivity]);

  const families = useMemo(
    () => new Set(seats.map((s) => modelFamily(s.modelId).key).filter((k) => k !== "other")),
    [seats],
  );

  // Claim state is authoritative for the phase; the event stream is the fallback
  // while the inspection request is still in flight.
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const currentPhase: number | string = claim ? claim.state : (latestEvent?.phase ?? "EVIDENCE");
  const phaseIndex = phaseIndexOf(currentPhase);

  const filteredEvents = useMemo(
    () =>
      selectedSource === "ALL" ? events : events.filter((ev) => ev.source === selectedSource),
    [events, selectedSource],
  );

  const sealedCount = seats.filter((s) => s.state === "sealed").length;
  const revealedCount = seats.filter((s) => s.state === "revealed").length;

  const connectionTone =
    status === "connected" ? "live" : isDelayed ? "warn" : status === "connecting" ? "chain" : "down";
  const connectionLabel =
    status === "connected"
      ? "Live stream"
      : isDelayed
        ? "Delayed data"
        : status === "connecting"
          ? "Connecting"
          : status;

  return (
    <div className="space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        backHref={`/claims/${encodeURIComponent(id)}`}
        backLabel="Claim report"
        eyebrow="Observer"
        title="Live resolution observer"
        icon={Eye}
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <MetaTag tone="chain">Read-only</MetaTag>
            <ExperimentalTag />
          </div>
        }
        actions={
          <>
            <StatusPill
              tone={connectionTone}
              label={connectionLabel}
              sub={`${events.length} events`}
            />
            <Button asChild variant="outline" size="sm" className="min-h-[40px] font-semibold">
              <Link href="/verify">
                <ShieldTick size="15" variant="Bold" />
                Verify proofs
              </Link>
            </Button>
          </>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <HashChip value={id} label="claim" tone="chain" head={10} tail={8} />
          {claim && <StateBadge state={claim.state} size="sm" />}
          {claim?.committeeId && (
            <HashChip value={claim.committeeId} label="committee" tone="sealed" />
          )}
        </div>
      </PageHeader>

      {/* Delayed-data notice per PRD §34.3 — the observer never interpolates. */}
      {isDelayed && (
        <Alert className="border-unsure/35 bg-unsure/8">
          <Warning2 size="18" variant="Bold" className="text-unsure" />
          <AlertTitle className="text-sm font-semibold text-ocean">
            Delayed observer data
          </AlertTitle>
          <AlertDescription className="mt-1 space-y-2 text-xs text-muted-foreground">
            <p>
              {error ||
                "The event stream is reconnecting or the backend indexer is delayed. Per protocol specification the UI does not guess or interpolate intermediate state."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={reconnect}
              className="min-h-[34px] border-unsure/40 text-xs font-semibold"
            >
              <Refresh size="12" variant="Bold" />
              Force stream reconnect
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <PhaseRail currentPhase={currentPhase} />

      {/* ------------------------------------------------------- Juror lanes */}
      <Panel
        label="Five juror activity lanes"
        icon={Judge}
        tone={revealedCount > 0 ? "yes" : "sealed"}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <MetaTag tone="sealed">
              <Lock size="10" variant="Bold" />
              Pre-reveal redaction
            </MetaTag>
            <MetaTag tone={revealedCount > 0 ? "yes" : "default"}>
              {revealedCount > 0
                ? `${revealedCount}/${seats.length} revealed`
                : `${sealedCount}/${seats.length || 5} sealed`}
            </MetaTag>
          </div>
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Committee diversity is a protocol invariant: {families.size || "≥3"} distinct model
          {families.size === 1 ? " family" : " families"} across five seats, each carrying a
          sealed Blake2b-256 commitment until the reveal phase.
        </p>

        {seats.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-56 animate-pulse rounded-2xl border border-border bg-surface"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {seats.map((seat) => (
              <AgentLane
                key={seat.key}
                seatIndex={seat.index}
                state={seat.state}
                outcome={seat.outcome}
                confidenceBps={seat.confidenceBps}
                modelId={seat.modelId}
                role={seat.role}
                agentProfileId={seat.agentProfileId}
                jurySeatId={seat.jurySeatId}
                lastEventKind={seat.lastEventKind}
                latencyMs={seat.latencyMs}
                attempt={seat.attempt}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------- Event stream */}
      <Panel
        label="Resolution event stream"
        icon={Activity}
        tone="primary"
        live={status === "connected"}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <Filter size="13" className="text-muted-foreground" />
            {SOURCE_FILTERS.map((src) => (
              <button
                key={src}
                onClick={() => setSelectedSource(src)}
                aria-pressed={selectedSource === src}
                className={cn(
                  "ov-micro ov-micro-sm rounded-md px-2 py-1 transition-colors",
                  selectedSource === src
                    ? "bg-sea/12 text-primary"
                    : "bg-surface text-muted-foreground hover:text-ocean",
                )}
              >
                {src}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            One-way log of verified engine, GonkaRouter, evidence and Sui events — ordered by
            sequence, resumable by Last-Event-ID.
          </p>
          <div className="flex items-center gap-3">
            <FieldLabel>
              {filteredEvents.length} shown · seq {latestEvent?.sequence ?? 0}
            </FieldLabel>
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            <span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
              <InfoCircle size="18" variant="Bold" />
            </span>
            <p className="text-xs text-muted-foreground">
              {events.length === 0
                ? "Connecting to the live SSE stream — no events received yet."
                : "No events match the selected source filter."}
            </p>
          </div>
        ) : (
          <ol className="ov-scroll ov-fade-y max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {filteredEvents.map((ev) => (
              <EventRow key={ev.eventId || ev.sequence} event={ev} animate />
            ))}
          </ol>
        )}
      </Panel>

      {/* -------------------------------------------- Security boundary note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        <InfoCircle size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ocean">
            Observer guarantees &amp; security boundary
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The observer contains no signer and cannot advance protocol state, trigger model
            inferences, or derive unrevealed votes. If this frontend is stopped or
            disconnected, the underlying Sui Move protocol and headless verification engine
            continue without interruption. Currently showing phase {phaseIndex} of 6.
          </p>
        </div>
      </div>
    </div>
  );
}

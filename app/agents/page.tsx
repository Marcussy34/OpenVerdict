"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ModelLogo, modelVariantFor } from "@/components/viz/model-logo";
import { StakeSeatCard } from "@/components/agents/stake-seat-card";
import {
  stakeSentence,
  type StakedAgentEntry,
} from "@/components/agents/stake-line";
import { modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import { Warning2, Refresh, ArrowRight2 } from "@/components/icons";

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** " · earned 0.42 SUI" when any jury rewards exist, empty otherwise. */
function earnedSui(earnedMist: string | undefined): string {
  if (!earnedMist || earnedMist === "0") return "";
  const sui = Number(BigInt(earnedMist)) / 1_000_000_000;
  return ` · earned ${sui.toFixed(sui >= 1 ? 2 : 3)} SUI`;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<StakedAgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [familyFilter, setFamilyFilter] = useState<string>("ALL");

  const loadAgents = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      const res = await fetch("/api/agents");
      if (res.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      setEngineOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const res = await fetch("/api/agents");
        if (ignore) return;
        if (res.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!ignore) setAgents(data.agents || []);
        }
      } catch {
        if (!ignore) setEngineOffline(true);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void init();
    return () => {
      ignore = true;
    };
  }, []);

  /** Families present in the registry: the diversity rule, made visible. */
  const familyGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; dot: string }>();
    for (const agent of agents.filter((a) => a.active)) {
      const fam = modelFamily(agent.modelId);
      const entry = map.get(fam.key);
      map.set(fam.key, { name: fam.name, dot: fam.dot, count: (entry?.count ?? 0) + 1 });
    }
    return map;
  }, [agents]);

  // The preview lists active jurors only; retired package generations stay
  // in the API for history but out of the directory.
  const activeAgents = useMemo(() => agents.filter((a) => a.active), [agents]);

  const filteredAgents = useMemo(
    () =>
      activeAgents.filter(
        (agent) => familyFilter === "ALL" || modelFamily(agent.modelId).key === familyFilter,
      ),
    [activeAgents, familyFilter],
  );

  // Tints run over the whole registry, not the filtered view, so an agent
  // keeps its tone when the family filter changes.
  const agentSeats = useMemo(
    () => activeAgents.map((agent) => ({ id: agent.agentProfileId, modelId: agent.modelId })),
    [activeAgents],
  );

  const activeCount = activeAgents.length;

  return (
    // Wider than the other console pages: three juror cards to a row need the
    // room, and every card line reads in full rather than being truncated.
    <div className="mx-auto max-w-6xl space-y-10 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: one word plus one line of truth. */}
      <div className="space-y-3 text-center">
        <h1 className="ov-display text-4xl text-ocean md:text-5xl">Agents</h1>
        {!loading && !engineOffline && agents.length > 0 && (
          <p className="ov-micro ov-micro-sm text-muted-foreground">
            {agents.length} registered · {activeCount} active · {familyGroups.size} model families
          </p>
        )}
      </div>

      {/* Family chips: light, centered, counted. */}
      {!loading && agents.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          <FamilyChip
            label="All"
            count={activeAgents.length}
            active={familyFilter === "ALL"}
            onClick={() => setFamilyFilter("ALL")}
          />
          {[...familyGroups.entries()].map(([key, fam]) => (
            <FamilyChip
              key={key}
              label={fam.name}
              dot={fam.dot}
              count={fam.count}
              active={familyFilter === key}
              onClick={() => setFamilyFilter(key)}
            />
          ))}
        </div>
      )}

      {/* One row per juror; the full dossier lives behind the click. */}
      <section className="mx-auto w-full">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : engineOffline ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Warning2 size="22" variant="Bold" />
            </span>
            <p className="text-sm font-semibold text-ocean">Engine offline</p>
            <Button variant="outline" size="sm" onClick={() => loadAgents()} className="min-h-[38px] font-semibold">
              <Refresh size="14" variant="Bold" />
              Retry
            </Button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-xs text-muted-foreground">
            No agents in this family yet.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Three seats per row so the whole registry is in view at once
                (owner). Tints are keyed on registry order, so a model's seats
                differ. */}
            {filteredAgents.map((agent) => {
              const fam = modelFamily(agent.modelId);
              const staked = stakeSentence(agent);
              return (
                <li key={agent.agentProfileId} className="ov-edge rounded-2xl border border-border bg-card">
                  <Link
                    href={`/agents/${agent.agentProfileId}`}
                    className="flex h-full items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <ModelLogo
                      modelId={agent.modelId}
                      variant={modelVariantFor(agentSeats, agent.agentProfileId)}
                      size={36}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-ocean">
                        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", fam.dot)} />
                        <span className="truncate">{fam.name}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">
                        {shortId(agent.agentProfileId)}
                      </p>
                      {agent.trackRecord && (
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {agent.trackRecord.seatsServed} seats ·{" "}
                          {agent.trackRecord.revealed} revealed ·{" "}
                          {agent.trackRecord.agreedWithCertificate} agreed
                          {earnedSui(agent.earnedMist)}
                        </p>
                      )}
                      {/* Real stake, so who posted it and how much is the headline. */}
                      {staked && (
                        <p className="mt-0.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">
                          {staked}
                        </p>
                      )}
                    </div>
                    <ArrowRight2 size="14" className="shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Operator onboarding stays: it is the one action this page offers. */}
      <div className="mx-auto w-full max-w-3xl">
        <StakeSeatCard onStaked={loadAgents} />
      </div>
    </div>
  );
}

function FamilyChip({
  label,
  dot,
  count,
  active,
  onClick,
}: {
  label: string;
  dot?: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // Same chip recipe as the claims filter: sharp, one hairline weight,
        // accent only when active.
        "flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-sea/40 bg-sea/12 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-sea/40 hover:text-ocean",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span className="text-[11px] tabular-nums opacity-70">{count}</span>
    </button>
  );
}

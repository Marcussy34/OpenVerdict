"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { modelVariantFor } from "@/components/viz/model-logo";
import { StakeSeatCard } from "@/components/agents/stake-seat-card";
import { JurorSeatCard } from "@/components/agents/juror-seat-card";
import { type StakedAgentEntry } from "@/components/agents/stake-line";
import { modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import { Warning2, Refresh } from "@/components/icons";

/**
 * The research prompt hash the active seats carry, which is the roster's
 * current generation. Seats staked together share one hash and a republished
 * prompt starts the next generation, so a retired seat never matches. The most
 * common hash wins if the active seats ever straddle two generations, and an
 * API that sends none at all yields nothing to compare.
 */
function currentPromptHash(agents: readonly StakedAgentEntry[]): string | undefined {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.active || !agent.promptHash) continue;
    counts.set(agent.promptHash, (counts.get(agent.promptHash) ?? 0) + 1);
  }
  let current: string | undefined;
  let best = 0;
  for (const [hash, count] of counts) {
    if (count > best) {
      current = hash;
      best = count;
    }
  }
  return current;
}

/** "moonshotai/Kimi-K2.6" reads as "Kimi K2.6": the family, then the revision. */
function modelWords(modelId: string): string {
  return modelFamily(modelId).short.replace(/^([A-Za-z]+)-/, "$1 ");
}

/** "DeepSeek", or "DeepSeek and Kimi" once more than one family is out. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Why a whole family is off the draw, in one line: the router is what is
 * missing, not the protocol, and the seats come back with one on-chain flag.
 */
function sittingOutSentence(models: readonly string[]): string {
  const seats = models.length > 1 ? "their seats" : "its seats";
  return `GonkaRouter does not serve ${joinNames(models)} right now, so the operator holds ${seats} out of the draw. They return with one on-chain switch.`;
}

/** "34 registered · 10 active · 2 sitting out · 2 of 3 model families". */
function rosterLine(counts: {
  registered: number;
  active: number;
  sittingOut: number;
  activeFamilies: number;
  sittingOutFamilies: number;
}): string {
  const parts = [`${counts.registered} registered`, `${counts.active} active`];
  if (counts.sittingOut > 0) parts.push(`${counts.sittingOut} sitting out`);
  parts.push(
    counts.sittingOutFamilies > 0
      ? `${counts.activeFamilies} of ${counts.activeFamilies + counts.sittingOutFamilies} model families`
      : `${counts.activeFamilies} model families`,
  );
  return parts.join(" · ");
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

  /**
   * Seats the operator holds out of the draw, rather than seats it retired: a
   * model family with no active seat at all, staked under the same research
   * prompt as the seats that are sitting. Retired generations carry an older
   * prompt hash, so they stay hidden, and a roster with no current hash to
   * compare against shows nothing.
   */
  const sittingOutAgents = useMemo(() => {
    const generation = currentPromptHash(agents);
    if (generation === undefined) return [];
    const activeFamilies = new Set(
      agents.filter((a) => a.active).map((a) => modelFamily(a.modelId).key),
    );
    return agents.filter(
      (agent) =>
        !agent.active &&
        !activeFamilies.has(modelFamily(agent.modelId).key) &&
        agent.promptHash === generation,
    );
  }, [agents]);

  /** One entry per family sitting out, for the chip and the one-line copy. */
  const sittingOutFamilies = useMemo(() => {
    const map = new Map<string, { name: string; modelId: string }>();
    for (const agent of sittingOutAgents) {
      const fam = modelFamily(agent.modelId);
      if (!map.has(fam.key)) map.set(fam.key, { name: fam.name, modelId: agent.modelId });
    }
    return map;
  }, [sittingOutAgents]);

  const filteredAgents = useMemo(
    () =>
      activeAgents.filter(
        (agent) => familyFilter === "ALL" || modelFamily(agent.modelId).key === familyFilter,
      ),
    [activeAgents, familyFilter],
  );

  // The sitting-out group answers to the same chip filter as the active grid.
  const filteredSittingOut = useMemo(
    () =>
      sittingOutAgents.filter(
        (agent) => familyFilter === "ALL" || modelFamily(agent.modelId).key === familyFilter,
      ),
    [sittingOutAgents, familyFilter],
  );

  // Tints run over the whole registry, not the filtered view, so an agent
  // keeps its tone when the family filter changes. The sitting-out seats ride
  // at the end, so an active seat's tone never shifts either.
  const agentSeats = useMemo(
    () =>
      [...activeAgents, ...sittingOutAgents].map((agent) => ({
        id: agent.agentProfileId,
        modelId: agent.modelId,
      })),
    [activeAgents, sittingOutAgents],
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
            {rosterLine({
              registered: agents.length,
              active: activeCount,
              sittingOut: sittingOutAgents.length,
              activeFamilies: familyGroups.size,
              sittingOutFamilies: sittingOutFamilies.size,
            })}
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
          {/* Not a control: a family with no active seat has nothing to filter
              to, so it states the fact and stays out of the tab order. */}
          {[...sittingOutFamilies.entries()].map(([key, fam]) => (
            <span
              key={key}
              className="flex items-center border border-dashed border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {fam.name} · sitting out
            </span>
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
            {filteredAgents.map((agent) => (
              <JurorSeatCard
                key={agent.agentProfileId}
                agent={agent}
                variant={modelVariantFor(agentSeats, agent.agentProfileId)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Staked seats the operator holds out of the draw. Quiet by design: the
          seats are healthy, their model is the thing that is unavailable. */}
      {!loading && !engineOffline && filteredSittingOut.length > 0 && (
        <section className="mx-auto w-full space-y-4">
          <div className="space-y-1.5 text-center">
            <p className="ov-micro ov-micro-sm text-muted-foreground">Sitting out</p>
            <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {sittingOutSentence(
                [...sittingOutFamilies.values()].map((fam) => modelWords(fam.modelId)),
              )}
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSittingOut.map((agent) => (
              <JurorSeatCard
                key={agent.agentProfileId}
                agent={agent}
                variant={modelVariantFor(agentSeats, agent.agentProfileId)}
                sittingOut
              />
            ))}
          </ul>
        </section>
      )}

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

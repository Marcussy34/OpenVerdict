"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JurorAvatar } from "@/components/agents/avatar";
import { ZkLoginRegistrationCard } from "@/components/agents/zklogin-registration-card";
import { modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import type { JurorFamily } from "@/lib/viz/deliberation-graph";
import { Warning2, Refresh, ArrowRight2 } from "@/components/icons";

const KNOWN_FAMILIES = new Set(["deepseek", "kimi", "minimax"]);

function jurorFamilyOf(modelId: string): JurorFamily {
  const key = modelFamily(modelId).key;
  return (KNOWN_FAMILIES.has(key) ? key : "unknown") as JurorFamily;
}

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
  const [agents, setAgents] = useState<AgentDirectoryEntry[]>([]);
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

  const activeCount = activeAgents.length;

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-5 py-16 md:px-7 md:py-24">
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
      <section className="mx-auto w-full max-w-3xl">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : engineOffline ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-unsure/10 text-unsure">
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
          <ul className="ov-edge divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filteredAgents.map((agent, index) => {
              const fam = modelFamily(agent.modelId);
              return (
                <li key={agent.agentProfileId}>
                  <Link
                    href={`/agents/${agent.agentProfileId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <JurorAvatar
                      family={jurorFamilyOf(agent.modelId)}
                      ordinal={index}
                      avatarKey={agent.agentProfileId}
                      size={36}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-ocean">
                        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", fam.dot)} />
                        <span className="truncate">{fam.name}</span>
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {shortId(agent.agentProfileId)} · {agent.role}
                      </p>
                      {agent.trackRecord && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {agent.trackRecord.seatsServed} seats ·{" "}
                          {agent.trackRecord.revealed} revealed ·{" "}
                          {agent.trackRecord.agreedWithCertificate} agreed
                          {earnedSui(agent.earnedMist)}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        agent.backing?.kind === "ZKLOGIN"
                          ? "bg-yes/10 text-yes"
                          : agent.backing?.kind === "ALLOWLIST"
                            ? "bg-sea/10 text-primary"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {agent.backing?.kind === "ZKLOGIN"
                        ? "Human-backed"
                        : agent.backing?.kind === "ALLOWLIST"
                          ? "Allowlist"
                          : "Unverified"}
                    </span>
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
        <ZkLoginRegistrationCard onRegistered={loadAgents} />
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
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-sea/40 bg-sea/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-sea/30 hover:text-ocean",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span className="text-[11px] tabular-nums opacity-70">{count}</span>
    </button>
  );
}

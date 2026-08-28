"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/agents/agent-card";
import { ZkLoginRegistrationCard } from "@/components/agents/zklogin-registration-card";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { StatTile } from "@/components/viz/stat-tile";
import { Stagger } from "@/components/viz/reveal";
import { modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import {
  Profile2User,
  SearchNormal1,
  Warning2,
  InfoCircle,
  Refresh,
  Cpu,
  Judge,
  TickCircle,
} from "@/components/icons";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState<string>("ALL");
  const [activeOnly, setActiveOnly] = useState(false);

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
    init();
    return () => {
      ignore = true;
    };
  }, []);

  /** Model families present in the registry — the ≥3 diversity rule made visible. */
  const familyGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; dot: string }>();
    for (const agent of agents) {
      const fam = modelFamily(agent.modelId);
      const entry = map.get(fam.key);
      map.set(fam.key, {
        name: fam.name,
        dot: fam.dot,
        count: (entry?.count ?? 0) + 1,
      });
    }
    return map;
  }, [agents]);

  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (activeOnly && !agent.active) return false;
        if (familyFilter !== "ALL" && modelFamily(agent.modelId).key !== familyFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (
            !agent.modelId.toLowerCase().includes(q) &&
            !agent.role.toLowerCase().includes(q) &&
            !agent.agentProfileId.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      }),
    [agents, activeOnly, familyFilter, searchQuery],
  );

  const activeCount = agents.filter((a) => a.active).length;
  const owners = new Set(agents.map((a) => a.owner)).size;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <PageHeader
        eyebrow="Registry"
        title="Agent registry"
        description="Registered AI juror agents, their model families, human-backing attestations and multi-dimensional reputation, read straight from the on-chain registry."
        icon={Profile2User}
        badges={<ExperimentalTag />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Registered agents"
          value={agents.length}
          icon={Profile2User}
          tone="primary"
        />
        <StatTile label="Active jurors" value={activeCount} icon={TickCircle} tone="yes" />
        <StatTile
          label="Model families"
          value={familyGroups.size}
          icon={Cpu}
          tone="sealed"
          hint="≥3 required per committee."
        />
        <StatTile
          label="Distinct owners"
          value={owners}
          icon={Judge}
          tone="chain"
          hint="Max one seat per human identity."
        />
      </div>

      <ZkLoginRegistrationCard onRegistered={loadAgents} />

      {/* Search + family filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <SearchNormal1
            size="16"
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search agents by model, role or object id…"
            className="h-11 pl-10 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search agents"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="ov-scroll flex items-center gap-1 overflow-x-auto rounded-full border border-border bg-card p-1">
            <FamilyChip
              label="All families"
              active={familyFilter === "ALL"}
              onClick={() => setFamilyFilter("ALL")}
              count={agents.length}
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

          <button
            onClick={() => setActiveOnly((v) => !v)}
            aria-pressed={activeOnly}
            className={cn(
              "flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors",
              activeOnly
                ? "border-yes/35 bg-yes/8 text-yes"
                : "border-border bg-card text-muted-foreground hover:text-ocean",
            )}
          >
            <TickCircle size="14" variant="Bold" />
            Active only
          </button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="ov-edge h-80 animate-pulse rounded-2xl border border-border bg-card"
            />
          ))}
        </div>
      ) : engineOffline ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-unsure/10 text-unsure">
            <Warning2 size="24" variant="Bold" />
          </span>
          <h2 className="text-lg font-semibold text-ocean">Engine offline / standalone mode</h2>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            The agent directory cannot be queried while the verification engine returns 503.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAgents()}
            className="min-h-[40px] font-semibold"
          >
            <Refresh size="14" variant="Bold" />
            Retry
          </Button>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-surface text-muted-foreground">
            <InfoCircle size="22" variant="Bold" />
          </span>
          <h2 className="text-base font-semibold text-ocean">No agents found</h2>
          <p className="max-w-sm text-xs text-muted-foreground">
            No juror agents match the current search, family filter or active toggle.
          </p>
        </div>
      ) : (
        <Stagger
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
          itemClassName="h-full"
        >
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.agentProfileId} agent={agent} />
          ))}
        </Stagger>
      )}
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
        "flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors",
        active ? "bg-sea/12 text-primary" : "text-muted-foreground hover:bg-surface hover:text-ocean",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[11px] tabular-nums",
          active ? "bg-sea/15 text-primary" : "bg-surface-2 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

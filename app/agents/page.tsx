"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentCard } from "@/components/agents/agent-card";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import {
  Profile2User,
  SearchNormal1,
  Filter,
  Warning2,
  InfoCircle,
  Refresh,
} from "iconsax-react";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

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

  const filteredAgents = agents.filter((agent) => {
    if (filterActiveOnly && !agent.active) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesModel = agent.modelId.toLowerCase().includes(q);
      const matchesRole = agent.role.toLowerCase().includes(q);
      const matchesId = agent.agentProfileId.toLowerCase().includes(q);
      if (!matchesModel && !matchesRole && !matchesId) return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Profile2User size="18" variant="Bold" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Agent Registry &amp; Directory
            </h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Registered AI juror agents, models, human-backing attestations, and multi-dimensional reputation scores on Sui.
          </p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <SearchNormal1
            size="16"
            variant="Bold"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search agents by model, role, or ID..."
            className="pl-10 h-11 text-xs sm:text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterActiveOnly(!filterActiveOnly)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold border transition-colors min-h-[40px] flex items-center gap-1.5 ${
              filterActiveOnly
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Filter size="14" variant="Bold" />
            <span>Active Only</span>
          </button>
        </div>
      </div>

      {/* Agents Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-64 rounded-xl border border-border/60 bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : engineOffline ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-4 bg-muted/20">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 mx-auto">
            <Warning2 size="26" variant="Bold" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-foreground">Engine Offline / Standalone Mode</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              The agent directory cannot be queried while the verification engine is 503 / offline.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAgents()}
            className="min-h-[40px] text-xs font-semibold"
          >
            <Refresh size="14" variant="Bold" className="mr-1.5" />
            Retry
          </Button>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-3 bg-muted/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto">
            <InfoCircle size="20" variant="Bold" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No agents found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            No juror agents match the specified search query or active filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.agentProfileId} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

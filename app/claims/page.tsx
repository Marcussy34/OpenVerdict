"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClaimCard } from "@/components/claim/claim-card";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Stagger } from "@/components/viz/reveal";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  DocumentText,
  SearchNormal1,
  ShieldSearch,
  InfoCircle,
  Warning2,
  Refresh,
} from "@/components/icons";

type FilterTab = "ALL" | "ACTIVE" | "PROPOSED" | "JURY" | "FINALIZED" | "UNRESOLVED";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "ALL", label: "All claims" },
  { key: "ACTIVE", label: "Active" },
  { key: "PROPOSED", label: "Proposed" },
  { key: "JURY", label: "In jury" },
  { key: "FINALIZED", label: "Finalized" },
  { key: "UNRESOLVED", label: "Unresolved" },
];

function matchesTab(state: number, tab: FilterTab): boolean {
  switch (tab) {
    case "ALL":
      return true;
    case "ACTIVE":
      return state < 9;
    case "PROPOSED":
      return state === 1;
    case "JURY":
      return state >= 3 && state <= 8;
    case "FINALIZED":
      return state === 9 || state === 10;
    case "UNRESOLVED":
      return state === 11;
  }
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");

  const loadClaims = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      const res = await fetch("/api/claims");
      if (res.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setClaims(data.claims || []);
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
        const res = await fetch("/api/claims");
        if (ignore) return;
        if (res.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!ignore) setClaims(data.claims || []);
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

  /** Per-tab counts so the filter rail doubles as a directory summary. */
  const counts = useMemo(() => {
    const out = {} as Record<FilterTab, number>;
    for (const tab of TABS) {
      out[tab.key] = claims.filter((c) => matchesTab(c.state, tab.key)).length;
    }
    return out;
  }, [claims]);

  const filteredClaims = useMemo(
    () =>
      claims.filter((claim) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (
            !claim.statement.toLowerCase().includes(q) &&
            !claim.claimId.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return matchesTab(claim.state, activeFilter);
      }),
    [claims, searchQuery, activeFilter],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <PageHeader
        eyebrow="Directory"
        title="Claims directory"
        description="Every on-chain assertion, dispute, live jury deliberation and finalized certificate the engine has indexed."
        icon={DocumentText}
        badges={<ExperimentalTag />}
        actions={
          <Button asChild className="min-h-[42px] px-5 font-semibold shadow-xs">
            <Link href="/fact-check">
              <ShieldSearch size="16" variant="Bold" />
              New fact-check
            </Link>
          </Button>
        }
      />

      {/* Search + state filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <SearchNormal1
            size="16"
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search claims by statement or object id…"
            className="h-11 pl-10 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search claims"
          />
        </div>

        <div
          className="ov-scroll flex items-center gap-1 overflow-x-auto rounded-full border border-border bg-card p-1"
          role="tablist"
          aria-label="Filter claims by lifecycle state"
        >
          {TABS.map((tab) => {
            const active = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFilter(tab.key)}
                className={cn(
                  "flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors",
                  active
                    ? "bg-sea/12 text-primary"
                    : "text-muted-foreground hover:bg-surface hover:text-ocean",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 font-mono text-[10px] tabular-nums",
                    active ? "bg-sea/15 text-primary" : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  {counts[tab.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="ov-edge h-[420px] animate-pulse rounded-2xl border border-border bg-card"
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
            The engine returned a 503 response. The backend engine service or RPC connection is
            currently being wired.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadClaims()}
              className="min-h-[40px] font-semibold"
            >
              <Refresh size="14" variant="Bold" />
              Retry connection
            </Button>
            <Button asChild size="sm" className="min-h-[40px] font-semibold">
              <Link href="/verify">Use offline verifier</Link>
            </Button>
          </div>
        </div>
      ) : filteredClaims.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-surface text-muted-foreground">
            <InfoCircle size="22" variant="Bold" />
          </span>
          <h2 className="text-base font-semibold text-ocean">No matching claims</h2>
          <p className="max-w-sm text-xs text-muted-foreground">
            {searchQuery
              ? `Nothing matched “${searchQuery}”. Try a different statement fragment or object id.`
              : "No claims currently match the selected lifecycle filter."}
          </p>
        </div>
      ) : (
        <Stagger
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
          itemClassName="h-full"
        >
          {filteredClaims.map((claim) => (
            <ClaimCard key={claim.claimId} claim={claim} />
          ))}
        </Stagger>
      )}
    </div>
  );
}

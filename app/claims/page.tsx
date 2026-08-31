"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/claim/state-badge";
import { useNow } from "@/components/use-now";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  SearchNormal1,
  ShieldSearch,
  Warning2,
  Refresh,
  ArrowRight2,
} from "@/components/icons";

type FilterTab = "ALL" | "ACTIVE" | "PROPOSED" | "JURY" | "FINALIZED" | "UNRESOLVED";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "ALL", label: "All" },
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

// Explorer-row helpers, mirrored from the verify page so both lists match.
const OUTCOME_CHIP: Record<string, string> = {
  YES: "bg-yes/10 text-yes",
  NO: "bg-no/10 text-no",
  UNSURE: "bg-unsure/10 text-unsure",
  UNRESOLVED: "bg-muted text-muted-foreground",
};

function shortClaimId(claimId: string): string {
  return claimId.length <= 14
    ? claimId
    : `${claimId.slice(0, 8)}…${claimId.slice(-4)}`;
}

function truthScoreOf(claim: ClaimInspection): string | null {
  const bps = claim.result?.truthScoreBps;
  if (bps === null || bps === undefined) return null;
  const score = bps / 100;
  return Number.isInteger(score) ? score.toFixed(0) : score.toFixed(2);
}

function timeAgo(now: number | null, atMs: number | undefined): string {
  if (now === null || atMs === undefined) return "";
  const delta = Math.max(0, now - atMs);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  const now = useNow();

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
    void init();
    return () => {
      ignore = true;
    };
  }, []);

  /** Per-tab counts so the chip rail doubles as a directory summary. */
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
    <div className="mx-auto max-w-5xl space-y-10 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: one word, explorer style. */}
      <h1 className="ov-display text-center text-4xl text-ocean md:text-5xl">Claims</h1>

      {/* One flat bar: search on the left, the primary action on the right. */}
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="ov-edge flex items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-xs focus-within:ring-2 focus-within:ring-ring">
          <SearchNormal1 size="18" className="shrink-0 text-muted-foreground" />
          <input
            placeholder="Search by statement or object id"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ocean outline-none placeholder:text-muted-foreground/45"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search claims"
          />
          <Button asChild className="min-h-11 shrink-0 px-5 font-semibold shadow-xs">
            <Link href="/fact-check">
              <ShieldSearch size="15" variant="Bold" />
              Verify a claim
            </Link>
          </Button>
        </div>

        {/* State chips: light, centered, counted. */}
        <div
          className="flex flex-wrap justify-center gap-1.5"
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
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-sea/40 bg-sea/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-sea/30 hover:text-ocean",
                )}
              >
                {tab.label}
                <span className="text-[11px] tabular-nums opacity-70">{counts[tab.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The directory itself: one row per claim, details behind the click. */}
      <section className="mx-auto w-full max-w-3xl">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : engineOffline ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-unsure/10 text-unsure">
              <Warning2 size="22" variant="Bold" />
            </span>
            <p className="text-sm font-semibold text-ocean">Engine offline</p>
            <Button variant="outline" size="sm" onClick={() => loadClaims()} className="min-h-[38px] font-semibold">
              <Refresh size="14" variant="Bold" />
              Retry
            </Button>
          </div>
        ) : filteredClaims.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-xs text-muted-foreground">
            {searchQuery ? "Nothing matches that search." : "No claims in this state yet."}
          </p>
        ) : (
          <ul className="ov-edge divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filteredClaims.map((claim) => {
              const score = truthScoreOf(claim);
              const ago = timeAgo(now, claim.deadlines?.evidenceCutoffMs);
              const stranded = now !== null && isStrandedDiscussion(claim, now);
              return (
                <li key={claim.claimId}>
                  <Link
                    href={`/claims/${claim.claimId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ocean">{claim.statement}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {shortClaimId(claim.claimId)}
                        {ago ? ` · ${ago}` : ""}
                      </p>
                    </div>
                    {claim.result && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                          OUTCOME_CHIP[claim.result.result] ?? OUTCOME_CHIP.UNRESOLVED,
                        )}
                      >
                        {claim.result.result}
                        {score ? ` ${score}` : ""}
                      </span>
                    )}
                    <StateBadge state={claim.state} stranded={stranded} size="sm" className="shrink-0" />
                    <ArrowRight2 size="14" className="shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

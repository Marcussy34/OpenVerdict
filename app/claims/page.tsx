"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/claim/state-badge";
import { ClaimCard, ClaimIdChip } from "@/components/claim/claim-card";
import { OUTCOME_CHIP, timeAgo, truthScoreOf } from "@/components/claim/claim-format";
import { useNow } from "@/components/use-now";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  SearchNormal1,
  Warning2,
  Refresh,
  ArrowRight2,
  Element3,
  RowVertical,
} from "@/components/icons";

type FilterTab = "ALL" | "ACTIVE" | "PROPOSED" | "JURY" | "VOIDED" | "FINALIZED" | "UNRESOLVED";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PROPOSED", label: "Proposed" },
  { key: "JURY", label: "In jury" },
  { key: "VOIDED", label: "Voided" },
  { key: "FINALIZED", label: "Finalized" },
  { key: "UNRESOLVED", label: "Unresolved" },
];

/** How the directory draws itself: today's compact rows, or ClaimCard tiles. */
type ViewMode = "inline" | "grid";

const VIEWS: { key: ViewMode; label: string; Icon: typeof Element3 }[] = [
  { key: "inline", label: "Inline", Icon: RowVertical },
  { key: "grid", label: "Grid", Icon: Element3 },
];

/** Where the chosen view is remembered between visits. */
const VIEW_STORAGE_KEY = "ov:claims-view";

// The preference lives in localStorage, which render is not allowed to touch:
// a value read on the client would not match the server's first pass. So it
// goes through a tiny external store, the same shape components/use-now.ts
// uses — server snapshot is the default (SSR and hydration agree), client
// snapshot is whatever storage holds.
const viewListeners = new Set<() => void>();

function subscribeToView(listener: () => void): () => void {
  viewListeners.add(listener);
  // Another tab switching view keeps this one in step.
  window.addEventListener("storage", listener);
  return () => {
    viewListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Returns a primitive, so repeated reads compare equal and never loop. */
function readView(): ViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "grid" || stored === "inline" ? stored : "inline";
  } catch {
    // Blocked or unavailable storage (private windows): the default is fine.
    return "inline";
  }
}

function writeView(next: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  } catch {
    // Persistence is a convenience; the view still switches without it.
  }
  viewListeners.forEach((notify) => notify());
}

function matchesTab(claim: ClaimInspection, tab: FilterTab): boolean {
  const voided = claim.attemptChain?.status === "VOIDED"
    || claim.attemptChain?.status === "GAVE_UP";
  switch (tab) {
    case "ALL":
      return true;
    case "ACTIVE":
      return !voided && claim.state < 9;
    case "PROPOSED":
      return claim.state === 1;
    case "JURY":
      return !voided && claim.state >= 3 && claim.state <= 8;
    case "VOIDED":
      return voided;
    case "FINALIZED":
      return claim.state === 9 || claim.state === 10;
    case "UNRESOLVED":
      return claim.state === 11;
  }
}

/** Four across at the widest, stepping down with the viewport. */
const GRID_CLASSES = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  // "inline" through SSR and hydration, then whatever the visitor last chose.
  const view = useSyncExternalStore(subscribeToView, readView, () => "inline");
  const now = useNow();
  // Tiles need the full page; the row list keeps its reading measure.
  const widthClass = view === "grid" ? "max-w-7xl" : "max-w-3xl";

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
      out[tab.key] = claims.filter((claim) => matchesTab(claim, tab.key)).length;
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
        return matchesTab(claim, activeFilter);
      }),
    [claims, searchQuery, activeFilter],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: the verify page's wave, in the one accent blue, so the two entry
          points read as siblings. aria-label carries the word; the per-letter
          spans are hidden from assistive tech so it is not spelled out one
          character at a time. */}
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <h1 className="ov-display text-5xl text-ocean md:text-6xl">
          Find any{" "}
          <span aria-label="claims" className="ov-wave-word">
            {"claims".split("").map((letter, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="ov-wave-letter"
                style={{ "--i": index } as CSSProperties}
              >
                {letter}
              </span>
            ))}
          </span>
        </h1>
      </div>

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
                  // Sharp chip, one hairline weight, accent only when active:
                  // the same recipe the agents filter and the seat picker use.
                  "flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-sea/40 bg-sea/12 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-sea/40 hover:text-ocean",
                )}
              >
                {tab.label}
                <span className="text-[11px] tabular-nums opacity-70">{counts[tab.key] ?? 0}</span>
              </button>
            );
          })}
        </div>

      </div>

      {/* The directory itself: rows or tiles, details behind the click. The
          switch rides the results' own width so their right edges line up. */}
      <section className={cn("mx-auto w-full space-y-4", widthClass)}>
        {/* View switch: changes the directory's shape, never its contents. */}
        <div className="flex justify-end">
          <div
            className="ov-edge inline-flex items-center gap-0.5 border border-border bg-card p-0.5"
            role="tablist"
            aria-label="Claims view"
          >
            {VIEWS.map(({ key, label, Icon }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => writeView(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-sea/12 text-primary"
                      : "text-muted-foreground hover:text-ocean",
                  )}
                >
                  <Icon size="14" variant={active ? "Bold" : "Linear"} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          view === "grid" ? (
            <div className={GRID_CLASSES}>
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-2xl bg-surface-2"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-14 animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          )
        ) : engineOffline ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
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
        ) : view === "grid" ? (
          <div className={GRID_CLASSES}>
            {filteredClaims.map((claim) => (
              <ClaimCard key={claim.claimId} claim={claim} />
            ))}
          </div>
        ) : (
          <ul className="ov-edge divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filteredClaims.map((claim) => {
              const score = truthScoreOf(claim);
              const ago = timeAgo(now, claim.deadlines?.evidenceCutoffMs);
              const stranded = now !== null && isStrandedDiscussion(claim, now);
              return (
                <li key={claim.claimId}>
                  <Link
                    href={`/claims/${claim.attemptChain?.relaunchedAs ?? claim.claimId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ocean">{claim.statement}</p>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <ClaimIdChip claimId={claim.claimId} />
                        {ago ? <span className="shrink-0">· {ago}</span> : null}
                      </div>
                    </div>
                    {claim.result && (
                      <span
                        className={cn(
                          "shrink-0 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                          OUTCOME_CHIP[claim.result.result] ?? OUTCOME_CHIP.UNRESOLVED,
                        )}
                      >
                        {claim.result.result}
                        {score ? ` ${score}` : ""}
                      </span>
                    )}
                    <StateBadge
                      state={claim.state}
                      stranded={stranded}
                      attemptStatus={claim.attemptChain?.status}
                      size="sm"
                      className="shrink-0"
                    />
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

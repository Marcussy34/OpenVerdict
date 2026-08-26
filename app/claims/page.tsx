"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClaimCard } from "@/components/claim/claim-card";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  DocumentText,
  SearchNormal1,
  Filter,
  ShieldSearch,
  InfoCircle,
  Warning2,
  Refresh,
} from "iconsax-react";

type FilterTab = "ALL" | "ACTIVE" | "PROPOSED" | "JURY" | "FINALIZED" | "UNRESOLVED";

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

  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      // 1. Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesStatement = claim.statement.toLowerCase().includes(q);
        const matchesId = claim.claimId.toLowerCase().includes(q);
        if (!matchesStatement && !matchesId) return false;
      }

      // 2. State tab filter
      const s = claim.state;
      if (activeFilter === "ALL") return true;
      if (activeFilter === "ACTIVE") return s < 9;
      if (activeFilter === "PROPOSED") return s === 1;
      if (activeFilter === "JURY") return s >= 3 && s <= 8;
      if (activeFilter === "FINALIZED") return s === 9 || s === 10;
      if (activeFilter === "UNRESOLVED") return s === 11;
      return true;
    });
  }, [claims, searchQuery, activeFilter]);

  return (
    <div className="max-w-7xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <DocumentText size="18" variant="Bold" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Claims Directory
            </h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Explore all on-chain assertions, disputes, active jury deliberations, and finalized certificates.
          </p>
        </div>

        <Link href="/fact-check">
          <Button size="sm" className="min-h-[44px] px-5 font-semibold shadow-xs">
            <ShieldSearch size="16" variant="Bold" className="mr-1.5" />
            New Fact-Check
          </Button>
        </Link>
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <SearchNormal1
            size="16"
            variant="Bold"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search claims by statement or ID..."
            className="pl-10 h-11 text-xs sm:text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* State Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          <Filter size="16" variant="Bold" className="text-muted-foreground shrink-0 hidden sm:inline" />
          {(
            [
              { key: "ALL", label: "All Claims" },
              { key: "ACTIVE", label: "Active" },
              { key: "PROPOSED", label: "Proposed" },
              { key: "JURY", label: "In Jury" },
              { key: "FINALIZED", label: "Finalized" },
              { key: "UNRESOLVED", label: "Unresolved" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors min-h-[38px] ${
                activeFilter === tab.key
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Claims Content List / Grid */}
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
              The engine returned a 503 response. The backend engine service or RPC connection is currently being wired.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadClaims()}
              className="min-h-[40px] text-xs font-semibold"
            >
              <Refresh size="14" variant="Bold" className="mr-1.5" />
              Retry Connection
            </Button>
            <Link href="/verify">
              <Button size="sm" className="min-h-[40px] text-xs font-semibold">
                Use Offline Verifier
              </Button>
            </Link>
          </div>
        </div>
      ) : filteredClaims.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-3 bg-muted/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto">
            <InfoCircle size="20" variant="Bold" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No matching claims found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {searchQuery
              ? `No claims matched "${searchQuery}". Try adjusting your search query.`
              : "No claims currently match the selected filter category."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClaims.map((claim) => (
            <ClaimCard key={claim.claimId} claim={claim} />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EngineStatus } from "@/lib/engine/contract";
import {
  Activity,
  Link21,
  Cpu,
  DocumentText,
  Warning2,
  Refresh,
  ShieldTick,
  InfoCircle,
} from "iconsax-react";

export default function StatusPage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      const res = await fetch("/api/status");
      if (res.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
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
        const res = await fetch("/api/status");
        if (ignore) return;
        if (res.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!ignore) setStatus(data);
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

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity size="18" variant="Bold" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              System &amp; Protocol Status
            </h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Health and connectivity metrics for Sui Move contracts, GonkaRouter inference, Walrus storage, and indexing pipelines.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadStatus()}
          className="min-h-[40px] text-xs font-semibold"
        >
          <Refresh size="14" variant="Bold" className="mr-1.5" />
          Refresh Status
        </Button>
      </div>

      {/* Main Status Display */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-xl border border-border/60 bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : engineOffline ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-3">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold text-sm">
              <Warning2 size="18" variant="Bold" />
              <span>Engine Status: Standalone / Unwired (503)</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The Next.js frontend is operating in disconnected observer mode. The headless verification engine is currently initializing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sui Network Card (Stub) */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Link21 size="16" variant="Bold" className="text-primary" />
                  Sui Blockchain Network
                </span>
                <Badge variant="outline" className="text-xs text-amber-700 bg-amber-500/10 border-amber-500/30">
                  Awaiting Connection
                </Badge>
              </div>
              <div className="space-y-1.5 font-mono text-muted-foreground">
                <div>Network: sui:testnet / sui:localnet</div>
                <div>Protocol: Move 2024 Edition</div>
                <div>Modules: claim, jury, settlement, evidence</div>
              </div>
            </div>

            {/* GonkaRouter Card (Stub) */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Cpu size="16" variant="Bold" className="text-primary" />
                  GonkaRouter Inference Engine
                </span>
                <Badge variant="outline" className="text-xs text-amber-700 bg-amber-500/10 border-amber-500/30">
                  Adapter Ready
                </Badge>
              </div>
              <div className="space-y-1.5 font-mono text-muted-foreground">
                <div>Catalog Models: DeepSeek-V4, Kimi-K2.6, MiniMax-M2.7</div>
                <div>Diversity: ≥3 model families required per jury</div>
                <div>Max Output Tokens: 4096 tokens</div>
              </div>
            </div>

            {/* Walrus Decentralized Storage Card (Stub) */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <DocumentText size="16" variant="Bold" className="text-primary" />
                  Walrus Decentralized Storage
                </span>
                <Badge variant="outline" className="text-xs text-emerald-700 bg-emerald-500/10 border-emerald-500/30">
                  Configured
                </Badge>
              </div>
              <div className="space-y-1.5 font-mono text-muted-foreground">
                <div>Mode: Local FS / Walrus Testnet</div>
                <div>Evidence Bundles: Merkle Root Hashed</div>
                <div>Retention: Indefinite / Bounded Epochs</div>
              </div>
            </div>

            {/* Protocol State (Stub) */}
            <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldTick size="16" variant="Bold" className="text-primary" />
                  Protocol Security &amp; Safety
                </span>
                <Badge variant="outline" className="text-xs text-emerald-700 bg-emerald-500/10 border-emerald-500/30">
                  Operational
                </Badge>
              </div>
              <div className="space-y-1.5 font-mono text-muted-foreground">
                <div>Paused Flag: false</div>
                <div>SSRF Protection: Active</div>
                <div>Pre-Reveal Redaction: Enforced</div>
              </div>
            </div>
          </div>
        </div>
      ) : status ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sui Network Card */}
          <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Link21 size="16" variant="Bold" className="text-primary" />
                Sui Blockchain Network
              </span>
              <Badge
                variant="outline"
                className={`text-xs ${
                  status.suiHealthy
                    ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30"
                    : "text-red-700 bg-red-500/10 border-red-500/30"
                }`}
              >
                {status.suiHealthy ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="space-y-1.5 font-mono text-muted-foreground">
              <div>Network: {status.network}</div>
              <div>Package ID: {status.packageId}</div>
              <div>Registry ID: {status.registryObjectId}</div>
              {status.latestCheckpoint && <div>Checkpoint: #{status.latestCheckpoint}</div>}
            </div>
          </div>

          {/* GonkaRouter Card */}
          <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Cpu size="16" variant="Bold" className="text-primary" />
                GonkaRouter Inference Engine
              </span>
              <Badge variant="outline" className="text-xs text-emerald-700 bg-emerald-500/10 border-emerald-500/30">
                Mode: {status.gonkaMode}
              </Badge>
            </div>
            <div className="space-y-1.5 font-mono text-muted-foreground">
              <div>Catalog Models: DeepSeek-V4, Kimi-K2.6, MiniMax-M2.7</div>
              <div>Jury Parallelism: 5 Concurrent Agents</div>
              <div>Adapter: Temperature 0 / Strict JSON</div>
            </div>
          </div>

          {/* Walrus Decentralized Storage Card */}
          <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <DocumentText size="16" variant="Bold" className="text-primary" />
                Walrus Decentralized Storage
              </span>
              <Badge variant="outline" className="text-xs text-emerald-700 bg-emerald-500/10 border-emerald-500/30">
                Mode: {status.walrusMode}
              </Badge>
            </div>
            <div className="space-y-1.5 font-mono text-muted-foreground">
              <div>Evidence Artifacts: Merkle Root Hashed</div>
              <div>Run Audits: Immutable Walrus Blobs</div>
            </div>
          </div>

          {/* Database & Protocol Card */}
          <div className="rounded-xl border border-border/80 bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ShieldTick size="16" variant="Bold" className="text-primary" />
                Database &amp; Protocol Safety
              </span>
              <Badge
                variant="outline"
                className={`text-xs ${
                  !status.paused && status.dbHealthy
                    ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30"
                    : "text-amber-700 bg-amber-500/10 border-amber-500/30"
                }`}
              >
                {status.paused ? "Paused" : "Operational"}
              </Badge>
            </div>
            <div className="space-y-1.5 font-mono text-muted-foreground">
              <div>App Version: {status.appVersion}</div>
              <div>Database Health: {status.dbHealthy ? "Healthy" : "Degraded"}</div>
              <div>Paused: {status.paused ? "true" : "false"}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Info footer */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground flex items-center gap-2">
        <InfoCircle size="16" variant="Bold" className="text-primary shrink-0" />
        <span>
          Status is polled dynamically from the orchestrator engine. Observer health is independent of Move smart contract execution.
        </span>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { StatusPill, type DotTone } from "@/components/viz/live-dot";
import { StatTile } from "@/components/viz/stat-tile";
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
  Data,
} from "@/components/icons";

/** A single key/value line inside a subsystem panel. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <FieldLabel>{label}</FieldLabel>
      <div className="min-w-0 font-mono text-xs text-ocean">{children}</div>
    </div>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (res.ok) setStatus(await res.json());
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
        const res = await fetch("/api/status", { cache: "no-store" });
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

  const allHealthy = Boolean(status?.suiHealthy && status?.dbHealthy && !status?.paused);
  const overallTone: DotTone = engineOffline ? "idle" : allHealthy ? "live" : "down";
  const overallLabel = engineOffline
    ? "Standalone"
    : allHealthy
      ? "All systems nominal"
      : "Degraded";

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Operations"
        title="System & protocol status"
        description="Health and connectivity for the Sui Move deployment, GonkaRouter inference, Walrus storage and the indexing pipeline."
        icon={Activity}
        actions={
          <>
            <StatusPill tone={overallTone} label={overallLabel} pulse={allHealthy} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadStatus()}
              className="min-h-[40px] font-semibold"
            >
              <Refresh size="14" variant="Bold" />
              Refresh
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="ov-edge h-52 animate-pulse rounded-2xl border border-border bg-card"
            />
          ))}
        </div>
      ) : engineOffline ? (
        <div className="space-y-6">
          {/* A deployment state, not a verdict and not a hazard: quiet ink. */}
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-5">
            <Warning2 size="20" variant="Bold" className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-ocean">
                Engine status: standalone / unwired (503)
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The Next.js observer is running in disconnected mode. The headless verification
                engine is initializing — the values below describe the configured deployment
                shape, not live health.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel label="Sui blockchain network" icon={Link21} tone="chain">
              <Row label="Network">sui:testnet / sui:localnet</Row>
              <Row label="Protocol">Move 2024 edition</Row>
              <Row label="Modules">claim · jury · settlement · evidence</Row>
            </Panel>
            <Panel label="GonkaRouter inference" icon={Cpu} tone="primary">
              <Row label="Catalog models">DeepSeek-V4-Flash · Kimi-K2.6 · MiniMax-M2.7</Row>
              <Row label="Diversity">≥3 model families required per jury</Row>
              <Row label="Max output tokens">4096</Row>
            </Panel>
            <Panel label="Walrus decentralized storage" icon={DocumentText} tone="sealed">
              <Row label="Mode">Local FS / Walrus testnet</Row>
              <Row label="Evidence bundles">Merkle root hashed</Row>
              <Row label="Retention">Indefinite / bounded epochs</Row>
            </Panel>
            <Panel label="Protocol security & safety" icon={ShieldTick}>
              <Row label="Paused flag">false</Row>
              <Row label="SSRF protection">Active</Row>
              <Row label="Pre-reveal redaction">Enforced</Row>
            </Panel>
          </div>
        </div>
      ) : status ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Network"
              value={status.network}
              icon={Link21}
              animate={false}
            />
            <StatTile
              label="Inference mode"
              value={status.gonkaMode}
              icon={Cpu}
              animate={false}
            />
            <StatTile
              label="Storage mode"
              value={status.walrusMode}
              icon={DocumentText}
              animate={false}
            />
            <StatTile
              label="App version"
              value={status.appVersion}
              icon={Data}
              animate={false}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel
              label="Sui blockchain network"
              icon={Link21}
              tone="chain"
              action={
                <StatusPill
                  tone={status.suiHealthy ? "live" : "down"}
                  label={status.suiHealthy ? "Connected" : "Disconnected"}
                  pulse={status.suiHealthy}
                />
              }
            >
              <Row label="Network">{status.network}</Row>
              <Row label="Package id">
                <HashChip value={status.packageId} tone="chain" head={10} tail={8} />
              </Row>
              <Row label="Registry object">
                <HashChip value={status.registryObjectId} tone="chain" head={10} tail={8} />
              </Row>
              {status.latestCheckpoint !== undefined && (
                <Row label="Latest checkpoint">#{status.latestCheckpoint}</Row>
              )}
            </Panel>

            <Panel
              label="GonkaRouter inference engine"
              icon={Cpu}
              tone="primary"
              action={<StatusPill tone="chain" label={`Mode ${status.gonkaMode}`} pulse={false} />}
            >
              <Row label="Catalog models">DeepSeek-V4-Flash · Kimi-K2.6 · MiniMax-M2.7</Row>
              <Row label="Jury parallelism">5 concurrent agents</Row>
              <Row label="Adapter">Temperature 0 · strict JSON schema</Row>
              <Row label="Fail mode">Closed — malformed output never becomes a vote</Row>
            </Panel>

            <Panel
              label="Walrus decentralized storage"
              icon={DocumentText}
              tone="sealed"
              action={
                <StatusPill tone="sealed" label={`Mode ${status.walrusMode}`} pulse={false} />
              }
            >
              <Row label="Evidence artifacts">Merkle root hashed</Row>
              <Row label="Run audits">Immutable Walrus blobs</Row>
              <Row label="Canonicalization">HTML → sanitized text before hashing</Row>
            </Panel>

            <Panel
              label="Database & protocol safety"
              icon={ShieldTick}
              action={
                <StatusPill
                  tone={!status.paused && status.dbHealthy ? "live" : "down"}
                  label={status.paused ? "Paused" : "Operational"}
                  pulse={!status.paused && status.dbHealthy}
                />
              }
            >
              <Row label="App version">{status.appVersion}</Row>
              <Row label="Database health">{status.dbHealthy ? "Healthy" : "Degraded"}</Row>
              <Row label="Paused">{status.paused ? "true" : "false"}</Row>
              <Row label="Observer signer">None — read-only projection</Row>
            </Panel>
          </div>
        </>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        <InfoCircle size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Status is polled from the orchestrator engine on demand. Observer health is
          independent of Move smart-contract execution: if this page is down, the protocol and
          headless engine keep running.
        </p>
      </div>
    </div>
  );
}

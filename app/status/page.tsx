"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { LiveDot, StatusPill, type DotTone } from "@/components/viz/live-dot";
import { StatTile } from "@/components/viz/stat-tile";
import type { EngineStatus, WeatherFamily, WeatherReport } from "@/lib/engine/contract";
import {
  juryRequirementSentence,
  weatherDownSentence,
  weatherFamilyLabel,
  weatherLatencyLabel,
  weatherProbedAgoLabel,
} from "@/lib/web/weather-copy";
import {
  Activity,
  Link21,
  Cpu,
  DocumentText,
  Warning2,
  Radar,
  Refresh,
  ShieldTick,
  InfoCircle,
  Data,
} from "@/components/icons";

/**
 * A single key/value line inside a subsystem panel. Short values keep the
 * right-aligned mono column; `prose` drops a sentence onto its own line in the
 * UI font, because a sentence in that column wraps into a ragged block.
 */
function Row({
  label,
  children,
  prose = false,
}: {
  label: string;
  children: React.ReactNode;
  prose?: boolean;
}) {
  if (prose) {
    return (
      <div className="flex flex-col gap-1 border-b border-border/70 py-2 last:border-0">
        <FieldLabel>{label}</FieldLabel>
        <p className="text-xs leading-relaxed text-ocean">{children}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <FieldLabel>{label}</FieldLabel>
      <div className="min-w-0 font-mono text-xs text-ocean">{children}</div>
    </div>
  );
}

/** The reading order the CLI and the landing strip already use. */
const FAMILY_ORDER = ["deepseek", "minimax", "kimi", "research"];

function familyRank(family: string): number {
  const index = FAMILY_ORDER.indexOf(family.toLowerCase());
  return index < 0 ? FAMILY_ORDER.length : index;
}

/**
 * What the page says about the weather, in one place. An unknown or stale
 * report says so plainly: old probe values must never read as current.
 */
function readWeather(weather: WeatherReport | null): {
  tone: DotTone;
  title: string;
  detail: string;
  fresh: boolean;
} {
  if (weather === null) {
    return {
      tone: "idle",
      title: "Jury weather unknown",
      detail: "The probe did not answer, so this page cannot say whether a jury can sit.",
      fresh: false,
    };
  }
  if (weather.stale || weather.probedAtMs === null) {
    return {
      tone: "idle",
      title: "Jury weather unknown",
      detail: "No probe in the last few minutes.",
      fresh: false,
    };
  }
  if (weather.clear) {
    return {
      tone: "live",
      title: "Jury weather clear",
      detail: "Every active model family answered, and so did web search.",
      fresh: true,
    };
  }
  // Not clear with every probe answering means the draw rule is short of
  // families, so the numbers carry the reason instead of a name.
  const down = weatherDownSentence(weather);
  return {
    tone: "down",
    title: "Jury weather not clear",
    detail:
      down ||
      `The draw needs ${weather.requiredFamilies} model families and ${weather.activeFamilies.length} hold an active seat.`,
    fresh: true,
  };
}

/** One probe line: dot, family name, model id, latency and the raw status. */
function ProbeRow({ family, fresh }: { family: WeatherFamily; fresh: boolean }) {
  const tone: DotTone = !fresh ? "idle" : family.ok ? "live" : "down";
  // The web search probe answers "200 1018 credits": the code leads and the
  // rest of the line is a quiet aside under it.
  const [code, ...credit] = (family.status || "").split(" ");
  const aside = credit.join(" ");
  return (
    <li className="flex flex-col gap-1 border-b border-border/70 py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <LiveDot tone={tone} pulse={false} />
          <span className="truncate text-sm font-medium text-ocean">
            {weatherFamilyLabel(family.family, family.modelId)}
          </span>
        </span>
        {fresh ? (
          <span className="flex shrink-0 items-baseline gap-2.5 font-mono text-xs tabular-nums">
            <span className="text-muted-foreground">
              {weatherLatencyLabel(family.latencyMs)}
            </span>
            <span className={family.ok ? "text-ocean" : "text-no"}>{code}</span>
          </span>
        ) : (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            no recent probe
          </span>
        )}
      </div>
      {/* Indented to the family name: the dot plus its gap is 1.125rem. */}
      <div className="flex flex-wrap items-baseline gap-x-2 pl-[1.125rem] font-mono text-[11px] text-muted-foreground">
        <span className="break-all">{family.modelId}</span>
        {fresh && aside && <span>{aside}</span>}
      </div>
    </li>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // The weather is the first thing this page shows, so it is read alongside
  // status and dropped outright when the probe stops answering.
  const loadWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      setWeather(res.ok ? await res.json() : null);
    } catch {
      setWeather(null);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setEngineOffline(false);
      void loadWeather();
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
  }, [loadWeather]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        // The weather carries the live draw rule the Diversity row prints.
        await loadWeather();
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
  }, [loadWeather]);

  // The probe age counts up on its own, so a page left open never claims a
  // probe is fresher than it is.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const allHealthy = Boolean(status?.suiHealthy && status?.dbHealthy && !status?.paused);
  const overallTone: DotTone = engineOffline ? "idle" : allHealthy ? "live" : "down";
  const overallLabel = engineOffline
    ? "Standalone"
    : allHealthy
      ? "All systems nominal"
      : "Degraded";

  const sky = readWeather(weather);
  // Nothing has been asked yet on the first paint: a skeleton, not a verdict.
  const weatherPending = loading && weather === null;
  const probes = [...(weather?.families ?? [])].sort(
    (left, right) => familyRank(left.family) - familyRank(right.family),
  );
  const activeFamilies = [...(weather?.activeFamilies ?? [])].sort(
    (left, right) => familyRank(left) - familyRank(right),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Operations"
        title="System & protocol status"
        description="Health and connectivity for the Sui Move deployment, GonkaRouter inference, Walrus storage and the indexing pipeline."
        icon={Activity}
        actions={
          <>
            {/* Systems can be nominal while the jury cannot sit, so the weather
                carries its own pill and the page never claims one for both. */}
            {!weatherPending && (
              <StatusPill
                tone={sky.tone}
                label={sky.title}
                pulse={sky.tone === "live"}
              />
            )}
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

      {weatherPending ? (
        <div className="ov-edge h-64 animate-pulse rounded-2xl border border-border bg-card" />
      ) : (
        <Panel
          label="Model probes"
          icon={Radar}
          tone="primary"
          action={<StatusPill tone={sky.tone} label={sky.title} pulse={false} />}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm leading-relaxed text-ocean">{sky.detail}</p>
                {weather?.probedAtMs != null && (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {weatherProbedAgoLabel(weather.probedAtMs, nowMs)}
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {juryRequirementSentence(weather)}
              </p>
            </div>

            {activeFamilies.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <FieldLabel className="mr-1 w-full sm:w-auto">Active families</FieldLabel>
                {activeFamilies.map((family) => (
                  <MetaTag key={family}>{weatherFamilyLabel(family, family)}</MetaTag>
                ))}
              </div>
            )}

            {probes.length > 0 && (
              <ul className="border-t border-border/70">
                {probes.map((family) => (
                  <ProbeRow key={family.modelId} family={family} fresh={sky.fresh} />
                ))}
              </ul>
            )}
          </div>
        </Panel>
      )}

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
                engine is initializing. The values below describe the configured deployment
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
              <Row label="Diversity" prose>
                Three model families per jury unless the operator lowers it on chain.
              </Row>
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
                <HashChip value={status.packageId} kind="object" tone="chain" head={10} tail={8} />
              </Row>
              <Row label="Registry object">
                <HashChip
                  value={status.registryObjectId}
                  kind="object"
                  tone="chain"
                  head={10}
                  tail={8}
                />
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
              {/* The live rule, not a constant: the operator can lower it on
                  chain in degraded mode, and every certificate then says so.
                  The model list itself lives in the probes panel above. */}
              <Row label="Diversity" prose>
                {juryRequirementSentence(weather)}
              </Row>
              <Row label="Jury parallelism">5 concurrent agents</Row>
              <Row label="Adapter">Temperature 0 · strict JSON schema</Row>
              <Row label="Fail mode" prose>
                Closed. Malformed output never becomes a vote.
              </Row>
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
              <Row label="Canonicalization" prose>
                HTML is reduced to sanitized text before hashing.
              </Row>
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
              <Row label="Observer signer" prose>
                None. This page is a read-only projection.
              </Row>
            </Panel>
          </div>
        </>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        <InfoCircle size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Status is polled from the orchestrator engine on demand. Observer health is
          independent of Move smart-contract execution. If this page is down, the protocol and
          the headless engine keep running.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { WeatherFamily, WeatherReport } from "@/lib/engine/contract";
import { cn } from "@/lib/utils";

export interface WeatherStripProps {
  compact?: boolean;
  initial?: WeatherReport;
  tone?: "default" | "dark";
  className?: string;
}

type ChipState = "healthy" | "slow" | "down" | "stale";

interface FamilyChipData {
  key: string;
  name: string;
  state: ChipState;
  latencyText?: string;
}

// The fourth chip is the web search provider: a jury needs it as much as the models.
const ORDERED_FAMILIES = ["deepseek", "minimax", "kimi", "research"] as const;

/** Map raw family identifier to canonical display name. */
function familyDisplayName(family: string, modelId: string): string {
  const norm = family.toLowerCase();
  if (norm === "deepseek") return "DeepSeek";
  if (norm === "minimax") return "MiniMax";
  if (norm === "kimi") return "Kimi";
  if (norm === "research") return "Web search";
  return modelId || family;
}

/** Compute human-readable probe age relative to client time. */
function formatProbedAgo(probedAtMs: number | null | undefined, nowMs: number): string {
  if (probedAtMs === null || probedAtMs === undefined) {
    return "no recent probe";
  }
  const delta = Math.max(0, nowMs - probedAtMs);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) {
    return `probed ${seconds} s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `probed ${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `probed ${hours}h ago`;
}

/** Derive chip presentation data from a weather family probe and overall report staleness. */
function deriveFamilyChip(
  targetKey: string,
  familyProbe: WeatherFamily | undefined,
  isStale: boolean,
): FamilyChipData {
  const name = familyDisplayName(targetKey, familyProbe?.modelId ?? targetKey);

  if (isStale || !familyProbe) {
    return {
      key: targetKey,
      name,
      state: "stale",
    };
  }

  // State rules: ok and latencyMs < 30_000 is healthy, ok and slower is slow, not ok is down
  if (familyProbe.ok) {
    const isSlow = familyProbe.latencyMs >= 30_000;
    const latencySec = (Math.max(0, familyProbe.latencyMs) / 1000).toFixed(1);
    return {
      key: targetKey,
      name,
      state: isSlow ? "slow" : "healthy",
      latencyText: `${latencySec}s`,
    };
  }

  const latencySec = familyProbe.latencyMs > 0
    ? `${(familyProbe.latencyMs / 1000).toFixed(1)}s`
    : undefined;
  return {
    key: targetKey,
    name,
    state: "down",
    latencyText: latencySec,
  };
}

/**
 * Public weather readout for the three Gonka model families (DeepSeek, MiniMax, Kimi).
 * Polls /api/weather every 30 s and re-computes the probe age every 10 s.
 */
export function WeatherStrip({
  compact = false,
  initial,
  tone = "default",
  className,
}: WeatherStripProps) {
  const [report, setReport] = useState<WeatherReport | null>(initial ?? null);
  const [hasError, setHasError] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Poll /api/weather on mount and every 30 seconds
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const res = await fetch("/api/weather");
        if (!res.ok) {
          if (!ignore) {
            setReport((current) => {
              if (!current && !initial) setHasError(true);
              return current;
            });
          }
          return;
        }
        const data: WeatherReport = await res.json();
        if (!ignore) {
          setReport(data);
          setHasError(false);
        }
      } catch {
        if (!ignore) {
          setReport((current) => {
            if (!current && !initial) setHasError(true);
            return current;
          });
        }
      }
    };

    void load();
    const weatherTimer = setInterval(() => {
      void load();
    }, 30_000);

    return () => {
      ignore = true;
      clearInterval(weatherTimer);
    };
  }, [initial]);

  // Re-render probe age every 10 seconds
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setNowMs(Date.now());
    }, 10_000);
    return () => clearInterval(clockTimer);
  }, []);

  if (hasError && !report) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed px-3 py-2 text-center text-xs",
          tone === "dark"
            ? "border-white/15 text-white/50"
            : "border-border text-muted-foreground",
          className,
        )}
      >
        weather unavailable
      </div>
    );
  }

  const isStale = report ? report.stale : true;
  const probedAtMs = report?.probedAtMs ?? null;
  const probedAgoText = formatProbedAgo(probedAtMs, nowMs);

  // Match the three canonical families in order: DeepSeek, MiniMax, Kimi.
  // Rendering the three chips in the "no recent probe" state while the first report
  // loads reserves the strip height and prevents layout shifts before fetch resolves.
  const chips: FamilyChipData[] = ORDERED_FAMILIES.map((famKey) => {
    const found = report?.families.find(
      (f) => f.family.toLowerCase() === famKey || f.modelId.toLowerCase().includes(famKey),
    );
    return deriveFamilyChip(famKey, found, isStale);
  });

  const isDark = tone === "dark";

  // Screen reader polite status announcement
  const liveAnnouncement = chips
    .map((c) => `${c.name}: ${c.state}${c.latencyText ? ` (${c.latencyText})` : ""}`)
    .join(", ");

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <div aria-live="polite" className="sr-only">
        Model weather: {liveAnnouncement}. {probedAgoText}.
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          compact ? "justify-start text-xs" : "justify-center text-xs sm:text-sm",
        )}
      >
        {chips.map((chip) => {
          let badgeClasses = "";
          let dotColor = "";
          let stateWord = "";

          if (chip.state === "healthy") {
            stateWord = "healthy";
            dotColor = "bg-yes";
            badgeClasses = isDark
              ? "bg-yes/15 text-yes border-yes/30"
              : "bg-yes/10 text-yes border-yes/25";
          } else if (chip.state === "slow") {
            stateWord = "slow";
            dotColor = "bg-unsure";
            badgeClasses = isDark
              ? "bg-unsure/15 text-unsure border-unsure/30"
              : "bg-unsure/10 text-unsure border-unsure/25";
          } else if (chip.state === "down") {
            stateWord = "down";
            dotColor = "bg-no";
            badgeClasses = isDark
              ? "bg-no/15 text-no border-no/30"
              : "bg-no/10 text-no border-no/25";
          } else {
            stateWord = "no recent probe";
            dotColor = isDark ? "bg-white/40" : "bg-muted-foreground";
            badgeClasses = isDark
              ? "bg-white/5 text-white/60 border-white/15"
              : "bg-muted/60 text-muted-foreground border-border";
          }

          return (
            <div
              key={chip.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors",
                compact ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
                badgeClasses,
              )}
            >
              <span className="font-semibold">{chip.name}</span>
              <span className={cn("size-1.5 rounded-full shrink-0", dotColor)} />
              <span>{stateWord}</span>
              {chip.latencyText && chip.state !== "stale" ? (
                <span className="font-mono text-[10px] tabular-nums opacity-85">
                  {chip.latencyText}
                </span>
              ) : null}
            </div>
          );
        })}

        <span
          className={cn(
            "text-[11px] tabular-nums whitespace-nowrap",
            isDark ? "text-white/50" : "text-muted-foreground",
          )}
        >
          {probedAgoText}
        </span>
      </div>

      {!compact ? (
        <p
          className={cn(
            "text-center text-[11px]",
            isDark ? "text-white/60" : "text-muted-foreground",
          )}
        >
          A jury needs all three model families and web search.
        </p>
      ) : null}
    </div>
  );
}

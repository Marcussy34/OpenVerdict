"use client";

import { useSyncExternalStore } from "react";

interface TimeDisplayProps {
  timestampMs?: number | string;
  isoString?: string;
  className?: string;
  showLocal?: boolean;
}

export function formatUtcTime(ms: number | string | Date): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "Unknown date";
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return "Invalid date";
  }
}

export function formatLocalTime(ms: number | string | Date): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "Invalid date";
  }
}

const emptySubscribe = () => () => {};

/**
 * Accessible time component displaying both UTC and Local times per PRD §26.7.
 * Uses useSyncExternalStore for hydration-safe client-side local time rendering.
 */
export function TimeDisplay({
  timestampMs,
  isoString,
  className = "",
  showLocal = true,
}: TimeDisplayProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const rawValue = timestampMs ?? isoString;
  if (!rawValue) {
    return <span className={`text-muted-foreground text-xs ${className}`}>—</span>;
  }

  const utcText = formatUtcTime(rawValue);
  const localText = isClient ? formatLocalTime(rawValue) : null;

  return (
    <span className={`inline-flex flex-col sm:flex-row sm:items-baseline gap-x-1.5 text-xs ${className}`}>
      <span className="font-mono text-foreground/90 font-medium">{utcText}</span>
      {showLocal && localText && (
        <span className="text-muted-foreground text-[11px]" title="Local user time">
          (Local: {localText})
        </span>
      )}
    </span>
  );
}

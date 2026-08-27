"use client";

import { cn } from "@/lib/utils";

const TONE = {
  live: { dot: "bg-live", ring: "bg-live", text: "text-live" },
  warn: { dot: "bg-unsure", ring: "bg-unsure", text: "text-unsure" },
  chain: { dot: "bg-chain", ring: "bg-chain", text: "text-chain" },
  sealed: { dot: "bg-sealed", ring: "bg-sealed", text: "text-sealed" },
  down: { dot: "bg-no", ring: "bg-no", text: "text-no" },
  idle: {
    dot: "bg-muted-foreground",
    ring: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
} as const;

export type DotTone = keyof typeof TONE;

/** A dot with an expanding ping ring — the app's single "this is live" tell. */
export function LiveDot({
  tone = "live",
  className,
  pulse = true,
}: {
  tone?: DotTone;
  className?: string;
  pulse?: boolean;
}) {
  const t = TONE[tone];
  return (
    <span className={cn("relative grid size-2.5 shrink-0 place-items-center", className)}>
      {pulse && (
        <span className={cn("ov-ping absolute inset-0 rounded-full", t.ring)} aria-hidden />
      )}
      <span className={cn("relative size-2 rounded-full", t.dot)} />
    </span>
  );
}

/** Bordered status pill: live dot + monospace label. Used in headers and rails. */
export function StatusPill({
  tone = "live",
  label,
  sub,
  pulse = true,
  className,
}: {
  tone?: DotTone;
  label: React.ReactNode;
  sub?: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 shadow-2xs",
        className,
      )}
    >
      <LiveDot tone={tone} pulse={pulse} />
      <span
        className={cn(
          "font-mono text-[10px] font-semibold tracking-[0.12em] uppercase",
          TONE[tone].text,
        )}
      >
        {label}
      </span>
      {sub && <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>}
    </span>
  );
}

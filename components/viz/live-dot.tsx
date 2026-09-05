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
  // For a dot sitting on the filled accent, where ink would disappear.
  onAccent: { dot: "bg-white", ring: "bg-white", text: "text-white" },
} as const;

export type DotTone = keyof typeof TONE;

// Two sizes only: the default everywhere, and one step up for the claim page's
// broadcast chip, where the dot has to read across the room.
const DOT_SIZE = {
  md: { box: "size-2.5", dot: "size-2" },
  lg: { box: "size-3.5", dot: "size-2.5" },
} as const;

export type DotSize = keyof typeof DOT_SIZE;

/** A dot with an expanding ping ring — the app's single "this is live" tell. */
export function LiveDot({
  tone = "live",
  className,
  pulse = true,
  size = "md",
}: {
  tone?: DotTone;
  className?: string;
  pulse?: boolean;
  size?: DotSize;
}) {
  const t = TONE[tone];
  const s = DOT_SIZE[size];
  return (
    <span className={cn("relative grid shrink-0 place-items-center", s.box, className)}>
      {pulse && (
        <span className={cn("ov-ping absolute inset-0 rounded-full", t.ring)} aria-hidden />
      )}
      <span className={cn("relative rounded-full", s.dot, t.dot)} />
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
        "inline-flex items-center gap-2 border border-border bg-card px-2.5 py-1 shadow-2xs",
        className,
      )}
    >
      <LiveDot tone={tone} pulse={pulse} />
      <span
        className={cn(
          "ov-micro ov-micro-sm",
          TONE[tone].text,
        )}
      >
        {label}
      </span>
      {sub && <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>}
    </span>
  );
}

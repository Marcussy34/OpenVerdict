"use client";

import * as React from "react";
import { ShieldTick, ShieldCross, Warning2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useCountUp } from "./use-count-up";

const R = 78;
const CIRC = 2 * Math.PI * R;
const SWEEP = 0.75; // 270° dial
const ARC = CIRC * SWEEP;

export type VerdictTier = "yes" | "no" | "unsure";

export function tierForScore(score: number): VerdictTier {
  if (score >= 65) return "yes";
  if (score <= 35) return "no";
  return "unsure";
}

const TIER = {
  yes: {
    label: "High confidence — TRUE",
    stroke: "var(--signal-yes)",
    text: "text-yes",
    chip: "border-yes/30 bg-yes/8 text-yes",
    icon: ShieldTick,
  },
  no: {
    label: "High confidence — FALSE",
    stroke: "var(--signal-no)",
    text: "text-no",
    chip: "border-no/30 bg-no/8 text-no",
    icon: ShieldCross,
  },
  unsure: {
    label: "Uncertain / mixed",
    stroke: "var(--signal-unsure)",
    text: "text-unsure",
    chip: "border-unsure/30 bg-unsure/8 text-unsure",
    icon: Warning2,
  },
} as const;

/**
 * Truth Score dial: a 270° SVG arc with graduated ticks, an animated sweep, a
 * cap dot riding the head of the sweep and a count-up readout. Hand-rolled SVG,
 * no chart library. Renders an explicitly "unscored" face when the claim never
 * had a jury round (PRD: never fabricate a synthetic score).
 */
export function VerdictGauge({
  scoreBps,
  size = 200,
  className,
  compact = false,
  emptyTitle = "——",
  emptyLabel = "Not independently\nreviewed",
  emptyChip = "No jury round",
}: {
  scoreBps?: number | null;
  size?: number;
  className?: string;
  compact?: boolean;
  emptyTitle?: string;
  emptyLabel?: string;
  emptyChip?: string;
}) {
  const score =
    scoreBps === null || scoreBps === undefined
      ? null
      : Math.max(0, Math.min(100, Math.round(scoreBps / 100)));

  const animated = useCountUp(score);
  const tier = score === null ? null : TIER[tierForScore(score)];
  const Icon = tier?.icon;

  const progress = score === null ? 0 : (animated / 100) * ARC;
  const uid = React.useId().replace(/:/g, "");

  // The dial art is an SVG viewBox and scales with `size` on its own, but the
  // centre readout is HTML at fixed type sizes. Below ~160px the label and the
  // bps line stop being legible, so a dense readout keeps only the number and
  // derives its type from the dial. Every panel calls this at 190-200px, which
  // takes the untouched path.
  const dense = size < 160;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 200 200"
          width={size}
          height={size}
          role="img"
          aria-label={
            score === null
              ? "Truth score: not independently reviewed"
              : `Truth score ${score} out of 100`
          }
        >
          <defs>
            <linearGradient id={`g-${uid}`} x1="0" y1="1" x2="1" y2="0">
              <stop
                offset="0%"
                stopColor={tier?.stroke ?? "var(--muted-foreground)"}
                stopOpacity="0.4"
              />
              <stop
                offset="100%"
                stopColor={tier?.stroke ?? "var(--muted-foreground)"}
                stopOpacity="1"
              />
            </linearGradient>
          </defs>

          {/* Graduated ticks every 5 points; every 25 reads as a major mark. */}
          <g transform="rotate(135 100 100)">
            {Array.from({ length: 21 }).map((_, i) => {
              const major = i % 5 === 0;
              const a = (i / 20) * SWEEP * 360;
              const rad = (a * Math.PI) / 180;
              const r1 = R + 9;
              const r2 = R + (major ? 16 : 13);
              return (
                <line
                  key={i}
                  x1={100 + r1 * Math.cos(rad)}
                  y1={100 + r1 * Math.sin(rad)}
                  x2={100 + r2 * Math.cos(rad)}
                  y2={100 + r2 * Math.sin(rad)}
                  stroke="currentColor"
                  strokeWidth={major ? 1.6 : 1}
                  className={major ? "text-ocean/25" : "text-ocean/10"}
                  strokeLinecap="round"
                />
              );
            })}
          </g>

          {/* Track */}
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke="currentColor"
            className="text-surface-2"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${ARC} ${CIRC}`}
            transform="rotate(135 100 100)"
          />

          {/* Progress sweep */}
          {score !== null && (
            <>
              <circle
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={`url(#g-${uid})`}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${progress} ${CIRC}`}
                transform="rotate(135 100 100)"
              />
              {/* Bright cap dot riding the head of the sweep. */}
              <circle
                cx={100 + R * Math.cos((((animated / 100) * SWEEP * 360 + 135) * Math.PI) / 180)}
                cy={100 + R * Math.sin((((animated / 100) * SWEEP * 360 + 135) * Math.PI) / 180)}
                r="5.5"
                fill="#fff"
                stroke={tier?.stroke}
                strokeWidth="3"
              />
            </>
          )}
        </svg>

        {/* Centre readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score === null ? (
            <>
              <span
                className={cn("font-medium text-muted-foreground", !dense && "text-3xl")}
                style={dense ? { fontSize: Math.round(size * 0.2) } : undefined}
              >
                {emptyTitle}
              </span>
              {!dense && (
                <span className="ov-micro ov-micro-sm mt-1 max-w-[9.5rem] text-center leading-tight whitespace-pre-line text-muted-foreground">
                  {emptyLabel}
                </span>
              )}
            </>
          ) : (
            <>
              <div className="flex items-baseline">
                <span
                  className={cn(
                    "leading-none font-medium tracking-tight tabular-nums",
                    !dense && "text-[2.75rem]",
                    tier?.text,
                  )}
                  style={dense ? { fontSize: Math.round(size * 0.26) } : undefined}
                >
                  {Math.round(animated)}
                </span>
                <span
                  className={cn("ml-1 text-muted-foreground", !dense && "text-sm")}
                  style={dense ? { fontSize: Math.round(size * 0.085) } : undefined}
                >
                  /100
                </span>
              </div>
              {!dense && (
                <>
                  <span className="ov-micro ov-micro-sm mt-1.5 text-muted-foreground">
                    Truth Score
                  </span>
                  <span className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {scoreBps} bps
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {!compact && (
        <div
          className={cn(
            "ov-micro ov-micro-sm -mt-1 flex items-center gap-1.5 border bg-card px-3 py-1",
            score === null ? "border-border text-muted-foreground" : tier?.chip,
          )}
        >
          {Icon && <Icon size="12" variant="Bold" />}
          <span>{tier?.label ?? emptyChip}</span>
        </div>
      )}
    </div>
  );
}

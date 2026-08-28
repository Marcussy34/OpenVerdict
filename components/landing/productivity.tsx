"use client";

import * as React from "react";
import { SplitButton, Eyebrow, CornerPin, NumberChip, GridGuides } from "./primitives";
import { BallotSealArt, EvidencePinArt, CertificateArt } from "./dotted-art";
import { Reveal } from "@/components/viz/reveal";
import { useCountUp } from "@/components/viz/use-count-up";
import type { ClaimInspection } from "@/lib/engine/contract";

const ROWS = [
  { title: "Committed before revealed", Art: BallotSealArt },
  { title: "Evidence pinned on Walrus", Art: EvidencePinArt },
  { title: "Certificates on Sui", Art: CertificateArt },
];

/** The stat card's surface. The docking layer fades the same gradient in behind
 *  the travelling globe, so the visual arrives as a solid panel, not a ghost. */
export const STAT_CARD_BACKGROUND =
  "linear-gradient(180deg,#010a18 0%,#04122b 34%,#0b3572 68%,#7ba3d6 100%)";

/**
 * Section 2 — the hero's globe docks into this section's dark card.
 *
 * `cardSlotRef` marks the exact frame the docking layer interpolates toward,
 * and `dockProgress` (0 → 1) drives the card chrome's crossfade so the content
 * lands on top of the arriving visual rather than punching through it.
 */
export function Productivity({ claims }: { claims: ClaimInspection[] }) {
  // Real counters off the read-only claim feed — nothing here is synthesised.
  const settled = claims.filter((c) => c.state >= 9 && c.state !== 12).length;
  const seats = claims.reduce((n, c) => n + (c.commitments?.length ?? 0), 0);
  const settledCount = useCountUp(settled);
  const seatCount = useCountUp(seats);

  return (
    <section
      data-header-theme="light"
      className="ov-light-wash relative overflow-hidden text-black"
    >
      <GridGuides columns={3} className="hidden md:block" />

      <div className="relative px-5 pt-24 pb-24 md:px-7 md:pt-28 md:pb-28">
        <div className="grid gap-8 lg:grid-cols-3 lg:gap-7">
          {/* Left: the claim this section makes. z-30 keeps every piece of type
              clear of the docking layer that flies through at z-20. */}
          <div className="relative z-30 flex flex-col justify-between">
            <CornerPin className="-top-6 left-0 hidden lg:block" />
            <Reveal>
              <h2 className="ov-display text-[clamp(2.5rem,5.2vw,4.25rem)]">
                Pioneering
                <br />
                Verifiability
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="mt-10 max-w-[330px] text-[15px] leading-[1.5] text-black/70 lg:mt-0">
                Five jurors drawn across at least three model families deliberate under
                commit–reveal, and the tally settles on-chain. Every score is integer
                arithmetic anyone can rerun against the same frozen evidence.
              </p>
            </Reveal>
          </div>

          {/* Centre: the dock target */}
          <div className="relative">
            <CornerPin className="-top-2 left-0 z-40" />
            <div
              className="relative flex min-h-[520px] flex-col overflow-hidden lg:min-h-[640px]"
              style={{ background: STAT_CARD_BACKGROUND }}
            >
              {/* Scrim: keeps the readouts legible over the docked globe, so it
                  has to sit just above the docking layer's own z-20. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[25]"
                style={{
                  background:
                    "linear-gradient(180deg,rgba(1,10,24,0.86) 0%,rgba(2,14,32,0.30) 34%,rgba(3,20,48,0.35) 66%,rgba(24,60,110,0.78) 100%)",
                }}
              />

              {/* The docking layer fades this chrome in over the arriving globe
                  by writing opacity here; with docking off it just stays 1. */}
              <div
                className="relative z-30 flex flex-1 flex-col p-6 text-[#F3F3F3] md:p-7"
                data-card-chrome
              >
                <StatRow label="Claims settled" value={Math.round(settledCount)} />
                <div className="ov-hr ov-hr--dark my-5" />
                <StatRow label="Jury seats drawn" value={Math.round(seatCount)} />

                <SettlementChart claims={claims} />

                <SplitButton href="/claims" tone="dark" stretch className="mt-6">
                  More in live claims
                </SplitButton>
              </div>
            </div>
          </div>

          {/* Right: the three guarantees, each with its dotted schematic */}
          <div className="relative z-30 flex flex-col gap-4">
            {ROWS.map((row, i) => (
              <Reveal key={row.title} delay={0.08 * i} y={22}>
                <div
                  className="relative flex min-h-[172px] items-start justify-between gap-4 overflow-hidden p-5 lg:min-h-[204px]"
                  // Opaque on purpose: the docking globe flies past at z-20 and
                  // would otherwise ghost straight through these panels.
                  style={{
                    background:
                      "linear-gradient(158deg,#e8eef6 0%,#dee6f0 55%,#f2f2f0 100%)",
                  }}
                >
                  <div className="relative z-10">
                    <NumberChip n={i + 1} />
                    <p className="mt-3 max-w-[210px] text-[19px] leading-[1.2] font-medium tracking-[-0.01em]">
                      {row.title}
                    </p>
                  </div>
                  <row.Art
                    className="pointer-events-none absolute -right-4 -bottom-6 text-black/25"
                    size={200}
                  />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <Eyebrow className="text-[#F3F3F3]/70">{label}</Eyebrow>
      <span className="text-[clamp(1.6rem,2.4vw,2rem)] leading-none font-medium tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

/**
 * Cumulative settlements across the claim docket, in submission order. Every
 * point is a real claim; an unsettled one holds the line flat.
 */
function SettlementChart({ claims }: { claims: ClaimInspection[] }) {
  const W = 520;
  const H = 210;

  const points = React.useMemo(() => {
    const ordered = [...claims].reverse(); // the feed arrives newest-first
    const series: number[] = [];
    for (const c of ordered) {
      const previous = series[series.length - 1] ?? 0;
      series.push(c.state >= 9 && c.state !== 12 ? previous + 1 : previous);
    }
    if (series.length < 2) return null;
    const max = Math.max(1, series[series.length - 1] ?? 1);
    return series.map((v, i) => {
      const x = (i / (series.length - 1)) * (W - 24) + 12;
      const y = H - 16 - (v / max) * (H - 44);
      return [x, y] as const;
    });
  }, [claims]);

  return (
    <div className="relative mt-8 flex-1">
      <svg
        aria-hidden
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full min-h-[150px] w-full"
      >
        {/* dashed column guides, matching the page's furniture */}
        {Array.from({ length: 13 }, (_, i) => (
          <line
            key={i}
            x1={12 + (i * (W - 24)) / 12}
            x2={12 + (i * (W - 24)) / 12}
            y1={10}
            y2={H - 10}
            stroke="rgba(243,243,243,0.16)"
            strokeWidth={1}
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points ? (
          <>
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="#F3F3F3"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            <rect
              x={(points[points.length - 1]?.[0] ?? 0) - 3}
              y={(points[points.length - 1]?.[1] ?? 0) - 3}
              width={6}
              height={6}
              fill="#F3F3F3"
            />
          </>
        ) : (
          <line
            x1={12}
            x2={W - 12}
            y1={H - 16}
            y2={H - 16}
            stroke="rgba(243,243,243,0.55)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="ov-micro ov-micro-sm absolute bottom-0 left-0 text-[#F3F3F3]/45">
        Cumulative settlements · by claim order
      </p>
    </div>
  );
}

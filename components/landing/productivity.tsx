"use client";

import * as React from "react";
import { SplitButton, Eyebrow, CornerPin, NumberChip, GridGuides } from "./primitives";
import { BallotSealArt, EvidencePinArt, CertificateArt } from "./dotted-art";
import { useReducedMotion } from "motion/react";
import { useScrollFrame, clamp01 } from "./scroll-driver";
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
const HEADLINE = ["Pioneering", "Verifiability"];
// The three guarantee cards on the entrance clock, which starts at the mask's
// landing: row 01 is already sliding in as the dissolve begins, then one every
// ROW_STEP, so the column emerges with the section rather than after it. The
// last lands with the headline's final letters. `ENTRANCE_COMPLETE` is that
// moment — the hero's runway is exactly that long, so the page moves on the
// instant the sequence finishes.
const ROW_START = 0.08;
const ROW_STEP = 0.22;
const ROW_WINDOW = 0.26;
/** Every element of the section has landed here. */
const ROWS_COMPLETE = ROW_START + (ROWS.length - 1) * ROW_STEP + ROW_WINDOW;
/** …and the card keeps deepening for one more beat of scroll before the page
 *  is handed back. That tail is what the hero's runway ends on. */
const CARD_TAIL = 0.5;
export const ENTRANCE_COMPLETE = ROWS_COMPLETE + CARD_TAIL;
/** Deterministic pseudo-random reveal threshold per letter (SSR-stable). */
function letterThreshold(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return 0.04 + (x - Math.floor(x)) * 0.58;
}

export function Productivity({
  cardRef,
  entranceRef,
  claims,
}: {
  /** Marks the stat card frame the hero's closing mask converges on. */
  cardRef?: React.RefObject<HTMLDivElement | null>;
  /** Entrance progress from the hero choreography (−1 = drive it locally). */
  entranceRef?: React.MutableRefObject<number>;
  claims: ClaimInspection[];
}) {
  // Real counters off the read-only claim feed — nothing here is synthesised.
  const settled = claims.filter((c) => c.state >= 9 && c.state !== 12).length;
  const seats = claims.reduce((n, c) => n + (c.commitments?.length ?? 0), 0);
  const settledCount = useCountUp(settled);
  const seatCount = useCountUp(seats);

  const reduce = useReducedMotion() ?? false;
  const sectionRef = React.useRef<HTMLElement>(null);
  const h2Ref = React.useRef<HTMLHeadingElement>(null);
  const paraRef = React.useRef<HTMLParagraphElement>(null);
  const cardBoxRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const letters = React.useRef<HTMLElement[] | null>(null);

  // Everything below is scrubbed by scroll — a pure function of position,
  // consistent with the rest of the page (stop means stop). While the hero
  // choreography runs, its runway provides the progress; otherwise it comes
  // from this section's own place in the viewport.
  useScrollFrame(({ vh }) => {
    const clear = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.opacity = "";
      el.style.transform = "";
    };
    if (reduce) {
      letters.current?.forEach(clear);
      clear(h2Ref.current);
      clear(paraRef.current);
      clear(cardBoxRef.current);
      rowRefs.current.forEach(clear);
      return;
    }

    const ext = entranceRef?.current ?? -1;
    let q: number;
    if (ext >= 0) {
      q = ext;
    } else {
      const rect = sectionRef.current?.getBoundingClientRect();
      if (!rect) return;
      q = (vh * 0.92 - rect.top) / (vh * 0.7);
    }

    if (h2Ref.current) {
      const hq = clamp01(q / 0.8);
      h2Ref.current.style.transform = `translate3d(0, ${((1 - hq) * 28).toFixed(1)}px, 0)`;
    }
    if (!letters.current && h2Ref.current) {
      letters.current = Array.from(h2Ref.current.querySelectorAll<HTMLElement>("[data-l]"));
    }
    letters.current?.forEach((el, i) => {
      el.style.opacity = clamp01((q - letterThreshold(i)) / 0.16).toFixed(3);
    });

    const pq = clamp01((q - 0.45) / 0.3);
    if (paraRef.current) {
      paraRef.current.style.opacity = pq.toFixed(3);
      paraRef.current.style.transform = `translate3d(0, ${((1 - pq) * 14).toFixed(1)}px, 0)`;
    }

    if (cardBoxRef.current) {
      // The card is the dock's landing target: it must stay transform-static
      // (a moving target makes the landed mask visibly settle — "the drop").
      // Its entrance is the mask landing itself plus this ramp, which develops
      // across the WHOLE entrance and then some: everything else has landed by
      // ROWS_COMPLETE, and the card goes on deepening through CARD_TAIL, hitting
      // full strength on the last of the scroll before the page is released.
      // Eased hard so it is already most of the way there when the hero
      // dissolves off it — a linear ramp washes the panel out at the handoff.
      const cq = clamp01(q / ENTRANCE_COMPLETE);
      cardBoxRef.current.style.opacity = Math.pow(cq, 0.35).toFixed(3);
      cardBoxRef.current.style.transform = "";
    }

    rowRefs.current.forEach((el, i) => {
      if (!el) return;
      // One by one from the side, the first arriving through the tail of the
      // dissolve so the column is already filling in as the hero hands off.
      const rq = clamp01((q - (ROW_START + i * ROW_STEP)) / ROW_WINDOW);
      el.style.opacity = rq.toFixed(3);
      el.style.transform = `translate3d(${((1 - rq) * 64).toFixed(1)}px, ${((1 - rq) * 24).toFixed(1)}px, 0)`;
    });
  });

  return (
    <section
      ref={sectionRef}
      // On tall screens the content is shorter than the viewport, so the
      // section fills it and centres. Without this the padding below reads as
      // double the padding above, with the next section bleeding into the gap.
      className="ov-light-wash relative flex flex-col justify-center overflow-hidden text-black lg:min-h-screen"
    >
      <GridGuides columns={3} className="hidden md:block" />

      <div className="relative px-5 pt-24 pb-24 md:px-7 md:pt-28 md:pb-28">
        <div className="grid gap-8 lg:grid-cols-3 lg:gap-7">
          {/* Left: the claim this section makes. z-30 keeps every piece of type
              clear of the docking layer that flies through at z-20. */}
          <div className="relative z-30 flex flex-col justify-between">
            <CornerPin className="-top-6 left-0 hidden lg:block" />
            <h2 ref={h2Ref} className="ov-display text-[clamp(2.5rem,5.2vw,4.25rem)]">
              {HEADLINE.map((word) => (
                <span key={word} className="block">
                  {Array.from(word).map((ch, i) => (
                    <span key={i} data-l className="inline-block">
                      {ch}
                    </span>
                  ))}
                </span>
              ))}
            </h2>
            <p
              ref={paraRef}
              className="mt-10 max-w-[330px] text-[15px] leading-[1.5] text-black lg:mt-0"
            >
              Five jurors drawn across three model families research both sides,
              deliberate under commit–reveal, and the tally settles on-chain. Every
              score is integer arithmetic anyone can rerun against the same recorded
              evidence and research trails.
            </p>
          </div>

          {/* Centre: the dock target */}
          <div className="relative">
            <CornerPin className="-top-2 left-0 z-40" />
            <div
              className="relative flex min-h-[520px] flex-col overflow-hidden lg:min-h-[640px]"
              ref={(el) => {
                cardBoxRef.current = el;
                if (cardRef) cardRef.current = el;
              }}
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
              <div
                key={row.title}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="will-change-transform"
              >
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
                    className="pointer-events-none absolute -right-4 -bottom-6 text-black/45"
                    size={200}
                  />
                </div>
              </div>
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
      <Eyebrow className="text-[#F3F3F3]">{label}</Eyebrow>
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

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, CornerPin, Hairline } from "./primitives";
import { JuryMark, SealMark, SeatMark, RecomputeMark } from "./dotted-art";
import { Reveal } from "@/components/viz/reveal";

const ROWS = [
  {
    Mark: JuryMark,
    title: "Juries diverse by construction",
    body: "Seats are drawn by Sui native randomness across DeepSeek, Kimi and MiniMax through GonkaRouter — five jurors, at least three model families, at most two seats per model.",
  },
  {
    Mark: SealMark,
    title: "Evidence sealed before deliberation",
    body: "Sources are fetched through an SSRF-safe proxy, sanitised to plain text and Merkle-frozen to Walrus before any model reads them. The manifest hash is on-chain.",
  },
  {
    Mark: SeatMark,
    title: "Seats carry real stake",
    body: "Any account can open a juror seat by staking at least 0.1 SUI on it, and a committee seats at most two jurors per model family and one per operational signing key, so a single draw spreads across families and operators.",
  },
  {
    Mark: RecomputeMark,
    title: "Verdicts anyone can recompute",
    body: "Commitments, Merkle roots and the integer Truth Score all rerun in your browser on the verifier page, or from the CLI against the same certificate.",
  },
];

/**
 * Section 7 — what the protocol is actually for. Rows fade and rise in once,
 * with an ambient column sliding in from the right edge as the section enters.
 */
export function Opportunity() {
  const reduce = useReducedMotion();

  return (
    <section
      data-header-theme="light"
      className="relative z-30 isolate overflow-hidden text-black"
      style={{
        background:
          "linear-gradient(180deg,#f7f7f5 0%,#eaeff5 32%,#f2f4f4 72%,#f7f7f5 100%)",
      }}
    >
      {/* No column guides here: the row hairlines and the ambient column carry
          the structure, and the verticals cut through the copy. */}

      {/* The ambient column: slow, looping, and light enough to ignore. */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0, x: 90 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: reduce ? 0 : 1, ease: [0.22, 1, 0.36, 1] }}
        // Sits in the band the list leaves empty — from where the row hairlines
        // stop (62%) to the right edge — centred in it rather than pinned to
        // the margin.
        className="pointer-events-none absolute inset-y-0 right-0 left-[62%] hidden justify-center lg:flex"
      >
        <div className="relative h-full w-[26vw] max-w-[380px] overflow-hidden">
          <AmbientColumn />
        </div>
      </motion.div>

      <div className="relative px-5 pt-4 pb-28 md:px-7 md:pb-32">
        <div className="relative max-w-[560px] pb-10">
          <CornerPin className="-top-4 left-0" />
          <Eyebrow>What it unlocks</Eyebrow>
        </div>

        <div className="lg:max-w-[62%]">
          {ROWS.map((row, i) => (
            <div key={row.title}>
              {i > 0 && <Hairline />}
              <Reveal delay={i * 0.08} y={22}>
                <div className="flex items-start gap-6 py-9 lg:gap-10 lg:py-12">
                  <row.Mark className="-mt-1 size-16 shrink-0 text-black/60 lg:size-[88px]" />
                  <div className="min-w-0">
                    <h3 className="text-[19px] leading-snug font-medium tracking-[-0.01em]">
                      {row.title}
                    </h3>
                    <p className="mt-2.5 max-w-[440px] text-[15px] leading-[1.5] text-black/65">
                      {row.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A dashed column that drifts upward forever — the reference's metal pillar,
 * redrawn in the same hairline register as the rest of the page. The track
 * holds the pattern twice so -50% loops seamlessly.
 */
function AmbientColumn() {
  return (
    <div className="ov-drift absolute inset-x-0 top-0 h-[200%] w-full">
      {Array.from({ length: 24 }, (_, i) => (
        <svg
          key={i}
          aria-hidden
          viewBox="0 0 200 60"
          preserveAspectRatio="none"
          className="block h-[calc(100%/24)] w-full text-black/28"
          fill="none"
          stroke="currentColor"
        >
          {/* Continuous side rails turn the stack of rings into one column. */}
          <path d="M28 0v60M172 0v60" strokeDasharray="3 5" />
          <ellipse cx="100" cy="30" rx="72" ry="17" strokeDasharray="3 5" />
          <path d="M60 12h80M60 48h80" strokeDasharray="2 6" opacity="0.6" />
          {i % 4 === 0 && <rect x="97" y="27" width="6" height="6" fill="var(--ov-accent)" stroke="none" />}
        </svg>
      ))}
    </div>
  );
}

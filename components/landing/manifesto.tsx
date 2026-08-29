"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { SplitButton, Eyebrow, CornerPin } from "./primitives";
import { useScrollFrame, clamp01 } from "./scroll-driver";

const COPY =
  "Open verification is becoming public infrastructure. Claims deserve juries no single vendor can steer — evidence sealed before deliberation, verdicts settled in public where anyone can audit them. This is just the beginning.";

const WORDS = COPY.split(" ");
/** How many words are mid-fade at any moment — the width of the wipe. */
const WINDOW = Math.max(4, Math.round(WORDS.length * 0.22));
/** Arrival: every LETTER has its own moment on the entrance clock, scattered
 *  but deterministic (a sin-hash, so server and client agree) — the same
 *  materialising effect the "Pioneering Verifiability" headline uses. */
function letterThreshold(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return 0.04 + (x - Math.floor(x)) * 0.58;
}
const ARRIVAL_WINDOW = 0.16;

/**
 * Section 6 — the manifesto, revealed word by word as the section crosses the
 * viewport. Words render at full opacity, and the scroll effect takes over on
 * mount, so reduced motion (and a failed hydration) simply leaves the
 * paragraph readable.
 */
export function Manifesto() {
  const paraRef = React.useRef<HTMLParagraphElement>(null);
  const letters = React.useRef<HTMLElement[] | null>(null);
  const lastArrival = React.useRef(-1);
  const reduce = useReducedMotion();

  useScrollFrame(
    ({ vh }) => {
      const para = paraRef.current;
      if (!para) return;
      const r = para.getBoundingClientRect();
      // Two stacked clocks, deliberately sequential — the scatter has to finish
      // ON SCREEN before the wipe starts, or it plays out below the fold and
      // the paragraph just looks like it appeared normally.
      // Arrival: paragraph top from 98vh (barely peeking) to 55vh (the whole
      // block sitting in the lower half); the copy materialises letter by
      // letter in scattered order — pure opacity, nothing moves.
      const arrival = clamp01((vh * 0.98 - r.top) / (vh * 0.43));
      // Wipe: picks up where the arrival ends and reads left to right, done by
      // the time the paragraph reaches the top third — a fixed 28vh of travel,
      // not one that stretched with the paragraph's own height.
      const progress = clamp01((vh * 0.58 - r.top) / (vh * 0.28));
      // The wipe writes the word spans; the arrival writes the letters nested
      // inside them, and CSS multiplies the two — no element carries both.
      const spans = para.children;
      for (let i = 0; i < spans.length; i++) {
        const t = clamp01((progress * (WORDS.length + WINDOW) - i) / WINDOW);
        (spans[i] as HTMLElement).style.opacity = String(0.25 + 0.75 * t);
      }

      if (!letters.current) {
        letters.current = Array.from(para.querySelectorAll<HTMLElement>("[data-l]"));
      }
      // Hundreds of letters: only rewrite them while the arrival is actually
      // moving, not on every frame for the rest of the page.
      if (arrival !== lastArrival.current) {
        lastArrival.current = arrival;
        letters.current.forEach((el, i) => {
          el.style.opacity = clamp01((arrival - letterThreshold(i)) / ARRIVAL_WINDOW).toFixed(3);
        });
      }
    },
    !reduce,
  );

  return (
    <section className="ov-navy-to-light relative z-30 isolate overflow-hidden">
      <div aria-hidden data-header-theme="dark" className="absolute inset-x-0 top-0 h-[55%]" />
      <div aria-hidden data-header-theme="light" className="absolute inset-x-0 top-[55%] bottom-0" />

      <div className="relative px-5 pt-28 pb-40 md:px-7 md:pt-32 md:pb-56">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <CornerPin className="-top-6 left-0" />
          <Eyebrow className="text-[#F3F3F3]/75">Why open verification</Eyebrow>
          <SplitButton
            href="https://github.com/Marcussy34/OpenVerdict#readme"
            tone="dark"
          >
            Learn more
          </SplitButton>
        </div>

        <p
          ref={paraRef}
          // 225 spans (33 words, 192 letters) have their opacity rewritten every
          // scroll frame, at display size. Without its own layer that repaint
          // dirties the section's full-bleed gradient behind it, which is what
          // made this the jankiest section on the page. The hint costs one layer
          // for the paragraph and changes nothing visually.
          style={{ willChange: "opacity" }}
          className="ov-display mt-5 max-w-[1000px] text-[clamp(1.5rem,3.1vw,2.75rem)] leading-[1.23] text-[#F3F3F3]"
        >
          {/* One span per word (the only element children, so the wipe can
              index them) with real whitespace between, which is what lets the
              paragraph wrap normally — and one span per letter inside, which
              is what the arrival materialises. */}
          {WORDS.map((word, i) => (
            <React.Fragment key={`${word}-${i}`}>
              <span className="inline-block">
                {Array.from(word).map((ch, k) => (
                  <span key={k} data-l className="inline-block">
                    {ch}
                  </span>
                ))}
              </span>
              {i < WORDS.length - 1 ? " " : null}
            </React.Fragment>
          ))}
        </p>
      </div>
    </section>
  );
}

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
/** Arrival: each word has its own moment on the entrance clock, scattered but
 *  deterministic (a sin-hash, so server and client agree). */
function wordThreshold(i: number) {
  const x = Math.sin((i + 1) * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 0.62;
}
const ARRIVAL_WINDOW = 0.34;

/**
 * Section 6 — the manifesto, revealed word by word as the section crosses the
 * viewport. Words render at full opacity, and the scroll effect takes over on
 * mount, so reduced motion (and a failed hydration) simply leaves the
 * paragraph readable.
 */
export function Manifesto() {
  const paraRef = React.useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();

  useScrollFrame(
    ({ vh }) => {
      const para = paraRef.current;
      if (!para) return;
      const r = para.getBoundingClientRect();
      // Two stacked clocks. Arrival: the words appear in scattered order as the
      // paragraph first rises into view, each one settling at the dim base.
      const arrival = clamp01((vh * 1.06 - r.top) / (vh * 0.34));
      // Wipe: starts as the paragraph passes 85vh, completes near mid-viewport,
      // and reads left to right through whatever has arrived.
      const progress = clamp01((vh * 0.85 - r.top) / (vh * 0.4 + r.height));
      const spans = para.children;
      for (let i = 0; i < spans.length; i++) {
        const t = clamp01((progress * (WORDS.length + WINDOW) - i) / WINDOW);
        const a = clamp01((arrival - wordThreshold(i)) / ARRIVAL_WINDOW);
        (spans[i] as HTMLElement).style.opacity = String(a * (0.25 + 0.75 * t));
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
          className="ov-display mt-5 max-w-[1000px] text-[clamp(1.5rem,3.1vw,2.75rem)] leading-[1.23] text-[#F3F3F3]"
        >
          {/* One span per word (the only element children, so the scroll
              effect can index them) with real whitespace between, which is
              what lets the paragraph wrap normally. */}
          {WORDS.map((word, i) => (
            <React.Fragment key={`${word}-${i}`}>
              <span className="inline-block">{word}</span>
              {i < WORDS.length - 1 ? " " : null}
            </React.Fragment>
          ))}
        </p>
      </div>
    </section>
  );
}

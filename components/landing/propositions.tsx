"use client";

import * as React from "react";
import { Eyebrow, CornerPin, GridGuides, Hairline } from "./primitives";
import { SwarmGlobe } from "@/components/globe/swarm-globe";

const ITEMS = [
  {
    kicker: "Jury",
    title: "Diverse by Construction",
    body: "Every panel draws five jurors across at least three model families through GonkaRouter, with a cap of two seats per model. No single vendor can steer a verdict.",
  },
  {
    kicker: "Commit–reveal",
    title: "Sealed Before Spoken",
    body: "Jurors publish a Blake2b-256 commitment first and open it only in the reveal round. Nobody can read a peer's vote in time to copy it or bend to it.",
  },
  {
    kicker: "Evidence",
    title: "Pinned Before Deliberation",
    body: "Sources are crawled, sanitised and Merkle-frozen to Walrus before the jury convenes. The record cannot shift underneath the verdict that cites it.",
  },
  {
    kicker: "Settlement",
    title: "Certificates on Sui",
    body: "Commitments, reveals, tallies and the final certificate are Move objects on Sui. Anyone can pull them and recompute the Truth Score independently.",
  },
];

/** The ground has already gone dark by the time the list starts, so every row
 *  is on-dark: one white ink for all four, the active one at full strength. */
const INK = "#F3F3F3";

/**
 * Sections 3–4 — the protocol stack.
 *
 * The list scrolls past a sticky visual; whichever item is crossing the middle
 * of the viewport holds full opacity while the rest fall back to 0.4. The
 * ground fades from paper to deep navy across the section, and the ink ramps
 * with it.
 */
export function Propositions() {
  const [active, setActive] = React.useState(0);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute("data-index"));
          if (!Number.isNaN(index)) setActive(index);
        }
      },
      // Collapses the root to a band across the middle of the viewport.
      { rootMargin: "-46% 0px -46% 0px", threshold: 0 },
    );
    itemRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    // No `overflow-hidden` on this section: an overflow-clipped ancestor makes
    // the sticky visual below stick to the section instead of the viewport.
    <section className="ov-light-to-navy relative z-30 isolate">
      {/* Two markers so the fixed header flips mid-section, where the ground
          actually turns dark — matched to the gradient's 31% stop. */}
      <div aria-hidden data-header-theme="light" className="absolute inset-x-0 top-0 h-[30%]" />
      <div aria-hidden data-header-theme="dark" className="absolute inset-x-0 top-[30%] bottom-0" />

      <GridGuides columns={3} className="hidden md:block" />

      <div className="relative px-5 pt-24 pb-16 md:px-7 md:pt-28 md:pb-24">
        <div className="relative max-w-[760px]">
          <CornerPin className="-top-6 left-0" />
          <Eyebrow>Protocol</Eyebrow>
          <h2 className="ov-display mt-2 text-[clamp(2.5rem,5.2vw,4.25rem)]">
            The Stack for
            <br />
            Settling Claims
          </h2>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-12 lg:gap-7">
          {/* The list */}
          <div className="lg:col-span-8">
            {ITEMS.map((item, i) => (
              <div key={item.kicker}>
                <Hairline dark className={i === 0 ? "hidden" : ""} />
                <div
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  data-index={i}
                  data-proposition
                  className="grid gap-4 py-9 transition-opacity duration-500 md:grid-cols-2 md:gap-10 lg:py-12"
                  style={{ color: INK, opacity: active === i ? 1 : 0.4 }}
                >
                  <div>
                    <Eyebrow className="opacity-70">{item.kicker}</Eyebrow>
                    <h3 className="mt-2.5 max-w-[300px] text-[clamp(1.6rem,2.4vw,2rem)] leading-[1.16] font-medium tracking-[-0.01em]">
                      {item.title}
                    </h3>
                  </div>
                  <p className="max-w-[340px] text-[15px] leading-[1.5] md:pt-1">{item.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* The sticky object: a framed viewport onto the live schematic. The
              panel's own dark ground is what makes the canvas's edge read as
              deliberate rather than as a seam. */}
          <div className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-[16vh]">
              {/* Clipped: the globe's anchored chips drift past its own box. */}
              <div className="relative overflow-hidden border border-[#F3F3F3]/12 bg-[#04121f]">
                <CornerPin className="-top-[3px] -left-[3px] z-10" />
                <SwarmGlobe className="lg:max-w-none" />
                <div className="flex items-center justify-between gap-3 border-t border-[#F3F3F3]/12 px-4 py-3">
                  <Eyebrow className="text-[#F3F3F3]/55">
                    {ITEMS[active]?.kicker}
                  </Eyebrow>
                  <span className="ov-micro ov-micro-sm text-[#F3F3F3]/35 tabular-nums">
                    0{active + 1} / 0{ITEMS.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

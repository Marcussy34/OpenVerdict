"use client";

import * as React from "react";
import { useScrollFrame, clamp01, lerp } from "./scroll-driver";
import { GridGuides } from "./primitives";

/**
 * The reference's opening move, seamless edition.
 *
 * The ENTIRE hero is one panel in a sticky 100svh frame on a ~120vh runway.
 * While the runway plays, the section that follows (`reveal`, holding the
 * dark stat card) is pulled up UNDER the frame with a negative margin, so by
 * the end of the runway its card stands exactly at its natural position
 * behind the choreography. Every frame, the hero's clip-path interpolates
 * from full viewport toward the card's LIVE on-screen rect — so the mask
 * lands precisely on the card — and over the last stretch the whole frame
 * (wash included) dissolves, handing off to the real card with no jump.
 *
 * Progress is linear in scroll (stop means stop). Narrow viewports and
 * reduced motion collapse the runway: hero and section render statically.
 */
const RUNWAY_VH = 200; // shrink-handoff plays in the first ~55%, then the
// revealed section HOLDS pinned while its rows arrive — more scroll to finish.
const MASK_PORTION = 0.55;
const LIGHT_TAIL_VH = 120;

export function HeroShrink({
  cardRef,
  entranceRef,
  reveal,
  children,
}: {
  /** The stat card the mask converges on — lives inside `reveal`. */
  cardRef: React.RefObject<HTMLDivElement | null>;
  /** 0→1 entrance progress for the revealed section (−1 = choreography off,
   *  let the section drive its own entrance from viewport position). */
  entranceRef?: React.MutableRefObject<number>;
  /** The section revealed behind the choreography (productivity). */
  reveal: React.ReactNode;
  /** The hero panel. */
  children: React.ReactNode;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const revealRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(false);

  // Client-only decision; SSR and the first paint render the static layout.
  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setActive(wide.matches && !still.matches);
    decide();
    wide.addEventListener("change", decide);
    still.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      still.removeEventListener("change", decide);
    };
  }, []);

  // Hand every style back when the choreography switches off.
  React.useEffect(() => {
    if (active) return;
    for (const el of [panelRef.current, frameRef.current]) {
      if (!el) continue;
      el.style.clipPath = "";
      el.style.opacity = "";
      el.style.visibility = "";
    }
    if (revealRef.current) revealRef.current.style.transform = "";
    if (entranceRef) entranceRef.current = -1;
  }, [active, entranceRef]);

  useScrollFrame(({ scrollY, vh, vw }) => {
    const wrap = wrapRef.current;
    const frame = frameRef.current;
    const panel = panelRef.current;
    if (!wrap || !frame || !panel) return;

    const runway = wrap.offsetHeight - vh;
    if (runway < 1) return;
    const p = clamp01((scrollY - wrap.offsetTop) / runway);
    // The mask + dissolve complete inside the first portion of the runway;
    // the rest is the hold, where the section's own entrances keep playing.
    const m = clamp01(p / MASK_PORTION);

    // Pin the reveal section at its exact final position for the whole
    // runway — the shrink plays out on one static screen and the fade
    // uncovers the section already filling the viewport, no seam above it.
    // (Its header-theme marker only exists in static mode, so pinning at
    // zero cannot flip the header early.)
    const lift = Math.max(0, (1 - p) * runway);
    if (revealRef.current) {
      revealRef.current.style.transform =
        lift > 0.5 ? `translate3d(0, ${-lift.toFixed(1)}px, 0)` : "";
    }

    // Destination: the stat card's live rect (it rides up beneath the frame,
    // reaching its natural place exactly as p hits 1). Fall back to a centred
    // panel if the card is not measurable.
    const c = cardRef.current?.getBoundingClientRect();
    const target =
      c && c.width > 1
        ? {
            top: Math.max(0, c.top),
            left: Math.max(0, c.left),
            right: Math.max(0, vw - c.right),
            bottom: Math.max(0, vh - c.bottom),
          }
        : { top: vh * 0.22, left: vw * 0.3, right: vw * 0.3, bottom: vh * 0.1 };

    panel.style.clipPath = `inset(${lerp(0, target.top, m).toFixed(1)}px ${lerp(0, target.right, m).toFixed(1)}px ${lerp(0, target.bottom, m).toFixed(1)}px ${lerp(0, target.left, m).toFixed(1)}px)`;

    // Entrance clock for the revealed section. Deliberately UNCLAMPED above 1:
    // consumers clamp per element, and values past 1 are the hold phase where
    // the guarantee rows arrive one by one.
    if (entranceRef) entranceRef.current = (p - 0.33) / 0.22;

    // The whole frame — masked hero AND wash — dissolves over the last
    // stretch, revealing the real section (already in position underneath).
    const fade = clamp01((m - 0.72) / 0.24);
    frame.style.opacity = (1 - fade).toFixed(3);
    frame.style.visibility = fade >= 0.995 ? "hidden" : "";
  }, active);

  return (
    <>
      <div
        ref={wrapRef}
        className="relative z-10"
        style={active ? { height: `calc(100svh + ${RUNWAY_VH}vh)` } : undefined}
      >
        {/* Header-theme markers: stacked, never overlapping. */}
        <div
          aria-hidden
          data-header-theme="dark"
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ height: active ? `calc(100% - ${LIGHT_TAIL_VH}vh)` : "100%" }}
        />
        <div
          aria-hidden
          data-header-theme="light"
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{ height: active ? `${LIGHT_TAIL_VH}vh` : "0px" }}
        />

        <div
          ref={frameRef}
          className="pointer-events-none sticky top-0 h-[100svh] overflow-hidden"
        >
          {active && (
            <div aria-hidden className="ov-light-wash absolute inset-0">
              <GridGuides columns={3} className="hidden md:block" />
            </div>
          )}
          <div
            ref={panelRef}
            className="pointer-events-auto relative h-full will-change-[clip-path]"
          >
            {children}
          </div>
        </div>
      </div>

      {/* The next section sits UNDER the frame at its final position for the
          whole runway (counter-translated against the scroll), so the mask
          closes on the card exactly where it will stand when revealed. */}
      <div
        ref={revealRef}
        // In static mode this wrapper is the section's light header marker;
        // while the choreography runs, the wrapper's own stacked markers rule.
        {...(active ? {} : { "data-header-theme": "light" })}
        className="relative will-change-transform"
        style={active ? { marginTop: "-100svh" } : undefined}
      >
        {reveal}
      </div>
    </>
  );
}

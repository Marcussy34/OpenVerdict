"use client";

import * as React from "react";
import { useScrollFrame, clamp01, lerp } from "./scroll-driver";
import { GridGuides } from "./primitives";

/**
 * The reference's opening move, seamless edition.
 *
 * The ENTIRE hero is one panel in a sticky 100svh frame on a runway sized to
 * the choreography itself (see the vh timeline below).
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
// Timeline, written in vh of scroll — tune these, not the fractions below.
// 0 → EXIT: hero type fades and slides out on its own (never cropped).
// 0 → MASK: the background + globe shrink into the card, landing sharp on
//           the card's rect.
// MASK → +FADE: locked in, the visual dissolves into the live metric card.
// then the pinned 3-column content staggers in, on the entrance clock.
const EXIT_VH = 40;
const MASK_VH = 80;
const FADE_VH = 24;
// The PANEL itself ghosts against the (still opaque) wash while shrinking —
// the section behind stays hidden until the frame's own dissolve at landing.
const GHOST_START_VH = 36;
const GHOST_VH = 44;
const GHOST_FLOOR = 0.35;
// One unit of the revealed section's entrance clock, and the clock value at
// which it is finished — the last guarantee row in `productivity.tsx` lands at
// 0.55 + 2 × 0.22 + 0.26. The runway is exactly that long, so the very next
// scroll moves the page on instead of holding a screen that has nothing left
// to play.
const ENTRANCE_VH = 50;
const ENTRANCE_END = 1.25;
const RUNWAY_VH = MASK_VH + ENTRANCE_VH * ENTRANCE_END;

// The same timeline as fractions of the runway, which is what the frame reads.
const EXIT_PORTION = EXIT_VH / RUNWAY_VH;
const MASK_PORTION = MASK_VH / RUNWAY_VH;
const FADE_PORTION = FADE_VH / RUNWAY_VH;
const GHOST_START = GHOST_START_VH / RUNWAY_VH;
const GHOST_LENGTH = GHOST_VH / RUNWAY_VH;
const ENTRANCE_PORTION = ENTRANCE_VH / RUNWAY_VH;
// The header flips to its light chips the moment the dissolve completes and the
// light section owns the screen — not a fixed guess at the end of the runway.
const LIGHT_TAIL_VH = 100 + RUNWAY_VH - (MASK_VH + FADE_VH);

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
  const exitEls = React.useRef<HTMLElement[] | null>(null);
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
    exitEls.current?.forEach((el) => {
      el.style.opacity = "";
      el.style.transform = "";
      el.style.visibility = "";
    });
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
    // The mask completes inside the first portion of the runway; the dissolve
    // follows the landing; the rest is the pinned content and the hold.
    const m = clamp01(p / MASK_PORTION);

    // Hero type exits on its own, ahead of the closing mask — headline and
    // CTAs slide left, the ground row sinks — so text is never cropped.
    if (!exitEls.current) {
      exitEls.current = Array.from(panel.querySelectorAll<HTMLElement>("[data-hero-exit]"));
    }
    const exit = clamp01(p / EXIT_PORTION);
    exitEls.current.forEach((el) => {
      const left = el.dataset.heroExit === "left";
      el.style.opacity = (1 - exit).toFixed(3);
      el.style.transform = left
        ? `translate3d(${(-40 * exit).toFixed(1)}px, 0, 0)`
        : `translate3d(0, ${(16 * exit).toFixed(1)}px, 0)`;
      el.style.visibility = exit >= 0.995 ? "hidden" : "";
    });

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

    // Destination: the stat card's live rect, measured in the PANEL's own
    // rect space — scrollbars, svh quirks and sticky offsets all cancel out,
    // so the mask matches the card silhouette exactly. Fall back to a centred
    // panel if the card is not measurable.
    const pr = panel.getBoundingClientRect();
    const c = cardRef.current?.getBoundingClientRect();
    const target =
      c && c.width > 1
        ? {
            top: Math.max(0, c.top - pr.top),
            left: Math.max(0, c.left - pr.left),
            right: Math.max(0, pr.right - c.right),
            bottom: Math.max(0, pr.bottom - c.bottom),
          }
        : { top: vh * 0.22, left: vw * 0.3, right: vw * 0.3, bottom: vh * 0.1 };

    // Sharp corners the whole way — the system's zero-radius identity.
    panel.style.clipPath = `inset(${lerp(0, target.top, m).toFixed(1)}px ${lerp(0, target.right, m).toFixed(1)}px ${lerp(0, target.bottom, m).toFixed(1)}px ${lerp(0, target.left, m).toFixed(1)}px)`;

    // Entrance clock for the revealed section. Deliberately UNCLAMPED above 1:
    // consumers clamp per element, and the stretch past 1 is where the last
    // guarantee rows arrive, one by one, at the end of the runway.
    if (entranceRef) entranceRef.current = (p - MASK_PORTION) / ENTRANCE_PORTION;

    // The travelling panel thins out over the opaque wash while it shrinks…
    const ghost = clamp01((p - GHOST_START) / GHOST_LENGTH);
    panel.style.opacity = (1 - (1 - GHOST_FLOOR) * ghost).toFixed(3);
    // …and only at the landing does the whole frame (wash included) dissolve,
    // revealing the section that was standing behind it.
    const fade = clamp01((p - MASK_PORTION) / FADE_PORTION);
    frame.style.opacity = (1 - fade).toFixed(3);
    frame.style.visibility = fade >= 0.995 ? "hidden" : "";
  }, active);

  return (
    <>
      <div
        ref={wrapRef}
        className="relative z-10"
        style={active ? { height: `${100 + RUNWAY_VH}vh` } : undefined}
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
          className="pointer-events-none sticky top-0 h-[100svh] overflow-hidden lg:h-screen"
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
        style={active ? { marginTop: "-100vh" } : undefined}
      >
        {reveal}
      </div>
    </>
  );
}

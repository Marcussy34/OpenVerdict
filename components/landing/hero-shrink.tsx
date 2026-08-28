"use client";

import * as React from "react";
import { useScrollFrame, clamp01 } from "./scroll-driver";
import { GridGuides } from "./primitives";

/**
 * The reference's opening move: the ENTIRE hero — globe, headline, buttons,
 * verdict card, background — is one panel that a rectangular mask closes in on
 * as you scroll (content is cropped, never scaled), drifting toward the centre
 * and fading out; the light section then takes the viewport.
 *
 * Mechanics: a runway wrapper adds ~120vh of scroll. Inside it the hero sits
 * in a sticky 100svh frame above a light-wash backdrop. Progress is LINEAR in
 * scroll (no easing — the mask stops the instant the page stops) and writes
 * only clip-path and opacity. On narrow viewports or reduced motion the
 * wrapper collapses and the hero is simply static.
 *
 * Header theming: the wrapper owns two stacked, non-overlapping markers (dark
 * over the panel's travel, light for the tail), so exactly one crosses the
 * header line at a time — same contract as ordinary sections.
 */
const RUNWAY_VH = 120; // extra scroll that drives the mask
const LIGHT_TAIL_VH = 55; // how much of the runway's tail reads as "light" in the header

export function HeroShrink({ children }: { children: React.ReactNode }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
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

  // Reset the panel whenever the choreography switches off.
  React.useEffect(() => {
    if (active) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.clipPath = "";
    panel.style.opacity = "";
    panel.style.visibility = "";
  }, [active]);

  useScrollFrame(({ scrollY, vh }) => {
    const wrap = wrapRef.current;
    const panel = panelRef.current;
    if (!wrap || !panel) return;

    const runway = wrap.offsetHeight - vh;
    if (runway < 1) return;
    const p = clamp01((scrollY - wrap.offsetTop) / runway);

    // The mask closes faster from the top than the bottom, like the reference,
    // ending on a centre panel roughly where the stat card will stand.
    const top = (p * 26).toFixed(2);
    const side = (p * 27).toFixed(2);
    const bottom = (p * 16).toFixed(2);
    panel.style.clipPath = `inset(${top}% ${side}% ${bottom}% ${side}%)`;

    // The panel dissolves over the last quarter of the travel.
    const fade = clamp01((p - 0.74) / 0.22);
    panel.style.opacity = (1 - fade).toFixed(3);
    panel.style.visibility = fade >= 0.995 ? "hidden" : "";
  }, active);

  return (
    <div
      ref={wrapRef}
      className="relative"
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

      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {active && (
          <div aria-hidden className="ov-light-wash absolute inset-0">
            <GridGuides columns={3} className="hidden md:block" />
          </div>
        )}
        <div
          ref={panelRef}
          className="relative h-full will-change-[clip-path,opacity]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

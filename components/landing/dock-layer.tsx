"use client";

import * as React from "react";
import { useScrollFrame, clamp01, lerp, ease } from "./scroll-driver";
import { STAT_CARD_BACKGROUND } from "./productivity";

/**
 * The dock move: the hero's globe scales and clips down INTO the stat card.
 *
 * The layer is viewport-fixed and, every frame, interpolates between two live
 * rects — the hero's visual slot and the card's frame. Because both ends are
 * measured rather than assumed, the visual lands exactly on the card and then
 * keeps tracking it as the card scrolls, with no hard-coded geometry to drift.
 *
 * Only `transform`, `clip-path` and `opacity` are written, all inside the
 * shared rAF loop. The page mounts this only when docking is on (pointer-fine,
 * ≥1024px, motion allowed); otherwise the globe simply sits in the hero.
 */
export function DockLayer({
  heroSlotRef,
  cardSlotRef,
  children,
}: {
  heroSlotRef: React.RefObject<HTMLDivElement | null>;
  cardSlotRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const layerRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const groundRef = React.useRef<HTMLDivElement>(null);
  const size = React.useRef({ w: 0, h: 0 });

  useScrollFrame(({ scrollY, vh }) => {
    const hero = heroSlotRef.current;
    const card = cardSlotRef.current;
    const box = boxRef.current;
    const layer = layerRef.current;
    if (!hero || !card || !box || !layer) return;

    const h = hero.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (h.width < 1 || c.width < 1) return;

    // The box always carries the hero visual's own size; scale does the rest.
    if (size.current.w !== h.width || size.current.h !== h.height) {
      size.current = { w: h.width, h: h.height };
      box.style.width = `${h.width}px`;
      box.style.height = `${h.height}px`;
    }

    // One hero-height of scrolling completes the dock.
    const p = ease(clamp01(scrollY / Math.max(1, vh * 0.92)));
    // Cover, not contain: the visual always fills the card, whatever the
    // card's aspect turns out to be at this viewport.
    const cover = Math.max(c.width / h.width, c.height / h.height);
    const scale = lerp(1, cover, p);
    const targetW = lerp(h.width, c.width, p);
    const targetH = lerp(h.height, c.height, p);
    const left = lerp(h.left, c.left, p);
    const top = lerp(h.top, c.top, p);

    // Uniform scale overshoots on one axis, so the surplus is clipped away —
    // which is also what trims the globe's HUD as it enters the card.
    const clipX = Math.max(0, (scale * h.width - targetW) / 2);
    const clipY = Math.max(0, (scale * h.height - targetH) / 2);

    box.style.transform = `translate3d(${left - clipX}px, ${top - clipY}px, 0) scale(${scale})`;
    box.style.clipPath = `inset(${clipY / scale}px ${clipX / scale}px)`;
    // The card's own surface fades in behind the globe as it travels, so the
    // visual crosses the light section as a solid panel rather than a ghost.
    if (groundRef.current) groundRef.current.style.opacity = String(p);
    // Past a third of the way in, the globe is reading as the card's texture,
    // so its own heads-up display gets out of the card's way.
    box.dataset.hud = p > 0.32 ? "off" : "on";
    layer.style.opacity = "1";

    // The card's chrome crossfades in over the arriving visual.
    const chrome = document.querySelector<HTMLElement>("[data-card-chrome]");
    if (chrome) chrome.style.opacity = String(clamp01((p - 0.45) / 0.45));
  });

  // Hand the card back its own opacity if docking is switched off (resize).
  React.useEffect(
    () => () => {
      const chrome = document.querySelector<HTMLElement>("[data-card-chrome]");
      if (chrome) chrome.style.opacity = "";
    },
    [],
  );

  return (
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
      style={{ opacity: 0 }}
    >
      <div
        ref={boxRef}
        className="absolute top-0 left-0 origin-top-left will-change-transform"
      >
        <div
          ref={groundRef}
          className="absolute inset-0"
          style={{ background: STAT_CARD_BACKGROUND, opacity: 0 }}
        />
        {children}
      </div>
    </div>
  );
}

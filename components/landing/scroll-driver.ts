"use client";

import * as React from "react";

/**
 * One rAF-throttled scroll loop for the whole landing page.
 *
 * Every scroll-driven effect (the dock, the manifesto word reveal, the footer
 * wordmark) subscribes here instead of adding its own listener, so the page
 * reads scroll position once per frame and each effect writes transform and
 * opacity straight to the DOM — no React re-render, no layout thrash.
 */

export type ScrollFrame = { scrollY: number; vh: number; vw: number };
type Handler = (frame: ScrollFrame) => void;

const handlers = new Set<Handler>();
let frameId = 0;
let dirty = true;

function run() {
  frameId = 0;
  if (!dirty) return;
  dirty = false;
  const frame: ScrollFrame = {
    scrollY: window.scrollY,
    vh: window.innerHeight,
    vw: window.innerWidth,
  };
  for (const handler of handlers) handler(frame);
}

function schedule() {
  dirty = true;
  if (frameId) return;
  frameId = requestAnimationFrame(run);
}

/** Runs `fn` on the shared loop. `fn` is re-read from a ref, so it can close
 *  over fresh props without resubscribing every render. */
export function useScrollFrame(fn: Handler, enabled = true) {
  const ref = React.useRef(fn);
  // Declared first so it lands before the subscription effect on every pass.
  React.useEffect(() => {
    ref.current = fn;
  });

  React.useEffect(() => {
    if (!enabled) return;
    const handler: Handler = (frame) => ref.current(frame);
    handlers.add(handler);

    if (handlers.size === 1) {
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
    }
    schedule();

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };
  }, [enabled]);
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smootherstep — the easing the dock and the wordmark ride on. */
export const ease = (t: number) => t * t * (3 - 2 * t);

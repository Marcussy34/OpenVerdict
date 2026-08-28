"use client";

import * as React from "react";
import Lenis from "lenis";
import { useReducedMotion } from "motion/react";

/**
 * Momentum smoothing, landing-page only, destroyed on unmount. Deliberately
 * tighter than the default (0.8s settle) — every effect on this page is a
 * pure function of scrollY, so the glide carries the whole choreography.
 * Reduced motion skips it; `anchors` keeps #submit links working.
 */
export function SmoothScroll() {
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({
      duration: 0.8,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      autoRaf: true,
      anchors: true,
    });
    return () => lenis.destroy();
  }, [reduce]);

  return null;
}

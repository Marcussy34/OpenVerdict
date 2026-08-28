"use client";

import * as React from "react";
import Lenis from "lenis";
import { useReducedMotion } from "motion/react";

/**
 * Momentum smoothing, landing-page only, destroyed on unmount. A long 1.4s
 * expo-out settle — every effect on this page is a pure function of scrollY,
 * so the glide is what carries the whole choreography; a heavier wheel
 * multiplier keeps that glide from feeling slow.
 * Reduced motion skips it; `anchors` keeps #submit links working.
 */
export function SmoothScroll() {
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 1.25,
      autoRaf: true,
      anchors: true,
    });
    return () => lenis.destroy();
  }, [reduce]);

  return null;
}

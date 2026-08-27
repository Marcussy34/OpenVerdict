"use client";

import * as React from "react";
import Lenis from "lenis";
import { useReducedMotion } from "motion/react";

/**
 * Lenis smooth scroll, mounted by the landing page only and destroyed on
 * unmount so every other route keeps native scrolling. Reduced motion skips
 * Lenis entirely; `anchors` keeps in-page links (#submit) working either way.
 */
export function SmoothScroll() {
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      autoRaf: true,
      anchors: true,
    });
    return () => lenis.destroy();
  }, [reduce]);

  return null;
}

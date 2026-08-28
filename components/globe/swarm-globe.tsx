"use client";

/**
 * The hero stage: the WebGL swarm globe, and nothing else.
 *
 * The DOM owns the clock. A single rAF loop advances one resolution cycle
 * (claim → gather → cross-check → seal → settle), commits React state only on
 * transitions, and hands the raw `cycleStart` timestamp to the 3D scene so both
 * halves stay frame-locked without shared mutable state.
 *
 * It carries no heads-up type. The globe is a schematic; the page's own copy
 * does the talking, and labels floating over it read as a different product.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { CYCLE_MS, ORIGIN_COUNT, TRANSCRIPT } from "./network";
import { cn } from "@/lib/utils";

const SwarmScene = dynamic(() => import("./swarm-scene"), { ssr: false });

export function SwarmGlobe({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const stageRef = React.useRef<HTMLDivElement>(null);
  // The cycle clock lives in a ref so the DOM and the WebGL scene read the
  // exact same timestamp without a state round-trip on every frame.
  const clock = React.useRef({ start: 0 });

  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [cycle, setCycle] = React.useState(0);
  const [liveLine, setLine] = React.useState(-1);

  // Reduced motion parks the cycle mid-deliberation, where the network reads as
  // busiest. Gated on `mounted` so the server render and the first client
  // render stay identical — `useReducedMotion()` is null on the server.
  const line = reduce && mounted ? 8 : liveLine;

  // Mount WebGL only once the stage is actually on screen, and stop rendering
  // frames whenever it scrolls away.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting) setMounted(true);
      },
      { rootMargin: "160px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One rAF clock drives the cycle; state only changes on a transition. The
  // transcript's timings survive the HUD's removal because they are what give
  // the spotlight its rhythm across the swarm.
  React.useEffect(() => {
    if (reduce || !visible || !mounted) return;
    let raf = 0;
    clock.current.start = performance.now();

    const tick = () => {
      const t = performance.now() - clock.current.start;
      if (t >= CYCLE_MS) {
        clock.current.start = performance.now();
        setCycle((c) => c + 1);
        setLine(-1);
      } else {
        let next = -1;
        for (let i = TRANSCRIPT.length - 1; i >= 0; i--) {
          const entry = TRANSCRIPT[i];
          if (entry && t >= entry.at) {
            next = i;
            break;
          }
        }
        setLine((prev) => (prev === next ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, visible, mounted]);

  const originIndex = cycle % ORIGIN_COUNT;
  const spotlightIndex = (cycle * 2 + Math.max(0, line)) % 7;

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative isolate aspect-square w-full max-w-full min-w-0 select-none lg:max-w-[640px]",
        className,
      )}
    >
      {/* Poster plate: fills the frame before WebGL boots and if it never does. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 grid place-items-center overflow-hidden transition-opacity duration-700",
          mounted && !reduce && "opacity-0",
        )}
      >
        <div className="ov-globe-plate size-[74%] rounded-full" />
      </div>

      {mounted && (
        <SwarmScene
          clock={clock}
          originIndex={originIndex}
          spotlightIndex={spotlightIndex}
          paused={!visible}
          reduced={reduce}
        />
      )}
    </div>
  );
}

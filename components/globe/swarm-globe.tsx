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
import type { GlobeDrag } from "./swarm-scene";
import { cn } from "@/lib/utils";

const SwarmScene = dynamic(() => import("./swarm-scene"), { ssr: false });

/** Radians of rotation per pixel dragged, near enough equal on both axes. */
const YAW_PER_PX = 0.007;
const PITCH_PER_PX = 0.0065;
/** How far the globe can be tipped by hand, either way (~57°). */
const PITCH_LIMIT = 1;

export function SwarmGlobe({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const stageRef = React.useRef<HTMLDivElement>(null);
  // The cycle clock lives in a ref so the DOM and the WebGL scene read the
  // exact same timestamp without a state round-trip on every frame.
  const clock = React.useRef({ start: 0 });

  // Hand-spin: the pointer writes here, the scene consumes it each frame.
  const drag = React.useRef<GlobeDrag>({ active: false, yaw: 0, vx: 0, pitch: 0 });
  const from = React.useRef({ x: 0, y: 0 });

  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [cycle, setCycle] = React.useState(0);
  const [liveLine, setLine] = React.useState(-1);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || e.button !== 0) return;
    // Capture keeps the spin following a pointer that leaves the globe; a
    // browser that refuses the capture still drags, just not past the edge.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    drag.current.active = true;
    drag.current.vx = 0;
    from.current = { x: e.clientX, y: e.clientY };
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = (e.clientX - from.current.x) * YAW_PER_PX;
    const dy = (e.clientY - from.current.y) * PITCH_PER_PX;
    from.current = { x: e.clientX, y: e.clientY };
    d.yaw += dx;
    // Smoothed, so the throw at release follows the hand rather than the last
    // single event, which can be a stutter.
    d.vx = dx * 0.65 + d.vx * 0.35;
    d.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, d.pitch + dy));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Reduced motion parks the cycle mid-deliberation, where the network reads as
  // busiest. Gated on `mounted` so the server render and the first client
  // render stay identical — `useReducedMotion()` is null on the server.
  const line = reduce && mounted ? 8 : liveLine;

  // Mount WebGL as soon as the stage is on screen, and stop rendering frames
  // whenever it scrolls away. The margin buys a screen of warning so the
  // resume happens before the globe is actually looked at.
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
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // …but do not wait for the scroll to boot. A globe further down the page
  // would otherwise create its context and compile its shaders exactly as it
  // arrives, which is the pause you see. Idle time after first paint is free,
  // and `paused` keeps it at zero frames until it is actually on screen.
  React.useEffect(() => {
    if (mounted) return;
    const idle = typeof window.requestIdleCallback === "function";
    const warm = () => setMounted(true);
    const id = idle
      ? window.requestIdleCallback(warm, { timeout: 2500 })
      : window.setTimeout(warm, 1200);
    return () => {
      if (idle) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, [mounted]);

  // One rAF clock drives the cycle; state only changes on a transition. The
  // transcript's timings survive the HUD's removal because they are what give
  // the spotlight its rhythm across the swarm.
  React.useEffect(() => {
    if (reduce || !visible || !mounted) return;
    let raf = 0;
    clock.current.start = performance.now();

    const tick = () => {
      // Let go and the globe coasts: the throw decays here, on the same clock
      // the cycle runs on, so the scene only ever reads the total.
      const d = drag.current;
      if (!d.active && d.vx !== 0) {
        d.yaw += d.vx;
        d.vx *= 0.94;
        if (Math.abs(d.vx) < 1e-4) d.vx = 0;
      }

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
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // `pan-y` keeps a vertical swipe scrolling the page on touch; a
      // horizontal drag spins the globe.
      style={{ touchAction: "pan-y" }}
      className={cn(
        "relative isolate aspect-square w-full max-w-full min-w-0 select-none lg:max-w-[640px]",
        !reduce && "pointer-events-auto cursor-grab active:cursor-grabbing",
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
          drag={drag}
          originIndex={originIndex}
          spotlightIndex={spotlightIndex}
          paused={!visible}
          reduced={reduce}
        />
      )}
    </div>
  );
}

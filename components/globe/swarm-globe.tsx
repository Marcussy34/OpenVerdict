"use client";

/**
 * The hero stage: the WebGL swarm globe plus the heads-up display that
 * narrates what it is doing.
 *
 * The DOM owns the clock. A single rAF loop advances one resolution cycle
 * (claim → gather → cross-check → seal → settle), commits React state only
 * when the phase or transcript line actually changes — roughly a dozen renders
 * per 17-second cycle — and hands the raw `cycleStart` timestamp to the 3D
 * scene so both halves stay frame-locked without shared mutable state.
 *
 * The globe is an honest schematic of the protocol. The claim text and Truth
 * Score in the HUD are real rows from the read-only API when it is reachable,
 * which is why the corner tag says so.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CYCLE_MS,
  FALLBACK_CLAIMS,
  ORIGIN_COUNT,
  PHASES,
  TRANSCRIPT,
  phaseIndexAt,
  shortModel,
} from "./network";
import type { AnchorId } from "./swarm-scene";
import { cn } from "@/lib/utils";
import { Cpu, Global, Lock, ShieldTick, TickCircle } from "@/components/icons";

const SwarmScene = dynamic(() => import("./swarm-scene"), { ssr: false });

/** A claim the HUD can narrate — mapped from the read-only claims feed. */
export type SwarmClaim = {
  id: string;
  statement: string;
  score: number | null;
  /** Settled outcome — YES / NO / UNSURE / UNRESOLVED, or null while pending. */
  label: string | null;
};

/** A juror the HUD can name — mapped from the read-only agent registry. */
export type SwarmAgent = { role: string; model: string };

const DEFAULT_AGENT: SwarmAgent = {
  role: "ANALYST",
  model: "deepseek-ai/DeepSeek-V4-Flash",
};

const DEFAULT_AGENTS: SwarmAgent[] = [
  DEFAULT_AGENT,
  { role: "SKEPTIC", model: "moonshotai/Kimi-K2.6" },
  { role: "SOURCE_AUTHENTICITY", model: "MiniMaxAI/MiniMax-M2.7" },
];

const TONE_TEXT: Record<string, string> = {
  neutral: "text-[#9fd0f5]",
  sealed: "text-[#b9aaff]",
  yes: "text-[#7ee8b0]",
  warn: "text-[#ffcd70]",
};

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function SwarmGlobe({
  claims = [],
  agents = [],
  className,
}: {
  claims?: SwarmClaim[];
  agents?: SwarmAgent[];
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const stageRef = React.useRef<HTMLDivElement>(null);
  const originAnchor = React.useRef<HTMLDivElement>(null);
  const agentAnchor = React.useRef<HTMLDivElement>(null);
  // The cycle clock lives in a ref so the DOM and the WebGL scene read the
  // exact same timestamp without a state round-trip on every frame.
  const clock = React.useRef({ start: 0 });

  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [cycle, setCycle] = React.useState(0);
  const [livePhase, setPhase] = React.useState(0);
  const [liveLine, setLine] = React.useState(-1);

  // Reduced motion parks the narration mid-deliberation, where the network
  // reads as busiest. Gated on `mounted` so the server render and the first
  // client render stay identical — `useReducedMotion()` is null on the server.
  const still = reduce && mounted;
  const phase = still ? 3 : livePhase;
  const line = still ? 8 : liveLine;

  /** Pins a HUD chip to its point on the globe, straight to the DOM node.
   *  X is clamped so a chip anchored near the limb never clips the slab. */
  const handleAnchor = React.useCallback(
    (id: AnchorId, x: number, y: number, opacity: number) => {
      const el = id === "origin" ? originAnchor.current : agentAnchor.current;
      if (!el) return;
      const width = stageRef.current?.clientWidth ?? 0;
      const gutter = Math.min(118, width / 2);
      const cx = Math.min(Math.max(x, gutter), Math.max(gutter, width - gutter));
      el.style.transform = `translate3d(${cx.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity < 0.02 ? "hidden" : "visible";
    },
    [],
  );

  // Mount WebGL only once the hero is actually on screen, and stop rendering
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

  // One rAF clock drives phase + transcript; state only changes on transitions.
  React.useEffect(() => {
    if (reduce || !visible || !mounted) return;
    let raf = 0;
    clock.current.start = performance.now();

    const tick = () => {
      const t = performance.now() - clock.current.start;
      if (t >= CYCLE_MS) {
        clock.current.start = performance.now();
        setCycle((c) => c + 1);
        setPhase(0);
        setLine(-1);
      } else {
        const p = phaseIndexAt(t);
        setPhase((prev) => (prev === p ? prev : p));
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
  const roster = agents.length ? agents : DEFAULT_AGENTS;
  const spotlightIndex = (cycle * 2 + Math.max(0, line)) % 7;
  const spotlight = roster[(cycle + Math.max(0, line)) % roster.length] ?? DEFAULT_AGENT;

  const claim: SwarmClaim = claims[cycle % Math.max(1, claims.length)] ?? {
    id: "",
    statement: FALLBACK_CLAIMS[cycle % FALLBACK_CLAIMS.length] ?? "",
    score: null,
    label: null,
  };

  const visibleLines = React.useMemo(
    () => (line < 0 ? [] : TRANSCRIPT.slice(Math.max(0, line - 2), line + 1)),
    [line],
  );

  const settled = PHASES[phase]?.id === "verdict";
  /** Did the REAL claim behind this cycle actually mint a certificate? */
  const certified = claim.score !== null;

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
          onAnchor={handleAnchor}
        />
      )}

      {/* No scrims: they read as a rectangle around the globe on the v3
          ground. HUD type relies on its text-shadow instead. */}

      {/* ------------------------------------------------------- phase rail */}
      <div className="ov-hud-layer pointer-events-none absolute inset-x-0 top-0 p-2 [text-shadow:0_1px_8px_rgba(3,12,20,0.95)] sm:p-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/12 bg-white/6 px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.14em] text-white/55 uppercase backdrop-blur-sm">
            <Global size="11" variant="Bold" className="text-[#4da2ff]" />
            Network schematic
          </span>
          {/* Horizontal rail: the cycle reads left to right and leaves the
              whole left flank free for chips anchored on the globe. */}
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {PHASES.map((p, i) => {
              const active = i === phase;
              const done = i < phase;
              return (
                <li key={p.id} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "h-px w-3 transition-colors duration-500",
                        done || active ? "bg-white/35" : "bg-white/12",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative grid size-2 shrink-0 place-items-center rounded-full transition-colors duration-500",
                      active ? "bg-[#4da2ff]" : done ? "bg-white/40" : "bg-white/15",
                    )}
                  >
                    {active && mounted && !reduce && (
                      <span className="ov-ping absolute inset-0 rounded-full bg-[#4da2ff]" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[9.5px] tracking-[0.1em] uppercase transition-colors duration-500",
                      active ? "text-white" : done ? "text-white/45" : "text-white/25",
                    )}
                  >
                    {p.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Verdict stamp — lands with the certificate at the end of the cycle. */}
      <div className="ov-hud-layer pointer-events-none absolute right-2 bottom-2 w-[9.5rem] sm:right-3 sm:bottom-3">
        <AnimatePresence>
          {settled && (
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 1.35, rotate: -9 }}
              animate={{ opacity: 1, scale: 1, rotate: -3 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className={cn(
                "ov-hud-chip",
                certified
                  ? "border-[#7ee8b0]/35 bg-[#7ee8b0]/10"
                  : "border-[#8fdcff]/30 bg-[#8fdcff]/8",
              )}
            >
              {/* The cycle always completes; the numbers underneath are the
                  real claim's, so the label states what actually happened. */}
              <span
                className={cn(
                  "flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.16em] uppercase",
                  certified ? "text-[#7ee8b0]" : "text-[#8fdcff]",
                )}
              >
                <ShieldTick size="11" variant="Bold" />
                {certified ? "Settled on Sui" : "Not yet settled"}
              </span>
              <p className="mt-1 font-mono text-lg leading-none font-semibold text-white tabular-nums">
                {claim.score ?? "——"}
                {certified && <span className="text-[11px] text-white/45">/100</span>}
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.1em] text-white/45 uppercase">
                {certified
                  ? `${claim.label ?? "Truth Score"} · certificate`
                  : (claim.label ?? "Awaiting jury")}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* -------------------------------------------------- swarm transcript */}
      <div className="ov-hud-layer pointer-events-none absolute inset-x-0 bottom-0 p-2 pr-2 [text-shadow:0_1px_8px_rgba(3,12,20,0.95)] sm:p-3 sm:pr-44">
        <div className="flex items-center gap-2 font-mono text-[9px] font-semibold tracking-[0.14em] text-white/35 uppercase">
          {settled ? (
            <TickCircle size="11" variant="Bold" className="text-[#7ee8b0]" />
          ) : (
            <Lock size="11" variant="Bold" className="text-white/40" />
          )}
          {PHASES[phase]?.detail}
        </div>
        <div className="mt-1.5 hidden h-[4.6rem] flex-col justify-end gap-1 sm:flex">
          <AnimatePresence initial={false}>
            {visibleLines.map((entry, i) => (
              <motion.p
                key={`${cycle}-${entry.at}`}
                initial={reduce ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: i === visibleLines.length - 1 ? 1 : 0.42 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="truncate font-mono text-[10.5px] leading-tight"
              >
                <span className={cn("font-semibold", TONE_TEXT[entry.tone])}>{entry.role}</span>
                <span className="text-white/28"> · </span>
                <span className="text-white/70">{entry.text}</span>
              </motion.p>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* ---------------------------------------------------------- anchors */}
      {/* Rendered last so a chip that drifts under the rail paints over it. */}
      <div
        ref={originAnchor}
        className="ov-hud-layer pointer-events-none absolute top-0 left-0 hidden will-change-transform sm:block"
        style={{ visibility: "hidden" }}
      >
        <div className="-translate-x-1/2 -translate-y-full">
          <div className="ov-hud-chip w-[13rem]">
            <span className="flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.16em] text-[#ffd479] uppercase">
              <span className="size-1.5 rounded-full bg-[#ffd479]" />
              Claim ingested
            </span>
            <p className="mt-1 text-[10.5px] leading-snug text-white/80">
              {truncate(claim.statement, 62)}
            </p>
          </div>
          <span className="ov-hud-stem" />
        </div>
      </div>

      {/* The juror spotlight stands down once the certificate stamps, so the
          two chips can never share the bottom-right corner. */}
      {!settled && (
        <div
          ref={agentAnchor}
          className="ov-hud-layer pointer-events-none absolute top-0 left-0 hidden will-change-transform lg:block"
          style={{ visibility: "hidden" }}
        >
          {/* Hangs BELOW its node so it can never collide with the claim chip. */}
          <div className="-translate-x-1/2">
            <span className="ov-hud-stem rotate-180" />
            <div className="ov-hud-chip">
              <span className="flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.16em] text-[#8fdcff] uppercase">
                <Cpu size="11" variant="Bold" />
                {spotlight.role.replace(/_/g, " ")}
              </span>
              <p className="mt-1 font-mono text-[11px] whitespace-nowrap text-white/75">
                {shortModel(spotlight.model)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DocumentText, Cpu, Lock, Unlock, Activity, ShieldTick } from "@/components/icons";

interface PhaseRailProps {
  /** Either an engine phase label ("COMMIT_1") or an on-chain claim state number. */
  currentPhase: number | string;
  className?: string;
}

const PHASES = [
  {
    id: 1,
    name: "Evidence freeze",
    desc: "Walrus source capture",
    icon: DocumentText,
  },
  { id: 2, name: "Independent run", desc: "GonkaRouter 5× jury", icon: Cpu },
  { id: 3, name: "Sealed commit", desc: "Blake2b-256 on Sui", icon: Lock },
  { id: 4, name: "Cryptographic reveal", desc: "Preimage opening", icon: Unlock },
  { id: 5, name: "Discussion (if split)", desc: "Round 2 consensus", icon: Activity },
  { id: 6, name: "Finalize & settle", desc: "Certificate & payout", icon: ShieldTick },
] as const;

/** Map an engine phase label or claim state to one of the six rail positions. */
export function phaseIndexOf(currentPhase: number | string): number {
  if (typeof currentPhase === "number") {
    if (currentPhase <= 3) return 1;
    if (currentPhase === 4) return 3;
    if (currentPhase === 5) return 4;
    if (currentPhase === 6 || currentPhase === 7 || currentPhase === 8) return 5;
    if (currentPhase >= 9) return 6;
    return 1;
  }

  const upper = currentPhase.toUpperCase();
  if (upper.includes("FINAL") || upper.includes("SETTLE")) return 6;
  if (upper.includes("DISCUSSION") || upper.includes("DEBATE")) return 5;
  if (upper.includes("REVEAL")) return 4;
  if (upper.includes("COMMIT")) return 3;
  if (upper.includes("INFERENCE") || upper.includes("JURY") || upper.includes("RUN")) return 2;
  return 1;
}

/**
 * The six-phase resolution rail as a connected stepper: a track whose filled
 * portion tracks progress, an active node that breathes, and completed nodes in
 * verdict green. This is the observer's "where are we" instrument.
 */
export function PhaseRail({ currentPhase, className = "" }: PhaseRailProps) {
  const reduce = useReducedMotion();
  const activeIndex = phaseIndexOf(currentPhase);
  const active = PHASES[activeIndex - 1] ?? PHASES[0];
  const fill = ((activeIndex - 1) / (PHASES.length - 1)) * 100;

  return (
    <section
      className={cn(
        "ov-edge relative overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
      role="region"
      aria-label="Resolution phase progress"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-sea via-sea/25 to-transparent"
      />

      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Phase progression
        </h2>
        <span className="rounded-full border border-sea/30 bg-sea/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-primary uppercase">
          Phase {activeIndex} of {PHASES.length} · {active.name}
        </span>
      </header>

      <div className="sr-only" aria-live="polite">
        Current resolution phase is {active.name}: {active.desc}
      </div>

      <div className="relative px-4 py-5 sm:px-5">
        {/* Connector track, drawn only where the six nodes sit in one row. */}
        <div
          aria-hidden
          className="absolute top-[52px] right-[calc(8.33%+1.25rem)] left-[calc(8.33%+1.25rem)] hidden h-0.5 rounded-full bg-border lg:block"
        />
        <motion.div
          aria-hidden
          className="absolute top-[52px] left-[calc(8.33%+1.25rem)] hidden h-0.5 origin-left rounded-full bg-gradient-to-r from-yes to-sea lg:block"
          style={{ maxWidth: "calc(83.34% - 2.5rem)" }}
          initial={{ width: 0 }}
          animate={{ width: `calc((83.34% - 2.5rem) * ${fill / 100})` }}
          transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
        />

        <ol className="relative grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {PHASES.map((phase) => {
            const Icon = phase.icon;
            const done = phase.id < activeIndex;
            const current = phase.id === activeIndex;

            return (
              <li key={phase.id} className="flex flex-col items-center text-center">
                <span
                  className={cn(
                    "relative grid size-11 place-items-center rounded-full border-2 bg-card transition-colors",
                    done
                      ? "border-yes/50 bg-yes/10 text-yes"
                      : current
                        ? "border-sea bg-sea/12 text-primary"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {current && (
                    <span
                      aria-hidden
                      className="ov-ping absolute inset-0 rounded-full bg-sea/40"
                    />
                  )}
                  <Icon size="18" variant="Bold" className="relative" />
                </span>

                <span
                  className={cn(
                    "mt-2 rounded px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.1em] uppercase",
                    done
                      ? "bg-yes/10 text-yes"
                      : current
                        ? "bg-sea/12 text-primary"
                        : "bg-surface text-muted-foreground",
                  )}
                >
                  {done ? "Done" : current ? "Active" : "Wait"}
                </span>

                <h3
                  className={cn(
                    "mt-1.5 text-xs leading-tight font-semibold",
                    current ? "text-ocean" : "text-foreground/80",
                  )}
                >
                  {phase.id}. {phase.name}
                </h3>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {phase.desc}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

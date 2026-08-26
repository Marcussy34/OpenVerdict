"use client";

import { DocumentText, Cpu, Lock, Unlock, Activity, ShieldTick } from "iconsax-react";

interface PhaseRailProps {
  currentPhase: number | string;
  className?: string;
}

const PHASES = [
  { id: 1, key: "EVIDENCE", name: "1. Evidence Freeze", icon: DocumentText, desc: "Walrus source capture" },
  { id: 2, key: "INDEPENDENT", name: "2. Independent Run", icon: Cpu, desc: "GonkaRouter 5x jury" },
  { id: 3, key: "COMMIT", name: "3. Sealed Commit", icon: Lock, desc: "Blake2b-256 on Sui" },
  { id: 4, key: "REVEAL", name: "4. Cryptographic Reveal", icon: Unlock, desc: "Preimage opening" },
  { id: 5, key: "DEBATE", name: "5. Discussion (if split)", icon: Activity, desc: "Round 2 consensus" },
  { id: 6, key: "SETTLE", name: "6. Finalize & Settle", icon: ShieldTick, desc: "Certificate & payout" },
];

export function PhaseRail({ currentPhase, className = "" }: PhaseRailProps) {
  // Normalize currentPhase to a phase index 1..6
  let activeIndex = 1;
  if (typeof currentPhase === "number") {
    if (currentPhase <= 3) activeIndex = 1;
    else if (currentPhase === 4) activeIndex = 3;
    else if (currentPhase === 5) activeIndex = 4;
    else if (currentPhase === 6) activeIndex = 5;
    else if (currentPhase >= 7 && currentPhase <= 8) activeIndex = 5;
    else if (currentPhase >= 9) activeIndex = 6;
  } else if (typeof currentPhase === "string") {
    const upper = currentPhase.toUpperCase();
    if (upper.includes("EVIDENCE")) activeIndex = 1;
    else if (upper.includes("INFERENCE") || upper.includes("JURY")) activeIndex = 2;
    else if (upper.includes("COMMIT")) activeIndex = 3;
    else if (upper.includes("REVEAL")) activeIndex = 4;
    else if (upper.includes("DISCUSSION") || upper.includes("DEBATE")) activeIndex = 5;
    else if (upper.includes("FINAL") || upper.includes("SETTLE")) activeIndex = 6;
  }

  const activePhaseObj = PHASES[activeIndex - 1] ?? PHASES[0];
  const safePhaseObj = activePhaseObj || {
    id: 1,
    key: "EVIDENCE",
    name: "1. Evidence Freeze",
    icon: DocumentText,
    desc: "Walrus source capture",
  };

  return (
    <div
      className={`rounded-xl border border-border/80 bg-card p-4 shadow-xs space-y-3 ${className}`}
      role="region"
      aria-label="Resolution Phase Progress"
    >
      {/* Live announcement region for screen readers */}
      <div className="sr-only" aria-live="polite">
        Current resolution phase is {safePhaseObj.name}: {safePhaseObj.desc}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Phase Progression
        </span>
        <span className="text-xs font-mono font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          Phase {activeIndex} of {PHASES.length}: {safePhaseObj.name}
        </span>
      </div>

      {/* Responsive Horizontal Phase Rail */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
        {PHASES.map((phase) => {
          const Icon = phase.icon;
          const isDone = phase.id < activeIndex;
          const isCurrent = phase.id === activeIndex;

          return (
            <div
              key={phase.id}
              className={`flex flex-col justify-between p-3 rounded-lg border text-left transition-all ${
                isCurrent
                  ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                  : isDone
                    ? "border-emerald-500/40 bg-emerald-500/5 text-muted-foreground"
                    : "border-border/60 bg-muted/40 opacity-70"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-md ${
                    isCurrent
                      ? "bg-primary text-primary-foreground font-bold animate-pulse"
                      : isDone
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon size="15" variant="Bold" />
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    isDone
                      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                      : isCurrent
                        ? "text-primary bg-primary/15"
                        : "text-muted-foreground bg-muted"
                  }`}
                >
                  {isDone ? "Done" : isCurrent ? "Active" : "Wait"}
                </span>
              </div>

              <div>
                <h4
                  className={`text-xs font-semibold leading-tight ${
                    isCurrent ? "text-foreground font-bold" : "text-foreground/90"
                  }`}
                >
                  {phase.name}
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  {phase.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { DocumentText, Cpu, Lock, Unlock, ShieldTick,
  type IconComponent,
} from "@/components/icons";
import { cn } from "@/lib/utils";

type Stage = {
  index: string;
  kicker: string;
  title: string;
  body: string;
  icon: IconComponent;
  tone: "chain" | "primary" | "sealed" | "yes";
};

/** The 5 protocol stages, in the order the engine executes them. */
export const PIPELINE_STAGES: Stage[] = [
  {
    index: "01",
    kicker: "Retrieval",
    title: "Evidence freeze",
    body: "URLs and pasted text, fetched by SSRF-safe crawlers and frozen into a Walrus Merkle root.",
    icon: DocumentText,
    tone: "chain",
  },
  {
    index: "02",
    kicker: "Inference",
    title: "Five-model jury",
    body: "Five seats across ≥3 model families (DeepSeek, Kimi, MiniMax) review the frozen bundle independently via GonkaRouter.",
    icon: Cpu,
    tone: "primary",
  },
  {
    index: "03",
    kicker: "Sealing",
    title: "Blake2b-256 commit",
    body: "Each juror seals its vote on-chain — unreadable, so nothing can be copied or front-run.",
    icon: Lock,
    tone: "sealed",
  },
  {
    index: "04",
    kicker: "Transparency",
    title: "Cryptographic reveal",
    body: "Votes, confidences and reasoning traces open on Sui, verified byte-for-byte against the seal.",
    icon: Unlock,
    tone: "chain",
  },
  {
    index: "05",
    kicker: "Finality",
    title: "Settle on-chain",
    body: "A 4-of-5 supermajority mints the certificate with its Truth Score and releases the payout.",
    icon: ShieldTick,
    tone: "yes",
  },
];

const TONE_PLATE: Record<Stage["tone"], string> = {
  chain: "bg-chain/10 text-chain ring-chain/20",
  primary: "bg-sea/12 text-primary ring-sea/25",
  sealed: "bg-sealed/10 text-sealed ring-sealed/20",
  yes: "bg-yes/10 text-yes ring-yes/20",
};

/**
 * The protocol pipeline as a real diagram: numbered stage cards joined by a
 * dashed connector with marching-ants flow, so the reader sees a machine rather
 * than five paragraphs. Collapses to a vertical spine on small screens.
 */
export function Pipeline({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("relative", className)}>
      {/* Horizontal connector rail behind the cards (lg and up). */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[42px] hidden h-px w-full lg:block"
        preserveAspectRatio="none"
        viewBox="0 0 100 1"
      >
        <line
          x1="6"
          y1="0.5"
          x2="94"
          y2="0.5"
          stroke="var(--brand-sea)"
          strokeOpacity="0.45"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          // The dash pattern is static; only its march is dropped, by the
          // prefers-reduced-motion block in globals.css.
          className="ov-flow"
        />
      </svg>

      <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {PIPELINE_STAGES.map((stage, i) => {
          const Icon = stage.icon;
          return (
            <motion.li
              key={stage.index}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "0px 0px 20% 0px" }}
              transition={{
                duration: reduce ? 0 : 0.5,
                delay: reduce ? 0 : i * 0.07,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="ov-edge ov-lift relative flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl ring-1",
                    TONE_PLATE[stage.tone],
                  )}
                >
                  <Icon size="20" variant="Bold" />
                </span>
                <span className="font-mono text-2xl font-semibold text-ocean/12 tabular-nums">
                  {stage.index}
                </span>
              </div>

              <div className="space-y-1">
                <span className="block font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {stage.kicker}
                </span>
                <h3 className="text-sm font-semibold text-ocean">{stage.title}</h3>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">{stage.body}</p>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

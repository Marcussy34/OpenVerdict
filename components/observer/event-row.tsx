"use client";

import { motion, useReducedMotion } from "motion/react";
import { TimeDisplay } from "@/components/time-display";
import { HashChip } from "@/components/viz/hash-chip";
import { cn } from "@/lib/utils";
import type { ResolutionEvent, ResolutionEventSource } from "@/lib/engine/contract";
import { Cpu, Activity, Hierarchy, DocumentText, Link21, Lock, TickCircle } from "@/components/icons";

interface EventRowProps {
  event: ResolutionEvent;
  /** Newly-streamed rows slide in; backfilled rows render at rest. */
  animate?: boolean;
}

interface SourceConfig {
  label: string;
  chip: string;
  spine: string;
  icon: typeof Cpu;
}

// Subsystems are not verdicts, so none of them owns a hue: every chip is a
// hairline ink chip and the icon plus the label says which subsystem spoke. The
// one exception is SUI, which keeps the accent because settling on chain is the
// thing the accent means everywhere else (owner, 2026-09-04). GONKA used to
// wear the Kimi purple, which belongs to a model logo tile and nothing else.
const SOURCES: Record<ResolutionEventSource, SourceConfig> = {
  ENGINE: {
    label: "ENGINE",
    chip: "border-sealed/30 bg-sealed/8 text-sealed",
    spine: "bg-sealed",
    icon: Cpu,
  },
  GONKA_ROUTER: {
    label: "GONKA",
    chip: "border-border bg-surface text-muted-foreground",
    spine: "bg-muted-foreground",
    icon: Activity,
  },
  TOOL: {
    label: "TOOL",
    chip: "border-border bg-surface text-muted-foreground",
    spine: "bg-border",
    icon: Hierarchy,
  },
  EVIDENCE: {
    label: "EVIDENCE",
    chip: "border-sealed/30 bg-sealed/8 text-sealed",
    spine: "bg-sealed",
    icon: DocumentText,
  },
  SUI: {
    label: "SUI",
    chip: "border-chain/30 bg-chain/8 text-chain",
    spine: "bg-chain",
    icon: Link21,
  },
};

export function getSourceConfig(source: ResolutionEventSource): SourceConfig {
  return (
    SOURCES[source] ?? {
      label: String(source),
      chip: "border-border bg-surface text-muted-foreground",
      spine: "bg-border",
      icon: Activity,
    }
  );
}

/**
 * One row of the live resolution stream. A spine marks the emitting subsystem
 * so a fast-scrolling log is still readable at a glance; it differs by weight
 * of ink rather than by hue, and only the chain rows carry the accent.
 */
export function EventRow({ event, animate = false }: EventRowProps) {
  const reduce = useReducedMotion();
  const source = getSourceConfig(event.source);
  const SourceIcon = source.icon;
  const isRedacted = event.visibility === "INTERNAL_REDACTED";

  return (
    <motion.li
      initial={animate && !reduce ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card py-2.5 pr-3 pl-4 transition-colors hover:border-sea/40 sm:flex-row sm:items-center sm:justify-between"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", source.spine)} />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground tabular-nums">
          #{event.sequence}
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em]",
            source.chip,
          )}
        >
          <SourceIcon size="11" variant="Bold" />
          {source.label}
        </span>

        <span className="font-mono text-xs font-semibold text-ocean">{event.kind}</span>

        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {event.phase}
        </span>

        {isRedacted ? (
          <span className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            <Lock size="10" variant="Bold" />
            REDACTED
          </span>
        ) : (
          // Visibility is a state, not an outcome, so it is ink like REDACTED.
          <span className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            <TickCircle size="10" variant="Bold" />
            PUBLIC
          </span>
        )}

        {event.actorId && (
          <HashChip value={event.actorId} label="seat agent" kind="object" tone="muted" />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {event.artifactHash && (
          <HashChip value={event.artifactHash} label="artifact" kind="hash" tone="muted" />
        )}
        {event.transactionDigest && (
          <HashChip
            value={event.transactionDigest}
            label="tx"
            kind="tx"
            tone="chain"
            head={8}
            tail={4}
          />
        )}
        <TimeDisplay isoString={event.occurredAt} showLocal={false} />
      </div>
    </motion.li>
  );
}

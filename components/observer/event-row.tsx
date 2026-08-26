"use client";

import { Badge } from "@/components/ui/badge";
import { TimeDisplay } from "@/components/time-display";
import type { ResolutionEvent, ResolutionEventSource } from "@/lib/engine/contract";
import {
  Cpu,
  Activity,
  Hierarchy,
  DocumentText,
  Link21,
  Lock,
  TickCircle,
} from "iconsax-react";

interface EventRowProps {
  event: ResolutionEvent;
}

interface SourceConfig {
  label: string;
  badgeClass: string;
  icon: typeof Cpu;
}

export function getSourceConfig(source: ResolutionEventSource): SourceConfig {
  switch (source) {
    case "ENGINE":
      return {
        label: "ENGINE",
        badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
        icon: Cpu,
      };
    case "GONKA_ROUTER":
      return {
        label: "GONKA_ROUTER",
        badgeClass: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        icon: Activity,
      };
    case "TOOL":
      return {
        label: "TOOL",
        badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        icon: Hierarchy,
      };
    case "EVIDENCE":
      return {
        label: "EVIDENCE",
        badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        icon: DocumentText,
      };
    case "SUI":
      return {
        label: "SUI",
        badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
        icon: Link21,
      };
    default:
      return {
        label: source,
        badgeClass: "border-border bg-muted text-muted-foreground",
        icon: Activity,
      };
  }
}

export function EventRow({ event }: EventRowProps) {
  const sourceConfig = getSourceConfig(event.source);
  const SourceIcon = sourceConfig.icon;

  const isRedacted = event.visibility === "INTERNAL_REDACTED";

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 rounded-lg border border-border/70 bg-card hover:bg-accent/30 transition-colors text-xs">
      {/* Left side: Seq # + Source Badge + Kind */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-mono text-[11px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          #{event.sequence}
        </span>

        {/* Source Badge */}
        <Badge
          variant="outline"
          className={`font-mono text-[10px] font-bold px-2 py-0.5 flex items-center gap-1 ${sourceConfig.badgeClass}`}
        >
          <SourceIcon size="12" variant="Bold" />
          <span>{sourceConfig.label}</span>
        </Badge>

        <span className="font-semibold text-foreground">{event.kind}</span>

        {/* Phase tag */}
        <span className="text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
          {event.phase}
        </span>

        {/* Visibility / Confirmation */}
        {isRedacted ? (
          <Badge variant="outline" className="text-[10px] text-zinc-500 bg-zinc-500/10 border-zinc-500/20 flex items-center gap-1">
            <Lock size="10" variant="Bold" />
            Redacted
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-500/10 border-emerald-500/20 flex items-center gap-1">
            <TickCircle size="10" variant="Bold" />
            Confirmed
          </Badge>
        )}
      </div>

      {/* Right side: Timestamp & Transaction Digest */}
      <div className="flex items-center gap-3 text-muted-foreground text-[11px] font-mono shrink-0">
        {event.transactionDigest && (
          <span className="flex items-center gap-1 text-primary truncate max-w-[120px]" title={event.transactionDigest}>
            <Link21 size="12" variant="Bold" />
            <span>Tx: {event.transactionDigest.slice(0, 8)}...</span>
          </span>
        )}

        <TimeDisplay isoString={event.occurredAt} showLocal={false} />
      </div>
    </div>
  );
}

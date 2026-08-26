"use client";

import { Badge } from "@/components/ui/badge";
import { CLAIM_STATE, type ClaimState } from "@/lib/protocol/constants";
import {
  Clock,
  DocumentText,
  Warning2,
  ShieldSearch,
  Lock,
  Unlock,
  Activity,
  TickCircle,
  ShieldTick,
  CloseCircle,
  Judge,
} from "iconsax-react";

interface StateBadgeProps {
  state: ClaimState | number | string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

interface StateConfig {
  label: string;
  icon: typeof Clock;
  badgeClass: string;
}

export function getStateConfig(state: ClaimState | number | string): StateConfig {
  const numericState = typeof state === "number" ? state : Number(state);

  switch (numericState) {
    case CLAIM_STATE.CREATED:
      return {
        label: "Created",
        icon: Clock,
        badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      };
    case CLAIM_STATE.PROPOSED:
      return {
        label: "Proposed",
        icon: DocumentText,
        badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
      };
    case CLAIM_STATE.CHALLENGED:
      return {
        label: "Challenged",
        icon: Warning2,
        badgeClass: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
      };
    case CLAIM_STATE.REVIEW_REQUESTED:
      return {
        label: "Review Requested",
        icon: ShieldSearch,
        badgeClass: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
      };
    case CLAIM_STATE.COMMIT_1:
      return {
        label: "Phase 1: Commit",
        icon: Lock,
        badgeClass: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
      };
    case CLAIM_STATE.REVEAL_1:
      return {
        label: "Phase 1: Reveal",
        icon: Unlock,
        badgeClass: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      };
    case CLAIM_STATE.DISCUSSION:
      return {
        label: "Discussion / Debate",
        icon: Activity,
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case CLAIM_STATE.COMMIT_2:
      return {
        label: "Phase 2: Commit",
        icon: Lock,
        badgeClass: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
      };
    case CLAIM_STATE.REVEAL_2:
      return {
        label: "Phase 2: Reveal",
        icon: Unlock,
        badgeClass: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      };
    case CLAIM_STATE.FINALIZED_UNCHALLENGED:
      return {
        label: "Finalized (Unchallenged)",
        icon: TickCircle,
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case CLAIM_STATE.FINALIZED_REVIEWED:
      return {
        label: "Finalized (Jury Consensus)",
        icon: ShieldTick,
        badgeClass: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200 font-semibold",
      };
    case CLAIM_STATE.UNRESOLVED:
      return {
        label: "Unresolved (No Consensus)",
        icon: CloseCircle,
        badgeClass: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
      };
    case CLAIM_STATE.CANCELLED:
      return {
        label: "Cancelled",
        icon: CloseCircle,
        badgeClass: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
      };
    default:
      return {
        label: typeof state === "string" ? state : `State ${state}`,
        icon: Judge,
        badgeClass: "border-border bg-muted text-muted-foreground",
      };
  }
}

/**
 * StateBadge pairs color with an explicit text label and icon per PRD §26.7.
 * Never communicates status using color alone.
 */
export function StateBadge({ state, className = "", size = "md" }: StateBadgeProps) {
  const config = getStateConfig(state);
  const Icon = config.icon;

  const iconSize = size === "sm" ? "12" : size === "lg" ? "18" : "14";
  const sizeClasses =
    size === "sm"
      ? "text-[11px] px-2 py-0.5 gap-1"
      : size === "lg"
        ? "text-sm px-3 py-1 gap-2"
        : "text-xs px-2.5 py-1 gap-1.5";

  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center font-medium shadow-2xs border ${config.badgeClass} ${sizeClasses} ${className}`}
    >
      <Icon size={iconSize} variant="Bold" className="shrink-0" />
      <span>{config.label}</span>
    </Badge>
  );
}

"use client";

import { CLAIM_STATE, type ClaimState } from "@/lib/protocol/constants";
import { cn } from "@/lib/utils";
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
} from "@/components/icons";

interface StateBadgeProps {
  state: ClaimState | number | string;
  stranded?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

type Tone = "neutral" | "chain" | "sealed" | "warn" | "yes" | "no" | "primary";

interface StateConfig {
  label: string;
  /** Short form for tight spots (cards, table rows). */
  short: string;
  icon: typeof Clock;
  tone: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-surface text-muted-foreground",
  chain: "border-chain/30 bg-chain/8 text-chain",
  sealed: "border-sealed/30 bg-sealed/8 text-sealed",
  warn: "border-unsure/30 bg-unsure/8 text-unsure",
  yes: "border-yes/30 bg-yes/8 text-yes",
  no: "border-no/30 bg-no/8 text-no",
  primary: "border-sea/35 bg-sea/10 text-primary",
};

export function getStateConfig(
  state: ClaimState | number | string,
  stranded = false,
): StateConfig {
  const numericState = typeof state === "number" ? state : Number(state);

  switch (numericState) {
    case CLAIM_STATE.CREATED:
      return { label: "Created", short: "Created", icon: Clock, tone: "neutral" };
    case CLAIM_STATE.PROPOSED:
      return { label: "Proposed", short: "Proposed", icon: DocumentText, tone: "chain" };
    case CLAIM_STATE.CHALLENGED:
      return { label: "Challenged", short: "Challenged", icon: Warning2, tone: "warn" };
    case CLAIM_STATE.REVIEW_REQUESTED:
      return {
        label: "Review requested",
        short: "In review",
        icon: ShieldSearch,
        tone: "primary",
      };
    case CLAIM_STATE.COMMIT_1:
      return { label: "Phase 1 · Sealed commit", short: "Sealed", icon: Lock, tone: "sealed" };
    case CLAIM_STATE.REVEAL_1:
      return { label: "Phase 1 · Reveal", short: "Revealing", icon: Unlock, tone: "chain" };
    case CLAIM_STATE.DISCUSSION:
      if (stranded) {
        return {
          label: "Discussion · expired",
          short: "Expired",
          icon: CloseCircle,
          tone: "neutral",
        };
      }
      return { label: "Discussion round", short: "Discussion", icon: Activity, tone: "warn" };
    case CLAIM_STATE.COMMIT_2:
      return { label: "Phase 2 · Sealed commit", short: "Sealed", icon: Lock, tone: "sealed" };
    case CLAIM_STATE.REVEAL_2:
      return { label: "Phase 2 · Reveal", short: "Revealing", icon: Unlock, tone: "chain" };
    case CLAIM_STATE.FINALIZED_UNCHALLENGED:
      return {
        label: "Finalized · unchallenged",
        short: "Finalized",
        icon: TickCircle,
        tone: "yes",
      };
    case CLAIM_STATE.FINALIZED_REVIEWED:
      return {
        label: "Finalized · jury consensus",
        short: "Finalized",
        icon: ShieldTick,
        tone: "yes",
      };
    case CLAIM_STATE.UNRESOLVED:
      return {
        label: "Unresolved · no consensus",
        short: "Unresolved",
        icon: CloseCircle,
        tone: "no",
      };
    case CLAIM_STATE.CANCELLED:
      return { label: "Cancelled", short: "Cancelled", icon: CloseCircle, tone: "neutral" };
    default: {
      const fallback = typeof state === "string" ? state : `State ${state}`;
      return { label: fallback, short: fallback, icon: Judge, tone: "neutral" };
    }
  }
}

/**
 * StateBadge pairs colour with an explicit text label and icon per PRD §26.7 —
 * status is never communicated by colour alone.
 */
export function StateBadge({
  state,
  stranded = false,
  className = "",
  size = "md",
}: StateBadgeProps) {
  const config = getStateConfig(state, stranded);
  const Icon = config.icon;

  const iconSize = size === "sm" ? "12" : size === "lg" ? "16" : "13";
  const sizeClasses =
    size === "sm"
      ? "text-[10px] px-2 py-0.5 gap-1"
      : size === "lg"
        ? "text-xs px-3 py-1 gap-1.5"
        : "text-[11px] px-2.5 py-0.5 gap-1.5";

  return (
    <span
      className={cn(
        "ov-micro ov-micro-sm inline-flex w-fit items-center border",
        TONE_CLASS[config.tone],
        sizeClasses,
        className,
      )}
    >
      <Icon size={iconSize} variant="Bold" className="shrink-0" />
      <span>{size === "sm" ? config.short : config.label}</span>
    </span>
  );
}

"use client";

import * as React from "react";
import { Lock, Unlock, Clock, ShieldTick, ShieldCross, Warning2, Cpu } from "@/components/icons";
import { cn } from "@/lib/utils";
import { HashChip } from "./hash-chip";
import { ModelDot, modelFamily } from "./model-badge";

export type SeatState = "pending" | "running" | "sealed" | "revealed" | "failed";
export type SeatOutcome = "YES" | "NO" | "UNSURE";

const HEX = "24,1.2 43.9,12.6 43.9,35.4 24,46.8 4.1,35.4 4.1,12.6";

const OUTCOME_STYLE: Record<
  SeatOutcome,
  { text: string; chip: string; bar: string; stroke: string; icon: typeof ShieldTick }
> = {
  YES: {
    text: "text-yes",
    chip: "border-yes/30 bg-yes/8 text-yes",
    bar: "bg-yes",
    stroke: "var(--signal-yes)",
    icon: ShieldTick,
  },
  NO: {
    text: "text-no",
    chip: "border-no/30 bg-no/8 text-no",
    bar: "bg-no",
    stroke: "var(--signal-no)",
    icon: ShieldCross,
  },
  UNSURE: {
    text: "text-unsure",
    chip: "border-unsure/30 bg-unsure/8 text-unsure",
    bar: "bg-unsure",
    stroke: "var(--signal-unsure)",
    icon: Warning2,
  },
};

const STATE_LABEL: Record<SeatState, string> = {
  pending: "Waiting",
  running: "Running",
  sealed: "Sealed",
  revealed: "Revealed",
  failed: "Failed",
};

const STATE_CHIP: Record<SeatState, string> = {
  pending: "bg-surface-2 text-muted-foreground",
  running: "bg-sea/12 text-primary",
  sealed: "bg-sealed/10 text-sealed",
  revealed: "bg-yes/10 text-yes",
  failed: "bg-no/10 text-no",
};

const STATE_BORDER: Record<SeatState, string> = {
  pending: "border-border",
  running: "border-sea/45",
  sealed: "border-sealed/30",
  revealed: "border-yes/30",
  failed: "border-no/30",
};

/** Map the shared u8 vote outcome (OUTCOME.YES/NO/UNSURE) to its display label. */
export function outcomeLabel(outcome?: number | string | null): SeatOutcome | undefined {
  if (outcome === "YES" || outcome === 1) return "YES";
  if (outcome === "NO" || outcome === 2) return "NO";
  if (outcome === "UNSURE" || outcome === 3) return "UNSURE";
  return undefined;
}

/** Derive a seat's visual state from its on-chain commitment record. */
export function seatStateOf(commitment?: {
  committed?: boolean;
  revealed?: boolean;
  failureStatus?: string;
}, failure?: { status?: string } | null): SeatState {
  // The claim inspection carries the failure status of a seat that never committed.
  if (failure || commitment?.failureStatus) return "failed";
  if (commitment?.revealed) return "revealed";
  if (commitment?.committed) return "sealed";
  return "pending";
}

/**
 * The hexagonal commit-reveal seal — the app's primary visual for the protocol's
 * core trick. Pending = dashed and empty; running = a Sui-blue live ring;
 * sealed = a closed wax seal with a rotating cryptographic ring; revealed =
 * tinted by the opened outcome.
 */
export function SealGlyph({
  state,
  outcome,
  failureStatus,
  size = 48,
  className,
}: {
  state: SeatState;
  outcome?: SeatOutcome;
  failureStatus?: string;
  size?: number;
  className?: string;
}) {
  const uid = React.useId().replace(/:/g, "");
  const style = outcome ? OUTCOME_STYLE[outcome] : null;
  const stroke =
    state === "revealed" && style
      ? style.stroke
      : state === "failed"
        ? "var(--signal-no)"
      : state === "sealed"
        ? "var(--signal-sealed)"
        : state === "running"
          ? "var(--brand-sea-strong)"
          : "var(--muted-foreground)";

  const Glyph =
    state === "revealed"
      ? (style?.icon ?? Unlock)
      : state === "failed"
        ? ShieldCross
      : state === "sealed"
        ? Lock
        : state === "running"
          ? Cpu
          : Clock;

  const idle = state === "pending";

  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      title={
        state === "failed"
          ? `Failed before commit${failureStatus ? `: ${failureStatus}` : ""}`
          : undefined
      }
      role={state === "failed" ? "img" : undefined}
      aria-label={
        state === "failed"
          ? `Seat failed before commit${failureStatus ? `: ${failureStatus}` : ""}`
          : undefined
      }
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className="absolute inset-0">
        <defs>
          <radialGradient id={`sg-${uid}`} cx="50%" cy="32%" r="72%">
            <stop offset="0%" stopColor={stroke} stopOpacity={idle ? 0.05 : 0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={idle ? 0.02 : 0.05} />
          </radialGradient>
        </defs>

        {/* Rotating dashed ring — an active cryptographic hold / live inference. */}
        {(state === "sealed" || state === "running") && (
          <circle
            cx="24"
            cy="24"
            r="22.4"
            fill="none"
            stroke={stroke}
            strokeWidth="1"
            strokeDasharray={state === "running" ? "1.5 5" : "2 4"}
            opacity="0.55"
            className="origin-center motion-safe:animate-spin"
            style={{ animationDuration: state === "running" ? "3.4s" : "9s" }}
          />
        )}

        <polygon
          points={HEX}
          fill={`url(#sg-${uid})`}
          stroke={stroke}
          strokeWidth={idle ? 1 : 1.6}
          strokeLinejoin="round"
          strokeDasharray={idle ? "3 3" : undefined}
          opacity={idle ? 0.5 : 1}
        />
      </svg>

      <Glyph
        size={String(Math.round(size * 0.36))}
        variant="Bold"
        className={cn(
          "relative",
          state === "revealed"
            ? style?.text
            : state === "failed"
              ? "text-no"
            : state === "sealed"
              ? "text-sealed"
              : state === "running"
                ? "text-primary"
                : "text-muted-foreground/70",
        )}
      />
    </div>
  );
}

/**
 * Compact five-seat readout: one small seal per committee seat plus a
 * "n / 5 revealed" tally. Used on claim cards and in dense summary rows.
 */
export function SeatStrip({
  seats,
  className,
}: {
  seats: { state: SeatState; outcome?: SeatOutcome; failureStatus?: string }[];
  className?: string;
}) {
  const revealed = seats.filter((s) => s.state === "revealed").length;
  const sealed = seats.filter((s) => s.state === "sealed").length;
  const failed = seats.filter((s) => s.state === "failed").length;

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <div className="flex items-center gap-1">
        {seats.map((seat, i) => (
          <SealGlyph
            key={i}
            state={seat.state}
            outcome={seat.outcome}
            failureStatus={seat.failureStatus}
            size={22}
          />
        ))}
      </div>
      <span className="ov-micro ov-micro-sm text-muted-foreground">
        {failed > 0
          ? revealed > 0
            ? `${revealed}/${seats.length} revealed, ${failed} failed`
            : `${failed}/${seats.length} failed`
          : revealed > 0
            ? `${revealed}/${seats.length} revealed`
            : `${sealed}/${seats.length} sealed`}
      </span>
    </div>
  );
}

/**
 * A full jury seat: seal + seat number, model identity, and either the sealed
 * redaction notice or the opened vote with a confidence meter. Identifiers are
 * never dropped — they are rehoused into copyable chips at the foot of the card.
 */
export function SeatSeal({
  seatIndex,
  state,
  outcome,
  confidenceBps,
  agentProfileId,
  jurySeatId,
  modelId,
  role,
  reasoning,
  gonkaRequestId,
  failureStatus,
  footer,
  className,
}: {
  seatIndex: number;
  state: SeatState;
  outcome?: SeatOutcome;
  confidenceBps?: number;
  agentProfileId?: string;
  jurySeatId?: string;
  modelId?: string;
  role?: string;
  reasoning?: string;
  gonkaRequestId?: string;
  failureStatus?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const style = outcome ? OUTCOME_STYLE[outcome] : null;
  const fam = modelFamily(modelId);

  return (
    <div
      className={cn(
        "ov-edge relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-3.5 transition-colors",
        STATE_BORDER[state],
        className,
      )}
    >
      {/* Seat number watermark */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-3 right-1 text-5xl font-medium text-ocean/5 select-none"
      >
        {seatIndex}
      </span>

      <div className="flex items-start gap-3">
        <SealGlyph
          state={state}
          outcome={outcome}
          failureStatus={failureStatus}
          size={44}
        />
        <div className="min-w-0 flex-1">
          {/* Seat label and state stack vertically at narrow widths so the
              badges can never collide (fixes the 1440px "Runni#4" overlap). */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="ov-micro ov-micro-sm text-muted-foreground">
              Seat {seatIndex}
            </span>
            <span
              className={cn(
                "ov-micro ov-micro-sm shrink-0 rounded px-1 py-px",
                STATE_CHIP[state],
              )}
              title={
                state === "failed" && failureStatus
                  ? `Failed before commit: ${failureStatus}`
                  : undefined
              }
            >
              {STATE_LABEL[state]}
            </span>
          </div>
          {role && (
            <p
              className="mt-0.5 truncate text-[12px] font-semibold text-ocean"
              title={role}
            >
              {role.replace(/_/g, " ")}
            </p>
          )}
          {modelId && (
            <div className="mt-1 flex items-center gap-1.5">
              <ModelDot modelId={modelId} />
              <span className={cn("truncate font-mono text-[10px]", fam.text)} title={modelId}>
                {fam.short}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body: redacted while sealed, opened vote after reveal. */}
      {state === "failed" ? (
        <div className="space-y-1.5 rounded-lg border border-no/25 bg-no/8 p-2.5">
          <div className="flex items-center gap-1.5 text-no">
            <ShieldCross size="12" variant="Bold" />
            <span className="ov-micro ov-micro-sm">Failed before commit</span>
          </div>
          <p className="font-mono text-[10px] leading-snug text-no">
            {failureStatus || "Failure status not recorded"}
          </p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            This seat cast no vote.
          </p>
        </div>
      ) : state === "revealed" && outcome ? (
        <div className="space-y-2">
          <div
            className={cn(
              "flex items-center justify-between rounded-lg border px-2.5 py-1.5",
              style?.chip,
            )}
          >
            <span className="ov-micro">{outcome}</span>
            <span className="font-mono text-[11px] opacity-80">
              {confidenceBps !== undefined ? `${Math.round(confidenceBps / 100)}%` : "—"}
            </span>
          </div>
          {confidenceBps !== undefined && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-1000 ease-out",
                    style?.bar,
                  )}
                  style={{ width: `${Math.round(confidenceBps / 100)}%` }}
                />
              </div>
              <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
                <span>confidence</span>
                <span>{confidenceBps} bps</span>
              </div>
            </div>
          )}
          {reasoning && (
            <p className="line-clamp-3 rounded-lg border border-border/70 bg-surface p-2 text-[11px] leading-relaxed text-foreground/75 italic">
              “{reasoning}”
            </p>
          )}
        </div>
      ) : state === "sealed" ? (
        <div className="space-y-2 rounded-lg border border-sealed/20 bg-sealed/6 p-2.5">
          <div className="flex items-center gap-1.5 text-sealed">
            <Lock size="12" variant="Bold" />
            <span className="ov-micro ov-micro-sm">
              Blake2b-256 sealed
            </span>
          </div>
          {/* Redaction bars stand in for the withheld preimage. */}
          <div aria-hidden className="flex gap-1">
            {[7, 4, 9, 3, 6, 5].map((w, i) => (
              <span
                key={i}
                className="ov-breathe h-1.5 rounded-full bg-sealed/30"
                style={{ width: `${w * 4}px`, animationDelay: `${i * 140}ms` }}
              />
            ))}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Vote and reasoning preimage stay sealed on-chain until the reveal phase.
          </p>
        </div>
      ) : state === "running" ? (
        <div className="space-y-2 rounded-lg border border-sea/30 bg-sea/8 p-2.5">
          <div className="flex items-center gap-1.5 text-primary">
            <Cpu size="12" variant="Bold" />
            <span className="ov-micro ov-micro-sm">
              Inference running
            </span>
          </div>
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-sea/15">
            <div className="ov-breathe h-full w-2/3 rounded-full bg-sea" />
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            GonkaRouter is executing this seat&apos;s independent review.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-2.5 py-2 text-[10px] text-muted-foreground">
          <Clock size="12" variant="Bold" />
          <span className="ov-micro ov-micro-sm">Awaiting commitment</span>
        </div>
      )}

      {/* Identifiers — never dropped, just rehoused into chips. */}
      <div className="mt-auto flex flex-wrap gap-1 border-t border-border/60 pt-2">
        {agentProfileId && <HashChip value={agentProfileId} label="agent" tone="muted" />}
        {jurySeatId && <HashChip value={jurySeatId} label="seat" tone="muted" />}
        {gonkaRequestId && <HashChip value={gonkaRequestId} label="gonka" tone="muted" />}
        {footer}
      </div>
    </div>
  );
}

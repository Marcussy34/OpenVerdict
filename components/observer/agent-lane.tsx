"use client";

import { SeatSeal, type SeatOutcome, type SeatState } from "@/components/viz/seat-seal";
import { cn } from "@/lib/utils";

export interface AgentLaneProps {
  seatIndex: number;
  /** Derived from the claim inspection API (committed/revealed) plus live events. */
  state: SeatState;
  outcome?: SeatOutcome;
  confidenceBps?: number;
  modelId?: string;
  role?: string;
  agentProfileId?: string;
  jurySeatId?: string;
  gonkaRequestId?: string;
  reasoning?: string;
  /** Latest public event kind seen for this seat, e.g. "vote_committed". */
  lastEventKind?: string;
  latencyMs?: number;
  attempt?: number;
  className?: string;
}

/**
 * One juror lane in the live observer. The lane is a jury seat seal plus a
 * footer carrying whatever the public event stream last said about this seat —
 * never an inferred vote.
 */
export function AgentLane({
  seatIndex,
  state,
  outcome,
  confidenceBps,
  modelId,
  role,
  agentProfileId,
  jurySeatId,
  gonkaRequestId,
  reasoning,
  lastEventKind,
  latencyMs,
  attempt,
  className,
}: AgentLaneProps) {
  const meta = [
    lastEventKind ? lastEventKind.replace(/_/g, " ") : null,
    latencyMs !== undefined ? `${latencyMs}ms` : null,
    attempt !== undefined ? `attempt ${attempt}` : null,
  ].filter(Boolean) as string[];

  return (
    <SeatSeal
      className={cn("h-full", className)}
      seatIndex={seatIndex}
      state={state}
      outcome={outcome}
      confidenceBps={confidenceBps}
      modelId={modelId}
      role={role}
      agentProfileId={agentProfileId}
      jurySeatId={jurySeatId}
      gonkaRequestId={gonkaRequestId}
      reasoning={reasoning}
      footer={
        meta.length > 0 ? (
          <span className="ov-micro ov-micro-sm w-full truncate text-muted-foreground">
            {meta.join(" · ")}
          </span>
        ) : undefined
      }
    />
  );
}

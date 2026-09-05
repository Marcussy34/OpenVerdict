"use client";

import Link from "next/link";
import { ModelLogo } from "@/components/viz/model-logo";
import { modelFamily } from "@/components/viz/model-badge";
import {
  stakeSentence,
  type StakedAgentEntry,
} from "@/components/agents/stake-line";
import { cn } from "@/lib/utils";
import { ArrowRight2 } from "@/components/icons";

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** " · earned 0.42 SUI" when any jury rewards exist, empty otherwise. */
function earnedSui(earnedMist: string | undefined): string {
  if (!earnedMist || earnedMist === "0") return "";
  const sui = Number(BigInt(earnedMist)) / 1_000_000_000;
  return ` · earned ${sui.toFixed(sui >= 1 ? 2 : 3)} SUI`;
}

/**
 * One juror seat as a row in the registry grid, used for both the active grid
 * and the sitting-out group. `sittingOut` dims the card and swaps the family
 * dot for a muted pill: the seat is staked and on the current roster, the
 * operator simply holds it out of the draw. Hover and focus lift it back to
 * full ink so the dimmed copy stays readable when someone reaches for it.
 */
export function JurorSeatCard({
  agent,
  variant,
  sittingOut = false,
}: {
  agent: StakedAgentEntry;
  /** Tint index among the seats holding the same model. */
  variant: number;
  sittingOut?: boolean;
}) {
  const fam = modelFamily(agent.modelId);
  const staked = stakeSentence(agent);
  return (
    <li
      className={cn(
        "ov-edge rounded-2xl border border-border bg-card",
        sittingOut &&
          "opacity-75 transition-opacity hover:opacity-100 focus-within:opacity-100",
      )}
    >
      <Link
        href={`/agents/${agent.agentProfileId}`}
        className="flex h-full items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        <ModelLogo modelId={agent.modelId} variant={variant} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ocean">
            {!sittingOut && (
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", fam.dot)} />
            )}
            <span className="truncate">{fam.name}</span>
            {sittingOut && (
              <span className="ov-micro ov-micro-sm shrink-0 border border-border px-1.5 py-px text-muted-foreground">
                Sitting out
              </span>
            )}
          </p>
          <p className="mt-0.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">
            {shortId(agent.agentProfileId)}
          </p>
          {agent.trackRecord && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {agent.trackRecord.seatsServed} seats ·{" "}
              {agent.trackRecord.revealed} revealed ·{" "}
              {agent.trackRecord.agreedWithCertificate} agreed
              {earnedSui(agent.earnedMist)}
            </p>
          )}
          {/* Real stake, so who posted it and how much is the headline. */}
          {staked && (
            <p className="mt-0.5 font-mono text-[11px] leading-snug break-all text-muted-foreground">
              {staked}
            </p>
          )}
        </div>
        <ArrowRight2 size="14" className="shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HashChip } from "@/components/viz/hash-chip";
import { ModelBadge, modelFamily } from "@/components/viz/model-badge";
import { MetaTag } from "@/components/viz/page-header";
import { cn } from "@/lib/utils";
import type { AgentDirectoryEntry, AgentCard as AgentCardType } from "@/lib/engine/contract";
import {
  ShieldTick,
  ShieldCross,
  Activity,
  DocumentText,
  TickCircle,
  CloseCircle,
  Warning2,
  ArrowRight,
} from "@/components/icons";

interface AgentCardComponentProps {
  agent?: AgentDirectoryEntry;
  reportCard?: AgentCardType;
  showVoteDetails?: boolean;
}

/** The four reputation dimensions the registry maintains, in display order. */
const REPUTATION_DIMENSIONS = [
  { key: "liveness_bps", label: "Liveness" },
  { key: "valid_output_bps", label: "Valid output" },
  { key: "valid_reveal_bps", label: "Valid reveal" },
  { key: "consensus_reliability_bps", label: "Consensus" },
] as const;

export function AgentCard({ agent, reportCard, showVoteDetails = false }: AgentCardComponentProps) {
  const profileId = reportCard?.agentProfileId ?? agent?.agentProfileId ?? "unknown";
  const modelId = reportCard?.modelId ?? agent?.modelId ?? "unknown";
  const role = reportCard?.role ?? agent?.role ?? "Juror agent";
  const owner = reportCard?.owner ?? agent?.owner;
  const manifestHash = agent?.manifestHash;
  const isActive = agent?.active ?? true;
  const family = modelFamily(modelId);

  const outcomeStyle =
    reportCard?.outcome === "YES"
      ? { chip: "border-yes/30 bg-yes/8 text-yes", Icon: ShieldTick }
      : reportCard?.outcome === "NO"
        ? { chip: "border-no/30 bg-no/8 text-no", Icon: ShieldCross }
        : reportCard?.outcome === "UNSURE"
          ? { chip: "border-unsure/30 bg-unsure/8 text-unsure", Icon: Warning2 }
          : { chip: "border-border bg-surface text-muted-foreground", Icon: Activity };
  const OutcomeIcon = outcomeStyle.Icon;

  return (
    <article className="ov-edge ov-lift relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* Model-family identity rail — committee diversity made visible. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", family.dot)} />

      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="min-w-0 space-y-1.5">
          <ModelBadge modelId={modelId} />
          <h3 className="truncate text-sm font-semibold text-ocean">{role.replace(/_/g, " ")}</h3>
        </div>
        <MetaTag tone={isActive ? "yes" : "default"}>
          {isActive ? (
            <>
              <TickCircle size="10" variant="Bold" />
              Active
            </>
          ) : (
            <>
              <CloseCircle size="10" variant="Bold" />
              Retired
            </>
          )}
        </MetaTag>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        {/* Post-reveal vote, when this card is rendered from a settled report. */}
        {showVoteDetails && reportCard && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Revealed vote
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold",
                  outcomeStyle.chip,
                )}
              >
                <OutcomeIcon size="12" variant="Bold" />
                {reportCard.outcome} · {Math.round(reportCard.confidenceBps / 100)}%
              </span>
            </div>

            {reportCard.reasoning && (
              <p className="line-clamp-3 rounded-lg border border-border bg-card p-2 text-[11px] leading-relaxed text-foreground/80 italic">
                “{reportCard.reasoning}”
              </p>
            )}

            {reportCard.evidenceIds?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <DocumentText size="12" variant="Bold" className="text-muted-foreground" />
                {reportCard.evidenceIds.map((eid) => (
                  <HashChip key={eid} value={eid} tone="muted" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reputation dimensions as compact meters — hidden until the registry
            has actually scored a run, so cards never show four empty bars. */}
        {agent && Object.keys(agent.reputation ?? {}).length === 0 && !showVoteDetails && (
          <div className="rounded-xl border border-dashed border-border bg-surface px-3 py-2.5">
            <p className="text-[11px] leading-snug text-muted-foreground">
              No scored jury runs yet — reputation dimensions appear once this agent completes
              a reveal on this deployment.
            </p>
          </div>
        )}

        {agent?.reputation && Object.keys(agent.reputation).length > 0 && (
          <div className="space-y-2">
            <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Reputation (bps)
            </span>
            <div className="space-y-1.5">
              {REPUTATION_DIMENSIONS.map((dim) => {
                const bps = agent.reputation?.[dim.key];
                const pct = typeof bps === "number" ? Math.min(100, bps / 100) : null;
                return (
                  <div key={dim.key} className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-muted-foreground">{dim.label}</span>
                      <span className="font-semibold text-ocean tabular-nums">
                        {typeof bps === "number" ? bps : "—"}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn("h-full rounded-full", family.dot)}
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Identifiers — copyable, never truncated away. */}
        <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-3">
          <HashChip value={profileId} label="agent" tone="muted" />
          {owner && <HashChip value={owner} label="owner" tone="muted" />}
          {manifestHash && <HashChip value={manifestHash} label="manifest" tone="muted" />}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <Button asChild variant="outline" size="sm" className="min-h-[38px] w-full font-semibold">
          <Link href={`/agents/${profileId}`}>
            View agent profile
            <ArrowRight size="14" variant="Bold" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentDirectoryEntry, AgentCard as AgentCardType } from "@/lib/engine/contract";
import {
  Cpu,
  Profile2User,
  ShieldTick,
  ShieldCross,
  Activity,
  DocumentText,
  TickCircle,
  CloseCircle,
  Warning2,
} from "iconsax-react";

interface AgentCardComponentProps {
  agent?: AgentDirectoryEntry;
  reportCard?: AgentCardType;
  showVoteDetails?: boolean;
}

export function AgentCard({ agent, reportCard, showVoteDetails = false }: AgentCardComponentProps) {
  const profileId = reportCard?.agentProfileId ?? agent?.agentProfileId ?? "unknown";
  const modelId = reportCard?.modelId ?? agent?.modelId ?? "unknown";
  const role = reportCard?.role ?? agent?.role ?? "Juror Agent";
  const owner = reportCard?.owner ?? agent?.owner ?? "0x0000";
  const manifestHash = agent?.manifestHash ?? "0x0000";
  const isActive = agent?.active ?? true;

  // Outcome colors & badges for post-reveal view
  let outcomeColor = "text-muted-foreground border-border bg-muted";
  let OutcomeIcon = Activity;

  if (reportCard?.outcome === "YES") {
    outcomeColor = "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10 font-bold";
    OutcomeIcon = ShieldTick;
  } else if (reportCard?.outcome === "NO") {
    outcomeColor = "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10 font-bold";
    OutcomeIcon = ShieldCross;
  } else if (reportCard?.outcome === "UNSURE") {
    outcomeColor = "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10 font-bold";
    OutcomeIcon = Warning2;
  }

  return (
    <Card className="flex flex-col justify-between border-border/80 hover:border-primary/50 transition-all duration-200 shadow-xs bg-card">
      <CardHeader className="space-y-3 pb-3">
        {/* Top badges: Model family + Active badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Cpu size="16" variant="Bold" className="text-primary shrink-0" />
            <span className="text-xs font-mono font-bold text-foreground truncate max-w-[180px]">
              {modelId}
            </span>
          </div>

          <Badge
            variant="outline"
            className={`text-[10px] py-0 px-2 font-medium flex items-center gap-1 ${
              isActive
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-zinc-500/30 bg-zinc-500/10 text-zinc-500"
            }`}
          >
            {isActive ? (
              <>
                <TickCircle size="10" variant="Bold" />
                Active
              </>
            ) : (
              <>
                <CloseCircle size="10" variant="Bold" />
                Deprecated
              </>
            )}
          </Badge>
        </div>

        {/* Role & Profile ID */}
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Profile2User size="15" variant="Bold" className="text-muted-foreground" />
            <span>{role}</span>
          </h4>
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span>Agent: {profileId.slice(0, 10)}...</span>
            <span>•</span>
            <span>Owner: {owner.slice(0, 8)}...</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-xs text-muted-foreground pb-4">
        {/* Post-reveal jury vote info if present */}
        {showVoteDetails && reportCard && (
          <div className="bg-muted/50 p-3 rounded-lg border border-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Revealed Vote:</span>
              <Badge variant="outline" className={`px-2 py-0.5 text-xs flex items-center gap-1 ${outcomeColor}`}>
                <OutcomeIcon size="12" variant="Bold" />
                <span>
                  {reportCard.outcome} ({Math.round(reportCard.confidenceBps / 100)}% conf)
                </span>
              </Badge>
            </div>

            {reportCard.reasoning && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  Public Reasoning:
                </span>
                <p className="text-xs text-foreground/90 italic leading-relaxed line-clamp-3 bg-background/80 p-2 rounded border border-border/40">
                  &quot;{reportCard.reasoning}&quot;
                </p>
              </div>
            )}

            {reportCard.evidenceIds && reportCard.evidenceIds.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
                <DocumentText size="12" variant="Bold" />
                <span>Cited Evidence: {reportCard.evidenceIds.join(", ")}</span>
              </div>
            )}
          </div>
        )}

        {/* Reputation scores (when from directory) */}
        {agent?.reputation && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Reputation Scores (Bps):
            </span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              <div className="flex justify-between bg-muted/40 px-2 py-1 rounded">
                <span className="text-muted-foreground">Liveness:</span>
                <span className="font-semibold text-foreground">{agent.reputation.liveness_bps ?? "10000"}</span>
              </div>
              <div className="flex justify-between bg-muted/40 px-2 py-1 rounded">
                <span className="text-muted-foreground">Valid Out:</span>
                <span className="font-semibold text-foreground">{agent.reputation.valid_output_bps ?? "10000"}</span>
              </div>
              <div className="flex justify-between bg-muted/40 px-2 py-1 rounded">
                <span className="text-muted-foreground">Valid Rev:</span>
                <span className="font-semibold text-foreground">{agent.reputation.valid_reveal_bps ?? "10000"}</span>
              </div>
              <div className="flex justify-between bg-muted/40 px-2 py-1 rounded">
                <span className="text-muted-foreground">Consensus:</span>
                <span className="font-semibold text-foreground">{agent.reputation.consensus_reliability_bps ?? "10000"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Manifest hash */}
        <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-muted-foreground border-t border-border/40">
          <span>Manifest:</span>
          <span className="truncate max-w-[140px]">{manifestHash}</span>
        </div>

        <div className="pt-2">
          <Link href={`/agents/${profileId}`} className="w-full block">
            <Button variant="outline" size="sm" className="w-full text-xs font-semibold min-h-[38px]">
              View Agent Profile
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { HashChip } from "@/components/viz/hash-chip";
import { LiveDot } from "@/components/viz/live-dot";
import { ResearchFeed } from "@/components/viz/research-feed";
import { modelFamily } from "@/components/viz/model-badge";
import {
  ArrowDown2,
  ExportSquare,
  Lock,
  Refresh,
  ShieldCross,
  TickCircle,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { BrowserRunProof } from "@/lib/verify/run-proof";
import { feedDomain } from "@/lib/viz/research-feed";
import { modelName, type TranscriptJuror, type TranscriptJurorView } from "@/lib/viz/transcript";

/** The revealed vote, in its semantic colour. */
const OUTCOME_BADGE: Record<string, string> = {
  YES: "border-yes/40 bg-yes/12 text-yes",
  NO: "border-no/40 bg-no/12 text-no",
  UNSURE: "border-unsure/40 bg-unsure/12 text-unsure",
};

/** The confidence bar carries the same colour as the vote it belongs to. */
const OUTCOME_BAR: Record<string, string> = {
  YES: "[&_[data-slot=progress-indicator]]:bg-yes",
  NO: "[&_[data-slot=progress-indicator]]:bg-no",
  UNSURE: "[&_[data-slot=progress-indicator]]:bg-unsure",
};

const FINDING_TONE: Record<string, string> = {
  SUPPORTS: "text-yes",
  CONTRADICTS: "text-no",
};

type ProofRecord = Record<string, unknown>;

function asRecord(value: unknown): ProofRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ProofRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecords(value: unknown): ProofRecord[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = asRecord(entry);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

/** "gonka req-…  devshard 70083  9029 tokens  19.1 s", the trace's receipt. */
function receiptWords(proof: BrowserRunProof): string | undefined {
  const bundle = asRecord(proof.bundle);
  const audit = asRecord(bundle?.audit);
  const parts: string[] = [];
  const requestId = proof.gateway?.gatewayRequestId ?? asString(audit?.gonkaRequestId);
  if (requestId) parts.push(`gonka ${requestId}`);
  if (proof.gateway?.devshardId) parts.push(`devshard ${proof.gateway.devshardId}`);
  const input = asNumber(audit?.inputTokens);
  const output = asNumber(audit?.outputTokens);
  if (input !== undefined && output !== undefined) parts.push(`${input + output} tokens`);
  const latencyMs = asNumber(audit?.latencyMs);
  if (latencyMs !== undefined) parts.push(`${(latencyMs / 1_000).toFixed(1)} s`);
  return parts.length === 0 ? undefined : parts.join("  ");
}

function Finding({ entry }: { entry: ProofRecord }) {
  const assessment = asString(entry.assessment) ?? "INSUFFICIENT";
  return (
    <li className="text-[13px] leading-snug text-muted-foreground">
      <span className={cn("ov-micro ov-micro-sm mr-1.5", FINDING_TONE[assessment] ?? "text-unsure")}>
        {assessment}
      </span>
      {asString(entry.check)}: {asString(entry.finding)}
    </li>
  );
}

/** One cited source: the site as a link, the quote it rests on in italics. */
function Citation({ citation }: { citation: ProofRecord }) {
  const url = asString(citation.url);
  const quote = asString(citation.quote);
  // Only a real web URL becomes a link; anything else stays inert text.
  const href = url !== undefined && /^https?:\/\//i.test(url) ? url : undefined;
  const site = url === undefined ? "a page" : (feedDomain(url) ?? url);
  return (
    <li className="text-[13px] leading-snug text-muted-foreground">
      {href === undefined ? (
        <span className="text-foreground/70">{site}</span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={url}
          className="inline-flex items-baseline gap-1 font-medium text-chain hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {site}
          <ExportSquare size="10" variant="Bold" className="shrink-0 self-center" />
        </a>
      )}
      {quote !== undefined && <span className="italic"> &ldquo;{quote}&rdquo;</span>}
    </li>
  );
}

/** The revealed answer: the vote, why, and the quotes it rests on. */
function JurorAnswer({ proof }: { proof: BrowserRunProof }) {
  const bundle = asRecord(proof.bundle);
  const output = asRecord(bundle?.validatedOutput);
  if (output === undefined) return null;
  const outcome = asString(output.outcome) ?? "";
  const confidenceBps = asNumber(output.confidenceBps);
  const percent = confidenceBps === undefined ? undefined : Math.round(confidenceBps / 100);
  const citations = asRecords(output.citations);
  const findings = asRecords(output.publicReasoningTrace);
  const reasoning = asString(output.reasoning);
  const counterEvidence = asString(output.counterEvidenceSummary);
  const receipt = receiptWords(proof);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {outcome === "" ? (
          <span className="text-[13px] text-muted-foreground">No outcome recorded</span>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              "ov-micro ov-micro-sm px-2",
              OUTCOME_BADGE[outcome] ?? "border-border text-muted-foreground",
            )}
          >
            {outcome}
          </Badge>
        )}
        {percent !== undefined && (
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {percent} percent
          </span>
        )}
      </div>

      {percent !== undefined && (
        <Progress
          value={percent}
          aria-label="Confidence"
          className={cn("h-1 bg-foreground/10", OUTCOME_BAR[outcome])}
        />
      )}

      {reasoning && (
        <p className="text-[13px] leading-relaxed text-foreground/85">{reasoning}</p>
      )}

      {findings.length > 0 && (
        <ul className="space-y-1.5">
          {findings.map((entry, index) => (
            <Finding key={index} entry={entry} />
          ))}
        </ul>
      )}

      {citations.length > 0 && (
        <ul className="space-y-1.5">
          {citations.map((citation, index) => (
            <Citation key={index} citation={citation} />
          ))}
        </ul>
      )}

      {counterEvidence && (
        <p className="border-l border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
          <span className="ov-micro ov-micro-sm mr-1.5 text-muted-foreground/80">
            Counter-evidence
          </span>
          {counterEvidence}
        </p>
      )}

      {receipt && (
        <p className="font-mono text-[11px] break-all text-muted-foreground/70">{receipt}</p>
      )}
    </div>
  );
}

/** The one mark in front of the status line: what this seat is doing now. */
function StateMark({ state }: { state: TranscriptJurorView["state"] }) {
  if (state === "researching") return <LiveDot tone="chain" className="mt-1" />;
  if (state === "sealed") {
    return <Lock size="13" variant="Bold" className="mt-0.5 shrink-0 text-sealed" />;
  }
  if (state === "revealed") {
    return <TickCircle size="13" variant="Bold" className="mt-0.5 shrink-0 text-yes" />;
  }
  if (state === "failed") {
    return <ShieldCross size="13" variant="Bold" className="mt-0.5 shrink-0 text-no" />;
  }
  return (
    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
  );
}

/**
 * One juror in the live transcript: its identity, the line saying what it is
 * doing right now, and, expanded, its research steps and (after the reveal)
 * the answer it committed to. Nothing here guesses a sealed vote.
 */
export function JurorCard({
  juror,
  view,
  expanded,
  onToggle,
  proof,
  loadingProof,
}: {
  juror: TranscriptJuror;
  view: TranscriptJurorView;
  expanded: boolean;
  onToggle: () => void;
  proof?: BrowserRunProof;
  loadingProof?: boolean;
}) {
  const family = modelFamily(juror.modelId);
  const revealed = view.state === "revealed";
  const failed = view.state === "failed";
  const steps = view.steps.length;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      className={cn(
        "flex h-full flex-col border bg-card p-3 transition-colors",
        expanded ? "border-foreground/25" : "border-border",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* One monochrome initial in a tile tinted by model family. Committee
            diversity is a protocol guarantee, so the hue earns its cue. */}
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center border text-[12px] font-semibold",
            family.chip,
          )}
        >
          {family.key === "other" ? "?" : family.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-tight">
            <span className="font-semibold text-foreground">Juror {juror.index}</span>
            <span className="min-w-0 truncate text-muted-foreground" title={juror.modelId}>
              {juror.modelId ? modelName(juror.modelId) : "model pending"}
            </span>
          </p>
          {juror.role && (
            <Badge
              variant="outline"
              // A long role wraps rather than pushing out of a narrow column.
              className="ov-micro ov-micro-sm mt-1.5 h-auto max-w-full justify-start border-border px-1.5 py-0.5 text-left whitespace-normal text-muted-foreground"
            >
              {juror.role.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-muted-foreground">
        <StateMark state={view.state} />
        <span className="min-w-0 flex-1">{view.status}</span>
      </p>

      {/* The trail control closes the card, so a stretched row still reads as
          one shelf: identity at the top, the same control on every bottom. */}
      <CollapsibleTrigger
        className={cn(
          "mt-auto flex min-h-10 w-full items-center gap-1.5 border-t border-border/60 pt-2.5 text-left",
          "text-[13px] font-medium text-foreground/70 transition-colors",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <ArrowDown2
          size="12"
          variant="Bold"
          className={cn("shrink-0 transition-transform", expanded && "rotate-180")}
        />
        {expanded ? "Hide the trail" : "Show the trail"}
        {steps > 0 && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
            {steps} step{steps === 1 ? "" : "s"}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
        <div className="space-y-3 pt-3">
          {steps > 0 ? (
            <ResearchFeed steps={view.steps} />
          ) : revealed || failed ? null : (
            // A seat still working says what will appear; a finished one whose
            // proof carries no trail (a table vote) says nothing at all.
            <p className="text-[13px] text-muted-foreground">
              Research steps appear here as they happen.
            </p>
          )}

          {failed && juror.failureStatus && (
            <p className="flex items-start gap-1.5 text-[13px] leading-snug text-no">
              <ShieldCross size="13" variant="Bold" className="mt-0.5 shrink-0" />
              <span>
                This seat failed before it committed ({juror.failureStatus}). It cast no vote,
                and the whole attempt is void.
              </span>
            </p>
          )}

          {!revealed && !failed && (
            <p className="flex items-start gap-1.5 text-[13px] leading-snug text-sealed">
              <Lock size="13" variant="Bold" className="mt-0.5 shrink-0" />
              <span>The vote and the reasoning stay sealed on chain until the reveal.</span>
            </p>
          )}

          {revealed && loadingProof && (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Refresh size="13" variant="Bold" className="motion-safe:animate-spin" />
              Opening the revealed run
            </p>
          )}

          {revealed && proof !== undefined && <JurorAnswer proof={proof} />}

          <div className="flex flex-wrap gap-1">
            {juror.seats.map((seat) => (
              <HashChip
                key={seat.seatId}
                value={seat.seatId}
                label={seat.phase === 2 ? "seat, round two" : "seat"}
                tone="muted"
              />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

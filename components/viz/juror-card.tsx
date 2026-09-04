"use client";

import { JurorAvatar } from "@/components/agents/avatar";
import { HashChip } from "@/components/viz/hash-chip";
import { ResearchFeed } from "@/components/viz/research-feed";
import { modelFamily } from "@/components/viz/model-badge";
import {
  ArrowDown2,
  Cpu,
  Lock,
  Refresh,
  ShieldCross,
  ShieldTick,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { BrowserRunProof } from "@/lib/verify/run-proof";
import { modelName, type TranscriptJuror, type TranscriptJurorView } from "@/lib/viz/transcript";

const STATE_CHIP: Record<TranscriptJurorView["state"], string> = {
  waiting: "border-white/15 bg-white/[0.06] text-white/60",
  researching: "border-[#0e76ff]/40 bg-[#0e76ff]/15 text-[#72b6ff]",
  sealed: "border-sealed/40 bg-sealed/15 text-sealed",
  revealed: "border-yes/40 bg-yes/15 text-yes",
  failed: "border-no/40 bg-no/15 text-no",
};

const STATE_WORD: Record<TranscriptJurorView["state"], string> = {
  waiting: "Waiting",
  researching: "Researching",
  sealed: "Sealed",
  revealed: "Revealed",
  failed: "Failed",
};

const OUTCOME_TEXT: Record<string, string> = {
  YES: "text-yes",
  NO: "text-no",
  UNSURE: "text-unsure",
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
  const tone =
    assessment === "SUPPORTS"
      ? "text-yes"
      : assessment === "CONTRADICTS"
        ? "text-no"
        : "text-unsure";
  return (
    <li className="text-[11px] leading-relaxed text-white/70">
      <span className={cn("font-semibold", tone)}>[{assessment}]</span>{" "}
      {asString(entry.check)}: {asString(entry.finding)}
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
  const citations = asRecords(output.citations);
  const findings = asRecords(output.publicReasoningTrace);
  const receipt = receiptWords(proof);

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center gap-2">
        <ShieldTick size="14" variant="Bold" className={cn(OUTCOME_TEXT[outcome] ?? "text-white/60")} />
        <span className={cn("text-sm font-semibold", OUTCOME_TEXT[outcome] ?? "text-white/80")}>
          {outcome || "No outcome recorded"}
        </span>
        {confidenceBps !== undefined && (
          <span className="font-mono text-[11px] text-white/55">
            {Math.round(confidenceBps / 100)} percent
          </span>
        )}
      </div>

      {asString(output.reasoning) && (
        <p className="text-[11px] leading-relaxed text-white/75">{asString(output.reasoning)}</p>
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
            <li key={index} className="text-[11px] leading-relaxed text-white/65">
              <span className="text-white/45">cites {asString(citation.url) ?? "a page"}:</span>{" "}
              <span className="italic">&ldquo;{asString(citation.quote)}&rdquo;</span>
            </li>
          ))}
        </ul>
      )}

      {asString(output.counterEvidenceSummary) && (
        <p className="text-[11px] leading-relaxed text-white/60">
          <span className="text-white/45">Counter-evidence:</span>{" "}
          {asString(output.counterEvidenceSummary)}
        </p>
      )}

      {receipt && <p className="font-mono text-[10px] break-all text-white/40">{receipt}</p>}
    </div>
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

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/[0.04] p-3 transition-colors",
        expanded ? "border-white/25" : "border-white/10",
      )}
    >
      <div className="flex items-start gap-3">
        <JurorAvatar
          family={juror.family}
          ordinal={juror.index - 1}
          avatarKey={juror.agentProfileId}
          size={40}
          className="ring-1 ring-white/15"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-white">Juror {juror.index}</span>
            <span
              className={cn("truncate font-mono text-[10px]", juror.modelId ? family.text : "text-white/55")}
              title={juror.modelId}
            >
              {juror.modelId ? modelName(juror.modelId) : "model pending"}
            </span>
            {juror.role && (
              <span className="rounded-full border border-white/15 bg-white/[0.06] px-1.5 py-px text-[9px] font-semibold tracking-wide text-white/55 uppercase">
                {juror.role.replace(/_/g, " ")}
              </span>
            )}
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold tracking-wide uppercase",
                STATE_CHIP[view.state],
              )}
            >
              {STATE_WORD[view.state]}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-relaxed text-white/70">
            {view.state === "researching" && (
              <Cpu size="12" variant="Bold" className="shrink-0 text-[#72b6ff] motion-safe:animate-pulse" />
            )}
            {view.state === "sealed" && <Lock size="12" variant="Bold" className="shrink-0 text-sealed" />}
            {failed && <ShieldCross size="12" variant="Bold" className="shrink-0 text-no" />}
            <span className="min-w-0">{view.status}</span>
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
      >
        <ArrowDown2
          size="12"
          variant="Bold"
          className={cn("motion-safe:transition-transform", expanded && "rotate-180")}
        />
        {expanded ? "Hide the trail" : "Show the trail"}
        {view.steps.length > 0 && (
          <span className="font-mono text-[10px] text-white/40">
            {view.steps.length} step{view.steps.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3 border-t border-white/10 pt-3">
          {view.steps.length > 0 ? (
            <ResearchFeed steps={view.steps} />
          ) : revealed || failed ? null : (
            // A seat still working says what will appear; a finished one whose
            // proof carries no trail (a table vote) says nothing at all.
            <p className="text-[11px] text-white/45">
              Research steps appear here as they happen.
            </p>
          )}

          {failed && juror.failureStatus && (
            <p className="rounded-lg border border-no/25 bg-no/8 p-2.5 text-[11px] leading-relaxed text-no">
              This seat failed before it committed ({juror.failureStatus}). It cast no vote, and
              the whole attempt is void.
            </p>
          )}

          {!revealed && !failed && (
            <p className="flex items-center gap-1.5 rounded-lg border border-sealed/25 bg-sealed/8 p-2.5 text-[11px] leading-relaxed text-sealed">
              <Lock size="12" variant="Bold" className="shrink-0" />
              The vote and the reasoning stay sealed on chain until the reveal.
            </p>
          )}

          {revealed && loadingProof && (
            <p className="flex items-center gap-1.5 text-[11px] text-white/45">
              <Refresh size="12" variant="Bold" className="motion-safe:animate-spin" />
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
      )}
    </div>
  );
}

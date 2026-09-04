"use client";

import { Badge } from "@/components/ui/badge";
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
  if (state === "researching") return <LiveDot tone="chain" />;
  if (state === "sealed") {
    return <Lock size="13" variant="Bold" className="shrink-0 text-sealed" />;
  }
  if (state === "revealed") {
    return <TickCircle size="13" variant="Bold" className="shrink-0 text-yes" />;
  }
  if (state === "failed") {
    return <ShieldCross size="13" variant="Bold" className="shrink-0 text-no" />;
  }
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />;
}

/**
 * The status line has to hold one line inside a five-column card, so the long
 * public phrasings get a compact form here and the full sentence stays in the
 * title. Presentation only: lib/viz/transcript.ts keeps the words it prints,
 * and the wording matches the research trail's own ("searched (challenge)").
 */
function shortStatus(status: string): string {
  const revealed = /^revealed (.+) at (.+)$/.exec(status);
  if (revealed) return `${revealed[1]}, ${revealed[2]}`;
  // "reading a.org, b.org, +2 more" keeps the first site; the rest is in the title.
  const reading = /^reading ([^,]+),/.exec(status);
  if (reading) return `reading ${reading[1]}…`;
  const failedBefore = /^failed before commit: (.+)$/.exec(status);
  if (failedBefore) return `failed: ${failedBefore[1]}`;
  if (status === "searching for evidence against the claim") return "searching (challenge)";
  if (status === "searching for evidence for the claim") return "searching (support)";
  if (status === "research finished, run approved on Sui") return "research finished";
  if (status === "seat drawn, waiting to start") return "waiting to start";
  return status;
}

/** The family tile: one monochrome initial tinted by the seat's model family. */
function SeatGlyph({ juror }: { juror: TranscriptJuror }) {
  const family = modelFamily(juror.modelId);
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center border text-[11px] font-semibold",
        family.chip,
      )}
    >
      {family.key === "other" ? "?" : family.name.charAt(0)}
    </span>
  );
}

/** "Juror 3  Kimi" on one line; a long model id ellipsises rather than wraps. */
function SeatName({ juror }: { juror: TranscriptJuror }) {
  return (
    <p className="flex items-baseline gap-x-1.5 text-[13px] leading-tight whitespace-nowrap">
      <span className="shrink-0 font-semibold text-foreground">Juror {juror.index}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={juror.modelId}>
        {juror.modelId ? modelName(juror.modelId) : "model pending"}
      </span>
    </p>
  );
}

/** The role, shortened to its first word in a narrow chip; title holds it all. */
function RoleChip({ role, className }: { role: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={role}
      className={cn(
        "ov-micro ov-micro-sm block h-auto max-w-full truncate border-border px-1.5 py-0.5 tracking-[0.6px] text-muted-foreground",
        className,
      )}
    >
      {role.split(" ")[0] ?? role}
    </Badge>
  );
}

/** The line saying what this seat is doing now, short enough for one line. */
function StatusLine({ view, className }: { view: TranscriptJurorView; className?: string }) {
  return (
    <p
      title={view.status}
      className={cn(
        "flex items-center gap-1.5 text-[13px] leading-snug text-muted-foreground",
        className,
      )}
    >
      <StateMark state={view.state} />
      <span className="min-w-0 flex-1 truncate">{shortStatus(view.status)}</span>
    </p>
  );
}

/** The one control on a tile and at the head of its panel. */
function TrailButton({
  expanded,
  steps,
  panelId,
  onToggle,
  className,
}: {
  expanded: boolean;
  steps: number;
  panelId: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      // Only points at a panel while one exists.
      {...(expanded ? { "aria-controls": panelId } : {})}
      className={cn(
        "flex min-h-10 items-center gap-1.5 text-left text-[13px] font-medium whitespace-nowrap",
        "text-foreground/70 transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <ArrowDown2
        size="12"
        variant="Bold"
        className={cn("shrink-0 transition-transform", expanded && "rotate-180")}
      />
      {/* Label and count read as one line; a five-column tile has no room for
          "Show the trail" plus a counter, so the article goes. */}
      <span className="truncate">{expanded ? "Hide trail" : "Show trail"}</span>
      {steps > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          · {steps} step{steps === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}

/**
 * One juror as a compact tile in the jury row: who it is, what it is doing,
 * and the one control that opens its trail. The trail itself opens in a
 * full-width panel below the row, so a narrow column never has to hold it.
 */
export function JurorCard({
  juror,
  view,
  expanded,
  onToggle,
  panelId,
  className,
}: {
  juror: TranscriptJuror;
  view: TranscriptJurorView;
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col border bg-card p-3 transition-colors",
        // The open seat carries the accent hairline, so the panel below it has
        // an owner even when several are open at once.
        expanded ? "border-sea" : "border-border",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <SeatGlyph juror={juror} />
        <div className="min-w-0 flex-1">
          <SeatName juror={juror} />
          {juror.role && (
            <RoleChip role={juror.role.replace(/_/g, " ")} className="mt-1.5" />
          )}
        </div>
      </div>

      <StatusLine view={view} className="mt-2.5" />

      {/* The control closes the tile, so every tile in a row ends the same. */}
      <TrailButton
        expanded={expanded}
        steps={view.steps.length}
        panelId={panelId}
        onToggle={onToggle}
        className="mt-auto w-full border-t border-border/60 pt-2.5"
      />
    </div>
  );
}

/**
 * One juror's opened trail, full width below the jury row: the research steps,
 * the sealed line while the vote is still sealed, and the revealed answer once
 * it opens. Headed by the seat's own identity, so a stack of panels reads.
 */
export function JurorTrailPanel({
  juror,
  view,
  onToggle,
  panelId,
  proof,
  loadingProof,
  className,
}: {
  juror: TranscriptJuror;
  view: TranscriptJurorView;
  onToggle: () => void;
  panelId: string;
  proof?: BrowserRunProof;
  loadingProof?: boolean;
  className?: string;
}) {
  const revealed = view.state === "revealed";
  const failed = view.state === "failed";
  const steps = view.steps.length;

  return (
    <section
      id={panelId}
      aria-label={`Juror ${juror.index} research trail`}
      className={cn(
        "border border-sea bg-card motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <SeatGlyph juror={juror} />
        <SeatName juror={juror} />
        {juror.role && <RoleChip role={juror.role.replace(/_/g, " ")} />}
        <StatusLine view={view} className="min-w-0" />
        <TrailButton
          expanded
          steps={steps}
          panelId={panelId}
          onToggle={onToggle}
          className="ml-auto"
        />
      </div>

      <div className="space-y-4 px-4 py-4">
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
    </section>
  );
}

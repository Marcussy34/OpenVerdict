"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { motion } from "motion/react";

import { ModelLogo } from "@/components/viz/model-logo";
import { RunProof } from "@/components/claim/run-proof";
import { StateBadge } from "@/components/claim/state-badge";
import { WeatherStrip } from "@/components/weather/weather-strip";
import {
  Clock,
  ArrowLeft2,
  ArrowRight2,
  CloseCircle,
  DocumentText,
  ExportSquare,
  Hierarchy,
  InfoCircle,
  Judge,
  Pause,
  Play,
  Radar,
  Refresh,
  ShieldTick,
  Warning2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useClaimEvents, type EventStreamStatus } from "@/components/use-claim-events";
import { useNow } from "@/components/use-now";
import { Hairline } from "@/components/landing/primitives";
import { CanvasHighlightProvider } from "@/components/viz/canvas-highlight";
import { DeliberationCanvas } from "@/components/viz/deliberation-canvas";
import { DeliberationChat } from "@/components/viz/deliberation-chat";
import { debateSeatsOf } from "@/components/viz/debate-turn";
import { HashChip } from "@/components/viz/hash-chip";
import { LiveDot } from "@/components/viz/live-dot";
import { LiveTranscript } from "@/components/viz/live-transcript";
import { ResearchFeed } from "@/components/viz/research-feed";
import { outcomeLabel } from "@/components/viz/seat-seal";
import type {
  AgentDirectoryEntry,
  ClaimInspection,
  DeliberationTurnPublic,
  ResolutionEvent,
} from "@/lib/engine/contract";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { CLAIM_MODE, CLAIM_STATE } from "@/lib/protocol/constants";
import { suiObjectUrl, suiTransactionUrl } from "@/lib/web/explorer";
import { juryFamiliesLabel } from "@/lib/web/weather-copy";
import { cn } from "@/lib/utils";
import {
  buildDeliberationGraph,
  familyOfModelId,
  type DeliberationGraph,
  type GraphNode,
} from "@/lib/viz/deliberation-graph";
import {
  researchFeed,
  researchStepWords,
  type ResearchFeedStep,
} from "@/lib/viz/research-feed";
import { buildTranscript } from "@/lib/viz/transcript";
import { deriveRunId, type BrowserRunProof } from "@/lib/verify/run-proof";
import { useReplay } from "@/components/viz/use-replay";

interface ClaimCanvasPageProps {
  params: Promise<{ id: string }>;
}

type ProofCache = Record<string, BrowserRunProof>;
type ReplayControls = ReturnType<typeof useReplay>;
type UnknownRecord = Record<string, unknown>;
/** The live transcript, or the deliberation graph, over the same record. */
type ClaimView = "live" | "graph";
/** The public agent directory: a seat's model and role before any reveal. */
type AgentDirectory = ReadonlyMap<string, { modelId?: string; role?: string }>;

const EMPTY_GRAPH: DeliberationGraph = { nodes: [], edges: [] };

const DEADLINE_LABELS: Array<{
  key: keyof ClaimInspection["deadlines"];
  label: string;
}> = [
  { key: "evidenceCutoffMs", label: "evidence" },
  { key: "proposalDeadlineMs", label: "proposal" },
  { key: "challengeDeadlineMs", label: "challenge" },
  { key: "firstCommitDeadlineMs", label: "phase 1 commit" },
  { key: "firstRevealDeadlineMs", label: "phase 1 reveal" },
  { key: "discussionDeadlineMs", label: "discussion" },
  { key: "secondCommitDeadlineMs", label: "phase 2 commit" },
  { key: "secondRevealDeadlineMs", label: "phase 2 reveal" },
];

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = asRecord(value)?.[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function proofTranscript(proof: BrowserRunProof): unknown {
  const bundle = proof.bundle;
  return bundle !== null && "transcript" in bundle
    ? bundle.transcript
    : undefined;
}

/** A failed seat's recorded trail, public on its failure record. */
function failureTranscript(proof: BrowserRunProof): unknown {
  const failure = (proof as { failure?: { transcript?: unknown } }).failure;
  return failure?.transcript ?? undefined;
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function nextDeadlineLine(claim: ClaimInspection, now: number | null): string {
  if (now === null) return "Next milestone loading";
  const next = DEADLINE_LABELS.find(({ key }) => claim.deadlines[key] > now);
  if (next === undefined) return "All protocol deadlines passed";
  return `Next: ${next.label} closes in ${formatRemaining(claim.deadlines[next.key] - now)}`;
}

function truthScoreLabel(scoreBps: number | null | undefined): string {
  if (scoreBps === null || scoreBps === undefined) return "N/A";
  const score = scoreBps / 100;
  return `${Number.isInteger(score) ? score.toFixed(0) : score.toFixed(2)}/100`;
}

function modelIdFromEvents(
  events: ResolutionEvent[],
  seatId: string,
  agentProfileId: string,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined || event.kind !== "inference_completed") continue;
    const eventSeatId = stringField(event.payload, "jurySeatId")
      ?? stringField(event.payload, "jury_seat_id");
    if (event.actorId !== agentProfileId && eventSeatId !== seatId) continue;
    return stringField(event.payload, "model_id")
      ?? stringField(event.payload, "modelId");
  }
  return undefined;
}

function searchResultUrls(node: GraphNode): string[] {
  const result = asRecord(node.detail?.result);
  const results = result?.results;
  if (!Array.isArray(results)) return [];
  return [...new Set(
    results.flatMap((value) => {
      const url = stringField(value, "url");
      return url === undefined ? [] : [url];
    }),
  )];
}

type StageTone = "form" | "research" | "reveal" | "discuss" | "yes" | "no";
type StageInfo = { key: string; label: string; tone: StageTone };

/** Plain-English explanations for seat failure statuses (the engine fails
    closed: malformed or unverifiable output never becomes a vote). */
const FAILURE_EXPLANATIONS: Record<string, string> = {
  INVALID_SCHEMA:
    "Every attempt from this juror's model came back malformed: the reply never matched the strict verdict schema (outcome, confidence in bps, citations). Malformed output is never turned into a vote, so the seat failed closed instead of guessing.",
  CITATION_INVALID:
    "The verdict cited evidence this juror had not actually opened through the engine, so the citation could not be verified and the vote was refused.",
  PROVIDER_ERROR:
    "The inference provider kept erroring before a valid reply arrived, so this seat never produced a verdict.",
  DEFAULT:
    "This seat failed before committing a valid vote and was excluded from settlement.",
};

// A paper chip with a hairline in the stage's own colour: the tone is carried
// by the mark and the words, never by a filled ground.
const STAGE_TONE: Record<StageTone, string> = {
  form: "border-chain/40 bg-card text-chain",
  research: "border-chain/40 bg-card text-chain",
  reveal: "border-sealed/40 bg-card text-sealed",
  discuss: "border-unsure/40 bg-card text-unsure",
  yes: "border-yes/40 bg-card text-yes",
  no: "border-no/40 bg-card text-no",
};

function earliestAt(
  graph: DeliberationGraph,
  kinds: ReadonlyArray<GraphNode["kind"]>,
): number | undefined {
  let earliest: number | undefined;
  for (const node of graph.nodes) {
    if (!kinds.includes(node.kind)) continue;
    if (earliest === undefined || node.atMs < earliest) earliest = node.atMs;
  }
  return earliest;
}

function finalStage(claim: ClaimInspection): StageInfo {
  const result = claim.result?.result;
  return {
    key: "finalized",
    label: `Finalized · ${result ?? "settled"}`,
    tone: result === "NO" || result === "UNRESOLVED" ? "no" : "yes",
  };
}

function formatLocalHourMinute(ms: number): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Attempt failures use short public copy while preserving the recorded reason. */
function attemptFailureSentence(claim: ClaimInspection): string {
  const chain = claim.attemptChain;
  const reason = chain?.gaveUpReason ?? chain?.void?.reason;
  let base = "Verification could not continue";
  if (reason === "MISSING_COMMIT") {
    base = "A seat missed the commit deadline";
  } else if (reason === "MISSING_REVEAL") {
    base = "A seat missed the reveal deadline";
  } else if (reason === "WEATHER_TIMEOUT") {
    base = "A juror family was unavailable for six hours";
  } else if (reason === "ATTEMPTS_EXHAUSTED") {
    base = "Three attempts were voided";
  } else if (chain?.void?.seatId !== undefined) {
    const seatIndex = claim.commitments.findIndex(
      (commitment) => commitment.jurySeatId === chain.void?.seatId,
    );
    const seatLabel = seatIndex >= 0 ? `Seat ${(seatIndex % 5) + 1}` : "A seat";
    const modelLabel = chain.void.modelId ?? "model unavailable";
    base = `${seatLabel} (${modelLabel}) failed: ${chain.void.message ?? chain.void.reason}`;
  } else if (chain?.void?.message) {
    base = chain.void.message;
  } else if (chain?.void?.reason !== undefined) {
    base = `Verification stopped: ${chain.void.reason}`;
  }

  if (!chain) return base;
  if (chain.status === "GAVE_UP") {
    return `Attempt ${chain.attempt} of ${chain.maxAttempts}: ${base}`;
  }
  return `Attempt ${chain.attempt} of ${chain.maxAttempts} voided: ${base}`;
}

/** The live protocol stage, from the on-chain claim state. */
function liveStage(claim: ClaimInspection, stranded: boolean): StageInfo {
  if (claim.attemptChain?.status === "VOIDED" || claim.attemptChain?.status === "GAVE_UP") {
    return {
      key: "voided",
      label: claim.attemptChain.status === "VOIDED"
        ? "Verification voided"
        : "Could not be completed",
      tone: "no",
    };
  }
  if (stranded) return { key: "stranded", label: "Discussion · expired", tone: "no" };
  switch (claim.state) {
    case CLAIM_STATE.CREATED:
    case CLAIM_STATE.PROPOSED:
    case CLAIM_STATE.CHALLENGED:
    case CLAIM_STATE.REVIEW_REQUESTED:
      return { key: "forming", label: "Jury forming", tone: "form" };
    case CLAIM_STATE.COMMIT_1:
      return { key: "commit1", label: "Round 1 · research & sealed votes", tone: "research" };
    case CLAIM_STATE.REVEAL_1:
      return { key: "reveal1", label: "Round 1 · votes revealing", tone: "reveal" };
    case CLAIM_STATE.DISCUSSION:
      return { key: "discussion", label: "Deliberation · jurors argue their case", tone: "discuss" };
    case CLAIM_STATE.COMMIT_2:
      return { key: "commit2", label: "Round 2 · research & sealed votes", tone: "research" };
    case CLAIM_STATE.REVEAL_2:
      return { key: "reveal2", label: "Round 2 · votes revealing", tone: "reveal" };
    case CLAIM_STATE.UNRESOLVED:
      return { key: "unresolved", label: "Finalized · unresolved", tone: "no" };
    case CLAIM_STATE.CANCELLED:
      return { key: "cancelled", label: "Cancelled", tone: "no" };
    default:
      return finalStage(claim);
  }
}

/** The stage at replay time t, from the milestones the graph carries. */
function replayStage(
  claim: ClaimInspection,
  graph: DeliberationGraph,
  t: number,
): StageInfo {
  const certificateAt = earliestAt(graph, ["certificate"]);
  const verdictAt = earliestAt(graph, ["verdict", "failure"]);
  const researchAt = earliestAt(graph, ["sealedAction", "search", "page"]);
  const committeeAt = earliestAt(graph, ["juror"]);
  if (certificateAt !== undefined && t >= certificateAt) return finalStage(claim);
  if (verdictAt !== undefined && t >= verdictAt) {
    return { key: "reveal", label: "Votes revealing", tone: "reveal" };
  }
  if (researchAt !== undefined && t >= researchAt) {
    return { key: "research", label: "Research & sealed votes", tone: "research" };
  }
  if (committeeAt !== undefined && t >= committeeAt) {
    return { key: "committee", label: "Committee selected", tone: "form" };
  }
  return { key: "submitted", label: "Claim submitted", tone: "form" };
}

/**
 * The stage the chrome bar is showing: the replayed moment while a replay
 * runs, the on-chain state otherwise. One source for the pill and the chip,
 * so the two never disagree about where the claim is.
 */
function chromeStage(
  claim: ClaimInspection,
  graph: DeliberationGraph,
  replay: ReplayControls,
  now: number | null,
): StageInfo {
  if (replay.active && replay.t < replay.endMs) {
    return replayStage(claim, graph, replay.t);
  }
  return liveStage(claim, now !== null && isStrandedDiscussion(claim, now));
}

/** A stage label as a plain sentence, for the chip beside the switcher. */
function stageWords(label: string): string {
  return label.replace(" · ", ": ").replace(" & ", " and ");
}

/**
 * What the page is following: a claim still running (live, or syncing while
 * this tab catches the event stream up), or a replay of a finished one. Null
 * once the record is closed, stranded or stopped: the state badge says what
 * happened and nothing on the page should still look alive.
 */
type LiveMode = "live" | "syncing" | "replay";

function claimLiveMode({
  claim,
  replay,
  now,
  streamStatus,
}: {
  claim: ClaimInspection;
  replay: ReplayControls;
  now: number | null;
  streamStatus: EventStreamStatus;
}): LiveMode | null {
  if (replay.active && replay.t < replay.endMs) return "replay";
  const stopped = claim.attemptChain?.status === "VOIDED"
    || claim.attemptChain?.status === "GAVE_UP";
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  if (stopped || stranded || claim.state >= 9) return null;
  return streamStatus === "connected" ? "live" : "syncing";
}

// LIVE is the one filled block on the bar: white on the accent, the same fill
// the active segment wears, because a running claim has to be unmistakable. A
// replay and a tab still catching up stay quiet hairline chips, so which mode
// the page is in reads at a glance.
const LIVE_CHIP_SKIN: Record<LiveMode, string> = {
  live: "border-transparent bg-primary text-white",
  syncing: "border-border bg-card text-muted-foreground",
  replay: "border-border bg-card text-muted-foreground",
};

const LIVE_CHIP_WORD: Record<LiveMode, string> = {
  live: "LIVE",
  syncing: "SYNCING",
  replay: "REPLAY",
};

/**
 * The broadcast marker: a claim still running says LIVE in the accent with a
 * pulsing dot, a replay says REPLAY in muted ink and stands still. Large
 * beside the view switcher, small in the left rail so the phone shows it too.
 */
function LiveChip({
  mode,
  stage,
  size = "lg",
}: {
  mode: LiveMode;
  stage?: string;
  size?: "sm" | "lg";
}) {
  const large = size === "lg";
  const filled = mode === "live";
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-2 border",
          // h-9 is the segmented control's own height, so the two line up.
          large ? "min-h-9 px-3.5" : "px-2.5 py-1",
          LIVE_CHIP_SKIN[mode],
        )}
      >
        <LiveDot
          tone={filled ? "onAccent" : mode === "replay" ? "idle" : "chain"}
          pulse={mode !== "replay"}
          size={large ? "lg" : "md"}
        />
        <span
          className={cn(
            large && filled
              // The one label that outgrows the micro scale: the micro classes
              // pin their own size, so this spells the same type out at 15px.
              ? "font-narrow text-[15px] leading-none font-medium tracking-[1.2px] uppercase"
              : cn("ov-micro", large ? "" : "ov-micro-sm"),
          )}
        >
          {LIVE_CHIP_WORD[mode]}
        </span>
      </span>
      {stage === undefined ? null : (
        <span className="truncate text-[13px] leading-snug text-muted-foreground">
          {stage}
        </span>
      )}
    </div>
  );
}

/**
 * Always-visible protocol stage pill at the centre-top of the stage. A live
 * claim shows its on-chain state; an active replay shows the stage at the
 * scrubbed moment. Remounting on stage change replays the entry motion, so
 * every state flip is visible.
 */
function StageBanner({
  claim,
  graph,
  replay,
  now,
  streamStatus,
}: {
  claim: ClaimInspection;
  graph: DeliberationGraph;
  replay: ReplayControls;
  now: number | null;
  streamStatus: EventStreamStatus;
}) {
  const mode = claimLiveMode({ claim, replay, now, streamStatus });
  const replaying = mode === "replay";
  const stage = chromeStage(claim, graph, replay, now);
  const attemptStopped = claim.attemptChain?.status === "VOIDED"
    || claim.attemptChain?.status === "GAVE_UP";
  const showAttempt = claim.attemptChain !== undefined
    && (claim.attemptChain.attempt > 1 || claim.attemptChain.status !== "ACTIVE");
  const settled = !replaying && (claim.state >= 9 || attemptStopped);
  // The LIVE chip beside the view switcher already carries the stage and
  // whether the page is following it, so the pill speaks only when it has
  // something the chip does not: which attempt this is, or a closed record.
  if (mode !== null && !showAttempt) return null;
  return (
    // Sits inside the stage's control bar, so it never floats over the record.
    // Only the voided-attempt notice still overlays, hung under the bar.
    <div className="relative flex min-w-0 items-center">
      <motion.div
        key={`${stage.key}-${claim.attemptChain?.status ?? "none"}-${replaying ? "replay" : "live"}`}
        initial={{ opacity: 0, y: -12, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={cn(
          "flex items-center gap-2.5 border px-3.5 py-2",
          STAGE_TONE[stage.tone],
        )}
      >
        {attemptStopped ? (
          <CloseCircle size="14" variant="Bold" />
        ) : settled ? (
          <ShieldTick size="14" variant="Bold" />
        ) : mode === null ? (
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-current" />
          </span>
        ) : null}
        {showAttempt ? (
          <span
            className={cn(
              "ov-micro ov-micro-sm whitespace-nowrap",
              // The inner hairline separates the attempt from the stage label.
              // Alone in the pill it would only draw a box inside a box.
              mode === null && "border border-current/25 px-1.5",
            )}
          >
            Attempt {claim.attemptChain?.attempt} of {claim.attemptChain?.maxAttempts}
          </span>
        ) : null}
        {mode === null ? (
          <span className="ov-micro ov-micro-sm whitespace-nowrap">{stage.label}</span>
        ) : null}
      </motion.div>
      {attemptStopped && claim.attemptChain !== undefined ? (
        <div className="absolute top-full right-0 z-30 mt-3 flex w-max max-w-[min(42rem,80vw)] flex-col items-center gap-3 border border-no/30 bg-card px-5 py-4 text-[13px] text-muted-foreground shadow-lg">
          <div className="flex w-full flex-col gap-1 text-center">
            <span className="flex items-center justify-center gap-2 font-medium text-foreground">
              <CloseCircle size="16" variant="Bold" className="shrink-0 text-no" />
              <span className="break-words">{attemptFailureSentence(claim)}</span>
            </span>
            <p className="text-[13px] leading-[1.5] text-muted-foreground">
              {claim.attemptChain.status === "GAVE_UP"
                ? "All-or-nothing: no partial verdict was finalized. This verification gave up; submit the claim again to start a fresh one."
                : "All-or-nothing: no partial verdict is ever finalized. The engine relaunches automatically once all three families and web search answer."}
            </p>
          </div>

          {/* The weather only matters while a relaunch is still possible. */}
          {claim.attemptChain.status === "VOIDED" ? <WeatherStrip compact /> : null}

          {claim.attemptChain.status === "VOIDED" && !claim.attemptChain.relaunchedAs && claim.attemptChain.void?.atMs ? (
            <p className="font-mono text-[11px] text-muted-foreground/80">
              gives up at {formatLocalHourMinute(claim.attemptChain.void.atMs + 6 * 60 * 60 * 1000)}
            </p>
          ) : null}

          {(claim.attemptChain.previousAttempts.length > 0 || claim.attemptChain.relaunchedAs !== undefined) && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border pt-2">
              {claim.attemptChain.previousAttempts.map((attempt) => (
                <Link
                  key={attempt.claimId}
                  href={`/claims/${attempt.claimId}`}
                  className="inline-flex min-h-10 items-center gap-1 px-1 font-medium text-chain hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
                >
                  <ArrowLeft2 size="13" variant="Bold" />
                  Previous attempt {attempt.attempt}
                </Link>
              ))}
              {claim.attemptChain.relaunchedAs !== undefined ? (
                <Link
                  href={`/claims/${claim.attemptChain.relaunchedAs}`}
                  className="inline-flex min-h-10 items-center gap-1 px-1 font-medium text-chain hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
                >
                  <Refresh size="13" variant="Bold" />
                  Relaunched as attempt {Math.min(
                    claim.attemptChain.attempt + 1,
                    claim.attemptChain.maxAttempts,
                  )}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LeftRail({
  claim,
  now,
  replay,
  liveMode,
}: {
  claim: ClaimInspection;
  now: number | null;
  replay: ReplayControls;
  liveMode: LiveMode | null;
}) {
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  const terminal = claim.state >= 9;
  const sealedCount = claim.commitments.filter((commitment) => commitment.committed).length;
  const revealedCount = claim.commitments.filter((commitment) => commitment.revealed).length;

  return (
    // Paper, like the rest of the page. The accent appears only where it acts:
    // the replay button and the report link.
    <div className="flex min-h-full flex-col gap-7 bg-card p-5 md:p-6">
      <div className="relative space-y-3">
        <Link
          href="/claims"
          className="-ml-1 inline-flex min-h-8 w-fit items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
        >
          {/* Nudged up one pixel: the glyph sits low in its box next to 13px text. */}
          <ArrowLeft2 size="13" className="relative -top-px shrink-0" />
          All claims
        </Link>
        <p className="ov-micro ov-micro-sm text-muted-foreground">Claim assertion</p>
        <p className="text-[17px] leading-snug font-medium tracking-[-0.01em] text-foreground">
          {claim.statement}
        </p>
      </div>

      <div className="space-y-3">
        <Hairline />
        <StateBadge
          state={claim.state}
          stranded={stranded}
          attemptStatus={claim.attemptChain?.status}
        />
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground tabular-nums">
          <Clock size="14" variant="Bold" className="text-[var(--ov-accent)]" />
          {nextDeadlineLine(claim, now)}
        </p>
        {/* The same broadcast marker as the chrome bar, one size down: the
            phone opens this rail as a drawer and must say LIVE here too. */}
        {liveMode === null ? null : <LiveChip mode={liveMode} size="sm" />}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="border border-border bg-card p-3">
          <dt className="ov-micro ov-micro-sm text-muted-foreground">Sealed</dt>
          <dd className="mt-1 font-mono text-xl font-medium text-foreground">{sealedCount}/5</dd>
        </div>
        <div className="border border-border bg-card p-3">
          <dt className="ov-micro ov-micro-sm text-muted-foreground">Revealed</dt>
          <dd className="mt-1 font-mono text-xl font-medium text-foreground">{revealedCount}/5</dd>
        </div>
      </dl>

      {terminal ? (
        <div className="space-y-3 border border-yes/30 bg-yes/5 p-4">
          <div>
            <p className="ov-micro ov-micro-sm text-muted-foreground">Truth Score</p>
            <p className="mt-1 font-mono text-2xl font-medium text-yes">
              {truthScoreLabel(claim.result?.truthScoreBps)}
            </p>
          </div>
          <HashChip
            value={claim.result?.certificateId}
            label="certificate"
            kind="object"
            tone="yes"
            className="max-w-full"
          />
        </div>
      ) : null}

      {terminal ? (
        <div className="space-y-3">
          <Hairline />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="ov-micro ov-micro-sm text-muted-foreground">Replay</p>
              {!replay.active && (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Watch this verification at 30x
                </p>
              )}
            </div>
            {/* One of the two accent-filled controls on the page. */}
            <button
              type="button"
              onClick={replay.toggle}
              className="ov-micro ov-micro-sm inline-flex min-h-9 items-center gap-2 bg-primary px-3 text-white transition-colors hover:bg-[var(--ov-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
            >
              {replay.playing ? (
                <Pause size="14" variant="Bold" />
              ) : (
                <Play size="14" variant="Bold" />
              )}
              {replay.playing ? "Pause" : "Play"}
            </button>
          </div>
          <input
            type="range"
            aria-label="Replay position"
            min={replay.startMs}
            max={replay.endMs}
            step={500}
            value={replay.t}
            onChange={(event) => replay.seek(Number(event.currentTarget.value))}
            className="w-full accent-[var(--ov-accent)]"
          />
          <div className="grid grid-cols-4 gap-2">
            {([1, 5, 10, 30] as const).map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={replay.speed === speed}
                onClick={() => replay.setSpeed(speed)}
                className={cn(
                  "ov-micro ov-micro-sm min-h-9 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]",
                  replay.speed === speed
                    ? "border-[var(--ov-accent)] bg-sea/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* The rail's primary action: the accent, filled. */}
      <Link
        href={`/claims/${claim.claimId}/report`}
        className="ov-micro ov-micro-sm mt-auto inline-flex min-h-11 items-center justify-center gap-2 bg-primary text-white transition-colors hover:bg-[var(--ov-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
      >
        <DocumentText size="15" variant="Bold" />
        Full report
      </Link>
    </div>
  );
}

/** Ink on paper, with the accent filling only the segment you are on. */
const SEGMENT_SKIN =
  "text-muted-foreground hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-white";

/**
 * Two segments, Chat and Graph, with the same labels in both views so the
 * control reads as one switch (owner: "it should just be chat and graph").
 * Replay lives in the left rail's Replay card, not here.
 */
function StageControls({
  view,
  onChange,
}: {
  view: ClaimView;
  onChange: (next: ClaimView) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border border-border bg-card p-1 text-foreground">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(next) => {
          // Radix clears the value when the pressed segment is pressed again;
          // one view is always showing, so only a real target moves it.
          if (next === "live" || next === "graph") onChange(next);
        }}
      >
        <ToggleGroupItem value="live" className={SEGMENT_SKIN}>
          <Radar size="13" variant="Bold" />
          Chat
        </ToggleGroupItem>
        <ToggleGroupItem value="graph" className={SEGMENT_SKIN}>
          <Hierarchy size="13" variant="Bold" />
          Graph
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function SeatInspector({
  claim,
  events,
  graph,
  node,
  proofsByRunId,
  researchSteps,
  seatNumbers,
}: {
  claim: ClaimInspection;
  events: ResolutionEvent[];
  graph: DeliberationGraph;
  node: GraphNode;
  proofsByRunId: ProofCache;
  researchSteps: Map<string, ResearchFeedStep[]>;
  /** Juror numbers as the Live view and the graph ring count them. */
  seatNumbers: ReadonlyMap<string, number>;
}) {
  const seatId = node.seatId;
  if (seatId === undefined) return null;
  const seatIndex = claim.commitments.findIndex(
    (commitment) => commitment.jurySeatId === seatId,
  );
  const commitment = claim.commitments[seatIndex];
  if (seatIndex < 0 || commitment === undefined) return null;

  const phase: 1 | 2 = seatIndex < 5 ? 1 : 2;
  const jurorNumber = seatNumbers.get(seatId) ?? seatIndex + 1;
  const runId = node.runId ?? deriveRunId(claim.claimId, seatId, phase);
  const proof = proofsByRunId[runId];
  const seatNode = graph.nodes.find(
    (candidate) => candidate.kind === "juror" && candidate.seatId === seatId,
  );
  const verdictNode = graph.nodes.find(
    (candidate) => candidate.kind === "verdict" && candidate.seatId === seatId,
  );
  const modelId = proof?.bundle?.request.model
    ?? commitment.modelId
    ?? modelIdFromEvents(events, seatId, commitment.agentProfileId);
  const family = node.family
    ?? seatNode?.family
    ?? familyOfModelId(modelId);
  const familyOrdinal = graph.nodes
    .filter((candidate) => candidate.kind === "juror" && candidate.family === family)
    .findIndex((candidate) => candidate.seatId === seatId);
  const output = proof?.bundle?.validatedOutput;
  const outcome = node.outcome
    ?? verdictNode?.outcome
    ?? outcomeLabel(commitment.outcome)
    ?? output?.outcome;
  const confidenceBps = node.confidenceBps
    ?? verdictNode?.confidenceBps
    ?? commitment.confidenceBps
    ?? output?.confidenceBps;
  const steps = researchSteps.get(seatId) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ModelLogo
          modelId={modelId}
          variant={familyOrdinal < 0 ? seatIndex : familyOrdinal}
          size={56}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Juror {jurorNumber}
          </p>
          <p className="mt-1 break-all text-[11px] leading-relaxed text-muted-foreground">
            {modelId ?? "Model id unavailable"}
          </p>
          <div className="mt-1">
            <HashChip value={seatId} label="seat" kind="object" tone="muted" head={8} tail={6} />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            Outcome
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {outcome ?? "Pending"}
          </dd>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            Confidence
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground tabular-nums">
            {confidenceBps === undefined
              ? "Pending"
              : `${confidenceBps} bps`}
          </dd>
        </div>
      </dl>

      {steps.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            Research feed
          </p>
          {/* Live public tool calls; the vote stays sealed until reveal. */}
          <ResearchFeed steps={steps} />
        </div>
      )}

      {proof !== undefined ? (
        <RunProof
          key={`proof-${commitment.jurySeatId}`}
          claimId={claim.claimId}
          runId={runId}
          seatLabel={phase === 2
            ? `Juror ${jurorNumber}, table vote`
            : `Juror ${jurorNumber}, phase ${phase}`}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
          The public run proof will appear here after this seat is revealed.
        </p>
      )}
    </div>
  );
}

function NodeInspector({
  claim,
  events,
  graph,
  node,
  proofsByRunId,
  researchSteps,
  seatNumbers,
}: {
  claim: ClaimInspection;
  events: ResolutionEvent[];
  graph: DeliberationGraph;
  node: GraphNode | null;
  proofsByRunId: ProofCache;
  researchSteps: Map<string, ResearchFeedStep[]>;
  seatNumbers: ReadonlyMap<string, number>;
}) {
  if (node === null) {
    return (
      <div className="grid min-h-52 place-items-center p-6 text-center">
        <div className="space-y-2">
          <InfoCircle size="22" variant="Bold" className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Click any node</p>
        </div>
      </div>
    );
  }

  if (node.kind === "juror" || node.kind === "verdict") {
    return (
      <SeatInspector
        claim={claim}
        events={events}
        graph={graph}
        node={node}
        proofsByRunId={proofsByRunId}
        researchSteps={researchSteps}
        seatNumbers={seatNumbers}
      />
    );
  }

  if (node.kind === "sealedAction") {
    const kind = stringField(node.detail, "kind") === "search" ? "search" : "page open";
    const seatFailure = claim.commitments.find(
      (commitment) => commitment.jurySeatId === node.seatId,
    )?.failureStatus;
    // The live feed publishes the query and the URLs of this step as it lands;
    // only the answer, the vote and the reasoning wait for the reveal.
    const liveStep = researchSteps
      .get(node.seatId ?? "")
      ?.find((step) => step.ordinal === node.stepIndex && step.kind !== "answer");
    return (
      <div className="space-y-4">
        <span className="inline-flex rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
          {liveStep === undefined ? "Sealed" : "Live"} {kind}
        </span>
        {liveStep !== undefined ? (
          <p className="text-sm leading-relaxed text-foreground/85">
            At this point in its research, this juror{" "}
            {researchStepWords(liveStep)}. The step itself is public as it
            happens; the answer it draws, its vote and its reasoning stay
            sealed until the reveal.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/85">
            This juror performed a {kind} at this point in its research. What was
            {kind === "search" ? " searched" : " opened"} stays sealed inside the
            juror&apos;s run bundle so no other juror can copy the research and no
            observer can front-run the vote while the round is live.
          </p>
        )}
        {seatFailure !== undefined ? (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
            This seat later failed ({seatFailure}) and never revealed, so the
            step&apos;s content remains sealed. The seat&apos;s recorded attempt
            log is public on its failure record: click the juror avatar for it.
          </p>
        ) : (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
            It unlocks automatically the moment this juror reveals: the sealed
            tick is then replaced by the real step, checkable against the
            bundle&apos;s hashes.
          </p>
        )}
        {node.stepIndex !== undefined ? (
          <p className="font-mono text-[10px] text-muted-foreground">Step {node.stepIndex + 1}</p>
        ) : null}
        {node.seatId !== undefined ? (
          <HashChip value={node.seatId} label="seat" kind="object" tone="muted" head={8} tail={6} />
        ) : null}
      </div>
    );
  }

  if (node.kind === "search") {
    const urls = searchResultUrls(node);
    const query = stringField(node.detail?.action, "query") ?? node.label;
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Search query
          </p>
          <p className="text-sm leading-relaxed text-foreground/85">{query}</p>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase",
              node.intent === "challenge"
                ? "border-unsure/40 bg-unsure/12 text-unsure"
                : "border-chain/35 bg-sea/10 text-chain",
            )}
          >
            {node.intent ?? "support"}
          </span>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Results
          </p>
          {urls.length === 0 ? (
            <p className="text-xs text-muted-foreground">No result URLs recorded.</p>
          ) : (
            <ul className="space-y-2">
              {urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 break-all text-xs leading-relaxed text-chain hover:underline"
                  >
                    <ExportSquare size="13" className="mt-0.5 shrink-0" />
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (node.kind === "page") {
    const opened = asRecord(node.detail?.opened);
    const result = asRecord(node.detail?.result);
    const contentHash = stringField(opened, "contentHash")
      ?? stringField(result, "contentHash");
    const cited = graph.edges.some(
      (edge) => edge.kind === "citation" && edge.from === node.id,
    ) || Array.isArray(node.detail?.citations);
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Opened page
          </p>
          {node.url === undefined ? (
            <p className="text-xs text-muted-foreground">No URL recorded.</p>
          ) : (
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 break-all text-xs leading-relaxed text-chain hover:underline"
            >
              <ExportSquare size="13" className="mt-0.5 shrink-0" />
              {node.url}
            </a>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Content hash
          </p>
          <HashChip
            value={contentHash}
            kind="hash"
            full
            className="max-w-full bg-surface text-muted-foreground"
          />
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase",
            cited
              ? "border-yes/35 bg-yes/10 text-yes"
              : "border-border bg-surface text-muted-foreground",
          )}
        >
          <ShieldTick size="12" variant="Bold" />
          {cited ? "Cited by verdict" : "Not cited"}
        </span>
      </div>
    );
  }

  if (node.kind === "failure") {
    const status = stringField(node.detail, "failureStatus") ?? node.label;
    const message = stringField(node.detail, "message")
      ?? stringField(node.detail?.failure, "message");
    const explanation = FAILURE_EXPLANATIONS[status] ?? FAILURE_EXPLANATIONS.DEFAULT;
    return (
      <div className="space-y-4">
        <span className="inline-flex rounded-full border border-no/35 bg-no/10 px-2 py-1 text-[10px] font-semibold text-no uppercase">
          {status}
        </span>
        <p className="text-sm leading-relaxed text-foreground/85">{explanation}</p>
        {message !== undefined ? (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {message}
          </p>
        ) : null}
        <div className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
          A failed seat never becomes a vote: the engine fails closed and the
          claim settles on the seats that did reveal. The seat keeps its full
          attempt log and research trail on the public record.
        </div>
        {node.seatId !== undefined ? (
          <HashChip value={node.seatId} label="seat" kind="object" tone="muted" head={8} tail={6} />
        ) : null}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Click the juror avatar connected to this node for the full proof
          and attempt-by-attempt log.
        </p>
      </div>
    );
  }

  if (node.kind === "certificate") {
    const result = claim.result;
    const certificateId = stringField(node.detail, "certificateId") ?? result?.certificateId;
    const digest = stringField(node.detail, "digest") ?? result?.digest;
    const outcome = result?.result ?? "UNRESOLVED";
    const revealedCount = claim.commitments.filter((commitment) => commitment.revealed).length;
    const familyCount = new Set(
      graph.nodes
        .filter((candidate) => candidate.kind === "juror"
          && candidate.family !== undefined && candidate.family !== "unknown")
        .map((candidate) => candidate.family),
    ).size;
    // The engine's own count wins when it is there: it comes from the
    // committee's seats and carries the on-chain degraded flag.
    const familiesLabel =
      juryFamiliesLabel(claim.jury) ||
      (familyCount > 0 ? `${familyCount} model families` : "");
    const tone = outcome === "YES"
      ? { frame: "border-yes/40 ring-yes/15", text: "text-yes", badge: "bg-yes/10 text-yes" }
      : outcome === "NO"
        ? { frame: "border-no/40 ring-no/15", text: "text-no", badge: "bg-no/10 text-no" }
        : { frame: "border-unsure/40 ring-unsure/15", text: "text-unsure", badge: "bg-unsure/12 text-unsure" };
    return (
      <div className="space-y-4">
        {/* The certificate itself: a framed document, not a bare hash. */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border-2 bg-card p-5 ring-4 ring-inset",
            tone.frame,
          )}
        >
          <div aria-hidden className="pointer-events-none absolute inset-2 rounded-xl border border-border" />
          <div className="relative space-y-4 text-center">
            <span className={cn("mx-auto grid size-12 place-items-center rounded-full", tone.badge)}>
              <ShieldTick size="26" variant="Bold" />
            </span>
            <div>
              <p className="text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                OpenVerdict
              </p>
              <p className="mt-1 text-[11px] font-bold tracking-[0.2em] text-foreground/80 uppercase">
                Resolution certificate
              </p>
            </div>
            <div>
              <p className={cn("text-3xl font-bold tracking-tight", tone.text)}>{outcome}</p>
              <p className="mt-1 font-mono text-sm text-foreground/80">
                Truth Score {truthScoreLabel(result?.truthScoreBps)}
              </p>
            </div>
            <p className="mx-auto max-w-[30ch] text-xs leading-relaxed text-muted-foreground">
              “{claim.statement}”
            </p>
            <p className="text-[10px] text-muted-foreground">
              {revealedCount}/{claim.commitments.length} jurors revealed
              {familiesLabel ? ` · ${familiesLabel}` : ""} · drawn by stake
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              Finalized {new Date(node.atMs).toLocaleString()} · Sui testnet
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            On-chain record
          </p>
          <HashChip
            value={certificateId}
            label="certificate"
            kind="object"
            tone={outcome === "YES" ? "yes" : "default"}
            className="max-w-full bg-surface"
          />
          <HashChip
            value={claim.claimId}
            label="claim"
            kind="object"
            className="max-w-full bg-surface text-muted-foreground"
          />
          {digest !== undefined ? (
            <HashChip
              value={digest}
              label="finalize tx"
              kind="tx"
              className="max-w-full bg-surface text-muted-foreground"
            />
          ) : null}
          {claim.committeeId !== undefined ? (
            <HashChip
              value={claim.committeeId}
              label="committee"
              kind="object"
              className="max-w-full bg-surface text-muted-foreground"
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {certificateId !== undefined ? (
            <a
              href={suiObjectUrl(certificateId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-semibold text-chain hover:underline"
            >
              <ExportSquare size="14" variant="Bold" />
              Certificate on SuiVision
            </a>
          ) : null}
          {digest !== undefined ? (
            <a
              href={suiTransactionUrl(digest)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-semibold text-chain hover:underline"
            >
              <ExportSquare size="14" variant="Bold" />
              Finalize transaction
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (node.kind === "claim") {
    const sealedCount = claim.commitments.filter((commitment) => commitment.committed).length;
    const revealedCount = claim.commitments.filter((commitment) => commitment.revealed).length;
    const failedCount = claim.commitments.filter(
      (commitment) => commitment.failureStatus !== undefined,
    ).length;
    const result = claim.result;
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Claim on trial
          </p>
          <p className="text-sm leading-relaxed text-foreground/85">{claim.statement}</p>
        </div>

        {result !== undefined ? (
          <div className="space-y-3 rounded-xl border border-yes/25 bg-yes/8 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Verdict · Truth Score
              </p>
              <span className="rounded-full bg-yes/20 px-2 py-0.5 text-[11px] font-bold text-yes">
                {result.result}
              </span>
            </div>
            <p className="font-mono text-xl font-semibold text-yes">
              {truthScoreLabel(result.truthScoreBps)}
            </p>
            <HashChip
              value={result.certificateId}
              label="certificate"
              kind="object"
              tone="yes"
              className="max-w-full bg-surface"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Resolution criteria
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {claim.resolutionCriteria}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Jury</dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {revealedCount}/{claim.commitments.length} revealed
            </dd>
            <dd className="mt-0.5 text-[11px] text-muted-foreground">
              {sealedCount} sealed{failedCount > 0 ? `, ${failedCount} failed` : ""}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Mode</dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {claim.mode === CLAIM_MODE.DIRECT_REVIEW ? "Direct review" : "Optimistic"}
            </dd>
            <dd className="mt-0.5 text-[11px] text-muted-foreground">
              {juryFamiliesLabel(claim.jury) || "3 model families"}, drawn by stake
            </dd>
          </div>
        </dl>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Evidence cutoff
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {new Date(claim.deadlines.evidenceCutoffMs).toLocaleString()}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Jurors judge the statement as of this moment; later coverage does
            not count.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            On chain
          </p>
          <HashChip
            value={claim.claimId}
            label="claim"
            kind="object"
            className="max-w-full bg-surface text-muted-foreground"
          />
          {claim.committeeId !== undefined ? (
            <HashChip
              value={claim.committeeId}
              label="committee"
              kind="object"
              className="max-w-full bg-surface text-muted-foreground"
            />
          ) : null}
          <a
            href={suiObjectUrl(claim.claimId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs font-semibold text-chain hover:underline"
          >
            <ExportSquare size="14" variant="Bold" />
            Open claim object in SuiVision
          </a>
        </div>

        <Link
          href={`/claims/${claim.claimId}/report`}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground/80 transition-colors hover:bg-surface hover:text-foreground"
        >
          <DocumentText size="14" variant="Bold" />
          Full audit report
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {node.kind}
      </p>
      <p className="text-sm leading-relaxed text-foreground/80">{node.label}</p>
    </div>
  );
}

function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-auto border-t border-border bg-card lg:hidden">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur">
        <p className="ov-micro ov-micro-sm text-muted-foreground">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="grid size-9 place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
        >
          <CloseCircle size="18" variant="Bold" />
        </button>
      </div>
      {children}
    </div>
  );
}

function ClaimCanvasContent({ params }: ClaimCanvasPageProps) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const now = useNow();
  const { events, status: streamStatus } = useClaimEvents(id);
  const hasClaimRef = useRef(false);
  const requestedProofsRef = useRef(new Set<string>());
  const autoReplayStartedRef = useRef(false);

  const [claim, setClaim] = useState<ClaimInspection | null>(null);
  const [proofsByRunId, setProofsByRunId] = useState<ProofCache>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(380);
  const [trailHighlightId, setTrailHighlightId] = useState<string | null>(null);
  const resizePointerRef = useRef<number | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // The two views of the same record: the live transcript and the graph.
  const [view, setView] = useState<ClaimView | null>(null);
  const [agents, setAgents] = useState<AgentDirectory>(new Map());
  const [loadingRunIds, setLoadingRunIds] = useState<ReadonlySet<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      if (!hasClaimRef.current) setLoading(true);
      setEngineOffline(false);
      setNotFound(false);

      const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
      if (inspectRes.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (inspectRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!inspectRes.ok) {
        setEngineOffline(true);
        return;
      }

      const inspectData: ClaimInspection = await inspectRes.json();
      setClaim(inspectData);
      hasClaimRef.current = true;
    } catch {
      setEngineOffline(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
        if (ignore) return;
        if (inspectRes.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (inspectRes.status === 404) {
          setNotFound(true);
          return;
        }
        if (!inspectRes.ok) {
          setEngineOffline(true);
          return;
        }

        const inspectData: ClaimInspection = await inspectRes.json();
        if (!ignore) {
          setClaim(inspectData);
          hasClaimRef.current = true;
        }
      } catch {
        if (!ignore) setEngineOffline(true);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void init();
    return () => {
      ignore = true;
    };
  }, [id]);

  const eventCount = events.length;
  useEffect(() => {
    if (eventCount === 0) return;
    const timer = setTimeout(() => {
      void loadData();
    }, 800);
    return () => clearTimeout(timer);
  }, [eventCount, loadData]);

  // The public agent directory names each seat's model and role from the draw,
  // long before any run is revealed. A failure only costs the role chips.
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/agents", { cache: "no-store" });
        if (!response.ok || ignore) return;
        const body = await response.json() as { agents?: AgentDirectoryEntry[] };
        if (ignore) return;
        setAgents(
          new Map(
            (body.agents ?? []).map((agent) => [
              agent.agentProfileId,
              { modelId: agent.modelId, role: agent.role },
            ]),
          ),
        );
      } catch {
        /* the transcript falls back to the record's model ids */
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (claim === null) return;
    const pending = claim.commitments.flatMap((commitment, index) => {
      if (!commitment.revealed) return [];
      const phase: 1 | 2 = index < 5 ? 1 : 2;
      const runId = deriveRunId(claim.claimId, commitment.jurySeatId, phase);
      if (requestedProofsRef.current.has(runId)) return [];
      requestedProofsRef.current.add(runId);
      return [{ runId }];
    });
    if (pending.length === 0) return;

    void Promise.all(
      pending.map(async ({ runId }) => {
        try {
          const response = await fetch(
            `/api/claims/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/proof`,
            { cache: "no-store" },
          );
          if (!response.ok) return null;
          return [runId, await response.json() as BrowserRunProof] as const;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      if (loaded.every((entry) => entry === null)) return;
      setProofsByRunId((current) => {
        const next = { ...current };
        for (const entry of loaded) {
          if (entry === null) continue;
          const [runId, proof] = entry;
          next[runId] = proof;
        }
        return next;
      });
    });
  }, [claim, id]);

  /** Fetch a juror's run proof the first time its card is opened. */
  const requestProofs = useCallback((runIds: string[]) => {
    const pending = runIds.filter((runId) => !requestedProofsRef.current.has(runId));
    if (pending.length === 0) return;
    for (const runId of pending) requestedProofsRef.current.add(runId);
    setLoadingRunIds((current) => new Set([...current, ...pending]));
    void Promise.all(
      pending.map(async (runId) => {
        try {
          const response = await fetch(
            `/api/claims/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/proof`,
            { cache: "no-store" },
          );
          if (!response.ok) return null;
          return [runId, await response.json() as BrowserRunProof] as const;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      setLoadingRunIds((current) => {
        const next = new Set(current);
        for (const runId of pending) next.delete(runId);
        return next;
      });
      setProofsByRunId((current) => {
        const next = { ...current };
        for (const entry of loaded) {
          if (entry === null) continue;
          next[entry[0]] = entry[1];
        }
        return next;
      });
    });
  }, [id]);

  const proofs = useMemo(
    () => Object.values(proofsByRunId).map((proof) => ({
      runId: proof.runId,
      jurySeatId: proof.jurySeatId,
      transcript: proofTranscript(proof) ?? failureTranscript(proof),
      output: proof.bundle?.validatedOutput,
      revealed: proof.revealed,
    })),
    [proofsByRunId],
  );

  // The live research feed, per seat: one lane's public tool calls in order.
  const researchSteps = useMemo(() => researchFeed(events), [events]);

  // The same record read as a conversation, with one card per juror. The
  // fetched proofs fill the steps of claims that ran before the live feed.
  const transcript = useMemo(
    () => claim === null
      ? { entries: [], jurors: [] }
      : buildTranscript({
          claim,
          events,
          agents,
          proofs: Object.values(proofsByRunId),
        }),
    [agents, claim, events, proofsByRunId],
  );

  // One juror number for both of a juror's seats, so the graph's ring, the
  // Live view and the inspector all count the jury the same way.
  const seatNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const juror of transcript.jurors) {
      for (const seat of juror.seats) numbers.set(seat.seatId, juror.index);
    }
    return numbers;
  }, [transcript.jurors]);

  const graph = useMemo(() => {
    if (claim === null) return EMPTY_GRAPH;
    return buildDeliberationGraph({
      claim,
      proofs,
      events,
      // useNow is null during SSR, so this keeps graph timestamps finite.
      // eslint-disable-next-line react-hooks/purity
      nowMs: now ?? Date.now(),
    });
  }, [claim, events, now, proofs]);

  // Live debate turns: inspection snapshot + PUBLIC_NOW stream events merged
  // by ordinal, so a reload and a live tab render the same conversation.
  const deliberationTurns = useMemo(() => {
    const byOrdinal = new Map<number, DeliberationTurnPublic>();
    for (const turn of claim?.deliberation ?? []) byOrdinal.set(turn.ordinal, turn);
    for (const event of events) {
      if (event.kind !== "DELIBERATION_TURN") continue;
      const payload = event.payload as Partial<DeliberationTurnPublic>;
      if (typeof payload.ordinal !== "number" || typeof payload.jurySeatId !== "string") continue;
      const existing = byOrdinal.get(payload.ordinal);
      byOrdinal.set(
        payload.ordinal,
        existing === undefined
          ? payload as DeliberationTurnPublic
          : { ...existing, ...payload },
      );
    }
    return [...byOrdinal.values()].sort((left, right) => left.ordinal - right.ordinal);
  }, [claim, events]);

  // The debaters, numbered the way the debate numbers them, so the Live view's
  // table section and the graph dock read the same conversation.
  const debateSeats = useMemo(() => (claim === null ? [] : debateSeatsOf(claim)), [claim]);
  const replayable =
    claim !== null
    && (claim.state >= 9
      || claim.attemptChain?.status === "VOIDED"
      || claim.attemptChain?.status === "GAVE_UP");
  const replay = useReplay(graph, replayable);

  // The live transcript is the way in; ?view=graph opens the canvas instead
  // (the switcher takes over from there). The default is deliberately not
  // derived from the claim's state: settling must never move the reader.
  const resolvedView: ClaimView =
    view ?? (searchParams.get("view") === "graph" ? "graph" : "live");

  // Autoplay replay once when requested via ?replay=1 on a terminal claim.
  // We wait until events or graph nodes have loaded so the replay has a valid span.
  const autoReplay = searchParams.get("replay") === "1";
  const isTerminal = claim !== null && claim.state >= 9;

  useEffect(() => {
    if (!autoReplay || !isTerminal || autoReplayStartedRef.current) return;
    if (events.length === 0 && streamStatus === "connecting") return;
    if (graph.nodes.length === 0) return;

    autoReplayStartedRef.current = true;
    replay.setSpeed(30);
    replay.start();
  }, [autoReplay, isTerminal, events.length, streamStatus, graph.nodes.length, replay]);
  const selectedNode = useMemo(
    () => replay.visible.nodes.find((node) => node.id === selectedId) ?? null,
    [replay.visible.nodes, selectedId],
  );
  const handleSelect = useCallback((node: GraphNode | null) => {
    setSelectedId(node?.id ?? null);
    setTrailHighlightId(null);
  }, []);
  // One answer for the whole page: LIVE, SYNCING, REPLAY, or nothing at all.
  const liveMode = claim === null
    ? null
    : claimLiveMode({ claim, replay, now, streamStatus });

  if (loading) {
    return (
      <div className="space-y-6 px-5 py-16 md:px-7">
        <div className="h-9 w-52 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-56 animate-pulse rounded-2xl bg-surface" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (engineOffline) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-unsure/10 text-unsure">
          <Warning2 size="26" variant="Bold" />
        </span>
        <h1 className="text-xl font-semibold text-ocean">Engine offline (503)</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          The OpenVerdict verification engine backend is offline or not wired yet. Claim data
          cannot be retrieved from the active RPC node.
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => loadData()}>
            <Refresh size="14" variant="Bold" />
            Retry
          </Button>
          <Button asChild size="sm" className="min-h-[40px]">
            <Link href="/verify">Independent verifier</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || claim === null) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-ocean">Claim not found</h1>
        <p className="text-sm text-muted-foreground">
          No claim exists with this object id.
        </p>
        <HashChip value={id} kind="object" full className="max-w-md" />
        <Button asChild size="sm" className="mt-2 min-h-[40px]">
          <Link href="/claims">Back to claims directory</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
      <CollapsibleRail>
        <LeftRail claim={claim} now={now} replay={replay} liveMode={liveMode} />
      </CollapsibleRail>

      <main className="relative flex h-dvh flex-1 flex-col overflow-hidden">
        {/* One chrome bar across the stage: the view switcher, the replay
            control and the protocol stage. Paper ground and a hairline, and in
            the flow rather than over it, so the record scrolls beneath it
            instead of under a floating pill. */}
        <div className="relative z-40 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <StageControls view={resolvedView} onChange={setView} />
            {liveMode === null ? null : (
              <LiveChip
                mode={liveMode}
                stage={stageWords(chromeStage(claim, graph, replay, now).label)}
              />
            )}
          </div>
          <StageBanner claim={claim} graph={graph} replay={replay} now={now} streamStatus={streamStatus} />
        </div>

        <div className="relative min-h-0 flex-1">
        {resolvedView === "live" ? (
          <LiveTranscript
            claimId={claim.claimId}
            statementFallback={claim.statement}
            entries={transcript.entries}
            jurors={transcript.jurors}
            debate={{
              seats: debateSeats,
              live: claim.state === CLAIM_STATE.DISCUSSION,
              convergedAfterExchange: claim.debateConvergedAfterExchange ?? null,
            }}
            // The replay cursor, or the whole record when it is not running.
            t={replay.active ? replay.t : Number.POSITIVE_INFINITY}
            onOpenGraph={() => setView("graph")}
            replay={{ active: replay.active }}
            proofsByRunId={proofsByRunId}
            onRequestProof={requestProofs}
            loadingRunIds={loadingRunIds}
          />
        ) : (
          <>
            <DeliberationCanvas
              graph={replay.visible}
              selectedId={selectedId}
              onSelect={handleSelect}
              externalHighlightId={trailHighlightId}
              seatNumbers={seatNumbers}
            />

            <DeliberationChat
              turns={
                replay.active && replay.t < replay.endMs
                  ? deliberationTurns.filter((turn) => turn.atMs <= replay.t)
                  : deliberationTurns
              }
              seats={debateSeats}
              live={claim.state === CLAIM_STATE.DISCUSSION}
              convergedAfterExchange={claim.debateConvergedAfterExchange ?? null}
            />
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setLeftOpen(true);
            setInspectorOpen(false);
          }}
          className="ov-micro ov-micro-sm absolute bottom-5 left-4 z-20 inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 text-foreground backdrop-blur lg:hidden"
        >
          <DocumentText size="16" variant="Bold" />
          Claim
        </button>
        {resolvedView === "graph" && (
          <button
            type="button"
            onClick={() => {
              setInspectorOpen(true);
              setLeftOpen(false);
            }}
            className="ov-micro ov-micro-sm absolute right-4 bottom-5 z-20 inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 text-foreground backdrop-blur lg:hidden"
          >
            <Judge size="16" variant="Bold" />
            Inspect
          </button>
        )}
        {/* The inspector exists only while a node is selected; clicking empty
            canvas deselects and gives the stage the full width. It OVERLAYS the
            canvas (absolute, not in flow) so opening or closing it never
            resizes the stage and the node positions stay exactly put. It lives
            INSIDE the stage, not beside <main>, so inset-y-0 means "below the
            chrome bar", never behind it. */}
        {resolvedView === "graph" && selectedNode !== null && (
          <aside
            style={{ width: inspectorWidth }}
            className="@container absolute inset-y-0 right-0 z-30 hidden overflow-hidden max-w-[calc(100vw-28rem)] border-l border-border bg-card shadow-[-28px_0_60px_rgb(0_0_0/8%)] lg:block"
          >
            {/* Drag this edge to widen or narrow the panel. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-sea/40 active:bg-sea/60"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                resizePointerRef.current = event.pointerId;
              }}
              onPointerMove={(event) => {
                if (resizePointerRef.current !== event.pointerId) return;
                const max = Math.max(320, Math.min(680, window.innerWidth - 460));
                const next = Math.round(window.innerWidth - event.clientX);
                setInspectorWidth(Math.min(Math.max(next, 320), max));
              }}
              onPointerUp={(event) => {
                if (resizePointerRef.current !== event.pointerId) return;
                resizePointerRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (resizePointerRef.current !== event.pointerId) return;
                resizePointerRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            />
            {/* Only this region scrolls, so the resize handle spans the whole
                panel edge no matter how far down the content goes. */}
            <div className="ov-scroll h-full overflow-x-hidden overflow-y-auto overscroll-contain p-5">
              <CanvasHighlightProvider onHighlight={setTrailHighlightId}>
                <NodeInspector
                  claim={claim}
                  events={events}
                  graph={graph}
                  node={selectedNode}
                  proofsByRunId={proofsByRunId}
                  researchSteps={researchSteps}
                  seatNumbers={seatNumbers}
                />
              </CanvasHighlightProvider>
            </div>
          </aside>
        )}
        </div>
      </main>

      {leftOpen || inspectorOpen ? (
        <button
          type="button"
          aria-label="Close open sheet"
          onClick={() => {
            setLeftOpen(false);
            setInspectorOpen(false);
          }}
          className="fixed inset-0 z-40 bg-black/55 lg:hidden"
        />
      ) : null}

      {leftOpen ? (
        <MobileSheet title="Claim details" onClose={() => setLeftOpen(false)}>
          <LeftRail claim={claim} now={now} replay={replay} liveMode={liveMode} />
        </MobileSheet>
      ) : null}

      {inspectorOpen && resolvedView === "graph" ? (
        <MobileSheet title="Node inspector" onClose={() => setInspectorOpen(false)}>
          <div className="@container p-5">
            <CanvasHighlightProvider onHighlight={setTrailHighlightId}>
              <NodeInspector
                claim={claim}
                events={events}
                graph={graph}
                node={selectedNode}
                proofsByRunId={proofsByRunId}
                researchSteps={researchSteps}
                seatNumbers={seatNumbers}
              />
            </CanvasHighlightProvider>
          </div>
        </MobileSheet>
      ) : null}
    </div>
  );
}

function CollapsibleRail({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div
        className={cn(
          "relative hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out lg:block",
          open ? "w-[320px]" : "w-0",
        )}
      >
        <aside
          className={cn(
            "ov-scroll h-dvh w-[320px] overflow-y-auto border-r border-border bg-card transition-transform duration-300 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {children}
        </aside>
      </div>
      {/* One toggle tab riding the panel's outer edge: it protrudes into the
          canvas and slides with the rail as it opens and closes. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Hide the claim panel" : "Show the claim panel"}
        className={cn(
          "absolute top-1/2 z-40 hidden -translate-y-1/2 border border-l-0 border-border bg-card py-3 pr-1 pl-0.5 text-muted-foreground transition-[left] duration-300 ease-out hover:text-foreground lg:grid",
          open ? "left-[320px]" : "left-0",
        )}
      >
        {open ? <ArrowLeft2 size="14" /> : <ArrowRight2 size="14" />}
      </button>
    </>
  );
}

export default function ClaimCanvasPage(props: ClaimCanvasPageProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 px-5 py-16 md:px-7">
          <div className="h-9 w-52 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-56 animate-pulse rounded-2xl bg-surface" />
          <div className="h-72 animate-pulse rounded-2xl bg-surface" />
        </div>
      }
    >
      <ClaimCanvasContent {...props} />
    </Suspense>
  );
}

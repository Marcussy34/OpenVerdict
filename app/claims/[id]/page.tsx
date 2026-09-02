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

import { JurorAvatar } from "@/components/agents/avatar";
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
  InfoCircle,
  Judge,
  Pause,
  Play,
  Refresh,
  ShieldTick,
  Warning2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useClaimEvents, type EventStreamStatus } from "@/components/use-claim-events";
import { useNow } from "@/components/use-now";
import { CanvasHighlightProvider } from "@/components/viz/canvas-highlight";
import { DeliberationCanvas } from "@/components/viz/deliberation-canvas";
import { DeliberationChat } from "@/components/viz/deliberation-chat";
import { HashChip } from "@/components/viz/hash-chip";
import { outcomeLabel } from "@/components/viz/seat-seal";
import type { ClaimInspection, DeliberationTurnPublic, ResolutionEvent } from "@/lib/engine/contract";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { CLAIM_MODE, CLAIM_STATE } from "@/lib/protocol/constants";
import { suiObjectUrl, suiTransactionUrl } from "@/lib/web/explorer";
import { cn } from "@/lib/utils";
import {
  buildDeliberationGraph,
  familyOfModelId,
  type DeliberationGraph,
  type GraphNode,
  type JurorFamily,
} from "@/lib/viz/deliberation-graph";
import { deriveRunId, type BrowserRunProof } from "@/lib/verify/run-proof";
import { useReplay } from "@/components/viz/use-replay";

interface ClaimCanvasPageProps {
  params: Promise<{ id: string }>;
}

type ProofCache = Record<string, BrowserRunProof>;
type ReplayControls = ReturnType<typeof useReplay>;
type UnknownRecord = Record<string, unknown>;

const EMPTY_GRAPH: DeliberationGraph = { nodes: [], edges: [] };
const JUROR_AVATARS: Partial<Record<JurorFamily, string[]>> = {
  deepseek: [
    "/media/agents/deepseek-1.png",
    "/media/agents/deepseek-2.png",
    "/media/agents/deepseek-3.png",
  ],
  kimi: [
    "/media/agents/kimi-1.png",
    "/media/agents/kimi-2.png",
  ],
  minimax: [
    "/media/agents/minimax-1.png",
    "/media/agents/minimax-2.png",
  ],
};

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

const STAGE_TONE: Record<StageTone, string> = {
  form: "border-[#2f8bff]/50 bg-[#0b2a55]/95 text-[#a8cbff]",
  research: "border-[#2f8bff]/50 bg-[#0b2a55]/95 text-[#a8cbff]",
  reveal: "border-[#b3a7ff]/50 bg-[#231d55]/95 text-[#cdc5ff]",
  discuss: "border-[#ffc65c]/50 bg-[#3a2a0c]/95 text-[#ffd98c]",
  yes: "border-[#43e5a0]/50 bg-[#0b3527]/95 text-[#43e5a0]",
  no: "border-[#ff8d84]/50 bg-[#3a1512]/95 text-[#ff8d84]",
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
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  const replaying = replay.active && replay.t < replay.endMs;
  const stage = replaying
    ? replayStage(claim, graph, replay.t)
    : liveStage(claim, stranded);
  const attemptStopped = claim.attemptChain?.status === "VOIDED"
    || claim.attemptChain?.status === "GAVE_UP";
  const showAttempt = claim.attemptChain !== undefined
    && (claim.attemptChain.attempt > 1 || claim.attemptChain.status !== "ACTIVE");
  const settled = !replaying && (claim.state >= 9 || attemptStopped);
  // Broadcast-style marker: the claim is still running AND this tab follows
  // the live event stream (amber SYNCING while the stream catches up).
  const live = !replaying && !stranded && !attemptStopped && claim.state < 9;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex flex-col items-center gap-2 px-4 xl:top-4">
      <motion.div
        key={`${stage.key}-${claim.attemptChain?.status ?? "none"}-${replaying ? "replay" : "live"}`}
        initial={{ opacity: 0, y: -12, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={cn(
          "flex items-center gap-2.5 rounded-full border px-4 py-2 shadow-xl backdrop-blur-md",
          STAGE_TONE[stage.tone],
        )}
      >
        {attemptStopped ? (
          <CloseCircle size="14" variant="Bold" />
        ) : settled ? (
          <ShieldTick size="14" variant="Bold" />
        ) : (
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-current" />
          </span>
        )}
        {showAttempt ? (
          <span className="rounded-full border border-white/15 bg-black/15 px-2 py-0.5 text-[9px] font-extrabold tracking-[0.14em] whitespace-nowrap uppercase">
            Attempt {claim.attemptChain?.attempt} of {claim.attemptChain?.maxAttempts}
          </span>
        ) : null}
        <span className="text-[11px] font-bold tracking-[0.16em] whitespace-nowrap uppercase">
          {replaying ? `Replay · ${stage.label}` : stage.label}
        </span>
        {live ? (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-[0.22em]",
              streamStatus === "connected"
                ? "bg-[#ff4545]/15 text-[#ff7a70]"
                : "bg-[#ffc65c]/15 text-[#ffd98c]",
            )}
          >
            <span aria-hidden className="relative flex size-1.5">
              {streamStatus === "connected" ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-70 motion-reduce:hidden" />
              ) : null}
              <span className="relative inline-flex size-1.5 rounded-full bg-current" />
            </span>
            {streamStatus === "connected" ? "LIVE" : "SYNCING"}
          </span>
        ) : null}
      </motion.div>
      {attemptStopped && claim.attemptChain !== undefined ? (
        <div className="pointer-events-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-[#ff8d84]/30 bg-[#07162f]/95 px-5 py-4 text-xs text-white/75 shadow-xl backdrop-blur-md">
          <div className="flex w-full flex-col gap-1 text-center">
            <span className="flex items-center justify-center gap-2 font-medium text-white">
              <CloseCircle size="16" variant="Bold" className="shrink-0 text-[#ff8d84]" />
              <span className="break-words">{attemptFailureSentence(claim)}</span>
            </span>
            <p className="text-[11px] text-white/60">
              {claim.attemptChain.status === "GAVE_UP"
                ? "All-or-nothing: no partial verdict was finalized. This verification gave up; submit the claim again to start a fresh one."
                : "All-or-nothing: no partial verdict is ever finalized. The engine relaunches automatically once all three families and web search answer."}
            </p>
          </div>

          {/* The weather only matters while a relaunch is still possible. */}
          {claim.attemptChain.status === "VOIDED" ? <WeatherStrip compact tone="dark" /> : null}

          {claim.attemptChain.status === "VOIDED" && !claim.attemptChain.relaunchedAs && claim.attemptChain.void?.atMs ? (
            <p className="text-[11px] text-white/50">
              gives up at {formatLocalHourMinute(claim.attemptChain.void.atMs + 6 * 60 * 60 * 1000)}
            </p>
          ) : null}

          {(claim.attemptChain.previousAttempts.length > 0 || claim.attemptChain.relaunchedAs !== undefined) && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-white/10 pt-2">
              {claim.attemptChain.previousAttempts.map((attempt) => (
                <Link
                  key={attempt.claimId}
                  href={`/claims/${attempt.claimId}`}
                  className="inline-flex min-h-10 items-center gap-1 rounded px-1 font-semibold text-[#72b6ff] transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                >
                  <ArrowLeft2 size="13" variant="Bold" />
                  Previous attempt {attempt.attempt}
                </Link>
              ))}
              {claim.attemptChain.relaunchedAs !== undefined ? (
                <Link
                  href={`/claims/${claim.attemptChain.relaunchedAs}`}
                  className="inline-flex min-h-10 items-center gap-1 rounded px-1 font-semibold text-[#72b6ff] transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
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
}: {
  claim: ClaimInspection;
  now: number | null;
  replay: ReplayControls;
}) {
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  const terminal = claim.state >= 9;
  const sealedCount = claim.commitments.filter((commitment) => commitment.committed).length;
  const revealedCount = claim.commitments.filter((commitment) => commitment.revealed).length;

  return (
    <div className="flex min-h-full flex-col gap-6 p-5 text-white">
      <div className="space-y-3">
        <Link
          href="/claims"
          className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-full px-1 py-0.5 text-[11px] font-semibold text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft2 size="13" />
          All claims
        </Link>
        <p className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
          Claim assertion
        </p>
        <p className="text-[15px] leading-relaxed font-medium text-white/90">
          {claim.statement}
        </p>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-5">
        <StateBadge
          state={claim.state}
          stranded={stranded}
          attemptStatus={claim.attemptChain?.status}
          className="border-white/15 bg-white/5 text-white/80"
        />
        <p className="flex items-center gap-2 text-xs text-white/60 tabular-nums">
          <Clock size="14" variant="Bold" className="text-[#72b6ff]" />
          {nextDeadlineLine(claim, now)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <dt className="text-[10px] font-semibold tracking-[0.12em] text-white/45 uppercase">
            Sealed
          </dt>
          <dd className="mt-1 font-mono text-xl font-semibold text-white">
            {sealedCount}/5
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <dt className="text-[10px] font-semibold tracking-[0.12em] text-white/45 uppercase">
            Revealed
          </dt>
          <dd className="mt-1 font-mono text-xl font-semibold text-white">
            {revealedCount}/5
          </dd>
        </div>
      </dl>

      {terminal ? (
        <div className="space-y-3 rounded-xl border border-yes/25 bg-yes/8 p-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.12em] text-white/45 uppercase">
              Truth Score
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-yes">
              {truthScoreLabel(claim.result?.truthScoreBps)}
            </p>
          </div>
          <HashChip
            value={claim.result?.certificateId}
            label="certificate"
            tone="yes"
            className="max-w-full bg-white/5"
            href={claim.result?.certificateId ? suiObjectUrl(claim.result.certificateId) : undefined}
          />
        </div>
      ) : null}

      {terminal ? (
        <div className="space-y-3 border-t border-white/10 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
                Replay
              </p>
              {!replay.active && (
                <p className="mt-0.5 text-[11px] text-white/55">
                  Watch this verification at 30x
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={replay.toggle}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#0e76ff] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#2a87ff] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
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
            className="w-full accent-[#0e76ff]"
          />
          <div className="grid grid-cols-3 gap-2">
            {([1, 10, 30] as const).map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={replay.speed === speed}
                onClick={() => replay.setSpeed(speed)}
                className={cn(
                  "min-h-8 rounded-lg border text-xs font-semibold transition-colors",
                  replay.speed === speed
                    ? "border-[#0e76ff] bg-[#0e76ff]/20 text-white"
                    : "border-white/10 bg-white/[0.04] text-white/55 hover:text-white",
                )}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Link
        href={`/claims/${claim.claimId}/report`}
        className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <DocumentText size="15" variant="Bold" />
        Full report
      </Link>
    </div>
  );
}

function SeatInspector({
  claim,
  events,
  graph,
  node,
  proofsByRunId,
}: {
  claim: ClaimInspection;
  events: ResolutionEvent[];
  graph: DeliberationGraph;
  node: GraphNode;
  proofsByRunId: ProofCache;
}) {
  const seatId = node.seatId;
  if (seatId === undefined) return null;
  const seatIndex = claim.commitments.findIndex(
    (commitment) => commitment.jurySeatId === seatId,
  );
  const commitment = claim.commitments[seatIndex];
  if (seatIndex < 0 || commitment === undefined) return null;

  const phase: 1 | 2 = seatIndex < 5 ? 1 : 2;
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <JurorAvatar
          family={family}
          ordinal={familyOrdinal < 0 ? seatIndex : familyOrdinal}
          avatarKey={commitment.agentProfileId}
          size={56}
          className="ring-2 ring-white/15"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            Juror {seatIndex + 1}
          </p>
          <p className="mt-1 break-all text-[11px] leading-relaxed text-white/70">
            {modelId ?? "Model id unavailable"}
          </p>
          <p className="mt-1 font-mono text-[10px] tracking-tight text-white/45">
            Seat {seatId.slice(0, 8)}…{seatId.slice(-6)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">
            Outcome
          </dt>
          <dd className="mt-1 text-sm font-semibold text-white">
            {outcome ?? "Pending"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">
            Confidence
          </dt>
          <dd className="mt-1 text-sm font-semibold text-white tabular-nums">
            {confidenceBps === undefined
              ? "Pending"
              : `${confidenceBps} bps`}
          </dd>
        </div>
      </dl>

      {proof !== undefined ? (
        <RunProof
          key={`proof-${commitment.jurySeatId}`}
          claimId={claim.claimId}
          runId={runId}
          seatLabel={phase === 2
            ? `Seat ${seatIndex + 1}, table vote`
            : `Seat ${seatIndex + 1}, phase ${phase}`}
        />
      ) : (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/45">
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
}: {
  claim: ClaimInspection;
  events: ResolutionEvent[];
  graph: DeliberationGraph;
  node: GraphNode | null;
  proofsByRunId: ProofCache;
}) {
  if (node === null) {
    return (
      <div className="grid min-h-52 place-items-center p-6 text-center">
        <div className="space-y-2">
          <InfoCircle size="22" variant="Bold" className="mx-auto text-white/35" />
          <p className="text-sm text-white/55">Click any node</p>
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
      />
    );
  }

  if (node.kind === "sealedAction") {
    const kind = stringField(node.detail, "kind") === "search" ? "search" : "page open";
    const seatFailure = claim.commitments.find(
      (commitment) => commitment.jurySeatId === node.seatId,
    )?.failureStatus;
    return (
      <div className="space-y-4">
        <span className="inline-flex rounded-full border border-white/20 bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/75 uppercase">
          Sealed {kind}
        </span>
        <p className="text-sm leading-relaxed text-white/85">
          This juror performed a {kind} at this point in its research. What was
          {kind === "search" ? " searched" : " opened"} stays sealed inside the
          juror&apos;s run bundle so no other juror can copy the research and no
          observer can front-run the vote while the round is live.
        </p>
        {seatFailure !== undefined ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/70">
            This seat later failed ({seatFailure}) and never revealed, so the
            step&apos;s content remains sealed. The seat&apos;s recorded attempt
            log is public on its failure record: click the juror avatar for it.
          </p>
        ) : (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/70">
            It unlocks automatically the moment this juror reveals: the sealed
            tick is then replaced by the real step, checkable against the
            bundle&apos;s hashes.
          </p>
        )}
        {node.stepIndex !== undefined ? (
          <p className="font-mono text-[10px] text-white/45">Step {node.stepIndex + 1}</p>
        ) : null}
        {node.seatId !== undefined ? (
          <p className="font-mono text-[10px] text-white/45">
            Seat {node.seatId.slice(0, 8)}…{node.seatId.slice(-6)}
          </p>
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
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Search query
          </p>
          <p className="text-sm leading-relaxed text-white/90">{query}</p>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase",
              node.intent === "challenge"
                ? "border-[#ff8f3f]/40 bg-[#ff8f3f]/15 text-[#ffb077]"
                : "border-[#0e76ff]/40 bg-[#0e76ff]/15 text-[#72b6ff]",
            )}
          >
            {node.intent ?? "support"}
          </span>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Results
          </p>
          {urls.length === 0 ? (
            <p className="text-xs text-white/45">No result URLs recorded.</p>
          ) : (
            <ul className="space-y-2">
              {urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 break-all text-xs leading-relaxed text-[#72b6ff] hover:underline"
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
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Opened page
          </p>
          {node.url === undefined ? (
            <p className="text-xs text-white/45">No URL recorded.</p>
          ) : (
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 break-all text-xs leading-relaxed text-[#72b6ff] hover:underline"
            >
              <ExportSquare size="13" className="mt-0.5 shrink-0" />
              {node.url}
            </a>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Content hash
          </p>
          <HashChip
            value={contentHash}
            label="hash"
            full
            className="max-w-full bg-white/5 text-white/75"
          />
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase",
            cited
              ? "border-yes/35 bg-yes/10 text-yes"
              : "border-white/10 bg-white/[0.04] text-white/45",
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
        <p className="text-sm leading-relaxed text-white/85">{explanation}</p>
        {message !== undefined ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed whitespace-pre-wrap text-white/70">
            {message}
          </p>
        ) : null}
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/60">
          A failed seat never becomes a vote: the engine fails closed and the
          claim settles on the seats that did reveal. The seat keeps its full
          attempt log and research trail on the public record.
        </div>
        {node.seatId !== undefined ? (
          <p className="font-mono text-[10px] text-white/45">
            Seat {node.seatId.slice(0, 8)}…{node.seatId.slice(-6)}
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-white/50">
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
    const tone = outcome === "YES"
      ? { frame: "border-[#43e5a0]/40 ring-[#43e5a0]/15", text: "text-[#43e5a0]", badge: "bg-[#0e7a4b]/35 text-[#43e5a0]" }
      : outcome === "NO"
        ? { frame: "border-[#ff8d84]/40 ring-[#ff8d84]/15", text: "text-[#ff8d84]", badge: "bg-[#a02121]/35 text-[#ff8d84]" }
        : { frame: "border-[#ffc65c]/40 ring-[#ffc65c]/15", text: "text-[#ffc65c]", badge: "bg-[#8a5a00]/40 text-[#ffc65c]" };
    return (
      <div className="space-y-4">
        {/* The certificate itself: a framed document, not a bare hash. */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border-2 bg-[#071a36] p-5 ring-4 ring-inset",
            tone.frame,
          )}
        >
          <div aria-hidden className="pointer-events-none absolute inset-2 rounded-xl border border-white/10" />
          <div className="relative space-y-4 text-center">
            <span className={cn("mx-auto grid size-12 place-items-center rounded-full", tone.badge)}>
              <ShieldTick size="26" variant="Bold" />
            </span>
            <div>
              <p className="text-[9px] font-bold tracking-[0.3em] text-white/45 uppercase">
                OpenVerdict
              </p>
              <p className="mt-1 text-[11px] font-bold tracking-[0.2em] text-white/80 uppercase">
                Resolution certificate
              </p>
            </div>
            <div>
              <p className={cn("text-3xl font-bold tracking-tight", tone.text)}>{outcome}</p>
              <p className="mt-1 font-mono text-sm text-white/80">
                Truth Score {truthScoreLabel(result?.truthScoreBps)}
              </p>
            </div>
            <p className="mx-auto max-w-[30ch] text-xs leading-relaxed text-white/70">
              “{claim.statement}”
            </p>
            <p className="text-[10px] text-white/50">
              {revealedCount}/{claim.commitments.length} jurors revealed
              {familyCount > 0 ? ` · ${familyCount} model families` : ""} · equal weight
            </p>
            <p className="text-[10px] text-white/40 tabular-nums">
              Finalized {new Date(node.atMs).toLocaleString()} · Sui testnet
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            On-chain record
          </p>
          <HashChip
            value={certificateId}
            label="certificate"
            tone={outcome === "YES" ? "yes" : "default"}
            href={certificateId ? suiObjectUrl(certificateId) : undefined}
            className="max-w-full bg-white/5"
          />
          <HashChip
            value={claim.claimId}
            label="claim"
            href={suiObjectUrl(claim.claimId)}
            className="max-w-full bg-white/5 text-white/75"
          />
          {digest !== undefined ? (
            <HashChip
              value={digest}
              label="finalize tx"
              href={suiTransactionUrl(digest)}
              className="max-w-full bg-white/5 text-white/75"
            />
          ) : null}
          {claim.committeeId !== undefined ? (
            <HashChip
              value={claim.committeeId}
              label="committee"
              href={suiObjectUrl(claim.committeeId)}
              className="max-w-full bg-white/5 text-white/75"
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {certificateId !== undefined ? (
            <a
              href={`https://suiscan.xyz/testnet/object/${certificateId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#72b6ff] hover:underline"
            >
              <ExportSquare size="14" variant="Bold" />
              Certificate on Suiscan
            </a>
          ) : null}
          {digest !== undefined ? (
            <a
              href={`https://suiscan.xyz/testnet/tx/${digest}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#72b6ff] hover:underline"
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
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Claim on trial
          </p>
          <p className="text-sm leading-relaxed text-white/90">{claim.statement}</p>
        </div>

        {result !== undefined ? (
          <div className="space-y-3 rounded-xl border border-yes/25 bg-yes/8 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-white/45 uppercase">
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
              tone="yes"
              href={suiObjectUrl(result.certificateId)}
              className="max-w-full bg-white/5"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Resolution criteria
          </p>
          <p className="text-xs leading-relaxed text-white/75">
            {claim.resolutionCriteria}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">Jury</dt>
            <dd className="mt-1 text-sm font-semibold text-white">
              {revealedCount}/{claim.commitments.length} revealed
            </dd>
            <dd className="mt-0.5 text-[11px] text-white/55">
              {sealedCount} sealed{failedCount > 0 ? `, ${failedCount} failed` : ""}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <dt className="text-[10px] tracking-[0.12em] text-white/40 uppercase">Mode</dt>
            <dd className="mt-1 text-sm font-semibold text-white">
              {claim.mode === CLAIM_MODE.DIRECT_REVIEW ? "Direct review" : "Optimistic"}
            </dd>
            <dd className="mt-0.5 text-[11px] text-white/55">
              3 model families, equal weight
            </dd>
          </div>
        </dl>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Evidence cutoff
          </p>
          <p className="text-xs text-white/75 tabular-nums">
            {new Date(claim.deadlines.evidenceCutoffMs).toLocaleString()}
          </p>
          <p className="text-[11px] leading-relaxed text-white/45">
            Jurors judge the statement as of this moment; later coverage does
            not count.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            On chain
          </p>
          <HashChip
            value={claim.claimId}
            label="claim"
            href={suiObjectUrl(claim.claimId)}
            className="max-w-full bg-white/5 text-white/75"
          />
          {claim.committeeId !== undefined ? (
            <HashChip
              value={claim.committeeId}
              label="committee"
              href={suiObjectUrl(claim.committeeId)}
              className="max-w-full bg-white/5 text-white/75"
            />
          ) : null}
          <a
            href={`https://suiscan.xyz/testnet/object/${claim.claimId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#72b6ff] hover:underline"
          >
            <ExportSquare size="14" variant="Bold" />
            Open claim object in Suiscan
          </a>
        </div>

        <Link
          href={`/claims/${claim.claimId}/report`}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <DocumentText size="14" variant="Bold" />
          Full audit report
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
        {node.kind}
      </p>
      <p className="text-sm leading-relaxed text-white/80">{node.label}</p>
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
    <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-auto rounded-t-2xl border-t border-white/15 bg-[#07162f] shadow-2xl lg:hidden">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#07162f]/95 px-5 py-3 backdrop-blur">
        <p className="text-xs font-semibold tracking-[0.12em] text-white/65 uppercase">
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="grid size-9 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
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
  const replay = useReplay(graph, claim !== null && claim.state >= 9);

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
        <HashChip value={id} full className="max-w-md" />
        <Button asChild size="sm" className="mt-2 min-h-[40px]">
          <Link href="/claims">Back to claims directory</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#04122b] text-white">
      <CollapsibleRail>
        <LeftRail claim={claim} now={now} replay={replay} />
      </CollapsibleRail>

      <main className="relative h-dvh flex-1 overflow-hidden">
        <StageBanner claim={claim} graph={graph} replay={replay} now={now} streamStatus={streamStatus} />
        <DeliberationCanvas
          graph={replay.visible}
          selectedId={selectedId}
          onSelect={handleSelect}
          avatars={JUROR_AVATARS}
          externalHighlightId={trailHighlightId}
        />

        <DeliberationChat
          turns={
            replay.active && replay.t < replay.endMs
              ? deliberationTurns.filter((turn) => turn.atMs <= replay.t)
              : deliberationTurns
          }
          commitments={claim.commitments}
          live={claim.state === CLAIM_STATE.DISCUSSION}
          convergedAfterExchange={claim.debateConvergedAfterExchange ?? null}
        />

        <button
          type="button"
          onClick={() => {
            setLeftOpen(true);
            setInspectorOpen(false);
          }}
          className="absolute bottom-5 left-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-[#07162f]/90 px-4 text-xs font-semibold text-white shadow-xl backdrop-blur lg:hidden"
        >
          <DocumentText size="16" variant="Bold" />
          Claim
        </button>
        <button
          type="button"
          onClick={() => {
            setInspectorOpen(true);
            setLeftOpen(false);
          }}
          className="absolute right-4 bottom-5 z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-[#07162f]/90 px-4 text-xs font-semibold text-white shadow-xl backdrop-blur lg:hidden"
        >
          <Judge size="16" variant="Bold" />
          Inspect
        </button>
      </main>

      {/* The inspector exists only while a node is selected; clicking empty
          canvas deselects and gives the stage the full width. It OVERLAYS the
          canvas (absolute, not in flow) so opening or closing it never
          resizes the stage and the node positions stay exactly put. */}
      {selectedNode !== null && (
        <aside
          style={{ width: inspectorWidth }}
          className="ov-inspector-dark @container absolute inset-y-0 right-0 z-30 hidden overflow-hidden max-w-[calc(100vw-28rem)] border-l border-white/12 bg-[#061532]/95 shadow-[-28px_0_60px_rgba(1,8,22,0.55)] backdrop-blur-md lg:block"
        >
          {/* Drag this edge to widen or narrow the panel. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector"
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-[#0e76ff]/50 active:bg-[#0e76ff]/70"
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
              />
            </CanvasHighlightProvider>
          </div>
        </aside>
      )}

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
          <LeftRail claim={claim} now={now} replay={replay} />
        </MobileSheet>
      ) : null}

      {inspectorOpen ? (
        <MobileSheet title="Node inspector" onClose={() => setInspectorOpen(false)}>
          <div className="ov-inspector-dark @container p-5">
            <CanvasHighlightProvider onHighlight={setTrailHighlightId}>
              <NodeInspector
                claim={claim}
                events={events}
                graph={graph}
                node={selectedNode}
                proofsByRunId={proofsByRunId}
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
            "h-dvh w-[320px] overflow-y-auto border-r border-white/10 bg-white/[0.04] transition-transform duration-300 ease-out",
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
          "absolute top-1/2 z-40 hidden -translate-y-1/2 rounded-r-lg border border-l-0 border-white/15 bg-[#07162f]/90 py-3 pr-1 pl-0.5 text-white/70 shadow-xl transition-[left] duration-300 ease-out hover:bg-white/10 hover:text-white lg:grid",
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

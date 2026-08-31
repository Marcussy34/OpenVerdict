"use client";

import Link from "next/link";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { JurorAvatar } from "@/components/agents/avatar";
import { RunProof } from "@/components/claim/run-proof";
import { StateBadge } from "@/components/claim/state-badge";
import {
  Clock,
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
import { useClaimEvents } from "@/components/use-claim-events";
import { useNow } from "@/components/use-now";
import { DeliberationCanvas } from "@/components/viz/deliberation-canvas";
import { HashChip } from "@/components/viz/hash-chip";
import { outcomeLabel } from "@/components/viz/seat-seal";
import type { ClaimInspection, ResolutionEvent } from "@/lib/engine/contract";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
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
          />
        </div>
      ) : null}

      {terminal ? (
        <div className="space-y-3 border-t border-white/10 pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
              Replay
            </p>
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
            {([1, 10, 60] as const).map((speed) => (
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
          size={56}
          className="ring-2 ring-white/15"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            Juror {seatIndex + 1}
          </p>
          <p className="mt-1 break-all text-[11px] leading-relaxed text-white/50">
            {modelId ?? "Model id unavailable"}
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
          seatLabel={`Seat ${seatIndex + 1}, phase ${phase}`}
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
    return (
      <div className="space-y-4">
        <span className="inline-flex rounded-full border border-no/35 bg-no/10 px-2 py-1 text-[10px] font-semibold text-no uppercase">
          {status}
        </span>
        <p className="text-sm leading-relaxed text-white/75">
          {message ?? "No failure message was recorded."}
        </p>
      </div>
    );
  }

  if (node.kind === "certificate") {
    const certificateId = stringField(node.detail, "certificateId");
    return (
      <div className="space-y-4">
        <HashChip
          value={certificateId}
          label="certificate"
          tone="yes"
          full
          className="max-w-full bg-white/5"
        />
        {certificateId !== undefined ? (
          <a
            href={`https://suiscan.xyz/testnet/object/${certificateId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#72b6ff] hover:underline"
          >
            <ExportSquare size="14" variant="Bold" />
            Open in Suiscan
          </a>
        ) : null}
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

export default function ClaimCanvasPage({ params }: ClaimCanvasPageProps) {
  const { id } = use(params);
  const now = useNow();
  const { events } = useClaimEvents(id);
  const hasClaimRef = useRef(false);
  const requestedProofsRef = useRef(new Set<string>());

  const [claim, setClaim] = useState<ClaimInspection | null>(null);
  const [proofsByRunId, setProofsByRunId] = useState<ProofCache>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      transcript: proofTranscript(proof),
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
  const replay = useReplay(graph, claim !== null && claim.state >= 9);
  const selectedNode = useMemo(
    () => replay.visible.nodes.find((node) => node.id === selectedId) ?? null,
    [replay.visible.nodes, selectedId],
  );
  const handleSelect = useCallback((node: GraphNode | null) => {
    setSelectedId(node?.id ?? null);
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
    <div className="relative flex min-h-[calc(100vh-74px)] bg-[#04122b] text-white">
      <aside className="hidden h-[calc(100vh-74px)] w-[320px] shrink-0 overflow-y-auto border-r border-white/10 bg-white/[0.04] lg:block">
        <LeftRail claim={claim} now={now} replay={replay} />
      </aside>

      <main className="relative h-[calc(100vh-74px)] min-h-[calc(100vh-74px)] flex-1 overflow-hidden">
        <DeliberationCanvas
          graph={replay.visible}
          selectedId={selectedId}
          onSelect={handleSelect}
          avatars={JUROR_AVATARS}
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

      <aside className="hidden h-[calc(100vh-74px)] w-[380px] shrink-0 overflow-y-auto border-l border-white/10 bg-white/[0.04] p-5 lg:block">
        <NodeInspector
          claim={claim}
          events={events}
          graph={graph}
          node={selectedNode}
          proofsByRunId={proofsByRunId}
        />
      </aside>

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
          <div className="p-5">
            <NodeInspector
              claim={claim}
              events={events}
              graph={graph}
              node={selectedNode}
              proofsByRunId={proofsByRunId}
            />
          </div>
        </MobileSheet>
      ) : null}
    </div>
  );
}

import type { ClaimInspection, ResolutionEvent } from "../engine/contract";

export type GraphNodeKind =
  | "claim" | "juror" | "sealedAction" | "search" | "page"
  | "verdict" | "failure" | "certificate";
export type JurorFamily = "deepseek" | "kimi" | "minimax" | "unknown";
export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  atMs: number;
  seatId?: string;
  /** The seat's stable committee position (0-4), for even juror placement. */
  seatIndex?: number;
  runId?: string;
  family?: JurorFamily;
  state?: "researching" | "sealed" | "revealed" | "failed";
  intent?: "support" | "challenge";
  outcome?: "YES" | "NO" | "UNSURE";
  confidenceBps?: number;
  url?: string;
  stepIndex?: number;
  detail?: Record<string, unknown>;
};
export type GraphEdge = { id: string; from: string; to: string;
  kind: "seat" | "action" | "result" | "citation" | "verdict" | "settle" };
export type DeliberationGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

type UnknownRecord = Record<string, unknown>;
type ResearchStep = {
  index: number;
  position: number;
  action: UnknownRecord & { action: "search" | "open" };
  result: UnknownRecord;
  batch?: UnknownRecord;
};
type Tick = {
  seatId: string;
  kind: "search" | "open";
  ordinal: number;
  atMs: number;
  runId?: string;
};

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function stringAt(value: UnknownRecord | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function numberAt(value: UnknownRecord | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function recordsAt(value: UnknownRecord | undefined, key: string): UnknownRecord[] {
  const candidate = value?.[key];
  return Array.isArray(candidate)
    ? candidate.flatMap((item) => {
        const parsed = record(item);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function eventTime(event: ResolutionEvent | undefined): number | undefined {
  if (event === undefined) return undefined;
  const parsed = Date.parse(event.occurredAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstEventTime(
  events: readonly ResolutionEvent[],
  predicate: (event: ResolutionEvent) => boolean,
): number | undefined {
  for (const event of events) {
    if (!predicate(event)) continue;
    const atMs = eventTime(event);
    if (atMs !== undefined) return atMs;
  }
  return undefined;
}

function eventSeatId(event: ResolutionEvent): string | undefined {
  const payload = record(event.payload);
  return stringAt(payload, "jurySeatId") ?? stringAt(payload, "jury_seat_id");
}

function shortLabel(value: string | undefined, fallback: string): string {
  const label = value?.trim() || fallback;
  return label.length <= 72 ? label : `${label.slice(0, 69)}...`;
}

function comparableUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return value.trim() || undefined;
  }
}

function urlValues(value: UnknownRecord | undefined, key: string): string[] {
  const candidate = value?.[key];
  if (typeof candidate === "string") return [candidate];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function actionUrlsForStep(step: ResearchStep): string[] {
  const directUrls = urlValues(step.action, "url");
  if (directUrls.length > 0) return directUrls;
  const batchUrls = urlValues(step.action, "urls");
  const position = numberAt(step.batch, "position");
  if (position === undefined) return batchUrls;
  const selected = batchUrls[position - 1];
  return selected === undefined ? [] : [selected];
}

function researchSteps(transcript: unknown): ResearchStep[] {
  const transcriptRecord = record(transcript);
  const rawSteps = transcriptRecord?.steps;
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps
    .flatMap((value, position) => {
      const step = record(value);
      const action = record(step?.action);
      const actionKind = stringAt(action, "action");
      if (actionKind !== "search" && actionKind !== "open") return [];
      const result = record(step?.result) ?? {};
      const rawIndex = numberAt(step, "index");
      const index = rawIndex !== undefined && Number.isInteger(rawIndex) && rawIndex >= 0
        ? rawIndex
        : position;
      const batch = record(step?.batch);
      return [{
        index,
        position,
        action: action as ResearchStep["action"],
        result,
        ...(batch === undefined ? {} : { batch }),
      }];
    })
    .sort((left, right) => left.index - right.index || left.position - right.position);
}

function proofOutput(value: unknown): UnknownRecord | undefined {
  const output = record(value);
  return record(output?.validatedOutput) ?? output;
}

function outcomeOf(output: UnknownRecord | undefined): GraphNode["outcome"] {
  const outcome = stringAt(output, "outcome");
  return outcome === "YES" || outcome === "NO" || outcome === "UNSURE"
    ? outcome
    : undefined;
}

function confidenceLabel(confidenceBps: number | undefined): string {
  if (confidenceBps === undefined) return "";
  const percent = confidenceBps / 100;
  return ` · ${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function modelIdForSeat(
  events: readonly ResolutionEvent[],
  agentProfileId: string,
  seatId: string,
): string | undefined {
  for (const event of events) {
    if (event.kind !== "inference_completed") continue;
    if (event.actorId !== agentProfileId && eventSeatId(event) !== seatId) continue;
    const modelId = stringAt(record(event.payload), "model_id");
    if (modelId !== undefined) return modelId;
  }
  return undefined;
}

function openedPageForStep(
  step: ResearchStep,
  opened: readonly UnknownRecord[],
): UnknownRecord | undefined {
  const evidenceId = stringAt(step.result, "evidenceId");
  if (evidenceId !== undefined) {
    const byEvidenceId = opened.find(
      (page) => stringAt(page, "evidenceId") === evidenceId,
    );
    if (byEvidenceId !== undefined) return byEvidenceId;
  }
  const selectedUrl = actionUrlsForStep(step)[0];
  const comparable = comparableUrl(selectedUrl);
  if (comparable === undefined) return undefined;
  return opened.find((page) =>
    [stringAt(page, "url"), stringAt(page, "finalUrl")]
      .map(comparableUrl)
      .includes(comparable),
  );
}

function stepUrls(step: ResearchStep, openedPage?: UnknownRecord): Set<string> {
  const values = [
    ...actionUrlsForStep(step),
    stringAt(openedPage, "url"),
    stringAt(openedPage, "finalUrl"),
  ];
  return new Set(
    values.flatMap((value) => {
      const comparable = comparableUrl(value);
      return comparable === undefined ? [] : [comparable];
    }),
  );
}

function resultUrls(step: ResearchStep): Set<string> {
  return new Set(
    recordsAt(step.result, "results").flatMap((result) => {
      const comparable = comparableUrl(stringAt(result, "url"));
      return comparable === undefined ? [] : [comparable];
    }),
  );
}

function hasIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function citationMatchesPage(
  citation: UnknownRecord,
  evidenceIds: ReadonlySet<string>,
  urls: ReadonlySet<string>,
): boolean {
  const evidenceId = stringAt(citation, "evidenceId");
  if (evidenceId !== undefined && evidenceIds.has(evidenceId)) return true;
  const url = comparableUrl(stringAt(citation, "url"));
  return url !== undefined && urls.has(url);
}

export function buildDeliberationGraph(input: {
  claim: ClaimInspection;
  proofs?: Array<{ runId: string; jurySeatId: string; transcript?: unknown; output?: unknown; revealed: boolean }>;
  events?: ResolutionEvent[];
  nowMs: number;
}): DeliberationGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nowMs = finite(input.nowMs, 0);
  const events = [...(input.events ?? [])].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  const commitmentOrder = new Map(
    input.claim.commitments.map((commitment, index) => [commitment.jurySeatId, index]),
  );
  const commitments = [...input.claim.commitments];
  const proofs = [...(input.proofs ?? [])].sort((left, right) => {
    const leftSeat = commitmentOrder.get(left.jurySeatId) ?? Number.MAX_SAFE_INTEGER;
    const rightSeat = commitmentOrder.get(right.jurySeatId) ?? Number.MAX_SAFE_INTEGER;
    return leftSeat - rightSeat || left.runId.localeCompare(right.runId);
  });
  const revealedProofs = proofs.filter((proof) => proof.revealed);
  // A trail is expandable once its steps are public: a revealed bundle, or a
  // failed seat's failure record (published after the deadline). Seat STATE
  // still keys off revealedProofs alone: a failed seat never reads revealed.
  const expandableProofs = proofs.filter(
    (proof) => proof.revealed || researchSteps(proof.transcript).length > 0,
  );
  const expandedSeats = new Set(
    expandableProofs
      .filter((proof) => researchSteps(proof.transcript).length > 0)
      .map((proof) => proof.jurySeatId),
  );
  const claimAtMs = firstEventTime(events, (event) => event.kind === "claim_created")
    ?? finite(input.claim.deadlines.evidenceCutoffMs, nowMs);
  const researchStartMs = finite(input.claim.deadlines.evidenceCutoffMs, claimAtMs);
  const firstCommitAtMs = firstEventTime(
    events,
    (event) => event.kind === "vote_committed",
  ) ?? finite(input.claim.deadlines.firstCommitDeadlineMs, nowMs);
  const researchEndMs = Math.max(researchStartMs, firstCommitAtMs);

  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push({ ...node, atMs: finite(node.atMs, nowMs) });
  };
  const addEdge = (
    kind: GraphEdge["kind"],
    from: string,
    to: string,
  ): void => {
    const id = `edge:${kind}:${from}:${to}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, from, to, kind });
  };

  addNode({
    id: "claim",
    kind: "claim",
    // The genesis card renders the whole statement, so no truncation here.
    label: input.claim.statement.trim() || "Claim",
    atMs: claimAtMs,
    detail: {
      claimId: input.claim.claimId,
      resolutionCriteria: input.claim.resolutionCriteria,
      mode: input.claim.mode,
      state: input.claim.state,
    },
  });

  const committeeAtMs = firstEventTime(
    events,
    (event) => event.kind === "committee_selected",
  ) ?? researchStartMs;
  // Round-2 seats join the stage when their round actually convenes: the
  // first event that references the seat (its offer, tick, or run) carries
  // that moment; committee selection only stamps the round-1 five.
  const phaseTwoSeats = new Set(
    input.claim.rounds?.find((round: { phase: 1 | 2 }) => round.phase === 2)?.expectedJurySeatIds
      ?? (commitments.length === 10
        ? commitments.slice(5).map((commitment) => commitment.jurySeatId)
        : []),
  );

  for (const [index, commitment] of commitments.entries()) {
    const proofRevealed = revealedProofs.some(
      (proof) => proof.jurySeatId === commitment.jurySeatId,
    );
    const state: NonNullable<GraphNode["state"]> = commitment.failureStatus !== undefined
      ? "failed"
      : commitment.revealed || proofRevealed
        ? "revealed"
        : commitment.committed
          ? "sealed"
          : "researching";
    const seatNodeId = `seat:${commitment.jurySeatId}`;
    const seatAtMs = phaseTwoSeats.has(commitment.jurySeatId)
      ? (firstEventTime(
          events,
          (event) => eventSeatId(event) === commitment.jurySeatId,
        ) ?? committeeAtMs)
      : committeeAtMs;
    addNode({
      id: seatNodeId,
      kind: "juror",
      label: `Juror ${index + 1}`,
      atMs: seatAtMs,
      seatId: commitment.jurySeatId,
      seatIndex: index,
      // The commitment's manifest model id is authoritative; the event scan
      // is only a fallback for records saved before modelId was exposed.
      family: familyOfModelId(
        commitment.modelId ?? modelIdForSeat(
          events,
          commitment.agentProfileId,
          commitment.jurySeatId,
        ),
      ),
      state,
      detail: { ...commitment },
    });
    addEdge("seat", "claim", seatNodeId);
  }

  const knownSeats = new Set(commitments.map((commitment) => commitment.jurySeatId));
  const ticks = new Map<string, Tick>();
  for (const event of events) {
    if (event.kind !== "RESEARCH_TICK" || event.visibility !== "PUBLIC_NOW") continue;
    const payload = record(event.payload);
    const seatId = stringAt(payload, "jurySeatId");
    const kind = stringAt(payload, "kind");
    const ordinal = numberAt(payload, "ordinal");
    if (
      seatId === undefined ||
      !knownSeats.has(seatId) ||
      (kind !== "search" && kind !== "open") ||
      ordinal === undefined ||
      !Number.isInteger(ordinal) ||
      ordinal < 0
    ) {
      continue;
    }
    const key = `${seatId}:${ordinal}`;
    if (ticks.has(key)) continue;
    ticks.set(key, {
      seatId,
      kind,
      ordinal,
      atMs: eventTime(event) ?? researchStartMs,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
    });
  }

  for (const commitment of commitments) {
    if (expandedSeats.has(commitment.jurySeatId)) continue;
    const seatTicks = [...ticks.values()]
      .filter((tick) => tick.seatId === commitment.jurySeatId)
      .sort((left, right) => left.ordinal - right.ordinal);
    let previousId = `seat:${commitment.jurySeatId}`;
    for (const tick of seatTicks) {
      const id = `tick:${tick.seatId}:${tick.ordinal}`;
      addNode({
        id,
        kind: "sealedAction",
        label: tick.kind === "search" ? "Sealed search" : "Sealed page",
        atMs: tick.atMs,
        seatId: tick.seatId,
        ...(tick.runId === undefined ? {} : { runId: tick.runId }),
        stepIndex: tick.ordinal,
        detail: { kind: tick.kind, ordinal: tick.ordinal },
      });
      addEdge("action", previousId, id);
      previousId = id;
    }
  }

  const verdictIds: string[] = [];
  for (const proof of expandableProofs) {
    if (!knownSeats.has(proof.jurySeatId)) continue;
    const transcript = record(proof.transcript);
    const steps = researchSteps(proof.transcript);
    const opened = recordsAt(transcript, "opened");
    const output = proofOutput(proof.output);
    const transcriptCitations = recordsAt(transcript, "citations");
    const outputCitations = recordsAt(output, "citations");
    const citations = [...transcriptCitations, ...outputCitations];
    const builtSteps: Array<{
      step: ResearchStep;
      nodeId: string;
      urls: Set<string>;
      evidenceIds: Set<string>;
      searchResultUrls: Set<string>;
    }> = [];
    const usedStepIds = new Set<string>();

    for (const [position, step] of steps.entries()) {
      const nodeId = `step:${proof.runId}:${step.index}`;
      if (usedStepIds.has(nodeId)) continue;
      usedStepIds.add(nodeId);
      const tick = ticks.get(`${proof.jurySeatId}:${step.index}`);
      const interpolatedAtMs = researchStartMs +
        ((researchEndMs - researchStartMs) * (position + 1)) / (steps.length + 1);
      const atMs = tick?.atMs ?? interpolatedAtMs;
      const openedPage = step.action.action === "open"
        ? openedPageForStep(step, opened)
        : undefined;
      const urls = stepUrls(step, openedPage);
      const evidenceIds = new Set(
        [
          stringAt(step.result, "evidenceId"),
          stringAt(openedPage, "evidenceId"),
          stringAt(openedPage, "ref"),
        ]
          .filter((value): value is string => value !== undefined),
      );
      const searchResultUrls = step.action.action === "search"
        ? resultUrls(step)
        : new Set<string>();

      if (step.action.action === "search") {
        const intent = stringAt(step.action, "intent");
        addNode({
          id: nodeId,
          kind: "search",
          label: shortLabel(stringAt(step.action, "query"), "Search"),
          atMs,
          seatId: proof.jurySeatId,
          runId: proof.runId,
          ...(intent === "support" || intent === "challenge" ? { intent } : {}),
          stepIndex: step.index,
          detail: {
            action: step.action,
            result: step.result,
            ...(step.batch === undefined ? {} : { batch: step.batch }),
          },
        });
      } else {
        const url = stringAt(openedPage, "finalUrl")
          ?? stringAt(openedPage, "url")
          ?? actionUrlsForStep(step)[0];
        const matchingCitations = citations.filter((citation) =>
          citationMatchesPage(citation, evidenceIds, urls),
        );
        addNode({
          id: nodeId,
          kind: "page",
          label: shortLabel(stringAt(openedPage, "title") ?? url, "Opened page"),
          atMs,
          seatId: proof.jurySeatId,
          runId: proof.runId,
          ...(url === undefined ? {} : { url }),
          stepIndex: step.index,
          detail: {
            action: step.action,
            result: step.result,
            ...(step.batch === undefined ? {} : { batch: step.batch }),
            ...(openedPage === undefined ? {} : { opened: openedPage }),
            ...(matchingCitations.length === 0
              ? {}
              : { citations: matchingCitations }),
          },
        });
      }
      // Every search is its own action by the juror, so it branches from the
      // seat; pages attach to the search that surfaced them (below).
      if (step.action.action === "search") {
        addEdge("action", `seat:${proof.jurySeatId}`, nodeId);
      }
      builtSteps.push({
        step,
        nodeId,
        urls,
        evidenceIds,
        searchResultUrls,
      });
    }

    const searchSteps = builtSteps.filter(
      (built) => built.step.action.action === "search",
    );
    const pageSteps = builtSteps.filter(
      (built) => built.step.action.action === "open",
    );
    for (const page of pageSteps) {
      // A page hangs off the most recent earlier search that surfaced its
      // URL; a direct open with no matching search branches from the juror.
      const source = [...searchSteps]
        .filter((search) => search.step.index < page.step.index)
        .reverse()
        .find((search) => hasIntersection(search.searchResultUrls, page.urls));
      if (source !== undefined) {
        addEdge("result", source.nodeId, page.nodeId);
      } else {
        addEdge("action", `seat:${proof.jurySeatId}`, page.nodeId);
      }
    }

    const outcome = outcomeOf(output);
    if (outcome === undefined) continue;
    const confidenceBps = numberAt(output, "confidenceBps");
    const revealAtMs = firstEventTime(events, (event) =>
      (event.kind === "vote_revealed" || event.kind === "inference_completed") &&
      (event.runId === proof.runId || eventSeatId(event) === proof.jurySeatId),
    );
    const verdictAtMs = revealAtMs
      ?? Math.max(
        builtSteps.at(-1)?.nodeId === undefined
          ? researchEndMs
          : nodes.find((node) => node.id === builtSteps.at(-1)?.nodeId)?.atMs
            ?? researchEndMs,
        finite(input.claim.deadlines.firstRevealDeadlineMs, nowMs),
      );
    const verdictId = `verdict:${proof.runId}`;
    addNode({
      id: verdictId,
      kind: "verdict",
      label: `${outcome}${confidenceLabel(confidenceBps)}`,
      atMs: verdictAtMs,
      seatId: proof.jurySeatId,
      runId: proof.runId,
      outcome,
      ...(confidenceBps === undefined ? {} : { confidenceBps }),
      detail: output,
    });
    addEdge("verdict", `seat:${proof.jurySeatId}`, verdictId);
    verdictIds.push(verdictId);
    for (const page of pageSteps) {
      if (citations.some((citation) =>
        citationMatchesPage(citation, page.evidenceIds, page.urls),
      )) {
        addEdge("citation", page.nodeId, verdictId);
      }
    }
  }

  for (const commitment of commitments) {
    if (commitment.failureStatus === undefined) continue;
    const atMs = firstEventTime(events, (event) =>
      event.kind === "inference_failed" &&
      (event.actorId === commitment.agentProfileId ||
        eventSeatId(event) === commitment.jurySeatId),
    ) ?? Math.min(nowMs, finite(input.claim.deadlines.firstCommitDeadlineMs, nowMs));
    const id = `failure:${commitment.jurySeatId}`;
    addNode({
      id,
      kind: "failure",
      label: shortLabel(commitment.failureStatus, "Failed"),
      atMs,
      seatId: commitment.jurySeatId,
      detail: {
        failureStatus: commitment.failureStatus,
        commitment: { ...commitment },
      },
    });
    addEdge("verdict", `seat:${commitment.jurySeatId}`, id);
  }

  if (input.claim.result !== undefined) {
    const atMs = firstEventTime(events, (event) => event.kind === "claim_finalized")
      ?? nowMs;
    addNode({
      id: "certificate",
      kind: "certificate",
      label: `Certificate · ${input.claim.result.result}`,
      atMs,
      detail: { ...input.claim.result },
    });
    for (const verdictId of verdictIds) {
      addEdge("settle", verdictId, "certificate");
    }
  }

  return { nodes, edges };
}

export function familyOfModelId(modelId: string | undefined): JurorFamily {
  const normalized = modelId?.toLowerCase();
  if (normalized?.startsWith("deepseek-ai/") === true) return "deepseek";
  if (normalized?.startsWith("moonshotai/") === true) return "kimi";
  if (normalized?.startsWith("minimaxai/") === true) return "minimax";
  return "unknown";
}

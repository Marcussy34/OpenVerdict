/**
 * Human output for the `ov` CLI: short lines, consistent columns, the
 * protocol lexicon only (juror, seat, committee, quorum, cascade, debate,
 * table vote, attempt, certificate, truth score). Pure functions, no I/O.
 */
import type {
  AttemptChain,
  ClaimInspection,
  QueuedFactCheck,
  WeatherReport,
} from "../engine/contract";
import { shortHex } from "../audit/audit-claim";
import { CLAIM_STATE, OUTCOME } from "../protocol/constants";
import { OvError, asArray, asNumber, asString, isRecord, type Json, type StreamEvent } from "./api";

const SUISCAN = "https://suiscan.xyz/testnet";
/** Width of the "kind in words" column of a watch line. */
const KIND_WIDTH = 17;
const ARGUMENT_PREVIEW = 100;

// ---------------------------------------------------------------------------
// Durations and times
// ---------------------------------------------------------------------------

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** `30s`, `9m`, `1h`, `1m30s`, `500ms`; a bare number counts seconds. */
export function parseDuration(text: string): number {
  const trimmed = text.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const parts = trimmed.match(/\d+(?:\.\d+)?(?:ms|s|m|h)/g);
  if (!parts || parts.join("") !== trimmed) {
    throw new OvError(`not a duration: ${text} (use 30s, 9m or 1h)`);
  }
  let total = 0;
  for (const part of parts) {
    const unit = part.replace(/[\d.]/g, "");
    total += Number(part.replace(/[a-z]/g, "")) * (DURATION_UNITS[unit] ?? 1_000);
  }
  return Math.round(total);
}

/** "45 s", "3 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "in 3 min" or "passed" for a deadline. */
export function formatRelative(targetMs: number, nowMs: number): string {
  return targetMs > nowMs ? `in ${formatDuration(targetMs - nowMs)}` : "passed";
}

/** HH:MM:SSZ of an ISO time or an epoch; "--:--:--Z" when unknown. */
export function clockTime(at: string | number | undefined): string {
  const ms = typeof at === "number" ? at : at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms)) return "--:--:--Z";
  return `${new Date(ms).toISOString().slice(11, 19)}Z`;
}

/** UTC ISO without milliseconds. */
export function isoTime(at: string | number | undefined): string {
  const ms = typeof at === "number" ? at : at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Words for protocol values
// ---------------------------------------------------------------------------

const STATE_WORDS: Record<number, string> = {
  [CLAIM_STATE.CREATED]: "jury forming",
  [CLAIM_STATE.PROPOSED]: "jury forming",
  [CLAIM_STATE.CHALLENGED]: "jury forming",
  [CLAIM_STATE.REVIEW_REQUESTED]: "jury forming",
  [CLAIM_STATE.COMMIT_1]: "round one research and sealed votes",
  [CLAIM_STATE.REVEAL_1]: "round one reveal",
  [CLAIM_STATE.DISCUSSION]: "discussion",
  [CLAIM_STATE.COMMIT_2]: "round two commit",
  [CLAIM_STATE.REVEAL_2]: "round two reveal",
  [CLAIM_STATE.FINALIZED_UNCHALLENGED]: "finalized",
  [CLAIM_STATE.FINALIZED_REVIEWED]: "finalized",
  [CLAIM_STATE.UNRESOLVED]: "unresolved",
  [CLAIM_STATE.CANCELLED]: "cancelled",
};

const STATE_BY_LABEL: Record<string, number> = {
  CREATED: CLAIM_STATE.CREATED,
  PROPOSED: CLAIM_STATE.PROPOSED,
  CHALLENGED: CLAIM_STATE.CHALLENGED,
  REVIEW_REQUESTED: CLAIM_STATE.REVIEW_REQUESTED,
  COMMIT_1: CLAIM_STATE.COMMIT_1,
  REVEAL_1: CLAIM_STATE.REVEAL_1,
  DISCUSSION: CLAIM_STATE.DISCUSSION,
  COMMIT_2: CLAIM_STATE.COMMIT_2,
  REVEAL_2: CLAIM_STATE.REVEAL_2,
  FINALIZED_UNCHALLENGED: CLAIM_STATE.FINALIZED_UNCHALLENGED,
  FINALIZED_REVIEWED: CLAIM_STATE.FINALIZED_REVIEWED,
  FINALIZED: CLAIM_STATE.FINALIZED_REVIEWED,
  UNRESOLVED: CLAIM_STATE.UNRESOLVED,
  CANCELLED: CLAIM_STATE.CANCELLED,
};

/** The state in plain words ("round one reveal"). */
export function stateWords(state: number | undefined): string {
  if (state === undefined) return "unknown state";
  return STATE_WORDS[state] ?? `state ${state}`;
}

/** phase_changed carries numbers or labels; both become words. */
export function phaseWords(value: unknown): string {
  const number = asNumber(value);
  if (number !== undefined) return stateWords(number);
  const label = asString(value);
  if (label === undefined) return "?";
  const known = STATE_BY_LABEL[label.toUpperCase()];
  return known === undefined ? label.toLowerCase().replace(/_/g, " ") : stateWords(known);
}

export function isFinalState(state: number | undefined): boolean {
  return (
    state === CLAIM_STATE.FINALIZED_UNCHALLENGED ||
    state === CLAIM_STATE.FINALIZED_REVIEWED ||
    state === CLAIM_STATE.UNRESOLVED
  );
}

const OUTCOME_WORDS: Record<number, string> = {
  [OUTCOME.YES]: "YES",
  [OUTCOME.NO]: "NO",
  [OUTCOME.UNSURE]: "UNSURE",
};

export function outcomeWord(value: unknown): string {
  const number = asNumber(value);
  if (number !== undefined) return OUTCOME_WORDS[number] ?? `outcome ${number}`;
  return asString(value) ?? "?";
}

/** Family display names shared with the console's weather strip. */
export function familyName(family: string, modelId: string): string {
  const norm = family.toLowerCase();
  if (norm === "deepseek") return "DeepSeek";
  if (norm === "minimax") return "MiniMax";
  if (norm === "kimi") return "Kimi";
  if (norm === "research") return "Web search";
  return modelId || family;
}

/** "DeepSeek" for deepseek-ai/DeepSeek-V4-Flash-0731; the model id when unknown. */
export function modelName(modelId: string | undefined): string {
  if (!modelId) return "unknown model";
  const lower = modelId.toLowerCase();
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("minimax")) return "MiniMax";
  if (lower.includes("kimi")) return "Kimi";
  if (lower.startsWith("research")) return "Web search";
  return modelId;
}

/** "DeepSeek V4 Flash" for deepseek-ai/DeepSeek-V4-Flash-0731: the exact model, readable. */
export function modelLabel(modelId: string | undefined): string {
  if (!modelId) return "unknown model";
  const tail = modelId.slice(modelId.lastIndexOf("/") + 1);
  // The trailing group is a build date, not part of the model's name.
  return tail.replace(/-\d{3,}$/, "").replace(/-/g, " ") || modelId;
}

/**
 * `text` wrapped to `width`, the first line behind `prefix` and every later
 * line behind `continuation` (spaces of the same width by default). Words are
 * never broken, so a long url overflows rather than becoming unclickable.
 */
export function wrapText(
  text: string,
  options: { width: number; prefix?: string; continuation?: string },
): string[] {
  const prefix = options.prefix ?? "";
  const continuation = options.continuation ?? " ".repeat(prefix.length);
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return [];
  const lines: string[] = [];
  let indent = prefix;
  let current = "";
  for (const word of flat.split(" ")) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length > 0 && indent.length + candidate.length > options.width) {
      lines.push(`${indent}${current}`);
      indent = continuation;
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(`${indent}${current}`);
  return lines;
}

/** "2.00 (200 bps)": basis points over 100 with two decimals, as the board and the audit card print it. */
export function formatScore(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "-";
  return `${(bps / 100).toFixed(2)} (${bps} bps)`;
}

export function claimLink(base: string, claimId: string): string {
  return `${base}/claims/${claimId}`;
}

export function queueLink(base: string, queueId: string): string {
  return `${base}/fact-check/queue/${queueId}`;
}

export function suiscanObject(id: string): string {
  return `${SUISCAN}/object/${id}`;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

const FAMILY_ORDER = ["deepseek", "minimax", "kimi", "research"];

/** One line per family: "DeepSeek     ok 0.7 s" or "Kimi         TIMEOUT". */
export function weatherLines(report: WeatherReport): string[] {
  const families = [...(report.families ?? [])].sort(
    (left, right) => familyRank(left.family) - familyRank(right.family),
  );
  return families.map((family) => {
    const name = familyName(family.family, family.modelId).padEnd(11);
    if (family.ok) return `${name} ok ${(Math.max(0, family.latencyMs) / 1_000).toFixed(1)} s`;
    return `${name} ${family.status || "ERROR"}`;
  });
}

function familyRank(family: string): number {
  const index = FAMILY_ORDER.indexOf(family.toLowerCase());
  return index < 0 ? FAMILY_ORDER.length : index;
}

/** "clear, probed 42 s ago" or "not clear, no recent probe". */
export function weatherSummary(report: WeatherReport, nowMs: number): string {
  const probed =
    report.probedAtMs === null || report.probedAtMs === undefined || report.stale
      ? "no recent probe"
      : `probed ${formatDuration(Math.max(0, nowMs - report.probedAtMs))} ago`;
  return `${report.clear ? "clear" : "not clear"}, ${probed}`;
}

/** Compact one-liner for watch and queue lines: "DeepSeek 429, MiniMax ok, Kimi TIMEOUT, Web search ok". */
export function weatherInline(report: WeatherReport): string {
  const families = [...(report.families ?? [])].sort(
    (left, right) => familyRank(left.family) - familyRank(right.family),
  );
  const parts = families.map(
    (family) => `${familyName(family.family, family.modelId)} ${family.ok ? "ok" : family.status || "ERROR"}`,
  );
  return parts.join(", ") || "no families reported";
}

export const NOT_CLEAR_NOTE =
  "not clear means new submissions queue until all four families answer a probe";

// ---------------------------------------------------------------------------
// Claim status block
// ---------------------------------------------------------------------------

/** Which deadline the state is waiting on, in words. */
function nextDeadline(
  inspection: ClaimInspection,
): { label: string; atMs: number } | undefined {
  const deadlines = inspection.deadlines;
  if (!deadlines) return undefined;
  switch (inspection.state) {
    case CLAIM_STATE.CREATED:
    case CLAIM_STATE.PROPOSED:
    case CLAIM_STATE.CHALLENGED:
    case CLAIM_STATE.REVIEW_REQUESTED:
    case CLAIM_STATE.COMMIT_1:
      return { label: "reveal window opens", atMs: deadlines.firstCommitDeadlineMs };
    case CLAIM_STATE.REVEAL_1:
      return { label: "reveal window closes", atMs: deadlines.firstRevealDeadlineMs };
    case CLAIM_STATE.DISCUSSION:
      return { label: "discussion ends", atMs: deadlines.discussionDeadlineMs };
    case CLAIM_STATE.COMMIT_2:
      return { label: "round two reveal opens", atMs: deadlines.secondCommitDeadlineMs };
    case CLAIM_STATE.REVEAL_2:
      return { label: "round two reveal closes", atMs: deadlines.secondRevealDeadlineMs };
    default:
      return undefined;
  }
}

/** "attempt 2 of 3, active" from the chain, or "single attempt". */
export function attemptWords(chain: AttemptChain | undefined): string {
  if (!chain) return "single attempt";
  return `attempt ${chain.attempt} of ${chain.maxAttempts}, ${chain.status.toLowerCase().replace(/_/g, " ")}`;
}

/** "attempt 1 voided: PROVIDER_ERROR (DeepSeek, phase 1)". */
export function voidWords(chain: AttemptChain): string {
  const detail = chain.void;
  if (!detail) return `attempt ${chain.attempt} voided`;
  const parts = [modelName(detail.modelId), detail.phase === undefined ? undefined : `phase ${detail.phase}`].filter(
    (part): part is string => part !== undefined,
  );
  const where = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const message = detail.message ? `: ${truncate(detail.message, 120)}` : "";
  return `attempt ${chain.attempt} voided: ${detail.reason}${where}${message}`;
}

/** "attempt 3 of 3 gave up: WEATHER_TIMEOUT". */
export function gaveUpWords(chain: AttemptChain): string {
  const reason = chain.gaveUpReason ?? chain.void?.reason ?? "no reason given";
  return `attempt ${chain.attempt} of ${chain.maxAttempts} gave up: ${reason}; no more attempts`;
}

/** The `ov status` block. */
export function renderStatus(inspection: ClaimInspection, base: string, nowMs: number): string[] {
  const lines = [
    `claim      ${inspection.claimId}`,
    `link       ${claimLink(base, inspection.claimId)}`,
    `statement  ${inspection.statement}`,
    `state      ${stateWords(inspection.state)}`,
  ];
  const commitments = inspection.commitments ?? [];
  const rounds = inspection.rounds ?? [];
  if (rounds.length > 0) {
    for (const round of rounds) {
      const expected = round.expectedJurySeatIds.length || 5;
      lines.push(
        `round ${round.phase === 2 ? "two" : "one"}  ${round.committedJurySeatIds.length} of ${expected} seats committed, ${round.revealedJurySeatIds.length} of ${expected} revealed`,
      );
    }
  } else if (commitments.length > 0) {
    const committed = commitments.filter((seat) => seat.committed).length;
    const revealed = commitments.filter((seat) => seat.revealed).length;
    lines.push(`seats      ${committed} of ${commitments.length} committed, ${revealed} of ${commitments.length} revealed`);
  } else {
    lines.push("seats      none drawn yet");
  }
  const failed = commitments.filter((seat) => seat.failureStatus);
  if (failed.length > 0) {
    lines.push(`failed     ${failed.map((seat) => `${modelName(seat.modelId)} ${seat.failureStatus}`).join(", ")}`);
  }
  lines.push(`attempt    ${attemptWords(inspection.attemptChain)}`);
  const chain = inspection.attemptChain;
  if (chain?.status === "VOIDED") {
    lines.push(`void       ${voidWords(chain)}`);
    lines.push(chain.relaunchedAs ? `relaunch   ${claimLink(base, chain.relaunchedAs)}` : "relaunch   pending");
  }
  if (chain?.status === "GAVE_UP") lines.push(`gave up    ${gaveUpWords(chain)}`);
  const deadline = nextDeadline(inspection);
  if (deadline && !isFinalState(inspection.state)) {
    lines.push(`next       ${deadline.label} ${formatRelative(deadline.atMs, nowMs)} (${isoTime(deadline.atMs)})`);
  }
  if (inspection.result) {
    lines.push(`result     ${inspection.result.result}, truth score ${formatScore(inspection.result.truthScoreBps)}`);
    lines.push(`certificate ${inspection.result.certificateId} ${suiscanObject(inspection.result.certificateId)}`);
  } else if (isFinalState(inspection.state)) {
    lines.push("result     not published yet");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Queue block
// ---------------------------------------------------------------------------

/** The `ov queue` block. */
export function renderQueue(item: QueuedFactCheck, base: string, nowMs: number): string[] {
  const lines = [`queue      ${item.queueId}`, `status     ${queueStatusWords(item)}`];
  if (item.status === "LAUNCHED" && item.claimId) {
    lines.push(`claim      ${item.claimId}`, `link       ${claimLink(base, item.claimId)}`, `watch it   ov watch ${item.claimId}`);
  } else {
    lines.push(`link       ${queueLink(base, item.queueId)}`);
  }
  lines.push(`statement  ${item.statement}`);
  const created = Date.parse(item.createdAt);
  const expires = Date.parse(item.expiresAt);
  lines.push(`created    ${isoTime(item.createdAt)}${Number.isFinite(created) ? ` (${formatDuration(Math.max(0, nowMs - created))} ago)` : ""}`);
  if (item.status === "QUEUED") {
    lines.push(`expires    ${isoTime(item.expiresAt)}${Number.isFinite(expires) ? ` (${formatRelative(expires, nowMs)})` : ""}`);
  }
  if (item.launchError) lines.push(`launch error ${item.launchError}`);
  if (item.weather) {
    lines.push("weather");
    for (const line of weatherLines(item.weather)) lines.push(`  ${line}`);
    lines.push(`  ${weatherSummary(item.weather, nowMs)}`);
  }
  return lines;
}

export function queueStatusWords(item: QueuedFactCheck): string {
  switch (item.status) {
    case "QUEUED":
      return "QUEUED, waiting for clear weather (the engine launches it when all four families answer)";
    case "LAUNCHED":
      return "LAUNCHED";
    case "EXPIRED":
      return "EXPIRED (queued items expire after six hours)";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return String(item.status);
  }
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

/** The `ov extract` block: numbered candidates, language, model, next step. */
export function renderExtract(body: Json): string[] {
  const claims = asArray(body.claims).filter(isRecord);
  const lines: string[] = [];
  const language = asString(body.language) ?? "und";
  const model = asString(body.modelId) ?? "unknown model";
  lines.push(`${claims.length} candidate claim${claims.length === 1 ? "" : "s"} (language ${language}, extracted by ${model})`);
  claims.forEach((candidate, index) => {
    lines.push(`${index + 1}. ${asString(candidate.claim) ?? ""}`);
    const reason = asString(candidate.reason);
    const quote = asString(candidate.quote);
    if (reason) lines.push(`   why: ${reason}`);
    if (quote) lines.push(`   quote: "${quote}"`);
  });
  const sourceUrl = asString(body.sourceUrl);
  if (sourceUrl) lines.push(`source: ${sourceUrl}`);
  const first = claims[0] ? asString(claims[0].claim) : undefined;
  if (first) lines.push(`next: ov submit ${JSON.stringify(first)}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Watch lines
// ---------------------------------------------------------------------------

/** Who sits where: juror numbers and models, rebuilt from the claim inspection. */
export type SeatIndex = {
  jurorBySeat: Map<string, number>;
  jurorByAgent: Map<string, number>;
  modelBySeat: Map<string, string>;
  modelByAgent: Map<string, string>;
  /** Seats expected per phase (5 unless the record says otherwise). */
  expectedByPhase: Map<number, number>;
};

export function emptySeatIndex(): SeatIndex {
  return {
    jurorBySeat: new Map(),
    jurorByAgent: new Map(),
    modelBySeat: new Map(),
    modelByAgent: new Map(),
    expectedByPhase: new Map(),
  };
}

/** Running per-phase counters the watch keeps for "(k of 5)". */
export type PhaseCounts = { committed: Map<number, number>; revealed: Map<number, number> };

export type EventContext = {
  seats: SeatIndex;
  counts: PhaseCounts;
  verbose: boolean;
};

/** "juror 2" (with the model when known) for a seat id or an agent profile id. */
export function jurorLabel(seats: SeatIndex, seatId: string | undefined, agentId: string | undefined): string {
  const number = lookup(seats.jurorBySeat, seatId) ?? lookup(seats.jurorByAgent, agentId);
  const model = lookup(seats.modelBySeat, seatId) ?? lookup(seats.modelByAgent, agentId);
  if (number === undefined) return model ? `a juror (${modelName(model)})` : "a juror";
  return model ? `juror ${number} (${modelName(model)})` : `juror ${number}`;
}

function lookup<T>(map: Map<string, T>, key: string | undefined): T | undefined {
  return key ? map.get(key.toLowerCase()) : undefined;
}

function seatOf(payload: Json): string | undefined {
  return asString(payload.jury_seat_id) ?? asString(payload.jurySeatId) ?? asString(payload.seat_id) ?? asString(payload.seatId);
}

function agentOf(payload: Json, raw: Json): string | undefined {
  return (
    asString(payload.agent_profile_id) ??
    asString(payload.agentProfileId) ??
    asString(payload.agent_id) ??
    asString(raw.actorId)
  );
}

function phaseOf(payload: Json, raw: Json): number {
  const explicit = asNumber(payload.phase);
  if (explicit !== undefined) return explicit;
  const label = asString(raw.phase) ?? "";
  return /_2$|ROUND_2|INFERENCE_2/.test(label) ? 2 : 1;
}

function counted(counts: Map<number, number>, phase: number): number {
  const next = (counts.get(phase) ?? 0) + 1;
  counts.set(phase, next);
  return next;
}

function ofSeats(context: EventContext, phase: number): number {
  return context.seats.expectedByPhase.get(phase) ?? 5;
}

/** When the audience learned of it: the later of occurredAt and publishedAt. */
export function eventTime(event: StreamEvent): string | undefined {
  const occurred = Date.parse(event.occurredAt ?? "");
  const published = Date.parse(event.publishedAt ?? "");
  if (Number.isFinite(published) && (!Number.isFinite(occurred) || published > occurred)) return event.publishedAt;
  return event.occurredAt;
}

/** `HH:MM:SSZ  <kind in words>  <detail>`. */
function line(event: StreamEvent, kind: string, detail: string): string {
  return `${clockTime(eventTime(event))}  ${kind.padEnd(KIND_WIDTH)}  ${detail}`.trimEnd();
}

/**
 * One watch line for an event, or undefined when the kind is skipped. Also
 * advances the per-phase counters, so call it exactly once per event.
 */
export function renderEvent(event: StreamEvent, context: EventContext): string | undefined {
  const payload = event.payload;
  const raw = event.raw;
  const who = () => jurorLabel(context.seats, seatOf(payload), agentOf(payload, raw));
  switch (event.kind) {
    case "claim_created":
      return line(event, "claim created", `on Sui, package ${shortHex(asString(payload.package_id))}`);
    case "evidence_submitted": {
      const id = asString(payload.evidence_id) ?? "";
      const label = id.includes(":") ? id.split(":")[0] : shortHex(id);
      return line(event, "evidence added", `${(asString(payload.source_class) ?? "").toLowerCase().replace(/_/g, " ")} ${label}`.trim());
    }
    case "evidence_retrieved":
      return line(event, "evidence fetched", `${asNumber(payload.bytes) ?? "?"} bytes, ${(asString(payload.status) ?? "").toLowerCase()}`);
    case "committee_selected": {
      const seatIds = asArray(payload.jury_seat_ids).filter((id): id is string => typeof id === "string");
      const models = seatIds.map((id) => modelName(context.seats.modelBySeat.get(id.toLowerCase())));
      return line(event, "committee drawn", `${seatIds.length} seats drawn: ${models.join(", ")}`);
    }
    case "evidence_frozen":
      return line(event, "evidence frozen", `root ${shortHex(asString(payload.root))}, phase ${asNumber(payload.phase) ?? "?"}`);
    case "agent_activity": {
      const status = asString(payload.status) ?? "";
      const latency = asNumber(payload.latencyMs);
      if (status === "RUNNING") return line(event, "juror working", `${who()} started research`);
      if (status === "COMPLETED") return line(event, "juror finished", `${who()} finished in ${formatDuration(latency ?? 0)}`);
      return line(event, "juror failed", `${who()}: ${status.toLowerCase().replace(/_/g, " ") || "failed"}`);
    }
    case "RESEARCH_TICK":
      if (!context.verbose) return undefined;
      return line(event, "research", `${who()} ${asString(payload.kind) ?? "tick"}`);
    case "output_repaired":
      return line(event, "output repaired", `${who()} output repaired: ${asString(payload.field) ?? "?"}`);
    case "run_approved":
      return line(event, "run approved", `${who()} run approved, hash ${shortHex(asString(payload.run_hash))}`);
    case "inference_failed":
      return line(event, "inference failed", `${who()}: ${asString(payload.category) ?? "failed"}${asNumber(payload.retry_count) !== undefined ? ` after ${asNumber(payload.retry_count)} retries` : ""}`);
    case "vote_committed": {
      const phase = phaseOf(payload, raw);
      const count = counted(context.counts.committed, phase);
      return line(event, "vote committed", `${who()} committed (${count} of ${ofSeats(context, phase)}${phase === 2 ? ", round two" : ""})`);
    }
    case "phase_changed": {
      const from = payload.previous_phase ?? payload.from;
      const to = payload.new_phase ?? payload.to;
      return line(event, "phase changed", `${phaseWords(from)} to ${phaseWords(to)}`);
    }
    case "vote_revealed": {
      const phase = phaseOf(payload, raw);
      const count = counted(context.counts.revealed, phase);
      const invalid = payload.valid === false ? ", invalid" : "";
      return line(
        event,
        "vote revealed",
        `${who()} revealed ${outcomeWord(payload.outcome)} ${asNumber(payload.confidence_bps) ?? "?"} bps (${count} of ${ofSeats(context, phase)}${phase === 2 ? ", round two" : ""}${invalid})`,
      );
    }
    case "inference_completed": {
      const output = isRecord(payload.output) ? payload.output : {};
      const citations = asArray(output.citations).length;
      return line(event, "answer published", `${who()} answered ${outcomeWord(output.outcome)} with ${citations} citation${citations === 1 ? "" : "s"}`);
    }
    case "argument_published": {
      const reasoning = asString(payload.reasoning);
      if (!reasoning) return undefined;
      return line(event, "argument", `${who()}: ${truncate(reasoning, ARGUMENT_PREVIEW)}`);
    }
    case "DELIBERATION_TURN": {
      const ordinal = asNumber(payload.ordinal);
      const turn = ordinal === undefined ? "?" : String(ordinal + 1);
      const stance = asString(payload.stance);
      const confidence = asNumber(payload.confidenceBps);
      const position = stance ? ` ${stance}${confidence === undefined ? "" : ` ${confidence} bps`}` : "";
      if (asString(payload.status) === "SKIPPED") {
        return line(event, "debate turn", `debate turn ${turn}, ${who()} skipped${asString(payload.failureStatus) ? ` (${asString(payload.failureStatus)})` : ""}`);
      }
      return line(event, "debate turn", `debate turn ${turn}, ${who()}${position}: ${truncate(asString(payload.argument) ?? "", ARGUMENT_PREVIEW)}`);
    }
    case "debate_converged":
      return line(event, "debate converged", `after exchange ${asNumber(payload.exchange) ?? asNumber(payload.convergedAfterExchange) ?? "?"}`);
    case "claim_finalized": {
      const certificate = asString(payload.certificate_id);
      return line(
        event,
        "final",
        `${asString(payload.outcome) ?? "?"}, score ${formatScore(asNumber(payload.truth_score_bps))}, certificate ${shortHex(certificate)}${certificate ? ` ${suiscanObject(certificate)}` : ""}`,
      );
    }
    case "attempt_voided":
    case "claim_voided":
      return line(event, "attempt voided", asString(payload.reason) ?? asString(payload.message) ?? "see the claim record");
    default:
      if (!context.verbose) return undefined;
      return line(event, event.kind.toLowerCase().replace(/_/g, " "), truncate(JSON.stringify(payload), ARGUMENT_PREVIEW));
  }
}

/**
 * `ov trace`: the research trail of every juror, rebuilt from the public run
 * proofs (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
 *
 * The turns come from `bundle.request.messages`: each assistant message is one
 * action the juror took, the user message after it is the result the model
 * actually saw. Legacy bundles without messages fall back to
 * `bundle.transcript.steps`. The answer turn comes from `validatedOutput`,
 * which is what the vote commitment binds. Reasoning and findings print in
 * full (that is the point of the command); page texts only with `--full`.
 *
 * A seat that failed closed has no bundle, but its public failure record holds
 * the same trail plus every provider call, so it is rebuilt from `failure`
 * instead. The record keeps no request messages, only their hashes, so the
 * pinned system prompt is taken from a revealed seat of the same round whose
 * bundle hashes to the same value, and the input is named by its hash alone.
 */
import {
  AuditInputError,
  DEFAULT_WALRUS_AGGREGATOR,
  auditClaim,
  isoTime,
  shortHex,
  type AuditResult,
  type ClaimPhase,
  type RunAudit,
} from "../audit/audit-claim";
import { OvError, asArray, asNumber, asString, isRecord, type Json } from "./api";
import {
  trailFromMessages,
  trailFromSteps,
  type TrailPage,
  type TrailSearchResult,
  type TrailTurn,
} from "../research/trail";
import { domainOf, modelLabel, timingWords, wrapText } from "./render";

/** Terminal columns when stdout is not a TTY. */
export const DEFAULT_TRACE_WIDTH = 100;
/** Narrower than this and wrapping stops helping. */
const MIN_WIDTH = 40;
/** A numbered turn sits here, its details one step further in. */
const TURN_INDENT = "  ";
const DETAIL_INDENT = "       ";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export type TraceSearchResult = TrailSearchResult;
export type TracePage = TrailPage;

/** A trail turn plus the validated output the answer turn carries. */
export type TraceTurn = TrailTurn & {
  /** The validated output of the run, on the answer turn. */
  answer?: Json;
  /** The model text that produced this turn, on a failed seat, for --full. */
  raw?: string;
};

/** One provider call of a seat that failed closed, from its failure record. */
export type TraceAttempt = {
  attempt: number;
  /** PRIMARY, HEDGE or REPAIR. */
  kind: string;
  /** SCHEMA_VALID, INVALID_SCHEMA, PROVIDER_ERROR, TIMEOUT and so on. */
  status: string;
  latencyMs?: number;
  devshardId?: string;
  /** The completion id, which joins this call to the turn it produced. */
  requestId?: string;
  tokens?: number;
  error?: { category: string; message?: string; httpStatus?: number };
  /** The raw model text this call returned, for --full. */
  raw?: string;
};

export type TraceRound = {
  phase: ClaimPhase;
  runId: string;
  kind: RunAudit["kind"];
  role?: string;
  vote?: { outcome: string; confidenceBps: number };
  turns: TraceTurn[];
  gateway?: {
    requestId?: string;
    devshardId?: string;
    model?: string;
    servedModel?: string;
    tokens?: number;
    latencyMs?: number;
    /** Provider calls made before this one was accepted (hedges and retries). */
    attempts?: number;
  };
  /** The pinned system prompt of this round and its hash, for --full. */
  systemPrompt?: string;
  promptHash?: string;
  /** The claim JSON the juror received, verbatim, for --full. */
  input?: string;
  /** The hash of that JSON, all a failed seat's record keeps of it. */
  inputHash?: string;
  /** The raw completion the model returned, for --full. */
  rawAnswer?: string;
  /** Every provider call of a seat that failed closed, in order. */
  attempts?: TraceAttempt[];
  /** How a seat that failed closed ended, and where its record lives. */
  failure?: { status: string; message?: string; failedAtMs?: number; walrusBlobId?: string };
  /** Plain words for a round with no trail (failed seat, sealed run). */
  missing?: string;
  /** `timing_ms` of this run's approval event: model, seal, upload, approve. */
  timings?: Record<string, number>;
};

export type TraceJuror = {
  jurorIndex: number;
  modelId?: string;
  role?: string;
  rounds: TraceRound[];
};

export type TraceDebateTurn = {
  ordinal: number;
  exchange: number;
  jurorIndex: number;
  modelId?: string;
  status: string;
  argument: string;
  citations: string[];
};

export type Trace = {
  claimId: string;
  statement: string;
  jurors: TraceJuror[];
  debate?: TraceDebateTurn[];
  /** Which rounds survived --round, in order. */
  phases: ClaimPhase[];
  /** Plain lines for the reader when a filter or the record left a hole. */
  notes: string[];
};

export type TraceFilter = { juror?: number; round?: ClaimPhase };

// ---------------------------------------------------------------------------
// Building the trace from an audit result
// ---------------------------------------------------------------------------

/** The raw completion text of the answer, for --full. */
function rawAnswerOf(bundle: Json): string | undefined {
  const raw = isRecord(bundle.rawResponse) ? bundle.rawResponse : undefined;
  const choice = raw ? asArray(raw.choices).filter(isRecord)[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  return message ? asString(message.content) : undefined;
}

function totalTokensOf(bundle: Json): number | undefined {
  const raw = isRecord(bundle.rawResponse) ? bundle.rawResponse : undefined;
  const usage = raw && isRecord(raw.usage) ? raw.usage : undefined;
  const total = usage ? asNumber(usage.total_tokens) : undefined;
  if (total !== undefined) return total;
  const audit = isRecord(bundle.audit) ? bundle.audit : {};
  const input = asNumber(audit.inputTokens);
  const output = asNumber(audit.outputTokens);
  return input === undefined || output === undefined ? undefined : input + output;
}

// ---------------------------------------------------------------------------
// A seat that failed closed, from its public failure record
// ---------------------------------------------------------------------------

/** The completion text of one provider call, the model's own words. */
function attemptRaw(entry: Json): string | undefined {
  const response = isRecord(entry.response) ? entry.response : undefined;
  const choice = response ? asArray(response.choices).filter(isRecord)[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  return message ? asString(message.content) : undefined;
}

/** The call's token count: the total the provider reported, else the two halves. */
function attemptTokens(response: Json | undefined): number | undefined {
  const usage = response && isRecord(response.usage) ? response.usage : undefined;
  if (!usage) return undefined;
  const total = asNumber(usage.total_tokens);
  if (total !== undefined) return total;
  const prompt = asNumber(usage.prompt_tokens);
  const completion = asNumber(usage.completion_tokens);
  return prompt === undefined || completion === undefined ? undefined : prompt + completion;
}

function attemptOf(entry: Json, index: number): TraceAttempt {
  const audit = isRecord(entry.audit) ? entry.audit : {};
  const response = isRecord(entry.response) ? entry.response : undefined;
  const error = isRecord(entry.error) ? entry.error : undefined;
  const latencyMs = asNumber(audit.latencyMs);
  const devshardId = asString(audit.devshardId);
  const requestId = response ? asString(response.id) : undefined;
  const tokens = attemptTokens(response);
  const httpStatus = error ? asNumber(error.httpStatus) : undefined;
  const message = error ? asString(error.message) : undefined;
  const raw = attemptRaw(entry);
  return {
    attempt: asNumber(audit.attempt) ?? index + 1,
    kind: asString(entry.kind) ?? "PRIMARY",
    status: asString(audit.status) ?? "UNKNOWN",
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(devshardId ? { devshardId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tokens === undefined ? {} : { tokens }),
    ...(error
      ? {
          error: {
            category: asString(error.category) ?? "ERROR",
            ...(message ? { message } : {}),
            ...(httpStatus === undefined ? {} : { httpStatus }),
          },
        }
      : {}),
    ...(raw ? { raw } : {}),
  };
}

/**
 * The turns of a failed seat. Every step of one model action carries that
 * call's request id, so consecutive steps are grouped by it and the group's
 * turn keeps the raw text of the attempt that produced it (an `open` over
 * three pages is three steps and one turn, as for a revealed bundle).
 */
function failedTurns(steps: Json[], rawById: Map<string, string>): TraceTurn[] {
  const turns: TraceTurn[] = [];
  let requestId: string | undefined;
  let group: Json[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const raw = requestId === undefined ? undefined : rawById.get(requestId);
    for (const turn of trailFromSteps(group)) {
      turns.push({ ...turn, ordinal: turns.length + 1, ...(raw ? { raw } : {}) });
    }
    group = [];
  };
  for (const step of steps) {
    const id = asString(step.modelRequestId);
    if (id !== requestId) {
      flush();
      requestId = id;
    }
    group.push(step);
  }
  flush();
  return turns;
}

/**
 * The pinned system prompt behind one hash. Every juror of a round runs the
 * same prompt, so a revealed seat of that round whose bundle hashes to the
 * same value holds the identical text, and the hash proves it.
 */
function promptOfHash(result: AuditResult, phase: ClaimPhase, promptHash: string): string | undefined {
  for (const value of Object.values(result.sources.proofs)) {
    const proof = isRecord(value) ? value : undefined;
    const bundle = proof && isRecord(proof.bundle) ? proof.bundle : undefined;
    if (!proof || !bundle) continue;
    if (asNumber(proof.phase) !== phase) continue;
    if (asString(bundle.promptHash)?.toLowerCase() !== promptHash) continue;
    const request = isRecord(bundle.request) ? bundle.request : {};
    const built = trailFromMessages(asArray(request.messages).filter(isRecord));
    if (built.system) return built.system;
    const spec = isRecord(bundle.promptSpec) ? bundle.promptSpec : undefined;
    const system = spec ? asString(spec.systemPrompt) : undefined;
    if (system) return system;
  }
  return undefined;
}

/** A seat that failed closed, rebuilt from the failure record its proof carries. */
function failedRound(result: AuditResult, run: RunAudit, proof: Json, round: TraceRound): TraceRound {
  const record = isRecord(proof.failure) ? proof.failure : {};
  const attempts = asArray(record.attempts).filter(isRecord).map(attemptOf);
  const rawById = new Map<string, string>();
  for (const attempt of attempts) {
    if (attempt.requestId && attempt.raw) rawById.set(attempt.requestId, attempt.raw);
  }
  const transcript = isRecord(record.transcript) ? record.transcript : undefined;
  round.turns = failedTurns(asArray(transcript?.steps).filter(isRecord), rawById);
  const status = asString(record.status) ?? "FAILED";
  const message = asString(record.message);
  const failedAtMs = asNumber(record.failedAtMs);
  const walrusBlobId = asString(record.walrusBlobId);
  round.failure = {
    status,
    ...(message ? { message } : {}),
    ...(failedAtMs === undefined ? {} : { failedAtMs }),
    ...(walrusBlobId ? { walrusBlobId } : {}),
  };
  if (attempts.length > 0) round.attempts = attempts;
  // The record keeps no request messages, only the hashes that bind them.
  const promptHash = asString(proof.promptHash)?.toLowerCase();
  if (promptHash) {
    round.promptHash = promptHash;
    const system = promptOfHash(result, run.phase, promptHash);
    if (system) round.systemPrompt = system;
  }
  const inputHash = asString(proof.inputHash)?.toLowerCase();
  if (inputHash) round.inputHash = inputHash;
  const tokens = attempts.reduce((sum, attempt) => sum + (attempt.tokens ?? 0), 0);
  round.gateway = {
    ...(run.gateway ?? {}),
    ...(tokens > 0 ? { tokens } : {}),
    ...(attempts.length > 1 ? { attempts: attempts.length } : {}),
  };
  // Nothing was recorded before the seat fell over, so say that instead.
  if (round.turns.length === 0) {
    round.missing = `the seat failed before taking any step (${status}${message ? `, ${message}` : ""})`;
  }
  return round;
}

/** Why a round has no trail: the seat failed, the run is sealed, nothing exists. */
function missingReason(result: AuditResult, run: RunAudit): string {
  if (run.failure) {
    const message = run.failure.message ? `: ${run.failure.message}` : "";
    return `no revealed run (the seat failed: ${run.failure.status}${message})`;
  }
  const vote = result.votes.find((entry) => entry.jurorIndex === run.jurorIndex && entry.phase === run.phase);
  if (vote?.failureStatus) return `no revealed run (the seat failed: ${vote.failureStatus})`;
  if (run.sealedBlobId) return "the run is sealed and not revealed yet";
  return "no run proof exists for this seat yet";
}

/** The `timing_ms` object the run_approved event carried for this run, if any. */
function timingsOf(result: AuditResult, runId: string): Record<string, number> | undefined {
  for (const event of result.sources.events) {
    if (event.kind !== "run_approved") continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const id = asString(payload.run_id) ?? asString(event.runId);
    if (id?.toLowerCase() !== runId.toLowerCase()) continue;
    const timings = isRecord(payload.timing_ms) ? payload.timing_ms : undefined;
    if (timings === undefined) continue;
    const entries: Record<string, number> = {};
    for (const [name, value] of Object.entries(timings)) {
      const milliseconds = asNumber(value);
      if (milliseconds !== undefined && milliseconds >= 0) entries[name] = milliseconds;
    }
    if (Object.keys(entries).length > 0) return entries;
  }
  return undefined;
}

function roundOf(result: AuditResult, run: RunAudit): TraceRound {
  const proof = isRecord(result.sources.proofs[run.runId]) ? (result.sources.proofs[run.runId] as Json) : undefined;
  const bundle = proof && isRecord(proof.bundle) ? proof.bundle : undefined;
  const timings = timingsOf(result, run.runId);
  const round: TraceRound = {
    phase: run.phase,
    runId: run.runId,
    kind: run.kind,
    ...(run.role ? { role: run.role } : {}),
    ...(run.vote ? { vote: run.vote } : {}),
    turns: [],
    ...(timings === undefined ? {} : { timings }),
  };
  if (!bundle) {
    // A failed seat has no bundle, but its failure record holds the whole trail.
    if (proof && isRecord(proof.failure)) return failedRound(result, run, proof, round);
    round.missing = missingReason(result, run);
    return round;
  }
  const request = isRecord(bundle.request) ? bundle.request : {};
  const messages = asArray(request.messages).filter(isRecord);
  const transcript = isRecord(bundle.transcript) ? bundle.transcript : undefined;
  if (messages.length > 0) {
    const built = trailFromMessages(messages);
    round.turns = built.turns;
    if (built.system) round.systemPrompt = built.system;
    if (built.input) round.input = built.input;
  } else if (transcript) {
    round.turns = trailFromSteps(asArray(transcript.steps).filter(isRecord));
  }
  const validatedOutput = isRecord(bundle.validatedOutput) ? bundle.validatedOutput : undefined;
  const last = round.turns.at(-1);
  if (last?.action === "answer") {
    if (validatedOutput) last.answer = validatedOutput;
  } else if (validatedOutput) {
    round.turns.push({ ordinal: round.turns.length + 1, action: "answer", answer: validatedOutput });
  }
  const promptHash = asString(bundle.promptHash);
  if (promptHash) round.promptHash = promptHash.toLowerCase();
  const rawAnswer = rawAnswerOf(bundle);
  if (rawAnswer) round.rawAnswer = rawAnswer;
  const tokens = totalTokensOf(bundle);
  const latencyMs =
    run.window === undefined ? asNumber((isRecord(bundle.audit) ? bundle.audit : {}).latencyMs) : run.window.completedAtMs - run.window.requestedAtMs;
  // The window covers the accepted call only, so name the hedges and retries
  // around it; a run of twelve attempts ending in half a second is not a lie.
  const attempts = asArray(bundle.attempts).length;
  round.gateway = {
    ...(run.gateway ?? {}),
    ...(tokens === undefined ? {} : { tokens }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(attempts > 1 ? { attempts } : {}),
  };
  return round;
}

/** The debate turns with their citation ids, from the claim inspection. */
function debateOf(result: AuditResult): TraceDebateTurn[] | undefined {
  if (!result.debate) return undefined;
  const jurorBySeat = new Map<string, number>();
  for (const juror of result.jury) {
    for (const seat of Object.values(juror.seats)) {
      if (seat) jurorBySeat.set(seat.toLowerCase(), juror.jurorIndex);
    }
  }
  // The inspection carries the citation ids; the audit's own rows only count them.
  const deliberation = result.sources.inspection.deliberation ?? [];
  if (deliberation.length === 0) {
    return result.debate.turns.map((turn) => ({
      ordinal: turn.ordinal,
      exchange: turn.exchange,
      jurorIndex: turn.jurorIndex,
      ...(turn.modelId ? { modelId: turn.modelId } : {}),
      status: turn.status,
      argument: turn.argument,
      citations: [],
    }));
  }
  return [...deliberation]
    .map((turn) => ({
      ordinal: turn.ordinal,
      exchange: turn.exchange,
      jurorIndex: jurorBySeat.get(turn.jurySeatId.toLowerCase()) ?? 0,
      ...(turn.modelId ? { modelId: turn.modelId } : {}),
      status: turn.status,
      argument: turn.argument,
      citations: [...turn.citations],
    }))
    .sort((left, right) => left.ordinal - right.ordinal);
}

/** The trace of one claim, filtered by --juror and --round. */
export function buildTrace(result: AuditResult, filter: TraceFilter = {}): Trace {
  const notes: string[] = [];
  const jurorRows = [...result.jury].sort((left, right) => left.jurorIndex - right.jurorIndex);
  const wanted = filter.juror === undefined ? jurorRows : jurorRows.filter((row) => row.jurorIndex === filter.juror);
  if (filter.juror !== undefined && wanted.length === 0) {
    throw new OvError(`this claim has ${jurorRows.length} jurors; there is no juror ${filter.juror}`);
  }
  const phases = new Set<ClaimPhase>();
  const jurors: TraceJuror[] = wanted.map((row) => {
    const runs = result.runs
      .filter((run) => run.jurorIndex === row.jurorIndex && (filter.round === undefined || run.phase === filter.round))
      .sort((left, right) => left.phase - right.phase);
    for (const run of runs) phases.add(run.phase);
    return {
      jurorIndex: row.jurorIndex,
      ...(row.modelId ? { modelId: row.modelId } : {}),
      ...(row.role ? { role: row.role } : {}),
      rounds: runs.map((run) => roundOf(result, run)),
    };
  });
  if (filter.round === 2 && !phases.has(2)) notes.push("this claim settled in one round; there is no round two");
  // A jury of fewer than three model families is a real verdict from a smaller
  // and more correlated panel, and the reader is told so before the trail.
  const jury = result.sources.inspection.jury;
  if (jury?.degraded) {
    notes.push(
      `this jury sat on ${jury.familyCount} model families (degraded mode): the operator lowered the requirement to ${jury.requiredFamilies} on chain while a provider was down`,
    );
  }
  // Claims recorded before the pinned table vote researched again in round two.
  const researchedTwice = jurors.some((juror) =>
    juror.rounds.some((round) => round.phase === 2 && round.kind === "research"),
  );
  if (researchedTwice) {
    notes.push(
      "round two here is the older research format (bundle version 5): these jurors researched again instead of casting the pinned table vote",
    );
  }
  const debate = filter.round === 1 ? undefined : debateOf(result);
  return {
    claimId: result.claim.claimId,
    statement: result.claim.statement,
    jurors,
    ...(debate && debate.length > 0 ? { debate } : {}),
    phases: [...phases].sort((left, right) => left - right),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

/** "mcgovern.mit.edu" for a full url; the raw value when it does not parse. */
/** The url without its scheme, as the trail prints opened pages. */
function bareUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./, "");
}

function voteWords(round: TraceRound): string {
  if (!round.vote) return "no vote";
  return `${round.vote.outcome} ${round.vote.confidenceBps} bps`;
}

function headerLine(juror: TraceJuror, round: TraceRound): string {
  const parts = [
    `juror ${juror.jurorIndex}`,
    modelLabel(juror.modelId),
    ...(juror.role ? [juror.role] : []),
    `round ${round.phase}${round.kind === "table-vote" ? " (table vote)" : ""}`,
  ];
  if (round.missing) return `${parts.join("  ")}  ${round.missing}`;
  // A failed seat cast no vote; its status and its provider calls stand there.
  if (round.failure) {
    const because = round.failure.message ? ` (${round.failure.message})` : "";
    const calls = round.attempts?.length ?? 0;
    return [
      ...parts,
      `failed closed ${round.failure.status}${because}`,
      ...(calls > 0 ? [`${calls} provider call${calls === 1 ? "" : "s"}`] : []),
      `run ${shortHex(round.runId)}`,
    ].join("  ");
  }
  return `${parts.join("  ")}  ${voteWords(round)}  run ${shortHex(round.runId)}`;
}

/** 1899 as "1,899"; the trail never depends on the reader's locale. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "attempt 2 PRIMARY · SCHEMA_VALID · devshard 69430 · 47.4 s · 1,899 tokens". */
function attemptLine(attempt: TraceAttempt): string {
  const parts = [`attempt ${attempt.attempt} ${attempt.kind}`, attempt.status];
  if (attempt.error?.httpStatus !== undefined) parts.push(`HTTP ${attempt.error.httpStatus}`);
  // A category that repeats the status (TIMEOUT after TIMEOUT) says nothing new.
  else if (attempt.error && attempt.error.category !== attempt.status) parts.push(attempt.error.category);
  if (attempt.devshardId) parts.push(`devshard ${attempt.devshardId}`);
  if (attempt.latencyMs !== undefined) parts.push(`${(attempt.latencyMs / 1_000).toFixed(1)} s`);
  if (attempt.tokens !== undefined) parts.push(`${grouped(attempt.tokens)} tokens`);
  return `${TURN_INDENT}${parts.join(" · ")}`;
}

/** What one call returned, under its line with --full: the text, or the error. */
function attemptDetail(attempt: TraceAttempt): string[] {
  const text = attempt.raw ?? (attempt.error ? JSON.stringify(attempt.error, null, 2) : undefined);
  if (text === undefined) return [];
  return pretty(text)
    .split("\n")
    .map((line) => `${DETAIL_INDENT}${line}`);
}

/** When the seat gave up, and where its failure record lives on Walrus. */
function failureLine(round: TraceRound): string | undefined {
  const failure = round.failure;
  if (!failure) return undefined;
  const parts: string[] = [];
  if (failure.failedAtMs !== undefined) parts.push(`failed at ${isoTime(failure.failedAtMs)}`);
  if (failure.walrusBlobId) {
    parts.push(`failure record on Walrus  ${DEFAULT_WALRUS_AGGREGATOR}/v1/blobs/${failure.walrusBlobId}`);
  }
  return parts.length === 0 ? undefined : `${TURN_INDENT}${parts.join("  ")}`;
}

/** The model text behind one turn of a failed seat, under it, with --full. */
function rawLines(raw: string): string[] {
  return [
    `${DETAIL_INDENT}raw:`,
    ...pretty(raw)
      .split("\n")
      .map((line) => `${DETAIL_INDENT}  ${line}`),
  ];
}

function pageLine(page: TracePage): string {
  if (page.error) return `${bareUrl(page.url)}  error: ${page.error}`;
  const parts = [bareUrl(page.url)];
  if (page.evidenceId) parts.push(`evidence ${shortHex(page.evidenceId)}`);
  if (page.chars !== undefined) {
    const total = page.totalChars === undefined ? "" : ` of ${page.totalChars}`;
    parts.push(`${page.chars}${total} chars${page.truncated ? ", truncated" : ""}`);
  }
  return parts.join("  ");
}

/** "gonka req-...  devshard 70083  9029 tokens  18.3 s". */
function receiptLine(round: TraceRound): string | undefined {
  const gateway = round.gateway;
  const parts: string[] = [];
  if (gateway?.requestId) parts.push(`gonka ${gateway.requestId}`);
  if (gateway?.devshardId) parts.push(`devshard ${gateway.devshardId}`);
  if (gateway?.tokens !== undefined) parts.push(`${gateway.tokens} tokens`);
  if (gateway?.latencyMs !== undefined) parts.push(`${(gateway.latencyMs / 1_000).toFixed(1)} s`);
  if (gateway?.attempts !== undefined) parts.push(`${gateway.attempts} provider calls`);
  // What each step of this seat took, when the approval event recorded it.
  const timings = timingWords(round.timings);
  if (timings !== undefined) parts.push(timings);
  return parts.length === 0 ? undefined : parts.join("  ");
}

function answerLines(turn: TraceTurn, round: TraceRound, width: number): string[] {
  const output = turn.answer ?? {};
  const lines: string[] = [];
  const wrap = (label: string, text: string) =>
    wrapText(text, { width, prefix: `${DETAIL_INDENT}${label}`, continuation: `${DETAIL_INDENT}  ` });
  const reasoning = asString(output.reasoning);
  if (reasoning) lines.push(...wrap("reasoning: ", reasoning));
  for (const entry of asArray(output.publicReasoningTrace).filter(isRecord)) {
    const assessment = asString(entry.assessment) ?? "?";
    const check = asString(entry.check) ?? "";
    const finding = asString(entry.finding) ?? "";
    lines.push(...wrap(`[${assessment}] `, `${check}: ${finding}`));
  }
  for (const citation of asArray(output.citations).filter(isRecord)) {
    const url = asString(citation.url) ?? "";
    const quote = asString(citation.quote) ?? "";
    lines.push(...wrap(`cites ${domainOf(url)}: `, `"${quote}"`));
  }
  const counter = asString(output.counterEvidenceSummary);
  if (counter) lines.push(...wrap("counter-evidence: ", counter));
  const receipt = receiptLine(round);
  if (receipt) lines.push(`${DETAIL_INDENT}${receipt}`);
  return lines;
}

function turnLines(turn: TraceTurn, round: TraceRound, width: number): string[] {
  const head = `${TURN_INDENT}${turn.ordinal}. `;
  const lines: string[] = [];
  const errorLine = turn.error ? [`${DETAIL_INDENT}the tool answered: ${turn.error}`] : [];
  if (turn.action === "search") {
    const intent = turn.intent ? ` (${turn.intent})` : "";
    lines.push(`${head}search${intent} ${JSON.stringify(turn.query ?? "")}`);
    const results = turn.results ?? [];
    if (results.length > 0) {
      const domains = results.map((row) => domainOf(row.url)).join(", ");
      lines.push(
        ...wrapText(domains, {
          width,
          prefix: `${DETAIL_INDENT}${results.length} results: `,
          continuation: `${DETAIL_INDENT}  `,
        }),
      );
    } else {
      lines.push(...(errorLine.length > 0 ? errorLine : [`${DETAIL_INDENT}no results recorded`]));
    }
    return lines;
  }
  if (turn.action === "open") {
    const pages = turn.pages ?? [];
    const count = pages.length > 0 ? pages.length : (turn.urls ?? []).length;
    lines.push(`${head}open ${count} page${count === 1 ? "" : "s"}`);
    if (pages.length > 0) for (const page of pages) lines.push(`${DETAIL_INDENT}${pageLine(page)}`);
    else for (const url of turn.urls ?? []) lines.push(`${DETAIL_INDENT}${bareUrl(url)}`);
    lines.push(...(pages.length > 0 ? [] : errorLine));
    return lines;
  }
  if (turn.action === "answer") {
    lines.push(`${head}answer ${voteWords(round)}`);
    lines.push(...answerLines(turn, round, width));
    return lines;
  }
  lines.push(`${head}${turn.action}`, ...errorLine);
  return lines;
}

/** The verbatim messages of one round, printed only with --full. */
function verbatimLines(round: TraceRound): string[] {
  const lines = [`${TURN_INDENT}verbatim (run ${shortHex(round.runId)})`];
  const block = (label: string, text: string | undefined) => {
    if (!text) return;
    lines.push(`${DETAIL_INDENT}${label}`);
    for (const line of pretty(text).split("\n")) lines.push(`${DETAIL_INDENT}  ${line}`);
  };
  // A failure record stores the hashes of the two request messages, never the
  // text, so say where the prompt above came from and name the input by hash.
  if (round.failure) {
    if (round.promptHash) {
      lines.push(
        round.systemPrompt
          ? `${DETAIL_INDENT}the system prompt above is a revealed seat's text for hash ${round.promptHash}, proven identical by that hash`
          : `${DETAIL_INDENT}the system prompt text is not in the failure record, only its hash ${round.promptHash}`,
      );
    }
    if (round.inputHash) {
      lines.push(`${DETAIL_INDENT}the failure record keeps only the input hash, ${round.inputHash}, never the claim JSON`);
    }
    return lines;
  }
  block("input:", round.input);
  for (const turn of round.turns) {
    block(`turn ${turn.ordinal} assistant:`, turn.assistant);
    block(`turn ${turn.ordinal} result:`, turn.result);
  }
  block("raw answer:", round.rawAnswer);
  return lines;
}

/** JSON pretty-printed when it parses, the raw text otherwise. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The pinned prompt blocks, one per distinct prompt across the rounds shown. */
function promptBlocks(trace: Trace, width: number): string[] {
  const byHash = new Map<string, { prompt: string; phases: Set<ClaimPhase> }>();
  for (const juror of trace.jurors) {
    for (const round of juror.rounds) {
      if (!round.systemPrompt) continue;
      const key = round.promptHash ?? round.systemPrompt.slice(0, 64);
      const entry = byHash.get(key) ?? { prompt: round.systemPrompt, phases: new Set<ClaimPhase>() };
      entry.phases.add(round.phase);
      byHash.set(key, entry);
    }
  }
  const lines: string[] = [];
  for (const [hash, entry] of byHash) {
    const rounds = [...entry.phases].sort((left, right) => left - right);
    const which = byHash.size > 1 ? `, round ${rounds.join(" and ")}` : "";
    lines.push(`pinned prompt${which} (hash ${shortHex(hash)})`);
    for (const paragraph of entry.prompt.split("\n")) {
      lines.push(...wrapText(paragraph, { width, prefix: TURN_INDENT, continuation: TURN_INDENT }));
    }
    lines.push("");
  }
  return lines;
}

function debateLines(turns: TraceDebateTurn[], width: number): string[] {
  const lines = [`debate  ${turns.length} turn${turns.length === 1 ? "" : "s"}`];
  for (const turn of turns) {
    const model = turn.modelId ? ` (${modelLabel(turn.modelId)})` : "";
    const head = `${TURN_INDENT}turn ${turn.ordinal + 1}, exchange ${turn.exchange}, juror ${turn.jurorIndex}${model}: `;
    if (turn.status === "SKIPPED") {
      lines.push(`${head}skipped`);
      continue;
    }
    lines.push(...wrapText(turn.argument, { width, prefix: head, continuation: `${DETAIL_INDENT}  ` }));
    if (turn.citations.length > 0) {
      lines.push(`${DETAIL_INDENT}cites ${turn.citations.map((id) => shortHex(id)).join(", ")}`);
    }
  }
  return lines;
}

/** The whole human trace, one line per array entry. */
export function renderTrace(trace: Trace, options: { full?: boolean; width?: number } = {}): string[] {
  const width = Math.max(MIN_WIDTH, options.width ?? DEFAULT_TRACE_WIDTH);
  const lines: string[] = [`claim      ${trace.claimId}`, `statement  ${trace.statement}`, ""];
  if (options.full) lines.push(...promptBlocks(trace, width));
  for (const note of trace.notes) lines.push(note, "");
  const phases = trace.phases.length > 0 ? trace.phases : ([1] as ClaimPhase[]);
  const debate = trace.debate && trace.debate.length > 0 ? trace.debate : undefined;
  let debated = false;
  for (const phase of phases) {
    // The debate sits between the two rounds; with --round 2 it leads the votes.
    if (phase === 2 && debate && !debated) {
      lines.push(...debateLines(debate, width), "");
      debated = true;
    }
    for (const juror of trace.jurors) {
      for (const round of juror.rounds.filter((entry) => entry.phase === phase)) {
        lines.push(headerLine(juror, round));
        for (const turn of round.turns) {
          lines.push(...turnLines(turn, round, width));
          if (options.full && turn.raw) lines.push(...rawLines(turn.raw));
        }
        // Every provider call of a failed seat, then how the seat ended.
        for (const attempt of round.attempts ?? []) {
          lines.push(attemptLine(attempt));
          if (options.full) lines.push(...attemptDetail(attempt));
        }
        const failed = failureLine(round);
        if (failed) lines.push(failed);
        if (options.full && !round.missing) lines.push(...verbatimLines(round));
        lines.push("");
      }
    }
    if (phase === 1 && debate && !debated) {
      lines.push(...debateLines(debate, width), "");
      debated = true;
    }
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// Machine output
// ---------------------------------------------------------------------------

/** The `--json` document: the same trail, trimmed to what a script needs. */
export function traceJson(trace: Trace): Json {
  return {
    claimId: trace.claimId,
    statement: trace.statement,
    jurors: trace.jurors.map((juror) => ({
      jurorIndex: juror.jurorIndex,
      ...(juror.modelId ? { modelId: juror.modelId } : {}),
      ...(juror.role ? { role: juror.role } : {}),
      rounds: juror.rounds.map((round) => ({
        phase: round.phase,
        runId: round.runId,
        kind: round.kind,
        ...(round.vote ? { vote: round.vote } : {}),
        ...(round.missing ? { missing: round.missing } : {}),
        turns: round.turns.map((turn) => ({
          ordinal: turn.ordinal,
          action: turn.action,
          ...(turn.intent ? { intent: turn.intent } : {}),
          ...(turn.query ? { query: turn.query } : {}),
          ...(turn.results
            ? { results: turn.results.map((row) => ({ url: row.url, ...(row.title ? { title: row.title } : {}) })) }
            : {}),
          ...(turn.urls ? { urls: turn.urls } : {}),
          ...(turn.pages
            ? {
                pages: turn.pages.map((page) => ({
                  url: page.url,
                  ...(page.evidenceId ? { evidenceId: page.evidenceId } : {}),
                  ...(page.chars === undefined ? {} : { chars: page.chars }),
                  ...(page.totalChars === undefined ? {} : { totalChars: page.totalChars }),
                })),
              }
            : {}),
          ...(turn.answer ? { answer: turn.answer } : {}),
          ...(turn.raw ? { raw: turn.raw } : {}),
        })),
        ...(round.gateway ? { gateway: round.gateway } : {}),
        ...(round.attempts ? { attempts: round.attempts } : {}),
        ...(round.failure ? { failure: round.failure } : {}),
        ...(round.timings ? { timings: round.timings } : {}),
      })),
    })),
    ...(trace.debate ? { debate: trace.debate } : {}),
  };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export type TraceOptions = TraceFilter & {
  base: string;
  claimId: string;
  fetch: typeof fetch;
  now: () => number;
  full: boolean;
  json: boolean;
  width?: number;
  out: (line: string) => void;
  err: (line: string) => void;
};

/** Fetch the public record, build the trail, print it. Exit 0, or 2 on a bad id. */
export async function trace(options: TraceOptions): Promise<number> {
  let result: AuditResult;
  try {
    result = await auditClaim(
      { base: options.base, claimId: options.claimId, kind: "claim" },
      { fetch: options.fetch, now: options.now, log: (line) => options.err(`trace: ${line}`) },
    );
  } catch (error) {
    if (error instanceof AuditInputError) throw new OvError(error.message);
    throw error;
  }
  return printTrace(result, options);
}

/** The print half, so `ov audit --trace` reuses the audit it already ran. */
export function printTrace(
  result: AuditResult,
  options: TraceFilter & { full: boolean; json: boolean; width?: number; out: (line: string) => void },
): number {
  const built = buildTrace(result, {
    ...(options.juror === undefined ? {} : { juror: options.juror }),
    ...(options.round === undefined ? {} : { round: options.round }),
  });
  if (options.json) {
    options.out(JSON.stringify(traceJson(built), null, 2));
    return 0;
  }
  const rendered = renderTrace(built, {
    full: options.full,
    ...(options.width === undefined ? {} : { width: options.width }),
  });
  for (const line of rendered) options.out(line);
  return 0;
}

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
 */
import {
  AuditInputError,
  auditClaim,
  shortHex,
  type AuditResult,
  type ClaimPhase,
  type RunAudit,
} from "../audit/audit-claim";
import { OvError, asArray, asNumber, asString, isRecord, type Json } from "./api";
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

export type TraceSearchResult = { n?: number; title?: string; url: string; snippet?: string };

export type TracePage = {
  url: string;
  evidenceId?: string;
  ref?: string;
  from?: number;
  chars?: number;
  totalChars?: number;
  truncated?: boolean;
  error?: string;
};

export type TraceTurn = {
  ordinal: number;
  /** search, open, answer, or whatever the bundle recorded. */
  action: string;
  intent?: string;
  query?: string;
  results?: TraceSearchResult[];
  urls?: string[];
  pages?: TracePage[];
  /** What the tool answered instead of a result (an exhausted budget, a fetch failure). */
  error?: string;
  /** The validated output of the run, on the answer turn. */
  answer?: Json;
  /** The verbatim assistant message, for --full. */
  assistant?: string;
  /** The verbatim user result message (page texts included), for --full. */
  result?: string;
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
  /** The raw completion the model returned, for --full. */
  rawAnswer?: string;
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

function parseJson(text: string): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Message contents are JSON strings in the bundle; be forgiving about both. */
function parseContent(content: unknown): Json | undefined {
  if (isRecord(content)) return content;
  const text = asString(content);
  if (text === undefined) return undefined;
  const direct = parseJson(text);
  if (direct) return direct;
  // Reasoning models wrap the action in a <think> block; take the object itself.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(text.slice(start, end + 1)) : undefined;
}

/** The message content as text, for --full and for the input block. */
function contentText(content: unknown): string | undefined {
  if (isRecord(content)) return JSON.stringify(content);
  return asString(content);
}

function searchResults(result: Json | undefined): TraceSearchResult[] | undefined {
  if (!result) return undefined;
  const rows = asArray(result.results).filter(isRecord);
  if (rows.length === 0) return undefined;
  return rows.map((row) => ({
    ...(asNumber(row.n) === undefined ? {} : { n: asNumber(row.n)! }),
    ...(asString(row.title) ? { title: asString(row.title)! } : {}),
    url: asString(row.url) ?? "",
    ...(asString(row.snippet) ? { snippet: asString(row.snippet)! } : {}),
  }));
}

function openedPages(result: Json | undefined): TracePage[] | undefined {
  if (!result) return undefined;
  const rows = asArray(result.pages).filter(isRecord);
  if (rows.length > 0) return rows.map(pageOf);
  // A single-url open answers with one flat page object, not a pages array.
  if (asString(result.url) !== undefined) return [pageOf(result)];
  return undefined;
}

function pageOf(row: Json): TracePage {
  return {
    url: asString(row.url) ?? "",
    ...(asString(row.evidenceId) ? { evidenceId: asString(row.evidenceId)! } : {}),
    ...(asString(row.ref) ? { ref: asString(row.ref)! } : {}),
    ...(asNumber(row.from) === undefined ? {} : { from: asNumber(row.from)! }),
    ...(asNumber(row.chars) === undefined ? {} : { chars: asNumber(row.chars)! }),
    ...(asNumber(row.totalChars) === undefined ? {} : { totalChars: asNumber(row.totalChars)! }),
    ...(row.truncated === true ? { truncated: true } : {}),
    ...(asString(row.error) ? { error: asString(row.error)! } : {}),
  };
}

function urlsOf(action: Json): string[] | undefined {
  const many = asArray(action.urls)
    .map((url) => asString(url))
    .filter((url): url is string => url !== undefined);
  if (many.length > 0) return many;
  const one = asString(action.url);
  return one ? [one] : undefined;
}

/** One turn per assistant message, its result taken from the user message after it. */
function turnsFromMessages(messages: Json[]): { turns: TraceTurn[]; system?: string; input?: string } {
  const turns: TraceTurn[] = [];
  let system: string | undefined;
  let input: string | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const role = asString(message.role);
    if (role === "system") {
      system ??= contentText(message.content);
      continue;
    }
    if (role === "user" && turns.length === 0) {
      input ??= contentText(message.content);
      continue;
    }
    if (role !== "assistant") continue;
    const action = parseContent(message.content) ?? {};
    const next = messages[index + 1];
    const isResult = next !== undefined && asString(next.role) === "user";
    const result = isResult ? parseContent(next.content) : undefined;
    turns.push({
      ordinal: turns.length + 1,
      action: asString(action.action) ?? "unknown",
      ...(asString(action.intent) ? { intent: asString(action.intent)! } : {}),
      ...(asString(action.query) ? { query: asString(action.query)! } : {}),
      ...(searchResults(result) ? { results: searchResults(result)! } : {}),
      ...(urlsOf(action) ? { urls: urlsOf(action)! } : {}),
      ...(openedPages(result) ? { pages: openedPages(result)! } : {}),
      ...(result && asString(result.error) ? { error: asString(result.error)! } : {}),
      ...(contentText(message.content) ? { assistant: contentText(message.content)! } : {}),
      ...(isResult && contentText(next.content) ? { result: contentText(next.content)! } : {}),
    });
  }
  return { turns, ...(system ? { system } : {}), ...(input ? { input } : {}) };
}

/**
 * Legacy bundles carry no messages. The transcript expands one `open` action
 * into one step per page, so consecutive open steps over the same urls are one
 * turn again.
 */
function turnsFromSteps(steps: Json[]): TraceTurn[] {
  const turns: TraceTurn[] = [];
  let openKey: string | undefined;
  for (const step of steps) {
    const action = isRecord(step.action) ? step.action : {};
    const result = isRecord(step.result) ? step.result : {};
    const name = asString(action.action) ?? "unknown";
    if (name === "answer") continue;
    if (name === "open") {
      const urls = urlsOf(action) ?? [];
      const key = urls.join(" ");
      const previous = turns.at(-1);
      const sameTurn = key.length > 0 && key === openKey && previous?.action === "open";
      // The pages of one open action arrive in url order, one step each.
      const index = sameTurn ? previous!.pages?.length ?? 0 : 0;
      const page = pageOf({ ...result, url: asString(result.url) ?? urls[index] ?? "" });
      if (sameTurn) {
        previous!.pages = [...(previous!.pages ?? []), page];
        continue;
      }
      openKey = key;
      turns.push({ ordinal: turns.length + 1, action: "open", ...(urls.length > 0 ? { urls } : {}), pages: [page] });
      continue;
    }
    openKey = undefined;
    turns.push({
      ordinal: turns.length + 1,
      action: name,
      ...(asString(action.intent) ? { intent: asString(action.intent)! } : {}),
      ...(asString(action.query) ? { query: asString(action.query)! } : {}),
      ...(searchResults(result) ? { results: searchResults(result)! } : {}),
    });
  }
  return turns;
}

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
    round.missing = missingReason(result, run);
    return round;
  }
  const request = isRecord(bundle.request) ? bundle.request : {};
  const messages = asArray(request.messages).filter(isRecord);
  const transcript = isRecord(bundle.transcript) ? bundle.transcript : undefined;
  if (messages.length > 0) {
    const built = turnsFromMessages(messages);
    round.turns = built.turns;
    if (built.system) round.systemPrompt = built.system;
    if (built.input) round.input = built.input;
  } else if (transcript) {
    round.turns = turnsFromSteps(asArray(transcript.steps).filter(isRecord));
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
  return `${parts.join("  ")}  ${voteWords(round)}  run ${shortHex(round.runId)}`;
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
        for (const turn of round.turns) lines.push(...turnLines(turn, round, width));
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
        })),
        ...(round.gateway ? { gateway: round.gateway } : {}),
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

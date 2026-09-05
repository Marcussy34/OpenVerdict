/**
 * The `ov` commands (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
 * Each takes the shared environment (API client, clock, sleep, output sinks)
 * and returns the exit code; input and request problems are thrown as
 * OvError and printed by the entry script as one `error: ...` line.
 */
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AuditInputError,
  auditClaim,
  listBoard,
  parseAuditTarget,
  renderBoard,
  renderJson,
  renderMarkdown,
  renderVerdictCard,
  type AuditResult,
} from "../audit/audit-claim";
import type { WeatherReport } from "../engine/contract";
import { weatherRefusalMessage } from "../web/weather-copy";
import {
  Api,
  OvError,
  SUBMIT_TIMEOUT_MS,
  asArray,
  asNumber,
  asString,
  isRecord,
  replyMessage,
  type ApiReply,
  type Json,
  type Sleep,
} from "./api";
import {
  NOT_CLEAR_NOTE,
  claimLink,
  renderAgent,
  renderAgents,
  renderExtract,
  renderStatus,
  weatherLines,
  weatherRuleLine,
  weatherSummary,
} from "./render";
import { printTrace, trace } from "./trace";
import { DEFAULT_WATCH_BUDGET_MS, watch, type WatchTarget } from "./watch";

/** GonkaRouter answers extraction in 10 to 60 s; give it room. */
export const EXTRACT_TIMEOUT_MS = 90_000;
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;
/** A short id typed back from the board table: 0x plus 8 to 63 hex digits. */
const HEX_PREFIX = /^0x[0-9a-fA-F]{8,63}$/;
const MIN_CLAIM = 5;
const MAX_CLAIM = 1_000;
const MIN_TEXT = 40;
const MAX_TEXT = 20_000;
const MAX_CRITERIA = 2_000;
const MAX_URLS = 5;

export type Io = {
  /** One line to stdout. */
  out: (line: string) => void;
  /** One line to stderr. */
  err: (line: string) => void;
};

export type CommandEnv = {
  api: Api;
  io: Io;
  json: boolean;
  now: () => number;
  sleep: Sleep;
  /** --timeout, when given. */
  timeoutMs?: number;
  /** Colour codes allowed on stderr notes. */
  color?: boolean;
  /** Terminal columns, for the prose `trace` wraps. */
  width?: number;
};

function printJson(env: CommandEnv, value: unknown): void {
  env.io.out(JSON.stringify(value, null, 2));
}

function dim(env: CommandEnv, text: string): string {
  return env.color ? `\u001b[2m${text}\u001b[0m` : text;
}

// ---------------------------------------------------------------------------
// weather
// ---------------------------------------------------------------------------

export async function weatherCommand(env: CommandEnv): Promise<number> {
  const report = await env.api.weather();
  if (env.json) {
    printJson(env, report);
    return 0;
  }
  for (const line of weatherLines(report)) env.io.out(line);
  env.io.out(weatherRuleLine(report));
  env.io.out(weatherSummary(report, env.now()));
  if (!report.clear) env.io.out(NOT_CLEAR_NOTE);
  return 0;
}

// ---------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------

export async function boardCommand(env: CommandEnv, options: { limit?: number }): Promise<number> {
  const rows = await listBoard(env.api.base, {
    fetch: withTimeout(env),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  if (env.json) printJson(env, { claims: rows });
  else env.io.out(renderBoard(rows).trimEnd());
  return 0;
}

// ---------------------------------------------------------------------------
// agents and agent: the jury roster and one seat
// ---------------------------------------------------------------------------

export async function agentsCommand(env: CommandEnv): Promise<number> {
  const agents = await env.api.agentDirectory();
  if (env.json) {
    printJson(env, { agents });
    return 0;
  }
  if (agents.length === 0) {
    env.io.out("no seats in the registry on this deployment");
    return 0;
  }
  for (const line of renderAgents(agents, env.api.base)) env.io.out(line);
  return 0;
}

export async function agentCommand(env: CommandEnv, input: string): Promise<number> {
  const agentId = agentIdOf(input);
  const agents = await env.api.agentDirectory();
  // Seat ids are shortened in the roster table, so a prefix resolves like a claim id.
  const matches = agents.filter((agent) => agent.agentProfileId.toLowerCase().startsWith(agentId));
  if (matches.length === 0) throw new OvError(`seat not found: ${input} (ov agents lists every seat with its full id)`);
  if (matches.length > 1) {
    const listed = matches.map((agent) => `  ${agent.agentProfileId}`).join("\n");
    throw new OvError(`${input} matches ${matches.length} seats, give more of the id:\n${listed}`);
  }
  const agent = matches[0]!;
  const manifest = await env.api.agentManifest(agent.agentProfileId);
  if (env.json) {
    printJson(env, { agent, manifest: manifest ?? null });
    return 0;
  }
  for (const line of renderAgent(agent, manifest, env.api.base)) env.io.out(line);
  return 0;
}

/** A seat id, an id prefix from the roster table, or an agent page link. */
function agentIdOf(input: string): string {
  const trimmed = input.trim();
  if (HEX_ID.test(trimmed)) return trimmed.toLowerCase();
  const match = trimmed.match(/\/agents\/(0x[0-9a-fA-F]+)/);
  if (match?.[1]) return match[1].toLowerCase();
  throw new OvError(`not a seat id or link: ${input}`);
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

export type ExtractInput = { url?: string; text?: string; file?: string };

export async function extractCommand(env: CommandEnv, input: ExtractInput): Promise<number> {
  const given = [input.url, input.text, input.file].filter((value) => value !== undefined).length;
  if (given !== 1) throw new OvError("extract needs exactly one of --url, --text or --file");
  let body: { url: string } | { text: string };
  if (input.url !== undefined) {
    if (!/^https?:\/\//i.test(input.url.trim())) throw new OvError(`--url expects an http(s) address, got ${input.url}`);
    body = { url: input.url.trim() };
  } else {
    const text = (input.text ?? readText(input.file!)).trim();
    if (text.length < MIN_TEXT || text.length > MAX_TEXT) {
      throw new OvError(`text must be ${MIN_TEXT} to ${MAX_TEXT} characters, got ${text.length}`);
    }
    body = { text };
  }
  let reply: ApiReply;
  try {
    reply = await env.api.request("/api/extract-claim", {
      method: "POST",
      body,
      timeoutMs: env.timeoutMs ?? EXTRACT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof OvError && /timed out/.test(error.message)) {
      throw new OvError("extraction timed out; GonkaRouter is probably saturated, try again in a minute");
    }
    throw error;
  }
  if (reply.status === 200 && isRecord(reply.body)) {
    if (env.json) printJson(env, reply.body);
    else for (const line of renderExtract(reply.body)) env.io.out(line);
    return 0;
  }
  const code = isRecord(reply.body) ? asString(reply.body.error) ?? "" : "";
  if (reply.status === 404 || code === "NO_CLAIM_FOUND") {
    if (env.json) printJson(env, reply.body ?? { error: "NO_CLAIM_FOUND" });
    throw new OvError("no checkable claim found");
  }
  throw writeError(reply, "extraction");
}

function readText(path: string): string {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch (error) {
    throw new OvError(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The plain error for a failed public write (extract, submit) with the exit code the spec fixes. */
function writeError(reply: ApiReply, what: string): OvError {
  const code = isRecord(reply.body) ? asString(reply.body.error) ?? "" : "";
  const message = isRecord(reply.body) ? asString(reply.body.message) : undefined;
  if (reply.status === 403 || code === "writes_disabled") {
    return new OvError(`public submissions are disabled on this deployment (${message ?? "writes_disabled"})`, 5);
  }
  if (reply.status === 429 || code === "rate_limited") {
    return new OvError(`rate limited: ${message ?? "too many submissions, retry later"} (five per minute)`, 5);
  }
  if (reply.status === 400) return new OvError(message ?? replyMessage(reply));
  if (reply.status === 503 || /engine_not_wired/i.test(code)) {
    return new OvError("the engine is not wired on this deployment (ENGINE_NOT_WIRED)");
  }
  if (code === "FETCH_FAILED") return new OvError(message ?? "the source page could not be fetched safely");
  if (reply.status === 502 || reply.status === 504) {
    return new OvError(`no answer from the ${what} model (HTTP ${reply.status}); GonkaRouter is probably saturated, try again in a minute`);
  }
  return new OvError(`${what} failed: ${replyMessage(reply)}`);
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export type SubmitInput = { claim: string; text?: string; urls: string[]; criteria?: string };

/**
 * How far back a launch counts as "just now". The board carries no creation
 * time, but every deadline ladder sets the evidence cutoff first and closest
 * to creation (60 s after it on the hosted ladder), so a claim whose cutoff
 * is still within this of now was created in the last couple of minutes.
 */
const RECENT_LAUNCH_MS = 120_000;

/**
 * The newest claim on the board carrying this exact statement and a fresh
 * ladder, or undefined. Used only after a submission timed out, to tell a
 * launch that answered too late from one that never happened.
 */
async function recentClaimOnBoard(
  env: CommandEnv,
  statement: string,
): Promise<{ claimId: string } | undefined> {
  let reply: ApiReply;
  try {
    reply = await env.api.request("/api/claims?limit=10");
  } catch {
    // The board is a second opinion; its own failure must not replace the
    // timeout the caller is reporting.
    return undefined;
  }
  const nowMs = env.now();
  // The board is newest first, so the first match is the claim just launched.
  for (const entry of (isRecord(reply.body) ? asArray(reply.body.claims) : []).slice(0, 10)) {
    if (!isRecord(entry)) continue;
    if (asString(entry.statement)?.trim() !== statement) continue;
    const deadlines = isRecord(entry.deadlines) ? entry.deadlines : undefined;
    const cutoffMs = deadlines === undefined ? undefined : asNumber(deadlines.evidenceCutoffMs);
    if (cutoffMs === undefined || Math.abs(cutoffMs - nowMs) > RECENT_LAUNCH_MS) continue;
    const claimId = asString(entry.claimId);
    if (claimId) return { claimId };
  }
  return undefined;
}

/** The result of a launch, however it was learned: the id, the link, the wait. */
function printSubmitted(env: CommandEnv, claimId: string, body: Json): void {
  const link = claimLink(env.api.base, claimId);
  if (env.json) {
    printJson(env, { ...body, claimId, link, kind: "claim" });
    return;
  }
  env.io.out(`claim submitted: ${claimId}`);
  env.io.out(`link: ${link}`);
  env.io.out("the jury is forming; a one-round verdict lands about 11 to 12 minutes after launch, a two-round verdict about 32 minutes");
  env.io.out(`watch it: ov watch ${claimId}`);
}

export async function submitCommand(env: CommandEnv, input: SubmitInput): Promise<number> {
  const claim = input.claim.trim();
  if (claim.length < MIN_CLAIM || claim.length > MAX_CLAIM) {
    throw new OvError(`the claim must be ${MIN_CLAIM} to ${MAX_CLAIM} characters, got ${claim.length}`);
  }
  const text = input.text?.trim();
  if (text !== undefined && text.length > MAX_TEXT) throw new OvError(`--text is longer than ${MAX_TEXT} characters`);
  if (input.urls.length > MAX_URLS) throw new OvError(`at most ${MAX_URLS} urls are accepted`);
  for (const url of input.urls) {
    if (!/^https:\/\//i.test(url.trim())) throw new OvError(`--url expects an https address, got ${url}`);
  }
  const criteria = input.criteria?.trim();
  if (criteria !== undefined && criteria.length > MAX_CRITERIA) {
    throw new OvError(`--criteria is longer than ${MAX_CRITERIA} characters`);
  }
  let reply: ApiReply;
  try {
    reply = await env.api.request("/api/fact-checks", {
      method: "POST",
      body: {
        claim,
        ...(text ? { text } : {}),
        ...(input.urls.length > 0 ? { urls: input.urls.map((url) => url.trim()) } : {}),
        ...(criteria ? { resolutionCriteria: criteria } : {}),
      },
      // The launch, not a page load: see SUBMIT_TIMEOUT_MS.
      timeoutMs: env.timeoutMs ?? SUBMIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (!(error instanceof OvError) || !error.timedOut) throw error;
    // A timed-out write is not a failed write. On 2026-09-05 the server was
    // still freezing evidence and drawing the committee when the client gave
    // up, the claim launched, and a retry would have submitted it twice.
    const launched = await recentClaimOnBoard(env, claim);
    if (launched === undefined) {
      throw new OvError(
        `${error.message}. The statement is not among the ten newest claims on the board, so nothing launched; check ov board before submitting again.`,
        2,
        true,
      );
    }
    env.io.err(
      dim(env, "the submission timed out, but the claim had already launched; found it on the board"),
    );
    printSubmitted(env, launched.claimId, { timedOut: true });
    return 0;
  }
  const body = isRecord(reply.body) ? reply.body : {};
  const claimId = asString(body.claimId);
  if (reply.status === 200 && claimId) {
    printSubmitted(env, claimId, body);
    return 0;
  }
  // There is no queue: the jury either sits now or the submission is refused
  // and nothing is stored. The route sends one sentence naming the families
  // that are down, so relay it verbatim rather than wrapping it in another.
  // The other 503 on this route is engine_not_wired, hence the error field.
  if (reply.status === 503 && asString(body.error) === "WEATHER_NOT_CLEAR") {
    const weather = isRecord(body.weather) ? (body.weather as unknown as WeatherReport) : undefined;
    if (env.json) printJson(env, body);
    else if (weather) {
      for (const line of weatherLines(weather)) env.io.out(line);
      env.io.out(weatherRuleLine(weather));
      env.io.out(weatherSummary(weather, env.now()));
    }
    // The same sentence the route and the console use, rebuilt only if it is missing.
    const sentence =
      asString(body.message) ??
      (weather ? weatherRefusalMessage(weather) : "The jury cannot sit right now.");
    throw new OvError(
      `${sentence} Nothing was stored. Run ov weather and submit again when all four rows answer.`,
      5,
    );
  }
  throw writeError(reply, "submission");
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function statusCommand(env: CommandEnv, input: string): Promise<number> {
  const target = await resolveTarget(env, input);
  const inspection = await env.api.claim(target.id);
  if (!inspection) throw new OvError(`claim not found: ${target.id}`);
  if (env.json) printJson(env, inspection);
  else for (const line of renderStatus(inspection, env.api.base, env.now())) env.io.out(line);
  return 0;
}

/**
 * The board shortens ids to ten characters and people type them back: a
 * prefix resolves through the public board to the one claim it starts with.
 */
export async function resolveClaimPrefix(env: CommandEnv, prefix: string): Promise<string> {
  const wanted = prefix.toLowerCase();
  const rows = await listBoard(env.api.base, { fetch: withTimeout(env), limit: 200 });
  const matches = rows.filter((row) => row.claimId.toLowerCase().startsWith(wanted));
  if (matches.length === 1) {
    const claimId = matches[0]!.claimId.toLowerCase();
    env.io.err(dim(env, `resolved ${prefix} to ${claimId.slice(0, 6)}\u2026${claimId.slice(-4)}`));
    return claimId;
  }
  if (matches.length === 0) {
    throw new OvError(`claim not found: ${prefix} (ids are 66 characters, ov board prints full ids)`);
  }
  const listed = matches.map((row) => `  ${row.claimId}`).join("\n");
  throw new OvError(`${prefix} matches ${matches.length} claims, give more of the id:\n${listed}`);
}

/** watchTargetOf with prefix resolution: the front door of status, watch and audit. */
export async function resolveTarget(env: CommandEnv, input: string): Promise<WatchTarget> {
  const trimmed = input.trim();
  if (HEX_PREFIX.test(trimmed)) return { kind: "claim", id: await resolveClaimPrefix(env, trimmed) };
  return watchTargetOf(trimmed);
}

/** A claim link or a bare claim id. */
export function watchTargetOf(input: string): WatchTarget {
  const trimmed = input.trim();
  if (HEX_ID.test(trimmed)) return { kind: "id", id: trimmed.toLowerCase() };
  let target;
  try {
    target = parseAuditTarget(trimmed);
  } catch (error) {
    throw new OvError(error instanceof Error ? error.message : String(error));
  }
  return { kind: target.kind, id: target.claimId };
}

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------

export type WatchInput = { target: string; budgetMs?: number; since?: number; verbose: boolean };

export async function watchCommand(env: CommandEnv, input: WatchInput): Promise<number> {
  const result = await watch({
    api: env.api,
    target: await resolveTarget(env, input.target),
    budgetMs: input.budgetMs ?? DEFAULT_WATCH_BUDGET_MS,
    ...(input.since === undefined ? {} : { since: input.since }),
    verbose: input.verbose,
    json: env.json,
    now: env.now,
    sleep: env.sleep,
    out: env.io.out,
    err: env.io.err,
  });
  return result.exitCode;
}

// ---------------------------------------------------------------------------
// audit: the same flags and exit codes as `pnpm audit:claim`
// ---------------------------------------------------------------------------

export type AuditInput = {
  target: string;
  jsonPath?: string;
  outPath?: string;
  run?: string;
  quiet: boolean;
  /** --trace: print the research trail after the verdict. */
  trace?: TraceFlags;
};

export async function auditCommand(env: CommandEnv, input: AuditInput): Promise<number> {
  const typed = input.target.trim();
  const claimInput = HEX_PREFIX.test(typed) ? await resolveClaimPrefix(env, typed) : typed;
  let target;
  try {
    target = parseAuditTarget(claimInput, { base: env.api.base });
    if (input.run) target.runId = parseRunFlag(input.run);
  } catch (error) {
    throw new OvError(error instanceof Error ? error.message : String(error));
  }
  const result = await auditClaim(target, {
    fetch: withTimeout(env),
    log: (line) => env.io.err(`audit: ${line}`),
  });
  let jsonPath: string | undefined;
  if (input.jsonPath) jsonPath = writeFile(input.jsonPath, renderJson(result));
  const markdown = renderMarkdown(result, {
    ...(jsonPath ? { jsonPath } : {}),
    ...(target.runId ? { runId: target.runId } : {}),
  });
  const outPath = writeFile(input.outPath ?? `.audit/${result.claim.claimId}.md`, markdown);
  env.io.out((input.quiet ? renderVerdictCard(result) : markdown).trimEnd());
  // The trail is one command away; the dossier file format stays untouched.
  env.io.out(`research trail: ov trace ${result.claim.claimId}`);
  if (input.trace) {
    env.io.out("");
    printTrace(result, {
      ...input.trace,
      json: false,
      out: env.io.out,
      ...(env.width === undefined ? {} : { width: env.width }),
    });
  }
  env.io.err(`audit: dossier written to ${outPath}${jsonPath ? `, JSON to ${jsonPath}` : ""}`);
  return result.exitCode;
}

// ---------------------------------------------------------------------------
// trace: what every juror searched, opened, cited and answered
// ---------------------------------------------------------------------------

/** The flags `trace` shares with `audit --trace`. */
export type TraceFlags = { juror?: number; round?: 1 | 2; full: boolean };

/** `--from` reads a saved audit instead of the record, so `target` is optional. */
export type TraceCommandInput = TraceFlags & { target?: string; from?: string };

export async function traceCommand(env: CommandEnv, input: TraceCommandInput): Promise<number> {
  // --from answers from a file the audit already wrote, without a single fetch.
  if (input.from !== undefined) {
    const result = readAuditFile(input.from);
    if (input.target !== undefined) checkSameClaim(result, input.target);
    return printTrace(result, {
      full: input.full,
      json: env.json,
      ...(input.juror === undefined ? {} : { juror: input.juror }),
      ...(input.round === undefined ? {} : { round: input.round }),
      ...(env.width === undefined ? {} : { width: env.width }),
      out: env.io.out,
    });
  }
  if (input.target === undefined) throw new OvError("trace needs a claim id or link, or --from <audit.json>");
  const target = await resolveTarget(env, input.target);
  return trace({
    base: env.api.base,
    claimId: target.id,
    fetch: withTimeout(env),
    now: env.now,
    full: input.full,
    json: env.json,
    ...(input.juror === undefined ? {} : { juror: input.juror }),
    ...(input.round === undefined ? {} : { round: input.round }),
    ...(env.width === undefined ? {} : { width: env.width }),
    out: env.io.out,
    err: env.io.err,
  });
}

/** The saved audit `ov audit --json <file>` wrote, read back for `ov trace --from`. */
function readAuditFile(path: string): AuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(path));
  } catch {
    throw new OvError(`${path} is not JSON; --from expects the file ov audit --json writes`);
  }
  const document = isRecord(parsed) ? parsed : {};
  const claim = isRecord(document.claim) ? document.claim : {};
  const usable =
    document.version === 1 &&
    asString(claim.claimId) !== undefined &&
    Array.isArray(document.jury) &&
    Array.isArray(document.runs) &&
    isRecord(document.sources);
  if (!usable) throw new OvError(`${path} is not an audit document; --from expects the file ov audit --json writes`);
  return document as unknown as AuditResult;
}

/** With both a file and a target, the file must hold the claim that was asked for. */
function checkSameClaim(result: AuditResult, typed: string): void {
  const trimmed = typed.trim();
  const wanted = HEX_PREFIX.test(trimmed) ? trimmed.toLowerCase() : watchTargetOf(trimmed).id.toLowerCase();
  if (result.claim.claimId.toLowerCase().startsWith(wanted)) return;
  throw new OvError(`the audit file holds claim ${result.claim.claimId}, not ${trimmed}`);
}

/** --run accepts a bare run id or a run link. */
function parseRunFlag(value: string): string {
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value.toLowerCase();
  const match = value.match(/\/runs\/(0x[0-9a-fA-F]{1,64})/);
  if (match?.[1]) return match[1].toLowerCase();
  throw new AuditInputError(`--run expects a run id or a run link, got ${value}`);
}

function writeFile(path: string, content: string): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

/** The audit library takes a raw fetch; wrap it so every call still has a timeout. */
function withTimeout(env: CommandEnv): typeof fetch {
  const timeoutMs = env.timeoutMs ?? 20_000;
  const inner = env.api.fetchImpl;
  return (input, init) => inner(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

const COMMAND_HELP: Record<string, { usage: string; about: string; example: string }> = {
  weather: {
    usage: "ov weather",
    about: "Is the jury healthy? One line per model family (DeepSeek, MiniMax, Kimi, Web search), then clear or not clear.",
    example: "ov weather",
  },
  board: {
    usage: "ov board [--limit <n>]   (alias: ov claims)",
    about: "The public board: every claim, newest first, with state, result, score and attempt.",
    example: "ov board --limit 5",
  },
  agents: {
    usage: "ov agents",
    about: "The jury roster: every seat with its model, role, stake, lifetime rewards and track record.",
    example: "ov agents",
  },
  agent: {
    usage: "ov agent <seat id, id prefix or link>",
    about: "One seat: its stake, track record and published manifest (prompt spec, tool policy, evidence policy).",
    example: "ov agent 0x4ee8af570a",
  },
  extract: {
    usage: "ov extract (--url <url> | --text \"<text>\" | --file <path>)",
    about: "Extract up to three checkable claims from a page or a paragraph (text 40 to 20000 characters).",
    example: "ov extract --url https://en.wikipedia.org/wiki/Eiffel_Tower",
  },
  submit: {
    usage: "ov submit \"<claim>\" [--text \"<evidence text>\"] [--url <https url>]... [--criteria \"<text>\"]",
    about: "Submit a claim to the jury (5 to 1000 characters, up to 5 https urls). Refused when the weather is not clear.",
    example: "ov submit \"The Eiffel Tower was completed in 1889.\"",
  },
  status: {
    usage: "ov status <claim id or link>",
    about: "One block: statement, state in plain words, seats committed and revealed, attempt, next deadline, result.",
    example: "ov status 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6",
  },
  watch: {
    usage: "ov watch <claim id or claim link> [--for <duration>] [--since <sequence>] [--verbose]",
    about: "Follow a verification live, one dated line per step, until it ends or --for (default 9m) runs out.",
    example: "ov watch 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --for 9m --since 45",
  },
  audit: {
    usage: "ov audit <claim id or link> [--json <file>] [--out <file>] [--run <runId>] [--quiet] [--trace]",
    about: "Rebuild and check the whole public record of a verdict (same flags and exit codes as pnpm audit:claim).",
    example: "ov audit 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --quiet",
  },
  trace: {
    usage: "ov trace [<claim id or link>] [--from <audit.json>] [--juror <n>] [--round 1|2] [--full]",
    about: "The research trail: every juror's searches, opened pages, quotes, answer and gateway receipt, turn by turn.",
    example: "ov trace 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --juror 1",
  },
};

/** Command aliases: the console calls the board "Claims", so `ov claims` runs it too. */
export const ALIASES: Record<string, string> = { claims: "board" };

/** The command an alias stands for, or the name itself. */
export function resolveCommand(name: string): string {
  return ALIASES[name] ?? name;
}

export const EXIT_CODES = [
  "0  success",
  "2  input or request error (one error: line on stderr)",
  "3  the claim voided or gave up (watch)",
  "4  watch stopped before the end (timeout or budget)",
  "5  the request was refused and nothing was stored: rate limited, writes disabled, or the jury cannot sit (submit, extract)",
];

export function helpText(topic?: string): string {
  const lines: string[] = [];
  const command = topic === undefined ? undefined : resolveCommand(topic);
  if (command && COMMAND_HELP[command]) {
    const entry = COMMAND_HELP[command];
    lines.push(`usage: ${entry.usage}`, "", entry.about, "", `example: ${entry.example}`);
    if (command === "audit") lines.push("", "exit codes: 0 every check passed or was unavailable, 1 any FAIL, 2 input or fetch error");
    if (command === "trace") {
      lines.push(
        "",
        "--full adds the pinned system prompt once and every message verbatim, page texts included.",
        "A seat that failed closed prints its recorded trail, its attempt log and its failure line.",
        "--from <audit.json> reads the file ov audit --json wrote instead of refetching, so the trail lands in under a second.",
        "--json prints the same trail as one JSON document. Exit codes: 0 success, 2 unknown claim or fetch error.",
      );
    }
    return lines.join("\n");
  }
  lines.push("usage: ov <command> [options]", "", "commands:");
  for (const [name, entry] of Object.entries(COMMAND_HELP)) {
    lines.push(`  ${name.padEnd(8)} ${entry.about}`);
    lines.push(`  ${"".padEnd(8)} example: ${entry.example}`);
  }
  lines.push(
    "  help     ov help [command]",
    "",
    "global options:",
    "  --base <url>          another deployment (default https://app.openverdict.info)",
    "  --json                machine output on stdout, one JSON document (NDJSON for watch), no prose",
    "  --no-banner           skip the banner (or set OV_NO_BANNER=1)",
    "  --no-color            no colour codes in the banner",
    "  --timeout <duration>  per request timeout, durations accept 30s, 9m, 1h",
    "",
    "exit codes:",
    ...EXIT_CODES.map((line) => `  ${line}`),
  );
  return lines.join("\n");
}

export function isCommand(name: string): boolean {
  return resolveCommand(name) in COMMAND_HELP || name === "help";
}

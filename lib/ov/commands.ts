/**
 * The eight `ov` commands (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
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
} from "../audit/audit-claim";
import type { WeatherReport } from "../engine/contract";
import { Api, OvError, asString, isRecord, replyMessage, type ApiReply, type Sleep } from "./api";
import {
  NOT_CLEAR_NOTE,
  claimLink,
  queueLink,
  renderExtract,
  renderQueue,
  renderStatus,
  weatherLines,
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
  const reply = await env.api.request("/api/fact-checks", {
    method: "POST",
    body: {
      claim,
      ...(text ? { text } : {}),
      ...(input.urls.length > 0 ? { urls: input.urls.map((url) => url.trim()) } : {}),
      ...(criteria ? { resolutionCriteria: criteria } : {}),
    },
    ...(env.timeoutMs === undefined ? {} : { timeoutMs: env.timeoutMs }),
  });
  const body = isRecord(reply.body) ? reply.body : {};
  const claimId = asString(body.claimId);
  const queueId = asString(body.queueId);
  if (reply.status === 200 && claimId) {
    const link = claimLink(env.api.base, claimId);
    if (env.json) {
      printJson(env, { ...body, link, kind: "claim" });
      return 0;
    }
    env.io.out(`claim submitted: ${claimId}`);
    env.io.out(`link: ${link}`);
    env.io.out("the jury is forming; a one-round verdict lands about 11 to 12 minutes after launch, a two-round verdict about 32 minutes");
    env.io.out(`watch it: ov watch ${claimId}`);
    return 0;
  }
  if (reply.status === 202 && queueId) {
    const link = queueLink(env.api.base, queueId);
    if (env.json) {
      printJson(env, { ...body, link, kind: "queued" });
      return 0;
    }
    env.io.out(`queued: ${queueId}`);
    env.io.out(`link: ${link}`);
    const weather = isRecord(body.weather) ? (body.weather as unknown as WeatherReport) : undefined;
    if (weather) {
      env.io.out("weather:");
      for (const line of weatherLines(weather)) env.io.out(`  ${line}`);
      env.io.out(`  ${weatherSummary(weather, env.now())}`);
    }
    env.io.out("the engine launches it when all four answer; queued items expire after six hours");
    env.io.out(`watch it: ov watch ${queueId}`);
    return 0;
  }
  throw writeError(reply, "submission");
}

// ---------------------------------------------------------------------------
// queue
// ---------------------------------------------------------------------------

export async function queueCommand(env: CommandEnv, input: string): Promise<number> {
  const queueId = queueIdOf(input);
  const item = await env.api.queue(queueId);
  if (!item) throw new OvError(`queue item not found: ${queueId}`);
  if (env.json) printJson(env, item);
  else for (const line of renderQueue(item, env.api.base, env.now())) env.io.out(line);
  return 0;
}

/** A queue id or a queue link. */
function queueIdOf(input: string): string {
  const trimmed = input.trim();
  if (HEX_ID.test(trimmed)) return trimmed.toLowerCase();
  const match = trimmed.match(/\/fact-check\/queue\/(0x[0-9a-fA-F]+)/);
  if (match?.[1]) return match[1].toLowerCase();
  throw new OvError(`not a queue id or link: ${input}`);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function statusCommand(env: CommandEnv, input: string): Promise<number> {
  const target = await resolveTarget(env, input);
  if (target.kind === "queue") return queueCommand(env, target.id);
  const inspection = await env.api.claim(target.id);
  if (!inspection) {
    // A bare id may be a queue item.
    if (target.kind === "id" && (await env.api.queue(target.id))) return queueCommand(env, target.id);
    throw new OvError(`claim not found: ${target.id}`);
  }
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

/** A claim link, a queue link, or a bare id that may be either. */
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

export type TraceCommandInput = TraceFlags & { target: string };

export async function traceCommand(env: CommandEnv, input: TraceCommandInput): Promise<number> {
  const target = await resolveTarget(env, input.target);
  if (target.kind === "queue") {
    throw new OvError(`${target.id} is a queued submission: there is no jury yet, try ov queue ${target.id}`);
  }
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
    usage: "ov board [--limit <n>]",
    about: "The public board: every claim, newest first, with state, result, score and attempt.",
    example: "ov board --limit 5",
  },
  extract: {
    usage: "ov extract (--url <url> | --text \"<text>\" | --file <path>)",
    about: "Extract up to three checkable claims from a page or a paragraph (text 40 to 20000 characters).",
    example: "ov extract --url https://en.wikipedia.org/wiki/Eiffel_Tower",
  },
  submit: {
    usage: "ov submit \"<claim>\" [--text \"<evidence text>\"] [--url <https url>]... [--criteria \"<text>\"]",
    about: "Submit a claim to the jury (5 to 1000 characters, up to 5 https urls). Queued when the weather is not clear.",
    example: "ov submit \"The Eiffel Tower was completed in 1889.\"",
  },
  queue: {
    usage: "ov queue <queueId or link>",
    about: "A queued submission: QUEUED, LAUNCHED (with the claim), EXPIRED or CANCELLED, plus the weather.",
    example: "ov queue 0x9f3c...",
  },
  status: {
    usage: "ov status <claim id or link>",
    about: "One block: statement, state in plain words, seats committed and revealed, attempt, next deadline, result.",
    example: "ov status 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6",
  },
  watch: {
    usage: "ov watch <claim id, claim link or queue id> [--for <duration>] [--since <sequence>] [--verbose]",
    about: "Follow a verification live, one dated line per step, until it ends or --for (default 9m) runs out.",
    example: "ov watch 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --for 9m --since 45",
  },
  audit: {
    usage: "ov audit <claim id or link> [--json <file>] [--out <file>] [--run <runId>] [--quiet] [--trace]",
    about: "Rebuild and check the whole public record of a verdict (same flags and exit codes as pnpm audit:claim).",
    example: "ov audit 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --quiet",
  },
  trace: {
    usage: "ov trace <claim id or link> [--juror <n>] [--round 1|2] [--full]",
    about: "The research trail: every juror's searches, opened pages, quotes, answer and gateway receipt, turn by turn.",
    example: "ov trace 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --juror 1",
  },
};

export const EXIT_CODES = [
  "0  success",
  "2  input or request error (one error: line on stderr)",
  "3  the claim voided or gave up (watch)",
  "4  watch stopped before the end (timeout or budget)",
  "5  rate limited or writes disabled (submit, extract)",
];

export function helpText(command?: string): string {
  const lines: string[] = [];
  if (command && COMMAND_HELP[command]) {
    const entry = COMMAND_HELP[command];
    lines.push(`usage: ${entry.usage}`, "", entry.about, "", `example: ${entry.example}`);
    if (command === "audit") lines.push("", "exit codes: 0 every check passed or was unavailable, 1 any FAIL, 2 input or fetch error");
    if (command === "trace") {
      lines.push(
        "",
        "--full adds the pinned system prompt once and every message verbatim, page texts included.",
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
  return name in COMMAND_HELP || name === "help";
}

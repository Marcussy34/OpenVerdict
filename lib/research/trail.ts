/**
 * One juror's research trail, rebuilt from its public run bundle.
 *
 * The bundle's `request.messages` are the record of what the model actually
 * did: each assistant message is one action, the user message after it is the
 * result the engine handed back. Legacy bundles carry no messages, so the
 * sealed transcript's steps stand in for them.
 *
 * Shared by `ov trace`, which prints the trail, and by the console, which
 * shows the same steps on a juror card for claims that ran before the live
 * research feed existed. Pure: JSON in, turns out, no I/O and no clock.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export type TrailSearchResult = {
  n?: number;
  title?: string;
  url: string;
  snippet?: string;
};

export type TrailPage = {
  url: string;
  evidenceId?: string;
  ref?: string;
  from?: number;
  chars?: number;
  totalChars?: number;
  truncated?: boolean;
  error?: string;
};

export type TrailTurn = {
  ordinal: number;
  /** search, open, answer, or whatever the bundle recorded. */
  action: string;
  intent?: string;
  query?: string;
  results?: TrailSearchResult[];
  urls?: string[];
  pages?: TrailPage[];
  /** What the tool answered instead of a result (an exhausted budget, a fetch failure). */
  error?: string;
  /** The verbatim assistant message, for --full. */
  assistant?: string;
  /** The verbatim user result message (page texts included), for --full. */
  result?: string;
};

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

function searchResults(result: Json | undefined): TrailSearchResult[] | undefined {
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

function openedPages(result: Json | undefined): TrailPage[] | undefined {
  if (!result) return undefined;
  const rows = asArray(result.pages).filter(isRecord);
  if (rows.length > 0) return rows.map(pageOf);
  // A single-url open answers with one flat page object, not a pages array.
  if (asString(result.url) !== undefined) return [pageOf(result)];
  return undefined;
}

function pageOf(row: Json): TrailPage {
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
export function trailFromMessages(
  messages: Json[],
): { turns: TrailTurn[]; system?: string; input?: string } {
  const turns: TrailTurn[] = [];
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
export function trailFromSteps(steps: Json[]): TrailTurn[] {
  const turns: TrailTurn[] = [];
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

/**
 * The trail of one run bundle: the conversation when the bundle has one, the
 * sealed transcript's steps otherwise. A table vote has neither and answers
 * with no turns.
 */
export function runTrail(bundle: unknown): TrailTurn[] {
  if (!isRecord(bundle)) return [];
  const request = isRecord(bundle.request) ? bundle.request : {};
  const messages = asArray(request.messages).filter(isRecord);
  if (messages.length > 0) return trailFromMessages(messages).turns;
  const transcript = isRecord(bundle.transcript) ? bundle.transcript : undefined;
  return transcript === undefined
    ? []
    : trailFromSteps(asArray(transcript.steps).filter(isRecord));
}

/**
 * When each model turn completed, by turn number, from the sealed transcript.
 * A turn recorded as several steps (a batched open) keeps its last time.
 */
export function trailTurnTimes(bundle: unknown): Map<number, number> {
  const times = new Map<number, number>();
  if (!isRecord(bundle)) return times;
  const transcript = isRecord(bundle.transcript) ? bundle.transcript : undefined;
  for (const step of asArray(transcript?.steps).filter(isRecord)) {
    const turn = asNumber(step.turn);
    const completedAtMs = asNumber(step.completedAtMs);
    if (turn === undefined || completedAtMs === undefined) continue;
    times.set(turn, Math.max(times.get(turn) ?? 0, completedAtMs));
  }
  return times;
}

/** When the run itself finished, the fallback time for a turn with none. */
export function runCompletedAtMs(bundle: unknown): number | undefined {
  if (!isRecord(bundle)) return undefined;
  const audit = isRecord(bundle.audit) ? bundle.audit : undefined;
  return asNumber(audit?.completedAtMs);
}

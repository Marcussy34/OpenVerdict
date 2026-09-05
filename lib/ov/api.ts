/**
 * Public API client for the `ov` CLI (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
 *
 * Every call goes through the injected fetch with a hard timeout, so tests
 * run without a network and the CLI never hangs. Public endpoints only: no
 * keys, no database. Failures become OvError with the exit code the CLI
 * should end with (2 request error, 5 rate limited or writes disabled).
 */
import type {
  AgentDirectoryEntry,
  ClaimInspection,
  WeatherReport,
} from "../engine/contract";
import type { AgentManifestDocument } from "../protocol/types";

export const DEFAULT_BASE = "https://app.openverdict.info";
/** Per request, unless a command passes its own. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * A submission answers only once the claim exists: the statement and the
 * criteria go to Walrus, `create_claim` runs on Sui and the committee is
 * drawn before the route replies. That took about 20 s on 2026-09-05 and the
 * 20 s default fired first, so the CLI reported a failure for a claim that
 * had launched. Ninety seconds covers a slow launch with room to spare.
 */
export const SUBMIT_TIMEOUT_MS = 90_000;
/** The SSE server heartbeats every 15 s; silence this long means a dead link. */
export const DEFAULT_STREAM_IDLE_MS = 90_000;
const USER_AGENT = "OpenVerdict ov CLI";

export type Json = Record<string, unknown>;

/** Sleep that ends early (resolved, not rejected) when the signal aborts. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** One HTTP reply: the parsed JSON body when there was one, the raw text otherwise. */
export type ApiReply = { status: number; body: unknown; text: string };

export type ApiOptions = {
  base: string;
  fetch: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
};

/** One event line of GET /api/claims/{id}/events. */
export type StreamEvent = {
  sequence: number;
  kind: string;
  occurredAt?: string;
  /** Some events (inference_completed) are published after they occurred; lines use the later time. */
  publishedAt?: string;
  transactionDigest?: string;
  payload: Json;
  raw: Json;
};

/** Thrown for anything the CLI reports as `error: ...` and exits with. */
export class OvError extends Error {
  override readonly name = "OvError";
  constructor(
    message: string,
    readonly exitCode: 2 | 3 | 4 | 5 = 2,
    /**
     * No reply arrived before the client gave up. The server may well have
     * finished the work, so a write that times out must be checked, never
     * retried blind.
     */
    readonly timedOut = false,
  ) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Accepts `app.openverdict.info` or a full origin; keeps only the origin. */
export function normalizeBase(base: string): string {
  const withScheme = base.includes("://") ? base : `https://${base}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new OvError(`invalid base url: ${base}`);
  }
}

/** The error message of a reply body ({error, message}) or a plain status. */
export function replyMessage(reply: ApiReply): string {
  if (isRecord(reply.body)) {
    const message = asString(reply.body.message);
    const code = asString(reply.body.error);
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
  }
  return `HTTP ${reply.status}`;
}

/** Real timers, aborted early when the signal fires; never keeps the process alive. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "request timed out";
    // undici wraps the socket error in `cause`.
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
    return error.message;
  }
  return String(error);
}

export class Api {
  readonly base: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: Sleep;
  readonly #timeoutMs: number;

  constructor(options: ApiOptions) {
    this.base = normalizeBase(options.base);
    this.#fetch = options.fetch;
    this.#sleep = options.sleep ?? realSleep;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The injected fetch, for libraries that take a raw fetch (the auditor, the board). */
  get fetchImpl(): typeof fetch {
    return this.#fetch;
  }

  /** One JSON request with a hard timeout. Throws OvError(2) when no reply arrives. */
  async request(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
  ): Promise<ApiReply> {
    const url = `${this.base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          "user-agent": USER_AGENT,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = undefined;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
      }
      return { status: response.status, body, text };
    } catch (error) {
      const message = errorMessage(error);
      throw new OvError(
        `${init.method ?? "GET"} ${url}: ${message}`,
        2,
        message === "request timed out",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** A 2xx reply body, or OvError with the server's message. */
  async #expectOk(path: string, what: string): Promise<unknown> {
    const reply = await this.request(path);
    if (reply.status >= 200 && reply.status < 300) return reply.body;
    throw new OvError(`${what}: ${replyMessage(reply)}`);
  }

  weather(): Promise<WeatherReport> {
    return this.#expectOk("/api/weather", "weather request failed") as Promise<WeatherReport>;
  }

  /** The claim inspection, or undefined when the id is unknown (404, or the older 500). */
  async claim(claimId: string): Promise<ClaimInspection | undefined> {
    const reply = await this.request(`/api/claims/${encodeURIComponent(claimId)}`);
    if (reply.status >= 200 && reply.status < 300 && isRecord(reply.body)) {
      return reply.body as unknown as ClaimInspection;
    }
    if (isNotFound(reply)) return undefined;
    throw new OvError(`claim request failed: ${replyMessage(reply)}`);
  }

  /** Model id by agent profile id (lower case). Best effort: empty when the directory is down. */
  async agents(): Promise<Map<string, string>> {
    const models = new Map<string, string>();
    try {
      const reply = await this.request("/api/agents");
      const agents = isRecord(reply.body) ? asArray(reply.body.agents) : [];
      for (const agent of agents) {
        if (!isRecord(agent)) continue;
        const id = asString(agent.agentProfileId);
        const modelId = asString(agent.modelId);
        if (id && modelId) models.set(id.toLowerCase(), modelId);
      }
    } catch {
      // The directory only decorates lines; the watch goes on without it.
    }
    return models;
  }

  /** The whole jury roster, as GET /api/agents returns it. Fails loudly: `ov agents` has nothing else to print. */
  async agentDirectory(): Promise<AgentDirectoryEntry[]> {
    const body = await this.#expectOk("/api/agents", "agents request failed");
    const agents = isRecord(body) ? asArray(body.agents) : [];
    return agents.filter(isRecord) as unknown as AgentDirectoryEntry[];
  }

  /** One seat's published manifest, or undefined when the seat has none. */
  async agentManifest(agentProfileId: string): Promise<AgentManifestDocument | undefined> {
    const reply = await this.request(`/api/agents/${encodeURIComponent(agentProfileId)}/manifest`);
    if (reply.status >= 200 && reply.status < 300 && isRecord(reply.body)) {
      return reply.body as unknown as AgentManifestDocument;
    }
    if (isNotFound(reply)) return undefined;
    throw new OvError(`manifest request failed: ${replyMessage(reply)}`);
  }

  /**
   * Open the SSE feed of one claim and yield its events as they arrive. The
   * history is replayed first, then the stream stays open for live events.
   * `from` skips everything below that sequence server side. Ends when the
   * server closes the stream; throws OvError when the link drops or goes idle.
   */
  async *events(
    claimId: string,
    options: { from?: number; signal: AbortSignal; idleMs?: number },
  ): AsyncGenerator<StreamEvent> {
    if (options.signal.aborted) return;
    const from = options.from !== undefined && options.from > 1 ? `?from=${options.from}` : "";
    const url = `${this.base}/api/claims/${encodeURIComponent(claimId)}/events${from}`;
    const connect = new AbortController();
    const onAbort = () => connect.abort();
    options.signal.addEventListener("abort", onAbort, { once: true });
    // The connect timeout covers the headers only; body idleness is handled below.
    const connectTimer = setTimeout(() => connect.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "text/event-stream", "user-agent": USER_AGENT },
        signal: connect.signal,
      });
    } catch (error) {
      options.signal.removeEventListener("abort", onAbort);
      throw new OvError(`event stream: ${errorMessage(error)}`);
    } finally {
      clearTimeout(connectTimer);
    }
    if (!response.ok || !response.body) {
      options.signal.removeEventListener("abort", onAbort);
      connect.abort();
      throw new OvError(`event stream: HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const idleMs = options.idleMs ?? DEFAULT_STREAM_IDLE_MS;
    const decoder = new TextDecoder();
    const parser = createSseParser();
    // The idle timer of the read in flight; aborted on every exit path.
    let idle: AbortController | undefined;
    try {
      while (!options.signal.aborted) {
        idle = new AbortController();
        const next = await Promise.race([
          reader.read().then((chunk) => ({ kind: "chunk" as const, chunk })),
          this.#sleep(idleMs, idle.signal).then(() => ({ kind: "idle" as const })),
        ]);
        idle.abort();
        if (next.kind === "idle") {
          if (options.signal.aborted) return;
          throw new OvError(`event stream: no data for ${Math.round(idleMs / 1000)} s`);
        }
        if (next.chunk.done) {
          yield* parser.push(decoder.decode(), true);
          return;
        }
        yield* parser.push(decoder.decode(next.chunk.value, { stream: true }), false);
      }
    } catch (error) {
      if (options.signal.aborted) return;
      throw error instanceof OvError ? error : new OvError(`event stream: ${errorMessage(error)}`);
    } finally {
      idle?.abort();
      options.signal.removeEventListener("abort", onAbort);
      connect.abort();
      reader.cancel().catch(() => {});
    }
  }
}

/** 404, or the 500 "claim was not found" the API returned before the fix. */
function isNotFound(reply: ApiReply): boolean {
  if (reply.status === 404) return true;
  const message = isRecord(reply.body) ? `${asString(reply.body.error) ?? ""} ${asString(reply.body.message) ?? ""}` : reply.text;
  return reply.status >= 500 && /not[ _]found/i.test(message);
}

/**
 * Incremental SSE parser: `id:` and `data:` lines, blank line ends an event,
 * `:` comment lines (heartbeats) are ignored. Multi-line data is joined.
 */
function createSseParser(): { push(chunk: string, flush: boolean): StreamEvent[] } {
  let buffer = "";
  let id: number | undefined;
  let data: string[] = [];
  const finish = (): StreamEvent | undefined => {
    const text = data.join("\n");
    const eventId = id;
    id = undefined;
    data = [];
    if (text.length === 0) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) return undefined;
      const sequence = asNumber(parsed.sequence) ?? eventId ?? 0;
      return {
        sequence,
        kind: asString(parsed.kind) ?? "unknown",
        ...(asString(parsed.occurredAt) ? { occurredAt: asString(parsed.occurredAt) } : {}),
        ...(asString(parsed.publishedAt) ? { publishedAt: asString(parsed.publishedAt) } : {}),
        ...(asString(parsed.transactionDigest) ? { transactionDigest: asString(parsed.transactionDigest) } : {}),
        payload: isRecord(parsed.payload) ? parsed.payload : {},
        raw: parsed,
      };
    } catch {
      return undefined;
    }
  };
  const handleLine = (line: string): StreamEvent | undefined => {
    if (line.length === 0) return finish();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "id") id = asNumber(value);
    return undefined;
  };
  return {
    push(chunk, flush) {
      buffer += chunk;
      const events: StreamEvent[] = [];
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        const event = handleLine(line);
        if (event) events.push(event);
        index = buffer.indexOf("\n");
      }
      if (flush) {
        if (buffer.length > 0) handleLine(buffer.replace(/\r$/, ""));
        buffer = "";
        const last = finish();
        if (last) events.push(last);
      }
      return events;
    },
  };
}

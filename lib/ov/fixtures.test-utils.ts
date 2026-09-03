/**
 * Test doubles for the `ov` CLI: a virtual clock whose sleeps resolve in due
 * order without waiting, a fake fetch routed by method and path, and SSE
 * bodies scripted on that clock (events, heartbeats, drops, hangs).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sleep } from "./api";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

/** Deep copy so a test can edit a fixture without touching the others. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Virtual clock
// ---------------------------------------------------------------------------

export type VirtualClock = {
  now: () => number;
  sleep: Sleep;
  /** Timers still waiting; must be 0 once a watch has finished. */
  pending: () => number;
};

/**
 * Sleeps are queued and released in due order, one per macrotask, after the
 * microtasks of the previous release have settled. Time jumps to each due
 * instant, so nine virtual minutes cost nothing.
 */
export function createClock(startMs: number): VirtualClock {
  let now = startMs;
  const timers: Array<{ due: number; fire: () => void }> = [];
  let scheduled = false;
  const pump = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (timers.length === 0) return;
      timers.sort((left, right) => left.due - right.due);
      const next = timers.shift()!;
      now = Math.max(now, next.due);
      next.fire();
      if (timers.length > 0) pump();
    });
  };
  const sleep: Sleep = (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = {
        due: now + ms,
        fire: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      function onAbort() {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
        resolve();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      timers.push(timer);
      pump();
    });
  return { now: () => now, sleep, pending: () => timers.length };
}

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

export type Route = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

export type FakeFetch = {
  fetch: typeof fetch;
  /** Every request as "METHOD /path?query", in order. */
  calls: string[];
  /** The request bodies of POSTs, in order (raw strings). */
  bodies: unknown[];
  route: (key: string, handler: Route) => void;
};

/** Routes keyed by "GET /api/weather" (the query string is part of the key when given in the route). */
export function fakeFetch(routes: Record<string, Route> = {}): FakeFetch {
  const table = new Map(Object.entries(routes));
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const withQuery = `${method} ${url.pathname}${url.search}`;
    const bare = `${method} ${url.pathname}`;
    calls.push(withQuery);
    if (init?.body !== undefined) bodies.push(init.body);
    const handler = table.get(withQuery) ?? table.get(bare);
    if (!handler) return json({ error: "not_found", message: `no fake route for ${withQuery}` }, 404);
    return handler(init, url);
  }) as typeof fetch;
  return { fetch: impl, calls, bodies, route: (key, handler) => table.set(key, handler) };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answer with each body in turn; the last one repeats. */
export function sequence(bodies: Array<{ body: unknown; status?: number }>): Route {
  let index = 0;
  return () => {
    const entry = bodies[Math.min(index, bodies.length - 1)]!;
    index += 1;
    return json(entry.body, entry.status ?? 200);
  };
}

/** A route that fails at the network level (fetch rejects). */
export function networkError(message: string): Route {
  return () => {
    throw new TypeError(message);
  };
}

// ---------------------------------------------------------------------------
// SSE bodies
// ---------------------------------------------------------------------------

export type SseStep =
  | { event: Record<string, unknown> }
  | { text: string }
  | { delayMs: number }
  | { error: string }
  /** Stay open with heartbeats every 15 s until the request is aborted. */
  | { hang: true }
  | { close: true };

/**
 * An SSE response scripted on the clock. Events are written as the server
 * does (`id:` then `data:` then a blank line); `hang` keeps the connection
 * open with heartbeats until the fetch signal aborts, like production.
 */
export function sseResponse(clock: VirtualClock, steps: SseStep[], signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder();
  let index = 0;
  // The reader may already be cancelled when the script ends; that is fine.
  const safely = (action: () => void) => {
    try {
      action();
    } catch {
      // closed or cancelled stream
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const step = steps[index];
        index += 1;
        if (step === undefined || "close" in step) {
          safely(() => controller.close());
          return;
        }
        if ("event" in step) {
          const sequenceNumber = step.event.sequence;
          safely(() => controller.enqueue(encoder.encode(`id: ${sequenceNumber}\ndata: ${JSON.stringify(step.event)}\n\n`)));
          return;
        }
        if ("text" in step) {
          safely(() => controller.enqueue(encoder.encode(step.text)));
          return;
        }
        if ("delayMs" in step) {
          await clock.sleep(step.delayMs, signal ?? undefined);
          if (signal?.aborted) {
            safely(() => controller.close());
            return;
          }
          continue;
        }
        if ("error" in step) {
          safely(() => controller.error(new Error(step.error)));
          return;
        }
        // hang: heartbeats until aborted
        index -= 1;
        await clock.sleep(15_000, signal ?? undefined);
        if (signal?.aborted) {
          safely(() => controller.close());
          return;
        }
        safely(() => controller.enqueue(encoder.encode(": heartbeat\n\n")));
        return;
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Events as SSE steps, optionally with a virtual delay before each. */
export function eventSteps(events: Array<Record<string, unknown>>, delayMs = 0): SseStep[] {
  const steps: SseStep[] = [];
  for (const event of events) {
    if (delayMs > 0) steps.push({ delayMs });
    steps.push({ event });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

export type Captured = {
  out: string[];
  err: string[];
  io: { out: (line: string) => void; err: (line: string) => void };
};

export function captured(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

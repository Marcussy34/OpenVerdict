import { describe, expect, it } from "vitest";

import { Api, OvError, normalizeBase, replyMessage, type StreamEvent } from "./api";
import { createClock, fakeFetch, json, sseResponse } from "./fixtures.test-utils";

const BASE = "https://ov.test";
const CLAIM = `0x${"11".repeat(32)}`;

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Api", () => {
  it("normalizes the base and reads server messages", () => {
    expect(normalizeBase("app.openverdict.info")).toBe("https://app.openverdict.info");
    expect(normalizeBase("https://ov.test/some/path")).toBe("https://ov.test");
    expect(() => normalizeBase("http://")).toThrow(OvError);
    expect(replyMessage({ status: 400, body: { error: "validation_error", message: "too short" }, text: "" })).toBe("validation_error: too short");
    expect(replyMessage({ status: 500, body: undefined, text: "boom" })).toBe("HTTP 500");
  });

  it("treats 404 and the older 500 'was not found' as unknown ids", async () => {
    const net = fakeFetch({
      "GET /api/claims/0x1": () => json({ error: "claim_not_found", message: "claim was not found: 0x1" }, 404),
      "GET /api/claims/0x2": () => json({ error: "internal_error", message: "claim was not found: 0x2" }, 500),
      "GET /api/claims/0x3": () => json({ error: "internal_error", message: "database down" }, 500),
    });
    const api = new Api({ base: BASE, fetch: net.fetch });
    expect(await api.claim("0x1")).toBeUndefined();
    expect(await api.claim("0x2")).toBeUndefined();
    await expect(api.claim("0x3")).rejects.toThrow("claim request failed: internal_error: database down");
  });

  it("wraps network failures and timeouts as OvError exit 2", async () => {
    const net = fakeFetch({
      "GET /api/weather": () => {
        throw new TypeError("fetch failed");
      },
      "GET /api/agents": (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    const api = new Api({ base: BASE, fetch: net.fetch, timeoutMs: 5 });
    await expect(api.weather()).rejects.toMatchObject({ exitCode: 2, message: `GET ${BASE}/api/weather: fetch failed` });
    // The agent directory is best effort: a timeout leaves the map empty.
    expect((await api.agents()).size).toBe(0);
    await expect(api.request("/api/agents")).rejects.toThrow("request timed out");
  });

  it("parses SSE across chunk boundaries, ignores heartbeats and joins multi-line data", async () => {
    const clock = createClock(0);
    const event = { sequence: 7, kind: "vote_committed", occurredAt: "2026-09-03T03:21:06.093Z", payload: { phase: 1 } };
    const text = JSON.stringify(event);
    const net = fakeFetch({
      [`GET /api/claims/${CLAIM}/events`]: (init) =>
        sseResponse(
          clock,
          [
            { text: ": heartbeat\n\n" },
            { text: `id: 7\ndata: ${text.slice(0, 10)}` },
            { text: `${text.slice(10)}\n\n` },
            { text: `data: {"sequence": 8,\ndata:  "kind": "phase_changed", "payload": {}}\n\n` },
            { text: "data: not json\n\nretry: 1000\n\n" },
            { text: 'id: 9\ndata: {"kind":"claim_finalized","payload":{}}' },
            { close: true },
          ],
          init?.signal,
        ),
    });
    const api = new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep });
    const events = await collect(api.events(CLAIM, { signal: new AbortController().signal }));
    expect(events.map((entry) => [entry.sequence, entry.kind])).toEqual([
      [7, "vote_committed"],
      [8, "phase_changed"],
      [9, "claim_finalized"],
    ]);
    expect(events[0]!.payload).toEqual({ phase: 1 });
    expect(events[0]!.occurredAt).toBe("2026-09-03T03:21:06.093Z");
  });

  it("asks the server to resume from a sequence and fails on a bad status", async () => {
    const clock = createClock(0);
    const net = fakeFetch({
      [`GET /api/claims/${CLAIM}/events?from=42`]: (init) => sseResponse(clock, [{ close: true }], init?.signal),
      "GET /api/claims/0xbad/events": () => json({ error: "engine_not_wired" }, 503),
    });
    const api = new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep });
    expect(await collect(api.events(CLAIM, { from: 42, signal: new AbortController().signal }))).toEqual([]);
    expect(net.calls).toContain(`GET /api/claims/${CLAIM}/events?from=42`);
    await expect(collect(api.events("0xbad", { signal: new AbortController().signal }))).rejects.toThrow("event stream: HTTP 503");
  });

  it("reports a silent stream as a drop and stops quietly when aborted", async () => {
    const clock = createClock(0);
    const net = fakeFetch({
      [`GET /api/claims/${CLAIM}/events`]: (init) => sseResponse(clock, [{ delayMs: 10 * 60_000 }, { close: true }], init?.signal),
    });
    const api = new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep });
    await expect(collect(api.events(CLAIM, { signal: new AbortController().signal, idleMs: 90_000 }))).rejects.toThrow(
      "event stream: no data for 90 s",
    );

    const controller = new AbortController();
    const reading = collect(api.events(CLAIM, { signal: controller.signal, idleMs: 90_000 }));
    controller.abort();
    expect(await reading).toEqual([]);
    expect(clock.pending()).toBe(0);
  });
});

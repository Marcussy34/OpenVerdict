import { describe, expect, it } from "vitest";

import type { ClaimInspection, WeatherReport } from "../engine/contract";
import { Api, OvError } from "./api";
import {
  EXIT_CODES,
  auditCommand,
  boardCommand,
  extractCommand,
  helpText,
  isCommand,
  queueCommand,
  resolveClaimPrefix,
  statusCommand,
  submitCommand,
  watchCommand,
  watchTargetOf,
  weatherCommand,
  type CommandEnv,
} from "./commands";
import { captured, clone, createClock, eventSteps, fakeFetch, fixture, json, sseResponse, type FakeFetch } from "./fixtures.test-utils";

const BASE = "https://ov.test";
const NOW = Date.parse("2026-09-03T10:00:00Z");
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const VOIDED = fixture<ClaimInspection>("claim-voided.json");
const EVENTS = fixture<Array<Record<string, unknown>>>("events-finalized.json");
const QUEUE_ID = `0x${"9f".repeat(32)}`;

const NOT_CLEAR: WeatherReport = {
  probedAtMs: NOW - 42_000,
  stale: false,
  clear: false,
  families: [
    { modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", family: "deepseek", ok: false, latencyMs: 60_005, status: "429" },
    { modelId: "MiniMaxAI/MiniMax-M2.7", family: "minimax", ok: true, latencyMs: 682, status: "200" },
    { modelId: "moonshotai/Kimi-K2.6", family: "kimi", ok: false, latencyMs: 60_005, status: "TIMEOUT" },
    { modelId: "research:firecrawl", family: "research", ok: true, latencyMs: 286, status: "200 1189 credits" },
  ],
};
const CLEAR: WeatherReport = {
  ...NOT_CLEAR,
  clear: true,
  families: NOT_CLEAR.families.map((family) => ({ ...family, ok: true, latencyMs: 900, status: "200" })),
};

type Setup = { env: CommandEnv; net: FakeFetch; out: string[]; err: string[] };

function setup(routes: Parameters<typeof fakeFetch>[0], options: { json?: boolean } = {}): Setup {
  const clock = createClock(NOW);
  const net = fakeFetch(routes);
  const output = captured();
  const env: CommandEnv = {
    api: new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep }),
    io: output.io,
    json: options.json ?? false,
    now: clock.now,
    sleep: clock.sleep,
  };
  return { env, net, out: output.out, err: output.err };
}

async function failure(promise: Promise<unknown>): Promise<OvError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OvError) return error;
    throw error;
  }
  throw new Error("expected an OvError");
}

function requestBody(net: FakeFetch, index = 0): Record<string, unknown> {
  return JSON.parse(String(net.bodies[index])) as Record<string, unknown>;
}

describe("weather", () => {
  it("prints one line per family, the summary and the queue note when not clear", async () => {
    const s = setup({ "GET /api/weather": () => json(NOT_CLEAR) });
    expect(await weatherCommand(s.env)).toBe(0);
    expect(s.out).toEqual([
      "DeepSeek    429",
      "MiniMax     ok 0.7 s",
      "Kimi        TIMEOUT",
      "Web search  ok 0.3 s",
      "not clear, probed 42 s ago",
      "not clear means new submissions queue until all four families answer a probe",
    ]);
  });

  it("prints clear weather without the note, and the raw report with --json", async () => {
    const s = setup({ "GET /api/weather": () => json(CLEAR) });
    expect(await weatherCommand(s.env)).toBe(0);
    expect(s.out).toEqual(["DeepSeek    ok 0.9 s", "MiniMax     ok 0.9 s", "Kimi        ok 0.9 s", "Web search  ok 0.9 s", "clear, probed 42 s ago"]);
    const j = setup({ "GET /api/weather": () => json(CLEAR) }, { json: true });
    expect(await weatherCommand(j.env)).toBe(0);
    expect(JSON.parse(j.out.join("\n"))).toEqual(CLEAR);
  });

  it("fails with exit 2 when the engine is not wired", async () => {
    const s = setup({ "GET /api/weather": () => json({ error: "engine_not_wired" }, 503) });
    const error = await failure(weatherCommand(s.env));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("weather request failed: engine_not_wired");
  });
});

describe("board", () => {
  it("renders the board through the audit library and honours --limit", async () => {
    const s = setup({ "GET /api/claims": () => json({ claims: [FINALIZED, VOIDED, FINALIZED] }) });
    expect(await boardCommand(s.env, { limit: 2 })).toBe(0);
    const text = s.out.join("\n");
    expect(text).toContain("# OpenVerdict board (2 claims, newest first)");
    expect(text).toContain("| 1 | 0x273220b5… | FINALIZED_REVIEWED | NO 2.00 | 3 of 3 SETTLED |");
    expect(text).toContain("| 2 | 0x5b0b0bca… | COMMIT_1 | - | 1 of 3 VOIDED |");
    expect(s.net.calls).toEqual(["GET /api/claims?limit=2"]);
    const j = setup({ "GET /api/claims": () => json({ claims: [FINALIZED] }) }, { json: true });
    await boardCommand(j.env, {});
    expect((JSON.parse(j.out.join("\n")) as { claims: unknown[] }).claims.length).toBe(1);
  });
});

describe("extract", () => {
  const found = {
    claims: [{ claim: "The Eiffel Tower was completed in 1889.", reason: "Dated fact.", quote: "completed in 1889" }],
    language: "en",
    claim: "The Eiffel Tower was completed in 1889.",
    modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    gonkaRequestId: "req-1",
  };
  const paragraph = "The Eiffel Tower was completed in 1889 and is 330 metres tall. It was the tallest structure in the world until 1930.";

  it("posts text and prints the candidates with the next step", async () => {
    const s = setup({ "POST /api/extract-claim": () => json(found) });
    expect(await extractCommand(s.env, { text: paragraph })).toBe(0);
    expect(requestBody(s.net)).toEqual({ text: paragraph });
    expect(s.out[0]).toBe("1 candidate claim (language en, extracted by deepseek-ai/DeepSeek-V4-Flash-0731)");
    expect(s.out.at(-1)).toBe('next: ov submit "The Eiffel Tower was completed in 1889."');
  });

  it("posts a url and prints the body with --json", async () => {
    const s = setup({ "POST /api/extract-claim": () => json({ ...found, sourceUrl: "https://example.org/a" }) }, { json: true });
    expect(await extractCommand(s.env, { url: "https://example.org/a" })).toBe(0);
    expect(requestBody(s.net)).toEqual({ url: "https://example.org/a" });
    expect(JSON.parse(s.out.join("\n"))).toMatchObject({ sourceUrl: "https://example.org/a", language: "en" });
  });

  it("says plainly when no checkable claim was found", async () => {
    const s = setup({ "POST /api/extract-claim": () => json({ error: "NO_CLAIM_FOUND", message: "The source did not yield a valid factual claim." }, 404) });
    const error = await failure(extractCommand(s.env, { text: paragraph }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("no checkable claim found");
  });

  it("validates the input before calling the API", async () => {
    const s = setup({});
    expect((await failure(extractCommand(s.env, {}))).message).toBe("extract needs exactly one of --url, --text or --file");
    expect((await failure(extractCommand(s.env, { text: "too short" }))).message).toBe("text must be 40 to 20000 characters, got 9");
    expect((await failure(extractCommand(s.env, { url: "ftp://x" }))).message).toContain("--url expects an http(s) address");
    expect((await failure(extractCommand(s.env, { file: "/nonexistent/file.txt" }))).message).toContain("cannot read /nonexistent/file.txt");
    expect(s.net.calls).toEqual([]);
  });

  it("maps 400, 403, 429, 502 and 503 to plain errors with the spec's exit codes", async () => {
    const cases: Array<{ status: number; body: unknown; exitCode: number; message: RegExp }> = [
      { status: 400, body: { error: "INVALID_URL", message: "Request body must contain exactly one valid url" }, exitCode: 2, message: /^Request body must contain/ },
      { status: 403, body: { error: "writes_disabled", message: "public submissions are disabled" }, exitCode: 5, message: /disabled on this deployment/ },
      { status: 429, body: { error: "rate_limited", message: "too many submissions, retry later" }, exitCode: 5, message: /^rate limited: too many submissions/ },
      { status: 502, body: { error: "FETCH_FAILED", message: "The source page could not be fetched safely." }, exitCode: 2, message: /could not be fetched safely/ },
      { status: 502, body: undefined, exitCode: 2, message: /GonkaRouter is probably saturated/ },
      { status: 504, body: undefined, exitCode: 2, message: /HTTP 504.*saturated/ },
      { status: 503, body: { error: "ENGINE_NOT_WIRED" }, exitCode: 2, message: /engine is not wired/ },
    ];
    for (const entry of cases) {
      const s = setup({
        "POST /api/extract-claim": () =>
          entry.body === undefined ? new Response("bad gateway", { status: entry.status }) : json(entry.body, entry.status),
      });
      const error = await failure(extractCommand(s.env, { text: paragraph }));
      expect(error.exitCode).toBe(entry.exitCode);
      expect(error.message).toMatch(entry.message);
    }
  });

  it("explains a timeout as Gonka saturation", async () => {
    const s = setup({
      "POST /api/extract-claim": (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    s.env.timeoutMs = 5;
    const error = await failure(extractCommand(s.env, { text: paragraph }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("extraction timed out; GonkaRouter is probably saturated, try again in a minute");
  });
});

describe("submit", () => {
  const claim = "The Eiffel Tower was completed in 1889.";

  it("200: prints the claim id, the link and the watch hint", async () => {
    const s = setup({ "POST /api/fact-checks": () => json({ claimId: FINALIZED.claimId }) });
    expect(await submitCommand(s.env, { claim, urls: ["https://example.org/x"], text: "some evidence", criteria: "be strict" })).toBe(0);
    expect(requestBody(s.net)).toEqual({ claim, text: "some evidence", urls: ["https://example.org/x"], resolutionCriteria: "be strict" });
    expect(s.out).toEqual([
      `claim submitted: ${FINALIZED.claimId}`,
      `link: ${BASE}/claims/${FINALIZED.claimId}`,
      "the jury is forming; a one-round verdict lands about 11 to 12 minutes after launch, a two-round verdict about 32 minutes",
      `watch it: ov watch ${FINALIZED.claimId}`,
    ]);
  });

  it("202: prints the queue id, link, weather and the waiting note; --json adds link and kind", async () => {
    const body = { queued: true, queueId: QUEUE_ID, weather: NOT_CLEAR };
    const s = setup({ "POST /api/fact-checks": () => json(body, 202) });
    expect(await submitCommand(s.env, { claim, urls: [] })).toBe(0);
    expect(requestBody(s.net)).toEqual({ claim });
    expect(s.out[0]).toBe(`queued: ${QUEUE_ID}`);
    expect(s.out[1]).toBe(`link: ${BASE}/fact-check/queue/${QUEUE_ID}`);
    expect(s.out).toContain("  Kimi        TIMEOUT");
    expect(s.out).toContain("the engine launches it when all four answer; queued items expire after six hours");
    expect(s.out.at(-1)).toBe(`watch it: ov watch ${QUEUE_ID}`);
    const j = setup({ "POST /api/fact-checks": () => json(body, 202) }, { json: true });
    await submitCommand(j.env, { claim, urls: [] });
    expect(JSON.parse(j.out.join("\n"))).toMatchObject({ queued: true, queueId: QUEUE_ID, kind: "queued", link: `${BASE}/fact-check/queue/${QUEUE_ID}` });
    const k = setup({ "POST /api/fact-checks": () => json({ claimId: "0xabc" }) }, { json: true });
    await submitCommand(k.env, { claim, urls: [] });
    expect(JSON.parse(k.out.join("\n"))).toEqual({ claimId: "0xabc", kind: "claim", link: `${BASE}/claims/0xabc` });
  });

  it("400, 403, 429 and 503 map to the spec's exit codes", async () => {
    const cases: Array<{ status: number; body: unknown; exitCode: number; message: RegExp }> = [
      { status: 400, body: { error: "validation_error", message: "claim statement must be between 5 and 1000 characters" }, exitCode: 2, message: /^claim statement must be between/ },
      { status: 403, body: { error: "writes_disabled", message: "public submissions are disabled" }, exitCode: 5, message: /public submissions are disabled/ },
      { status: 429, body: { error: "rate_limited", message: "too many submissions, retry later" }, exitCode: 5, message: /five per minute/ },
      { status: 503, body: { error: "engine_not_wired" }, exitCode: 2, message: /engine is not wired/ },
    ];
    for (const entry of cases) {
      const s = setup({ "POST /api/fact-checks": () => json(entry.body, entry.status) });
      const error = await failure(submitCommand(s.env, { claim, urls: [] }));
      expect(error.exitCode).toBe(entry.exitCode);
      expect(error.message).toMatch(entry.message);
    }
  });

  it("validates the claim and urls locally", async () => {
    const s = setup({});
    expect((await failure(submitCommand(s.env, { claim: "hi", urls: [] }))).message).toBe("the claim must be 5 to 1000 characters, got 2");
    expect((await failure(submitCommand(s.env, { claim, urls: ["http://plain.example"] }))).message).toContain("--url expects an https address");
    expect((await failure(submitCommand(s.env, { claim, urls: Array.from({ length: 6 }, () => "https://x.example") }))).message).toBe("at most 5 urls are accepted");
    expect(s.net.calls).toEqual([]);
  });
});

describe("queue and status", () => {
  const item = {
    queueId: QUEUE_ID,
    status: "QUEUED",
    statement: "The Eiffel Tower was completed in 1889.",
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 6 * 3_600_000).toISOString(),
    weather: NOT_CLEAR,
  };

  it("prints every queue status and 'not found' with exit 2", async () => {
    for (const [status, expected] of [
      ["QUEUED", "status     QUEUED, waiting for clear weather (the engine launches it when all four families answer)"],
      ["LAUNCHED", "status     LAUNCHED"],
      ["EXPIRED", "status     EXPIRED (queued items expire after six hours)"],
      ["CANCELLED", "status     CANCELLED"],
    ] as const) {
      const s = setup({ [`GET /api/fact-checks/queue/${QUEUE_ID}`]: () => json({ ...item, status, ...(status === "LAUNCHED" ? { claimId: FINALIZED.claimId } : {}) }) });
      expect(await queueCommand(s.env, status === "QUEUED" ? `${BASE}/fact-check/queue/${QUEUE_ID}` : QUEUE_ID)).toBe(0);
      expect(s.out[1]).toBe(expected);
      if (status === "LAUNCHED") expect(s.out).toContain(`watch it   ov watch ${FINALIZED.claimId}`);
    }
    const s = setup({ "GET /api/fact-checks/queue/0x0": () => json({ error: "not_found" }, 404) });
    const error = await failure(queueCommand(s.env, "0x0"));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("queue item not found: 0x0");
    expect((await failure(queueCommand(s.env, "nonsense"))).message).toBe("not a queue id or link: nonsense");
  });

  it("status shows the claim in three states and accepts links", async () => {
    const active = clone(FINALIZED);
    active.state = 5;
    delete active.result;
    active.attemptChain = { ...active.attemptChain!, status: "ACTIVE" };
    const s = setup({
      [`GET /api/claims/${FINALIZED.claimId}`]: () => json(FINALIZED),
      [`GET /api/claims/${VOIDED.claimId}`]: () => json(VOIDED),
      "GET /api/claims/0xaaaa": () => json(active),
    });
    expect(await statusCommand(s.env, `${BASE}/claims/${FINALIZED.claimId}/report`)).toBe(0);
    expect(s.out).toContain("state      finalized");
    expect(s.out).toContain("result     NO, truth score 2.00 (200 bps)");
    s.out.length = 0;
    expect(await statusCommand(s.env, VOIDED.claimId)).toBe(0);
    expect(s.out).toContain("relaunch   " + `${BASE}/claims/${VOIDED.attemptChain!.relaunchedAs}`);
    s.out.length = 0;
    expect(await statusCommand(s.env, "0xaaaa")).toBe(0);
    expect(s.out).toContain("state      round one reveal");
    expect(s.out.some((line) => /^next       reveal window closes passed/.test(line))).toBe(true);
  });

  it("status falls back to the queue for a bare id and prints JSON with --json", async () => {
    const s = setup({
      [`GET /api/claims/${QUEUE_ID}`]: () => json({ error: "claim_not_found" }, 404),
      [`GET /api/fact-checks/queue/${QUEUE_ID}`]: () => json(item),
    });
    expect(await statusCommand(s.env, QUEUE_ID)).toBe(0);
    expect(s.out[0]).toBe(`queue      ${QUEUE_ID}`);
    const j = setup({ [`GET /api/claims/${FINALIZED.claimId}`]: () => json(FINALIZED) }, { json: true });
    await statusCommand(j.env, FINALIZED.claimId);
    expect((JSON.parse(j.out.join("\n")) as ClaimInspection).claimId).toBe(FINALIZED.claimId);
    const missing = setup({ "GET /api/claims/0x1": () => json({ error: "claim_not_found" }, 404), "GET /api/fact-checks/queue/0x1": () => json({}, 404) });
    expect((await failure(statusCommand(missing.env, "0x1"))).message).toBe("claim not found: 0x1");
  });

  it("resolves a short id from the board to the one claim it starts with", async () => {
    const s = setup({
      "GET /api/claims": () => json({ claims: [FINALIZED, VOIDED] }),
      [`GET /api/claims/${FINALIZED.claimId}`]: () => json(FINALIZED),
    });
    expect(await statusCommand(s.env, "0x273220B5")).toBe(0);
    expect(s.net.calls.slice(0, 2)).toEqual(["GET /api/claims?limit=200", `GET /api/claims/${FINALIZED.claimId}`]);
    expect(s.err).toEqual(["resolved 0x273220B5 to 0x2732\u20264ac6"]);
    expect(s.out).toContain("state      finalized");
    // A full 66-character id never goes through the board.
    s.net.calls.length = 0;
    expect(await statusCommand(s.env, FINALIZED.claimId)).toBe(0);
    expect(s.net.calls).toEqual([`GET /api/claims/${FINALIZED.claimId}`]);
  });

  it("says when a short id matches no claim, or several", async () => {
    const twin = clone(FINALIZED);
    twin.claimId = `${FINALIZED.claimId.slice(0, 12)}${"ee".repeat(27)}`;
    const s = setup({ "GET /api/claims": () => json({ claims: [FINALIZED, twin, VOIDED] }) });
    const none = await failure(statusCommand(s.env, "0xdeadbeef"));
    expect(none.exitCode).toBe(2);
    expect(none.message).toBe("claim not found: 0xdeadbeef (ids are 66 characters, ov board prints full ids)");
    const several = await failure(resolveClaimPrefix(s.env, "0x273220b5"));
    expect(several.exitCode).toBe(2);
    expect(several.message).toBe(`0x273220b5 matches 2 claims, give more of the id:\n  ${FINALIZED.claimId}\n  ${twin.claimId}`);
    expect(s.err).toEqual([]);
    // Short ids below eight hex digits and queue ids keep the old behaviour.
    expect(watchTargetOf("0x2732")).toEqual({ kind: "id", id: "0x2732" });
    expect(watchTargetOf(`${BASE}/fact-check/queue/${QUEUE_ID}`)).toEqual({ kind: "queue", id: QUEUE_ID });
  });

  it("watch and audit resolve short ids through the same helper", async () => {
    const clock = createClock(NOW);
    const net = fakeFetch({
      "GET /api/claims": () => json({ claims: [FINALIZED, VOIDED] }),
      [`GET /api/claims/${FINALIZED.claimId}`]: () => json({ error: "claim_not_found" }, 404),
    });
    const output = captured();
    const env: CommandEnv = { api: new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep }), io: output.io, json: false, now: clock.now, sleep: clock.sleep, color: true };
    expect(await watchCommand(env, { target: "0x273220b5", verbose: false })).toBe(2);
    expect(output.err[0]).toBe("\u001b[2mresolved 0x273220b5 to 0x2732\u20264ac6\u001b[0m");
    expect(output.err[1]).toBe(`error: claim not found: ${FINALIZED.claimId}`);
    // The auditor receives the full id (it reports it when the claim is gone).
    output.err.length = 0;
    await expect(auditCommand(env, { target: "0x273220b5", quiet: true })).rejects.toThrow(`claim not found: ${FINALIZED.claimId}`);
    expect(output.err[0]).toContain("resolved 0x273220b5 to 0x2732\u20264ac6");
    expect(net.calls.filter((call) => call === "GET /api/claims?limit=200").length).toBe(2);
  });

  it("recognises claim links, queue links and bare ids", () => {
    expect(watchTargetOf(`${BASE}/claims/${FINALIZED.claimId}`)).toEqual({ kind: "claim", id: FINALIZED.claimId });
    expect(watchTargetOf(`${BASE}/fact-check/queue/${QUEUE_ID}`)).toEqual({ kind: "queue", id: QUEUE_ID });
    expect(watchTargetOf(FINALIZED.claimId.toUpperCase().replace("0X", "0x"))).toEqual({ kind: "id", id: FINALIZED.claimId });
    expect(() => watchTargetOf("what")).toThrow(OvError);
  });
});

describe("watch command and help", () => {
  it("wires the watch to the environment and returns its exit code", async () => {
    const clock = createClock(NOW);
    const net = fakeFetch({
      [`GET /api/claims/${FINALIZED.claimId}`]: () => json(FINALIZED),
      "GET /api/agents": () => json({ agents: [] }),
      [`GET /api/claims/${FINALIZED.claimId}/events`]: (init) => sseResponse(clock, [...eventSteps(EVENTS), { close: true }], init?.signal),
    });
    const output = captured();
    const env: CommandEnv = { api: new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep }), io: output.io, json: false, now: clock.now, sleep: clock.sleep };
    expect(await watchCommand(env, { target: `${BASE}/claims/${FINALIZED.claimId}`, since: 77, verbose: false })).toBe(0);
    expect(output.out).toEqual([
      "03:27:27Z  final              NO, score 2.00 (200 bps), certificate 0x42954c91… https://suiscan.xyz/testnet/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706",
      `audit it: ov audit ${FINALIZED.claimId}`,
    ]);
  });

  it("help lists every command with an example and the exit codes", () => {
    const text = helpText();
    for (const name of ["weather", "board", "extract", "submit", "queue", "status", "watch", "audit", "help"]) {
      expect(text).toContain(`  ${name}`);
      expect(isCommand(name)).toBe(true);
    }
    expect(text.match(/example: ov /g)?.length).toBe(8);
    for (const line of EXIT_CODES) expect(text).toContain(line);
    expect(helpText("watch")).toContain("usage: ov watch <claim id, claim link or queue id> [--for <duration>] [--since <sequence>] [--verbose]");
    expect(helpText("audit")).toContain("exit codes: 0 every check passed or was unavailable, 1 any FAIL, 2 input or fetch error");
    expect(isCommand("swarm")).toBe(false);
    expect(text).not.toContain("\u2014");
  });
});

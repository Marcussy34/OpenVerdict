import { describe, expect, it } from "vitest";

import type { AgentDirectoryEntry, ClaimInspection, WeatherReport } from "../engine/contract";
import type { AgentManifestDocument } from "../protocol/types";
import { Api, OvError } from "./api";
import {
  EXIT_CODES,
  agentCommand,
  agentsCommand,
  auditCommand,
  boardCommand,
  extractCommand,
  helpText,
  isCommand,
  resolveClaimPrefix,
  resolveCommand,
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
const AGENTS = fixture<AgentDirectoryEntry[]>("agents.json");
const MANIFEST = fixture<AgentManifestDocument>("agent-manifest.json");
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
  it("prints one line per family, the summary and the refusal note when not clear", async () => {
    const s = setup({ "GET /api/weather": () => json(NOT_CLEAR) });
    expect(await weatherCommand(s.env)).toBe(0);
    expect(s.out).toEqual([
      "DeepSeek    429",
      "MiniMax     ok 0.7 s",
      "Kimi        TIMEOUT",
      "Web search  ok 0.3 s",
      "not clear, probed 42 s ago",
      "not clear means new submissions are refused until all four families answer a probe",
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

  it("503 WEATHER_NOT_CLEAR: relays the route's sentence, prints the rows, exits 5", async () => {
    // The frozen contract: one sentence naming the down families, plus the report.
    const body = {
      error: "WEATHER_NOT_CLEAR",
      message: "The jury cannot sit right now: DeepSeek and Kimi are down.",
      weather: NOT_CLEAR,
    };
    const s = setup({ "POST /api/fact-checks": () => json(body, 503) });
    const error = await failure(submitCommand(s.env, { claim, urls: [] }));
    expect(error.exitCode).toBe(5);
    // The sentence is relayed once, never wrapped in a second one.
    expect(error.message).toBe(
      "The jury cannot sit right now: DeepSeek and Kimi are down. Nothing was stored. Run ov weather and submit again when all four rows answer.",
    );
    expect(s.out).toContain("Kimi        TIMEOUT");
    expect(s.out.at(-1)).toBe("not clear, probed 42 s ago");

    // A body without the sentence falls back to the wording the console uses.
    const bare = setup({ "POST /api/fact-checks": () => json({ error: "WEATHER_NOT_CLEAR", weather: NOT_CLEAR }, 503) });
    expect((await failure(submitCommand(bare.env, { claim, urls: [] }))).message).toBe(
      "The jury cannot sit right now: DeepSeek and Kimi are down. Nothing was stored. Run ov weather and submit again when all four rows answer.",
    );

    const j = setup({ "POST /api/fact-checks": () => json(body, 503) }, { json: true });
    await failure(submitCommand(j.env, { claim, urls: [] }));
    expect(JSON.parse(j.out.join("\n"))).toMatchObject({ error: "WEATHER_NOT_CLEAR", weather: { clear: false } });

    // The other 503 on this route stays an engine problem, not a weather one.
    const wired = setup({ "POST /api/fact-checks": () => json({ error: "engine_not_wired" }, 503) });
    const other = await failure(submitCommand(wired.env, { claim, urls: [] }));
    expect(other.exitCode).toBe(2);
    expect(other.message).toMatch(/engine is not wired/);

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

describe("status", () => {
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

  it("status prints JSON with --json and says plainly when the claim is unknown", async () => {
    const j = setup({ [`GET /api/claims/${FINALIZED.claimId}`]: () => json(FINALIZED) }, { json: true });
    await statusCommand(j.env, FINALIZED.claimId);
    expect((JSON.parse(j.out.join("\n")) as ClaimInspection).claimId).toBe(FINALIZED.claimId);
    const missing = setup({ "GET /api/claims/0x1": () => json({ error: "claim_not_found" }, 404) });
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
    // Short ids below eight hex digits keep the old behaviour.
    expect(watchTargetOf("0x2732")).toEqual({ kind: "id", id: "0x2732" });
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

  it("recognises claim links and bare ids, and says queue links are gone", () => {
    expect(watchTargetOf(`${BASE}/claims/${FINALIZED.claimId}`)).toEqual({ kind: "claim", id: FINALIZED.claimId });
    expect(() => watchTargetOf(`${BASE}/fact-check/queue/${QUEUE_ID}`)).toThrow("queue links no longer exist");
    expect(watchTargetOf(FINALIZED.claimId.toUpperCase().replace("0X", "0x"))).toEqual({ kind: "id", id: FINALIZED.claimId });
    expect(() => watchTargetOf("what")).toThrow(OvError);
  });
});

describe("agents and agent", () => {
  const roster = { "GET /api/agents": () => json({ agents: AGENTS }) };

  it("prints the roster, and the raw directory under --json", async () => {
    const s = setup(roster);
    expect(await agentsCommand(s.env)).toBe(0);
    expect(s.out[0]).toBe("# OpenVerdict jury (3 seats, 2 active)");
    expect(s.net.calls).toEqual(["GET /api/agents"]);

    const j = setup(roster, { json: true });
    await agentsCommand(j.env);
    expect((JSON.parse(j.out.join("\n")) as { agents: unknown[] }).agents.length).toBe(3);

    const empty = setup({ "GET /api/agents": () => json({ agents: [] }) });
    expect(await agentsCommand(empty.env)).toBe(0);
    expect(empty.out).toEqual(["no seats in the registry on this deployment"]);
  });

  it("resolves a seat by id, prefix or link and fetches its manifest", async () => {
    const seat = AGENTS[0]!.agentProfileId;
    const routes = { ...roster, [`GET /api/agents/${seat}/manifest`]: () => json(MANIFEST) };
    for (const input of [seat, "0x4ee8af57", `${BASE}/agents/${seat}`]) {
      const s = setup(routes);
      expect(await agentCommand(s.env, input)).toBe(0);
      expect(s.out[0]).toBe(`seat       ${seat}`);
      expect(s.out.join("\n")).toContain("prompt     spec v4");
    }
    const j = setup(routes, { json: true });
    await agentCommand(j.env, seat);
    const parsed = JSON.parse(j.out.join("\n")) as { agent: { role: string }; manifest: { version: string } };
    expect(parsed.agent.role).toBe("SOURCE_AUTHENTICITY");
    expect(parsed.manifest.version).toBe("6");
  });

  it("says so when the seat has no manifest, and rejects unknown or ambiguous input", async () => {
    const seat = AGENTS[0]!.agentProfileId;
    const s = setup({ ...roster, [`GET /api/agents/${seat}/manifest`]: () => json({ error: "manifest_not_found" }, 404) });
    expect(await agentCommand(s.env, seat)).toBe(0);
    expect(s.out.join("\n")).toContain("no manifest document published for this seat");

    const missing = setup(roster);
    expect((await failure(agentCommand(missing.env, `0x${"c".repeat(64)}`))).message).toContain("seat not found");
    expect((await failure(agentCommand(missing.env, "nonsense"))).message).toBe("not a seat id or link: nonsense");

    // Two seats sharing a prefix must not resolve to either of them.
    const twins = clone(AGENTS);
    twins[1]!.agentProfileId = `${twins[0]!.agentProfileId.slice(0, 12)}${"9".repeat(54)}`;
    const many = setup({ "GET /api/agents": () => json({ agents: twins }) });
    expect((await failure(agentCommand(many.env, "0x4ee8af57"))).message).toContain("matches 2 seats");
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
      "03:27:27Z  final              NO, score 2.00 (200 bps), certificate 0x42954c91… https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706",
      `audit it: ov audit ${FINALIZED.claimId}`,
    ]);
  });

  it("help lists every command with an example and the exit codes", () => {
    const text = helpText();
    for (const name of ["weather", "board", "agents", "agent", "extract", "submit", "status", "watch", "audit", "trace", "help"]) {
      expect(text).toContain(`  ${name}`);
      expect(isCommand(name)).toBe(true);
    }
    expect(text.match(/example: ov /g)?.length).toBe(10);
    for (const line of EXIT_CODES) expect(text).toContain(line);
    // `ov claims` is the board under the console's own name.
    expect(resolveCommand("claims")).toBe("board");
    expect(isCommand("claims")).toBe(true);
    expect(helpText("claims")).toBe(helpText("board"));
    expect(helpText("board")).toContain("usage: ov board [--limit <n>]   (alias: ov claims)");
    expect(helpText("agents")).toContain("usage: ov agents");
    expect(helpText("agent")).toContain("usage: ov agent <seat id, id prefix or link>");
    expect(helpText("watch")).toContain("usage: ov watch <claim id or claim link> [--for <duration>] [--since <sequence>] [--verbose]");
    expect(helpText("audit")).toContain("exit codes: 0 every check passed or was unavailable, 1 any FAIL, 2 input or fetch error");
    expect(helpText("trace")).toContain("usage: ov trace <claim id or link> [--juror <n>] [--round 1|2] [--full]");
    expect(helpText("trace")).toContain("--full adds the pinned system prompt once and every message verbatim, page texts included.");
    expect(isCommand("swarm")).toBe(false);
    expect(text).not.toContain("\u2014");
  });
});

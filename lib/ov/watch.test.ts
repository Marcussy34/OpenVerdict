import { describe, expect, it } from "vitest";

import type { ClaimInspection } from "../engine/contract";
import { Api } from "./api";
import {
  captured,
  clone,
  createClock,
  eventSteps,
  fakeFetch,
  fixture,
  json,
  networkError,
  sequence,
  sseResponse,
  type FakeFetch,
  type VirtualClock,
} from "./fixtures.test-utils";
import { buildSeatIndex, watch, type WatchOptions, type WatchResult } from "./watch";

const BASE = "https://ov.test";
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const FINALIZED_ID = FINALIZED.claimId;
const EVENTS = fixture<Array<Record<string, unknown>>>("events-finalized.json");
const VOIDED = fixture<ClaimInspection>("claim-voided.json");
const GAVE_UP = fixture<ClaimInspection>("claim-gave-up.json");
const DEBATE = fixture<ClaimInspection>("claim-debate.json");
const DEBATE_EVENTS = fixture<Array<Record<string, unknown>>>("events-debate.json");
const START_MS = Date.parse("2026-09-03T10:00:00Z");

type Harness = {
  clock: VirtualClock;
  net: FakeFetch;
  out: string[];
  err: string[];
  run: (overrides?: Partial<WatchOptions>) => Promise<WatchResult>;
};

/** A watch wired to the fake network and the virtual clock, budget 9 minutes. */
function harness(target: WatchOptions["target"], routes: Parameters<typeof fakeFetch>[0] = {}): Harness {
  const clock = createClock(START_MS);
  const net = fakeFetch(routes);
  const output = captured();
  const api = new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep });
  return {
    clock,
    net,
    out: output.out,
    err: output.err,
    run: (overrides = {}) =>
      watch({
        api,
        target,
        budgetMs: 9 * 60_000,
        verbose: false,
        json: false,
        now: clock.now,
        sleep: clock.sleep,
        out: output.io.out,
        err: output.io.err,
        ...overrides,
      }),
  };
}

/** The finalized claim's routes: record, agents, and a stream that replays and closes. */
function finalizedRoutes(clock: VirtualClock, claim: ClaimInspection = FINALIZED, events = EVENTS) {
  return {
    [`GET /api/claims/${claim.claimId}`]: () => json(claim),
    "GET /api/agents": () => json({ agents: [] }),
    [`GET /api/claims/${claim.claimId}/events`]: (init: RequestInit | undefined) =>
      sseResponse(clock, [...eventSteps(events), { close: true }], init?.signal),
  };
}

/** An in-flight claim: the finalized record moved back to COMMIT_1 with an active chain. */
function activeClaim(): ClaimInspection {
  const claim = clone(FINALIZED);
  claim.state = 4;
  delete claim.result;
  claim.attemptChain = { ...claim.attemptChain!, attempt: 1, status: "ACTIVE", previousAttempts: [] };
  return claim;
}

describe("watch: history replay", () => {
  it("prints the history compactly, ends on claim_finalized with the audit hint, exit 0", async () => {
    const h = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(h.clock)).forEach(([key, route]) => h.net.route(key, route));
    const result = await h.run();

    expect(result.exitCode).toBe(0);
    expect(result.lastSequence).toBe(78);
    expect(h.out[0]).toMatch(/^03:17:23Z  claim created {6}on Sui, package 0x15c6e53c/);
    expect(h.out).toContain("03:17:59Z  committee drawn    5 seats drawn: DeepSeek, DeepSeek, MiniMax, MiniMax, Kimi");
    expect(h.out).toContain("03:18:28Z  evidence frozen    root 0x532792ca…, phase 1");
    expect(h.out).toContain("03:21:06Z  vote committed     juror 3 (MiniMax) committed (1 of 5)");
    expect(h.out).toContain("03:25:28Z  vote committed     juror 5 (Kimi) committed (5 of 5)");
    expect(h.out).toContain("03:25:30Z  phase changed      round one research and sealed votes to round one reveal");
    expect(h.out).toContain("03:27:25Z  vote revealed      juror 2 (DeepSeek) revealed NO 9500 bps (1 of 5)");
    expect(h.out.some((line) => line.includes("run approved       juror 3 (MiniMax) run approved, hash 0xd87268f7"))).toBe(true);
    expect(h.out.at(-2)).toBe(
      "03:27:27Z  final              NO, score 2.00 (200 bps), certificate 0x42954c91… https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706",
    );
    expect(h.out.at(-1)).toBe(`audit it: ov audit ${FINALIZED_ID}`);
    // Research ticks stay hidden without --verbose; every line is dated.
    expect(h.out.some((line) => /research {5}/.test(line))).toBe(false);
    for (const line of h.out.slice(0, -1)) expect(line).toMatch(/^\d\d:\d\d:\d\dZ  /);
    // Lines never run backwards in time even when an event was published late.
    const times = h.out.slice(0, -1).map((line) => line.slice(0, 9));
    expect([...times].sort()).toEqual(times);
    expect(h.err).toEqual([]);
    expect(h.clock.pending()).toBe(0);
  });

  it("--since N prints only later events but keeps the counters whole", async () => {
    const h = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(h.clock)).forEach(([key, route]) => h.net.route(key, route));
    const result = await h.run({ since: 45 });

    expect(result.exitCode).toBe(0);
    expect(h.out.some((line) => line.includes("claim created"))).toBe(false);
    expect(h.out.some((line) => line.includes("committed (1 of 5)"))).toBe(false);
    expect(h.out).toContain("03:25:28Z  vote committed     juror 5 (Kimi) committed (5 of 5)");
    expect(h.out).toContain("03:27:25Z  vote revealed      juror 2 (DeepSeek) revealed NO 9500 bps (1 of 5)");
    expect(h.out.at(-1)).toBe(`audit it: ov audit ${FINALIZED_ID}`);
    // The first connection still replays everything (no from), so the seats and counters are known.
    expect(h.net.calls.filter((call) => call.includes("/events"))).toEqual([`GET /api/claims/${FINALIZED_ID}/events`]);
  });

  it("--verbose shows research ticks and unknown kinds", async () => {
    const h = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(h.clock)).forEach(([key, route]) => h.net.route(key, route));
    await h.run({ verbose: true });
    expect(h.out.some((line) => /research {11}juror 4 \(MiniMax\) search$/.test(line))).toBe(true);
  });

  it("prints the live research feed as it lands and passes it through --json", async () => {
    const seat = FINALIZED.rounds![0]!.expectedJurySeatIds[2]!;
    const step = (sequenceNumber: number, payload: Record<string, unknown>) => ({
      kind: "research_step",
      sequence: sequenceNumber,
      claimId: FINALIZED_ID,
      phase: "INFERENCE_1",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      runId: `0x${"aa".repeat(32)}`,
      occurredAt: "2026-09-03T03:20:00.000Z",
      payload: { jury_seat_id: seat, ...payload },
    });
    // The steps land while the seat researches, before its run is approved.
    const events = [...EVENTS];
    events.splice(14, 0,
      step(40, { ordinal: 0, kind: "search", intent: "challenge", query: "ten percent brain myth" }),
      step(41, { ordinal: 1, kind: "open", urls: ["https://mcgovern.mit.edu/a", "https://www.apa.org/b"], page_count: 2 }),
      step(42, { ordinal: 2, kind: "answer" }),
    );

    const h = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(h.clock, FINALIZED, events)).forEach(([key, route]) => h.net.route(key, route));
    expect((await h.run()).exitCode).toBe(0);
    expect(h.out).toContain('03:20:00Z  research           juror 3 (MiniMax) searched (challenge) "ten percent brain myth"');
    expect(h.out).toContain("03:20:00Z  research           juror 3 (MiniMax) opened 2 pages: mcgovern.mit.edu, apa.org");
    expect(h.out).toContain("03:20:00Z  research           juror 3 (MiniMax) is drafting its answer");

    const j = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(j.clock, FINALIZED, events)).forEach(([key, route]) => j.net.route(key, route));
    await j.run({ json: true });
    const lines = j.out.map((line) => JSON.parse(line) as Record<string, unknown>);
    const passed = lines.filter((line) => line.kind === "research_step");
    expect(passed).toHaveLength(3);
    expect(passed[0]).toMatchObject({ payload: { kind: "search", query: "ten percent brain myth" } });
  });

  it("renders a two-round claim with the debate and round two seats", async () => {
    const h = harness({ kind: "claim", id: DEBATE.claimId });
    Object.entries(finalizedRoutes(h.clock, DEBATE, DEBATE_EVENTS)).forEach(([key, route]) => h.net.route(key, route));
    const result = await h.run();

    expect(result.exitCode).toBe(0);
    expect(h.out).toContain("03:46:10Z  phase changed      round one research and sealed votes to round one reveal");
    expect(h.out).toContain("03:47:48Z  phase changed      round one reveal to discussion");
    expect(h.out.some((line) => /debate turn        debate turn 1, juror 2 \(Kimi\): I maintain my NO vote/.test(line))).toBe(true);
    expect(h.out.some((line) => /debate turn        debate turn 6, juror 5 \(DeepSeek\)/.test(line))).toBe(true);
    expect(h.out).toContain("03:59:47Z  phase changed      discussion to round two commit");
    // Round two draws new seats for the same five jurors, so the numbers carry over.
    expect(h.out.some((line) => /vote committed     juror 3 \(MiniMax\) committed \(1 of 5, round two\)/.test(line))).toBe(true);
    expect(h.out.some((line) => /vote revealed      juror 2 \(Kimi\) revealed UNSURE 4500 bps \(4 of 5, round two\)/.test(line))).toBe(true);
    expect(h.out.some((line) => /inference failed   juror 3 \(MiniMax\): INVALID_SCHEMA after 9 retries/.test(line))).toBe(true);
    expect(h.out.at(-2)).toMatch(/^04:09:17Z  final {14}UNRESOLVED, score 21\.25 \(2125 bps\), certificate 0xcd94ea5b/);
  });

  it("--json prints one JSON line per event and a summary, nothing else on stdout", async () => {
    const h = harness({ kind: "claim", id: FINALIZED_ID });
    Object.entries(finalizedRoutes(h.clock)).forEach(([key, route]) => h.net.route(key, route));
    const result = await h.run({ json: true, since: 70 });

    expect(result.exitCode).toBe(0);
    const parsed = h.out.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.length).toBe(9);
    expect(parsed.slice(0, -1).every((event) => (event.sequence as number) > 70)).toBe(true);
    const summary = parsed.at(-1)!;
    expect(summary).toMatchObject({ kind: "watch_summary", claimId: FINALIZED_ID, exitCode: 0, lastSequence: 78, state: 10 });
    expect((summary.result as { result: string }).result).toBe("NO");
    expect(h.err).toContain(`audit it: ov audit ${FINALIZED_ID}`);
  });
});

describe("watch: live claims", () => {
  it("stops at --for with the still line and exit 4, leaving no timers behind", async () => {
    const claim = activeClaim();
    const h = harness({ kind: "claim", id: claim.claimId });
    let streamSignal: AbortSignal | null | undefined;
    h.net.route(`GET /api/claims/${claim.claimId}`, () => json(claim));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    h.net.route(`GET /api/claims/${claim.claimId}/events`, (init) => {
      streamSignal = init?.signal;
      return sseResponse(h.clock, [...eventSteps(EVENTS.slice(0, 30)), { hang: true }], init?.signal);
    });
    const result = await h.run({ budgetMs: 5 * 60_000 });

    // The fixture skips most research ticks, so the 30th event is not sequence 30.
    const last = EVENTS[29]!.sequence as number;
    expect(result.exitCode).toBe(4);
    expect(result.lastSequence).toBe(last);
    expect(h.out.at(-1)).toBe(
      `10:05:00Z  stopped            still round one research and sealed votes; last sequence ${last}; run again with --since ${last} to continue`,
    );
    expect(streamSignal?.aborted).toBe(true);
    expect(h.clock.pending()).toBe(0);
    // The record was polled every 60 s while the stream stayed quiet.
    expect(h.net.calls.filter((call) => call === `GET /api/claims/${claim.claimId}`).length).toBeGreaterThanOrEqual(5);
  });

  it("catches a void through the record poll, waits for the relaunch and follows it", async () => {
    const voided = clone(VOIDED);
    const first = { ...voided, attemptChain: { ...voided.attemptChain!, status: "ACTIVE" as const, void: undefined, relaunchedAs: undefined } };
    const pending = { ...voided, attemptChain: { ...voided.attemptChain!, relaunchedAs: undefined } };
    const relaunched = clone(FINALIZED);
    relaunched.claimId = voided.attemptChain!.relaunchedAs!;
    const relaunchedEvents = EVENTS.map((event) => ({ ...event, claimId: relaunched.claimId }));

    const h = harness({ kind: "claim", id: voided.claimId });
    let firstStreamSignal: AbortSignal | null | undefined;
    h.net.route(`GET /api/claims/${voided.claimId}`, sequence([{ body: first }, { body: first }, { body: pending }, { body: voided }]));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    h.net.route(`GET /api/claims/${voided.claimId}/events`, (init) => {
      firstStreamSignal = init?.signal;
      return sseResponse(h.clock, [{ event: EVENTS[0]! }, { hang: true }], init?.signal);
    });
    h.net.route(`GET /api/claims/${relaunched.claimId}`, () => json(relaunched));
    h.net.route(`GET /api/claims/${relaunched.claimId}/events`, (init) =>
      sseResponse(h.clock, [...eventSteps(relaunchedEvents), { close: true }], init?.signal),
    );
    const result = await h.run();

    expect(result.exitCode).toBe(0);
    expect(result.claimId).toBe(relaunched.claimId);
    expect(h.out).toContain(
      "10:02:00Z  attempt voided     attempt 1 voided: PROVIDER_ERROR (DeepSeek, phase 1): GonkaRouter provider request failed; relaunch pending",
    );
    expect(h.out).toContain(`10:03:00Z  relaunched         attempt 2 ${BASE}/claims/${relaunched.claimId}`);
    expect(h.out.at(-1)).toBe(`audit it: ov audit ${relaunched.claimId}`);
    expect(firstStreamSignal?.aborted).toBe(true);
    expect(h.clock.pending()).toBe(0);
  });

  it("follows a relaunch known at the start and exits 3 when that attempt gave up", async () => {
    const h = harness({ kind: "claim", id: VOIDED.claimId });
    h.net.route(`GET /api/claims/${VOIDED.claimId}`, () => json(VOIDED));
    h.net.route(`GET /api/claims/${GAVE_UP.claimId}`, () => json(GAVE_UP));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    const result = await h.run();

    expect(result.exitCode).toBe(3);
    expect(h.out[0]).toMatch(/attempt voided     attempt 1 voided: PROVIDER_ERROR \(DeepSeek, phase 1\): GonkaRouter provider request failed; relaunched$/);
    expect(h.out[1]).toMatch(new RegExp(`relaunched {9}attempt 2 ${BASE}/claims/${GAVE_UP.claimId}$`));
    expect(h.out[2]).toMatch(/gave up {12}attempt 2 of 3 gave up: WEATHER_TIMEOUT; no more attempts$/);
    expect(h.net.calls.some((call) => call.includes("/events"))).toBe(false);
  });

  it("exits 3 with the void detail when --for passes without a relaunch", async () => {
    const pending = { ...clone(VOIDED), attemptChain: { ...VOIDED.attemptChain!, relaunchedAs: undefined } };
    const h = harness({ kind: "claim", id: pending.claimId });
    h.net.route(`GET /api/claims/${pending.claimId}`, () => json(pending));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    const result = await h.run({ budgetMs: 3 * 60_000 });

    expect(result.exitCode).toBe(3);
    expect(h.out.at(-1)).toMatch(/^10:03:00Z  stopped {12}attempt 1 voided: PROVIDER_ERROR \(DeepSeek, phase 1\): .*; no relaunch yet, run again with: ov watch 0x5b0b0bca/);
    expect(h.clock.pending()).toBe(0);
  });

  it("reconnects after a drop, resuming from the last sequence, and prints nothing twice", async () => {
    const h = harness({ kind: "claim", id: FINALIZED_ID });
    let connections = 0;
    h.net.route(`GET /api/claims/${FINALIZED_ID}`, () => json(FINALIZED));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    h.net.route(`GET /api/claims/${FINALIZED_ID}/events`, (init, url) => {
      connections += 1;
      if (connections === 1) return sseResponse(h.clock, [...eventSteps(EVENTS.slice(0, 20)), { error: "socket hang up" }], init?.signal);
      const from = Number(url.searchParams.get("from"));
      return sseResponse(h.clock, [...eventSteps(EVENTS.filter((event) => (event.sequence as number) >= from)), { close: true }], init?.signal);
    });
    const result = await h.run();

    expect(result.exitCode).toBe(0);
    expect(connections).toBe(2);
    const resumeFrom = (EVENTS[19]!.sequence as number) + 1;
    expect(h.net.calls).toContain(`GET /api/claims/${FINALIZED_ID}/events?from=${resumeFrom}`);
    expect(h.out.some((line) => /reconnecting {7}event stream: socket hang up; retry 1 of 5 in 1 s$/.test(line))).toBe(true);
    const finals = h.out.filter((line) => line.includes("committee drawn"));
    expect(finals.length).toBe(1);
    expect(h.out.at(-1)).toBe(`audit it: ov audit ${FINALIZED_ID}`);
  });

  it("gives up on a dead stream after five reconnects with exit 4", async () => {
    const claim = activeClaim();
    const h = harness({ kind: "claim", id: claim.claimId });
    h.net.route(`GET /api/claims/${claim.claimId}`, () => json(claim));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    h.net.route(`GET /api/claims/${claim.claimId}/events`, networkError("connect ECONNREFUSED"));
    const result = await h.run();

    expect(result.exitCode).toBe(4);
    expect(h.out.filter((line) => line.includes("reconnecting")).length).toBe(5);
    expect(h.err[0]).toMatch(/^event stream unavailable after 5 reconnects/);
    expect(h.out.at(-1)).toMatch(/stopped {12}still round one research and sealed votes; last sequence 0; run again with --since 0 to continue$/);
    expect(h.clock.pending()).toBe(0);
  });

  it("ends from the record when the poll sees the result before the stream does", async () => {
    const active = activeClaim();
    const h = harness({ kind: "claim", id: active.claimId });
    h.net.route(`GET /api/claims/${active.claimId}`, sequence([{ body: active }, { body: active }, { body: FINALIZED }]));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    h.net.route(`GET /api/claims/${active.claimId}/events`, (init) =>
      sseResponse(h.clock, [...eventSteps(EVENTS.slice(0, 10)), { hang: true }], init?.signal),
    );
    const result = await h.run();

    expect(result.exitCode).toBe(0);
    expect(h.out.at(-2)).toMatch(/^final: NO, score 2\.00 \(200 bps\), certificate 0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706 https:\/\/testnet\.suivision/);
    expect(h.out.at(-1)).toBe(`audit it: ov audit ${active.claimId}`);
  });

  it("exits 3 at once for a claim whose chain gave up", async () => {
    const h = harness({ kind: "id", id: GAVE_UP.claimId });
    h.net.route(`GET /api/claims/${GAVE_UP.claimId}`, () => json(GAVE_UP));
    h.net.route("GET /api/agents", () => json({ agents: [] }));
    const result = await h.run();

    expect(result.exitCode).toBe(3);
    expect(h.out).toEqual(["10:00:00Z  gave up            attempt 2 of 3 gave up: WEATHER_TIMEOUT; no more attempts"]);
  });

  it("exits 2 for an id that is not a claim", async () => {
    const h = harness({ kind: "id", id: "0x0" });
    h.net.route("GET /api/claims/0x0", () => json({ error: "internal_error", message: "claim was not found: 0x0" }, 500));
    const result = await h.run();

    expect(result.exitCode).toBe(2);
    expect(h.err).toEqual(["error: claim not found: 0x0"]);
  });
});

describe("buildSeatIndex", () => {
  it("numbers jurors by agent in seat order, the same juror keeping its number in round two", () => {
    const index = buildSeatIndex(DEBATE, new Map());
    const round1 = DEBATE.rounds![0]!.expectedJurySeatIds;
    const round2 = DEBATE.rounds![1]!.expectedJurySeatIds;
    expect(round1.map((seat) => index.jurorBySeat.get(seat.toLowerCase()))).toEqual([1, 2, 3, 4, 5]);
    expect(round2.map((seat) => index.jurorBySeat.get(seat.toLowerCase()))).toEqual([1, 2, 3, 4, 5]);
    expect(index.jurorBySeat.size).toBe(10);
    expect(index.expectedByPhase.get(2)).toBe(5);
    expect(index.modelBySeat.get(round1[1]!.toLowerCase())).toBe("moonshotai/Kimi-K2.6");
  });

  it("falls back to the agent directory for models and to commitments without rounds", () => {
    const claim = clone(FINALIZED);
    delete claim.rounds;
    for (const seat of claim.commitments) delete seat.modelId;
    const agents = new Map(claim.commitments.map((seat) => [seat.agentProfileId.toLowerCase(), "moonshotai/Kimi-K2.6"]));
    const index = buildSeatIndex(claim, agents);
    expect(index.jurorBySeat.size).toBe(5);
    expect(index.expectedByPhase.get(1)).toBe(5);
    expect([...index.modelBySeat.values()].every((model) => model === "moonshotai/Kimi-K2.6")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import type { ClaimInspection, QueuedFactCheck, WeatherReport } from "../engine/contract";
import { OvError, type StreamEvent } from "./api";
import { clone, fixture } from "./fixtures.test-utils";
import {
  NOT_CLEAR_NOTE,
  attemptWords,
  clockTime,
  emptySeatIndex,
  eventTime,
  formatDuration,
  formatRelative,
  formatScore,
  gaveUpWords,
  modelName,
  parseDuration,
  phaseWords,
  renderEvent,
  renderExtract,
  renderQueue,
  renderStatus,
  stateWords,
  voidWords,
  weatherInline,
  weatherLines,
  weatherSummary,
  type EventContext,
} from "./render";
import { buildSeatIndex } from "./watch";

const BASE = "https://ov.test";
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const VOIDED = fixture<ClaimInspection>("claim-voided.json");
const GAVE_UP = fixture<ClaimInspection>("claim-gave-up.json");
const NOW = Date.parse("2026-09-03T10:00:00Z");

const WEATHER: WeatherReport = {
  probedAtMs: NOW - 42_000,
  stale: false,
  clear: false,
  families: [
    { modelId: "research:firecrawl", family: "research", ok: true, latencyMs: 286, status: "200 1189 credits" },
    { modelId: "moonshotai/Kimi-K2.6", family: "kimi", ok: false, latencyMs: 60_005, status: "TIMEOUT" },
    { modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", family: "deepseek", ok: false, latencyMs: 60_005, status: "429" },
    { modelId: "MiniMaxAI/MiniMax-M2.7", family: "minimax", ok: true, latencyMs: 682, status: "200" },
  ],
};

describe("durations and times", () => {
  it("parses 30s, 9m, 1h, combinations and bare seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("9m")).toBe(540_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("1m30s")).toBe(90_000);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("20")).toBe(20_000);
    expect(parseDuration(" 2M ")).toBe(120_000);
  });

  it("rejects nonsense with exit code 2", () => {
    for (const bad of ["", "soon", "5x", "1h-", "m5"]) {
      expect(() => parseDuration(bad)).toThrow(OvError);
    }
    try {
      parseDuration("later");
    } catch (error) {
      expect((error as OvError).exitCode).toBe(2);
      expect((error as OvError).message).toContain("use 30s, 9m or 1h");
    }
  });

  it("formats durations and relative deadlines in words", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(180_000)).toBe("3 min");
    expect(formatDuration(3_900_000)).toBe("1 h 5 min");
    expect(formatDuration(7_200_000)).toBe("2 h");
    expect(formatRelative(NOW + 180_000, NOW)).toBe("in 3 min");
    expect(formatRelative(NOW - 1, NOW)).toBe("passed");
  });

  it("prints HH:MM:SSZ and picks the later of occurredAt and publishedAt", () => {
    expect(clockTime("2026-09-03T03:17:23.075Z")).toBe("03:17:23Z");
    expect(clockTime(undefined)).toBe("--:--:--Z");
    const event: StreamEvent = {
      sequence: 1,
      kind: "inference_completed",
      occurredAt: "2026-09-03T03:21:16.193Z",
      publishedAt: "2026-09-03T03:27:25.168Z",
      payload: {},
      raw: {},
    };
    expect(eventTime(event)).toBe("2026-09-03T03:27:25.168Z");
    expect(eventTime({ ...event, publishedAt: "2026-09-03T03:21:16.193Z" })).toBe("2026-09-03T03:21:16.193Z");
  });
});

describe("words", () => {
  it("names states, phases, models and scores in plain words", () => {
    expect(stateWords(3)).toBe("jury forming");
    expect(stateWords(4)).toBe("round one research and sealed votes");
    expect(stateWords(8)).toBe("round two reveal");
    expect(stateWords(11)).toBe("unresolved");
    expect(stateWords(99)).toBe("state 99");
    expect(phaseWords("REVEAL_1")).toBe("round one reveal");
    expect(phaseWords(6)).toBe("discussion");
    expect(phaseWords("SOMETHING_NEW")).toBe("something new");
    expect(modelName("deepseek-ai/DeepSeek-V4-Flash-0731")).toBe("DeepSeek");
    expect(modelName("MiniMaxAI/MiniMax-M2.7")).toBe("MiniMax");
    expect(modelName("moonshotai/Kimi-K2.6")).toBe("Kimi");
    expect(modelName("acme/other")).toBe("acme/other");
    expect(formatScore(200)).toBe("2.00 (200 bps)");
    expect(formatScore(2125)).toBe("21.25 (2125 bps)");
    expect(formatScore(null)).toBe("-");
    expect(attemptWords(FINALIZED.attemptChain)).toBe("attempt 3 of 3, settled");
    expect(attemptWords(undefined)).toBe("single attempt");
  });

  it("describes voids and gave ups with model and phase", () => {
    expect(voidWords(VOIDED.attemptChain!)).toBe(
      "attempt 1 voided: PROVIDER_ERROR (DeepSeek, phase 1): GonkaRouter provider request failed",
    );
    expect(gaveUpWords(GAVE_UP.attemptChain!)).toBe("attempt 2 of 3 gave up: WEATHER_TIMEOUT; no more attempts");
  });
});

describe("weather", () => {
  it("lists the families in a fixed order with ok latency or the status", () => {
    expect(weatherLines(WEATHER)).toEqual(["DeepSeek    429", "MiniMax     ok 0.7 s", "Kimi        TIMEOUT", "Web search  ok 0.3 s"]);
    expect(weatherSummary(WEATHER, NOW)).toBe("not clear, probed 42 s ago");
    expect(weatherSummary({ ...WEATHER, clear: true, stale: true, probedAtMs: null }, NOW)).toBe("clear, no recent probe");
    expect(weatherInline(WEATHER)).toBe("DeepSeek 429, MiniMax ok, Kimi TIMEOUT, Web search ok");
    expect(NOT_CLEAR_NOTE).toContain("queue until all four");
  });
});

describe("status block", () => {
  it("shows a live round one claim with its next deadline", () => {
    const claim = clone(FINALIZED);
    claim.state = 4;
    delete claim.result;
    claim.rounds![0]!.committedJurySeatIds = claim.rounds![0]!.committedJurySeatIds.slice(0, 2);
    claim.rounds![0]!.revealedJurySeatIds = [];
    claim.attemptChain = { ...claim.attemptChain!, status: "ACTIVE" };
    const now = claim.deadlines.firstCommitDeadlineMs - 180_000;
    const lines = renderStatus(claim, BASE, now);
    expect(lines).toContain("state      round one research and sealed votes");
    expect(lines).toContain("round one  2 of 5 seats committed, 0 of 5 revealed");
    expect(lines).toContain("attempt    attempt 3 of 3, active");
    expect(lines.some((line) => line.startsWith("next       reveal window opens in 3 min ("))).toBe(true);
    expect(lines.some((line) => line.startsWith("result"))).toBe(false);
  });

  it("shows a voided claim with its relaunch link", () => {
    const lines = renderStatus(VOIDED, BASE, NOW);
    expect(lines).toContain("attempt    attempt 1 of 3, voided");
    expect(lines).toContain("void       attempt 1 voided: PROVIDER_ERROR (DeepSeek, phase 1): GonkaRouter provider request failed");
    expect(lines).toContain(`relaunch   ${BASE}/claims/${VOIDED.attemptChain!.relaunchedAs}`);
    expect(lines.some((line) => line.startsWith("failed     "))).toBe(true);
  });

  it("shows a finalized claim with result, score and certificate link", () => {
    const lines = renderStatus(FINALIZED, BASE, NOW);
    expect(lines[0]).toBe(`claim      ${FINALIZED.claimId}`);
    expect(lines).toContain("state      finalized");
    expect(lines).toContain("round one  5 of 5 seats committed, 5 of 5 revealed");
    expect(lines).toContain("result     NO, truth score 2.00 (200 bps)");
    expect(lines.at(-1)).toBe(
      "certificate 0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706 https://suiscan.xyz/testnet/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706",
    );
    expect(lines.some((line) => line.startsWith("next"))).toBe(false);
    expect(lines.some((line) => line.startsWith("gave up"))).toBe(false);
  });

  it("shows a gave up claim", () => {
    const lines = renderStatus(GAVE_UP, BASE, NOW);
    expect(lines).toContain("gave up    attempt 2 of 3 gave up: WEATHER_TIMEOUT; no more attempts");
  });
});

describe("queue and extract blocks", () => {
  const item: QueuedFactCheck = {
    queueId: `0x${"9f".repeat(32)}`,
    status: "QUEUED",
    statement: "The Eiffel Tower was completed in 1889.",
    createdAt: new Date(NOW - 300_000).toISOString(),
    expiresAt: new Date(NOW + 5 * 3_600_000 + 55 * 60_000).toISOString(),
    weather: WEATHER,
  };

  it("renders a queued item with created, expires and the weather", () => {
    const lines = renderQueue(item, BASE, NOW);
    expect(lines[1]).toBe("status     QUEUED, waiting for clear weather (the engine launches it when all four families answer)");
    expect(lines).toContain(`link       ${BASE}/fact-check/queue/${item.queueId}`);
    expect(lines).toContain("created    2026-09-03T09:55:00Z (5 min ago)");
    expect(lines).toContain("expires    2026-09-03T15:55:00Z (in 5 h 55 min)");
    expect(lines).toContain("  Kimi        TIMEOUT");
    expect(lines.at(-1)).toBe("  not clear, probed 42 s ago");
  });

  it("renders a launched item with the claim link and a cancelled one with its error", () => {
    const launched = renderQueue({ ...item, status: "LAUNCHED", claimId: FINALIZED.claimId }, BASE, NOW);
    expect(launched).toContain(`link       ${BASE}/claims/${FINALIZED.claimId}`);
    expect(launched).toContain(`watch it   ov watch ${FINALIZED.claimId}`);
    const cancelled = renderQueue({ ...item, status: "CANCELLED", launchError: "claim statement too short" }, BASE, NOW);
    expect(cancelled).toContain("status     CANCELLED");
    expect(cancelled).toContain("launch error claim statement too short");
    const expired = renderQueue({ ...item, status: "EXPIRED" }, BASE, NOW);
    expect(expired).toContain("status     EXPIRED (queued items expire after six hours)");
  });

  it("renders extracted candidates with the next step", () => {
    const lines = renderExtract({
      claims: [
        { claim: "The Eiffel Tower was completed in 1889.", reason: "A dated construction fact.", quote: "completed in 1889" },
        { claim: "The Eiffel Tower is 330 metres tall.", reason: "A measurable figure.", quote: "330 metres tall" },
      ],
      language: "en",
      claim: "The Eiffel Tower was completed in 1889.",
      modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    });
    expect(lines[0]).toBe("2 candidate claims (language en, extracted by deepseek-ai/DeepSeek-V4-Flash-0731)");
    expect(lines).toContain("1. The Eiffel Tower was completed in 1889.");
    expect(lines).toContain("   why: A dated construction fact.");
    expect(lines).toContain('   quote: "completed in 1889"');
    expect(lines.at(-1)).toBe('next: ov submit "The Eiffel Tower was completed in 1889."');
  });
});

describe("event lines", () => {
  const context = (): EventContext => ({
    seats: buildSeatIndex(FINALIZED, new Map()),
    counts: { committed: new Map(), revealed: new Map() },
    verbose: false,
  });
  const seat = FINALIZED.rounds![0]!.expectedJurySeatIds[2]!;
  const event = (kind: string, payload: Record<string, unknown>, raw: Record<string, unknown> = {}): StreamEvent => ({
    sequence: 1,
    kind,
    occurredAt: "2026-09-03T03:21:06.093Z",
    payload,
    raw: { kind, payload, ...raw },
  });

  it("reads phase_changed as numbers or labels", () => {
    const ctx = context();
    expect(renderEvent(event("phase_changed", { from: 4, to: 5 }), ctx)).toBe(
      "03:21:06Z  phase changed      round one research and sealed votes to round one reveal",
    );
    expect(renderEvent(event("phase_changed", { previous_phase: "DISCUSSION", new_phase: "COMMIT_2" }), ctx)).toBe(
      "03:21:06Z  phase changed      discussion to round two commit",
    );
  });

  it("counts commits and reveals per phase and names the juror", () => {
    const ctx = context();
    expect(renderEvent(event("vote_committed", { phase: 1, jury_seat_id: seat }), ctx)).toBe(
      "03:21:06Z  vote committed     juror 3 (MiniMax) committed (1 of 5)",
    );
    expect(renderEvent(event("vote_committed", { phase: 1, jury_seat_id: seat }), ctx)).toContain("(2 of 5)");
    expect(renderEvent(event("vote_revealed", { phase: 2, jury_seat_id: seat, outcome: "YES", confidence_bps: 8000 }), ctx)).toBe(
      "03:21:06Z  vote revealed      juror 3 (MiniMax) revealed YES 8000 bps (1 of 5, round two)",
    );
    expect(renderEvent(event("vote_revealed", { phase: 1, jury_seat_id: "0xdead", outcome: "NO", confidence_bps: 1, valid: false }), ctx)).toBe(
      "03:21:06Z  vote revealed      a juror revealed NO 1 bps (1 of 5, invalid)",
    );
  });

  it("renders debate turns, convergence, repairs and the final line", () => {
    const ctx = context();
    expect(
      renderEvent(
        event("DELIBERATION_TURN", { ordinal: 2, exchange: 1, jurySeatId: seat, stance: "NO", confidenceBps: 9000, argument: "x".repeat(140), status: "SPOKEN" }),
        ctx,
      ),
    ).toBe(`03:21:06Z  debate turn        debate turn 3, juror 3 (MiniMax) NO 9000 bps: ${"x".repeat(97)}...`);
    expect(renderEvent(event("DELIBERATION_TURN", { ordinal: 3, jurySeatId: seat, status: "SKIPPED", failureStatus: "TIMEOUT" }), ctx)).toBe(
      "03:21:06Z  debate turn        debate turn 4, juror 3 (MiniMax) skipped (TIMEOUT)",
    );
    expect(renderEvent(event("debate_converged", { exchange: 2 }), ctx)).toBe("03:21:06Z  debate converged   after exchange 2");
    expect(renderEvent(event("output_repaired", { field: "citations", jury_seat_id: seat }), ctx)).toBe(
      "03:21:06Z  output repaired    juror 3 (MiniMax) output repaired: citations",
    );
    expect(renderEvent(event("claim_finalized", { outcome: "YES", truth_score_bps: 9100, certificate_id: `0x${"ab".repeat(32)}` }), ctx)).toBe(
      `03:21:06Z  final              YES, score 91.00 (9100 bps), certificate 0xabababab… https://suiscan.xyz/testnet/object/0x${"ab".repeat(32)}`,
    );
  });

  it("skips research ticks and unknown kinds unless verbose", () => {
    const ctx = context();
    expect(renderEvent(event("RESEARCH_TICK", { kind: "open", jurySeatId: seat }), ctx)).toBeUndefined();
    expect(renderEvent(event("something_else", { a: 1 }), ctx)).toBeUndefined();
    const verbose = { ...ctx, verbose: true };
    expect(renderEvent(event("RESEARCH_TICK", { kind: "open", jurySeatId: seat }), verbose)).toBe("03:21:06Z  research           juror 3 (MiniMax) open");
    expect(renderEvent(event("something_else", { a: 1 }), verbose)).toBe('03:21:06Z  something else     {"a":1}');
  });

  it("names a juror from the agent id when the seat is unknown", () => {
    const ctx = context();
    const agent = FINALIZED.commitments[0]!.agentProfileId;
    expect(renderEvent(event("agent_activity", { status: "RUNNING" }, { actorId: agent }), ctx)).toMatch(/juror working {6}juror \d \(DeepSeek\) started research$/);
    expect(renderEvent(event("agent_activity", { status: "NO_VALID_INFERENCE" }, { actorId: agent }), ctx)).toMatch(/juror failed {7}juror \d \(DeepSeek\): no valid inference$/);
    expect(renderEvent(event("agent_activity", { status: "RUNNING" }), { ...ctx, seats: emptySeatIndex() })).toBe(
      "03:21:06Z  juror working      a juror started research",
    );
  });
});

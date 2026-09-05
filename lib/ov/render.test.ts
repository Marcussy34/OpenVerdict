import { describe, expect, it } from "vitest";

import type {
  AgentDirectoryEntry,
  ClaimInspection,
  WeatherReport,
} from "../engine/contract";
import type { AgentManifestDocument } from "../protocol/types";
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
  modelLabel,
  modelName,
  parseDuration,
  phaseWords,
  renderAgent,
  renderAgents,
  renderEvent,
  renderExtract,
  renderStatus,
  stateWords,
  voidWords,
  weatherInline,
  weatherRuleLine,
  weatherLines,
  weatherSummary,
  wrapText,
  type EventContext,
} from "./render";
import { buildSeatIndex } from "./watch";

const BASE = "https://ov.test";
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const VOIDED = fixture<ClaimInspection>("claim-voided.json");
const GAVE_UP = fixture<ClaimInspection>("claim-gave-up.json");
const AGENTS = fixture<AgentDirectoryEntry[]>("agents.json");
const MANIFEST = fixture<AgentManifestDocument>("agent-manifest.json");
const NOW = Date.parse("2026-09-03T10:00:00Z");

const WEATHER: WeatherReport = {
  probedAtMs: NOW - 42_000,
  stale: false,
  clear: false,
  requiredFamilies: 3,
  activeFamilies: ["deepseek", "minimax", "kimi"],
  families: [
    { modelId: "research:firecrawl", family: "research", ok: true, latencyMs: 286, status: "200 1189 credits" },
    { modelId: "moonshotai/Kimi-K2.6", family: "kimi", ok: false, latencyMs: 60_005, status: "TIMEOUT" },
    { modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", family: "deepseek", ok: false, latencyMs: 60_005, status: "429" },
    { modelId: "MiniMaxAI/MiniMax-M2.7", family: "minimax", ok: true, latencyMs: 682, status: "200" },
  ],
};

describe("wrapped prose", () => {
  it("wraps to the width behind a prefix, indents the rest and never breaks a word", () => {
    const lines = wrapText("one two three four five six seven", { width: 20, prefix: "  reason: ", continuation: "    " });
    expect(lines).toEqual(["  reason: one two", "    three four five", "    six seven"]);
    // A word longer than the width overflows rather than becoming unusable.
    expect(wrapText("https://example.org/a/very/long/path", { width: 10 })).toEqual(["https://example.org/a/very/long/path"]);
    // Whitespace is collapsed and empty text prints nothing.
    expect(wrapText("  spaced \n text ", { width: 40 })).toEqual(["spaced text"]);
    expect(wrapText("   ", { width: 40 })).toEqual([]);
    // Without a continuation the later lines align under the prefix.
    expect(wrapText("aaa bbb", { width: 6, prefix: "> " })).toEqual(["> aaa", "  bbb"]);
  });
});

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
    // modelLabel keeps the version the trail needs; the build date goes.
    expect(modelLabel("deepseek-ai/DeepSeek-V4-Flash-0731")).toBe("DeepSeek V4 Flash");
    expect(modelLabel("MiniMaxAI/MiniMax-M2.7")).toBe("MiniMax M2.7");
    expect(modelLabel("moonshotai/Kimi-K2.6")).toBe("Kimi K2.6");
    expect(modelLabel("plain")).toBe("plain");
    expect(modelLabel(undefined)).toBe("unknown model");
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
    expect(NOT_CLEAR_NOTE).toContain("every active model family and web search");
  });

  it("states the draw rule and the families that still hold a seat", () => {
    expect(weatherRuleLine(WEATHER)).toBe(
      "rule        3 model families required, 3 active: DeepSeek, MiniMax, Kimi",
    );
    expect(
      weatherRuleLine({
        ...WEATHER,
        requiredFamilies: 2,
        activeFamilies: ["deepseek", "minimax"],
      }),
    ).toBe("rule        2 model families required (degraded mode), 2 active: DeepSeek, MiniMax");
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

  it("says nothing about the jury when the claim carries no committee", () => {
    const claim = clone(FINALIZED);
    delete claim.jury;

    expect(renderStatus(claim, BASE, NOW).some((line) => line.startsWith("jury  "))).toBe(
      false,
    );
  });

  it("names the families that sat, and degraded mode when fewer than three did", () => {
    const full = clone(FINALIZED);
    full.jury = { familyCount: 3, requiredFamilies: 3, degraded: false };
    expect(renderStatus(full, BASE, NOW)).toContain("jury       3 model families");

    const degraded = clone(FINALIZED);
    degraded.jury = { familyCount: 2, requiredFamilies: 2, degraded: true };
    expect(renderStatus(degraded, BASE, NOW)).toContain(
      "jury       2 model families (degraded mode), registry required 2 at the draw",
    );
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
      "certificate 0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706 https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706",
    );
    expect(lines.some((line) => line.startsWith("next"))).toBe(false);
    expect(lines.some((line) => line.startsWith("gave up"))).toBe(false);
  });

  it("shows a gave up claim", () => {
    const lines = renderStatus(GAVE_UP, BASE, NOW);
    expect(lines).toContain("gave up    attempt 2 of 3 gave up: WEATHER_TIMEOUT; no more attempts");
  });
});

describe("extract block", () => {
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

describe("jury roster blocks", () => {
  it("renders the roster table with families, stake, rewards and track record", () => {
    const lines = renderAgents(AGENTS, BASE);
    const text = lines.join("\n");
    expect(lines[0]).toBe("# OpenVerdict jury (3 seats, 2 active)");
    expect(text).toContain("families: DeepSeek 1, MiniMax 1, Kimi 1");
    expect(text).toContain("staked seats: 1 of 3 (the rest carry a bond the operator posted)");
    // An operator seat shows "operator" where a staked seat shows the bond.
    expect(text).toContain(
      "| 1 | 0x4ee8af57\u2026 | DeepSeek V4 Flash | SOURCE_AUTHENTICITY | operator | 0.0066 SUI | 32 seats, 13 committed, 4 revealed, 1 agreed |",
    );
    expect(text).toContain(
      "| 2 | 0x1047c939\u2026 | MiniMax M2.7 | SKEPTIC | 0.1 SUI | 0 SUI | no seats yet |",
    );
    expect(text).toContain("| 3 | 0x19e6bda3\u2026 (inactive) | Kimi K2.6 | SKEPTIC |");
    expect(text).toContain(`- 1: ${AGENTS[0]!.agentProfileId} ${BASE}/agents/${AGENTS[0]!.agentProfileId}`);
    expect(text).toContain(`Stake on a seat at ${BASE}/agents (0.1 SUI minimum`);
  });

  it("renders one seat with its manifest, and says so when there is none", () => {
    const staked = renderAgent(AGENTS[1]!, MANIFEST, BASE).join("\n");
    expect(staked).toContain(`link       ${BASE}/agents/${AGENTS[1]!.agentProfileId}`);
    expect(staked).toContain(`stake      0.1 SUI staked by ${AGENTS[1]!.staker}`);
    expect(staked).toContain("track      0 seats served, 0 committed, 0 revealed, 0 agreed with the certificate");

    const operator = renderAgent(AGENTS[0]!, MANIFEST, BASE).join("\n");
    expect(operator).toContain("stake      the operator posted this seat's bond");
    expect(operator).toContain("earned     0.0066 SUI in jury reward tickets");
    expect(operator).toContain("           version 6, network testnet, provider gonkarouter");
    expect(operator).toContain(`prompt     spec v4, hash ${MANIFEST.promptHash}`);
    expect(operator).toContain(
      `tools      policy v4, hash ${MANIFEST.toolPolicyHash}, search and open, at most 4 searches, 5 opens, 10 turns`,
    );
    expect(operator).toContain(`evidence   OPENVERDICT_EVIDENCE_POLICY_V1, hash ${MANIFEST.evidencePolicyHash}`);
    // The on-chain field is humanBackingHash; the words say staker hash.
    expect(operator).toContain("staker     hash 0x5465859212");
    expect(operator).toContain("a staker hash, never an identity");

    const bare = renderAgent(AGENTS[0]!, undefined, BASE).join("\n");
    expect(bare).toContain("no manifest document published for this seat (404 manifest_not_found)");
    expect(bare).not.toContain("prompt     spec");
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
      `03:21:06Z  final              YES, score 91.00 (9100 bps), certificate 0xabababab… https://testnet.suivision.xyz/object/0x${"ab".repeat(32)}`,
    );
  });

  it("prints one line per live research step", () => {
    const ctx = context();
    expect(
      renderEvent(
        event("research_step", { jury_seat_id: seat, ordinal: 0, kind: "search", intent: "support", query: 'the "ten percent" myth' }),
        ctx,
      ),
    ).toBe('03:21:06Z  research           juror 3 (MiniMax) searched (support) "the \\"ten percent\\" myth"');
    expect(
      renderEvent(
        event("research_step", {
          jury_seat_id: seat,
          ordinal: 1,
          kind: "open",
          urls: ["https://www.mit.edu/a", "https://mit.edu/b", "https://apa.org/c"],
          page_count: 3,
        }),
        ctx,
      ),
    ).toBe("03:21:06Z  research           juror 3 (MiniMax) opened 3 pages: mit.edu, apa.org");
    expect(renderEvent(event("research_step", { jury_seat_id: seat, ordinal: 2, kind: "answer" }), ctx)).toBe(
      "03:21:06Z  research           juror 3 (MiniMax) is drafting its answer",
    );
    // A step of an unknown shape says nothing rather than half a line.
    expect(renderEvent(event("research_step", { jury_seat_id: seat, ordinal: 3 }), ctx)).toBeUndefined();
  });

  it("adds the step timings to any line only with --verbose", () => {
    const payload = {
      jury_seat_id: seat,
      run_hash: `0x${"ab".repeat(32)}`,
      timing_ms: { model: 19_000, upload: 8_040, approve: 3_000, seal: -1 },
    };
    const ctx = context();
    expect(renderEvent(event("run_approved", payload), ctx)).toBe(
      "03:21:06Z  run approved       juror 3 (MiniMax) run approved, hash 0xabababab…",
    );
    expect(renderEvent(event("run_approved", payload), { ...ctx, verbose: true })).toBe(
      "03:21:06Z  run approved       juror 3 (MiniMax) run approved, hash 0xabababab… (model 19.0 s, upload 8.0 s, approve 3.0 s)",
    );
    expect(renderEvent(event("evidence_frozen", { root: "0x1", phase: 1 }), { ...ctx, verbose: true })).toBe(
      "03:21:06Z  evidence frozen    root 0x1, phase 1",
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

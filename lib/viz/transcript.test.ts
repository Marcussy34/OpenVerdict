import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ClaimInspection, ResolutionEvent } from "../engine/contract";
import { CLAIM_MODE, CLAIM_STATE } from "../protocol/constants";
import {
  buildTranscript,
  jurorAt,
  stepsFromRunProof,
  visibleEntriesAt,
} from "./transcript";

const START_MS = Date.parse("2026-09-04T00:00:00.000Z");
const SEAT_IDS = Array.from({ length: 5 }, (_, index) => `seat-${index + 1}`);
const MODELS = [
  "deepseek-ai/DeepSeek-V4-Flash-0731",
  "deepseek-ai/DeepSeek-V4-Flash-0731",
  "MiniMaxAI/MiniMax-M2.7",
  "MiniMaxAI/MiniMax-M2.7",
  "moonshotai/Kimi-K2.6",
];

function inspection(overrides: Partial<ClaimInspection> = {}): ClaimInspection {
  return {
    claimId: "claim-1",
    mode: CLAIM_MODE.DIRECT_REVIEW,
    state: CLAIM_STATE.COMMIT_1,
    statement: "Humans use only ten percent of their brains.",
    resolutionCriteria: "Resolve from primary sources.",
    deadlines: {
      evidenceCutoffMs: START_MS,
      proposalDeadlineMs: START_MS + 1_000,
      challengeDeadlineMs: START_MS + 2_000,
      firstCommitDeadlineMs: START_MS + 600_000,
      firstRevealDeadlineMs: START_MS + 720_000,
      discussionDeadlineMs: START_MS + 1_560_000,
      secondCommitDeadlineMs: START_MS + 1_800_000,
      secondRevealDeadlineMs: START_MS + 1_920_000,
    },
    committeeId: "committee-1",
    evidenceRoots: [],
    commitments: SEAT_IDS.map((jurySeatId, index) => ({
      jurySeatId,
      agentProfileId: `agent-${index + 1}`,
      modelId: MODELS[index],
      committed: false,
      revealed: false,
    })),
    rounds: [{ phase: 1, expectedJurySeatIds: SEAT_IDS, committedJurySeatIds: [], revealedJurySeatIds: [] }],
    ...overrides,
  };
}

let sequence = 0;
function event(
  kind: string,
  atMs: number,
  payload: Record<string, unknown>,
  overrides: Partial<ResolutionEvent> = {},
): ResolutionEvent {
  sequence += 1;
  return {
    eventId: `event-${sequence}`,
    claimId: "claim-1",
    sequence,
    phase: "INFERENCE_1",
    kind,
    source: "ENGINE",
    visibility: "PUBLIC_NOW",
    occurredAt: new Date(atMs).toISOString(),
    payload,
    ...overrides,
  };
}

function researchStep(atMs: number, seat: string, payload: Record<string, unknown>): ResolutionEvent {
  return event("research_step", atMs, { jury_seat_id: seat, ...payload }, { runId: `run-${seat}` });
}

/** One claim from the draw to a first reveal, in stream order. */
function stream(): ResolutionEvent[] {
  sequence = 0;
  return [
    event("claim_created", START_MS, { transaction_digest: "0xdigest" }),
    event("committee_selected", START_MS + 2_000, { jury_seat_ids: SEAT_IDS }),
    event("evidence_frozen", START_MS + 4_000, { phase: 1, root: `0x${"ab".repeat(32)}` }),
    researchStep(START_MS + 10_000, SEAT_IDS[2]!, {
      ordinal: 0,
      kind: "search",
      intent: "challenge",
      query: "ten percent brain myth",
      result_domains: ["mit.edu"],
    }),
    researchStep(START_MS + 20_000, SEAT_IDS[2]!, {
      ordinal: 1,
      kind: "open",
      urls: ["https://mit.edu/a", "https://apa.org/b"],
      page_count: 2,
    }),
    researchStep(START_MS + 30_000, SEAT_IDS[2]!, { ordinal: 2, kind: "answer" }),
    event("run_approved", START_MS + 40_000, { jury_seat_id: SEAT_IDS[2], run_hash: "0xrun" }),
    event("vote_committed", START_MS + 50_000, { jury_seat_id: SEAT_IDS[2], phase: 1 }),
    event("phase_changed", START_MS + 60_000, { previous_phase: "COMMIT_1", new_phase: "REVEAL_1" }),
    event("vote_revealed", START_MS + 70_000, {
      jury_seat_id: SEAT_IDS[2],
      phase: 1,
      outcome: "NO",
      confidence_bps: 9_500,
    }),
    event("claim_finalized", START_MS + 80_000, {
      outcome: "NO",
      truth_score_bps: 200,
      certificate_id: "0xcert",
    }),
  ];
}

describe("live transcript", () => {
  it("reads the record as a conversation, in the words the CLI uses", () => {
    const { entries } = buildTranscript({ claim: inspection(), events: stream() });

    expect(entries[0]).toMatchObject({
      kind: "statement",
      text: "Humans use only ten percent of their brains.",
      atMs: START_MS,
    });
    expect(entries.map((entry) => entry.text)).toEqual([
      "Humans use only ten percent of their brains.",
      "The claim is live on Sui, and its deadlines started with it.",
      "Sui's own randomness drew 5 seats: DeepSeek, DeepSeek, MiniMax, MiniMax, Kimi.",
      "The evidence is frozen before any juror reasons. Nothing can be slipped in or out now.",
      "Juror 3 (MiniMax) finished its research; its run hash is on Sui and its sealed bundle is cited on chain.",
      "Juror 3 (MiniMax) sealed its vote (1 of 5).",
      "The votes open together now: Sui recomputes every commitment before accepting it.",
      "Juror 3 (MiniMax) revealed NO at 95 percent (1 of 5).",
      "Final: NO, truth score 2.00.",
    ]);

    // The juror cards hang off the draw, and the links are targets, not URLs.
    expect(entries.find((entry) => entry.kind === "committee")?.showJurors).toBe(true);
    expect(entries.find((entry) => entry.kind === "claim")?.link).toEqual({
      label: "transaction",
      target: "transaction",
      id: "0xdigest",
    });
    expect(entries.at(-1)?.link).toEqual({
      label: "certificate",
      target: "object",
      id: "0xcert",
    });
    // Research steps feed the cards, never the conversation.
    expect(entries.some((entry) => entry.text.includes("searched"))).toBe(false);
  });

  it("builds one card per juror, numbered in seat order, with its live steps", () => {
    const { jurors } = buildTranscript({
      claim: inspection(),
      events: stream(),
      agents: new Map([["agent-3", { modelId: MODELS[2], role: "SKEPTIC" }]]),
    });

    expect(jurors.map((juror) => juror.index)).toEqual([1, 2, 3, 4, 5]);
    const juror = jurors[2]!;
    expect(juror).toMatchObject({
      agentProfileId: "agent-3",
      family: "minimax",
      role: "SKEPTIC",
      outcome: "NO",
      confidenceBps: 9_500,
    });
    expect(juror.seats).toEqual([{ seatId: SEAT_IDS[2], phase: 1 }]);
    expect(juror.steps.map((step) => step.kind)).toEqual(["search", "open", "answer"]);
    expect(juror.timeline.map((point) => point.status)).toEqual([
      "seat drawn, waiting to start",
      "searching for evidence against the claim",
      "reading mit.edu, apa.org",
      "drafting the answer",
      "research finished, run approved on Sui",
      "vote sealed",
      "revealed NO at 95 percent",
    ]);
  });

  it("replays: entries and card status at a past instant", () => {
    const { entries, jurors } = buildTranscript({ claim: inspection(), events: stream() });
    const juror = jurors[2]!;

    expect(visibleEntriesAt(entries, START_MS + 5_000).map((entry) => entry.kind)).toEqual([
      "statement",
      "claim",
      "committee",
      "evidence",
    ]);
    expect(jurorAt(juror, START_MS + 25_000)).toMatchObject({
      state: "researching",
      status: "reading mit.edu, apa.org",
    });
    expect(jurorAt(juror, START_MS + 25_000).steps).toHaveLength(2);
    expect(jurorAt(juror, START_MS + 55_000).status).toBe("vote sealed");
    expect(jurorAt(juror, Number.POSITIVE_INFINITY)).toMatchObject({
      state: "revealed",
      status: "revealed NO at 95 percent",
    });
    // Before the draw a card is waiting, never guessing.
    expect(jurorAt(jurors[0]!, START_MS).state).toBe("waiting");
  });

  it("lets the record close a seat the stream never finished", () => {
    const claim = inspection({
      commitments: [
        { jurySeatId: SEAT_IDS[0]!, agentProfileId: "agent-1", modelId: MODELS[0], committed: false, revealed: false, failureStatus: "TIMEOUT" },
        { jurySeatId: SEAT_IDS[1]!, agentProfileId: "agent-2", modelId: MODELS[1], committed: true, revealed: true, outcome: 2, confidenceBps: 8_000 },
        ...inspection().commitments.slice(2),
      ],
    });
    const { jurors } = buildTranscript({ claim, events: stream() });

    expect(jurorAt(jurors[0]!, Number.POSITIVE_INFINITY)).toMatchObject({
      state: "failed",
      status: "failed before commit: TIMEOUT",
    });
    expect(jurors[0]?.failureStatus).toBe("TIMEOUT");
    expect(jurorAt(jurors[1]!, Number.POSITIVE_INFINITY)).toMatchObject({
      state: "revealed",
      status: "revealed NO at 80 percent",
    });
    expect(jurors[1]?.outcome).toBe("NO");
  });

  it("keeps a juror's number across both rounds and merges its round two seat", () => {
    const claim = inspection({
      rounds: [
        { phase: 1, expectedJurySeatIds: SEAT_IDS, committedJurySeatIds: [], revealedJurySeatIds: [] },
        { phase: 2, expectedJurySeatIds: ["seat-6"], committedJurySeatIds: [], revealedJurySeatIds: [] },
      ],
      commitments: [
        ...inspection().commitments,
        { jurySeatId: "seat-6", agentProfileId: "agent-3", modelId: MODELS[2], committed: true, revealed: false },
      ],
    });
    const events = [
      ...stream(),
      event("vote_committed", START_MS + 90_000, { jury_seat_id: "seat-6", phase: 2 }),
    ];
    const { entries, jurors } = buildTranscript({ claim, events });

    expect(jurors).toHaveLength(5);
    expect(jurors[2]?.seats).toEqual([
      { seatId: SEAT_IDS[2], phase: 1 },
      { seatId: "seat-6", phase: 2 },
    ]);
    expect(entries.at(-1)?.text).toBe("Juror 3 (MiniMax) sealed its vote (1 of 1, round two).");
    expect(jurorAt(jurors[2]!, Number.POSITIVE_INFINITY).status).toBe("table vote sealed");
  });

  it("carries a debate turn whole, so the view shows the argument in full", () => {
    const turn = {
      claimId: "claim-1",
      jurySeatId: SEAT_IDS[1],
      agentProfileId: "agent-2",
      ordinal: 0,
      exchange: 1,
      specVersion: "4",
      answering: 2,
      theirPoint: "Seat 2 read the filing as a completed sale.",
      analysis: "That holds for the escrow language, but the same filing dates it later.",
      question: { seat: 4, text: "Which clause closes the sale?" },
      position: "I hold NO and lower my confidence.",
      argument:
        "That holds for the escrow language, but the same filing dates it later. I hold NO and lower my confidence.",
      citations: ["https://example.test/filing"],
      stance: "NO",
      confidenceBps: 6_200,
      status: "SPOKEN",
      atMs: START_MS + 100_000,
    };
    const { entries } = buildTranscript({
      claim: inspection(),
      events: [...stream(), event("DELIBERATION_TURN", START_MS + 100_000, turn)],
    });

    const debate = entries.find((entry) => entry.kind === "debate");
    // The whole turn travels, and nothing is quoted at preview length.
    expect(debate?.turn).toEqual(turn);
    expect(debate?.detail).toBeUndefined();
    expect(debate?.text).toBe("Debate turn 1, Juror 2 (DeepSeek) NO at 62 percent.");
    expect(debate?.tone).toBe("no");
  });

  it("keeps the skipped turn's alert line and still carries the turn", () => {
    const turn = {
      claimId: "claim-1",
      jurySeatId: SEAT_IDS[0],
      agentProfileId: "agent-1",
      ordinal: 2,
      exchange: 2,
      argument: "",
      citations: [],
      status: "SKIPPED",
      failureStatus: "WINDOW_EXHAUSTED",
      atMs: START_MS + 110_000,
    };
    const { entries } = buildTranscript({
      claim: inspection(),
      events: [...stream(), event("DELIBERATION_TURN", START_MS + 110_000, turn)],
    });

    const debate = entries.find((entry) => entry.kind === "debate");
    expect(debate?.text).toBe(
      "Debate turn 3, Juror 1 (DeepSeek) skipped (WINDOW_EXHAUSTED).",
    );
    expect(debate?.tone).toBe("alert");
    expect(debate?.turn?.status).toBe("SKIPPED");
  });

  it("states the rule the seats were drawn under, degraded mode included", () => {
    const full = buildTranscript({ claim: inspection(), events: stream() });
    expect(full.entries.find((entry) => entry.kind === "committee")?.detail).toBe(
      "At most two seats per model family, three families in every jury.",
    );

    const degraded = buildTranscript({
      claim: inspection({
        jury: { familyCount: 2, requiredFamilies: 2, degraded: true },
      }),
      events: stream(),
    });
    expect(degraded.entries.find((entry) => entry.kind === "committee")?.detail).toBe(
      "Two model families, at most three seats per model: degraded mode, set on chain by the operator while a family is down.",
    );
  });
});

/** A bundle shaped like the engine writes one: the conversation as sent. */
function messageProof(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-seat-3",
    jurySeatId: SEAT_IDS[2],
    revealed: true,
    bundle: {
      request: {
        messages: [
          { role: "system", content: "the pinned prompt" },
          { role: "user", content: JSON.stringify({ claim: "the claim" }) },
          {
            role: "assistant",
            content: JSON.stringify({
              action: "search",
              intent: "challenge",
              query: "ten percent brain myth",
            }),
          },
          {
            role: "user",
            content: JSON.stringify({
              tool: "search",
              results: [
                { n: 1, url: "https://mcgovern.mit.edu/a", title: "MIT" },
                { n: 2, url: "https://www.apa.org/b", title: "APA" },
              ],
            }),
          },
          {
            role: "assistant",
            content: JSON.stringify({
              action: "open",
              urls: ["https://mcgovern.mit.edu/a", "https://www.apa.org/b"],
            }),
          },
          {
            role: "user",
            content: JSON.stringify({
              tool: "open_many",
              pages: [
                { url: "https://mcgovern.mit.edu/a", ref: "p1" },
                { url: "https://www.apa.org/b", ref: "p2" },
              ],
            }),
          },
        ],
      },
      transcript: {
        steps: [
          { turn: 1, completedAtMs: START_MS + 11_000, action: { action: "search" }, result: {} },
          { turn: 2, completedAtMs: START_MS + 21_000, action: { action: "open" }, result: {} },
          { turn: 2, completedAtMs: START_MS + 22_000, action: { action: "open" }, result: {} },
        ],
      },
      audit: { completedAtMs: START_MS + 30_000 },
      validatedOutput: { outcome: "NO", confidenceBps: 9_500 },
    },
    ...overrides,
  };
}

describe("steps rebuilt from a run proof", () => {
  it("reads the conversation the bundle recorded, with the transcript's times", () => {
    expect(stepsFromRunProof(messageProof(), { seatId: SEAT_IDS[2]! })).toEqual([
      {
        seatId: SEAT_IDS[2],
        ordinal: 0,
        kind: "search",
        intent: "challenge",
        query: "ten percent brain myth",
        domains: ["mcgovern.mit.edu", "apa.org"],
        atMs: START_MS + 11_000,
        runId: "run-seat-3",
      },
      {
        seatId: SEAT_IDS[2],
        ordinal: 1,
        kind: "open",
        domains: ["mcgovern.mit.edu", "apa.org"],
        pageCount: 2,
        // A batched open keeps the last of its steps' times.
        atMs: START_MS + 22_000,
        runId: "run-seat-3",
      },
      {
        seatId: SEAT_IDS[2],
        ordinal: 2,
        kind: "answer",
        domains: [],
        // The answer lives in validatedOutput, so it takes the run's own time.
        atMs: START_MS + 30_000,
        runId: "run-seat-3",
      },
    ]);
  });

  it("falls back to the sealed transcript for a bundle with no messages", () => {
    const proof = {
      runId: "run-legacy",
      jurySeatId: SEAT_IDS[0],
      bundle: {
        transcript: {
          steps: [
            {
              turn: 1,
              completedAtMs: START_MS + 5_000,
              action: { action: "search", intent: "support", query: "a query" },
              result: { results: [{ url: "https://mit.edu/x" }] },
            },
            {
              turn: 2,
              completedAtMs: START_MS + 6_000,
              action: { action: "open", urls: ["https://mit.edu/x", "https://apa.org/y"] },
              result: { url: "https://mit.edu/x" },
            },
            {
              turn: 2,
              completedAtMs: START_MS + 7_000,
              action: { action: "open", urls: ["https://mit.edu/x", "https://apa.org/y"] },
              result: { url: "https://apa.org/y" },
            },
          ],
        },
        audit: { completedAtMs: START_MS + 9_000 },
      },
    };

    // The transcript records one step per page; the trail is one open again.
    expect(stepsFromRunProof(proof, { seatId: SEAT_IDS[0]! })).toEqual([
      {
        seatId: SEAT_IDS[0],
        ordinal: 0,
        kind: "search",
        intent: "support",
        query: "a query",
        domains: ["mit.edu"],
        atMs: START_MS + 5_000,
        runId: "run-legacy",
      },
      {
        seatId: SEAT_IDS[0],
        ordinal: 1,
        kind: "open",
        domains: ["mit.edu", "apa.org"],
        pageCount: 2,
        atMs: START_MS + 7_000,
        runId: "run-legacy",
      },
    ]);
  });

  it("says nothing for a sealed run, a table vote or a missing bundle", () => {
    expect(stepsFromRunProof({ bundle: null }, { seatId: "seat-1" })).toEqual([]);
    expect(stepsFromRunProof(undefined, { seatId: "seat-1" })).toEqual([]);
    expect(
      stepsFromRunProof({ bundle: { request: {}, audit: {} } }, { seatId: "seat-1" }),
    ).toEqual([]);
  });

  it("rebuilds the demo claim's trail from its real run proof", () => {
    const path = fileURLToPath(new URL("../ov/__fixtures__/trace-proof-research.json", import.meta.url));
    const proof: unknown = JSON.parse(readFileSync(path, "utf8"));

    expect(
      stepsFromRunProof(proof, { seatId: "seat-1" }).map((step) => [
        step.kind,
        step.intent ?? step.pageCount,
        step.domains.join(", "),
      ]),
    ).toEqual([
      ["search", "challenge", "mcgovern.mit.edu, psychologicalscience.org, en.wikipedia.org"],
      ["open", 3, "mcgovern.mit.edu, psychologicalscience.org, en.wikipedia.org"],
      ["search", "support", "pmc.ncbi.nlm.nih.gov, today.duke.edu, apa.org"],
      ["open", 2, "apa.org, pmc.ncbi.nlm.nih.gov"],
      ["answer", undefined, ""],
    ]);
  });

  it("fills a card from the proof only when the feed saw nothing", () => {
    const withProof = buildTranscript({
      claim: inspection(),
      events: stream(),
      proofs: [messageProof()],
    });
    // Seat 3 has live steps: the proof adds nothing on top of them.
    expect(withProof.jurors[2]?.steps.map((step) => step.kind)).toEqual([
      "search",
      "open",
      "answer",
    ]);
    // The live search carries the sites the event named, not the bundle's.
    expect(withProof.jurors[2]?.steps[0]?.domains).toEqual(["mit.edu"]);

    const noEvents = buildTranscript({
      claim: inspection(),
      events: stream().filter((event) => event.kind !== "research_step"),
      proofs: [messageProof()],
    });
    expect(noEvents.jurors[2]?.steps.map((step) => step.kind)).toEqual([
      "search",
      "open",
      "answer",
    ]);
    expect(noEvents.jurors[2]?.steps[0]?.domains).toEqual(["mcgovern.mit.edu", "apa.org"]);
    // The rebuilt steps drive the status line the same way live ones do.
    expect(jurorAt(noEvents.jurors[2]!, START_MS + 21_500).status).toBe(
      "searching for evidence against the claim",
    );
  });
});

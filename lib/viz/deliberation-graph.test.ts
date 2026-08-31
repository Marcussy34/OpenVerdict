import { describe, expect, it } from "vitest";

import type { ClaimInspection, ResolutionEvent } from "../engine/contract";
import { CLAIM_MODE, CLAIM_STATE } from "../protocol/constants";
import {
  buildDeliberationGraph,
  familyOfModelId,
} from "./deliberation-graph";

const RESEARCH_START_MS = Date.parse("2026-08-31T00:00:00.000Z");
const NOW_MS = RESEARCH_START_MS + 60_000;
const SEAT_IDS = Array.from({ length: 5 }, (_, index) => `jury-seat-${index + 1}`);

function inspection(
  overrides: Partial<ClaimInspection> = {},
): ClaimInspection {
  return {
    claimId: "claim-1",
    mode: CLAIM_MODE.DIRECT_REVIEW,
    state: CLAIM_STATE.COMMIT_1,
    statement: "The tariff claim is true as written.",
    resolutionCriteria: "Resolve from primary sources.",
    deadlines: {
      evidenceCutoffMs: RESEARCH_START_MS,
      proposalDeadlineMs: RESEARCH_START_MS + 1_000,
      challengeDeadlineMs: RESEARCH_START_MS + 2_000,
      firstCommitDeadlineMs: RESEARCH_START_MS + 20_000,
      firstRevealDeadlineMs: RESEARCH_START_MS + 30_000,
      discussionDeadlineMs: RESEARCH_START_MS + 40_000,
      secondCommitDeadlineMs: RESEARCH_START_MS + 50_000,
      secondRevealDeadlineMs: RESEARCH_START_MS + 60_000,
    },
    committeeId: "committee-1",
    evidenceRoots: [],
    commitments: SEAT_IDS.map((jurySeatId, index) => ({
      jurySeatId,
      agentProfileId: `agent-${index + 1}`,
      committed: false,
      revealed: false,
    })),
    ...overrides,
  };
}

function resolutionEvent(input: {
  sequence: number;
  kind: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  source?: ResolutionEvent["source"];
  visibility?: ResolutionEvent["visibility"];
  actorId?: string;
  runId?: string;
}): ResolutionEvent {
  return {
    eventId: `event-${input.sequence}`,
    claimId: "claim-1",
    sequence: input.sequence,
    phase: "INFERENCE_1",
    kind: input.kind,
    source: input.source ?? "ENGINE",
    visibility: input.visibility ?? "PUBLIC_NOW",
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    occurredAt: new Date(input.occurredAtMs).toISOString(),
    payload: input.payload,
  };
}

function revealedProof() {
  const url = "https://commerce.example/tariffs";
  const evidenceId = "evidence-1";
  return {
    runId: "run-1",
    jurySeatId: SEAT_IDS[0]!,
    revealed: true,
    transcript: {
      version: 1,
      steps: [
        {
          index: 0,
          turn: 1,
          startedAtMs: 10,
          completedAtMs: 11,
          modelRequestId: "request-1",
          action: {
            action: "search",
            query: "Section 232 tariff primary source",
            intent: "support",
          },
          result: {
            tool: "search",
            cached: false,
            resultsHash: "0xsearch",
            results: [{ rank: 1, url, title: "Tariff record", snippet: "Record." }],
          },
        },
        {
          index: 1,
          turn: 2,
          startedAtMs: 12,
          completedAtMs: 13,
          modelRequestId: "request-2",
          action: { action: "open", url, from: 0 },
          result: {
            tool: "open",
            cached: false,
            evidenceId,
            origin: "SEARCH",
            from: 0,
            chars: 300,
            totalChars: 300,
            contentHash: "0xcontent",
            canonicalWalrusBlobId: "walrus-page-1",
          },
        },
        {
          index: 2,
          turn: 3,
          startedAtMs: 14,
          completedAtMs: 15,
          modelRequestId: "request-3",
          action: { action: "answer", output: { outcome: "YES" } },
          result: { tool: "answer", valid: true, errors: [] },
        },
      ],
      opened: [
        {
          evidenceId,
          ref: "p1",
          url,
          finalUrl: url,
          origin: "SEARCH",
          title: "Tariff record",
          contentHash: "0xcontent",
          canonicalHash: "0xcontent",
          canonicalWalrusBlobId: "walrus-page-1",
          totalChars: 300,
          truncated: false,
        },
      ],
      citations: [
        {
          evidenceId,
          url,
          quote: "The official tariff record confirms the measure.",
          found: true,
        },
      ],
    },
    output: {
      outcome: "YES",
      confidenceBps: 9_525,
      evidenceFor: [evidenceId],
      evidenceAgainst: [],
      unsupportedClaims: [],
      decisiveEvidence: [evidenceId],
      reasoning: "The official record supports the claim.",
      publicReasoningTrace: [],
      citations: [
        {
          evidenceId,
          url,
          quote: "The official tariff record confirms the measure.",
        },
      ],
    },
  };
}

describe("deliberation graph", () => {
  it("builds a claim and five jurors from a bare inspection", () => {
    const graph = buildDeliberationGraph({
      claim: inspection(),
      nowMs: NOW_MS,
    });

    expect(graph.nodes.find((node) => node.id === "claim")?.kind).toBe("claim");
    expect(
      graph.nodes.filter((node) => node.kind === "juror").map((node) => node.id),
    ).toEqual(SEAT_IDS.map((seatId) => `seat:${seatId}`));
    expect(
      graph.edges.filter((edge) => edge.kind === "seat").map((edge) => edge.to),
    ).toEqual(SEAT_IDS.map((seatId) => `seat:${seatId}`));
  });

  it("turns a revealed proof into search, page, verdict, result, and citation links", () => {
    const proof = revealedProof();
    const graph = buildDeliberationGraph({
      claim: inspection(),
      proofs: [proof],
      nowMs: NOW_MS,
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "step:run-1:0",
          kind: "search",
          intent: "support",
          stepIndex: 0,
        }),
        expect.objectContaining({
          id: "step:run-1:1",
          kind: "page",
          url: "https://commerce.example/tariffs",
          stepIndex: 1,
        }),
        expect.objectContaining({
          id: "verdict:run-1",
          kind: "verdict",
          outcome: "YES",
          confidenceBps: 9_525,
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "step:run-1:0",
          to: "step:run-1:1",
          kind: "result",
        }),
        expect.objectContaining({
          from: "step:run-1:1",
          to: "verdict:run-1",
          kind: "citation",
        }),
      ]),
    );
  });

  it("matches each batched page only to its own search result and citations", () => {
    const supportUrl = "https://support.example/report";
    const challengeUrl = "https://challenge.example/report";
    const proof = {
      runId: "run-batch",
      jurySeatId: SEAT_IDS[0]!,
      revealed: true,
      transcript: {
        steps: [
          {
            index: 0,
            action: { action: "search", query: "support", intent: "support" },
            result: { tool: "search", results: [{ url: supportUrl }] },
          },
          {
            index: 1,
            action: { action: "search", query: "challenge", intent: "challenge" },
            result: { tool: "search", results: [{ url: challengeUrl }] },
          },
          {
            index: 2,
            batch: { size: 2, position: 1 },
            action: { action: "open", urls: [supportUrl, challengeUrl], from: 0 },
            result: { tool: "open", evidenceId: "support-evidence" },
          },
          {
            index: 3,
            batch: { size: 2, position: 2 },
            action: { action: "open", urls: [supportUrl, challengeUrl], from: 0 },
            result: { tool: "open", evidenceId: "challenge-evidence" },
          },
        ],
        opened: [
          {
            evidenceId: "support-evidence",
            ref: "p1",
            url: supportUrl,
            finalUrl: supportUrl,
            title: "Support report",
          },
          {
            evidenceId: "challenge-evidence",
            ref: "p2",
            url: challengeUrl,
            finalUrl: challengeUrl,
            title: "Challenge report",
          },
        ],
        citations: [{ evidenceId: "support-evidence", url: supportUrl }],
      },
      output: {
        outcome: "YES",
        confidenceBps: 8_000,
        citations: [{ evidenceId: "support-evidence", url: supportUrl }],
      },
    };

    const graph = buildDeliberationGraph({
      claim: inspection(),
      proofs: [proof],
      nowMs: NOW_MS,
    });

    expect(
      graph.edges
        .filter((edge) => edge.kind === "result")
        .map((edge) => `${edge.from}->${edge.to}`),
    ).toEqual([
      "step:run-batch:0->step:run-batch:2",
      "step:run-batch:1->step:run-batch:3",
    ]);
    // Every search is its own branch from the juror; steps never chain.
    expect(
      graph.edges
        .filter((edge) => edge.kind === "action" && edge.from.startsWith("seat:"))
        .map((edge) => edge.to),
    ).toEqual(["step:run-batch:0", "step:run-batch:1"]);
    expect(
      graph.edges.some(
        (edge) => edge.from === "step:run-batch:0" && edge.to === "step:run-batch:1",
      ),
    ).toBe(false);
    expect(
      graph.edges
        .filter((edge) => edge.kind === "citation")
        .map((edge) => edge.from),
    ).toEqual(["step:run-batch:2"]);
  });

  it("adds a failure node for a failed seat", () => {
    const claim = inspection({
      commitments: inspection().commitments.map((commitment, index) =>
        index === 2
          ? { ...commitment, failureStatus: "INVALID_SCHEMA" }
          : commitment,
      ),
    });
    const graph = buildDeliberationGraph({ claim, nowMs: NOW_MS });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `failure:${SEAT_IDS[2]}`,
          kind: "failure",
          seatId: SEAT_IDS[2],
        }),
        expect.objectContaining({
          id: `seat:${SEAT_IDS[2]}`,
          state: "failed",
        }),
      ]),
    );
  });

  it("replaces sealed ticks with revealed steps at the same time", () => {
    const tick = resolutionEvent({
      sequence: 1,
      kind: "RESEARCH_TICK",
      occurredAtMs: RESEARCH_START_MS + 4_000,
      runId: "run-1",
      payload: {
        jurySeatId: SEAT_IDS[0],
        kind: "search",
        ordinal: 0,
      },
    });
    const sealed = buildDeliberationGraph({
      claim: inspection(),
      events: [tick],
      nowMs: NOW_MS,
    });
    const revealed = buildDeliberationGraph({
      claim: inspection(),
      proofs: [revealedProof()],
      events: [tick],
      nowMs: NOW_MS,
    });

    const tickNode = sealed.nodes.find(
      (node) => node.id === `tick:${SEAT_IDS[0]}:0`,
    );
    expect(tickNode).toMatchObject({ kind: "sealedAction" });
    expect(revealed.nodes.some((node) => node.kind === "sealedAction")).toBe(false);
    expect(revealed.nodes.find((node) => node.id === "step:run-1:0")?.atMs).toBe(
      tickNode?.atMs,
    );
  });

  it("is deterministic and assigns finite times to every node", () => {
    const claim = inspection({
      result: {
        claimId: "claim-1",
        result: "YES",
        truthScoreBps: 9_525,
        certificateId: "certificate-1",
        digest: "transaction-1",
      },
    });
    const input = {
      claim,
      proofs: [revealedProof()],
      nowMs: NOW_MS,
    };

    const first = buildDeliberationGraph(input);
    const second = buildDeliberationGraph(input);

    expect(second).toEqual(first);
    expect(first.nodes.find((node) => node.id === "certificate")?.kind).toBe(
      "certificate",
    );
    expect(first.nodes.every((node) => Number.isFinite(node.atMs))).toBe(true);
  });

  it("interpolates pre-tick research steps monotonically across the research window", () => {
    const commitAtMs = RESEARCH_START_MS + 12_000;
    const graph = buildDeliberationGraph({
      claim: inspection(),
      proofs: [revealedProof()],
      events: [
        resolutionEvent({
          sequence: 1,
          kind: "vote_committed",
          occurredAtMs: commitAtMs,
          source: "SUI",
          payload: { jury_seat_id: SEAT_IDS[0] },
        }),
      ],
      nowMs: NOW_MS,
    });
    const times = graph.nodes
      .filter((node) => node.runId === "run-1" && node.stepIndex !== undefined)
      .sort((left, right) => left.stepIndex! - right.stepIndex!)
      .map((node) => node.atMs);

    expect(times).toHaveLength(2);
    expect(times[0]).toBeGreaterThanOrEqual(RESEARCH_START_MS);
    expect(times[1]).toBeGreaterThan(times[0]!);
    expect(times[1]).toBeLessThanOrEqual(commitAtMs);
  });

  it("maps supported model ids to stable juror families", () => {
    expect(familyOfModelId("deepseek-ai/DeepSeek-V3")).toBe("deepseek");
    expect(familyOfModelId("moonshotai/Kimi-K2")).toBe("kimi");
    expect(familyOfModelId("MiniMaxAI/MiniMax-M2")).toBe("minimax");
    expect(familyOfModelId("other/model")).toBe("unknown");
    expect(familyOfModelId(undefined)).toBe("unknown");
  });

  it("resolves juror family from the commitment's model id without any events", () => {
    const claim = inspection();
    claim.commitments = claim.commitments.map((commitment, index) =>
      index === 0 ? { ...commitment, modelId: "moonshotai/Kimi-K2.5" } : commitment,
    );
    const graph = buildDeliberationGraph({ claim, nowMs: NOW_MS });
    const withModel = graph.nodes.find((node) => node.id === `seat:${SEAT_IDS[0]}`);
    expect(withModel?.family).toBe("kimi");
    const withoutModel = graph.nodes.find((node) => node.id === `seat:${SEAT_IDS[1]}`);
    expect(withoutModel?.family).toBe("unknown");
  });
});

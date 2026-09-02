import type { TableVoteInput } from "./types";

/** Build a minimal table-vote input shared by protocol tests. */
export function sampleTableVoteInput(): TableVoteInput {
  return {
    protocolVersion: "1.0",
    kind: "TABLE_VOTE",
    runId: `0x${"31".repeat(32)}`,
    agentRole: "independent-verifier",
    claim: {
      statement: "The statement is true.",
      resolutionCriteria: "Use the frozen evidence.",
    },
    evidenceManifest: {
      root: `0x${"32".repeat(32)}`,
      items: [
        {
          evidenceId: "evidence-table-1",
          sourceClass: "PRIMARY",
          retrievedAt: "2026-09-02T00:00:00.000Z",
          walrusBlobId: "walrus-table-1",
          contentHash: `0x${"33".repeat(32)}`,
          excerpt: "The frozen source supports the claim.",
        },
      ],
    },
    priorRound: {
      phase: 1,
      seats: [
        {
          seatIndex: 0,
          modelId: "vendor/model-a",
          outcome: "YES",
          confidenceBps: 8_500,
          publicReasoningTrace: [
            {
              check: "Compare the statement with the source.",
              evidenceIds: ["evidence-table-1"],
              assessment: "SUPPORTS",
              finding: "The source supports the statement.",
            },
          ],
        },
      ],
    },
    debate: [
      {
        seat: 0,
        exchange: 1,
        argument: "The frozen source directly supports the statement.",
        citations: ["evidence-table-1"],
        stance: "YES",
        confidenceBps: 8_500,
      },
    ],
    convergedAfterExchange: null,
    self: {
      seatIndex: 0,
      role: "independent-verifier",
      roundOneOutcome: "YES",
      roundOneConfidenceBps: 8_500,
      roundOneOutput: {
        outcome: "YES",
        confidenceBps: 8_500,
        evidenceFor: ["evidence-table-1"],
        evidenceAgainst: [],
        unsupportedClaims: [],
        decisiveEvidence: ["evidence-table-1"],
        reasoning: "The frozen evidence supports the statement.",
        publicReasoningTrace: [
          {
            check: "Compare the statement with the source.",
            evidenceIds: ["evidence-table-1"],
            assessment: "SUPPORTS",
            finding: "The source supports the statement.",
          },
        ],
      },
    },
    outputContract: {
      requiredOutcome: true,
      requiredEvidenceIds: true,
      maximumReasonLength: 1200,
    },
  };
}

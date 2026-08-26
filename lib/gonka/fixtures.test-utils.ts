import type {
  AgentManifest,
  OracleInferenceInput,
  OracleInferenceOutput,
} from "../protocol/types";

export const AGENT_ID = `0x${"11".repeat(32)}` as const;

export function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    agentProfileId: AGENT_ID,
    owner: `0x${"12".repeat(32)}`,
    humanAttestationHash: `0x${"13".repeat(32)}`,
    humanVerificationProvider: "manual-demo",
    version: "1.0.0",
    manifestBlobId: "manifest-blob",
    manifestHash: `0x${"14".repeat(32)}`,
    promptHash: `0x${"15".repeat(32)}`,
    modelId: "vendor/model-a",
    providerId: "gonkarouter",
    toolPolicyHash: `0x${"16".repeat(32)}`,
    evidencePolicyHash: `0x${"17".repeat(32)}`,
    publicKey: "demo-public-key",
    registeredAtMs: 1,
    registeredCheckpoint: 2,
    ...overrides,
  };
}

export function makeInput(
  overrides: Partial<OracleInferenceInput> = {},
): OracleInferenceInput {
  return {
    protocolVersion: "1.0",
    runId: `0x${"21".repeat(32)}`,
    agentRole: "independent-verifier",
    promptVersion: "prompt-v1",
    submission: {
      kind: "TEXT",
      submittedTextHash: `0x${"22".repeat(32)}`,
      submittedUrls: [],
    },
    claim: {
      statement: "The statement is true.",
      resolutionCriteria: "Use the frozen evidence.",
      outcomes: ["YES", "NO", "UNSURE"],
      relevantDeadline: "2026-08-26T00:00:00.000Z",
    },
    evidenceManifest: {
      root: `0x${"23".repeat(32)}`,
      items: [
        {
          evidenceId: "evidence-1",
          sourceClass: "PRIMARY",
          retrievedAt: "2026-08-25T00:00:00.000Z",
          walrusBlobId: "walrus-1",
          contentHash: `0x${"24".repeat(32)}`,
          excerpt: "The frozen source supports the claim.",
        },
        {
          evidenceId: "evidence-2",
          sourceClass: "PRIMARY",
          retrievedAt: "2026-08-25T00:00:01.000Z",
          walrusBlobId: "walrus-2",
          contentHash: `0x${"25".repeat(32)}`,
          excerpt: "A second frozen source.",
        },
      ],
    },
    outputContract: {
      requiredOutcome: true,
      requiredEvidenceIds: true,
      maximumReasonLength: 4_000,
    },
    ...overrides,
  };
}

export function makeOutput(
  overrides: Partial<OracleInferenceOutput> = {},
): OracleInferenceOutput {
  return {
    outcome: "YES",
    confidenceBps: 8_500,
    evidenceFor: ["evidence-1"],
    evidenceAgainst: ["evidence-2"],
    unsupportedClaims: [],
    decisiveEvidence: ["evidence-1"],
    reasoning: "The frozen evidence supports the statement.",
    publicReasoningTrace: [
      {
        check: "Compare the statement with the source.",
        evidenceIds: ["evidence-1"],
        assessment: "SUPPORTS",
        finding: "The source directly supports the statement.",
      },
    ],
    ...overrides,
  };
}

export function completionBody(
  output: unknown = makeOutput(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "msg_valid_1",
    object: "chat.completion",
    created: 1,
    model: "vendor/model-a",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: typeof output === "string" ? output : JSON.stringify(output),
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    ...overrides,
  };
}

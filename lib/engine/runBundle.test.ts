import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
  composeSystemPrompt,
  promptSpecHash,
  toolPolicyHash,
} from "../gonka/promptSpec";
import { canonicalJsonBytes } from "../gonka/canonical";
import { EMPTY_TOOL_TRANSCRIPT_HASH } from "../gonka/audit";
import { blake2b256, toHex } from "../protocol";
import { sampleTableVoteInput } from "../protocol/table-vote.fixture";
import type {
  PublicRunBundleCoreV3,
  PublicRunBundleCoreV4,
  PublicRunBundleCoreV5,
  ResearchTranscriptV1,
} from "../protocol/types";
import { transcriptHash } from "../research";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import type { GonkaRunResult } from "../gonka/types";
import {
  buildRunBundleCore,
  buildTableVoteBundleCore,
  canonicalCoreBytes,
  openSealedRunBundle,
  sealRunBundle,
} from "./runBundle";

function makeCore(): PublicRunBundleCoreV3 {
  const runId = `0x${"01".repeat(32)}` as const;
  const claimId = `0x${"02".repeat(32)}` as const;
  const agentProfileId = `0x${"03".repeat(32)}` as const;
  const jurySeatId = `0x${"04".repeat(32)}` as const;
  const input = makeInput({ runId, promptVersion: "2" });
  const validatedOutput = makeOutput();
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const boundPromptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V2);
  const boundToolPolicyHash = toolPolicyHash(DEFAULT_TOOL_POLICY_V2);
  const runHash = `0x${"05".repeat(32)}` as const;
  const transcript: ResearchTranscriptV1 = {
    version: 1,
    runId,
    provider: { name: "fake", mode: "fake" },
    policyHash: boundToolPolicyHash,
    steps: [],
    opened: [],
    citations: [],
    counts: { searches: 0, opens: 0, turns: 1 },
  };

  return {
    version: 3,
    kind: "run-bundle",
    runId,
    claimId,
    phase: 1,
    agentProfileId,
    jurySeatId,
    promptSpec: DEFAULT_PROMPT_SPEC_V2,
    promptHash: boundPromptHash,
    toolPolicy: DEFAULT_TOOL_POLICY_V2,
    toolPolicyHash: boundToolPolicyHash,
    transcript,
    input,
    inputHash,
    request: {
      model: "vendor/model-a",
      temperature: 0,
      maxTokens: 4096,
      responseFormat: "json_object",
      attemptKind: "PRIMARY",
      messages: [
        {
          role: "system",
          content: composeSystemPrompt(
            DEFAULT_PROMPT_SPEC_V2,
            DEFAULT_TOOL_POLICY_V2,
          ),
        },
        {
          role: "user",
          content: new TextDecoder().decode(canonicalJsonBytes(input)),
        },
      ],
    },
    attempts: [],
    rawResponse: { id: "devshard-65702-400" },
    gateway: {
      gatewayRequestId: "request-1",
      devshardId: "devshard-65702",
      systemFingerprint: "fingerprint-1",
    },
    validatedOutput,
    outputHash,
    audit: {
      runId,
      claimObjectId: claimId,
      agentProfileId,
      jurySeatId,
      phase: 1,
      attempt: 1,
      providerId: "gonkarouter",
      modelId: "vendor/model-a",
      responseModelId: "vendor/model-a",
      gonkaRequestId: "devshard-65702-400",
      promptHash: boundPromptHash,
      inputHash,
      outputHash,
      runWalrusBlobId: "",
      toolTranscriptHash: transcriptHash(transcript),
      toolTranscriptWalrusBlobId: "tool-blob",
      toolCallCount: 0,
      evidenceRoot: `0x${"07".repeat(32)}`,
      requestedAtMs: 1,
      completedAtMs: 2,
      latencyMs: 1,
      gatewayRequestId: "request-1",
      devshardId: "devshard-65702",
      systemFingerprint: "fingerprint-1",
      status: "SCHEMA_VALID",
    },
    runHash,
    verify: {
      promptHash: "blake2b256(canonicalJson(promptSpec))",
      toolPolicyHash: "blake2b256(canonicalJson(toolPolicy))",
      inputHash: "blake2b256(canonicalJson(input))",
      outputHash: "blake2b256(canonicalJson(validatedOutput))",
      toolTranscriptHash: "blake2b256(canonicalJson(transcript))",
      systemPrompt:
        "promptSpec.systemPrompt + '\\n' + canonicalJson({budgets: toolPolicy})",
      runHash: "blake2b256(BCS(RunRecordV1))",
      commitment: "blake2b256(BCS(VotePreimageV1))",
    },
  };
}

describe("run bundle sealing", () => {
  it("builds the core from the final run envelope and audit hashes", () => {
    const expected = makeCore();
    const runResult: GonkaRunResult = {
      type: "gonka-run-result",
      attempts: [],
      response: expected.rawResponse,
      request: expected.request,
      gateway: expected.gateway,
    };
    expect(
      buildRunBundleCore({
        promptSpec: expected.promptSpec,
        toolPolicy: expected.toolPolicy,
        input: expected.input,
        runResult,
        validatedOutput: expected.validatedOutput,
        audit: expected.audit,
        runHash: expected.runHash,
        transcript: expected.transcript,
      }),
    ).toEqual(expected);
    expect(expected.verify.toolTranscriptHash).toBe(
      "blake2b256(canonicalJson(transcript))",
    );
  });

  it("builds a v4 core from a v3 prompt and policy", () => {
    const expected = makeCore();
    const runResult: GonkaRunResult = {
      type: "gonka-run-result",
      attempts: [],
      response: expected.rawResponse,
      request: {
        ...expected.request,
        messages: [
          {
            role: "system",
            content: composeSystemPrompt(
              DEFAULT_PROMPT_SPEC_V3,
              DEFAULT_TOOL_POLICY_V3,
            ),
          },
          ...expected.request.messages.slice(1),
        ],
      },
      gateway: expected.gateway,
    };
    const core = buildRunBundleCore({
      promptSpec: DEFAULT_PROMPT_SPEC_V3,
      toolPolicy: DEFAULT_TOOL_POLICY_V3,
      input: { ...expected.input, promptVersion: "3" },
      runResult,
      validatedOutput: expected.validatedOutput,
      audit: {
        ...expected.audit,
        promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V3),
      },
      runHash: expected.runHash,
      transcript: {
        ...expected.transcript,
        policyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V3),
        counts: {
          ...expected.transcript.counts,
          challengeSearches: 0,
        },
      },
    });

    expect(core.version).toBe(4);
    expect((core as PublicRunBundleCoreV4).promptSpec.version).toBe("3");
    expect((core as PublicRunBundleCoreV4).toolPolicy.version).toBe("3");
  });

  it("builds a v5 core from a v4 prompt and policy", () => {
    const expected = makeCore();
    const runResult: GonkaRunResult = {
      type: "gonka-run-result",
      attempts: [],
      response: expected.rawResponse,
      request: {
        ...expected.request,
        messages: [
          {
            role: "system",
            content: composeSystemPrompt(
              DEFAULT_PROMPT_SPEC_V4,
              DEFAULT_TOOL_POLICY_V4,
            ),
          },
          ...expected.request.messages.slice(1),
        ],
      },
      gateway: expected.gateway,
    };
    const core = buildRunBundleCore({
      promptSpec: DEFAULT_PROMPT_SPEC_V4,
      toolPolicy: DEFAULT_TOOL_POLICY_V4,
      input: { ...expected.input, promptVersion: "4" },
      runResult,
      validatedOutput: expected.validatedOutput,
      audit: {
        ...expected.audit,
        promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V4),
      },
      runHash: expected.runHash,
      transcript: {
        ...expected.transcript,
        policyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V4),
        counts: {
          ...expected.transcript.counts,
          challengeSearches: 0,
        },
      },
    });

    expect(core.version).toBe(5);
    expect((core as PublicRunBundleCoreV5).promptSpec.version).toBe("4");
    expect((core as PublicRunBundleCoreV5).toolPolicy.version).toBe("4");
    expect((core as PublicRunBundleCoreV5).toolPolicy.maxOpensPerTurn).toBe(3);
  });

  it("builds, seals and reopens a v6 table vote bundle with no transcript", () => {
    const expected = makeCore();
    const sampleRunResult: GonkaRunResult = {
      type: "gonka-run-result",
      attempts: [],
      response: expected.rawResponse,
      request: expected.request,
      gateway: expected.gateway,
    };
    const core = buildTableVoteBundleCore({
      input: sampleTableVoteInput(),
      runResult: sampleRunResult,
      validatedOutput: makeOutput(),
      audit: {
        ...expected.audit,
        phase: 2,
        toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
        toolCallCount: 0,
      },
      runHash: expected.runHash,
      promptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
    });
    expect(core.version).toBe(6);
    expect("toolPolicy" in core).toBe(false);
    expect("transcript" in core).toBe(false);
    expect(core.verify.systemPrompt).toBe("promptSpec.systemPrompt");
    const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
    expect(openSealedRunBundle(sealed, seal)).toEqual(core);
  });

  it("round-trips through AES-256-GCM and binds the core hash", () => {
    const core = makeCore();
    const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
    expect(sealed.kind).toBe("sealed-run-bundle");
    expect(sealed.coreHash).toBe(
      toHex(blake2b256(canonicalCoreBytes(core))),
    );
    expect(seal.keyHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(openSealedRunBundle(sealed, seal)).toEqual(core);
  });

  it("rejects a wrong key and a tampered ciphertext", () => {
    const core = makeCore();
    const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
    expect(() =>
      openSealedRunBundle(sealed, {
        ...seal,
        keyHex: `0x${"00".repeat(32)}`,
      }),
    ).toThrow();
    const tampered = {
      ...sealed,
      ciphertextBase64: `${sealed.ciphertextBase64.slice(0, -4)}AAAA`,
    };
    expect(() => openSealedRunBundle(tampered, seal)).toThrow();
  });
});

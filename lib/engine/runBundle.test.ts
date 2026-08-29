import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_TOOL_POLICY_V2,
  composeSystemPrompt,
  promptSpecHash,
  toolPolicyHash,
} from "../gonka/promptSpec";
import { canonicalJsonBytes } from "../gonka/canonical";
import { blake2b256, toHex } from "../protocol";
import type {
  PublicRunBundleCoreV3,
  ResearchTranscriptV1,
} from "../protocol/types";
import { transcriptHash } from "../research";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import type { GonkaRunResult } from "../gonka/types";
import {
  buildRunBundleCore,
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

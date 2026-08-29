import { describe, expect, it } from "vitest";

import { canonicalJsonBytes } from "../gonka/canonical";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import {
  composeSystemPrompt,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_TOOL_POLICY_V2,
  promptSpecHash,
  toolPolicyHash,
} from "../gonka/promptSpec";
import { sealRunBundle } from "../engine/runBundle";
import { computeRunHash } from "../protocol/commitment";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import type {
  InferenceRunAudit,
  PublicRunBundleCoreV2,
  PublicRunBundleCoreV3,
  PublicRunBundleV2,
  PublicRunBundleV3,
  ResearchTranscriptV1,
} from "../protocol/types";
import {
  isV3Bundle,
  proofFromBundle,
  recomputeRunProof,
} from "./run-proof";

function runHashFromAudit(audit: InferenceRunAudit) {
  return toHex(
    computeRunHash({
      run_id: audit.runId,
      claim_object_id: audit.claimObjectId,
      agent_profile_id: audit.agentProfileId,
      jury_seat_id: audit.jurySeatId,
      phase: audit.phase,
      attempt: audit.attempt,
      provider_id: audit.providerId,
      model_id: audit.modelId,
      gonka_request_id: audit.gonkaRequestId,
      prompt_hash: fromHex(audit.promptHash),
      input_hash: fromHex(audit.inputHash),
      output_hash: fromHex(audit.outputHash),
      tool_transcript_hash: fromHex(audit.toolTranscriptHash),
      evidence_root: fromHex(audit.evidenceRoot),
      requested_at_ms: audit.requestedAtMs,
      completed_at_ms: audit.completedAtMs,
    }),
  );
}

function makeCore(): PublicRunBundleCoreV2 {
  const runId = `0x${"01".repeat(32)}` as const;
  const claimId = `0x${"02".repeat(32)}` as const;
  const agentProfileId = `0x${"03".repeat(32)}` as const;
  const jurySeatId = `0x${"04".repeat(32)}` as const;
  const input = makeInput({ runId });
  const validatedOutput = makeOutput();
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V1);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const audit: InferenceRunAudit = {
    runId,
    claimObjectId: claimId,
    agentProfileId,
    jurySeatId,
    phase: 1,
    attempt: 1,
    providerId: "gonkarouter",
    modelId: "vendor/model-a",
    gonkaRequestId: "devshard-1-1",
    promptHash,
    inputHash,
    outputHash,
    runWalrusBlobId: "sealed-blob",
    toolTranscriptHash: `0x${"05".repeat(32)}`,
    toolTranscriptWalrusBlobId: "tool-blob",
    toolCallCount: 0,
    evidenceRoot: `0x${"06".repeat(32)}`,
    requestedAtMs: 1,
    completedAtMs: 2,
    latencyMs: 1,
    status: "SCHEMA_VALID",
  };
  const runHash = runHashFromAudit(audit);

  return {
    version: 2,
    kind: "run-bundle",
    runId,
    claimId,
    phase: 1,
    agentProfileId,
    jurySeatId,
    promptSpec: DEFAULT_PROMPT_SPEC_V1,
    promptHash,
    input,
    inputHash,
    request: {
      model: audit.modelId,
      temperature: 0,
      maxTokens: 4096,
      responseFormat: "json_object",
      attemptKind: "PRIMARY",
      messages: [
        { role: "system", content: DEFAULT_PROMPT_SPEC_V1.systemPrompt },
        { role: "user", content: new TextDecoder().decode(canonicalJsonBytes(input)) },
      ],
    },
    attempts: [],
    rawResponse: { id: audit.gonkaRequestId },
    gateway: {},
    validatedOutput,
    outputHash,
    audit,
    runHash,
    verify: {
      promptHash: "blake2b256(canonicalJson(promptSpec))",
      inputHash: "blake2b256(canonicalJson(input))",
      outputHash: "blake2b256(canonicalJson(validatedOutput))",
      runHash: "blake2b256(BCS(RunRecordV1))",
      commitment: "blake2b256(BCS(VotePreimageV1))",
    },
  };
}

function makeProof() {
  const core = makeCore();
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV2 = {
    ...core,
    seal: { ...seal, sealedBlobId: "sealed-blob" },
  };
  return { proof: proofFromBundle(bundle, sealed), sealed };
}

function makeProofV3() {
  const base = makeCore();
  const url = "https://example.test/source";
  const evidenceId = "research-page-1";
  const citation = {
    evidenceId,
    url,
    quote: "The source directly supports the test claim.",
  };
  const policyHash = toolPolicyHash(DEFAULT_TOOL_POLICY_V2);
  const transcript: ResearchTranscriptV1 = {
    version: 1,
    runId: base.runId,
    provider: { name: "firecrawl", mode: "fake" },
    policyHash,
    steps: [
      {
        index: 0,
        turn: 1,
        startedAtMs: 10,
        completedAtMs: 11,
        modelRequestId: "research-turn-1",
        action: { action: "search", query: "OpenVerdict test claim" },
        result: {
          tool: "search",
          cached: false,
          resultsHash: `0x${"07".repeat(32)}`,
          results: [
            {
              rank: 1,
              url,
              title: "Primary source",
              snippet: "The source directly supports the test claim.",
            },
          ],
        },
      },
      {
        index: 1,
        turn: 2,
        startedAtMs: 12,
        completedAtMs: 13,
        modelRequestId: "research-turn-2",
        action: { action: "open", url, from: 0 },
        result: {
          tool: "open",
          cached: false,
          evidenceId,
          origin: "SEARCH",
          from: 0,
          chars: 400,
          totalChars: 400,
          contentHash: `0x${"08".repeat(32)}`,
          canonicalWalrusBlobId: "walrus-research-page-1",
        },
      },
    ],
    opened: [
      {
        evidenceId,
        ref: "p1",
        url,
        finalUrl: url,
        origin: "SEARCH",
        title: "Primary source",
        contentHash: `0x${"08".repeat(32)}`,
        canonicalHash: `0x${"09".repeat(32)}`,
        canonicalWalrusBlobId: "walrus-research-page-1",
        totalChars: 400,
        truncated: false,
      },
    ],
    citations: [{ ...citation, found: true }],
    counts: { searches: 1, opens: 1, turns: 2 },
  };
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V2);
  const validatedOutput = makeOutput({ citations: [citation] });
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const transcriptHash = toHex(blake2b256(canonicalJsonBytes(transcript)));
  const audit: InferenceRunAudit = {
    ...base.audit,
    promptHash,
    outputHash,
    toolTranscriptHash: transcriptHash,
    toolCallCount: 2,
  };
  const core: PublicRunBundleCoreV3 = {
    ...base,
    version: 3,
    promptSpec: DEFAULT_PROMPT_SPEC_V2,
    promptHash,
    toolPolicy: DEFAULT_TOOL_POLICY_V2,
    toolPolicyHash: policyHash,
    transcript,
    request: {
      ...base.request,
      messages: [
        {
          role: "system",
          content: composeSystemPrompt(DEFAULT_PROMPT_SPEC_V2, DEFAULT_TOOL_POLICY_V2),
        },
        ...base.request.messages.slice(1),
      ],
    },
    validatedOutput,
    outputHash,
    audit,
    runHash: runHashFromAudit(audit),
    verify: {
      ...base.verify,
      toolPolicyHash: "blake2b256(canonicalJson(toolPolicy))",
      toolTranscriptHash: "blake2b256(canonicalJson(transcript))",
      systemPrompt: "promptSpec.systemPrompt + '\\n' + canonicalJson({budgets: toolPolicy})",
    },
  };
  // Task 5 widens this engine helper; its runtime already serializes any core.
  const { sealed, seal } = sealRunBundle(
    core as unknown as PublicRunBundleCoreV2,
    { runId: core.runId },
  );
  const bundle: PublicRunBundleV3 = {
    ...core,
    seal: { ...seal, sealedBlobId: "sealed-blob" },
  };
  return { proof: proofFromBundle(bundle, sealed), sealed };
}

describe("browser run proof", () => {
  it("keeps verifying v2 bundles with five checks", async () => {
    const { proof } = makeProof();
    const checks = await recomputeRunProof(proof);
    expect(checks).toHaveLength(5);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("verifies a v3 bundle: nine checks all ok", async () => {
    const { proof } = makeProofV3();
    const checks = await recomputeRunProof(proof);
    expect(checks.map((check) => check.key)).toEqual([
      "promptHash",
      "toolPolicyHash",
      "systemPrompt",
      "inputHash",
      "outputHash",
      "toolTranscriptHash",
      "citations",
      "runHash",
      "sealedCore",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("fails altered transcript and unopened citation checks", async () => {
    const { proof } = makeProofV3();
    if (!proof.bundle || !isV3Bundle(proof.bundle)) {
      throw new Error("Expected a v3 bundle");
    }
    proof.bundle.transcript.steps[0]!.turn = 9;
    const altered = await recomputeRunProof(proof);
    expect(altered.find((check) => check.key === "toolTranscriptHash")?.ok).toBe(false);

    const { proof: unopenedProof } = makeProofV3();
    unopenedProof.bundle!.validatedOutput.citations = [
      {
        evidenceId: "not-opened",
        url: "https://x.test/",
        quote: "a".repeat(20),
      },
    ];
    const unopened = await recomputeRunProof(unopenedProof);
    expect(unopened.find((check) => check.key === "citations")?.ok).toBe(false);
  });

  it("rejects a tampered sealed ciphertext", async () => {
    const { proof, sealed } = makeProof();
    proof.sealed = {
      ...sealed,
      ciphertextBase64: `${sealed.ciphertextBase64.slice(0, -4)}AAAA`,
    };
    const checks = await recomputeRunProof(proof);
    expect(checks.slice(0, 4).every((check) => check.ok)).toBe(true);
    expect(checks.at(-1)?.ok).toBe(false);
  });

  it("handles a missing sealed field defensively", async () => {
    const { proof } = makeProof();
    delete proof.sealed;
    const checks = await recomputeRunProof(proof);
    expect(checks.slice(0, 4).every((check) => check.ok)).toBe(true);
    expect(checks.at(-1)).toMatchObject({
      key: "sealedCore",
      ok: false,
      detail: "The sealed bundle was not provided",
    });
  });
});

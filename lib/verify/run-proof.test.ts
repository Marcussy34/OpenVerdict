import { EncryptedObject } from "@mysten/seal";
import { toBase64 } from "@mysten/sui/utils";
import { describe, expect, it } from "vitest";

import { canonicalJsonBytes } from "../gonka/canonical";
import { EMPTY_TOOL_TRANSCRIPT_HASH } from "../gonka/audit";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import {
  composeSystemPrompt,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_PROMPT_SPEC_V5,
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
  promptSpecHash,
  toolPolicyHash,
} from "../gonka/promptSpec";
import { buildTableVoteBundleCore, sealRunBundle } from "../engine/runBundle";
import { computeRunHash } from "../protocol/commitment";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import { sampleTableVoteInput } from "../protocol/table-vote.fixture";
import { sealIdentityHex, sealInnerId } from "../seal/identity";
import type {
  InferenceRunAudit,
  PromptSpecV4,
  PromptSpecV5,
  PublicRunBundleCoreV2,
  PublicRunBundleCoreV3,
  PublicRunBundleCoreV4,
  PublicRunBundleCoreV5,
  PublicRunBundleCoreV6,
  PublicRunBundleV2,
  PublicRunBundleV3,
  PublicRunBundleV4,
  PublicRunBundleV5,
  PublicRunBundleV6,
  ResearchTranscriptV1,
  SealEscrowV1,
} from "../protocol/types";
import {
  isV3Bundle,
  isV4Bundle,
  isV5Bundle,
  isV6Bundle,
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

function makeEscrowProof() {
  const { proof } = makeProof();
  if (!proof.bundle || !proof.sealed) {
    throw new Error("Expected a revealed and sealed bundle");
  }
  const packageId = `0x${"71".repeat(32)}` as const;
  const keyServerId = `0x${"72".repeat(32)}` as const;
  const deadlineMs = Date.parse("2026-08-30T13:52:07.000Z");
  const identityHex = sealIdentityHex({
    claimId: proof.bundle.claimId,
    jurySeatId: proof.bundle.jurySeatId,
    phase: proof.bundle.phase,
    deadlineMs,
  });
  const encryptedObject = EncryptedObject.serialize({
    version: 0,
    packageId,
    id: sealInnerId(identityHex),
    services: [[keyServerId, 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96),
        encryptedShares: [new Uint8Array(32)],
        encryptedRandomness: new Uint8Array(32),
      },
    },
    ciphertext: {
      Aes256Gcm: {
        blob: new Uint8Array([1, 2, 3]),
        aad: new TextEncoder().encode(proof.runId),
      },
    },
  }).toBytes();
  const escrow: SealEscrowV1 = {
    version: 1,
    provider: "seal",
    packageId,
    identityHex,
    deadlineMs,
    threshold: 1,
    keyServers: [{ objectId: keyServerId, weight: 1 }],
    encryptedObjectBase64: toBase64(encryptedObject),
    aad: proof.runId,
  };
  proof.sealed.escrow = escrow;
  proof.claimDeadlines = {
    firstRevealDeadlineMs: deadlineMs,
    secondRevealDeadlineMs: deadlineMs + 1_000,
  };
  proof.sealPolicy = {
    packageId,
    threshold: 1,
    keyServers: escrow.keyServers,
  };
  return { proof, escrow };
}

function makeProofV3(repairs?: string[]) {
  const base = makeCore();
  const url = "https://example.test/source";
  const evidenceId = "research-page-1";
  const citation = {
    evidenceId,
    url,
    quote: "The source directly supports the test claim.",
  };
  const policyHash = toolPolicyHash(DEFAULT_TOOL_POLICY_V2);
  const validatedOutput = makeOutput({ citations: [citation] });
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
      ...(repairs === undefined
        ? []
        : [
            {
              index: 2,
              turn: 3,
              startedAtMs: 14,
              completedAtMs: 15,
              modelRequestId: "research-turn-3",
              action: { action: "answer" as const, output: validatedOutput },
              result: {
                tool: "answer" as const,
                valid: true,
                errors: [],
                repairs,
              },
            },
          ]),
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
    counts: { searches: 1, opens: 1, turns: repairs === undefined ? 2 : 3 },
  };
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V2);
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

function makeProofV4() {
  const base = makeCore();
  const supportUrl = "https://support.test/source";
  const challengeUrl = "https://challenge.test/source";
  const supportId = "research-support";
  const challengeId = "research-challenge";
  const citations = [
    {
      evidenceId: supportId,
      url: supportUrl,
      quote: "The official source supports the claim as stated.",
    },
    {
      evidenceId: challengeId,
      url: challengeUrl,
      quote: "The independent source records the strongest contrary evidence.",
    },
  ];
  const policyHash = toolPolicyHash(DEFAULT_TOOL_POLICY_V3);
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
        modelRequestId: "support-search",
        action: {
          action: "search",
          query: "official support",
          intent: "support",
        },
        result: {
          tool: "search",
          cached: false,
          resultsHash: `0x${"07".repeat(32)}`,
          results: [{
            rank: 1,
            url: supportUrl,
            title: "Official source",
            snippet: "The official source supports the claim as stated.",
          }],
        },
      },
      {
        index: 1,
        turn: 2,
        startedAtMs: 12,
        completedAtMs: 13,
        modelRequestId: "support-open",
        action: { action: "open", url: supportUrl, from: 0 },
        result: {
          tool: "open",
          cached: false,
          evidenceId: supportId,
          origin: "SEARCH",
          from: 0,
          chars: 200,
          totalChars: 200,
          contentHash: `0x${"08".repeat(32)}`,
          canonicalWalrusBlobId: "walrus-support",
        },
      },
      {
        index: 2,
        turn: 3,
        startedAtMs: 14,
        completedAtMs: 15,
        modelRequestId: "challenge-search",
        action: {
          action: "search",
          query: "strongest challenge",
          intent: "challenge",
        },
        result: {
          tool: "search",
          cached: false,
          resultsHash: `0x${"09".repeat(32)}`,
          results: [{
            rank: 1,
            url: challengeUrl,
            title: "Independent challenge",
            snippet: "The strongest contrary evidence.",
          }],
        },
      },
      {
        index: 3,
        turn: 4,
        startedAtMs: 16,
        completedAtMs: 17,
        modelRequestId: "challenge-open",
        action: { action: "open", url: challengeUrl, from: 0 },
        result: {
          tool: "open",
          cached: false,
          evidenceId: challengeId,
          origin: "SEARCH",
          from: 0,
          chars: 200,
          totalChars: 200,
          contentHash: `0x${"0a".repeat(32)}`,
          canonicalWalrusBlobId: "walrus-challenge",
        },
      },
    ],
    opened: [
      {
        evidenceId: supportId,
        ref: "p1",
        url: supportUrl,
        finalUrl: supportUrl,
        origin: "SEARCH",
        sides: ["support"],
        contentHash: `0x${"08".repeat(32)}`,
        canonicalHash: `0x${"18".repeat(32)}`,
        canonicalWalrusBlobId: "walrus-support",
        totalChars: 200,
        truncated: false,
      },
      {
        evidenceId: challengeId,
        ref: "p2",
        url: challengeUrl,
        finalUrl: challengeUrl,
        origin: "SEARCH",
        sides: ["challenge"],
        contentHash: `0x${"0a".repeat(32)}`,
        canonicalHash: `0x${"1a".repeat(32)}`,
        canonicalWalrusBlobId: "walrus-challenge",
        totalChars: 200,
        truncated: false,
      },
    ],
    citations: citations.map((citation) => ({ ...citation, found: true })),
    counts: { searches: 2, opens: 2, turns: 5, challengeSearches: 1 },
  };
  const input = { ...base.input, promptVersion: "3" as const };
  const validatedOutput = makeOutput({
    citations,
    counterEvidenceSummary:
      "The independent source raised the strongest objection, but the official record remained decisive.",
  });
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V3);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const audit: InferenceRunAudit = {
    ...base.audit,
    promptHash,
    inputHash,
    outputHash,
    toolTranscriptHash: toHex(blake2b256(canonicalJsonBytes(transcript))),
    toolCallCount: 4,
  };
  const core: PublicRunBundleCoreV4 = {
    ...base,
    version: 4,
    promptSpec: DEFAULT_PROMPT_SPEC_V3,
    promptHash,
    toolPolicy: DEFAULT_TOOL_POLICY_V3,
    toolPolicyHash: policyHash,
    transcript,
    input,
    inputHash,
    request: {
      ...base.request,
      messages: [
        {
          role: "system",
          content: composeSystemPrompt(
            DEFAULT_PROMPT_SPEC_V3,
            DEFAULT_TOOL_POLICY_V3,
          ),
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
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV4 = {
    ...core,
    seal: { ...seal, sealedBlobId: "sealed-blob" },
  };
  return { proof: proofFromBundle(bundle, sealed), sealed };
}

// The prompt spec is a parameter so the same v5 bundle can be rebuilt on the
// v5 prompt: v5 appends instructions only, so every check must still pass.
function makeProofV5(
  spec: PromptSpecV4 | PromptSpecV5 = DEFAULT_PROMPT_SPEC_V4,
) {
  const { proof: v4Proof } = makeProofV4();
  if (!v4Proof.bundle || !isV4Bundle(v4Proof.bundle)) {
    throw new Error("Expected a v4 bundle");
  }
  const v4Bundle = v4Proof.bundle;
  const transcript = structuredClone(v4Bundle.transcript);
  const openSteps = transcript.steps.filter(
    (step) => step.action.action === "open",
  );
  openSteps.forEach((step, index) => {
    step.turn = 4;
    step.modelRequestId = "batched-open";
    step.batch = { size: openSteps.length, position: index + 1 };
  });
  transcript.policyHash = toolPolicyHash(DEFAULT_TOOL_POLICY_V4);
  const input = { ...v4Bundle.input, promptVersion: spec.version };
  const promptHash = promptSpecHash(spec);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(
    blake2b256(canonicalJsonBytes(v4Bundle.validatedOutput)),
  );
  const audit: InferenceRunAudit = {
    ...v4Bundle.audit,
    promptHash,
    inputHash,
    outputHash,
    toolTranscriptHash: toHex(blake2b256(canonicalJsonBytes(transcript))),
  };
  const core: PublicRunBundleCoreV5 = {
    version: 5,
    kind: v4Bundle.kind,
    runId: v4Bundle.runId,
    claimId: v4Bundle.claimId,
    phase: v4Bundle.phase,
    agentProfileId: v4Bundle.agentProfileId,
    jurySeatId: v4Bundle.jurySeatId,
    promptSpec: spec,
    promptHash,
    toolPolicy: DEFAULT_TOOL_POLICY_V4,
    toolPolicyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V4),
    transcript,
    input,
    inputHash,
    request: {
      ...v4Bundle.request,
      messages: [
        {
          role: "system",
          content: composeSystemPrompt(spec, DEFAULT_TOOL_POLICY_V4),
        },
        ...v4Bundle.request.messages.slice(1),
      ],
    },
    attempts: v4Bundle.attempts,
    rawResponse: v4Bundle.rawResponse,
    gateway: v4Bundle.gateway,
    validatedOutput: v4Bundle.validatedOutput,
    outputHash,
    audit,
    runHash: runHashFromAudit(audit),
    verify: v4Bundle.verify,
  };
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV5 = {
    ...core,
    seal: { ...seal, sealedBlobId: "sealed-blob" },
  };
  return { proof: proofFromBundle(bundle, sealed), sealed };
}

function makeProofV6() {
  const base = makeCore();
  const input = sampleTableVoteInput();
  const validatedOutput = makeOutput({
    evidenceFor: ["evidence-table-1"],
    evidenceAgainst: [],
    decisiveEvidence: ["evidence-table-1"],
    publicReasoningTrace: [
      {
        check: "Compare the statement with the table evidence.",
        evidenceIds: ["evidence-table-1"],
        assessment: "SUPPORTS",
        finding: "The frozen source supports the statement.",
      },
    ],
  });
  const promptHash = promptSpecHash(TABLE_VOTE_PROMPT_SPEC_V1);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const audit: InferenceRunAudit = {
    ...base.audit,
    phase: 2,
    promptHash,
    inputHash,
    outputHash,
    toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
    toolCallCount: 0,
    evidenceRoot: toHex(fromHex(input.evidenceManifest.root)),
  };
  const core: PublicRunBundleCoreV6 = buildTableVoteBundleCore({
    input,
    runResult: {
      type: "gonka-run-result",
      attempts: [],
      response: base.rawResponse,
      request: {
        ...base.request,
        maxTokens: TABLE_VOTE_PROMPT_SPEC_V1.maxOutputTokens,
        messages: [
          {
            role: "system",
            content: TABLE_VOTE_PROMPT_SPEC_V1.systemPrompt,
          },
          {
            role: "user",
            content: new TextDecoder().decode(canonicalJsonBytes(input)),
          },
        ],
      },
      gateway: base.gateway,
    },
    validatedOutput,
    audit,
    runHash: runHashFromAudit(audit),
    promptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
  });
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV6 = {
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

  it("adds no Seal escrow check when the sealed bundle has no escrow", async () => {
    const { proof } = makeProof();
    const checks = await recomputeRunProof(proof);

    expect(checks.some((check) => check.key === "sealEscrow")).toBe(false);
  });

  it("verifies an escrow that binds the run, deadline, policy, and SDK object", async () => {
    const { proof } = makeEscrowProof();
    const checks = await recomputeRunProof(proof);

    expect(checks.find((check) => check.key === "sealEscrow")).toMatchObject({
      label: "Seal escrow binds this run",
      ok: true,
    });
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("rejects a Seal escrow with a mismatched reveal deadline", async () => {
    const { proof } = makeEscrowProof();
    if (!proof.claimDeadlines) throw new Error("Expected claim deadlines");
    proof.claimDeadlines.firstRevealDeadlineMs += 1;

    const checks = await recomputeRunProof(proof);
    expect(checks.find((check) => check.key === "sealEscrow")?.ok).toBe(false);
  });

  it("rejects a Seal escrow with a mismatched package ID", async () => {
    const { proof, escrow } = makeEscrowProof();
    escrow.packageId = `0x${"73".repeat(32)}`;

    const checks = await recomputeRunProof(proof);
    expect(checks.find((check) => check.key === "sealEscrow")?.ok).toBe(false);
  });

  it("explains when claim deadlines are unavailable without failing identity", async () => {
    const { proof } = makeEscrowProof();
    delete proof.claimDeadlines;

    const checks = await recomputeRunProof(proof);
    expect(checks.find((check) => check.key === "sealEscrow")).toMatchObject({
      ok: true,
      detail: expect.stringContaining("Claim reveal deadlines were not provided"),
    });
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

  it("verifies a research bundle whose accepted answer records repairs", async () => {
    const repair =
      'unsupportedClaims: dropped entry that is not an evidence id: "prose"';
    const { proof } = makeProofV3([repair]);
    const checks = await recomputeRunProof(proof);
    const answerStep = proof.bundle && isV3Bundle(proof.bundle)
      ? proof.bundle.transcript.steps.find(
          (step) => step.result.tool === "answer",
        )
      : undefined;

    expect(answerStep?.result).toMatchObject({ repairs: [repair] });
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("verifies all v4 two-sided research checks", async () => {
    const { proof } = makeProofV4();
    const checks = await recomputeRunProof(proof);

    expect(checks.map((check) => check.key)).toEqual([
      "promptHash",
      "toolPolicyHash",
      "systemPrompt",
      "inputHash",
      "outputHash",
      "toolTranscriptHash",
      "citations",
      "challengeSearch",
      "bothSidesOpened",
      "citationSites",
      "counterEvidenceSummary",
      "runHash",
      "sealedCore",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("verifies v5 research and opens-per-turn checks", async () => {
    const { proof } = makeProofV5();
    const checks = await recomputeRunProof(proof);

    expect(checks.map((check) => check.key)).toEqual([
      "promptHash",
      "toolPolicyHash",
      "systemPrompt",
      "inputHash",
      "outputHash",
      "toolTranscriptHash",
      "citations",
      "challengeSearch",
      "bothSidesOpened",
      "citationSites",
      "counterEvidenceSummary",
      "opensPerTurn",
      "runHash",
      "sealedCore",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("verifies a v5 bundle that ran the v5 prompt with the same checks", async () => {
    const { proof } = makeProofV5(DEFAULT_PROMPT_SPEC_V5);
    const checks = await recomputeRunProof(proof);

    expect(proof.bundle?.version).toBe(5);
    expect(proof.bundle?.promptSpec?.version).toBe("5");
    expect(checks.map((check) => check.key)).toEqual([
      "promptHash",
      "toolPolicyHash",
      "systemPrompt",
      "inputHash",
      "outputHash",
      "toolTranscriptHash",
      "citations",
      "challengeSearch",
      "bothSidesOpened",
      "citationSites",
      "counterEvidenceSummary",
      "opensPerTurn",
      "runHash",
      "sealedCore",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  describe("v6 table vote bundles", () => {
    it("passes the applicable checks and marks research checks not applicable", async () => {
      const { proof } = makeProofV6();
      const checks = await recomputeRunProof(proof);
      const byKey = new Map(checks.map((check) => [check.key, check]));

      for (const key of [
        "promptHash",
        "systemPrompt",
        "inputHash",
        "outputHash",
        "toolTranscriptHash",
        "citations",
        "runHash",
        "sealedCore",
      ] as const) {
        expect(byKey.get(key)?.ok).toBe(true);
      }
      expect(byKey.has("toolPolicyHash")).toBe(false);
      for (const key of [
        "challengeSearch",
        "bothSidesOpened",
        "citationSites",
        "counterEvidenceSummary",
        "opensPerTurn",
      ] as const) {
        expect(byKey.get(key)).toMatchObject({
          ok: true,
          detail: "Table vote: no research in round two",
        });
      }
    });

    it("fails outputHash when the validated output is tampered", async () => {
      const { proof, sealed } = makeProofV6();
      if (!proof.bundle || !isV6Bundle(proof.bundle)) {
        throw new Error("Expected a v6 bundle");
      }
      const bundle: PublicRunBundleV6 = {
        ...proof.bundle,
        validatedOutput: {
          ...proof.bundle.validatedOutput,
          outcome: "NO",
        },
      };

      const checks = await recomputeRunProof(proofFromBundle(bundle, sealed));
      expect(checks.find((check) => check.key === "outputHash")?.ok).toBe(false);
    });

    it("fails citations when an evidence id is not in the manifest", async () => {
      const { proof, sealed } = makeProofV6();
      if (!proof.bundle || !isV6Bundle(proof.bundle)) {
        throw new Error("Expected a v6 bundle");
      }
      const bundle: PublicRunBundleV6 = {
        ...proof.bundle,
        validatedOutput: {
          ...proof.bundle.validatedOutput,
          evidenceFor: ["urn:openverdict:not-frozen"],
        },
      };

      const checks = await recomputeRunProof(proofFromBundle(bundle, sealed));
      expect(checks.find((check) => check.key === "citations")?.ok).toBe(false);
    });
  });

  it("flags a v5 turn with more open steps than policy allows", async () => {
    const { proof } = makeProofV5();
    if (!proof.bundle || !isV5Bundle(proof.bundle)) {
      throw new Error("Expected a v5 bundle");
    }
    const openStep = proof.bundle.transcript.steps.find(
      (step) => step.action.action === "open",
    );
    if (openStep === undefined) throw new Error("Expected an open step");
    proof.bundle.transcript.steps.push(
      {
        ...structuredClone(openStep),
        index: proof.bundle.transcript.steps.length,
        batch: { size: 4, position: 3 },
      },
      {
        ...structuredClone(openStep),
        index: proof.bundle.transcript.steps.length + 1,
        batch: { size: 4, position: 4 },
      },
    );

    const checks = await recomputeRunProof(proof);
    expect(checks.find((check) => check.key === "opensPerTurn")).toMatchObject({
      label: "Opens per turn within policy",
      ok: false,
    });
  });

  it("flags a v4 transcript without a challenge search", async () => {
    const { proof } = makeProofV4();
    if (!proof.bundle || !isV4Bundle(proof.bundle)) {
      throw new Error("Expected a v4 bundle");
    }
    proof.bundle.transcript.steps = proof.bundle.transcript.steps.filter(
      (step) =>
        step.action.action !== "search" ||
        step.action.intent !== "challenge",
    );

    const checks = await recomputeRunProof(proof);
    expect(checks.find((check) => check.key === "challengeSearch")?.ok).toBe(
      false,
    );
  });

  it("passes the new v4 checks trivially for UNSURE", async () => {
    const { proof } = makeProofV4();
    if (!proof.bundle || !isV4Bundle(proof.bundle)) {
      throw new Error("Expected a v4 bundle");
    }
    proof.bundle.validatedOutput.outcome = "UNSURE";
    delete proof.bundle.validatedOutput.counterEvidenceSummary;
    proof.bundle.transcript.steps = [];
    proof.bundle.transcript.opened = [];

    const checks = await recomputeRunProof(proof);
    const newChecks = checks.filter((check) =>
      [
        "challengeSearch",
        "bothSidesOpened",
        "citationSites",
        "counterEvidenceSummary",
      ].includes(check.key),
    );
    expect(newChecks).toHaveLength(4);
    expect(newChecks.every((check) => check.ok)).toBe(true);
    expect(
      newChecks.find((check) => check.key === "counterEvidenceSummary")
        ?.actual,
    ).toBe("missing");
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

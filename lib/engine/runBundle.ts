import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { canonicalJsonBytes } from "../gonka/canonical";
import { toolPolicyHash } from "../gonka/promptSpec";
import type { GonkaRunResult } from "../gonka/types";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import type {
  HexString,
  InferenceRunAudit,
  OracleInferenceInput,
  OracleInferenceOutput,
  PromptSpecV2,
  PromptSpecV3,
  PublicRunBundleCore,
  PublicRunBundleCoreV3,
  PublicRunBundleCoreV4,
  ResearchTranscriptV1,
  RunBundleSeal,
  SealedRunBundleV2,
  ToolPolicyV2,
  ToolPolicyV3,
} from "../protocol/types";

const utf8 = new TextEncoder();
const decoder = new TextDecoder();
const AUTH_TAG_BYTES = 16;

type BuildRunBundleCoreCommonParams = {
  input: OracleInferenceInput;
  runResult: GonkaRunResult;
  validatedOutput: OracleInferenceOutput;
  audit: InferenceRunAudit;
  runHash: HexString;
  transcript: ResearchTranscriptV1;
};

export type BuildRunBundleCoreParams = BuildRunBundleCoreCommonParams &
  (
    | { promptSpec: PromptSpecV2; toolPolicy: ToolPolicyV2 }
    | { promptSpec: PromptSpecV3; toolPolicy: ToolPolicyV3 }
  );

export type SealRunBundleOptions = {
  runId: HexString;
  random?: (size: number) => Uint8Array;
};

export function buildRunBundleCore(
  params: BuildRunBundleCoreCommonParams & {
    promptSpec: PromptSpecV2;
    toolPolicy: ToolPolicyV2;
  },
): PublicRunBundleCoreV3;
export function buildRunBundleCore(
  params: BuildRunBundleCoreCommonParams & {
    promptSpec: PromptSpecV3;
    toolPolicy: ToolPolicyV3;
  },
): PublicRunBundleCoreV4;
export function buildRunBundleCore(
  params: BuildRunBundleCoreParams,
): PublicRunBundleCoreV3 | PublicRunBundleCoreV4 {
  const verify: PublicRunBundleCoreV3["verify"] = {
    promptHash: "blake2b256(canonicalJson(promptSpec))",
    toolPolicyHash: "blake2b256(canonicalJson(toolPolicy))",
    inputHash: "blake2b256(canonicalJson(input))",
    outputHash: "blake2b256(canonicalJson(validatedOutput))",
    toolTranscriptHash: "blake2b256(canonicalJson(transcript))",
    systemPrompt:
      "promptSpec.systemPrompt + '\\n' + canonicalJson({budgets: toolPolicy})",
    runHash: "blake2b256(BCS(RunRecordV1))",
    commitment: "blake2b256(BCS(VotePreimageV1))",
  };
  const shared = {
    kind: "run-bundle" as const,
    runId: params.audit.runId,
    claimId: params.audit.claimObjectId,
    phase: params.audit.phase,
    agentProfileId: params.audit.agentProfileId,
    jurySeatId: params.audit.jurySeatId,
    promptHash: params.audit.promptHash,
    toolPolicyHash: toolPolicyHash(params.toolPolicy),
    transcript: params.transcript,
    input: params.input,
    inputHash: params.audit.inputHash,
    request: params.runResult.request,
    attempts: params.runResult.attempts,
    rawResponse: params.runResult.response,
    gateway: params.runResult.gateway,
    validatedOutput: params.validatedOutput,
    outputHash: params.audit.outputHash,
    audit: params.audit,
    runHash: params.runHash,
    verify,
  };
  if (params.promptSpec.version === "3") {
    if (params.toolPolicy.version !== "3") {
      throw new Error("a v3 prompt spec requires a v3 tool policy");
    }
    return {
      ...shared,
      version: 4,
      promptSpec: params.promptSpec,
      toolPolicy: params.toolPolicy,
    };
  }
  if (params.toolPolicy.version !== "2") {
    throw new Error("a v2 prompt spec requires a v2 tool policy");
  }
  return {
    ...shared,
    version: 3,
    promptSpec: params.promptSpec,
    toolPolicy: params.toolPolicy,
  };
}

export function canonicalCoreBytes(
  core: PublicRunBundleCore,
): Uint8Array {
  return canonicalJsonBytes(core);
}

export function sealRunBundle(
  core: PublicRunBundleCore,
  options: SealRunBundleOptions,
): {
  sealed: SealedRunBundleV2;
  seal: Omit<RunBundleSeal, "sealedBlobId">;
} {
  if (options.runId !== core.runId) {
    throw new Error("run bundle AAD must match the core run ID");
  }
  const random = options.random ?? randomBytes;
  const key = Uint8Array.from(random(32));
  const iv = Uint8Array.from(random(12));
  if (key.byteLength !== 32 || iv.byteLength !== 12) {
    throw new Error("AES-256-GCM requires a 32-byte key and 12-byte IV");
  }

  const plaintext = canonicalCoreBytes(core);
  const coreHash = toHex(blake2b256(plaintext));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(utf8.encode(options.runId));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const ivHex = toHex(iv);
  return {
    sealed: {
      version: 2,
      kind: "sealed-run-bundle",
      runId: core.runId,
      algorithm: "AES-256-GCM",
      ivHex,
      aad: options.runId,
      coreHash,
      ciphertextBase64: ciphertext.toString("base64"),
    },
    seal: {
      algorithm: "AES-256-GCM",
      keyHex: toHex(key),
      ivHex,
      aad: options.runId,
      coreHash,
    },
  };
}

export function openSealedRunBundle(
  sealed: SealedRunBundleV2,
  seal: Pick<RunBundleSeal, "keyHex" | "ivHex" | "aad">,
): PublicRunBundleCore {
  if (sealed.algorithm !== "AES-256-GCM") {
    throw new Error("unsupported run bundle seal algorithm");
  }
  if (
    sealed.ivHex !== seal.ivHex ||
    sealed.aad !== seal.aad ||
    sealed.runId !== seal.aad
  ) {
    throw new Error("run bundle seal metadata does not match");
  }

  const key = fromHex(seal.keyHex);
  const iv = fromHex(seal.ivHex);
  if (key.byteLength !== 32 || iv.byteLength !== 12) {
    throw new Error("invalid run bundle key or IV length");
  }
  const combined = Buffer.from(sealed.ciphertextBase64, "base64");
  if (combined.byteLength <= AUTH_TAG_BYTES) {
    throw new Error("sealed run bundle is missing ciphertext or an auth tag");
  }

  const ciphertext = combined.subarray(0, -AUTH_TAG_BYTES);
  const authTag = combined.subarray(-AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(utf8.encode(seal.aad));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const expectedHash = fromHex(sealed.coreHash);
  const actualHash = blake2b256(plaintext);
  if (
    expectedHash.byteLength !== actualHash.byteLength ||
    !timingSafeEqual(expectedHash, actualHash)
  ) {
    throw new Error("sealed run bundle core hash does not match");
  }

  return JSON.parse(decoder.decode(plaintext)) as PublicRunBundleCore;
}

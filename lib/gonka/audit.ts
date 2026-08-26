import { blake2b256, toHex } from "../protocol/hash";
import type {
  AgentManifest,
  HexString,
  InferenceRunAudit,
  InferenceRunStatus,
  OracleInferenceInput,
} from "../protocol/types";
import { canonicalJsonBytes } from "./canonical";

export const ZERO_ID = `0x${"00".repeat(32)}` as HexString;
export const EMPTY_TOOL_TRANSCRIPT_HASH = toHex(
  blake2b256(new Uint8Array([0])),
);

export type EngineAuditContext = {
  claimObjectId: HexString;
  jurySeatId: HexString;
  phase: 1 | 2;
  runWalrusBlobId?: string;
  toolTranscriptHash?: HexString;
  toolTranscriptWalrusBlobId?: string;
  toolCallCount?: number;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export interface AttemptAuditOptions {
  input: OracleInferenceInput;
  manifest: AgentManifest;
  attempt: number;
  requestedAtMs: number;
  completedAtMs: number;
  status: InferenceRunStatus;
  gonkaRequestId?: string;
  responseModelId?: string;
  outputValue?: unknown;
  usage?: TokenUsage;
  engineContext?: Partial<EngineAuditContext>;
}

export function hashCanonicalJson(value: unknown): HexString {
  return toHex(blake2b256(canonicalJsonBytes(value)));
}

export function deriveAttemptRunId(baseRunId: string, attempt: number): HexString {
  if (attempt === 1 && /^0x[0-9a-fA-F]{64}$/.test(baseRunId)) {
    return baseRunId as HexString;
  }
  return hashCanonicalJson({ baseRunId, attempt });
}

function hexOrCanonicalHash(value: string): HexString {
  if (/^0x[0-9a-fA-F]+$/.test(value)) return value as HexString;
  return hashCanonicalJson(value);
}

/** Build one complete audit record without storing secrets or prompt bodies. */
export function createAttemptAudit(options: AttemptAuditOptions): InferenceRunAudit {
  const engineContext = options.engineContext ?? {};
  return {
    runId: deriveAttemptRunId(options.input.runId, options.attempt),
    claimObjectId: engineContext.claimObjectId ?? ZERO_ID,
    agentProfileId: options.manifest.agentProfileId,
    jurySeatId: engineContext.jurySeatId ?? ZERO_ID,
    phase: engineContext.phase ?? 1,
    attempt: options.attempt,
    providerId: "gonkarouter",
    modelId: options.manifest.modelId,
    ...(options.responseModelId === undefined
      ? {}
      : { responseModelId: options.responseModelId }),
    gonkaRequestId: options.gonkaRequestId ?? "",
    promptHash: options.manifest.promptHash,
    inputHash: hashCanonicalJson(options.input),
    outputHash: hashCanonicalJson(options.outputValue ?? null),
    runWalrusBlobId: engineContext.runWalrusBlobId ?? "",
    toolTranscriptHash:
      engineContext.toolTranscriptHash ?? EMPTY_TOOL_TRANSCRIPT_HASH,
    toolTranscriptWalrusBlobId:
      engineContext.toolTranscriptWalrusBlobId ?? "",
    toolCallCount: engineContext.toolCallCount ?? 0,
    evidenceRoot: hexOrCanonicalHash(options.input.evidenceManifest.root),
    requestedAtMs: options.requestedAtMs,
    completedAtMs: options.completedAtMs,
    latencyMs: Math.max(0, options.completedAtMs - options.requestedAtMs),
    ...options.usage,
    status: options.status,
  };
}

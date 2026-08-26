import type {
  AgentManifest,
  InferenceRunAudit,
  OracleInferenceInput,
  OracleInferenceOutput,
} from "../protocol/types";

/** Narrow application boundary from PRD section 20.8. */
export interface GonkaRouterAdapter {
  run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown>;
  normalizeResponse(response: unknown): Promise<{
    gonkaRequestId: string;
    modelId: string;
    output: OracleInferenceOutput;
  }>;
  validateOutput(
    output: OracleInferenceOutput,
    evidenceManifest: OracleInferenceInput["evidenceManifest"],
  ): Promise<void>;
  buildRunAudit(response: unknown): Promise<InferenceRunAudit>;
}

export type GonkaAttemptKind =
  | "PRIMARY"
  | "RETRY"
  | "JSON_PROMPT_FALLBACK"
  | "REPAIR";

export type GonkaInvestigationFlag =
  | "MISSING_GONKA_REQUEST_ID"
  | "DUPLICATE_GONKA_REQUEST_ID"
  | "RESPONSE_MODEL_MISMATCH"
  | "MISSING_TOKEN_USAGE"
  | "MALFORMED_TOKEN_USAGE";

export type GonkaAttemptRecord = {
  type: "gonka-attempt";
  kind: GonkaAttemptKind;
  audit: InferenceRunAudit;
  response?: unknown;
  error?: {
    category: "TIMEOUT" | "HTTP_ERROR" | "CONNECTION_ERROR" | "INVALID_RESPONSE";
    httpStatus?: number;
  };
  investigationFlags: GonkaInvestigationFlag[];
};

export type GonkaRunResult = {
  type: "gonka-run-result";
  attempts: GonkaAttemptRecord[];
  response: unknown;
};

export type GonkaRunFailureResult = {
  type: "gonka-run-failure";
  attempts: GonkaAttemptRecord[];
};

export class GonkaRunError extends Error {
  readonly result: GonkaRunFailureResult;

  constructor(message: string, attempts: GonkaAttemptRecord[]) {
    super(message);
    this.name = "GonkaRunError";
    this.result = { type: "gonka-run-failure", attempts };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isGonkaAttemptRecord(value: unknown): value is GonkaAttemptRecord {
  return isRecord(value) && value.type === "gonka-attempt";
}

export function isGonkaRunResult(value: unknown): value is GonkaRunResult {
  return (
    isRecord(value) &&
    value.type === "gonka-run-result" &&
    Array.isArray(value.attempts) &&
    "response" in value
  );
}

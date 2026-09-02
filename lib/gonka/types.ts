import type {
  AgentManifest,
  GatewayResponseMeta,
  HexString,
  InferenceRunAudit,
  OracleInferenceInput,
  OracleInferenceOutput,
  PromptSpecV1,
  PromptSpecV2,
  ProviderRequestRecord,
  TableVoteInput,
  ToolPolicyV2,
} from "../protocol/types";

export type GonkaCompletionInput = OracleInferenceInput | TableVoteInput;

/** A tiny direct probe records only whether one configured model answered. */
export type GonkaWeatherProbe = {
  modelId: string;
  ok: boolean;
  latencyMs: number;
  status: number | "TIMEOUT" | "ERROR";
};

/** Narrow application boundary from PRD section 20.8. */
export interface GonkaRouterAdapter {
  promptSpec(): PromptSpecV2;
  promptSpecHash(): HexString;
  toolPolicy(): ToolPolicyV2;
  toolPolicyHash(): HexString;
  legacyPromptSpec(): PromptSpecV1;
  run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown>;
  complete(
    request: GonkaCompletionRequest<GonkaCompletionInput>,
  ): Promise<GonkaCompletionResult>;
  probeModels(
    modelIds: readonly string[],
    timeoutMs: number,
  ): Promise<GonkaWeatherProbe[]>;
  normalizeResponse(response: unknown): Promise<{
    gonkaRequestId: string;
    modelId: string;
    output: OracleInferenceOutput;
  }>;
  validateOutput(
    output: OracleInferenceOutput,
    evidenceManifest: OracleInferenceInput["evidenceManifest"],
    extraAllowedIds?: ReadonlySet<string>,
  ): Promise<void>;
  buildRunAudit(response: unknown): Promise<InferenceRunAudit>;
}

export type GonkaAttemptKind =
  | "PRIMARY"
  | "RETRY"
  | "HEDGE"
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
    category:
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "CONNECTION_ERROR"
      | "INVALID_RESPONSE"
      | "HEDGE_ABANDONED";
    httpStatus?: number;
    message?: string;
  };
  investigationFlags: GonkaInvestigationFlag[];
};

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GonkaCompletionRequest<
  TInput extends GonkaCompletionInput = GonkaCompletionInput,
> = {
  manifest: AgentManifest;
  messages: PromptMessage[];
  /** HEDGE is assigned only to backup calls created inside the adapter. */
  kind: Exclude<GonkaAttemptKind, "HEDGE">;
  jsonMode: boolean;
  input: TInput;
  /** Shared across the whole run; complete() appends one record per model call. */
  attempts: GonkaAttemptRecord[];
  /** Upper bound for this single model call (the seat's remaining time), in ms. */
  timeoutMs?: number;
  /** Optional smaller output cap for stateless utility completions. */
  maxOutputTokens?: number;
};

export type GonkaCompletionResult =
  | {
      ok: true;
      response: unknown;
      request: ProviderRequestRecord;
      gateway: GatewayResponseMeta;
      content: string;
      gonkaRequestId: string;
      attempt: GonkaAttemptRecord;
    }
  | {
      ok: false;
      error: unknown;
      responseFormatUnsupported: boolean;
      status: "PROVIDER_ERROR" | "TIMEOUT";
    };

export type GonkaCompletion = (
  request: GonkaCompletionRequest<OracleInferenceInput>,
) => Promise<GonkaCompletionResult>;

export type GonkaRunResult = {
  type: "gonka-run-result";
  attempts: GonkaAttemptRecord[];
  response: unknown;
  request: ProviderRequestRecord;
  gateway: GatewayResponseMeta;
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
    "response" in value &&
    "request" in value &&
    "gateway" in value
  );
}

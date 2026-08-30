import OpenAI from "openai";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  AgentManifest,
  GatewayResponseMeta,
  HexString,
  InferenceRunAudit,
  OracleInferenceInput,
  OracleInferenceOutput,
  PromptSpecV1,
  PromptSpecV2,
  PromptSpecV3,
  ProviderRequestRecord,
  ToolPolicyV2,
} from "../protocol/types";
import {
  EMPTY_TOOL_TRANSCRIPT_HASH,
  ZERO_ID,
  createAttemptAudit,
  hashCanonicalJson,
  type EngineAuditContext,
  type TokenUsage,
} from "./audit";
import { canonicalJsonString } from "./canonical";
import {
  silentRedactingLogger,
  type RedactingLogger,
} from "./logger";
import {
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_TOOL_POLICY_V2,
  buildFallbackMessages,
  buildPrimaryMessages,
  buildRepairMessages,
  promptSpecHash as hashPromptSpec,
  toolPolicyHash as hashToolPolicy,
} from "./promptSpec";
import {
  VisibleRetryError,
  getGonkaErrorStatus,
  isGonkaTimeoutError,
  runWithVisibleRetry,
  type VisibleRetryAttempt,
} from "./retry";
import {
  oracleInferenceInputSchema,
  oracleInferenceOutputSchema,
  validateOutputAgainstManifest,
} from "./schemas";
import {
  GonkaRunError,
  isGonkaAttemptRecord,
  isGonkaRunResult,
  type GonkaAttemptKind,
  type GonkaAttemptRecord,
  type GonkaCompletionRequest,
  type GonkaCompletionResult,
  type GonkaInvestigationFlag,
  type GonkaRouterAdapter,
} from "./types";

const DEFAULT_BASE_URL = "https://api.gonkarouter.io/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RESEARCH_TIMEOUT_MS = 240_000;
type GonkaMessage = ProviderRequestRecord["messages"][number];

export type GonkaAdapterConfig = {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  researchTimeoutMs?: number;
  maxRetries?: number;
  promptSpec?: PromptSpecV1;
  researchSpec?: PromptSpecV2;
  toolPolicy?: ToolPolicyV2;
};

/** Internal dependency seam used by offline tests and the fake adapter. */
export interface GonkaAdapterDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  logger?: RedactingLogger;
  auditContext?: (
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ) => Partial<EngineAuditContext>;
}

type ProviderSuccess = {
  response: unknown;
  requestedAtMs: number;
  completedAtMs: number;
  kind: GonkaAttemptKind;
  request: ProviderRequestRecord;
  gateway: GatewayResponseMeta;
};

type ProviderFailure = {
  error: unknown;
  kind: GonkaAttemptKind;
};

type ProviderExecution =
  | { ok: true; success: ProviderSuccess }
  | { ok: false; failure: ProviderFailure };

type ResponseMetadata = {
  gonkaRequestId: string;
  responseModelId?: string;
  content?: string;
  systemFingerprint?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseMetadata(response: unknown): ResponseMetadata {
  if (!isRecord(response)) return { gonkaRequestId: "" };
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices[0];
  const message = isRecord(firstChoice) && isRecord(firstChoice.message)
    ? firstChoice.message
    : undefined;

  return {
    gonkaRequestId: typeof response.id === "string" ? response.id : "",
    ...(typeof response.model === "string"
      ? { responseModelId: response.model }
      : {}),
    ...(typeof message?.content === "string" ? { content: message.content } : {}),
    ...(typeof response.system_fingerprint === "string"
      ? { systemFingerprint: response.system_fingerprint }
      : {}),
  };
}

function gatewayResponseMeta(
  response: unknown,
  headers: Headers,
): GatewayResponseMeta {
  const gatewayRequestId = headers.get("x-request-id");
  const devshardId = headers.get("x-devshard-id");
  const systemFingerprint = responseMetadata(response).systemFingerprint;
  return {
    ...(gatewayRequestId === null ? {} : { gatewayRequestId }),
    ...(devshardId === null ? {} : { devshardId }),
    ...(systemFingerprint === undefined ? {} : { systemFingerprint }),
  };
}

/**
 * Reasoning models (MiniMax, Kimi) may stream deliberation prose or fences
 * around the final object even under response_format. Extract the LAST
 * balanced top-level JSON object; the raw content still feeds the output hash.
 */
export function extractJsonObject(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    // fall through to candidate extraction
  }
  // Reasoning models (MiniMax-M2.7) emit visible <think> blocks whose drafts
  // can themselves parse as JSON. Drop them before scanning. The scan then
  // collects TOP-LEVEL balanced objects left to right (a backward scan used
  // to return the innermost final nested object, e.g. one trace entry) and
  // prefers the last candidate carrying the contract's root "outcome" key.
  const visible = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const candidates: unknown[] = [];
  let index = visible.indexOf("{");
  while (index !== -1) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = index; i < visible.length; i += 1) {
      const ch = visible[i];
      if (inString) {
        if (ch === "\\") i += 1;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break; // Unbalanced tail, nothing further can close.
    let next = index + 1; // malformed span: step inside to find inner objects
    try {
      candidates.push(JSON.parse(visible.slice(index, end + 1)) as unknown);
      next = end + 1; // parsed whole object: never descend into its children
    } catch {
      // keep next = index + 1
    }
    index = visible.indexOf("{", next);
  }
  const keyed = candidates.filter(
    (candidate) =>
      typeof candidate === "object" && candidate !== null && "outcome" in candidate,
  );
  const chosen = keyed.at(-1) ?? candidates.at(-1);
  if (chosen === undefined) {
    throw new Error("no parseable JSON object in model content");
  }
  return chosen;
}

function outputValueForHash(response: unknown): unknown {
  const content = responseMetadata(response).content;
  if (content === undefined) return null;
  try {
    return extractJsonObject(content);
  } catch {
    return content;
  }
}

function tokenUsage(response: unknown): {
  usage: TokenUsage;
  flag?: GonkaInvestigationFlag;
} {
  if (!isRecord(response) || response.usage === undefined || response.usage === null) {
    return { usage: {}, flag: "MISSING_TOKEN_USAGE" };
  }
  if (!isRecord(response.usage)) {
    return { usage: {}, flag: "MALFORMED_TOKEN_USAGE" };
  }

  const inputTokens = response.usage.prompt_tokens;
  const outputTokens = response.usage.completion_tokens;
  if (
    !Number.isInteger(inputTokens) ||
    typeof inputTokens !== "number" ||
    inputTokens < 0 ||
    !Number.isInteger(outputTokens) ||
    typeof outputTokens !== "number" ||
    outputTokens < 0
  ) {
    return { usage: {}, flag: "MALFORMED_TOKEN_USAGE" };
  }

  return { usage: { inputTokens, outputTokens } };
}

function errorSummary(error: unknown): GonkaAttemptRecord["error"] {
  const httpStatus = getGonkaErrorStatus(error);
  if (isGonkaTimeoutError(error)) return { category: "TIMEOUT", ...(httpStatus ? { httpStatus } : {}) };
  if (httpStatus !== undefined) return { category: "HTTP_ERROR", httpStatus };
  return { category: "CONNECTION_ERROR" };
}

function errorText(error: unknown): string {
  if (!isRecord(error)) return String(error);
  const pieces = [
    typeof error.message === "string" ? error.message : "",
    typeof error.code === "string" ? error.code : "",
  ];
  if ("error" in error) {
    try {
      pieces.push(JSON.stringify(error.error));
    } catch {
      pieces.push("");
    }
  }
  return pieces.join(" ").toLowerCase();
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (getGonkaErrorStatus(error) !== 400) return false;
  const text = errorText(error);
  return (
    (text.includes("response_format") ||
      text.includes("json_object") ||
      text.includes("json mode")) &&
    (text.includes("unsupported") || text.includes("not support"))
  );
}

function normalizeRawResponse(response: unknown): {
  gonkaRequestId: string;
  modelId: string;
  output: OracleInferenceOutput;
} {
  const metadata = responseMetadata(response);
  if (metadata.gonkaRequestId.trim().length === 0) {
    throw new Error("GonkaRouter response is missing its Request ID");
  }
  if (!metadata.responseModelId) {
    throw new Error("GonkaRouter response is missing its model ID");
  }
  if (metadata.content === undefined) {
    throw new Error("GonkaRouter response is missing assistant content");
  }

  let decoded: unknown;
  try {
    decoded = extractJsonObject(metadata.content);
  } catch {
    throw new Error("GonkaRouter response content is not valid JSON");
  }

  return {
    gonkaRequestId: metadata.gonkaRequestId,
    modelId: metadata.responseModelId,
    output: oracleInferenceOutputSchema.parse(decoded),
  };
}

function unwrapResponse(response: unknown): unknown {
  if (isGonkaRunResult(response)) return response.response;
  if (isGonkaAttemptRecord(response)) return response.response;
  return response;
}

function standaloneAudit(response: unknown, now: () => number): InferenceRunAudit {
  const metadata = responseMetadata(response);
  const usage = tokenUsage(response).usage;
  const timestamp = now();
  const outputValue = outputValueForHash(response);
  const neutralHash = hashCanonicalJson(null);
  const runId = hashCanonicalJson({
    gonkaRequestId: metadata.gonkaRequestId,
    modelId: metadata.responseModelId ?? "",
  });

  return {
    runId,
    claimObjectId: ZERO_ID,
    agentProfileId: ZERO_ID,
    jurySeatId: ZERO_ID,
    phase: 1,
    attempt: 1,
    providerId: "gonkarouter",
    modelId: metadata.responseModelId ?? "",
    ...(metadata.responseModelId === undefined
      ? {}
      : { responseModelId: metadata.responseModelId }),
    gonkaRequestId: metadata.gonkaRequestId,
    promptHash: neutralHash,
    inputHash: neutralHash,
    outputHash: hashCanonicalJson(outputValue),
    runWalrusBlobId: "",
    toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
    toolTranscriptWalrusBlobId: "",
    toolCallCount: 0,
    evidenceRoot: ZERO_ID,
    requestedAtMs: timestamp,
    completedAtMs: timestamp,
    latencyMs: 0,
    ...usage,
    status: "RECEIVED",
  };
}

/** OpenAI v7 adapter for GonkaRouter's /v1/chat/completions endpoint. */
export function createGonkaAdapterWithDependencies(
  cfg: GonkaAdapterConfig,
  dependencies: GonkaAdapterDependencies = {},
): GonkaRouterAdapter {
  if (cfg.apiKey.trim().length === 0) throw new Error("GonkaRouter apiKey is required");
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }
  const researchTimeoutMs = cfg.researchTimeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
  if (!Number.isFinite(researchTimeoutMs) || researchTimeoutMs <= 0) {
    throw new RangeError("researchTimeoutMs must be positive");
  }
  const maxRetries = cfg.maxRetries ?? 1;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
    throw new RangeError("maxRetries must be 0 or 1");
  }
  const legacySpec = cfg.promptSpec ?? DEFAULT_PROMPT_SPEC_V1;
  const researchSpec = cfg.researchSpec ?? DEFAULT_PROMPT_SPEC_V2;
  const policy = cfg.toolPolicy ?? DEFAULT_TOOL_POLICY_V2;

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl ?? DEFAULT_BASE_URL,
    timeout: timeoutMs,
    // SDK retries stay disabled so every application retry is visible.
    maxRetries: 0,
    // All application logs must pass through the redacting logger below.
    logLevel: "off",
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? silentRedactingLogger;
  const seenRequestIds = new Set<string>();
  const auditContexts = new WeakMap<
    GonkaAttemptRecord[],
    Partial<EngineAuditContext>
  >();

  const engineContextFor = (
    attempts: GonkaAttemptRecord[],
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): Partial<EngineAuditContext> => {
    const existing = auditContexts.get(attempts);
    if (existing !== undefined) return existing;
    const created = dependencies.auditContext?.(input, manifest) ?? {};
    auditContexts.set(attempts, created);
    return created;
  };

  const assertManifest = (manifest: AgentManifest): void => {
    if (manifest.providerId !== "gonkarouter" || manifest.modelId.trim().length === 0) {
      throw new Error("agent manifest must pin a GonkaRouter model");
    }
  };

  const logAttempt = (attempt: GonkaAttemptRecord): void => {
    const audit = attempt.audit;
    const entry = {
      runId: audit.runId,
      modelId: audit.modelId,
      responseModelId: audit.responseModelId,
      requestedAtMs: audit.requestedAtMs,
      completedAtMs: audit.completedAtMs,
      inputHash: audit.inputHash,
      outputHash: audit.outputHash,
      gonkaRequestId: audit.gonkaRequestId,
      inputTokens: audit.inputTokens,
      outputTokens: audit.outputTokens,
      status: audit.status,
      errorCategory: attempt.error?.category,
      httpStatus: attempt.error?.httpStatus,
    };
    if (attempt.audit.status === "SCHEMA_VALID" || attempt.audit.status === "RECEIVED") {
      logger.info(entry);
    } else {
      logger.error(entry);
    }
  };

  const appendProviderFailure = (
    visible: Extract<VisibleRetryAttempt<unknown>, { ok: false }>,
    kind: GonkaAttemptKind,
    input: OracleInferenceInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
  ): void => {
    const status = isGonkaTimeoutError(visible.error) ? "TIMEOUT" : "PROVIDER_ERROR";
    const record: GonkaAttemptRecord = {
      type: "gonka-attempt",
      kind,
      audit: createAttemptAudit({
        input,
        manifest,
        attempt: attempts.length + 1,
        requestedAtMs: visible.requestedAtMs,
        completedAtMs: visible.completedAtMs,
        status,
        outputValue: null,
        engineContext: engineContextFor(attempts, input, manifest),
      }),
      error: errorSummary(visible.error),
      investigationFlags: [],
    };
    attempts.push(record);
    logAttempt(record);
  };

  const execute = async (
    kind: GonkaAttemptKind,
    messages: GonkaMessage[],
    includeResponseFormat: boolean,
    input: OracleInferenceInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
    spec: PromptSpecV1 | PromptSpecV2 | PromptSpecV3,
    requestTimeoutMs?: number,
  ): Promise<ProviderExecution> => {
    const retriesUsed = attempts.filter((attempt) => attempt.kind === "RETRY").length;
    const retriesRemaining = Math.max(0, maxRetries - retriesUsed);
    try {
      const result = await runWithVisibleRetry(
        async () =>
          client.chat.completions.create(
            {
              model: manifest.modelId,
              temperature: spec.temperature,
              max_tokens: spec.maxOutputTokens,
              messages,
              ...(includeResponseFormat
                ? { response_format: { type: spec.responseFormat } }
                : {}),
            },
            requestTimeoutMs === undefined
              ? undefined
              : { timeout: requestTimeoutMs },
          ).withResponse(),
        {
          maxRetries: retriesRemaining,
          now,
          random: dependencies.random,
          sleep: dependencies.sleep,
          // The per-call timeout is the seat's remaining time; no retry past it.
          ...(requestTimeoutMs === undefined ? {} : { deadlineMs: now() + requestTimeoutMs }),
        },
      );

      result.attempts.forEach((visible, index) => {
        if (!visible.ok) {
          appendProviderFailure(
            visible,
            index === 0 ? kind : "RETRY",
            input,
            manifest,
            attempts,
          );
        }
      });
      const success = result.attempts.at(-1);
      if (!success?.ok) throw new Error("visible retry result has no successful attempt");
      const successKind = result.attempts.length > 1 ? "RETRY" : kind;
      return {
        ok: true,
        success: {
          response: result.value.data,
          requestedAtMs: success.requestedAtMs,
          completedAtMs: success.completedAtMs,
          kind: successKind,
          request: {
            model: manifest.modelId,
            temperature: spec.temperature,
            maxTokens: spec.maxOutputTokens,
            responseFormat: includeResponseFormat ? spec.responseFormat : "none",
            attemptKind: successKind,
            messages: messages.map((message) => ({ ...message })),
          },
          gateway: gatewayResponseMeta(
            result.value.data,
            result.value.response.headers,
          ),
        },
      };
    } catch (error) {
      if (!(error instanceof VisibleRetryError)) throw error;
      error.attempts.forEach((visible, index) => {
        if (!visible.ok) {
          appendProviderFailure(
            visible,
            index === 0 ? kind : "RETRY",
            input,
            manifest,
            attempts,
          );
        }
      });
      const last = error.attempts.at(-1);
      const cause = last && !last.ok ? last.error : error;
      return { ok: false, failure: { error: cause, kind } };
    }
  };

  const appendReceivedResponse = (
    success: ProviderSuccess,
    status: "RECEIVED" | "SCHEMA_VALID" | "INVALID_SCHEMA" | "PROVIDER_ERROR",
    flags: GonkaInvestigationFlag[],
    usage: TokenUsage,
    input: OracleInferenceInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
  ): GonkaAttemptRecord => {
    const metadata = responseMetadata(success.response);
    const record: GonkaAttemptRecord = {
      type: "gonka-attempt",
      kind: success.kind,
      audit: createAttemptAudit({
        input,
        manifest,
        attempt: attempts.length + 1,
        requestedAtMs: success.requestedAtMs,
        completedAtMs: success.completedAtMs,
        status,
        gonkaRequestId: metadata.gonkaRequestId,
        responseModelId: metadata.responseModelId,
        outputValue: outputValueForHash(success.response),
        usage,
        gateway: success.gateway,
        engineContext: engineContextFor(attempts, input, manifest),
      }),
      response: success.response,
      ...(status === "PROVIDER_ERROR"
        ? { error: { category: "INVALID_RESPONSE" as const } }
        : {}),
      investigationFlags: flags,
    };
    attempts.push(record);
    logAttempt(record);
    return record;
  };

  async function complete(
    request: GonkaCompletionRequest,
  ): Promise<GonkaCompletionResult> {
    const input = oracleInferenceInputSchema.parse(request.input);
    assertManifest(request.manifest);
    // The manifest-selected input version controls research request settings.
    const completionSpec =
      input.promptVersion === "3" ? DEFAULT_PROMPT_SPEC_V3 : researchSpec;
    // A seat near its commit deadline bounds the call by the time it has left.
    const callTimeoutMs =
      request.timeoutMs !== undefined && request.timeoutMs > 0
        ? Math.min(researchTimeoutMs, request.timeoutMs)
        : researchTimeoutMs;
    const provider = await execute(
      request.kind,
      request.messages,
      request.jsonMode,
      input,
      request.manifest,
      request.attempts,
      completionSpec,
      callTimeoutMs,
    );
    if (!provider.ok) {
      return {
        ok: false,
        error: provider.failure.error,
        responseFormatUnsupported: isResponseFormatUnsupported(
          provider.failure.error,
        ),
        status: isGonkaTimeoutError(provider.failure.error)
          ? "TIMEOUT"
          : "PROVIDER_ERROR",
      };
    }

    const metadata = responseMetadata(provider.success.response);
    const flags: GonkaInvestigationFlag[] = [];
    const parsedUsage = tokenUsage(provider.success.response);
    if (parsedUsage.flag) flags.push(parsedUsage.flag);

    if (metadata.gonkaRequestId.trim().length === 0) {
      const error = new Error("GonkaRouter response omitted its Request ID");
      flags.push("MISSING_GONKA_REQUEST_ID");
      appendReceivedResponse(
        provider.success,
        "PROVIDER_ERROR",
        flags,
        parsedUsage.usage,
        input,
        request.manifest,
        request.attempts,
      );
      return {
        ok: false,
        error,
        responseFormatUnsupported: false,
        status: "PROVIDER_ERROR",
      };
    }
    if (seenRequestIds.has(metadata.gonkaRequestId)) {
      const error = new Error("duplicate GonkaRouter Request ID");
      flags.push("DUPLICATE_GONKA_REQUEST_ID");
      appendReceivedResponse(
        provider.success,
        "PROVIDER_ERROR",
        flags,
        parsedUsage.usage,
        input,
        request.manifest,
        request.attempts,
      );
      return {
        ok: false,
        error,
        responseFormatUnsupported: false,
        status: "PROVIDER_ERROR",
      };
    }
    seenRequestIds.add(metadata.gonkaRequestId);

    if (metadata.responseModelId !== request.manifest.modelId) {
      const error = new Error(
        "GonkaRouter response model differs from the manifest",
      );
      flags.push("RESPONSE_MODEL_MISMATCH");
      appendReceivedResponse(
        provider.success,
        "PROVIDER_ERROR",
        flags,
        parsedUsage.usage,
        input,
        request.manifest,
        request.attempts,
      );
      return {
        ok: false,
        error,
        responseFormatUnsupported: false,
        status: "PROVIDER_ERROR",
      };
    }

    const attempt = appendReceivedResponse(
      provider.success,
      "RECEIVED",
      flags,
      parsedUsage.usage,
      input,
      request.manifest,
      request.attempts,
    );
    return {
      ok: true,
      response: provider.success.response,
      request: provider.success.request,
      gateway: provider.success.gateway,
      content: metadata.content ?? "",
      gonkaRequestId: metadata.gonkaRequestId,
      attempt,
    };
  }

  async function run(
    unparsedInput: OracleInferenceInput,
    manifest: AgentManifest,
  ): Promise<unknown> {
    const input = oracleInferenceInputSchema.parse(unparsedInput);
    assertManifest(manifest);

    const attempts: GonkaAttemptRecord[] = [];
    engineContextFor(attempts, input, manifest);
    let jsonResponseFormat = true;

    const processResponse = async (
      success: ProviderSuccess,
    ): Promise<{ valid: true; response: unknown } | { valid: false; content: string }> => {
      const metadata = responseMetadata(success.response);
      const flags: GonkaInvestigationFlag[] = [];
      const parsedUsage = tokenUsage(success.response);
      if (parsedUsage.flag) flags.push(parsedUsage.flag);

      if (metadata.gonkaRequestId.trim().length === 0) {
        flags.push("MISSING_GONKA_REQUEST_ID");
        appendReceivedResponse(
          success,
          "PROVIDER_ERROR",
          flags,
          parsedUsage.usage,
          input,
          manifest,
          attempts,
        );
        throw new GonkaRunError("GonkaRouter response omitted its Request ID", attempts);
      }
      if (seenRequestIds.has(metadata.gonkaRequestId)) {
        flags.push("DUPLICATE_GONKA_REQUEST_ID");
        appendReceivedResponse(
          success,
          "PROVIDER_ERROR",
          flags,
          parsedUsage.usage,
          input,
          manifest,
          attempts,
        );
        throw new GonkaRunError("duplicate GonkaRouter Request ID", attempts);
      }
      seenRequestIds.add(metadata.gonkaRequestId);

      if (metadata.responseModelId !== manifest.modelId) {
        flags.push("RESPONSE_MODEL_MISMATCH");
        appendReceivedResponse(
          success,
          "PROVIDER_ERROR",
          flags,
          parsedUsage.usage,
          input,
          manifest,
          attempts,
        );
        throw new GonkaRunError("GonkaRouter response model differs from the manifest", attempts);
      }

      try {
        const normalized = normalizeRawResponse(success.response);
        await validateOutput(normalized.output, input.evidenceManifest);
        if (
          new TextEncoder().encode(normalized.output.reasoning).byteLength >
          input.outputContract.maximumReasonLength
        ) {
          throw new Error("reasoning exceeds the input output contract");
        }
        appendReceivedResponse(
          success,
          "SCHEMA_VALID",
          flags,
          parsedUsage.usage,
          input,
          manifest,
          attempts,
        );
        return { valid: true, response: success.response };
      } catch {
        appendReceivedResponse(
          success,
          "INVALID_SCHEMA",
          flags,
          parsedUsage.usage,
          input,
          manifest,
          attempts,
        );
        return { valid: false, content: metadata.content ?? "null" };
      }
    };

    const primaryMessages = buildPrimaryMessages(legacySpec, input);
    let provider = await execute(
      "PRIMARY",
      primaryMessages,
      true,
      input,
      manifest,
      attempts,
      legacySpec,
    );
    if (!provider.ok && isResponseFormatUnsupported(provider.failure.error)) {
      // Some compatible models lack JSON mode. Keep the changed request visible.
      jsonResponseFormat = false;
      provider = await execute(
        "JSON_PROMPT_FALLBACK",
        buildFallbackMessages(legacySpec, input),
        false,
        input,
        manifest,
        attempts,
        legacySpec,
      );
    }
    if (!provider.ok) {
      throw new GonkaRunError("GonkaRouter provider request failed", attempts);
    }

    const initial = await processResponse(provider.success);
    if (initial.valid) {
      return {
        type: "gonka-run-result",
        attempts,
        response: initial.response,
        request: provider.success.request,
        gateway: provider.success.gateway,
      };
    }

    const repairMessages = buildRepairMessages(legacySpec, input, initial.content);
    const repair = await execute(
      "REPAIR",
      repairMessages,
      jsonResponseFormat,
      input,
      manifest,
      attempts,
      legacySpec,
    );
    if (!repair.ok) {
      throw new GonkaRunError("GonkaRouter repair request failed", attempts);
    }
    const repaired = await processResponse(repair.success);
    if (!repaired.valid) {
      throw new GonkaRunError("GonkaRouter output remained invalid after one repair", attempts);
    }

    return {
      type: "gonka-run-result",
      attempts,
      response: repaired.response,
      request: repair.success.request,
      gateway: repair.success.gateway,
    };
  }

  async function normalizeResponse(response: unknown): Promise<{
    gonkaRequestId: string;
    modelId: string;
    output: OracleInferenceOutput;
  }> {
    return normalizeRawResponse(unwrapResponse(response));
  }

  async function validateOutput(
    output: OracleInferenceOutput,
    evidenceManifest: OracleInferenceInput["evidenceManifest"],
    extraAllowedIds?: ReadonlySet<string>,
  ): Promise<void> {
    validateOutputAgainstManifest(output, evidenceManifest, extraAllowedIds);
  }

  async function buildRunAudit(response: unknown): Promise<InferenceRunAudit> {
    if (isGonkaRunResult(response)) {
      const finalAttempt = response.attempts.at(-1);
      if (!finalAttempt) throw new Error("Gonka run has no visible attempts");
      return { ...finalAttempt.audit, ...response.gateway };
    }
    if (isGonkaAttemptRecord(response)) return response.audit;
    return standaloneAudit(response, now);
  }

  return {
    promptSpec: () => researchSpec,
    promptSpecHash: () => hashPromptSpec(researchSpec),
    toolPolicy: () => policy,
    toolPolicyHash: () => hashToolPolicy(policy),
    legacyPromptSpec: () => legacySpec,
    run,
    complete,
    normalizeResponse,
    validateOutput,
    buildRunAudit,
  };
}

/** Binding C3 factory. Test-only dependencies stay outside the public contract. */
export function createGonkaAdapter(cfg: GonkaAdapterConfig): GonkaRouterAdapter {
  return createGonkaAdapterWithDependencies(cfg);
}

/** Hash a JSON-only prompt for callers that need a redacted log field. */
export function hashGonkaPrompt(prompt: unknown): HexString {
  return toHex(blake2b256(new TextEncoder().encode(canonicalJsonString(prompt))));
}

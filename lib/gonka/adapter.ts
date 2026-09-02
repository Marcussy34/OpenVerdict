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
  PromptSpecV4,
  ProviderRequestRecord,
  TableVoteInput,
  TableVotePromptSpecV1,
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
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V2,
  TABLE_VOTE_PROMPT_SPEC_V1,
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
  type GonkaCompletionInput,
  type GonkaCompletionRequest,
  type GonkaCompletionResult,
  type GonkaInvestigationFlag,
  type GonkaRouterAdapter,
  type GonkaWeatherProbe,
} from "./types";

const DEFAULT_BASE_URL = "https://api.gonkarouter.io/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
// A research turn that has not answered in 90 s is abandoned and retried: the
// gateway edge times out at about 125 s anyway, and waiting for that 524 twice
// spent a whole seat window (Kimi seats, 2026-09-03 02:09). Healthy turns
// answer in 10 to 50 s.
const DEFAULT_RESEARCH_TIMEOUT_MS = 90_000;
const DEFAULT_HEDGE_AFTER_MS = 25_000;
const MIN_HEDGE_REMAINING_MS = 5_000;
const HEDGE_ABANDONED_MESSAGE =
  "abandoned: the hedged request answered first";
type GonkaMessage = ProviderRequestRecord["messages"][number];

export type GonkaAdapterConfig = {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  researchTimeoutMs?: number;
  hedgeAfterMs?: number;
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
    input: OracleInferenceInput | TableVoteInput,
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

type ProviderResponse = {
  data: unknown;
  response: Response;
};

type ProviderCallSuccess = {
  ok: true;
  value: ProviderResponse;
  requestedAtMs: number;
  completedAtMs: number;
  kind: GonkaAttemptKind;
};

type ProviderCallFailure = {
  ok: false;
  error: unknown;
  requestedAtMs: number;
  completedAtMs: number;
  kind: GonkaAttemptKind;
};

type ProviderCallSettlement = ProviderCallSuccess | ProviderCallFailure;

type ProviderCallHandle = {
  controller: AbortController;
  promise: Promise<ProviderCallSettlement>;
  requestedAtMs: number;
  kind: GonkaAttemptKind;
};

type AbandonedProviderCall = {
  abandoned: true;
  requestedAtMs: number;
  completedAtMs: number;
  kind: GonkaAttemptKind;
};

type ProviderCallEvent = ProviderCallFailure | AbandonedProviderCall;

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
  const gatewayFallback = headers.get("x-gonka-fallback");
  const systemFingerprint = responseMetadata(response).systemFingerprint;
  return {
    ...(gatewayRequestId === null ? {} : { gatewayRequestId }),
    ...(devshardId === null ? {} : { devshardId }),
    ...(gatewayFallback === null ? {} : { gatewayFallback }),
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
  // Track mandate + protocol invariant: all AI reasoning runs on the Gonka
  // network. The adapter refuses any other inference host so configuration
  // alone can never reroute juror reasoning to another provider.
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const baseHost = new URL(baseUrl).hostname;
  if (baseHost !== "gonkarouter.io" && !baseHost.endsWith(".gonkarouter.io")) {
    throw new Error(
      `GonkaRouter adapter refuses non-Gonka base URL host "${baseHost}": all AI inference must run on gonkarouter.io`,
    );
  }
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }
  const researchTimeoutMs = cfg.researchTimeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
  if (!Number.isFinite(researchTimeoutMs) || researchTimeoutMs <= 0) {
    throw new RangeError("researchTimeoutMs must be positive");
  }
  const hedgeAfterMs = cfg.hedgeAfterMs ?? DEFAULT_HEDGE_AFTER_MS;
  if (!Number.isFinite(hedgeAfterMs) || hedgeAfterMs < 0) {
    throw new RangeError("hedgeAfterMs must be non-negative and finite");
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
    baseURL: baseUrl,
    // GonkaRouter substitutes a fallback model when the requested upstream is
    // saturated (confirmed by their team, 2026-08-31). We enforce the exact
    // requested model: a saturated upstream then returns a real 429, which the
    // retry and hedge paths already absorb; a silent substitution would only
    // fail closed later at the served-model check and burn the whole call.
    defaultHeaders: { "X-Gonka-No-Fallback": "true" },
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
    input: GonkaCompletionInput,
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
    failure: ProviderCallFailure,
    input: GonkaCompletionInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
  ): void => {
    const status = isGonkaTimeoutError(failure.error) ? "TIMEOUT" : "PROVIDER_ERROR";
    const record: GonkaAttemptRecord = {
      type: "gonka-attempt",
      kind: failure.kind,
      audit: createAttemptAudit({
        input,
        manifest,
        attempt: attempts.length + 1,
        requestedAtMs: failure.requestedAtMs,
        completedAtMs: failure.completedAtMs,
        status,
        outputValue: null,
        engineContext: engineContextFor(attempts, input, manifest),
      }),
      error: errorSummary(failure.error),
      investigationFlags: [],
    };
    attempts.push(record);
    logAttempt(record);
  };

  const appendAbandonedProviderCall = (
    abandoned: AbandonedProviderCall,
    input: GonkaCompletionInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
  ): void => {
    const record: GonkaAttemptRecord = {
      type: "gonka-attempt",
      kind: abandoned.kind,
      audit: createAttemptAudit({
        input,
        manifest,
        attempt: attempts.length + 1,
        requestedAtMs: abandoned.requestedAtMs,
        completedAtMs: abandoned.completedAtMs,
        status: "PROVIDER_ERROR",
        outputValue: null,
        engineContext: engineContextFor(attempts, input, manifest),
      }),
      error: {
        category: "HEDGE_ABANDONED",
        message: HEDGE_ABANDONED_MESSAGE,
      },
      investigationFlags: [],
    };
    attempts.push(record);
    logAttempt(record);
  };

  const execute = async (
    kind: GonkaAttemptKind,
    messages: GonkaMessage[],
    includeResponseFormat: boolean,
    input: GonkaCompletionInput,
    manifest: AgentManifest,
    attempts: GonkaAttemptRecord[],
    spec:
      | PromptSpecV1
      | PromptSpecV2
      | PromptSpecV3
      | PromptSpecV4
      | TableVotePromptSpecV1,
    options: {
      requestTimeoutMs?: number;
      maxOutputTokens?: number;
    } = {},
  ): Promise<ProviderExecution> => {
    const requestTimeoutMs = options.requestTimeoutMs;
    const maxOutputTokens = options.maxOutputTokens ?? spec.maxOutputTokens;
    const retriesUsed = attempts.filter((attempt) => attempt.kind === "RETRY").length;
    const retriesRemaining = Math.max(0, maxRetries - retriesUsed);
    const deadlineMs = requestTimeoutMs === undefined
      ? undefined
      : now() + requestTimeoutMs;
    const callEvents: ProviderCallEvent[] = [];
    let callEventsAppended = false;
    let operationIndex = 0;
    const requestBody = {
      model: manifest.modelId,
      temperature: spec.temperature,
      max_tokens: maxOutputTokens,
      messages,
      ...(includeResponseFormat
        ? { response_format: { type: spec.responseFormat } }
        : {}),
    };

    const startProviderCall = (
      callKind: GonkaAttemptKind,
      remainingMs: number,
    ): ProviderCallHandle => {
      const requestedAtMs = now();
      const controller = new AbortController();
      let providerPromise: Promise<ProviderResponse>;
      try {
        providerPromise = client.chat.completions.create(
          requestBody,
          {
            signal: controller.signal,
            timeout: Math.max(1, Math.ceil(remainingMs)),
          },
        ).withResponse();
      } catch (error) {
        providerPromise = Promise.reject(error);
      }
      // Both branches settle, so aborting the losing call cannot leak a rejection.
      const promise: Promise<ProviderCallSettlement> = providerPromise.then(
        (value) => ({
          ok: true,
          value,
          requestedAtMs,
          completedAtMs: now(),
          kind: callKind,
        }),
        (error: unknown) => ({
          ok: false,
          error,
          requestedAtMs,
          completedAtMs: now(),
          kind: callKind,
        }),
      );
      return { controller, promise, requestedAtMs, kind: callKind };
    };

    const settleSingleCall = async (
      call: ProviderCallHandle,
    ): Promise<ProviderCallSuccess> => {
      const settlement = await call.promise;
      if (settlement.ok) return settlement;
      callEvents.push(settlement);
      throw settlement.error;
    };

    const runProviderOperation = async (
      operationKind: GonkaAttemptKind,
      remainingMs: number,
    ): Promise<ProviderCallSuccess> => {
      const primary = startProviderCall(operationKind, remainingMs);
      if (
        hedgeAfterMs === 0 ||
        remainingMs <= hedgeAfterMs + MIN_HEDGE_REMAINING_MS
      ) {
        return settleSingleCall(primary);
      }

      const hedgeReady = Symbol("hedge-ready");
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      const hedgeDelay = new Promise<typeof hedgeReady>((resolve) => {
        hedgeTimer = setTimeout(() => resolve(hedgeReady), hedgeAfterMs);
      });
      const primaryOrDelay = await Promise.race([primary.promise, hedgeDelay]);
      if (primaryOrDelay !== hedgeReady) {
        if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
        if (primaryOrDelay.ok) return primaryOrDelay;
        callEvents.push(primaryOrDelay);
        throw primaryOrDelay.error;
      }

      const backupRemainingMs = deadlineMs === undefined
        ? remainingMs - hedgeAfterMs
        : deadlineMs - now();
      const backup = startProviderCall("HEDGE", backupRemainingMs);
      const first = await Promise.race([
        primary.promise.then((settlement) => ({ call: primary, settlement })),
        backup.promise.then((settlement) => ({ call: backup, settlement })),
      ]);
      const other = first.call === primary ? backup : primary;

      if (first.settlement.ok) {
        other.controller.abort();
        callEvents.push({
          abandoned: true,
          kind: other.kind,
          requestedAtMs: other.requestedAtMs,
          completedAtMs: now(),
        });
        return first.settlement;
      }

      const second = await other.promise;
      if (second.ok) {
        callEvents.push(first.settlement);
        return second;
      }
      callEvents.push(first.settlement, second);
      throw second.error;
    };

    const appendCallEvents = (): void => {
      if (callEventsAppended) return;
      callEventsAppended = true;
      callEvents.sort(
        (left, right) =>
          left.completedAtMs - right.completedAtMs ||
          left.requestedAtMs - right.requestedAtMs,
      );
      callEvents.forEach((event) => {
        if ("abandoned" in event) {
          appendAbandonedProviderCall(event, input, manifest, attempts);
        } else {
          appendProviderFailure(event, input, manifest, attempts);
        }
      });
    };

    try {
      const result = await runWithVisibleRetry(
        async () => {
          const operationKind = operationIndex === 0 ? kind : "RETRY";
          operationIndex += 1;
          const remainingMs = deadlineMs === undefined
            ? timeoutMs
            : Math.max(1, deadlineMs - now());
          return runProviderOperation(operationKind, remainingMs);
        },
        {
          maxRetries: retriesRemaining,
          now,
          random: dependencies.random,
          sleep: dependencies.sleep,
          // The per-call timeout is the seat's remaining time; no retry past it.
          ...(deadlineMs === undefined ? {} : { deadlineMs }),
        },
      );

      appendCallEvents();
      const success = result.value;
      return {
        ok: true,
        success: {
          response: success.value.data,
          requestedAtMs: success.requestedAtMs,
          completedAtMs: success.completedAtMs,
          kind: success.kind,
          request: {
            model: manifest.modelId,
            temperature: spec.temperature,
            maxTokens: maxOutputTokens,
            responseFormat: includeResponseFormat ? spec.responseFormat : "none",
            attemptKind: success.kind,
            messages: messages.map((message) => ({ ...message })),
          },
          gateway: gatewayResponseMeta(
            success.value.data,
            success.value.response.headers,
          ),
        },
      };
    } catch (error) {
      appendCallEvents();
      if (!(error instanceof VisibleRetryError)) throw error;
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
    input: GonkaCompletionInput,
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
    request: GonkaCompletionRequest<GonkaCompletionInput>,
  ): Promise<GonkaCompletionResult> {
    let input: GonkaCompletionInput;
    let completionSpec:
      | PromptSpecV2
      | PromptSpecV3
      | PromptSpecV4
      | TableVotePromptSpecV1;
    if ("kind" in request.input && request.input.kind === "TABLE_VOTE") {
      input = request.input;
      completionSpec = TABLE_VOTE_PROMPT_SPEC_V1;
    } else {
      const researchInput = oracleInferenceInputSchema.parse(request.input);
      input = researchInput;
      completionSpec =
        researchInput.promptVersion === "4"
          ? DEFAULT_PROMPT_SPEC_V4
          : researchInput.promptVersion === "3"
            ? DEFAULT_PROMPT_SPEC_V3
            : researchSpec;
    }
    assertManifest(request.manifest);
    // The table vote has its own pinned budget and never uses research settings.
    // A seat near its commit deadline bounds the call by the time it has left.
    const callTimeoutMs =
      request.timeoutMs !== undefined && request.timeoutMs > 0
        ? Math.min(researchTimeoutMs, request.timeoutMs)
        : researchTimeoutMs;
    const maxOutputTokens = request.maxOutputTokens ?? completionSpec.maxOutputTokens;
    if (
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens <= 0 ||
      maxOutputTokens > completionSpec.maxOutputTokens
    ) {
      throw new RangeError(
        `maxOutputTokens must be between 1 and ${completionSpec.maxOutputTokens}`,
      );
    }
    const provider = await execute(
      request.kind,
      request.messages,
      request.jsonMode,
      input,
      request.manifest,
      request.attempts,
      completionSpec,
      { requestTimeoutMs: callTimeoutMs, maxOutputTokens },
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

  /** Weather checks bypass juror audits because they are availability signals only. */
  async function probeModels(
    modelIds: readonly string[],
    probeTimeoutMs: number,
  ): Promise<GonkaWeatherProbe[]> {
    return Promise.all(
      modelIds.map(async (modelId) => {
        const startedAtMs = now();
        try {
          const result = await client.chat.completions.create(
            {
              model: modelId,
              // A fresh nonce per probe: the gateway caches identical
              // temperature-0 requests, and a cached answer says nothing
              // about whether the model answers right now.
              // A research-shaped probe: a family that answers eight tokens
              // in two seconds can still time out on a real turn (the night
              // of 2026-09-03: probes clear, seats voided). Asking for a short
              // structured paragraph makes "clear" mean "can do real work".
              messages: [
                {
                  role: "user",
                  content: `Probe ${startedAtMs}. In about 150 words, explain why the sky looks blue, then end with the JSON object {"ok":true} on its own line.`,
                },
              ],
              max_tokens: 400,
              temperature: 0,
            },
            { timeout: probeTimeoutMs },
          ).withResponse();
          const content = result.data.choices[0]?.message.content;
          return {
            modelId,
            ok:
              result.response.status === 200 &&
              typeof content === "string" &&
              content.trim().length > 0,
            latencyMs: Math.max(0, now() - startedAtMs),
            status: result.response.status,
          };
        } catch (error) {
          const errorStatus = getGonkaErrorStatus(error);
          const status: GonkaWeatherProbe["status"] = isGonkaTimeoutError(error)
            ? "TIMEOUT"
            : errorStatus ?? "ERROR";
          return {
            modelId,
            ok: false,
            latencyMs: Math.max(0, now() - startedAtMs),
            status,
          };
        }
      }),
    );
  }

  return {
    promptSpec: () => researchSpec,
    promptSpecHash: () => hashPromptSpec(researchSpec),
    toolPolicy: () => policy,
    toolPolicyHash: () => hashToolPolicy(policy),
    legacyPromptSpec: () => legacySpec,
    run,
    complete,
    probeModels,
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

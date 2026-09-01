import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { canonicalJsonBytes } from "../gonka/canonical";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  OracleInferenceOutput,
  ProviderRequestRecord,
  PublicRunBundle,
} from "../protocol/types";

const REEXECUTION_TIMEOUT_MS = 120_000;
const RAW_CONTENT_LIMIT = 4_000;

type ReexecuteRequest = {
  model: string;
  temperature: 0;
  max_tokens: number;
  messages: ProviderRequestRecord["messages"];
  response_format?: { type: "json_object" };
};

type ReexecuteCompletionResponse = {
  data: unknown;
  headers: Headers;
};

export type ReexecuteCompletion = (
  request: ReexecuteRequest,
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<ReexecuteCompletionResponse>;

export type ReexecuteRunOptions = {
  completion?: ReexecuteCompletion;
  now?: () => number;
};

export type ReexecuteRunResult = {
  requestedAt: string;
  completedAt: string;
  latencyMs: number;
  gatewayRequestId: string | null;
  devshardId: string | null;
  systemFingerprint: string | null;
  servedModel: string;
  outputHash: `0x${string}`;
  outcome: OracleInferenceOutput["outcome"];
  confidenceBps: number;
  matches: {
    outcome: boolean;
    outputHash: boolean;
    servedModel: boolean;
  };
  rawContent: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalHash(value: unknown): `0x${string}` {
  return toHex(blake2b256(canonicalJsonBytes(value)));
}

function sameText(left: string, right: string): boolean {
  return left === right;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function redactApiKey(value: string): string {
  const apiKey = process.env.GONKA_ROUTER_API_KEY?.trim();
  return apiKey ? value.split(apiKey).join("[REDACTED]") : value;
}

/** Extract the final balanced JSON object using the adapter's research strategy. */
function extractJsonObject(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    // Compatible reasoning models can wrap their final JSON in prose.
  }

  const visible = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const candidates: unknown[] = [];
  let index = visible.indexOf("{");

  while (index !== -1) {
    let depth = 0;
    let inString = false;
    let end = -1;

    for (let cursor = index; cursor < visible.length; cursor += 1) {
      const character = visible[cursor];
      if (inString) {
        if (character === "\\") cursor += 1;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    if (end === -1) break;
    let next = index + 1;
    try {
      candidates.push(JSON.parse(visible.slice(index, end + 1)) as unknown);
      next = end + 1;
    } catch {
      // Step into a malformed span so a valid nested object can still be found.
    }
    index = visible.indexOf("{", next);
  }

  const outcomeCandidates = candidates.filter(
    (candidate) => isRecord(candidate) && "outcome" in candidate,
  );
  const chosen = outcomeCandidates.at(-1) ?? candidates.at(-1);
  if (chosen === undefined) {
    throw new Error(
      "Re-execution response did not contain a parseable JSON object",
    );
  }
  return chosen;
}

function parsedOutput(bundle: PublicRunBundle, parsed: unknown): JsonRecord {
  if (bundle.version !== 2) {
    if (!isRecord(parsed) || parsed.action !== "answer" || !isRecord(parsed.output)) {
      // A research juror may ask for another search or page instead of
      // answering; that is a difference to look into, not a provider fault.
      const action =
        isRecord(parsed) && typeof parsed.action === "string"
          ? parsed.action
          : "no";
      throw new Error(
        `The fresh reply was not a final answer (the model returned a ${action} action instead of answering); compare the recorded trail by hand`,
      );
    }
    return parsed.output;
  }
  if (!isRecord(parsed)) {
    throw new Error("Re-execution response output must be a JSON object");
  }
  return parsed;
}

function verdictFromOutput(output: JsonRecord): {
  outcome: OracleInferenceOutput["outcome"];
  confidenceBps: number;
} {
  const outcome = output.outcome;
  if (outcome !== "YES" && outcome !== "NO" && outcome !== "UNSURE") {
    throw new Error("Re-execution response has an invalid verdict outcome");
  }
  const confidenceBps = output.confidenceBps;
  if (
    typeof confidenceBps !== "number" ||
    !Number.isInteger(confidenceBps) ||
    confidenceBps < 0 ||
    confidenceBps > 10_000
  ) {
    throw new Error("Re-execution response has an invalid confidence value");
  }
  return { outcome, confidenceBps };
}

function openAiMessages(
  messages: ProviderRequestRecord["messages"],
): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    return { role: "user", content: message.content };
  });
}

function environmentCompletion(): ReexecuteCompletion {
  const baseURL = process.env.GONKA_ROUTER_BASE_URL?.trim();
  const apiKey = process.env.GONKA_ROUTER_API_KEY?.trim();
  if (!baseURL) {
    throw new Error("GONKA_ROUTER_BASE_URL is not configured");
  }
  if (!apiKey) {
    throw new Error("GONKA_ROUTER_API_KEY is not configured");
  }
  // Same invariant as the adapter: re-execution must also stay on Gonka.
  const host = new URL(baseURL).hostname;
  if (host !== "gonkarouter.io" && !host.endsWith(".gonkarouter.io")) {
    throw new Error(
      `re-execution refuses non-Gonka base URL host "${host}": all AI inference must run on gonkarouter.io`,
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: REEXECUTION_TIMEOUT_MS,
    maxRetries: 0,
    logLevel: "off",
  });

  return async (request, options) => {
    const { data, response } = await client.chat.completions
      .create(
        {
          ...request,
          messages: openAiMessages(request.messages),
        },
        {
          signal: options.signal,
          timeout: options.timeoutMs,
        },
      )
      .withResponse();
    return { data, headers: response.headers };
  };
}

async function completeWithTimeout(
  completion: ReexecuteCompletion,
  request: ReexecuteRequest,
): Promise<ReexecuteCompletionResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Re-execution timed out after 120 seconds"));
    }, REEXECUTION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        completion(request, {
          signal: controller.signal,
          timeoutMs: REEXECUTION_TIMEOUT_MS,
        }),
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function responseFields(data: unknown): {
  content: string;
  servedModel: string;
  systemFingerprint: string | null;
} {
  if (!isRecord(data)) {
    throw new Error("Re-execution response is not an object");
  }
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = choices[0];
  const message = isRecord(firstChoice) && isRecord(firstChoice.message)
    ? firstChoice.message
    : undefined;
  if (typeof message?.content !== "string") {
    throw new Error("Re-execution response is missing assistant content");
  }
  if (typeof data.model !== "string" || data.model.trim().length === 0) {
    throw new Error("Re-execution response is missing its served model");
  }
  return {
    content: message.content,
    servedModel: data.model,
    systemFingerprint:
      typeof data.system_fingerprint === "string"
        ? data.system_fingerprint
        : null,
  };
}

/** Re-send a revealed run's exact recorded conversation for a soft comparison. */
export async function reexecuteRun(
  bundle: PublicRunBundle,
  options: ReexecuteRunOptions = {},
): Promise<ReexecuteRunResult> {
  const now = options.now ?? Date.now;
  const maxTokens = Number.isInteger(bundle.promptSpec.maxOutputTokens)
    ? bundle.promptSpec.maxOutputTokens
    : 4_096;
  const request: ReexecuteRequest = {
    model: bundle.request.model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: bundle.request.messages,
    ...(bundle.promptSpec.responseFormat === "json_object"
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };

  const requestedAtMs = now();
  let completionResponse: ReexecuteCompletionResponse;
  try {
    completionResponse = await completeWithTimeout(
      options.completion ?? environmentCompletion(),
      request,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Re-execution timed out after 120 seconds"
    ) {
      throw error;
    }
    throw new Error("The model provider could not complete the re-execution");
  }
  const completedAtMs = now();

  const { content, servedModel, systemFingerprint } = responseFields(
    completionResponse.data,
  );
  const output = parsedOutput(bundle, extractJsonObject(content));
  const { outcome, confidenceBps } = verdictFromOutput(output);
  const outputHash = canonicalHash(output);
  const recordedServedModel =
    bundle.audit.responseModelId ?? bundle.audit.modelId;

  return {
    requestedAt: new Date(requestedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    latencyMs: Math.max(0, completedAtMs - requestedAtMs),
    gatewayRequestId:
      completionResponse.headers.get("x-request-id") ?? null,
    devshardId: completionResponse.headers.get("x-devshard-id") ?? null,
    systemFingerprint,
    servedModel,
    outputHash,
    outcome,
    confidenceBps,
    matches: {
      outcome: sameText(outcome, bundle.validatedOutput.outcome),
      outputHash: sameHex(outputHash, bundle.outputHash),
      servedModel: sameText(servedModel, recordedServedModel),
    },
    rawContent: redactApiKey(content).slice(0, RAW_CONTENT_LIMIT),
  };
}

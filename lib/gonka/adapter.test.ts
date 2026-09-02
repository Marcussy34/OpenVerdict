import { afterEach, describe, expect, it, vi } from "vitest";
import { blake2b256, toHex } from "../protocol/hash";
import {
  createGonkaAdapter as createConfiguredGonkaAdapter,
  createGonkaAdapterWithDependencies as createGonkaAdapter,
  extractJsonObject,
  type GonkaAdapterDependencies,
} from "./adapter";
import { canonicalJsonBytes } from "./canonical";
import { createRedactingLogger } from "./logger";
import {
  GonkaRunError,
  isGonkaRunResult,
  type GonkaAttemptRecord,
  type GonkaRunResult,
} from "./types";
import {
  completionBody,
  makeInput,
  makeManifest,
  makeOutput,
} from "./fixtures.test-utils";
import {
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_TOOL_POLICY_V2,
  promptSpecHash,
  toolPolicyHash,
} from "./promptSpec";

type FetchStep = Error | {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
};

type TimedFetchStep =
  | { delayMs: number; error: Error }
  | {
      delayMs: number;
      body: unknown;
      status?: number;
      headers?: Record<string, string>;
    };

function queuedFetch(...steps: FetchStep[]): {
  fetch: typeof fetch;
  bodies: Array<Record<string, unknown>>;
  calls: () => number;
  noFallbackHeaders: () => Array<string | null>;
  timeoutHeaders: () => Array<string | null>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  const timeoutHeaders: Array<string | null> = [];
  const noFallbackHeaders: Array<string | null> = [];
  let callCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    callCount += 1;
    const headers = input instanceof Request
      ? input.headers
      : new Headers(init?.headers);
    timeoutHeaders.push(
      headers.get("x-stainless-timeout"),
    );
    noFallbackHeaders.push(headers.get("x-gonka-no-fallback"));
    if (typeof init?.body === "string") {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const step = steps.shift();
    if (!step) throw new Error("unexpected network call");
    if (step instanceof Error) throw step;

    return new Response(JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { "content-type": "application/json", ...step.headers },
    });
  };

  return {
    fetch: fetchImpl,
    bodies,
    calls: () => callCount,
    noFallbackHeaders: () => noFallbackHeaders,
    timeoutHeaders: () => timeoutHeaders,
  };
}

function timedQueuedFetch(...steps: TimedFetchStep[]): {
  fetch: typeof fetch;
  bodies: Array<Record<string, unknown>>;
  calls: () => number;
} {
  const bodies: Array<Record<string, unknown>> = [];
  let callCount = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    callCount += 1;
    if (typeof init?.body === "string") {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const step = steps.shift();
    if (!step) return Promise.reject(new Error("unexpected network call"));
    const signal = input instanceof Request ? input.signal : init?.signal;

    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        if ("error" in step) {
          reject(step.error);
          return;
        }
        resolve(new Response(JSON.stringify(step.body), {
          status: step.status ?? 200,
          headers: { "content-type": "application/json", ...step.headers },
        }));
      }, step.delayMs);

      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  return { fetch: fetchImpl, bodies, calls: () => callCount };
}

function dependencies(fetchImpl: typeof fetch): GonkaAdapterDependencies {
  return {
    fetch: fetchImpl,
    sleep: async () => undefined,
    random: () => 0,
  };
}

function asRunResult(value: unknown): GonkaRunResult {
  if (!isGonkaRunResult(value)) throw new Error("expected a GonkaRunResult");
  return value;
}

async function expectRunError(promise: Promise<unknown>): Promise<GonkaRunError> {
  try {
    await promise;
    throw new Error("expected the Gonka run to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GonkaRunError);
    return error as GonkaRunError;
  }
}

function completeResearch(
  adapter: ReturnType<typeof createGonkaAdapter>,
  attempts: GonkaAttemptRecord[],
  timeoutMs?: number,
) {
  return adapter.complete({
    manifest: makeManifest(),
    messages: [{ role: "user", content: "u" }],
    kind: "PRIMARY",
    jsonMode: true,
    input: makeInput({ promptVersion: "2" }),
    attempts,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createGonkaAdapter", () => {
  it("complete() records one attempt per call and returns the assistant content", async () => {
    const content = '{"action":"search","query":"sui"}';
    const network = queuedFetch({
      body: completionBody(content, { id: "devshard-1-1" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const result = await adapter.complete({
      manifest: makeManifest(),
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.content).toBe(content);
    expect(result.gonkaRequestId).toBe("devshard-1-1");
    expect(result.request.messages).toHaveLength(2);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.audit.status).toBe("RECEIVED");
    expect(result.attempt).toBe(attempts[0]);
  });

  it("complete() honors a bounded per-call output token limit", async () => {
    const network = queuedFetch({
      body: completionBody('{"claim":"A checkable claim."}', {
        id: "devshard-bounded-output",
      }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const result = await adapter.complete({
      manifest: makeManifest(),
      messages: [{ role: "user", content: "extract one claim" }],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts: [],
      maxOutputTokens: 300,
    });

    expect(result.ok).toBe(true);
    expect(network.bodies[0]).toMatchObject({
      temperature: 0,
      max_tokens: 300,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.maxTokens).toBe(300);
  });

  it("enforces the requested model and records a gateway fallback notice", async () => {
    const content = '{"action":"search","query":"sui"}';
    const network = queuedFetch({
      body: completionBody(content, { id: "devshard-nf-1" }),
      // The gateway should never substitute once no-fallback is sent; if it
      // ever does, the notice must land in the audit rather than pass silently.
      headers: { "x-gonka-fallback": "deepseek -> minimax" },
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const result = await adapter.complete({
      manifest: makeManifest(),
      messages: [{ role: "user", content: "u" }],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts,
    });

    expect(result.ok).toBe(true);
    // Every outbound request pins the exact model at the gateway.
    expect(network.noFallbackHeaders()).toEqual(["true"]);
    expect(attempts[0]?.audit.gatewayFallback).toBe("deepseek -> minimax");
  });

  it("uses the dedicated research timeout for complete()", async () => {
    const network = queuedFetch({
      body: completionBody('{"action":"answer"}', { id: "devshard-timeout" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    await adapter.complete({
      manifest: makeManifest(),
      messages: [{ role: "user", content: "u" }],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts: [],
    });

    expect(network.timeoutHeaders()).toEqual(["90"]);
  });

  it("refuses a non-Gonka inference host", () => {
    expect(() =>
      createConfiguredGonkaAdapter({
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toThrowError(/gonkarouter\.io/);
  });

  it("rejects a non-positive research timeout", () => {
    expect(() =>
      createConfiguredGonkaAdapter({
        apiKey: "test-key",
        researchTimeoutMs: 0,
      }),
    ).toThrowError(RangeError);
  });

  it("complete() reports unsupported response_format and duplicate request ids", async () => {
    const duplicate = completionBody('{"action":"answer"}', {
      id: "devshard-duplicate",
    });
    const network = queuedFetch(
      {
        status: 400,
        body: {
          error: { message: "response_format json_object is unsupported" },
        },
      },
      { body: duplicate },
      { body: duplicate },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];
    const request = {
      manifest: makeManifest(),
      messages: [
        { role: "system" as const, content: "s" },
        { role: "user" as const, content: "u" },
      ],
      kind: "PRIMARY" as const,
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts,
    };

    const unsupported = await adapter.complete(request);
    expect(unsupported).toMatchObject({
      ok: false,
      status: "PROVIDER_ERROR",
      responseFormatUnsupported: true,
    });

    const first = await adapter.complete(request);
    expect(first.ok).toBe(true);
    const repeated = await adapter.complete(request);
    expect(repeated).toMatchObject({
      ok: false,
      status: "PROVIDER_ERROR",
      responseFormatUnsupported: false,
    });
    expect(attempts.at(-1)).toMatchObject({
      audit: { status: "PROVIDER_ERROR" },
      investigationFlags: ["DUPLICATE_GONKA_REQUEST_ID"],
    });
  });

  it.each([
    [
      "missing request id",
      { id: undefined },
      "MISSING_GONKA_REQUEST_ID",
    ],
    [
      "model mismatch",
      { id: "devshard-model-mismatch", model: "vendor/model-b" },
      "RESPONSE_MODEL_MISMATCH",
    ],
  ] as const)("complete() records %s as a provider error", async (_name, overrides, flag) => {
    const network = queuedFetch({
      body: completionBody('{"action":"search","query":"sui"}', overrides),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const result = await adapter.complete({
      manifest: makeManifest(),
      messages: [{ role: "user", content: "u" }],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "PROVIDER_ERROR",
      responseFormatUnsupported: false,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      audit: { status: "PROVIDER_ERROR" },
      investigationFlags: [flag],
    });
  });

  it("complete() returns TIMEOUT when the provider times out", async () => {
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    const network = queuedFetch(timeout);
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const result = await adapter.complete({
      manifest: makeManifest(),
      messages: [{ role: "user", content: "u" }],
      kind: "PRIMARY",
      jsonMode: true,
      input: makeInput({ promptVersion: "2" }),
      attempts,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "TIMEOUT",
      responseFormatUnsupported: false,
    });
    expect(attempts[0]?.audit.status).toBe("TIMEOUT");
  });

  it("does not start a hedge when the primary answers before the delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const network = timedQueuedFetch({
      delayMs: 5_000,
      body: completionBody('{"action":"answer"}', { id: "primary-fast" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(network.calls()).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      kind: "PRIMARY",
      audit: { requestedAtMs: 0, completedAtMs: 5_000, status: "RECEIVED" },
    });
  });

  it("uses the hedge when it answers before the slow primary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const network = timedQueuedFetch(
      {
        delayMs: 40_000,
        body: completionBody('{"action":"answer"}', { id: "primary-slow" }),
      },
      {
        delayMs: 3_000,
        body: completionBody('{"action":"answer"}', {
          id: "hedge-winner",
          system_fingerprint: "hedge-fingerprint",
        }),
        headers: {
          "x-request-id": "hedge-gateway-request",
          "x-devshard-id": "hedge-devshard",
        },
      },
    );
    const entries: unknown[] = [];
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      {
        ...dependencies(network.fetch),
        logger: createRedactingLogger((_level, entry) => entries.push(entry)),
      },
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts);
    await vi.advanceTimersByTimeAsync(28_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(network.calls()).toBe(2);
    expect(network.bodies[1]).toEqual(network.bodies[0]);
    expect(result.request.attemptKind).toBe("HEDGE");
    expect(result.gateway).toEqual({
      gatewayRequestId: "hedge-gateway-request",
      devshardId: "hedge-devshard",
      systemFingerprint: "hedge-fingerprint",
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      kind: "PRIMARY",
      audit: { requestedAtMs: 0, completedAtMs: 28_000, status: "PROVIDER_ERROR" },
      error: {
        category: "HEDGE_ABANDONED",
        message: "abandoned: the hedged request answered first",
      },
    });
    expect(attempts[1]).toMatchObject({
      kind: "HEDGE",
      audit: { requestedAtMs: 25_000, completedAtMs: 28_000, status: "RECEIVED" },
    });
    expect(entries).toHaveLength(2);
  });

  it("keeps the primary when it answers before the started hedge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const network = timedQueuedFetch(
      {
        delayMs: 30_000,
        body: completionBody('{"action":"answer"}', { id: "primary-winner" }),
      },
      {
        delayMs: 10_000,
        body: completionBody('{"action":"answer"}', { id: "hedge-slow" }),
      },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(network.calls()).toBe(2);
    expect(result.request.attemptKind).toBe("PRIMARY");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      kind: "HEDGE",
      audit: { requestedAtMs: 25_000, completedAtMs: 30_000 },
      error: { category: "HEDGE_ABANDONED" },
    });
    expect(attempts[1]).toMatchObject({
      kind: "PRIMARY",
      audit: { requestedAtMs: 0, completedAtMs: 30_000, status: "RECEIVED" },
    });
  });

  it("keeps timeout failures and the visible retry path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timeout = (): Error => Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    const network = timedQueuedFetch(
      { delayMs: 30_000, error: timeout() },
      { delayMs: 3_000, error: timeout() },
      { delayMs: 30_000, error: timeout() },
      { delayMs: 3_000, error: timeout() },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 1 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts);
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      status: "TIMEOUT",
      responseFormatUnsupported: false,
    });
    expect(network.calls()).toBe(4);
    expect(attempts.map((attempt) => attempt.kind)).toEqual([
      "HEDGE",
      "PRIMARY",
      "HEDGE",
      "RETRY",
    ]);
    expect(attempts.every((attempt) => attempt.audit.status === "TIMEOUT")).toBe(true);
  });

  it("disables hedging when hedgeAfterMs is zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const network = timedQueuedFetch({
      delayMs: 40_000,
      body: completionBody('{"action":"answer"}', { id: "hedge-disabled" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0, hedgeAfterMs: 0 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts);
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(network.calls()).toBe(1);
    expect(attempts).toHaveLength(1);
  });

  it("skips hedging when less than five seconds would remain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const network = timedQueuedFetch({
      delayMs: 28_000,
      body: completionBody('{"action":"answer"}', { id: "deadline-primary" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 0, hedgeAfterMs: 25_000 },
      dependencies(network.fetch),
    );
    const attempts: GonkaAttemptRecord[] = [];

    const pending = completeResearch(adapter, attempts, 29_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(network.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(network.calls()).toBe(1);
    expect(attempts).toHaveLength(1);
  });

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid hedgeAfterMs %s",
    (hedgeAfterMs) => {
      expect(() => createConfiguredGonkaAdapter({ apiKey: "test-key", hedgeAfterMs }))
        .toThrowError(RangeError);
    },
  );

  it("exposes the v2 research spec and tool policy hashes", () => {
    const adapter = createConfiguredGonkaAdapter({ apiKey: "test-key" });

    expect(adapter.promptSpec().version).toBe("2");
    expect(adapter.promptSpecHash()).toBe(
      promptSpecHash(DEFAULT_PROMPT_SPEC_V2),
    );
    expect(adapter.toolPolicy()).toEqual(DEFAULT_TOOL_POLICY_V2);
    expect(adapter.toolPolicyHash()).toBe(
      toolPolicyHash(DEFAULT_TOOL_POLICY_V2),
    );
    expect(adapter.legacyPromptSpec().version).toBe("1");
  });

  it("sends the documented deterministic Chat Completions request", async () => {
    const network = queuedFetch({
      body: completionBody(makeOutput(), {
        system_fingerprint: "gonka-fingerprint-1",
      }),
      headers: {
        "x-request-id": "gateway-request-1",
        "x-devshard-id": "devshard-65702",
      },
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", timeoutMs: 120_000, maxRetries: 1 },
      dependencies(network.fetch),
    );

    const result = asRunResult(await adapter.run(makeInput(), makeManifest()));
    const normalized = await adapter.normalizeResponse(result);
    const audit = await adapter.buildRunAudit(result);

    expect(network.calls()).toBe(1);
    expect(network.bodies[0]).toMatchObject({
      model: "vendor/model-a",
      temperature: 0,
      max_tokens: 4_096,
      response_format: { type: "json_object" },
    });
    expect(adapter.legacyPromptSpec()).toEqual(DEFAULT_PROMPT_SPEC_V1);
    expect(promptSpecHash(adapter.legacyPromptSpec())).toBe(
      promptSpecHash(DEFAULT_PROMPT_SPEC_V1),
    );
    expect(result.request).toEqual({
      model: "vendor/model-a",
      temperature: 0,
      maxTokens: 4_096,
      responseFormat: "json_object",
      attemptKind: "PRIMARY",
      messages: [
        {
          role: "system",
          content: DEFAULT_PROMPT_SPEC_V1.systemPrompt,
        },
        {
          role: "user",
          content: new TextDecoder().decode(canonicalJsonBytes(makeInput())),
        },
      ],
    });
    expect(result.gateway).toEqual({
      gatewayRequestId: "gateway-request-1",
      devshardId: "devshard-65702",
      systemFingerprint: "gonka-fingerprint-1",
    });
    expect(normalized).toEqual({
      gonkaRequestId: "msg_valid_1",
      modelId: "vendor/model-a",
      output: makeOutput(),
    });
    expect(audit).toMatchObject({
      gonkaRequestId: "msg_valid_1",
      modelId: "vendor/model-a",
      responseModelId: "vendor/model-a",
      status: "SCHEMA_VALID",
      inputTokens: 100,
      outputTokens: 50,
      gatewayRequestId: "gateway-request-1",
      devshardId: "devshard-65702",
      systemFingerprint: "gonka-fingerprint-1",
    });
    expect(audit.inputHash).toBe(toHex(blake2b256(canonicalJsonBytes(makeInput()))));
    expect(audit.outputHash).toBe(toHex(blake2b256(canonicalJsonBytes(makeOutput()))));
  });

  it("uses one visible repair-only attempt after malformed JSON", async () => {
    const network = queuedFetch(
      { body: completionBody("{not json", { id: "msg_bad" }) },
      { body: completionBody(makeOutput(), { id: "msg_repaired" }) },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 1 },
      dependencies(network.fetch),
    );

    const result = asRunResult(await adapter.run(makeInput(), makeManifest()));

    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "INVALID_SCHEMA",
      "SCHEMA_VALID",
    ]);
    expect(result.attempts.map((attempt) => attempt.kind)).toEqual([
      "PRIMARY",
      "REPAIR",
    ]);
    expect(result.request.attemptKind).toBe("REPAIR");
    expect(result.attempts[0]?.audit.runId).not.toBe(result.attempts[1]?.audit.runId);
    expect(JSON.stringify(network.bodies[1]?.messages)).toMatch(/repair/i);
  });

  it("fails after the single repair also violates the schema", async () => {
    const network = queuedFetch(
      { body: completionBody("{bad", { id: "msg_bad_1" }) },
      { body: completionBody("{still bad", { id: "msg_bad_2" }) },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const error = await expectRunError(adapter.run(makeInput(), makeManifest()));

    expect(error.result.attempts).toHaveLength(2);
    expect(error.result.attempts.every((attempt) => attempt.audit.status === "INVALID_SCHEMA"))
      .toBe(true);
  });

  it.each([429, 500, 503])(
    "keeps HTTP %i and the successful retry as separate visible attempts",
    async (status) => {
      const network = queuedFetch(
        {
          status,
          body: { error: { message: "temporary", type: "provider_error" } },
        },
        { body: completionBody() },
      );
      const adapter = createGonkaAdapter(
        { apiKey: "test-key", maxRetries: 1 },
        dependencies(network.fetch),
      );

      const result = asRunResult(await adapter.run(makeInput(), makeManifest()));

      expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
        "PROVIDER_ERROR",
        "SCHEMA_VALID",
      ]);
      expect(result.attempts.map((attempt) => attempt.kind)).toEqual([
        "PRIMARY",
        "RETRY",
      ]);
      expect(result.attempts[0]?.audit.runId).not.toBe(result.attempts[1]?.audit.runId);
      expect(network.calls()).toBe(2);
    },
  );

  it("marks timeout retries as TIMEOUT", async () => {
    const firstTimeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const secondTimeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const network = queuedFetch(firstTimeout, secondTimeout);
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 1 },
      dependencies(network.fetch),
    );

    const error = await expectRunError(adapter.run(makeInput(), makeManifest()));

    expect(error.result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "TIMEOUT",
      "TIMEOUT",
    ]);
    expect(network.calls()).toBe(2);
  });

  it("does not retry an unknown-model 400", async () => {
    const network = queuedFetch({
      status: 400,
      body: { error: { message: "unknown model", code: "model_not_found" } },
    });
    const entries: unknown[] = [];
    const adapter = createGonkaAdapter(
      { apiKey: "test-key", maxRetries: 1 },
      {
        ...dependencies(network.fetch),
        logger: createRedactingLogger((_level, entry) => entries.push(entry)),
      },
    );

    const error = await expectRunError(adapter.run(makeInput(), makeManifest()));

    expect(error.result.attempts).toHaveLength(1);
    expect(network.calls()).toBe(1);
    expect(entries).toEqual([
      expect.objectContaining({
        status: "PROVIDER_ERROR",
        errorCategory: "HTTP_ERROR",
        httpStatus: 400,
      }),
    ]);
  });

  it("falls back only when JSON response_format is unsupported", async () => {
    const network = queuedFetch(
      {
        status: 400,
        body: { error: { message: "response_format json_object is unsupported" } },
      },
      { body: completionBody() },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const result = asRunResult(await adapter.run(makeInput(), makeManifest()));

    expect(result.attempts.map((attempt) => attempt.kind)).toEqual([
      "PRIMARY",
      "JSON_PROMPT_FALLBACK",
    ]);
    expect(result.request.responseFormat).toBe("none");
    expect(result.request.attemptKind).toBe("JSON_PROMPT_FALLBACK");
    expect(network.bodies[1]).not.toHaveProperty("response_format");
    expect(JSON.stringify(network.bodies[1]?.messages)).toMatch(/JSON only/i);
  });

  it("rejects a missing Gonka Request ID", async () => {
    const body = completionBody();
    delete body.id;
    const network = queuedFetch({ body });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const error = await expectRunError(adapter.run(makeInput(), makeManifest()));

    expect(error.result.attempts[0]).toMatchObject({
      audit: { status: "PROVIDER_ERROR", gonkaRequestId: "" },
      investigationFlags: ["MISSING_GONKA_REQUEST_ID"],
    });
  });

  it("fails closed when the response model differs from the manifest", async () => {
    const network = queuedFetch({
      body: completionBody(makeOutput(), { model: "vendor/model-b" }),
    });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const error = await expectRunError(adapter.run(makeInput(), makeManifest()));

    expect(error.result.attempts[0]).toMatchObject({
      audit: { status: "PROVIDER_ERROR", responseModelId: "vendor/model-b" },
      investigationFlags: ["RESPONSE_MODEL_MISMATCH"],
    });
  });

  it.each([
    ["missing", undefined, "MISSING_TOKEN_USAGE"],
    [
      "malformed",
      { prompt_tokens: "100", completion_tokens: -1, total_tokens: 99 },
      "MALFORMED_TOKEN_USAGE",
    ],
  ])("records %s token usage without trusting it", async (_name, usage, flag) => {
    const network = queuedFetch({ body: completionBody(makeOutput(), { usage }) });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const result = asRunResult(await adapter.run(makeInput(), makeManifest()));
    const attempt = result.attempts[0];

    expect(attempt?.audit.inputTokens).toBeUndefined();
    expect(attempt?.audit.outputTokens).toBeUndefined();
    expect(attempt?.investigationFlags).toContain(flag);
  });

  it("flags a duplicate Request ID across distinct runs", async () => {
    const network = queuedFetch(
      { body: completionBody() },
      { body: completionBody() },
    );
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    await adapter.run(makeInput(), makeManifest());
    const error = await expectRunError(
      adapter.run(makeInput({ runId: `0x${"31".repeat(32)}` }), makeManifest()),
    );

    expect(error.result.attempts[0]?.investigationFlags).toContain(
      "DUPLICATE_GONKA_REQUEST_ID",
    );
  });

  it("returns RECEIVED when auditing an unprocessed raw response", async () => {
    const network = queuedFetch({ body: completionBody() });
    const adapter = createGonkaAdapter(
      { apiKey: "test-key" },
      dependencies(network.fetch),
    );

    const audit = await adapter.buildRunAudit(completionBody());

    expect(audit.status).toBe("RECEIVED");
    expect(audit.gonkaRequestId).toBe("msg_valid_1");
  });
});

describe("extractJsonObject", () => {
  it("parses clean JSON directly", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts JSON after reasoning prose", () => {
    const content = '**Analysis:** thinking about {braces} here.\n\n{"outcome":"YES","n":2}';
    expect(extractJsonObject(content)).toEqual({ outcome: "YES", n: 2 });
  });

  it("extracts fenced JSON", () => {
    expect(extractJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("handles braces inside strings", () => {
    expect(extractJsonObject('preamble {"text":"a } b { c","k":1}')).toEqual({
      text: "a } b { c",
      k: 1,
    });
  });

  it("throws when no object exists", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });

  it("ignores JSON drafts inside <think> blocks (MiniMax-M2.7)", () => {
    const content =
      '<think>Draft entry: {"check":"c","evidenceIds":[],"assessment":"MIXED","finding":"f"}</think>\n' +
      '{"outcome":"UNSURE","confidenceBps":4000}';
    expect(extractJsonObject(content)).toEqual({ outcome: "UNSURE", confidenceBps: 4000 });
  });

  it("returns the root object, not a final nested entry (backward-scan regression)", () => {
    const content =
      'reasoning first drafts {"check":"warmup","evidenceIds":[],"assessment":"MIXED","finding":"draft"} then answers\n' +
      '{"outcome":"YES","confidenceBps":9000,"publicReasoningTrace":[{"check":"last","evidenceIds":["ev-1"],"assessment":"SUPPORTS","finding":"tail entry"}]}';
    const extracted = extractJsonObject(content) as Record<string, unknown>;
    expect(extracted.outcome).toBe("YES");
    expect(Array.isArray(extracted.publicReasoningTrace)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { blake2b256, toHex } from "../protocol/hash";
import {
  createGonkaAdapterWithDependencies as createGonkaAdapter,
  type GonkaAdapterDependencies,
} from "./adapter";
import { canonicalJsonBytes } from "./canonical";
import { createRedactingLogger } from "./logger";
import {
  GonkaRunError,
  isGonkaRunResult,
  type GonkaRunResult,
} from "./types";
import {
  completionBody,
  makeInput,
  makeManifest,
  makeOutput,
} from "./fixtures.test-utils";

type FetchStep = Error | { body: unknown; status?: number };

function queuedFetch(...steps: FetchStep[]): {
  fetch: typeof fetch;
  bodies: Array<Record<string, unknown>>;
  calls: () => number;
} {
  const bodies: Array<Record<string, unknown>> = [];
  let callCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    callCount += 1;
    if (typeof init?.body === "string") {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const step = steps.shift();
    if (!step) throw new Error("unexpected network call");
    if (step instanceof Error) throw step;

    return new Response(JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { "content-type": "application/json" },
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

describe("createGonkaAdapter", () => {
  it("sends the documented deterministic Chat Completions request", async () => {
    const network = queuedFetch({ body: completionBody() });
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

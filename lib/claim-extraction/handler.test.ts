import { describe, expect, it } from "vitest";
import type { GonkaCompletionRequest } from "../gonka";
import {
  buildHandler,
  selectProseWindow,
  type ClaimExtractionRuntime,
} from "./handler";

const encoder = new TextEncoder();

function request(body: unknown): Request {
  return new Request("http://localhost/api/extract-claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function runtime(content: string): ClaimExtractionRuntime {
  const bytes = encoder.encode(
    "<html><head><title>Source title</title></head><body>Acme reported revenue.</body></html>",
  );
  return {
    modelId: "vendor/model-a",
    retrievalPolicy: {
      maxBytes: 5_000_000,
      maxRedirects: 3,
      timeoutMs: 15_000,
      allowedMime: ["text/html", "text/plain", "application/json"],
    },
    fetcher: async () => ({
      httpStatus: 200,
      finalUrl: "https://example.com/final",
      retrievedAt: Date.UTC(2026, 7, 31),
      mimeType: "text/html",
      byteLength: bytes.byteLength,
      contentHash: new Uint8Array(32),
      bytes,
    }),
    adapter: {
      complete: async () => ({
        ok: true,
        content,
        gonkaRequestId: "devshard-completion-1",
        gateway: { gatewayRequestId: "gateway-request-1" },
      }),
    },
  };
}

function handlerFor(value: ClaimExtractionRuntime) {
  return buildHandler({
    getRuntime: async () => value,
    requirePublicWritesEnabled: () => null,
    rateLimitPublic: () => null,
  });
}

describe("extract claim handler", () => {
  it.each([
    ["missing url", {}],
    ["non-string url", { url: 42 }],
    ["ftp URL", { url: "ftp://example.com/story" }],
    ["javascript URL", { url: "javascript:alert(1)" }],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await handlerFor(runtime("{}"))(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_URL",
      message: expect.any(String),
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const malformed = new Request("http://localhost/api/extract-claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await handlerFor(runtime("{}"))(malformed);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_URL",
      message: expect.any(String),
    });
  });

  it("returns 502 when the guarded fetcher rejects", async () => {
    const value = runtime("{}");
    value.fetcher = async () => {
      throw new Error("guarded fetch failed");
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "FETCH_FAILED",
      message: expect.any(String),
    });
  });

  it("returns 502 when the guarded fetcher returns a safety rejection", async () => {
    const value = runtime("{}");
    value.fetcher = async () => ({
      rejectionCode: "DISALLOWED_NETWORK_TARGET",
      detail: "target is not public",
    });

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "FETCH_FAILED",
      message: expect.any(String),
    });
  });

  it("returns 422 when the model returns a null claim", async () => {
    const response = await handlerFor(
      runtime(JSON.stringify({ claim: null, reason: "No factual assertion." })),
    )(request({ url: "https://example.com/story" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "NO_CLAIM_FOUND",
      message: expect.any(String),
    });
  });

  it("repairs malformed model JSON once", async () => {
    const value = runtime("not JSON");
    const malformedContent = '{"claim{":" \t: "El Salvador became..."}';
    const completionRequests: GonkaCompletionRequest[] = [];
    value.adapter = {
      complete: async (candidate) => {
        completionRequests.push(candidate);
        if (completionRequests.length === 1) {
          return {
            ok: true,
            content: malformedContent,
            gonkaRequestId: "devshard-primary-malformed",
            gateway: { gatewayRequestId: "gateway-primary-malformed" },
          };
        }
        return {
          ok: true,
          content: JSON.stringify({
            claim: "El Salvador adopted Bitcoin as legal tender in 2021.",
            reason: "The assertion names an actor, action, and year.",
          }),
          gonkaRequestId: "devshard-repaired",
          gateway: { gatewayRequestId: "gateway-repaired" },
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claim: "El Salvador adopted Bitcoin as legal tender in 2021.",
      sourceUrl: "https://example.com/final",
      modelId: "vendor/model-a",
      gonkaRequestId: "devshard-repaired",
      gatewayRequestId: "gateway-repaired",
    });
    expect(completionRequests).toHaveLength(2);
    expect(completionRequests[1]).toMatchObject({
      kind: "REPAIR",
      jsonMode: true,
    });
    expect(completionRequests[1]?.messages).toEqual(
      expect.arrayContaining([
        { role: "assistant", content: malformedContent },
        {
          role: "user",
          content: expect.stringContaining(
            "Repair the prior response into JSON only",
          ),
        },
      ]),
    );
  });

  it("returns 422 when the single repair is also malformed", async () => {
    const value = runtime("not JSON");
    const completionRequests: GonkaCompletionRequest[] = [];
    value.adapter = {
      complete: async (candidate) => {
        completionRequests.push(candidate);
        return {
          ok: true,
          content: completionRequests.length === 1 ? "{bad" : "{still bad",
          gonkaRequestId: `devshard-malformed-${completionRequests.length}`,
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "NO_CLAIM_FOUND",
      message: expect.any(String),
    });
    expect(completionRequests).toHaveLength(2);
  });

  it("returns the claim and captured request IDs", async () => {
    const value = runtime(
      JSON.stringify({
        claim: "Acme reported revenue of $5 million in 2025.",
        reason: "The assertion identifies a company, amount, and year.",
      }),
    );
    let completionRequest: GonkaCompletionRequest | undefined;
    value.adapter = {
      complete: async (candidate) => {
        completionRequest = candidate;
        return {
          ok: true,
          content: JSON.stringify({
            claim: "  Acme reported revenue of $5 million in 2025.  ",
            reason: "The assertion identifies a company, amount, and year.",
          }),
          gonkaRequestId: "devshard-completion-42",
          gateway: { gatewayRequestId: "gateway-request-42" },
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claim: "Acme reported revenue of $5 million in 2025.",
      sourceUrl: "https://example.com/final",
      modelId: "vendor/model-a",
      gonkaRequestId: "devshard-completion-42",
      gatewayRequestId: "gateway-request-42",
    });
    expect(completionRequest?.manifest.modelId).toBe("vendor/model-a");
    expect(completionRequest?.maxOutputTokens).toBe(1_500);
    expect(completionRequest?.messages[1]?.content).toContain(
      "Acme reported revenue.",
    );
  });

  it("limits recorded page text to 12000 characters", async () => {
    const value = runtime(
      JSON.stringify({
        claim: "Acme reported revenue of $5 million in 2025.",
        reason: "The assertion is checkable.",
      }),
    );
    const bytes = encoder.encode("x".repeat(13_000));
    value.fetcher = async () => ({
      httpStatus: 200,
      finalUrl: "https://example.com/long",
      retrievedAt: Date.UTC(2026, 7, 31),
      mimeType: "text/plain",
      byteLength: bytes.byteLength,
      contentHash: new Uint8Array(32),
      bytes,
    });
    let completionRequest: GonkaCompletionRequest | undefined;
    value.adapter = {
      complete: async (candidate) => {
        completionRequest = candidate;
        return {
          ok: true,
          content: JSON.stringify({
            claim: "Acme reported revenue of $5 million in 2025.",
            reason: "The assertion is checkable.",
          }),
          gonkaRequestId: "devshard-long-page",
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/long" }),
    );
    const userMessage = completionRequest?.messages[1]?.content;
    const modelInput = userMessage === undefined
      ? undefined
      : JSON.parse(userMessage) as unknown;

    expect(response.status).toBe(200);
    expect(modelInput).toMatchObject({ pageText: "x".repeat(12_000) });
  });

  it("returns the public rate limit response before loading the runtime", async () => {
    let runtimeLoaded = false;
    const handler = buildHandler({
      getRuntime: async () => {
        runtimeLoaded = true;
        return runtime("{}");
      },
      requirePublicWritesEnabled: () => null,
      rateLimitPublic: () => Response.json(
        { error: "rate_limited", message: "retry later" },
        { status: 429 },
      ),
    });

    const response = await handler(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(429);
    expect(runtimeLoaded).toBe(false);
  });

  it("returns 503 when the engine gateway is not wired", async () => {
    const handler = buildHandler({
      getRuntime: async () => {
        const error = new Error("missing gateway configuration");
        error.name = "EngineNotWiredError";
        throw error;
      },
      requirePublicWritesEnabled: () => null,
      rateLimitPublic: () => null,
    });

    const response = await handler(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "ENGINE_NOT_WIRED",
    });
  });
});

describe("selectProseWindow", () => {
  it("starts at the first substantial prose line", () => {
    const navigation = Array.from(
      { length: 200 },
      (_, index) => `Navigation item ${index}`,
    ).join("\n");
    const prose =
      "Bitcoin is a decentralized digital currency whose transaction history is recorded on a public ledger, and its network validates transfers without relying on a central bank or single administrator.";
    const text = `${navigation}\n${prose}\nReferences`;

    expect(selectProseWindow(text, 500)).toBe(`${prose}\nReferences`);
  });

  it("falls back to the head when no line contains substantial prose", () => {
    const text = "Home\nContents\nReferences";

    expect(selectProseWindow(text, 12)).toBe(text.slice(0, 12));
  });

  it("never exceeds the supplied character limit", () => {
    const text = `${"Navigation\n".repeat(100)}${"p".repeat(200)}`;

    expect(selectProseWindow(text, 37)).toHaveLength(37);
  });
});

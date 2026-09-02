import { describe, expect, it } from "vitest";
import type { GonkaCompletionRequest } from "../gonka";
import { blake2b256, toHex } from "../protocol";
import {
  buildHandler,
  selectProseWindow,
  type ClaimExtractionRuntime,
} from "./handler";

const encoder = new TextEncoder();

const acmeClaim = {
  claim: "Acme reported revenue of $5 million in 2025.",
  reason: "The assertion identifies a company, amount, and year.",
  quote: "Acme reported revenue.",
};

function modelReply(
  claims: Array<{ claim: string; reason: string; quote: string }> = [acmeClaim],
  language = "en",
): string {
  return JSON.stringify({ claims, language });
}

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
    ["neither URL nor text", {}],
    [
      "both URL and text",
      { url: "https://example.com/story", text: "x".repeat(40) },
    ],
    ["non-string URL", { url: 42 }],
    ["text shorter than 40 trimmed characters", { text: "x".repeat(39) }],
    ["text longer than 20000 trimmed characters", { text: "x".repeat(20_001) }],
    ["ftp URL", { url: "ftp://example.com/story" }],
    ["javascript URL", { url: "javascript:alert(1)" }],
    ["an unexpected request field", { url: "https://example.com", extra: true }],
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

  it("extracts pasted text without calling the guarded fetcher", async () => {
    const pastedText =
      "  Acme reported revenue of $5 million in 2025 after publishing its audited annual results.  ";
    const trimmedText = pastedText.trim();
    const expectedHash = toHex(blake2b256(encoder.encode(trimmedText)));
    const value = runtime(modelReply());
    let fetchCalled = false;
    let completionRequest: GonkaCompletionRequest | undefined;
    value.fetcher = async () => {
      fetchCalled = true;
      throw new Error("text extraction must not fetch");
    };
    value.adapter = {
      complete: async (candidate) => {
        completionRequest = candidate;
        return {
          ok: true,
          content: modelReply(),
          gonkaRequestId: "devshard-pasted-text",
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(request({ text: pastedText }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claims: [acmeClaim],
      language: "en",
      claim: acmeClaim.claim,
      modelId: "vendor/model-a",
      gonkaRequestId: "devshard-pasted-text",
    });
    expect(fetchCalled).toBe(false);
    expect(completionRequest?.input).toMatchObject({
      submission: {
        kind: "TEXT",
        submittedTextHash: expectedHash,
        submittedUrls: [],
      },
      evidenceManifest: {
        root: expectedHash,
        items: [
          {
            evidenceId: "pasted-text",
            contentHash: expectedHash,
            excerpt: trimmedText,
          },
        ],
      },
    });
  });

  it.each([40, 20_000])(
    "accepts pasted text at the inclusive %i character bound",
    async (length) => {
      const value = runtime(modelReply());
      value.fetcher = async () => {
        throw new Error("text extraction must not fetch");
      };

      const response = await handlerFor(value)(
        request({ text: "x".repeat(length) }),
      );

      expect(response.status).toBe(200);
    },
  );

  it("returns 404 when the model returns no claims", async () => {
    const response = await handlerFor(runtime(modelReply([])))(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "NO_CLAIM_FOUND",
      message: expect.any(String),
    });
  });

  it("returns up to three claims in source order", async () => {
    const claims = [
      {
        claim: "Acme opened its first factory in Penang in 2023.",
        reason: "The opening date and place can be checked.",
        quote: "In 2023, Acme opened its first Penang factory.",
      },
      {
        claim: "Acme employed 800 people in Penang in 2024.",
        reason: "The headcount is a dated factual assertion.",
        quote: "The Penang site employed 800 people in 2024.",
      },
      {
        claim: "Acme exported 60 percent of its output in 2025.",
        reason: "The export share and year are measurable.",
        quote: "Exports reached 60 percent of output in 2025.",
      },
    ];

    const response = await handlerFor(runtime(modelReply(claims, "en-MY")))(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claims,
      language: "en-MY",
      claim: claims[0]?.claim,
      sourceUrl: "https://example.com/final",
    });
  });

  it.each([
    {
      case: "a newline in the claim",
      candidate: { ...acmeClaim, claim: "Acme reported\nrevenue in 2025." },
    },
    {
      case: "a carriage return in the claim",
      candidate: { ...acmeClaim, claim: "Acme reported\rrevenue in 2025." },
    },
    {
      case: "a trailing question mark",
      candidate: { ...acmeClaim, claim: "Did Acme report revenue in 2025?  " },
    },
    {
      case: "a claim longer than 1000 characters",
      candidate: { ...acmeClaim, claim: "x".repeat(1_001) },
    },
    {
      case: "an empty reason",
      candidate: { ...acmeClaim, reason: "   " },
    },
    {
      case: "a reason longer than 2000 characters",
      candidate: { ...acmeClaim, reason: "x".repeat(2_001) },
    },
    {
      case: "a quote longer than 300 characters",
      candidate: { ...acmeClaim, quote: "x".repeat(301) },
    },
  ])("rejects $case", async ({ candidate }) => {
    const value = runtime(modelReply([candidate]));
    let completionCount = 0;
    value.adapter = {
      complete: async () => {
        completionCount += 1;
        return {
          ok: true,
          content: modelReply([candidate]),
          gonkaRequestId: `devshard-invalid-${completionCount}`,
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(404);
    expect(completionCount).toBe(2);
  });

  it("falls back to und for an invalid language tag", async () => {
    const value = runtime(modelReply([acmeClaim], "not a language tag"));
    let completionCount = 0;
    value.adapter = {
      complete: async () => {
        completionCount += 1;
        return {
          ok: true,
          content: modelReply([acmeClaim], "not a language tag"),
          gonkaRequestId: "devshard-invalid-language",
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ language: "und" });
    expect(completionCount).toBe(1);
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
          content: modelReply([
            {
              claim: "El Salvador adopted Bitcoin as legal tender in 2021.",
              reason: "The assertion names an actor, action, and year.",
              quote: "El Salvador adopted Bitcoin as legal tender in 2021.",
            },
          ], "es"),
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
      claims: [
        {
          claim: "El Salvador adopted Bitcoin as legal tender in 2021.",
          reason: "The assertion names an actor, action, and year.",
          quote: "El Salvador adopted Bitcoin as legal tender in 2021.",
        },
      ],
      language: "es",
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

  it("repairs a reply with more than three claims", async () => {
    const claims = Array.from({ length: 4 }, (_, index) => ({
      claim: `Acme reported metric ${index + 1} in 2025.`,
      reason: `Metric ${index + 1} can be checked.`,
      quote: `Metric ${index + 1} was reported in 2025.`,
    }));
    const value = runtime(modelReply(claims));
    const completionRequests: GonkaCompletionRequest[] = [];
    value.adapter = {
      complete: async (candidate) => {
        completionRequests.push(candidate);
        return {
          ok: true,
          content: modelReply(
            completionRequests.length === 1 ? claims : claims.slice(0, 3),
          ),
          gonkaRequestId: `devshard-cap-${completionRequests.length}`,
          gateway: {},
        };
      },
    };

    const response = await handlerFor(value)(
      request({ url: "https://example.com/story" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claims: claims.slice(0, 3),
      claim: claims[0]?.claim,
    });
    expect(completionRequests).toHaveLength(2);
    expect(completionRequests[1]?.kind).toBe("REPAIR");
  });

  it("returns 404 when the single repair is also malformed", async () => {
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "NO_CLAIM_FOUND",
      message: expect.any(String),
    });
    expect(completionRequests).toHaveLength(2);
  });

  it("returns the claim and captured request IDs", async () => {
    const value = runtime(modelReply());
    let completionRequest: GonkaCompletionRequest | undefined;
    value.adapter = {
      complete: async (candidate) => {
        completionRequest = candidate;
        return {
          ok: true,
          content: modelReply([
            {
              claim: "  Acme reported revenue of $5 million in 2025.  ",
              reason: "  The assertion identifies a company, amount, and year.  ",
              quote: "  Acme reported revenue.  ",
            },
          ]),
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
      claims: [acmeClaim],
      language: "en",
      claim: "Acme reported revenue of $5 million in 2025.",
      sourceUrl: "https://example.com/final",
      modelId: "vendor/model-a",
      gonkaRequestId: "devshard-completion-42",
      gatewayRequestId: "gateway-request-42",
    });
    expect(completionRequest?.manifest.modelId).toBe("vendor/model-a");
    expect(completionRequest?.maxOutputTokens).toBe(2_000);
    expect(completionRequest?.messages[1]?.content).toContain(
      "Acme reported revenue.",
    );
    expect(completionRequest?.input).toMatchObject({
      submission: {
        kind: "URL",
        submittedUrls: ["https://example.com/final"],
      },
      evidenceManifest: {
        items: [{ evidenceId: "source-page" }],
      },
    });
  });

  it("limits recorded page text to 12000 characters", async () => {
    const value = runtime(modelReply());
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
          content: modelReply(),
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

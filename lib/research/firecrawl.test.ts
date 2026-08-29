import { describe, expect, it, vi } from "vitest";

import { createFirecrawlProvider, FIRECRAWL_CLOUD_URL } from "./firecrawl";
import { ResearchProviderError } from "./provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("firecrawl provider", () => {
  it("searches through /v2/search with a bearer key and maps web results", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${FIRECRAWL_CLOUD_URL}/v2/search`);
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer fc-test",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "sui walrus",
        limit: 5,
        sources: ["web"],
        timeout: 60_000,
      });
      return jsonResponse({
        success: true,
        data: {
          web: [
            {
              title: " Walrus docs ",
              description: "Decentralized storage on Sui. ".repeat(20),
              url: "https://docs.wal.app/",
              publishedDate: "2026-08-20",
            },
            { title: "Sui", description: "Layer 1", url: "https://sui.io" },
            { title: "Bad", description: "Skip me", url: "/relative" },
          ],
        },
      });
    });
    const provider = createFirecrawlProvider({
      apiKey: "fc-test",
      fetch: fetchMock as typeof fetch,
    });

    expect(provider.mode).toBe("cloud");
    const results = await provider.search("sui walrus", {
      limit: 5,
      timeoutMs: 60_000,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      rank: 1,
      url: "https://docs.wal.app/",
      title: "Walrus docs",
      publishedAt: "2026-08-20",
    });
    expect(results[0]!.snippet.length).toBeLessThanOrEqual(200);
    expect(results[1]!.rank).toBe(2);
  });

  it("opens through /v2/scrape and maps markdown plus metadata", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("http://firecrawl.internal:3002/v2/scrape");
      expect(JSON.parse(String(init?.body))).toEqual({
        url: "https://sui.io/",
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 60_000,
      });
      return jsonResponse({
        success: true,
        data: {
          markdown: "# Sui\n\nHello",
          metadata: {
            title: "Sui",
            sourceURL: "https://sui.io/",
            statusCode: 200,
          },
        },
      });
    });
    const provider = createFirecrawlProvider({
      apiKey: "fc-test",
      baseUrl: "http://firecrawl.internal:3002/",
      fetch: fetchMock as typeof fetch,
      now: () => 1_000,
    });

    expect(provider.mode).toBe("selfhost");
    await expect(
      provider.open("https://sui.io/", { timeoutMs: 60_000 }),
    ).resolves.toEqual({
      url: "https://sui.io/",
      finalUrl: "https://sui.io/",
      title: "Sui",
      markdown: "# Sui\n\nHello",
      fetchedAtMs: 1_000,
      statusCode: 200,
    });
  });

  it("maps failures to typed errors that never carry the key", async () => {
    const provider = createFirecrawlProvider({
      apiKey: "fc-secret",
      fetch: (async () =>
        jsonResponse(
          { success: false, error: "Payment required for fc-secret" },
          402,
        )) as typeof fetch,
    });

    const error = await provider
      .search("x", { limit: 1, timeoutMs: 1_000 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResearchProviderError);
    expect((error as ResearchProviderError).kind).toBe("http");
    expect((error as ResearchProviderError).status).toBe(402);
    expect(String(error)).not.toContain("fc-secret");

    const empty = createFirecrawlProvider({
      apiKey: "fc-secret",
      fetch: (async () =>
        jsonResponse({ success: true, data: { markdown: "" } })) as typeof fetch,
    });
    await expect(
      empty.open("https://sui.io", { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "empty" });
  });

  it("distinguishes malformed, network, and timeout failures", async () => {
    const malformed = createFirecrawlProvider({
      apiKey: "fc-test",
      fetch: (async () =>
        jsonResponse({ success: true, data: { web: {} } })) as typeof fetch,
    });
    await expect(
      malformed.search("query", { limit: 1, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "invalid" });

    const network = createFirecrawlProvider({
      apiKey: "fc-test",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(
      network.search("query", { limit: 1, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "network" });

    const timeout = createFirecrawlProvider({
      apiKey: "fc-test",
      fetch: (async () => {
        throw new DOMException("aborted", "AbortError");
      }) as typeof fetch,
    });
    await expect(
      timeout.open("https://sui.io", { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
});

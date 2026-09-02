import {
  ResearchProviderError,
  type OpenedPage,
  type ResearchProvider,
  type SearchResult,
} from "./provider";

export const FIRECRAWL_CLOUD_URL = "https://api.firecrawl.dev";
/** A jury's searches and page opens cost a few dozen credits; below this the weather is not clear. */
export const FIRECRAWL_MIN_CREDITS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function redactKey(message: string, apiKey: string): string {
  return apiKey.length === 0 ? message : message.split(apiKey).join("[redacted]");
}

function responseErrorMessage(
  body: unknown,
  apiKey: string,
  fallback: string,
): string {
  const message = isRecord(body) && typeof body.error === "string"
    ? body.error
    : fallback;
  return redactKey(message, apiKey);
}

function normalizedBaseUrl(value: string): { url: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResearchProviderError(
      "invalid",
      "Firecrawl base URL must be an absolute HTTP URL",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResearchProviderError(
      "invalid",
      "Firecrawl base URL must use HTTP or HTTPS",
    );
  }
  parsed.hash = "";
  parsed.search = "";
  return { url: parsed.toString().replace(/\/+$/, ""), host: parsed.host };
}

export function createFirecrawlProvider(config: {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}): ResearchProvider {
  if (config.apiKey.length === 0) {
    throw new ResearchProviderError("invalid", "Firecrawl API key is required");
  }

  const base = normalizedBaseUrl(config.baseUrl ?? FIRECRAWL_CLOUD_URL);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  async function post(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(`${base.url}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new ResearchProviderError("timeout", "Firecrawl request timed out");
      }
      throw new ResearchProviderError("network", "Firecrawl request failed");
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) {
        throw new ResearchProviderError("http", "Firecrawl HTTP request failed", {
          status: response.status,
        });
      }
      throw new ResearchProviderError("invalid", "Firecrawl returned invalid JSON");
    }

    if (!response.ok) {
      throw new ResearchProviderError(
        "http",
        responseErrorMessage(payload, config.apiKey, "Firecrawl HTTP request failed"),
        { status: response.status },
      );
    }
    if (!isRecord(payload) || payload.success !== true) {
      throw new ResearchProviderError(
        "http",
        responseErrorMessage(payload, config.apiKey, "Firecrawl request was unsuccessful"),
        { status: response.status },
      );
    }
    return payload;
  }

  return {
    name: "firecrawl",
    mode: base.host === "api.firecrawl.dev" ? "cloud" : "selfhost",

    // The credit-usage endpoint is free and answers in well under a second,
    // so the weather can say "web search down" before a jury is drawn: a
    // 402 on every search left five jurors answering UNSURE with no evidence
    // (2026-09-03 05:00). A self-hosted Firecrawl has no credits: always ok.
    async probe(timeoutMs) {
      const startedAtMs = Date.now();
      if (base.host !== "api.firecrawl.dev") {
        return { ok: true, latencyMs: 0, status: "selfhost" };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base.url}/v2/team/credit-usage`, {
          method: "GET",
          headers: { authorization: `Bearer ${config.apiKey}` },
          signal: controller.signal,
        });
        const latencyMs = Math.max(0, Date.now() - startedAtMs);
        let payload: unknown = undefined;
        try {
          payload = await response.json();
        } catch {
          payload = undefined;
        }
        const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
        const remaining = typeof data?.remainingCredits === "number" ? data.remainingCredits : undefined;
        const ok = response.ok && remaining !== undefined && remaining >= FIRECRAWL_MIN_CREDITS;
        return {
          ok,
          latencyMs,
          status: String(response.status),
          ...(remaining === undefined ? {} : { detail: `${remaining} credits` }),
        };
      } catch (error) {
        const timedOut = controller.signal.aborted || isAbortError(error);
        return {
          ok: false,
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          status: timedOut ? "TIMEOUT" : "ERROR",
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async search(query, options) {
      const payload = await post(
        "/v2/search",
        {
          query,
          limit: options.limit,
          sources: ["web"],
          timeout: options.timeoutMs,
        },
        options.timeoutMs,
      );
      const data = isRecord(payload.data) ? payload.data : undefined;
      if (!data || !Array.isArray(data.web)) {
        throw new ResearchProviderError(
          "invalid",
          "Firecrawl search response omitted data.web",
        );
      }

      const results: SearchResult[] = [];
      for (const [index, item] of data.web.entries()) {
        if (!isRecord(item) || typeof item.url !== "string") continue;
        if (!isAbsoluteHttpUrl(item.url)) continue;

        const published = typeof item.date === "string"
          ? item.date
          : typeof item.publishedDate === "string"
            ? item.publishedDate
            : undefined;
        results.push({
          rank: index + 1,
          url: item.url,
          title: typeof item.title === "string"
            ? item.title.trim().slice(0, 200)
            : "",
          snippet: typeof item.description === "string"
            ? item.description.trim().slice(0, 200)
            : "",
          ...(published === undefined ? {} : { publishedAt: published }),
        });
      }
      return results;
    },

    async open(url, options): Promise<OpenedPage> {
      if (!isAbsoluteHttpUrl(url)) {
        throw new ResearchProviderError(
          "invalid",
          "Firecrawl can open only absolute HTTP URLs",
        );
      }
      const payload = await post(
        "/v2/scrape",
        {
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: options.timeoutMs,
        },
        options.timeoutMs,
      );
      const data = isRecord(payload.data) ? payload.data : undefined;
      if (!data || typeof data.markdown !== "string") {
        throw new ResearchProviderError(
          "invalid",
          "Firecrawl scrape response omitted markdown",
        );
      }
      if (data.markdown.trim().length === 0) {
        throw new ResearchProviderError("empty", "Firecrawl returned an empty page");
      }

      const metadata = isRecord(data.metadata) ? data.metadata : undefined;
      const title = typeof metadata?.title === "string"
        ? metadata.title.trim()
        : undefined;
      const finalUrl = typeof metadata?.sourceURL === "string"
        ? metadata.sourceURL
        : url;
      const statusCode = typeof metadata?.statusCode === "number"
        ? metadata.statusCode
        : undefined;
      return {
        url,
        finalUrl,
        ...(title === undefined ? {} : { title }),
        markdown: data.markdown,
        fetchedAtMs: now(),
        ...(statusCode === undefined ? {} : { statusCode }),
      };
    },
  };
}

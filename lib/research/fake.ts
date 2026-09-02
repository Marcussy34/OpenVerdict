import {
  ResearchProviderError,
  type ResearchProvider,
} from "./provider";

const FAKE_HOST = "fake.evidence.test";

function slugify(query: string): string {
  const slug = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "query" : slug;
}

export function createFakeResearchProvider(options?: {
  pageChars?: number;
  failHosts?: string[];
  /** Weather tests flip this; the fake provider is healthy by default. */
  probeOk?: boolean;
}): ResearchProvider & { setProbeOk(ok: boolean): void } {
  const pageChars = Math.max(0, options?.pageChars ?? 2_000);
  const failHosts = new Set(options?.failHosts ?? ["fail.evidence.test"]);
  let probeOk = options?.probeOk ?? true;

  return {
    name: "fake",
    mode: "fake",

    setProbeOk(ok: boolean) {
      probeOk = ok;
    },

    async probe() {
      return { ok: probeOk, latencyMs: 1, status: probeOk ? "200" : "402" };
    },

    async search(query, { limit }) {
      const slug = slugify(query);
      return Array.from({ length: Math.max(0, limit) }, (_, index) => {
        const rank = index + 1;
        return {
          rank,
          url: `https://${FAKE_HOST}/${slug}/${rank}`,
          title: `Result ${rank} for ${query}`,
          snippet: `Fake snippet ${rank} about ${query}.`,
        };
      });
    },

    async open(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ResearchProviderError("network", "Fake page URL is invalid");
      }
      if (parsed.hostname !== FAKE_HOST || failHosts.has(parsed.hostname)) {
        throw new ResearchProviderError("network", "Fake page host is unavailable");
      }

      const [slug = "evidence", rank = "1"] = parsed.pathname
        .split("/")
        .filter(Boolean);
      const title = `Result ${rank} for ${slug.replace(/-/g, " ")}`;
      const sentence = `This page discusses ${slug} in detail. `;
      let markdown = `# ${title}\n\nFake page for ${url}. `;
      while (markdown.length < pageChars) markdown += sentence;

      return {
        url,
        finalUrl: url,
        title,
        markdown: markdown.slice(0, pageChars),
        fetchedAtMs: 0,
        statusCode: 200,
      };
    },
  };
}

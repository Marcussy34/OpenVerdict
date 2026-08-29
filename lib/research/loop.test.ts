import { describe, expect, it, vi } from "vitest";

import { createAttemptAudit } from "../gonka/audit";
import { makeInput, makeManifest, makeOutput } from "../gonka/fixtures.test-utils";
import {
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_TOOL_POLICY_V2,
} from "../gonka/promptSpec";
import type {
  GonkaAttemptRecord,
  GonkaCompletion,
  GonkaCompletionRequest,
} from "../gonka/types";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  HexString,
  ProviderRequestRecord,
  ToolPolicyV2,
} from "../protocol/types";
import { normalizeUrl } from "./actions";
import { createFakeResearchProvider } from "./fake";
import {
  runResearchLoop,
  type PageStore,
  type StoredPage,
} from "./loop";
import type { ResearchProvider } from "./provider";
import {
  createSearchCache,
  discoveredEvidenceId,
  type SearchCache,
} from "./transcript";

const CLAIM_ID = `0x${"51".repeat(32)}`;
const JURY_SEAT_ID = `0x${"52".repeat(32)}` as HexString;
const PHASE = 1 as const;

type FailureScript = {
  status: "PROVIDER_ERROR" | "TIMEOUT";
  responseFormatUnsupported?: boolean;
};

type ScriptEntry = string | FailureScript;
type PageStorePage = Omit<StoredPage, "ref">;

function scriptedCompletion(entries: ScriptEntry[]): {
  complete: GonkaCompletion;
  requests: ProviderRequestRecord[];
} {
  const queue = [...entries];
  const requests: ProviderRequestRecord[] = [];

  const complete: GonkaCompletion = async (
    completionRequest: GonkaCompletionRequest,
  ) => {
    const entry = queue.shift();
    if (entry === undefined) throw new Error("scripted completion queue exhausted");

    const attemptNumber = completionRequest.attempts.length + 1;
    const gonkaRequestId = `devshard-fake-${attemptNumber}`;
    const request: ProviderRequestRecord = {
      model: completionRequest.manifest.modelId,
      temperature: 0,
      maxTokens: 4096,
      responseFormat: completionRequest.jsonMode ? "json_object" : "none",
      attemptKind: completionRequest.kind,
      messages: completionRequest.messages.map((message) => ({ ...message })),
    };
    requests.push(request);

    const audit = createAttemptAudit({
      input: completionRequest.input,
      manifest: completionRequest.manifest,
      attempt: attemptNumber,
      requestedAtMs: attemptNumber,
      completedAtMs: attemptNumber,
      status: "RECEIVED",
      gonkaRequestId,
      engineContext: {
        claimObjectId: CLAIM_ID as HexString,
        jurySeatId: JURY_SEAT_ID,
        phase: PHASE,
      },
    });

    if (typeof entry !== "string") {
      const attempt: GonkaAttemptRecord = {
        type: "gonka-attempt",
        kind: completionRequest.kind,
        audit,
        error: {
          category: entry.status === "TIMEOUT" ? "TIMEOUT" : "HTTP_ERROR",
        },
        investigationFlags: [],
      };
      completionRequest.attempts.push(attempt);
      return {
        ok: false,
        error: new Error(`scripted ${entry.status}`),
        responseFormatUnsupported: entry.responseFormatUnsupported ?? false,
        status: entry.status,
      };
    }

    const response = {
      id: gonkaRequestId,
      model: completionRequest.manifest.modelId,
      choices: [{ message: { role: "assistant", content: entry } }],
    };
    const attempt: GonkaAttemptRecord = {
      type: "gonka-attempt",
      kind: completionRequest.kind,
      audit,
      response,
      investigationFlags: [],
    };
    completionRequest.attempts.push(attempt);
    return {
      ok: true,
      response,
      request,
      gateway: { gatewayRequestId: `gateway-${attemptNumber}` },
      content: entry,
      gonkaRequestId,
      attempt,
    };
  };

  return { complete, requests };
}

class MemoryPageStore implements PageStore {
  private readonly pages = new Map<string, PageStorePage>();

  constructor(initial: readonly PageStorePage[] = []) {
    for (const page of initial) this.pages.set(page.evidenceId, page);
  }

  async lookup(evidenceId: string): Promise<PageStorePage | undefined> {
    return this.pages.get(evidenceId);
  }

  async store(
    page: Parameters<PageStore["store"]>[0],
    meta: Parameters<PageStore["store"]>[1],
  ): Promise<PageStorePage> {
    const text = page.markdown.slice(0, meta.maxPageChars);
    const contentHash = toHex(blake2b256(new TextEncoder().encode(text)));
    const stored: PageStorePage = {
      evidenceId: meta.evidenceId,
      url: page.url,
      finalUrl: page.finalUrl,
      ...(page.title === undefined ? {} : { title: page.title }),
      text,
      totalChars: text.length,
      truncated: page.markdown.length > text.length,
      contentHash,
      canonicalHash: contentHash,
      canonicalWalrusBlobId: `local-${meta.evidenceId}`,
    };
    this.pages.set(meta.evidenceId, stored);
    return stored;
  }
}

function policy(overrides: Partial<ToolPolicyV2> = {}): ToolPolicyV2 {
  return { ...DEFAULT_TOOL_POLICY_V2, ...overrides };
}

function inputWithSubmittedUrl(url: string) {
  return makeInput({
    promptVersion: "2",
    submission: { kind: "URL", submittedUrls: [url] },
  });
}

function action(value: unknown): string {
  return JSON.stringify(value);
}

function unsureAnswer(): string {
  return action({
    action: "answer",
    output: makeOutput({
      outcome: "UNSURE",
      decisiveEvidence: [],
      citations: [],
    }),
  });
}

function citedAnswer(options: {
  outcome?: "YES" | "NO";
  evidenceId: string;
  url: string;
  quote: string;
}): string {
  const outcome = options.outcome ?? "YES";
  return action({
    action: "answer",
    output: makeOutput({
      outcome,
      evidenceFor: outcome === "YES" ? [options.evidenceId] : [],
      evidenceAgainst: outcome === "NO" ? [options.evidenceId] : [],
      unsupportedClaims: [],
      decisiveEvidence: [options.evidenceId],
      publicReasoningTrace: [
        {
          check: "Check the opened page.",
          evidenceIds: [options.evidenceId],
          assessment: outcome === "YES" ? "SUPPORTS" : "CONTRADICTS",
          finding: "The opened page is decisive.",
        },
      ],
      citations: [
        {
          evidenceId: options.evidenceId,
          url: options.url,
          quote: options.quote,
        },
      ],
    }),
  });
}

function storedPage(evidenceId: string, url: string): PageStorePage {
  const text = "A cached page with enough quoted text for validation.";
  const hash = toHex(blake2b256(new TextEncoder().encode(text)));
  return {
    evidenceId,
    url,
    finalUrl: url,
    title: "Cached page",
    text,
    totalChars: text.length,
    truncated: false,
    contentHash: hash,
    canonicalHash: hash,
    canonicalWalrusBlobId: `local-${evidenceId}`,
  };
}

function loopDependencies(options: {
  complete: GonkaCompletion;
  provider?: ResearchProvider;
  policy?: ToolPolicyV2;
  input?: ReturnType<typeof makeInput>;
  pages?: PageStore;
  searchCache?: SearchCache;
  now?: () => number;
  deadlineMs?: number;
}) {
  return {
    complete: options.complete,
    provider: options.provider ?? createFakeResearchProvider(),
    policy: options.policy ?? policy(),
    spec: DEFAULT_PROMPT_SPEC_V2,
    input: options.input ?? makeInput({ promptVersion: "2" }),
    manifest: makeManifest(),
    claimId: CLAIM_ID,
    phase: PHASE,
    pages: options.pages ?? new MemoryPageStore(),
    searchCache: options.searchCache ?? createSearchCache(),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  };
}

describe("research loop", () => {
  it("searches, opens, and returns a cited answer with faithful messages", async () => {
    const query = "independent research";
    const url = "https://fake.evidence.test/independent-research/1";
    const evidenceId = discoveredEvidenceId(CLAIM_ID, PHASE, normalizeUrl(url));
    const quote = "This page discusses independent-research in detail.";
    const script = scriptedCompletion([
      action({ action: "search", query }),
      action({ action: "open", url }),
      citedAnswer({ evidenceId, url, quote }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.counts).toEqual({ searches: 1, opens: 1, turns: 3 });
    expect(result.transcript.opened[0]?.origin).toBe("SEARCH");
    expect(result.request.messages).toHaveLength(6);
    expect(result.opened[0]?.evidenceId).toBe(evidenceId);
    expect(result.transcript.citations).toEqual([
      { evidenceId, url, quote, found: true },
    ]);
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "SCHEMA_VALID",
      "SCHEMA_VALID",
      "SCHEMA_VALID",
    ]);
  });

  it("refuses a YES before any searched page is opened, then accepts the researched answer", async () => {
    const query = "independent research";
    const url = "https://fake.evidence.test/independent-research/1";
    const evidenceId = discoveredEvidenceId(CLAIM_ID, PHASE, normalizeUrl(url));
    const quote = "This page discusses independent-research in detail.";
    // Turn 1 answers from memory with an invented page ref; the loop must
    // steer the model into search, open, answer instead of failing it.
    const script = scriptedCompletion([
      citedAnswer({ evidenceId: "p1", url, quote }),
      action({ action: "search", query }),
      action({ action: "open", url }),
      citedAnswer({ evidenceId, url, quote }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.counts).toEqual({ searches: 1, opens: 1, turns: 4 });
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "RESEARCH_REQUIRED",
    });
    expect(
      script.requests[1]?.messages.at(-1)?.content.includes("RESEARCH_REQUIRED"),
    ).toBe(true);
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "CITATION_INVALID",
      "SCHEMA_VALID",
      "SCHEMA_VALID",
      "SCHEMA_VALID",
    ]);
  });

  it("assigns p1 and resolves a ref plus a URL-only citation", async () => {
    const query = "page ref research";
    const url = "https://fake.evidence.test/page-ref-research/1";
    const evidenceId = discoveredEvidenceId(CLAIM_ID, PHASE, normalizeUrl(url));
    const quote = "This page discusses page-ref-research in detail.";
    const output = makeOutput({
      outcome: "YES",
      evidenceFor: ["p1"],
      evidenceAgainst: [],
      unsupportedClaims: [],
      decisiveEvidence: ["p1"],
      publicReasoningTrace: [
        {
          check: "Check the first opened page.",
          evidenceIds: ["p1"],
          assessment: "SUPPORTS",
          finding: "The first opened page is decisive.",
        },
      ],
      citations: [],
    });
    const script = scriptedCompletion([
      action({ action: "search", query }),
      action({ action: "open", url }),
      action({
        action: "answer",
        output: { ...output, citations: [{ url, quote }] },
      }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: policy({ maxTurns: 3 }),
      }),
    );

    const openResult = script.requests[2]?.messages.find((message) =>
      message.role === "user" && message.content.includes('"tool":"open"'),
    );
    expect(openResult?.content).toContain('"ref":"p1"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opened[0]?.ref).toBe("p1");
    expect(result.transcript.opened[0]?.ref).toBe("p1");
    expect(result.output.evidenceFor).toEqual([evidenceId]);
    expect(result.output.citations?.[0]?.evidenceId).toBe(evidenceId);
  });

  it("refuses an unseen URL without spending the open budget", async () => {
    const script = scriptedCompletion([
      action({ action: "open", url: "https://unseen.test/page" }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "URL_NOT_SEEN",
    });
    expect(result.transcript.counts.opens).toBe(0);
    expect(result.transcript.counts.turns).toBe(2);
  });

  it("reports search and turn budgets before failing a final non-answer", async () => {
    const script = scriptedCompletion([
      action({ action: "search", query: "first query" }),
      action({ action: "search", query: "second query" }),
      action({ action: "search", query: "third query" }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: policy({ maxSearches: 1, maxTurns: 3 }),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("INVALID_SCHEMA");
    expect(result.transcript.steps[1]?.result).toMatchObject({
      tool: "error",
      code: "BUDGET_SEARCHES",
    });
    expect(result.transcript.counts).toEqual({ searches: 1, opens: 0, turns: 3 });
    expect(
      script.requests[2]?.messages.some((message) =>
        message.content.includes('"code":"BUDGET_TURNS"'),
      ),
    ).toBe(true);
  });

  it("fails closed after two invalid action replies", async () => {
    const script = scriptedCompletion(["not json", "still not json"]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("INVALID_SCHEMA");
    expect(result.transcript.steps).toHaveLength(2);
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "INVALID_ACTION",
    });
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "INVALID_SCHEMA",
      "INVALID_SCHEMA",
    ]);
  });

  it("repairs one invalid action and then accepts a valid answer", async () => {
    const script = scriptedCompletion(["not json", unsureAnswer()]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "INVALID_ACTION",
    });
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "INVALID_SCHEMA",
      "SCHEMA_VALID",
    ]);
    expect(script.requests[1]?.attemptKind).toBe("REPAIR");
  });

  it("fails citation repair when YES cites only a submitted page", async () => {
    const url = "https://fake.evidence.test/submitted/1";
    const input = inputWithSubmittedUrl(url);
    const evidenceId = discoveredEvidenceId(CLAIM_ID, PHASE, normalizeUrl(url));
    const answer = citedAnswer({
      evidenceId,
      url,
      quote: "This page discusses submitted in detail.",
    });
    // Two RESEARCH_REQUIRED nudges, then validation fails, one repair, fail closed.
    const script = scriptedCompletion([
      action({ action: "open", url }),
      answer,
      answer,
      answer,
      answer,
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete, input }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("CITATION_INVALID");
    expect(result.transcript.opened[0]?.origin).toBe("SUBMITTED");
    expect(
      script.requests[2]?.messages.some((message) =>
        message.content.includes("independence"),
      ),
    ).toBe(true);
    expect(
      result.transcript.steps.filter(
        (step) => step.result.tool === "error" && step.result.code === "RESEARCH_REQUIRED",
      ),
    ).toHaveLength(2);
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "SCHEMA_VALID",
      "CITATION_INVALID",
      "CITATION_INVALID",
      "CITATION_INVALID",
      "CITATION_INVALID",
    ]);
  });

  it("returns a model provider failure with its recorded attempt", async () => {
    const script = scriptedCompletion([{ status: "PROVIDER_ERROR" }]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("PROVIDER_ERROR");
    expect(result.attempts).toHaveLength(1);
    expect(result.transcript.steps).toHaveLength(0);
  });

  it("uses a stored page without calling the provider open method", async () => {
    const url = "https://fake.evidence.test/cached/1";
    const input = inputWithSubmittedUrl(url);
    const evidenceId = discoveredEvidenceId(CLAIM_ID, PHASE, normalizeUrl(url));
    const pages = new MemoryPageStore([storedPage(evidenceId, url)]);
    const baseProvider = createFakeResearchProvider();
    const open = vi.fn(baseProvider.open);
    const provider: ResearchProvider = { ...baseProvider, open };
    const script = scriptedCompletion([
      action({ action: "open", url }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete, input, pages, provider }),
    );

    expect(result.ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "open",
      cached: true,
      evidenceId,
    });
    expect(result.transcript.counts.opens).toBe(0);
  });

  it("uses a resolved search cache entry without calling provider search", async () => {
    const query = "cached query";
    const baseProvider = createFakeResearchProvider();
    const cachedResults = await baseProvider.search(query, {
      limit: policy().resultsPerSearch,
      timeoutMs: 60_000,
    });
    const searchCache = createSearchCache();
    await searchCache.resolve(`${PHASE}:${query}`, async () => cachedResults);
    const search = vi.fn(baseProvider.search);
    const provider: ResearchProvider = { ...baseProvider, search };
    const script = scriptedCompletion([
      action({ action: "search", query }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider,
        searchCache,
      }),
    );

    expect(result.ok).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "search",
      cached: true,
    });
    expect(result.transcript.counts.searches).toBe(1);
  });

  it("fails with TIMEOUT once the seat deadline passes and bounds each call by the time left", async () => {
    const query = "independent research";
    const script = scriptedCompletion([
      action({ action: "search", query }),
      unsureAnswer(),
    ]);
    // Each model call advances the clock past the 500 ms deadline, so turn 1
    // runs with the full time left as its call timeout and turn 2 never starts.
    let clock = 0;
    const now = () => clock;
    const original = script.complete;
    const timeouts: Array<number | undefined> = [];
    const complete: GonkaCompletion = async (request) => {
      timeouts.push(request.timeoutMs);
      clock += 600;
      return original(request);
    };

    const result = await runResearchLoop(
      loopDependencies({ complete, now, deadlineMs: 500 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("TIMEOUT");
    expect(result.message).toContain("seat deadline");
    // Turn 1 ran (search) with the 500 ms left as its call timeout; turn 2 never started.
    expect(timeouts).toEqual([500]);
    expect(result.transcript.counts).toEqual({ searches: 1, opens: 0, turns: 1 });
  });

  it("fails with TIMEOUT before a turn starts beyond maxLoopMs", async () => {
    const script = scriptedCompletion([unsureAnswer()]);
    let nowCalls = 0;
    const now = () => {
      nowCalls += 1;
      return nowCalls === 1 ? 0 : 1_001;
    };

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: policy({ maxLoopMs: 1_000 }),
        now,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("TIMEOUT");
    expect(result.attempts).toHaveLength(0);
    expect(result.transcript.counts.turns).toBe(0);
  });
});

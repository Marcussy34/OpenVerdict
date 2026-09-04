import { describe, expect, it, vi } from "vitest";

import { createAttemptAudit } from "../gonka/audit";
import { makeInput, makeManifest, makeOutput } from "../gonka/fixtures.test-utils";
import {
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  DEFAULT_TOOL_POLICY_V4,
  composeSystemPrompt,
} from "../gonka/promptSpec";
import type {
  GonkaAttemptRecord,
  GonkaCompletion,
  GonkaCompletionRequest,
} from "../gonka/types";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  HexString,
  PromptSpecV2,
  PromptSpecV3,
  PromptSpecV4,
  ProviderRequestRecord,
  ToolPolicyV2,
  ToolPolicyV3,
  ToolPolicyV4,
} from "../protocol/types";
import { normalizeUrl } from "./actions";
import { createFakeResearchProvider } from "./fake";
import {
  runResearchLoop,
  type PageStore,
  type ResearchStepInfo,
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

function v3Policy(overrides: Partial<ToolPolicyV3> = {}): ToolPolicyV3 {
  return { ...DEFAULT_TOOL_POLICY_V3, ...overrides };
}

function v4Policy(overrides: Partial<ToolPolicyV4> = {}): ToolPolicyV4 {
  return { ...DEFAULT_TOOL_POLICY_V4, ...overrides };
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
  counterEvidenceSummary?: string;
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
      ...(options.counterEvidenceSummary === undefined
        ? {}
        : { counterEvidenceSummary: options.counterEvidenceSummary }),
    }),
  });
}

function twoSidedAnswer(options: {
  supportEvidenceId: string;
  supportUrl: string;
  supportQuote: string;
  challengeEvidenceId: string;
  challengeUrl: string;
  challengeQuote: string;
  includeChallengeCitation?: boolean;
  counterEvidenceSummary?: string;
}): string {
  const citations = [
    {
      evidenceId: options.supportEvidenceId,
      url: options.supportUrl,
      quote: options.supportQuote,
    },
    ...(options.includeChallengeCitation === false
      ? []
      : [
          {
            evidenceId: options.challengeEvidenceId,
            url: options.challengeUrl,
            quote: options.challengeQuote,
          },
        ]),
  ];
  return action({
    action: "answer",
    output: makeOutput({
      outcome: "YES",
      evidenceFor: [options.supportEvidenceId],
      evidenceAgainst: [options.challengeEvidenceId],
      unsupportedClaims: [],
      decisiveEvidence: [options.supportEvidenceId],
      publicReasoningTrace: [
        {
          check: "Compare the strongest evidence on both sides.",
          evidenceIds: [
            options.supportEvidenceId,
            options.challengeEvidenceId,
          ],
          assessment: "MIXED",
          finding: "The supporting source remains more persuasive.",
        },
      ],
      citations,
      ...(options.counterEvidenceSummary === undefined
        ? {}
        : { counterEvidenceSummary: options.counterEvidenceSummary }),
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
  policy?: ToolPolicyV2 | ToolPolicyV3 | ToolPolicyV4;
  spec?: PromptSpecV2 | PromptSpecV3 | PromptSpecV4;
  input?: ReturnType<typeof makeInput>;
  pages?: PageStore;
  searchCache?: SearchCache;
  now?: () => number;
  deadlineMs?: number;
  onStep?: (info: ResearchStepInfo) => void;
}) {
  return {
    complete: options.complete,
    // Provider retries back off with real time in production; tests skip the wait.
    sleep: async () => undefined,
    provider: options.provider ?? createFakeResearchProvider(),
    policy: options.policy ?? policy(),
    spec: options.spec ?? DEFAULT_PROMPT_SPEC_V2,
    input: options.input ?? makeInput({ promptVersion: "2" }),
    manifest: makeManifest(),
    claimId: CLAIM_ID,
    phase: PHASE,
    pages: options.pages ?? new MemoryPageStore(),
    searchCache: options.searchCache ?? createSearchCache(),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
  };
}

function twoSiteProvider(): ResearchProvider {
  const supportUrl = "https://support.example/report";
  const challengeUrl = "https://challenge.example/report";
  const pages = new Map([
    [supportUrl, "The official record confirms the claim as stated."],
    [challengeUrl, "The independent review identifies the strongest contrary evidence."],
  ]);
  return {
    name: "fake",
    mode: "fake",
    search: async (query) => {
      const challenge = query.includes("challenge");
      const url = challenge ? challengeUrl : supportUrl;
      return [{
        rank: 1,
        url,
        title: challenge ? "Challenge source" : "Support source",
        snippet: pages.get(url) ?? "",
      }];
    },
    open: async (url) => ({
      url,
      finalUrl: url,
      title: "Research source",
      markdown: pages.get(url) ?? "Unknown page.",
      fetchedAtMs: 0,
    }),
  };
}

describe("research loop", () => {
  it("reports each recorded research action with exact keys and stable ordinals", async () => {
    const query = "callback research";
    const url = "https://fake.evidence.test/callback-research/1";
    const script = scriptedCompletion([
      action({ action: "search", query }),
      action({ action: "open", url }),
      unsureAnswer(),
    ]);
    const calls: ResearchStepInfo[] = [];

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        onStep: (info) => {
          calls.push(info);
          if (info.ordinal === 0) throw new Error("observer failure");
        },
      }),
    );

    expect(result.ok).toBe(true);
    // The feed carries public web material only: the query, the result sites
    // and the opened URLs. The answer step names no content at all.
    expect(calls).toEqual([
      { kind: "search", ordinal: 0, query, resultDomains: ["fake.evidence.test"] },
      { kind: "open", ordinal: 1, urls: [url], pageCount: 1 },
      { kind: "answer", ordinal: 2 },
    ]);
    expect(Object.keys(calls[2]!).sort()).toEqual(["kind", "ordinal"]);
  });

  it("reports a batched open once, with every requested URL", async () => {
    const query = "batched research";
    const urls = [
      "https://fake.evidence.test/batched-research/1",
      "https://fake.evidence.test/batched-research/2",
    ];
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({ action: "open", urls }),
      unsureAnswer(),
    ]);
    const calls: ResearchStepInfo[] = [];

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v4Policy(),
        spec: DEFAULT_PROMPT_SPEC_V4,
        input: makeInput({ promptVersion: "4" }),
        onStep: (info) => calls.push(info),
      }),
    );

    expect(result.ok).toBe(true);
    // Two pages, one open action, one feed line; the intent rides the search.
    expect(calls).toEqual([
      {
        kind: "search",
        ordinal: 0,
        intent: "support",
        query,
        resultDomains: ["fake.evidence.test"],
      },
      { kind: "open", ordinal: 1, urls, pageCount: 2 },
      { kind: "answer", ordinal: 3 },
    ]);
  });

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

  it("fails closed after three invalid action replies (two repairs)", async () => {
    const script = scriptedCompletion(["not json", "still not json", "never json"]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("INVALID_SCHEMA");
    expect(result.transcript.steps).toHaveLength(3);
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "INVALID_ACTION",
    });
    expect(result.attempts.map((attempt) => attempt.audit.status)).toEqual([
      "INVALID_SCHEMA",
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

  it("records an accepted unsupportedClaims repair in the transcript", async () => {
    const prose = "The claim is stated as an absolute but research is divided.";
    const script = scriptedCompletion([
      action({
        action: "answer",
        output: makeOutput({
          outcome: "UNSURE",
          unsupportedClaims: [prose],
          decisiveEvidence: [],
          citations: [],
        }),
      }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repair =
      `unsupportedClaims: dropped entry that is not an evidence id: "${prose}"`;
    expect(result.output.unsupportedClaims).toEqual([]);
    expect(result.repairs).toEqual([repair]);
    expect(result.transcript.steps[0]?.result).toEqual({
      tool: "answer",
      valid: true,
      errors: [],
      repairs: [repair],
    });
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
    // Two RESEARCH_REQUIRED nudges, then validation fails, two repairs, fail closed.
    const script = scriptedCompletion([
      action({ action: "open", url }),
      answer,
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
      "CITATION_INVALID",
    ]);
  });

  it("retries a persistent provider failure up to the budget, then fails closed with every attempt recorded", async () => {
    // One primary call plus the full retry budget, every one shed.
    const script = scriptedCompletion(
      Array.from({ length: 13 }, () => ({ status: "PROVIDER_ERROR" as const })),
    );

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("PROVIDER_ERROR");
    expect(result.attempts).toHaveLength(13);
    expect(result.attempts.slice(1).every((attempt) => attempt.kind === "RETRY")).toBe(true);
    expect(result.transcript.steps).toHaveLength(0);
  });

  it("recovers from a shed call: two provider failures, then the scripted research continues", async () => {
    const script = scriptedCompletion([
      { status: "PROVIDER_ERROR" },
      { status: "TIMEOUT" },
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts.map((attempt) => attempt.kind)).toEqual(["PRIMARY", "RETRY", "RETRY"]);
  });

  it("does not start a retry that cannot finish before the seat deadline", async () => {
    const clock = 1_000;
    const script = scriptedCompletion([{ status: "PROVIDER_ERROR" }]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        now: () => clock,
        deadlineMs: clock + 10_000,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.attempts).toHaveLength(1);
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

  it("rejects a v3 search without intent without spending search budget", async () => {
    const script = scriptedCompletion([
      action({ action: "search", query: "missing intent" }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[0]?.result).toEqual({
      tool: "error",
      code: "INVALID_ACTION",
      message: 'search needs "intent": "support" or "challenge"',
    });
    expect(result.transcript.counts).toEqual({
      searches: 0,
      opens: 0,
      turns: 2,
      challengeSearches: 0,
    });
  });

  it("counts a failed v3 challenge search after it spends search budget", async () => {
    const baseProvider = createFakeResearchProvider();
    const provider: ResearchProvider = {
      ...baseProvider,
      search: async () => {
        throw new Error("search unavailable");
      },
    };
    const script = scriptedCompletion([
      action({
        action: "search",
        query: "challenge unavailable",
        intent: "challenge",
      }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider,
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[0]?.result).toMatchObject({
      tool: "error",
      code: "SEARCH_FAILED",
    });
    expect(result.transcript.counts).toMatchObject({
      searches: 1,
      challengeSearches: 1,
    });
  });

  it("does not let a failed challenge search satisfy a decisive answer", async () => {
    const baseProvider = createFakeResearchProvider();
    const provider: ResearchProvider = {
      ...baseProvider,
      search: async (query, options) => {
        if (query.includes("challenge")) {
          throw new Error("search unavailable");
        }
        return baseProvider.search(query, options);
      },
    };
    const supportUrl = "https://fake.evidence.test/support-source/1";
    const supportId = discoveredEvidenceId(
      CLAIM_ID,
      PHASE,
      normalizeUrl(supportUrl),
    );
    const script = scriptedCompletion([
      action({ action: "search", query: "support source", intent: "support" }),
      action({ action: "open", url: supportUrl }),
      action({
        action: "search",
        query: "challenge unavailable",
        intent: "challenge",
      }),
      citedAnswer({
        evidenceId: supportId,
        url: supportUrl,
        quote: "This page discusses support-source in detail.",
        counterEvidenceSummary: "The failed challenge search produced no evidence.",
      }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider,
        policy: v3Policy({ minCitationDomains: 1 }),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[3]?.result).toMatchObject({
      tool: "error",
      code: "CHALLENGE_REQUIRED",
    });
    expect(result.transcript.counts.challengeSearches).toBe(1);
  });

  it("nudges for challenge research and accepts after its result is opened", async () => {
    const supportQuery = "support evidence";
    const challengeQuery = "challenge evidence";
    const supportUrl = "https://fake.evidence.test/support-evidence/1";
    const challengeUrl = "https://fake.evidence.test/challenge-evidence/1";
    const supportId = discoveredEvidenceId(
      CLAIM_ID,
      PHASE,
      normalizeUrl(supportUrl),
    );
    const script = scriptedCompletion([
      action({ action: "search", query: supportQuery, intent: "support" }),
      action({ action: "open", url: supportUrl }),
      citedAnswer({
        evidenceId: supportId,
        url: supportUrl,
        quote: "This page discusses support-evidence in detail.",
        counterEvidenceSummary: "No contrary source has changed the verdict.",
      }),
      action({ action: "search", query: challengeQuery, intent: "challenge" }),
      action({ action: "open", url: challengeUrl }),
      citedAnswer({
        evidenceId: supportId,
        url: supportUrl,
        quote: "This page discusses support-evidence in detail.",
        counterEvidenceSummary: "The challenge page was weaker than the supporting record.",
      }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v3Policy({ minCitationDomains: 1 }),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.steps[2]?.result).toMatchObject({
      tool: "error",
      code: "CHALLENGE_REQUIRED",
    });
    expect(result.transcript.opened.map((page) => page.sides)).toEqual([
      ["support"],
      ["challenge"],
    ]);
    expect(result.transcript.counts.challengeSearches).toBe(1);
  });

  it("nudges until citations span the required number of sites", async () => {
    const supportUrl = "https://support.example/report";
    const challengeUrl = "https://challenge.example/report";
    const supportId = discoveredEvidenceId(CLAIM_ID, PHASE, supportUrl);
    const challengeId = discoveredEvidenceId(CLAIM_ID, PHASE, challengeUrl);
    const answerOptions = {
      supportEvidenceId: supportId,
      supportUrl,
      supportQuote: "The official record confirms the claim as stated.",
      challengeEvidenceId: challengeId,
      challengeUrl,
      challengeQuote: "The independent review identifies the strongest contrary evidence.",
      counterEvidenceSummary: "The independent review raised the strongest objection, but the official record remained decisive.",
    };
    const script = scriptedCompletion([
      action({ action: "search", query: "support source", intent: "support" }),
      action({ action: "open", url: supportUrl }),
      action({ action: "search", query: "challenge source", intent: "challenge" }),
      action({ action: "open", url: challengeUrl }),
      twoSidedAnswer({ ...answerOptions, includeChallengeCitation: false }),
      twoSidedAnswer(answerOptions),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider: twoSiteProvider(),
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.steps[4]?.result).toMatchObject({
      tool: "error",
      code: "CORROBORATION_REQUIRED",
    });
    expect(result.output.citations).toHaveLength(2);
  });

  it("repairs a decisive v3 answer without counterEvidenceSummary", async () => {
    const supportUrl = "https://support.example/report";
    const challengeUrl = "https://challenge.example/report";
    const answerOptions = {
      supportEvidenceId: discoveredEvidenceId(CLAIM_ID, PHASE, supportUrl),
      supportUrl,
      supportQuote: "The official record confirms the claim as stated.",
      challengeEvidenceId: discoveredEvidenceId(CLAIM_ID, PHASE, challengeUrl),
      challengeUrl,
      challengeQuote: "The independent review identifies the strongest contrary evidence.",
    };
    const script = scriptedCompletion([
      action({ action: "search", query: "support source", intent: "support" }),
      action({ action: "open", url: supportUrl }),
      action({ action: "search", query: "challenge source", intent: "challenge" }),
      action({ action: "open", url: challengeUrl }),
      twoSidedAnswer(answerOptions),
      twoSidedAnswer({
        ...answerOptions,
        counterEvidenceSummary: "The contrary review was considered but did not outweigh the official record.",
      }),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider: twoSiteProvider(),
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[4]?.result).toMatchObject({
      tool: "answer",
      valid: false,
      errors: ["counterEvidenceSummary is required for YES or NO"],
    });
    expect(script.requests[5]?.attemptKind).toBe("REPAIR");
  });

  it("allows v3 UNSURE without challenge, corroboration, or a summary", async () => {
    const script = scriptedCompletion([unsureAnswer()]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repairs).toEqual([]);
    expect(result.transcript.steps).toHaveLength(1);
    expect(result.transcript.steps[0]?.result).toEqual({
      tool: "answer",
      valid: true,
      errors: [],
    });
    expect(result.transcript.steps[0]?.result).not.toHaveProperty("repairs");
  });

  it("opens three v4 pages in parallel and returns one ordered open_many result", async () => {
    const query = "batch sources";
    const urls = Array.from(
      { length: 3 },
      (_, index) => `https://fake.evidence.test/batch-sources/${index + 1}`,
    );
    const baseProvider = createFakeResearchProvider();
    let activeOpens = 0;
    let maximumActiveOpens = 0;
    const open = vi.fn(async (url: string, options: { timeoutMs: number }) => {
      activeOpens += 1;
      maximumActiveOpens = Math.max(maximumActiveOpens, activeOpens);
      await Promise.resolve();
      try {
        return await baseProvider.open(url, options);
      } finally {
        activeOpens -= 1;
      }
    });
    const provider: ResearchProvider = { ...baseProvider, open };
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({ action: "open", urls, from: 0 }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider,
        policy: v4Policy(),
        spec: DEFAULT_PROMPT_SPEC_V4,
        input: makeInput({ promptVersion: "4" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(open).toHaveBeenCalledTimes(3);
    expect(maximumActiveOpens).toBe(3);
    expect(result.transcript.steps.slice(1, 4).map((step) => step.batch)).toEqual([
      { size: 3, position: 1 },
      { size: 3, position: 2 },
      { size: 3, position: 3 },
    ]);
    expect(result.transcript.steps.slice(1, 4).map((step) => step.turn)).toEqual([
      2,
      2,
      2,
    ]);
    expect(
      new Set(
        result.transcript.steps
          .slice(1, 4)
          .map((step) => step.modelRequestId),
      ).size,
    ).toBe(1);
    expect(result.transcript.opened.map((page) => page.sides)).toEqual([
      ["support"],
      ["support"],
      ["support"],
    ]);
    expect(result.transcript.counts).toEqual({
      searches: 1,
      opens: 3,
      turns: 3,
      challengeSearches: 0,
    });
    const openManyMessage = script.requests[2]?.messages.findLast(
      (message) =>
        message.role === "user" && message.content.includes('"tool":"open_many"'),
    );
    expect(JSON.parse(openManyMessage?.content ?? "null")).toMatchObject({
      tool: "open_many",
      pages: [
        { url: urls[0], ref: "p1" },
        { url: urls[1], ref: "p2" },
        { url: urls[2], ref: "p3" },
      ],
    });
  });

  it("refuses a fourth v4 URL without spending open budget", async () => {
    const query = "four sources";
    const urls = Array.from(
      { length: 4 },
      (_, index) => `https://fake.evidence.test/four-sources/${index + 1}`,
    );
    const fourthUrl = urls[3];
    if (fourthUrl === undefined) throw new Error("expected a fourth URL");
    const baseProvider = createFakeResearchProvider();
    const open = vi.fn(baseProvider.open);
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({ action: "open", urls }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider: { ...baseProvider, open },
        policy: v4Policy(),
        spec: DEFAULT_PROMPT_SPEC_V4,
        input: makeInput({ promptVersion: "4" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(result.transcript.steps[1]?.result).toMatchObject({
      tool: "error",
      code: "INVALID_ACTION",
      message: expect.stringContaining(fourthUrl),
    });
    expect(result.transcript.counts.opens).toBe(0);
  });

  it("opens only the v4 batch pages allowed by the remaining budget", async () => {
    const query = "budgeted sources";
    const urls = Array.from(
      { length: 3 },
      (_, index) => `https://fake.evidence.test/budgeted-sources/${index + 1}`,
    );
    const baseProvider = createFakeResearchProvider();
    const open = vi.fn(baseProvider.open);
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({ action: "open", urls }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider: { ...baseProvider, open },
        policy: v4Policy({ maxOpens: 2 }),
        spec: DEFAULT_PROMPT_SPEC_V4,
        input: makeInput({ promptVersion: "4" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(open).toHaveBeenCalledTimes(2);
    expect(result.opened).toHaveLength(2);
    expect(result.transcript.counts.opens).toBe(2);
    expect(result.transcript.steps[3]?.result).toMatchObject({
      tool: "error",
      code: "BUDGET_OPENS",
    });
    const openManyMessage = script.requests[2]?.messages.findLast(
      (message) =>
        message.role === "user" && message.content.includes('"tool":"open_many"'),
    );
    expect(JSON.parse(openManyMessage?.content ?? "null")).toMatchObject({
      tool: "open_many",
      pages: [
        { url: urls[0], ref: "p1" },
        { url: urls[1], ref: "p2" },
        { url: urls[2], error: "BUDGET_OPENS" },
      ],
    });
  });

  it("keeps a single v4 URL on the existing open result path", async () => {
    const query = "single v4 source";
    const url = "https://fake.evidence.test/single-v4-source/1";
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({ action: "open", url, from: 0 }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v4Policy(),
        spec: DEFAULT_PROMPT_SPEC_V4,
        input: makeInput({ promptVersion: "4" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.steps[1]?.batch).toBeUndefined();
    expect(result.transcript.steps[1]?.result.tool).toBe("open");
    const openMessage = script.requests[2]?.messages.findLast(
      (message) =>
        message.role === "user" && message.content.includes('"tool":"open"'),
    );
    expect(JSON.parse(openMessage?.content ?? "null")).toMatchObject({
      tool: "open",
      url,
      ref: "p1",
    });
  });

  it("rejects duplicate and unseen v4 batches before spending budget", async () => {
    const submittedUrl = "https://fake.evidence.test/submitted/1";
    const unseenUrl = "https://fake.evidence.test/unseen/1";
    const cases = [
      {
        urls: [submittedUrl, `${submittedUrl}/`],
        code: "INVALID_ACTION",
        offending: `${submittedUrl}/`,
      },
      {
        urls: [submittedUrl, unseenUrl],
        code: "URL_NOT_SEEN",
        offending: unseenUrl,
      },
    ] as const;

    for (const testCase of cases) {
      const baseProvider = createFakeResearchProvider();
      const open = vi.fn(baseProvider.open);
      const script = scriptedCompletion([
        action({ action: "open", urls: testCase.urls }),
        unsureAnswer(),
      ]);
      const result = await runResearchLoop(
        loopDependencies({
          complete: script.complete,
          provider: { ...baseProvider, open },
          policy: v4Policy(),
          spec: DEFAULT_PROMPT_SPEC_V4,
          input: makeInput({
            promptVersion: "4",
            submission: { kind: "URL", submittedUrls: [submittedUrl] },
          }),
        }),
      );

      expect(result.ok).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(result.transcript.steps[0]?.result).toMatchObject({
        tool: "error",
        code: testCase.code,
        message: expect.stringContaining(testCase.offending),
      });
      expect(result.transcript.counts.opens).toBe(0);
    }
  });

  it("keeps v3 policy on the single-url open envelope", async () => {
    const query = "legacy v3 batch";
    const baseProvider = createFakeResearchProvider();
    const open = vi.fn(baseProvider.open);
    const script = scriptedCompletion([
      action({ action: "search", query, intent: "support" }),
      action({
        action: "open",
        urls: [
          "https://fake.evidence.test/legacy-v3-batch/1",
          "https://fake.evidence.test/legacy-v3-batch/2",
        ],
      }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        provider: { ...baseProvider, open },
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(result.transcript.steps[1]?.result).toMatchObject({
      tool: "error",
      code: "INVALID_ACTION",
    });
    expect(result.transcript.counts.opens).toBe(0);
  });

  it("keeps v2 searches without intent unchanged", async () => {
    const script = scriptedCompletion([
      action({ action: "search", query: "legacy search" }),
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    expect(result.transcript.steps[0]?.result.tool).toBe("search");
    expect(result.transcript.counts).toEqual({
      searches: 1,
      opens: 0,
      turns: 2,
    });
  });

  it("keeps the v3 manifest system prompt exact during JSON fallback", async () => {
    const script = scriptedCompletion([
      { status: "PROVIDER_ERROR", responseFormatUnsupported: true },
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({
        complete: script.complete,
        policy: v3Policy(),
        spec: DEFAULT_PROMPT_SPEC_V3,
        input: makeInput({ promptVersion: "3" }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.responseFormat).toBe("none");
    expect(result.request.messages[0]?.content).toBe(
      composeSystemPrompt(DEFAULT_PROMPT_SPEC_V3, DEFAULT_TOOL_POLICY_V3),
    );
  });

  it("keeps the existing v2 JSON fallback suffix", async () => {
    const script = scriptedCompletion([
      { status: "PROVIDER_ERROR", responseFormatUnsupported: true },
      unsureAnswer(),
    ]);

    const result = await runResearchLoop(
      loopDependencies({ complete: script.complete }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.messages[0]?.content).toBe(
      `${composeSystemPrompt(DEFAULT_PROMPT_SPEC_V2, DEFAULT_TOOL_POLICY_V2)}${DEFAULT_PROMPT_SPEC_V2.jsonFallbackSuffix}`,
    );
  });
});

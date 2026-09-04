import { z } from "zod";

import { extractJsonObject } from "../gonka/adapter";
import {
  buildResearchMessages,
  composeSystemPrompt,
  toolPolicyHash,
} from "../gonka/promptSpec";
import {
  researchActionSchema,
  researchActionV3Schema,
} from "../gonka/schemas";
import type {
  GonkaAttemptKind,
  GonkaAttemptRecord,
  GonkaCompletion,
  PromptMessage,
} from "../gonka/types";
import type {
  AgentManifest,
  Citation,
  GatewayResponseMeta,
  HexString,
  OracleInferenceInput,
  OracleInferenceOutput,
  PromptSpecV2,
  PromptSpecV3,
  PromptSpecV4,
  ProviderRequestRecord,
  ResearchAction,
  ResearchPageOrigin,
  ResearchTranscriptStep,
  ResearchTranscriptV1,
  ResearchToolErrorCode,
  ResearchToolResult,
  ToolPolicyV2,
  ToolPolicyV3,
  ToolPolicyV4,
} from "../protocol/types";
import {
  errorToolResult,
  normalizeUrl,
  openToolResult,
  parseResearchAction,
  searchToolResult,
  toolResultContent,
} from "./actions";
import { citationSites, validateResearchAnswer } from "./citations";
import type { OpenedPage, ResearchProvider, SearchResult } from "./provider";
import {
  discoveredEvidenceId,
  resultsHash,
  type SearchCache,
} from "./transcript";

export type StoredPage = {
  evidenceId: string;
  ref: string;
  url: string;
  finalUrl: string;
  title?: string;
  text: string;
  totalChars: number;
  truncated: boolean;
  contentHash: HexString;
  canonicalHash: HexString;
  canonicalWalrusBlobId: string;
};

/** What a PageStore returns; the loop stamps the ref when a page is first opened. */
export type PageStorePage = Omit<StoredPage, "ref">;

export interface PageStore {
  lookup(evidenceId: string): Promise<PageStorePage | undefined>;
  store(
    page: OpenedPage,
    meta: {
      evidenceId: string;
      normalizedUrl: string;
      maxPageChars: number;
    },
  ): Promise<PageStorePage>;
}

type ResearchPolicy = ToolPolicyV2 | ToolPolicyV3 | ToolPolicyV4;
type ResearchSpec = PromptSpecV2 | PromptSpecV3 | PromptSpecV4;

type BatchOpenTarget = {
  requestedUrl: string;
  normalized: string;
  evidenceId: string;
};

type BatchOpenLookup = BatchOpenTarget &
  (
    | {
        ok: true;
        cached: boolean;
        page: StoredPage | PageStorePage | undefined;
      }
    | { ok: false; code: "OPEN_FAILED"; message: string }
  );

type BatchOpenResolution = BatchOpenTarget &
  (
    | {
        ok: true;
        cached: boolean;
        page: StoredPage | PageStorePage;
      }
    | {
        ok: false;
        code: "BUDGET_OPENS" | "OPEN_FAILED";
        message: string;
      }
  );

/**
 * What an activity observer learns about one recorded research step: the
 * public web material the juror asked for (a query, the result domains, the
 * URLs it opened), never a page's text, the answer, the vote or the reasoning.
 */
export type ResearchStepInfo = {
  kind: "search" | "open" | "answer";
  ordinal: number;
  intent?: "support" | "challenge";
  query?: string;
  urls?: string[];
  resultDomains?: string[];
  pageCount?: number;
};

export type ResearchLoopFailureStatus =
  | "INVALID_SCHEMA"
  | "CITATION_INVALID"
  | "PROVIDER_ERROR"
  | "TIMEOUT";

export type ResearchLoopResult =
  | {
      ok: true;
      attempts: GonkaAttemptRecord[];
      request: ProviderRequestRecord;
      response: unknown;
      gateway: GatewayResponseMeta;
      output: OracleInferenceOutput;
      transcript: ResearchTranscriptV1;
      opened: StoredPage[];
      repairs: string[];
    }
  | {
      ok: false;
      status: ResearchLoopFailureStatus;
      message: string;
      attempts: GonkaAttemptRecord[];
      transcript: ResearchTranscriptV1;
    };

function visibleSearchResults(
  results: SearchResult[],
  snippetChars: number,
): SearchResult[] {
  return results.map((result) => ({
    rank: result.rank,
    url: result.url,
    title: result.title,
    snippet: result.snippet.slice(0, snippetChars),
    ...(result.publishedAt === undefined
      ? {}
      : { publishedAt: result.publishedAt }),
  }));
}

/** The site a URL belongs to, for the public activity feed ("mit.edu"). */
function siteOf(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
}

/** Distinct result sites in rank order; the feed shows sites, never snippets. */
function resultDomains(results: readonly { url: string }[]): string[] {
  const sites: string[] = [];
  for (const result of results) {
    const site = siteOf(result.url);
    if (site !== undefined && !sites.includes(site)) sites.push(site);
  }
  return sites;
}

/**
 * What an observer is told about one recorded step. Search queries, result
 * sites and opened URLs are public web material; an invalid action carries
 * the model's raw content, so it is never reported.
 */
function stepInfo(
  ordinal: number,
  action: ResearchTranscriptStep["action"],
  result: ResearchTranscriptStep["result"],
): ResearchStepInfo | undefined {
  if (action.action === "search") {
    const domains = result.tool === "search" ? resultDomains(result.results) : [];
    return {
      kind: "search",
      ordinal,
      ...(action.intent === undefined ? {} : { intent: action.intent }),
      query: action.query,
      ...(domains.length === 0 ? {} : { resultDomains: domains }),
    };
  }
  if (action.action === "open") {
    const urls = action.urls ?? (action.url === undefined ? [] : [action.url]);
    return {
      kind: "open",
      ordinal,
      ...(urls.length === 0 ? {} : { urls, pageCount: urls.length }),
    };
  }
  // The answer itself stays sealed until reveal; only the step is public.
  if (action.action === "answer") return { kind: "answer", ordinal };
  return undefined;
}

const RESEARCH_REQUIRED_MESSAGE =
  "The independence rule: YES or NO must cite a page you found with your own search and opened in this run. Search now, open the most relevant result, then answer. UNSURE needs no citation.";
const CHALLENGE_REQUIRED_MESSAGE =
  "Weigh the other side: run a search with intent challenge that looks for evidence AGAINST the claim and open its most credible result before answering YES or NO. UNSURE needs no further research.";
const CORROBORATION_REQUIRED_MESSAGE =
  "Corroborate: cite pages from at least two different sites (open another site's page) before answering YES or NO. UNSURE needs no further research.";
const SEARCH_INTENT_REQUIRED_MESSAGE =
  'search needs "intent": "support" or "challenge"';

/** Premature YES/NO answers refused before the usual validation and repair take over. */
const MAX_RESEARCH_NUDGES = 2;
/** Malformed final answers get this many repair rounds before the seat fails closed. */
const MAX_ANSWER_REPAIRS = 2;
/**
 * Provider retries per model call: 429 shedding and 524 timeouts come in
 * bursts that can outlast a minute (a storm at 01:48 on 2026-09-03 cost three
 * last attempts after four retries). The seat deadline is the real bound:
 * the loop below stops as soon as a retry could not finish in time.
 */
const MAX_PROVIDER_RETRIES = 12;
const PROVIDER_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];
/** Do not start a retry that cannot get a real answer before the seat deadline. */
const MIN_RETRY_CALL_MS = 20_000;

function isCitationFailure(errors: readonly string[]): boolean {
  return errors.some((error) => {
    const normalized = error.toLowerCase();
    return (
      normalized.includes("citation") ||
      normalized.includes("independence") ||
      normalized.includes("challenge") ||
      normalized.includes("corroborate")
    );
  });
}

function isTwoSidedPolicy(
  policy: ResearchPolicy,
): policy is ToolPolicyV3 | ToolPolicyV4 {
  return policy.version === "3" || policy.version === "4";
}

function parseAction(
  content: string,
  policy: ResearchPolicy,
): { ok: true; action: ResearchAction } | { ok: false; error: string } {
  if (policy.version === "2") return parseResearchAction(content);
  let decoded: unknown;
  try {
    decoded = extractJsonObject(content);
  } catch {
    return { ok: false, error: "no parseable JSON object" };
  }
  if (
    policy.version === "4" &&
    typeof decoded === "object" &&
    decoded !== null &&
    "action" in decoded &&
    decoded.action === "open" &&
    "urls" in decoded &&
    Array.isArray(decoded.urls)
  ) {
    const limit = Math.min(3, policy.maxOpensPerTurn);
    if (decoded.urls.length > limit) {
      return {
        ok: false,
        error: `open action exceeds maxOpensPerTurn; offending URL: ${String(decoded.urls[limit])}`,
      };
    }
  }
  const schema = policy.version === "3"
    ? researchActionV3Schema
    : researchActionSchema;
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  // The answer stays opaque until citation-aware validation below.
  return { ok: true, action: parsed.data as ResearchAction };
}

export async function runResearchLoop(
  deps: {
    complete: GonkaCompletion;
    provider: ResearchProvider;
    policy: ResearchPolicy;
    spec: ResearchSpec;
    input: OracleInferenceInput;
    manifest: AgentManifest;
    claimId: string;
    phase: 1 | 2;
    pages: PageStore;
    searchCache: SearchCache;
    now?: () => number;
    onStep?: (info: ResearchStepInfo) => void;
    /** Injectable pause between provider retries (tests pass a no-op). */
    sleep?: (milliseconds: number) => Promise<void>;
    /**
     * Wall-clock point (ms) after which this seat cannot commit in time. The
     * loop stops with TIMEOUT before a turn that would start past it and
     * bounds every model call by the time left, so a slow seat fails closed
     * while its committee mates still make the commit deadline.
     */
    deadlineMs?: number;
  },
): Promise<ResearchLoopResult> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const policy = deps.policy;
  const attempts: GonkaAttemptRecord[] = [];
  const messages: PromptMessage[] = buildResearchMessages(
    deps.spec,
    policy,
    deps.input,
  );
  const seen = new Set(
    deps.input.submission.submittedUrls.map((url) => normalizeUrl(url)),
  );
  const foundBySearch = new Set<string>();
  const resultSides = new Map<
    string,
    Set<"support" | "challenge">
  >();
  const openedUrls = new Map<string, string>();
  const challengeResultUrls = new Set<string>();
  const opened: StoredPage[] = [];
  const origins = new Map<string, ResearchPageOrigin>();
  const steps: ResearchTranscriptStep[] = [];
  const counts = { searches: 0, opens: 0, turns: 0 };
  const frozenEvidenceIds = deps.input.evidenceManifest.items.map(
    (item) => item.evidenceId,
  );
  let jsonMode = true;
  // Answer repairs: a malformed final answer gets the errors back and another
  // try. One repair was not enough for a model that writes a sentence where
  // an evidence-id array belongs (MiniMax, decisiveEvidence, 2026-09-03), and
  // under the all-or-nothing rule that one seat voids the verification.
  let repairs = 0;
  let researchNudges = 0;
  let challengeNudges = 0;
  let corroborationNudges = 0;
  let challengeSearches = 0;
  let completedChallengeSearches = 0;

  const transcript = (
    citations: Array<Citation & { found: boolean }> = [],
  ): ResearchTranscriptV1 => ({
    version: 1,
    runId: deps.input.runId as HexString,
    provider: { name: deps.provider.name, mode: deps.provider.mode },
    policyHash: toolPolicyHash(policy),
    steps,
    opened: opened.map((page) => {
      const sides = (["support", "challenge"] as const).filter(
        (side): side is "support" | "challenge" =>
          resultSides.get(openedUrls.get(page.evidenceId) ?? "")?.has(side) ===
          true,
      );
      return {
        evidenceId: page.evidenceId,
        ref: page.ref,
        url: page.url,
        finalUrl: page.finalUrl,
        origin: origins.get(page.evidenceId) ?? "SUBMITTED",
        ...(page.title === undefined ? {} : { title: page.title }),
        contentHash: page.contentHash,
        canonicalHash: page.canonicalHash,
        canonicalWalrusBlobId: page.canonicalWalrusBlobId,
        totalChars: page.totalChars,
        truncated: page.truncated,
        ...(isTwoSidedPolicy(policy) && sides.length > 0 ? { sides } : {}),
      };
    }),
    citations,
    counts: {
      ...counts,
      ...(isTwoSidedPolicy(policy) ? { challengeSearches } : {}),
    },
  });

  const fail = (
    status: ResearchLoopFailureStatus,
    message: string,
  ): ResearchLoopResult => ({
    ok: false,
    status,
    message,
    attempts,
    transcript: transcript(),
  });

  const push = (content: string): void => {
    messages.push({ role: "user", content });
  };

  const emitStep = (info: ResearchStepInfo | undefined): void => {
    if (info === undefined) return;
    // Activity observers receive no research content and cannot affect the run.
    try {
      deps.onStep?.(info);
    } catch {
      // The transcript remains the source of truth when an observer fails.
    }
  };

  const recordStep = (
    turn: number,
    startedAtMs: number,
    modelRequestId: string,
    action: ResearchTranscriptStep["action"],
    result: ResearchTranscriptStep["result"],
    batch?: NonNullable<ResearchTranscriptStep["batch"]>,
  ): void => {
    const ordinal = steps.length;
    steps.push({
      index: ordinal,
      turn,
      startedAtMs,
      completedAtMs: now(),
      modelRequestId,
      ...(batch === undefined ? {} : { batch }),
      action,
      result,
    });
    // A batched open reports once for the whole batch, below, not per page.
    if (batch === undefined) emitStep(stepInfo(ordinal, action, result));
  };

  const forceAnswerBeforeLastTurn = (turn: number): void => {
    if (turn !== policy.maxTurns - 1) return;
    push(
      toolResultContent(errorToolResult("BUDGET_TURNS", "Answer now.")),
    );
  };

  const recordToolError = (options: {
    turn: number;
    startedAtMs: number;
    modelRequestId: string;
    action: ResearchAction;
    code: ResearchToolErrorCode;
    message: string;
  }): void => {
    recordStep(
      options.turn,
      options.startedAtMs,
      options.modelRequestId,
      options.action,
      { tool: "error", code: options.code, message: options.message },
    );
    push(toolResultContent(errorToolResult(options.code, options.message)));
    forceAnswerBeforeLastTurn(options.turn);
  };

  for (let turn = 1; turn <= policy.maxTurns; turn += 1) {
    if (now() - startedAt > policy.maxLoopMs) {
      return fail("TIMEOUT", "research loop exceeded maxLoopMs");
    }
    const timeLeftMs =
      deps.deadlineMs === undefined ? undefined : deps.deadlineMs - now();
    if (timeLeftMs !== undefined && timeLeftMs <= 0) {
      return fail("TIMEOUT", "seat deadline reached before the commit window");
    }
    counts.turns = turn;
    const kind: GonkaAttemptKind = turn === 1
      ? "PRIMARY"
      : repairs > 0
        ? "REPAIR"
        : "PRIMARY";
    const timeout = timeLeftMs === undefined ? {} : { timeoutMs: timeLeftMs };
    let completion = await deps.complete({
      manifest: deps.manifest,
      messages,
      kind,
      jsonMode,
      input: deps.input,
      attempts,
      ...timeout,
    });

    if (!completion.ok && completion.responseFormatUnsupported && jsonMode) {
      jsonMode = false;
      messages[0] = {
        role: "system",
        content:
          isTwoSidedPolicy(policy)
            ? composeSystemPrompt(deps.spec, policy)
            : `${composeSystemPrompt(deps.spec, policy)}${deps.spec.jsonFallbackSuffix}`,
      };
      completion = await deps.complete({
        manifest: deps.manifest,
        messages,
        kind: "JSON_PROMPT_FALLBACK",
        jsonMode,
        input: deps.input,
        attempts,
        ...timeout,
      });
    }
    // A shed or timed-out call is transport weather, not juror behaviour:
    // retry it with backoff while the seat still has time, and record every
    // attempt in the sealed bundle. Malformed output still fails closed below.
    for (
      let retry = 0;
      !completion.ok && retry < MAX_PROVIDER_RETRIES;
      retry += 1
    ) {
      const waitMs =
        PROVIDER_RETRY_BACKOFF_MS[retry] ?? PROVIDER_RETRY_BACKOFF_MS.at(-1)!;
      const remainingMs =
        deps.deadlineMs === undefined ? undefined : deps.deadlineMs - now();
      if (remainingMs !== undefined && remainingMs <= waitMs + MIN_RETRY_CALL_MS) {
        break;
      }
      await sleep(waitMs);
      completion = await deps.complete({
        manifest: deps.manifest,
        messages,
        kind: "RETRY",
        jsonMode,
        input: deps.input,
        attempts,
        ...(deps.deadlineMs === undefined
          ? {}
          : { timeoutMs: deps.deadlineMs - now() }),
      });
    }
    if (!completion.ok) {
      return fail(completion.status, "GonkaRouter provider request failed");
    }

    const modelRequestId = completion.gonkaRequestId;
    messages.push({ role: "assistant", content: completion.content });
    const stepStart = now();
    const parsed = parseAction(completion.content, policy);

    if (!parsed.ok) {
      completion.attempt.audit.status = "INVALID_SCHEMA";
      const invalidAction = {
        action: "invalid" as const,
        content: completion.content,
      };
      recordStep(turn, stepStart, modelRequestId, invalidAction, {
        tool: "error",
        code: "INVALID_ACTION",
        message: parsed.error,
      });
      if (repairs < MAX_ANSWER_REPAIRS && turn < policy.maxTurns) {
        repairs += 1;
        push(
          toolResultContent(
            errorToolResult(
              "INVALID_ACTION",
              deps.spec.repairSystemPrompt,
              [parsed.error],
            ),
          ),
        );
        forceAnswerBeforeLastTurn(turn);
        continue;
      }
      return fail("INVALID_SCHEMA", parsed.error);
    }

    const researchAction = parsed.action;
    if (researchAction.action === "search") {
      if (isTwoSidedPolicy(policy) && researchAction.intent === undefined) {
        completion.attempt.audit.status = "INVALID_SCHEMA";
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "INVALID_ACTION",
          message: SEARCH_INTENT_REQUIRED_MESSAGE,
        });
        continue;
      }
      completion.attempt.audit.status = "SCHEMA_VALID";
      if (counts.searches >= policy.maxSearches) {
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "BUDGET_SEARCHES",
          message: "search budget exhausted",
        });
        continue;
      }

      counts.searches += 1;
      if (
        isTwoSidedPolicy(policy) &&
        researchAction.intent === "challenge"
      ) {
        challengeSearches += 1;
      }
      const key = `${deps.phase}:${researchAction.query.trim().toLowerCase()}`;
      try {
        const resolved = await deps.searchCache.resolve(key, () =>
          deps.provider.search(researchAction.query, {
            limit: policy.resultsPerSearch,
            timeoutMs: 60_000,
          }),
        );
        const results = visibleSearchResults(
          resolved.results,
          policy.snippetChars,
        );
        if (
          isTwoSidedPolicy(policy) &&
          researchAction.intent === "challenge"
        ) {
          completedChallengeSearches += 1;
        }
        for (const result of results) {
          const normalized = normalizeUrl(result.url);
          seen.add(normalized);
          foundBySearch.add(normalized);
          if (isTwoSidedPolicy(policy)) {
            const intent = researchAction.intent;
            if (intent === undefined) {
              return fail("INVALID_SCHEMA", SEARCH_INTENT_REQUIRED_MESSAGE);
            }
            const sides = resultSides.get(normalized) ?? new Set();
            sides.add(intent);
            resultSides.set(normalized, sides);
            if (intent === "challenge") challengeResultUrls.add(normalized);
          }
        }
        recordStep(turn, stepStart, modelRequestId, researchAction, {
          tool: "search",
          cached: resolved.cached,
          resultsHash: resultsHash(results),
          results,
        });
        push(toolResultContent(searchToolResult(researchAction.query, results)));
      } catch {
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "SEARCH_FAILED",
          message: "research search failed",
        });
        continue;
      }
      forceAnswerBeforeLastTurn(turn);
      continue;
    }

    if (researchAction.action === "open") {
      completion.attempt.audit.status = "SCHEMA_VALID";
      if (policy.version === "4" && researchAction.urls !== undefined) {
        const requestedUrls = researchAction.urls;
        if (requestedUrls.length > policy.maxOpensPerTurn) {
          completion.attempt.audit.status = "INVALID_SCHEMA";
          recordToolError({
            turn,
            startedAtMs: stepStart,
            modelRequestId,
            action: researchAction,
            code: "INVALID_ACTION",
            message: `open batch exceeds maxOpensPerTurn; offending URL: ${String(requestedUrls[policy.maxOpensPerTurn])}`,
          });
          continue;
        }

        const targets: BatchOpenTarget[] = [];
        const normalizedInBatch = new Set<string>();
        let invalidBatch:
          | { code: "INVALID_ACTION" | "URL_NOT_SEEN"; message: string }
          | undefined;
        for (const requestedUrl of requestedUrls) {
          let normalized: string;
          try {
            normalized = normalizeUrl(requestedUrl);
          } catch {
            invalidBatch = {
              code: "URL_NOT_SEEN",
              message: `URL was not seen in this run: ${requestedUrl}`,
            };
            break;
          }
          if (normalizedInBatch.has(normalized)) {
            invalidBatch = {
              code: "INVALID_ACTION",
              message: `duplicate open URL: ${requestedUrl}`,
            };
            break;
          }
          if (!seen.has(normalized)) {
            invalidBatch = {
              code: "URL_NOT_SEEN",
              message: `URL was not seen in this run: ${requestedUrl}`,
            };
            break;
          }
          normalizedInBatch.add(normalized);
          targets.push({
            requestedUrl,
            normalized,
            evidenceId: discoveredEvidenceId(
              deps.claimId,
              deps.phase,
              normalized,
            ),
          });
        }
        if (invalidBatch !== undefined) {
          if (invalidBatch.code === "INVALID_ACTION") {
            completion.attempt.audit.status = "INVALID_SCHEMA";
          }
          recordToolError({
            turn,
            startedAtMs: stepStart,
            modelRequestId,
            action: researchAction,
            code: invalidBatch.code,
            message: invalidBatch.message,
          });
          continue;
        }

        // Every requested page consumes one v4 open slot before fetching.
        const remainingOpens = Math.max(0, policy.maxOpens - counts.opens);
        const allowedCount = Math.min(targets.length, remainingOpens);
        const allowedTargets = targets.slice(0, allowedCount);
        counts.opens += allowedTargets.length;

        const lookups = await Promise.all(
          allowedTargets.map(async (target): Promise<BatchOpenLookup> => {
            const page = opened.find(
              (candidate) => candidate.evidenceId === target.evidenceId,
            );
            if (page !== undefined) {
              return { ...target, ok: true, cached: true, page };
            }
            try {
              const storedPage = await deps.pages.lookup(target.evidenceId);
              return {
                ...target,
                ok: true,
                cached: storedPage !== undefined,
                page: storedPage,
              };
            } catch {
              return {
                ...target,
                ok: false,
                code: "OPEN_FAILED",
                message: `research page lookup failed: ${target.requestedUrl}`,
              };
            }
          }),
        );

        // Provider opens start together; Promise.all preserves request order.
        const attempted = await Promise.all(
          lookups.map(async (lookup): Promise<BatchOpenResolution> => {
            if (!lookup.ok) return lookup;
            if (lookup.page !== undefined) {
              return { ...lookup, page: lookup.page };
            }
            try {
              const providerPage = await deps.provider.open(
                lookup.requestedUrl,
                { timeoutMs: 60_000 },
              );
              const page = await deps.pages.store(providerPage, {
                evidenceId: lookup.evidenceId,
                normalizedUrl: lookup.normalized,
                maxPageChars: policy.maxPageChars,
              });
              return { ...lookup, page };
            } catch {
              return {
                requestedUrl: lookup.requestedUrl,
                normalized: lookup.normalized,
                evidenceId: lookup.evidenceId,
                ok: false,
                code: "OPEN_FAILED",
                message: `research page open failed: ${lookup.requestedUrl}`,
              };
            }
          }),
        );
        const resolutions: BatchOpenResolution[] = [
          ...attempted,
          ...targets.slice(allowedCount).map((target) => ({
            ...target,
            ok: false as const,
            code: "BUDGET_OPENS" as const,
            message: `open budget exhausted: ${target.requestedUrl}`,
          })),
        ];
        const openManyPages: Extract<
          ResearchToolResult,
          { tool: "open_many" }
        >["pages"] = [];
        const from = researchAction.from ?? 0;

        // One observer step per open action: the batch's URLs in request order,
        // reported before the per-page steps below take their own ordinals.
        if (requestedUrls.length > 0) {
          emitStep({
            kind: "open",
            ordinal: steps.length,
            urls: [...requestedUrls],
            pageCount: requestedUrls.length,
          });
        }

        for (const [index, resolution] of resolutions.entries()) {
          const batch = { size: requestedUrls.length, position: index + 1 };
          if (!resolution.ok) {
            recordStep(
              turn,
              stepStart,
              modelRequestId,
              researchAction,
              {
                tool: "error",
                code: resolution.code,
                message: resolution.message,
              },
              batch,
            );
            openManyPages.push({
              url: resolution.requestedUrl,
              error: resolution.code,
            });
            continue;
          }

          let page: StoredPage;
          if ("ref" in resolution.page) {
            page = resolution.page;
          } else {
            // Refs follow request order even when network responses race.
            page = {
              ...resolution.page,
              ref: `p${opened.length + 1}`,
            };
            opened.push(page);
          }
          const origin: ResearchPageOrigin = foundBySearch.has(
            resolution.normalized,
          )
            ? "SEARCH"
            : "SUBMITTED";
          origins.set(resolution.evidenceId, origin);
          openedUrls.set(resolution.evidenceId, resolution.normalized);

          const toolResult = openToolResult(
            {
              url: page.url,
              evidenceId: resolution.evidenceId,
              ref: page.ref,
              text: page.text,
              totalChars: page.totalChars,
              truncated: page.truncated,
            },
            from,
            policy.pageSliceChars,
          );
          if (toolResult.tool !== "open") {
            return fail(
              "INVALID_SCHEMA",
              "open tool result had an invalid shape",
            );
          }
          recordStep(
            turn,
            stepStart,
            modelRequestId,
            researchAction,
            {
              tool: "open",
              cached: resolution.cached,
              evidenceId: resolution.evidenceId,
              origin,
              from,
              chars: toolResult.chars,
              totalChars: page.totalChars,
              contentHash: page.contentHash,
              canonicalWalrusBlobId: page.canonicalWalrusBlobId,
            },
            batch,
          );
          openManyPages.push({
            url: toolResult.url,
            evidenceId: toolResult.evidenceId,
            ref: toolResult.ref,
            from: toolResult.from,
            chars: toolResult.chars,
            totalChars: toolResult.totalChars,
            truncated: toolResult.truncated,
            text: toolResult.text,
          });
        }

        push(toolResultContent({ tool: "open_many", pages: openManyPages }));
        forceAnswerBeforeLastTurn(turn);
        continue;
      }

      if (researchAction.url === undefined) {
        return fail("INVALID_SCHEMA", "single open action omitted its URL");
      }
      const requestedUrl = researchAction.url;
      let normalized: string;
      try {
        normalized = normalizeUrl(requestedUrl);
      } catch {
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "URL_NOT_SEEN",
          message:
            policy.version === "4"
              ? `URL was not seen in this run: ${requestedUrl}`
              : "URL was not seen in this run",
        });
        continue;
      }
      if (!seen.has(normalized)) {
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "URL_NOT_SEEN",
          message:
            policy.version === "4"
              ? `URL was not seen in this run: ${requestedUrl}`
              : "URL was not seen in this run",
        });
        continue;
      }

      const evidenceId = discoveredEvidenceId(
        deps.claimId,
        deps.phase,
        normalized,
      );
      let page = opened.find((candidate) => candidate.evidenceId === evidenceId);
      let cached = page !== undefined;
      if (!page) {
        let storedPage: PageStorePage | undefined;
        try {
          storedPage = await deps.pages.lookup(evidenceId);
          cached = storedPage !== undefined;
        } catch {
          recordToolError({
            turn,
            startedAtMs: stepStart,
            modelRequestId,
            action: researchAction,
            code: "OPEN_FAILED",
            message: "research page lookup failed",
          });
          continue;
        }

        if (!storedPage) {
          if (counts.opens >= policy.maxOpens) {
            recordToolError({
              turn,
              startedAtMs: stepStart,
              modelRequestId,
              action: researchAction,
              code: "BUDGET_OPENS",
              message: "open budget exhausted",
            });
            continue;
          }
          counts.opens += 1;
          try {
            const providerPage = await deps.provider.open(requestedUrl, {
              timeoutMs: 60_000,
            });
            storedPage = await deps.pages.store(providerPage, {
              evidenceId,
              normalizedUrl: normalized,
              maxPageChars: policy.maxPageChars,
            });
          } catch {
            recordToolError({
              turn,
              startedAtMs: stepStart,
              modelRequestId,
              action: researchAction,
              code: "OPEN_FAILED",
              message: "research page open failed",
            });
            continue;
          }
        }

        // Refs are local to this run and follow first-open order.
        page = { ...storedPage, ref: `p${opened.length + 1}` };
        opened.push(page);
      }

      const origin: ResearchPageOrigin = foundBySearch.has(normalized)
        ? "SEARCH"
        : "SUBMITTED";
      origins.set(evidenceId, origin);
      openedUrls.set(evidenceId, normalized);

      const from = researchAction.from ?? 0;
      const toolResult = openToolResult(
        {
          url: page.url,
          evidenceId,
          ref: page.ref,
          text: page.text,
          totalChars: page.totalChars,
          truncated: page.truncated,
        },
        from,
        policy.pageSliceChars,
      );
      if (toolResult.tool !== "open") {
        return fail("INVALID_SCHEMA", "open tool result had an invalid shape");
      }
      recordStep(turn, stepStart, modelRequestId, researchAction, {
        tool: "open",
        cached,
        evidenceId,
        origin,
        from,
        chars: toolResult.chars,
        totalChars: page.totalChars,
        contentHash: page.contentHash,
        canonicalWalrusBlobId: page.canonicalWalrusBlobId,
      });
      push(toolResultContent(toolResult));
      forceAnswerBeforeLastTurn(turn);
      continue;
    }

    // Models sometimes answer from memory on the first turn with invented
    // citations (three of five hosted seats did, 2026-08-30). Such a YES or
    // NO can never pass the independence rule, so instead of spending the
    // single repair on it, refuse it as a tool error that says what to do
    // next and keep the loop going. UNSURE needs no citation and passes
    // through; on the last turn the answer is validated as usual.
    const researchedPageOpened = opened.some(
      (page) => origins.get(page.evidenceId) === "SEARCH",
    );
    const decisiveOutcome = researchAction.output.outcome !== "UNSURE";
    const researchRequired = decisiveOutcome && !researchedPageOpened;
    if (
      researchRequired &&
      researchNudges < MAX_RESEARCH_NUDGES &&
      turn < policy.maxTurns
    ) {
      researchNudges += 1;
      completion.attempt.audit.status = "CITATION_INVALID";
      recordToolError({
        turn,
        startedAtMs: stepStart,
        modelRequestId,
        action: researchAction,
        code: "RESEARCH_REQUIRED",
        message: RESEARCH_REQUIRED_MESSAGE,
      });
      continue;
    }

    const openedResultUrls = new Set(openedUrls.values());
    const challengeRequired =
      isTwoSidedPolicy(policy) &&
      decisiveOutcome &&
      !researchRequired &&
      (completedChallengeSearches === 0 ||
        (challengeResultUrls.size > 0 &&
          ![...challengeResultUrls].some((url) =>
            openedResultUrls.has(url),
          )));
    if (
      challengeRequired &&
      challengeNudges < MAX_RESEARCH_NUDGES &&
      turn < policy.maxTurns
    ) {
      challengeNudges += 1;
      completion.attempt.audit.status = "CITATION_INVALID";
      recordToolError({
        turn,
        startedAtMs: stepStart,
        modelRequestId,
        action: researchAction,
        code: "CHALLENGE_REQUIRED",
        message: CHALLENGE_REQUIRED_MESSAGE,
      });
      continue;
    }

    const validation = validateResearchAnswer(researchAction.output, {
      frozenEvidenceIds,
      opened,
      origins,
      maximumReasonLength: deps.input.outputContract.maximumReasonLength,
      evidenceManifest: deps.input.evidenceManifest,
    });
    const ruleErrors: string[] = [];
    if (challengeRequired) ruleErrors.push(CHALLENGE_REQUIRED_MESSAGE);

    let corroborationRequired = false;
    if (
      validation.ok &&
      isTwoSidedPolicy(policy) &&
      decisiveOutcome &&
      !researchRequired &&
      !challengeRequired
    ) {
      const sites = citationSites(validation.citations, { opened, origins });
      corroborationRequired = sites.size < policy.minCitationDomains;
      if (
        corroborationRequired &&
        corroborationNudges < MAX_RESEARCH_NUDGES &&
        turn < policy.maxTurns
      ) {
        corroborationNudges += 1;
        completion.attempt.audit.status = "CITATION_INVALID";
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "CORROBORATION_REQUIRED",
          message: CORROBORATION_REQUIRED_MESSAGE,
        });
        continue;
      }
      if (corroborationRequired) {
        ruleErrors.push(CORROBORATION_REQUIRED_MESSAGE);
      }
    }

    if (
      isTwoSidedPolicy(policy) &&
      decisiveOutcome &&
      !researchRequired &&
      !challengeRequired &&
      !corroborationRequired &&
      (researchAction.output.counterEvidenceSummary?.trim().length ?? 0) === 0
    ) {
      ruleErrors.push("counterEvidenceSummary is required for YES or NO");
    }

    if (validation.ok && ruleErrors.length === 0) {
      completion.attempt.audit.status = "SCHEMA_VALID";
      recordStep(
        turn,
        stepStart,
        modelRequestId,
        researchAction,
        {
          tool: "answer",
          valid: true,
          errors: [],
          // Omit empty repairs so existing transcript hashes do not change.
          ...(validation.repairs.length > 0
            ? { repairs: validation.repairs }
            : {}),
        },
      );
      return {
        ok: true,
        attempts,
        request: completion.request,
        response: completion.response,
        gateway: completion.gateway,
        output: validation.output,
        transcript: transcript(validation.citations),
        opened,
        repairs: validation.repairs,
      };
    }

    const validationErrors = validation.ok
      ? ruleErrors
      : [...validation.errors, ...ruleErrors];
    const status: ResearchLoopFailureStatus = isCitationFailure(
      validationErrors,
    )
      ? "CITATION_INVALID"
      : "INVALID_SCHEMA";
    completion.attempt.audit.status = status;
    recordStep(turn, stepStart, modelRequestId, researchAction, {
      tool: "answer",
      valid: false,
      errors: validationErrors,
    });
    if (repairs < MAX_ANSWER_REPAIRS && turn < policy.maxTurns) {
      repairs += 1;
      push(
        toolResultContent(
          errorToolResult(
            "INVALID_ANSWER",
            deps.spec.repairSystemPrompt,
            validationErrors,
          ),
        ),
      );
      forceAnswerBeforeLastTurn(turn);
      continue;
    }
    return fail(status, validationErrors.join("; "));
  }

  return fail("INVALID_SCHEMA", "no answer within maxTurns");
}

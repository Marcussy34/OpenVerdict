import {
  buildResearchMessages,
  composeSystemPrompt,
  toolPolicyHash,
} from "../gonka/promptSpec";
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
  ProviderRequestRecord,
  ResearchAction,
  ResearchPageOrigin,
  ResearchTranscriptStep,
  ResearchTranscriptV1,
  ResearchToolErrorCode,
  ToolPolicyV2,
} from "../protocol/types";
import {
  errorToolResult,
  normalizeUrl,
  openToolResult,
  parseResearchAction,
  searchToolResult,
  toolResultContent,
} from "./actions";
import { validateResearchAnswer } from "./citations";
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

const RESEARCH_REQUIRED_MESSAGE =
  "The independence rule: YES or NO must cite a page you found with your own search and opened in this run. Search now, open the most relevant result, then answer. UNSURE needs no citation.";

/** Premature YES/NO answers refused before the usual validation and repair take over. */
const MAX_RESEARCH_NUDGES = 2;

function isCitationFailure(errors: readonly string[]): boolean {
  return errors.some(
    (error) => error.includes("citation") || error.includes("independence"),
  );
}

export async function runResearchLoop(
  deps: {
    complete: GonkaCompletion;
    provider: ResearchProvider;
    policy: ToolPolicyV2;
    spec: PromptSpecV2;
    input: OracleInferenceInput;
    manifest: AgentManifest;
    claimId: string;
    phase: 1 | 2;
    pages: PageStore;
    searchCache: SearchCache;
    now?: () => number;
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
  const opened: StoredPage[] = [];
  const origins = new Map<string, ResearchPageOrigin>();
  const steps: ResearchTranscriptStep[] = [];
  const counts = { searches: 0, opens: 0, turns: 0 };
  const frozenEvidenceIds = deps.input.evidenceManifest.items.map(
    (item) => item.evidenceId,
  );
  let jsonMode = true;
  let repaired = false;
  let researchNudges = 0;

  const transcript = (
    citations: Array<Citation & { found: boolean }> = [],
  ): ResearchTranscriptV1 => ({
    version: 1,
    runId: deps.input.runId as HexString,
    provider: { name: deps.provider.name, mode: deps.provider.mode },
    policyHash: toolPolicyHash(policy),
    steps,
    opened: opened.map((page) => ({
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
    })),
    citations,
    counts: { ...counts },
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

  const recordStep = (
    turn: number,
    startedAtMs: number,
    modelRequestId: string,
    action: ResearchTranscriptStep["action"],
    result: ResearchTranscriptStep["result"],
  ): void => {
    steps.push({
      index: steps.length,
      turn,
      startedAtMs,
      completedAtMs: now(),
      modelRequestId,
      action,
      result,
    });
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
      : repaired
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
        content: `${composeSystemPrompt(deps.spec, policy)}${deps.spec.jsonFallbackSuffix}`,
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
    if (!completion.ok) {
      return fail(completion.status, "GonkaRouter provider request failed");
    }

    const modelRequestId = completion.gonkaRequestId;
    messages.push({ role: "assistant", content: completion.content });
    const stepStart = now();
    const parsed = parseResearchAction(completion.content);

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
      if (!repaired && turn < policy.maxTurns) {
        repaired = true;
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
        for (const result of results) {
          const normalized = normalizeUrl(result.url);
          seen.add(normalized);
          foundBySearch.add(normalized);
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
      let normalized: string;
      try {
        normalized = normalizeUrl(researchAction.url);
      } catch {
        recordToolError({
          turn,
          startedAtMs: stepStart,
          modelRequestId,
          action: researchAction,
          code: "URL_NOT_SEEN",
          message: "URL was not seen in this run",
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
          message: "URL was not seen in this run",
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
            const providerPage = await deps.provider.open(researchAction.url, {
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
    if (
      researchAction.output.outcome !== "UNSURE" &&
      !researchedPageOpened &&
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

    const validation = validateResearchAnswer(researchAction.output, {
      frozenEvidenceIds,
      opened,
      origins,
      maximumReasonLength: deps.input.outputContract.maximumReasonLength,
      evidenceManifest: deps.input.evidenceManifest,
    });
    if (validation.ok) {
      completion.attempt.audit.status = "SCHEMA_VALID";
      recordStep(turn, stepStart, modelRequestId, researchAction, {
        tool: "answer",
        valid: true,
        errors: [],
      });
      return {
        ok: true,
        attempts,
        request: completion.request,
        response: completion.response,
        gateway: completion.gateway,
        output: validation.output,
        transcript: transcript(validation.citations),
        opened,
      };
    }

    const status: ResearchLoopFailureStatus = isCitationFailure(
      validation.errors,
    )
      ? "CITATION_INVALID"
      : "INVALID_SCHEMA";
    completion.attempt.audit.status = status;
    recordStep(turn, stepStart, modelRequestId, researchAction, {
      tool: "answer",
      valid: false,
      errors: validation.errors,
    });
    if (!repaired && turn < policy.maxTurns) {
      repaired = true;
      push(
        toolResultContent(
          errorToolResult(
            "INVALID_ANSWER",
            deps.spec.repairSystemPrompt,
            validation.errors,
          ),
        ),
      );
      forceAnswerBeforeLastTurn(turn);
      continue;
    }
    return fail(status, validation.errors.join("; "));
  }

  return fail("INVALID_SCHEMA", "no answer within maxTurns");
}

import type {
  AgentManifest,
  Citation,
  HexString,
  OracleInferenceInput,
  OracleInferenceOutput,
} from "../protocol/types";
import { createGonkaAdapterWithDependencies } from "./adapter";
import {
  DELIBERATION_PROMPT_SPEC_V1,
  DELIBERATION_PROMPT_SPEC_V2,
} from "./promptSpec";
import type {
  GonkaAttemptRecord,
  GonkaCompletionRequest,
  GonkaCompletionResult,
  GonkaRouterAdapter,
  PromptMessage,
} from "./types";

export type FakeFailure =
  | "timeout"
  | "malformed_json"
  | "unknown_outcome"
  | "invented_evidence_id"
  | "http_429"
  | "provider_5xx"
  | "unknown_model"
  | "bad_citation"
  | "no_independent_citation";

export type FakeAction =
  | { search: string }
  | { openResult: number }
  | { openUrl: string };

export type FakeFixture = {
  agentProfileId: HexString;
  gonkaRequestId?: string;
  responseModelId?: string;
  outcome?: OracleInferenceOutput["outcome"];
  confidenceBps?: number;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  unsupportedClaims?: string[];
  decisiveEvidence?: string[];
  reasoning?: string;
  publicReasoningTrace?: OracleInferenceOutput["publicReasoningTrace"];
  inputTokens?: number;
  outputTokens?: number;
  failure?: FakeFailure;
  actions?: FakeAction[];
  citations?: Citation[];
  /** Raw single-shot responses used only by public deliberation tests. */
  deliberationResponses?: string[];
};

type ActiveFixture = {
  fixture: FakeFixture;
  fixtureIndex: number;
  requestCall: number;
  input: OracleInferenceInput;
  manifest: AgentManifest;
  clock: number;
  opened?: {
    evidenceId: string;
    url: string;
    text: string;
  };
};

function completionResponse(
  active: ActiveFixture,
  content: string,
): Response {
  active.requestCall += 1;
  const baseId =
    active.fixture.gonkaRequestId ??
    `msg_fake_${active.fixture.agentProfileId.slice(2, 10)}_${active.fixtureIndex + 1}`;
  const requestId =
    active.requestCall === 1 ? baseId : `${baseId}_attempt_${active.requestCall}`;
  return new Response(
    JSON.stringify({
      id: requestId,
      object: "chat.completion",
      created: active.fixtureIndex + 1,
      model: active.fixture.responseModelId ?? active.manifest.modelId,
      system_fingerprint: "fake-system-fingerprint",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: active.fixture.inputTokens ?? 100,
        completion_tokens: active.fixture.outputTokens ?? 50,
        total_tokens:
          (active.fixture.inputTokens ?? 100) +
          (active.fixture.outputTokens ?? 50),
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": `request_${requestId}`,
        "x-devshard-id": `devshard-fake-${active.fixture.agentProfileId.slice(2, 10)}`,
      },
    },
  );
}

function providerError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixtureOutput(
  active: ActiveFixture,
  openedEvidenceId?: string,
): OracleInferenceOutput {
  const firstEvidenceId = active.input.evidenceManifest.items[0]?.evidenceId;
  const defaultEvidence = [firstEvidenceId, openedEvidenceId].filter(
    (evidenceId): evidenceId is string => evidenceId !== undefined,
  );
  const evidenceFor = active.fixture.evidenceFor ?? [...new Set(defaultEvidence)];
  const decisiveEvidence = active.fixture.decisiveEvidence ?? [
    ...new Set([...evidenceFor, ...(openedEvidenceId ? [openedEvidenceId] : [])]),
  ];
  return {
    outcome: active.fixture.outcome ?? "YES",
    confidenceBps: active.fixture.confidenceBps ?? 8_000,
    evidenceFor,
    evidenceAgainst: active.fixture.evidenceAgainst ?? [],
    unsupportedClaims: active.fixture.unsupportedClaims ?? [],
    decisiveEvidence,
    reasoning:
      active.fixture.reasoning ?? "Deterministic fake inference fixture.",
    publicReasoningTrace:
      active.fixture.publicReasoningTrace ?? [
        {
          check: "Apply the deterministic fixture.",
          evidenceIds: evidenceFor,
          assessment: evidenceFor.length === 0 ? "INSUFFICIENT" : "SUPPORTS",
          finding: "The offline fixture supplied this result.",
        },
      ],
  };
}

function lastUserPayload(messages: PromptMessage[]): Record<string, unknown> | undefined {
  const content = messages.findLast((message) => message.role === "user")?.content;
  if (content === undefined) return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function rememberOpenedPage(
  active: ActiveFixture,
  payload: Record<string, unknown> | undefined,
): void {
  if (
    payload?.tool === "open" &&
    typeof payload.evidenceId === "string" &&
    typeof payload.url === "string" &&
    typeof payload.text === "string"
  ) {
    active.opened = {
      evidenceId: payload.evidenceId,
      url: payload.url,
      text: payload.text,
    };
  }
}

function scriptedActions(active: ActiveFixture): FakeAction[] {
  if (active.fixture.failure === "no_independent_citation") return [];
  return active.fixture.actions ?? [
    { search: active.input.claim.statement.slice(0, 200) },
    { openResult: 0 },
  ];
}

function openedCitations(active: ActiveFixture): Citation[] {
  if (active.fixture.failure === "no_independent_citation") return [];
  if (active.fixture.failure === "bad_citation" && active.opened) {
    return [{
      evidenceId: active.opened.evidenceId,
      url: active.opened.url,
      quote: "this sentence is not in the page",
    }];
  }
  if (active.fixture.citations !== undefined) return active.fixture.citations;
  if (!active.opened) return [];
  return [{
    evidenceId: active.opened.evidenceId,
    url: active.opened.url,
    quote: active.opened.text.replace(/\s+/g, " ").trim().slice(0, 60),
  }];
}

function scriptedContent(
  active: ActiveFixture,
  messages: PromptMessage[],
): string {
  if (active.fixture.failure === "malformed_json") return "{malformed-json";

  const payload = lastUserPayload(messages);
  rememberOpenedPage(active, payload);
  const turn = messages.filter((message) => message.role === "assistant").length;
  const action = scriptedActions(active)[turn];
  if (action && "search" in action) {
    return JSON.stringify({ action: "search", query: action.search });
  }
  if (action && "openUrl" in action) {
    return JSON.stringify({ action: "open", url: action.openUrl, from: 0 });
  }
  if (action && "openResult" in action) {
    if (payload?.tool !== "search" || !Array.isArray(payload.results)) {
      throw new Error("fake openResult action requires a prior search tool result");
    }
    const result = payload.results[action.openResult];
    if (
      typeof result !== "object" ||
      result === null ||
      typeof (result as Record<string, unknown>).url !== "string"
    ) {
      throw new Error(`fake search result ${action.openResult} has no URL`);
    }
    return JSON.stringify({
      action: "open",
      url: (result as Record<string, unknown>).url,
      from: 0,
    });
  }

  const output = fixtureOutput(active, active.opened?.evidenceId);
  const answerOutput: Record<string, unknown> = {
    ...output,
    citations: openedCitations(active),
  };
  if (active.fixture.failure === "unknown_outcome") {
    answerOutput.outcome = "MAYBE";
  }
  if (active.fixture.failure === "invented_evidence_id") {
    answerOutput.evidenceFor = ["invented-evidence-id"];
  }
  if (active.fixture.failure === "no_independent_citation") {
    answerOutput.outcome = "YES";
  }
  return JSON.stringify({ action: "answer", output: answerOutput });
}

function createFixtureAdapter(
  active: ActiveFixture,
  completionContent?: string,
): GonkaRouterAdapter {
  const fakeFetch: typeof fetch = async () => {
    const failure = active.fixture.failure;
    if (failure === "timeout") {
      throw Object.assign(new Error("fake GonkaRouter timeout"), {
        name: "TimeoutError",
      });
    }
    if (failure === "http_429") return providerError(429, "fake rate limit");
    if (failure === "provider_5xx") return providerError(503, "fake provider outage");
    if (failure === "unknown_model") return providerError(400, "unknown model");
    if (completionContent !== undefined) {
      return completionResponse(active, completionContent);
    }

    const output = fixtureOutput(active);
    if (failure === "malformed_json") {
      return completionResponse(active, "{malformed-json");
    }
    if (failure === "unknown_outcome") {
      return completionResponse(active, JSON.stringify({ ...output, outcome: "MAYBE" }));
    }
    if (failure === "invented_evidence_id") {
      return completionResponse(
        active,
        JSON.stringify({ ...output, evidenceFor: ["invented-evidence-id"] }),
      );
    }
    return completionResponse(active, JSON.stringify(output));
  };

  return createGonkaAdapterWithDependencies(
    {
      apiKey: "fake-offline-key",
      timeoutMs: 120_000,
      maxRetries: 1,
    },
    {
      fetch: fakeFetch,
      now: () => {
        const current = active.clock;
        active.clock += 1;
        return current;
      },
      random: () => 0,
      sleep: async () => undefined,
    },
  );
}

/** Deterministic offline adapter with the same opaque run/audit envelope. */
export function createFakeGonkaAdapter(fixtures: FakeFixture[]): GonkaRouterAdapter {
  const fixturesByAgent = new Map<string, FakeFixture[]>();
  for (const fixture of fixtures) {
    const queue = fixturesByAgent.get(fixture.agentProfileId) ?? [];
    queue.push(fixture);
    fixturesByAgent.set(fixture.agentProfileId, queue);
  }

  const cursors = new Map<string, number>();
  const deliberationCursors = new Map<string, number>();
  const activeByAttempts = new WeakMap<GonkaAttemptRecord[], ActiveFixture>();
  const utilityAdapter = createGonkaAdapterWithDependencies(
    {
      apiKey: "fake-offline-key",
      timeoutMs: 120_000,
      maxRetries: 0,
    },
    {
      fetch: async () => {
        throw new Error("fake utility adapter cannot make provider requests");
      },
      now: () => 0,
    },
  );

  const nextActive = (
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): ActiveFixture => {
    const queue = fixturesByAgent.get(manifest.agentProfileId);
    if (!queue || queue.length === 0) {
      throw new Error(`no fake Gonka fixture for agent ${manifest.agentProfileId}`);
    }
    const cursor = cursors.get(manifest.agentProfileId) ?? 0;
    const fixtureIndex = Math.min(cursor, queue.length - 1);
    const fixture = queue[fixtureIndex];
    if (!fixture) throw new Error("fake fixture queue is unexpectedly empty");
    cursors.set(manifest.agentProfileId, cursor + 1);
    return {
      fixture,
      fixtureIndex,
      requestCall: 0,
      input,
      manifest,
      clock: fixtureIndex * 100,
    };
  };

  const nextDeliberation = (
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): { active: ActiveFixture; content: string } => {
    const queue = fixturesByAgent.get(manifest.agentProfileId);
    if (!queue || queue.length === 0) {
      throw new Error(`no fake Gonka fixture for agent ${manifest.agentProfileId}`);
    }
    // Deliberation belongs to the most recently consumed jury fixture and
    // must not consume the next fixture reserved for round two.
    const inferenceCursor = cursors.get(manifest.agentProfileId) ?? 1;
    const fixtureIndex = Math.min(
      Math.max(0, inferenceCursor - 1),
      queue.length - 1,
    );
    const source = queue[fixtureIndex];
    if (!source) throw new Error("fake fixture queue is unexpectedly empty");
    const responseIndex = deliberationCursors.get(manifest.agentProfileId) ?? 0;
    deliberationCursors.set(manifest.agentProfileId, responseIndex + 1);
    const responses = source.deliberationResponses ?? [];
    const content = responses.length === 0
      ? JSON.stringify({
          argument: "This juror maintains the position in its revealed record.",
          citations: [],
        })
      : responses[Math.min(responseIndex, responses.length - 1)]!;
    return {
      active: {
        fixture: {
          ...source,
          gonkaRequestId:
            `msg_fake_deliberation_${manifest.agentProfileId.slice(2, 10)}_${responseIndex + 1}`,
        },
        fixtureIndex,
        requestCall: 0,
        input,
        manifest,
        clock: responseIndex * 100,
      },
      content,
    };
  };

  async function run(
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): Promise<unknown> {
    const active = nextActive(input, manifest);
    return createFixtureAdapter(active).run(input, manifest);
  }

  async function complete(
    request: GonkaCompletionRequest,
  ): Promise<GonkaCompletionResult> {
    if (
      request.messages[0]?.content === DELIBERATION_PROMPT_SPEC_V1.systemPrompt ||
      request.messages[0]?.content === DELIBERATION_PROMPT_SPEC_V2.systemPrompt
    ) {
      const deliberation = nextDeliberation(request.input, request.manifest);
      return createFixtureAdapter(
        deliberation.active,
        deliberation.content,
      ).complete(request);
    }
    let active = activeByAttempts.get(request.attempts);
    if (!active) {
      active = nextActive(request.input, request.manifest);
      activeByAttempts.set(request.attempts, active);
    }
    return createFixtureAdapter(
      active,
      scriptedContent(active, request.messages),
    ).complete(request);
  }

  return {
    promptSpec: utilityAdapter.promptSpec,
    promptSpecHash: utilityAdapter.promptSpecHash,
    toolPolicy: utilityAdapter.toolPolicy,
    toolPolicyHash: utilityAdapter.toolPolicyHash,
    legacyPromptSpec: utilityAdapter.legacyPromptSpec,
    run,
    complete,
    normalizeResponse: utilityAdapter.normalizeResponse,
    validateOutput: utilityAdapter.validateOutput,
    buildRunAudit: utilityAdapter.buildRunAudit,
  };
}

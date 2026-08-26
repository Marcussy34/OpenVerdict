import type {
  AgentManifest,
  HexString,
  OracleInferenceInput,
  OracleInferenceOutput,
} from "../protocol/types";
import { createGonkaAdapterWithDependencies } from "./adapter";
import type { GonkaRouterAdapter } from "./types";

export type FakeFailure =
  | "timeout"
  | "malformed_json"
  | "unknown_outcome"
  | "invented_evidence_id"
  | "http_429"
  | "provider_5xx"
  | "unknown_model";

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
};

type ActiveFixture = {
  fixture: FakeFixture;
  fixtureIndex: number;
  requestCall: number;
  input: OracleInferenceInput;
  manifest: AgentManifest;
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
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function providerError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixtureOutput(active: ActiveFixture): OracleInferenceOutput {
  const firstEvidenceId = active.input.evidenceManifest.items[0]?.evidenceId;
  const evidenceFor = active.fixture.evidenceFor ??
    (firstEvidenceId === undefined ? [] : [firstEvidenceId]);
  return {
    outcome: active.fixture.outcome ?? "YES",
    confidenceBps: active.fixture.confidenceBps ?? 8_000,
    evidenceFor,
    evidenceAgainst: active.fixture.evidenceAgainst ?? [],
    unsupportedClaims: active.fixture.unsupportedClaims ?? [],
    decisiveEvidence: active.fixture.decisiveEvidence ?? evidenceFor,
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

function createFixtureAdapter(active: ActiveFixture): GonkaRouterAdapter {
  let clock = active.fixtureIndex * 100;
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
      baseUrl: "https://fake.gonka.invalid/v1",
      apiKey: "fake-offline-key",
      timeoutMs: 120_000,
      maxRetries: 1,
    },
    {
      fetch: fakeFetch,
      now: () => {
        const current = clock;
        clock += 1;
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
  const utilityAdapter = createGonkaAdapterWithDependencies(
    {
      baseUrl: "https://fake.gonka.invalid/v1",
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

  async function run(
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): Promise<unknown> {
    const queue = fixturesByAgent.get(manifest.agentProfileId);
    if (!queue || queue.length === 0) {
      throw new Error(`no fake Gonka fixture for agent ${manifest.agentProfileId}`);
    }
    const cursor = cursors.get(manifest.agentProfileId) ?? 0;
    const fixtureIndex = Math.min(cursor, queue.length - 1);
    const fixture = queue[fixtureIndex];
    if (!fixture) throw new Error("fake fixture queue is unexpectedly empty");
    cursors.set(manifest.agentProfileId, cursor + 1);
    const active = { fixture, fixtureIndex, requestCall: 0, input, manifest };
    return createFixtureAdapter(active).run(input, manifest);
  }

  return {
    run,
    normalizeResponse: utilityAdapter.normalizeResponse,
    validateOutput: utilityAdapter.validateOutput,
    buildRunAudit: utilityAdapter.buildRunAudit,
  };
}

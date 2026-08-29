import { describe, expect, it } from "vitest";
import { createFakeGonkaAdapter } from "./fake";
import {
  GonkaRunError,
  isGonkaRunResult,
  type GonkaAttemptRecord,
  type GonkaRouterAdapter,
  type PromptMessage,
} from "./types";
import { AGENT_ID, makeInput, makeManifest } from "./fixtures.test-utils";

async function completeTurn(
  adapter: GonkaRouterAdapter,
  messages: PromptMessage[],
  attempts: GonkaAttemptRecord[],
): Promise<Record<string, unknown>> {
  const result = await adapter.complete({
    manifest: makeManifest(),
    messages,
    kind: "PRIMARY",
    jsonMode: true,
    input: makeInput({ promptVersion: "2" }),
    attempts,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected fake completion");
  messages.push({ role: "assistant", content: result.content });
  return JSON.parse(result.content) as Record<string, unknown>;
}

describe("createFakeGonkaAdapter", () => {
  it("returns deterministic scripted output for an agent", async () => {
    const fixture = {
      agentProfileId: AGENT_ID,
      gonkaRequestId: "msg_fake_one",
      outcome: "NO" as const,
      confidenceBps: 7_500,
      evidenceFor: ["evidence-2"],
      evidenceAgainst: ["evidence-1"],
      decisiveEvidence: ["evidence-2"],
    };

    const firstAdapter = createFakeGonkaAdapter([fixture]);
    const secondAdapter = createFakeGonkaAdapter([fixture]);
    const first = await firstAdapter.run(makeInput(), makeManifest());
    const second = await secondAdapter.run(makeInput(), makeManifest());

    expect(isGonkaRunResult(first)).toBe(true);
    if (!isGonkaRunResult(first)) throw new Error("expected a GonkaRunResult");
    expect(first).toEqual(second);
    expect(first.request.attemptKind).toBe("PRIMARY");
    expect(first.gateway).toEqual({
      gatewayRequestId: "request_msg_fake_one",
      devshardId: "devshard-fake-11111111",
      systemFingerprint: "fake-system-fingerprint",
    });
    expect(firstAdapter.promptSpec().version).toBe("2");
    expect(firstAdapter.legacyPromptSpec().version).toBe("1");
    expect(firstAdapter.promptSpecHash()).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(firstAdapter.normalizeResponse(first)).resolves.toMatchObject({
      gonkaRequestId: "msg_fake_one",
      output: { outcome: "NO", confidenceBps: 7_500 },
    });
  });

  it.each([
    ["timeout", "TIMEOUT"],
    ["malformed_json", "INVALID_SCHEMA"],
    ["unknown_outcome", "INVALID_SCHEMA"],
    ["invented_evidence_id", "INVALID_SCHEMA"],
  ] as const)("injects %s as a visible %s failure", async (failure, status) => {
    const adapter = createFakeGonkaAdapter([{ agentProfileId: AGENT_ID, failure }]);

    try {
      await adapter.run(makeInput(), makeManifest());
      throw new Error("expected fake failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GonkaRunError);
      expect((error as GonkaRunError).result.attempts[0]?.audit.status).toBe(status);
    }
  });

  it("supports sequential fixtures for the same agent", async () => {
    const adapter = createFakeGonkaAdapter([
      { agentProfileId: AGENT_ID, outcome: "YES", confidenceBps: 9_000 },
      { agentProfileId: AGENT_ID, outcome: "UNSURE", confidenceBps: 1_000 },
    ]);

    const first = await adapter.normalizeResponse(
      await adapter.run(makeInput(), makeManifest()),
    );
    const second = await adapter.normalizeResponse(
      await adapter.run(makeInput(), makeManifest()),
    );

    expect(first.output.outcome).toBe("YES");
    expect(second.output.outcome).toBe("UNSURE");
  });

  it("keeps fixtures isolated across concurrent agent runs", async () => {
    const secondAgentId = `0x${"41".repeat(32)}` as const;
    const adapter = createFakeGonkaAdapter([
      { agentProfileId: AGENT_ID, outcome: "YES", confidenceBps: 9_000 },
      { agentProfileId: secondAgentId, outcome: "NO", confidenceBps: 8_000 },
    ]);

    const [first, second] = await Promise.all([
      adapter.run(makeInput(), makeManifest()),
      adapter.run(
        makeInput({ runId: `0x${"42".repeat(32)}` }),
        makeManifest({ agentProfileId: secondAgentId }),
      ),
    ]);
    const [firstNormalized, secondNormalized] = await Promise.all([
      adapter.normalizeResponse(first),
      adapter.normalizeResponse(second),
    ]);

    expect(firstNormalized.output.outcome).toBe("YES");
    expect(secondNormalized.output.outcome).toBe("NO");
  });

  it("replays the default search, open, and cited answer script", async () => {
    const adapter = createFakeGonkaAdapter([{ agentProfileId: AGENT_ID }]);
    const messages: PromptMessage[] = [
      { role: "system", content: "research" },
      { role: "user", content: "claim" },
    ];
    const attempts: GonkaAttemptRecord[] = [];

    const search = await completeTurn(adapter, messages, attempts);
    expect(search).toEqual({
      action: "search",
      query: "The statement is true.",
    });
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool: "search",
        results: [
          {
            n: 0,
            title: "Independent source",
            url: "https://example.com/source",
            snippet: "A relevant result.",
          },
        ],
      }),
    });

    const open = await completeTurn(adapter, messages, attempts);
    expect(open).toEqual({
      action: "open",
      url: "https://example.com/source",
      from: 0,
    });
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool: "open",
        evidenceId: "opened-evidence-1",
        url: "https://example.com/source",
        text: "First  independent\nsource confirms the claim clearly and adds more detail for citation.",
      }),
    });

    const answer = await completeTurn(adapter, messages, attempts);
    expect(answer.action).toBe("answer");
    expect(answer.output).toMatchObject({
      evidenceFor: expect.arrayContaining(["opened-evidence-1"]),
      decisiveEvidence: expect.arrayContaining(["opened-evidence-1"]),
      citations: [
        {
          evidenceId: "opened-evidence-1",
          url: "https://example.com/source",
          quote: "First independent source confirms the claim clearly and adds",
        },
      ],
    });
    expect(attempts.map((attempt) => attempt.audit.status)).toEqual([
      "RECEIVED",
      "RECEIVED",
      "RECEIVED",
    ]);
  });

  it("emits a bad quote for the bad_citation failure", async () => {
    const adapter = createFakeGonkaAdapter([
      { agentProfileId: AGENT_ID, failure: "bad_citation" },
    ]);
    const messages: PromptMessage[] = [
      { role: "system", content: "research" },
      { role: "user", content: "claim" },
    ];
    const attempts: GonkaAttemptRecord[] = [];

    await completeTurn(adapter, messages, attempts);
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool: "search",
        results: [{ n: 0, url: "https://example.com/source" }],
      }),
    });
    await completeTurn(adapter, messages, attempts);
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool: "open",
        evidenceId: "opened-evidence-1",
        url: "https://example.com/source",
        text: "This page has enough source text for a valid citation quote.",
      }),
    });

    const answer = await completeTurn(adapter, messages, attempts);
    expect(answer.output).toMatchObject({
      citations: [
        expect.objectContaining({
          quote: "this sentence is not in the page",
        }),
      ],
    });
  });

  it("answers YES without citations for no_independent_citation", async () => {
    const adapter = createFakeGonkaAdapter([
      { agentProfileId: AGENT_ID, failure: "no_independent_citation" },
    ]);
    const messages: PromptMessage[] = [
      { role: "system", content: "research" },
      { role: "user", content: "claim" },
    ];

    const answer = await completeTurn(adapter, messages, []);

    expect(answer).toMatchObject({
      action: "answer",
      output: { outcome: "YES", citations: [] },
    });
  });
});

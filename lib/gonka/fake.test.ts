import { describe, expect, it } from "vitest";
import { createFakeGonkaAdapter } from "./fake";
import { GonkaRunError, isGonkaRunResult } from "./types";
import { AGENT_ID, makeInput, makeManifest } from "./fixtures.test-utils";

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
    expect(first).toEqual(second);
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
});

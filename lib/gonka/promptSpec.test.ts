import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  buildPrimaryMessages,
  buildRepairMessages,
  buildResearchMessages,
  composeSystemPrompt,
  promptSpecHash,
  toolPolicyHash,
} from "./promptSpec";
import { canonicalJsonString } from "./canonical";
import { makeInput } from "./fixtures.test-utils";

describe("promptSpec", () => {
  it("hashes canonically and stably", () => {
    const a = promptSpecHash(DEFAULT_PROMPT_SPEC_V1);
    const b = promptSpecHash({ ...DEFAULT_PROMPT_SPEC_V1 });
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("changes when any byte of the system prompt changes", () => {
    const changed = {
      ...DEFAULT_PROMPT_SPEC_V1,
      systemPrompt: `${DEFAULT_PROMPT_SPEC_V1.systemPrompt} `,
    };
    expect(promptSpecHash(changed)).not.toBe(
      promptSpecHash(DEFAULT_PROMPT_SPEC_V1),
    );
  });

  it("builds the primary messages from the spec only", () => {
    const messages = buildPrimaryMessages(DEFAULT_PROMPT_SPEC_V1, {
      protocolVersion: "1.0",
    } as never);
    expect(messages[0]).toEqual({
      role: "system",
      content: DEFAULT_PROMPT_SPEC_V1.systemPrompt,
    });
    expect(messages[1]?.role).toBe("user");
  });

  it("repair messages use the repair system prompt verbatim", () => {
    const messages = buildRepairMessages(
      DEFAULT_PROMPT_SPEC_V1,
      {
        evidenceManifest: { items: [] },
        outputContract: { maximumReasonLength: 4000 },
      } as never,
      "not json",
    );
    expect(messages[0]).toEqual({
      role: "system",
      content: DEFAULT_PROMPT_SPEC_V1.repairSystemPrompt,
    });
  });
});

describe("prompt spec v2 and tool policy v2", () => {
  it("starts with the product sentence and names all three actions", () => {
    expect(
      DEFAULT_PROMPT_SPEC_V2.systemPrompt.startsWith(
        "Research independently. Cite sources with URLs.",
      ),
    ).toBe(true);
    for (const action of [
      '"action":"search"',
      '"action":"open"',
      '"action":"answer"',
    ]) {
      expect(DEFAULT_PROMPT_SPEC_V2.systemPrompt).toContain(action);
    }
    expect(DEFAULT_PROMPT_SPEC_V2.version).toBe("2");
  });

  it("teaches page refs and verbatim quotes within the smaller page slice", () => {
    expect(DEFAULT_PROMPT_SPEC_V2.systemPrompt).toContain('"ref"');
    expect(DEFAULT_PROMPT_SPEC_V2.systemPrompt).toContain("verbatim");
    expect(DEFAULT_PROMPT_SPEC_V2.repairSystemPrompt).toContain("verbatim");
    expect(DEFAULT_TOOL_POLICY_V2.pageSliceChars).toBe(4_000);
  });

  it("hashes the tool policy over canonical JSON and changes with any budget", () => {
    const base = toolPolicyHash(DEFAULT_TOOL_POLICY_V2);
    expect(base).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      toolPolicyHash({ ...DEFAULT_TOOL_POLICY_V2, maxOpens: 5 }),
    ).not.toBe(base);
    expect(toolPolicyHash({ version: "1", tools: [] })).not.toBe(base);
  });

  it("composes the system prompt from the two hashed documents", () => {
    const composed = composeSystemPrompt(
      DEFAULT_PROMPT_SPEC_V2,
      DEFAULT_TOOL_POLICY_V2,
    );
    expect(composed).toBe(
      `${DEFAULT_PROMPT_SPEC_V2.systemPrompt}\n${canonicalJsonString({ budgets: DEFAULT_TOOL_POLICY_V2 })}`,
    );
    const messages = buildResearchMessages(
      DEFAULT_PROMPT_SPEC_V2,
      DEFAULT_TOOL_POLICY_V2,
      makeInput(),
    );
    expect(messages[0]).toEqual({ role: "system", content: composed });
    expect(messages[1]?.role).toBe("user");
  });

  it("keeps the v1 hash stable", () => {
    expect(promptSpecHash(DEFAULT_PROMPT_SPEC_V1)).toBe(
      promptSpecHash({ ...DEFAULT_PROMPT_SPEC_V1 }),
    );
  });
});

describe("prompt spec v3 and tool policy v3", () => {
  it("binds the two-sided research method and answer contract", () => {
    expect(
      DEFAULT_PROMPT_SPEC_V3.systemPrompt.startsWith(
        "Research independently and weigh both sides. Cite sources with URLs.",
      ),
    ).toBe(true);
    expect(DEFAULT_PROMPT_SPEC_V3.systemPrompt).toContain(
      '"intent":"support" or "challenge"',
    );
    expect(DEFAULT_PROMPT_SPEC_V3.systemPrompt).toContain(
      '"counterEvidenceSummary"',
    );
    expect(DEFAULT_PROMPT_SPEC_V3.systemPrompt).toContain(
      "Cite at least two pages from two different sites.",
    );
    expect(DEFAULT_PROMPT_SPEC_V3.repairSystemPrompt).toBe(
      `${DEFAULT_PROMPT_SPEC_V2.repairSystemPrompt} Include intent (support or challenge) on every search action and a counterEvidenceSummary in the answer.`,
    );
  });

  it("uses the v3 corroboration budgets in the composed prompt", () => {
    expect(DEFAULT_TOOL_POLICY_V3).toMatchObject({
      version: "3",
      maxSearches: 4,
      maxOpens: 5,
      maxTurns: 10,
      requireChallengeSearch: true,
      minCitationDomains: 2,
      minOpensPerSide: 1,
    });
    const composed = composeSystemPrompt(
      DEFAULT_PROMPT_SPEC_V3,
      DEFAULT_TOOL_POLICY_V3,
    );
    expect(composed).toBe(
      `${DEFAULT_PROMPT_SPEC_V3.systemPrompt}\n${canonicalJsonString({ budgets: DEFAULT_TOOL_POLICY_V3 })}`,
    );
    expect(
      buildResearchMessages(
        DEFAULT_PROMPT_SPEC_V3,
        DEFAULT_TOOL_POLICY_V3,
        makeInput({ promptVersion: "3" }),
      )[0]?.content,
    ).toBe(composed);
    expect(promptSpecHash(DEFAULT_PROMPT_SPEC_V3)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    expect(toolPolicyHash(DEFAULT_TOOL_POLICY_V3)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
  });
});

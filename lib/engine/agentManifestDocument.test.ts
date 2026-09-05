import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROMPT_SPEC_V1,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_PROMPT_SPEC_V5,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
  promptSpecHash,
  tableVotePromptSpecHash,
  toolPolicyHash,
} from "../gonka/promptSpec";
import {
  buildAgentManifestDocument,
  parseAgentManifestDocument,
} from "./agentManifestDocument";

const base = {
  network: "testnet" as const,
  backingKind: "TESTNET_DEMO_ALLOWLIST" as const,
  humanBackingHash: `0x${"11".repeat(32)}` as const,
  humanVerificationProvider: "testnet-demo-allowlist",
  operationalOwner: `0x${"22".repeat(32)}` as const,
  role: "SKEPTIC",
  modelId: "MiniMaxAI/MiniMax-M2.7",
  promptSpec: DEFAULT_PROMPT_SPEC_V1,
  evidencePolicyId: "OPENVERDICT_EVIDENCE_POLICY_V1",
};

const v5Params = {
  ...base,
  promptSpec: DEFAULT_PROMPT_SPEC_V4,
  toolPolicy: DEFAULT_TOOL_POLICY_V4,
};

describe("buildAgentManifestDocument", () => {
  it("embeds the prompt spec and binds its hash", () => {
    const built = buildAgentManifestDocument(base);
    expect(built.document.version).toBe("2");
    expect(built.document.promptHash).toBe(
      promptSpecHash(DEFAULT_PROMPT_SPEC_V1),
    );
    expect(built.promptHash).toBe(built.document.promptHash);
    expect(built.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for equal inputs and sensitive to the model id", () => {
    expect(buildAgentManifestDocument(base).manifestHash).toBe(
      buildAgentManifestDocument({ ...base }).manifestHash,
    );
    expect(
      buildAgentManifestDocument({
        ...base,
        modelId: "moonshotai/Kimi-K2.6",
      }).manifestHash,
    ).not.toBe(buildAgentManifestDocument(base).manifestHash);
  });

  it("parses only strict version 2 documents", () => {
    const built = buildAgentManifestDocument(base);
    expect(parseAgentManifestDocument(built.bytes)).toEqual(built.document);
    const invalid = new TextEncoder().encode(
      JSON.stringify({ ...built.document, version: "1" }),
    );
    expect(() => parseAgentManifestDocument(invalid)).toThrow();
  });

  it("builds a v3 document when given a v2 prompt spec and a tool policy", () => {
    const built = buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V2,
      toolPolicy: DEFAULT_TOOL_POLICY_V2,
    });
    expect(built.document.version).toBe("3");
    expect(built.promptHash).toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V2));
    expect(built.toolPolicyHash).toBe(toolPolicyHash(DEFAULT_TOOL_POLICY_V2));
    expect(parseAgentManifestDocument(built.bytes)).toEqual(built.document);
  });

  it("still parses v2 documents and rejects a v3 document with a v1 spec", () => {
    const v2 = buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V1,
    });
    expect(parseAgentManifestDocument(v2.bytes).version).toBe("2");
    const bad = JSON.parse(
      new TextDecoder().decode(v2.bytes),
    ) as Record<string, unknown>;
    bad.version = "3";
    expect(() =>
      parseAgentManifestDocument(
        new TextEncoder().encode(JSON.stringify(bad)),
      ),
    ).toThrow();
  });

  it("builds and parses a v4 document with bound v3 hashes", () => {
    const built = buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V3,
      toolPolicy: DEFAULT_TOOL_POLICY_V3,
    });

    expect(built.document.version).toBe("4");
    expect(built.promptHash).toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V3));
    expect(built.toolPolicyHash).toBe(toolPolicyHash(DEFAULT_TOOL_POLICY_V3));
    expect(parseAgentManifestDocument(built.bytes)).toEqual(built.document);
    expect(buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V3,
      toolPolicy: DEFAULT_TOOL_POLICY_V3,
    }).manifestHash).toBe(built.manifestHash);
  });

  it("round-trips a v5 document with bound v4 hashes", () => {
    const built = buildAgentManifestDocument(v5Params);

    expect(built.document.version).toBe("5");
    expect(built.promptHash).toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V4));
    expect(built.toolPolicyHash).toBe(toolPolicyHash(DEFAULT_TOOL_POLICY_V4));
    expect(parseAgentManifestDocument(built.bytes)).toEqual(built.document);
    expect(
      buildAgentManifestDocument({
        ...base,
        promptSpec: DEFAULT_PROMPT_SPEC_V4,
        toolPolicy: DEFAULT_TOOL_POLICY_V4,
      }).manifestHash,
    ).toBe(built.manifestHash);
  });

  it("pins a v5 prompt spec in the same v5 and v6 documents", () => {
    // Prompt v5 only appends instructions to v4, so the document shape and its
    // tool policy are unchanged; only the pinned prompt hash moves.
    const built = buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V5,
      toolPolicy: DEFAULT_TOOL_POLICY_V4,
    });

    expect(built.document.version).toBe("5");
    expect(built.promptHash).toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V5));
    expect(built.promptHash).not.toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V4));
    expect(built.toolPolicyHash).toBe(toolPolicyHash(DEFAULT_TOOL_POLICY_V4));
    expect(parseAgentManifestDocument(built.bytes)).toEqual(built.document);

    const withTableVote = buildAgentManifestDocument({
      ...base,
      promptSpec: DEFAULT_PROMPT_SPEC_V5,
      toolPolicy: DEFAULT_TOOL_POLICY_V4,
      tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
    });
    expect(withTableVote.document.version).toBe("6");
    expect(withTableVote.promptHash).toBe(
      promptSpecHash(DEFAULT_PROMPT_SPEC_V5),
    );
    expect(withTableVote.tableVotePromptHash).toBe(tableVotePromptSpecHash());
    expect(parseAgentManifestDocument(withTableVote.bytes)).toEqual(
      withTableVote.document,
    );
    expect(withTableVote.manifestHash).not.toBe(
      buildAgentManifestDocument({
        ...v5Params,
        tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
      }).manifestHash,
    );
  });

  it("refuses a v5 prompt spec on an older tool policy", () => {
    expect(() =>
      buildAgentManifestDocument({
        ...base,
        promptSpec: DEFAULT_PROMPT_SPEC_V5,
        toolPolicy: DEFAULT_TOOL_POLICY_V3,
      }),
    ).toThrow(/v4 or v5 prompt spec requires a v4 tool policy/);
  });

  it("builds and parses a v6 document that pins the table vote prompt", () => {
    const built = buildAgentManifestDocument({
      ...v5Params,
      tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
    });
    expect(built.document.version).toBe("6");
    expect(built.tableVotePromptHash).toBe(tableVotePromptSpecHash());
    const parsed = parseAgentManifestDocument(built.bytes);
    expect(parsed.version).toBe("6");
    if (parsed.version === "6") {
      expect(parsed.tableVotePromptHash).toBe(built.tableVotePromptHash);
      expect(parsed.tableVotePromptSpec).toEqual(TABLE_VOTE_PROMPT_SPEC_V1);
    }
  });

  it("still builds a v5 document when no table vote spec is given", () => {
    const built = buildAgentManifestDocument(v5Params);
    expect(built.document.version).toBe("5");
    expect(built.tableVotePromptHash).toBeUndefined();
  });
});

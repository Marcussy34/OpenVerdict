import { z } from "zod";

import { canonicalJsonBytes } from "../gonka/canonical";
import { promptSpecHash, toolPolicyHash } from "../gonka/promptSpec";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  AgentBackingKind,
  AgentManifestDocument,
  AgentManifestDocumentV2,
  AgentManifestDocumentV3,
  AgentManifestDocumentV4,
  AgentManifestDocumentV5,
  AgentManifestDocumentV6,
  HexString,
  PromptSpec,
  PromptSpecV1,
  PromptSpecV2,
  PromptSpecV3,
  PromptSpecV4,
  TableVotePromptSpecV1,
  ToolPolicyV2,
  ToolPolicyV3,
  ToolPolicyV4,
} from "../protocol/types";

const utf8 = new TextEncoder();

/**
 * The human-readable evidence policy label. A manifest document carries this
 * label as evidencePolicyId and blake2b256(label) as evidencePolicyHash, which
 * is exactly the on-chain policy id the engine derives for the default policy,
 * so every backing kind produces the same document semantics.
 */
export const EVIDENCE_POLICY_V1_LABEL = "OPENVERDICT_EVIDENCE_POLICY_V1";

const hexStringSchema = z.custom<HexString>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value),
  "expected a 0x-prefixed hexadecimal string",
);

const promptSpecV1Schema = z
  .object({
    version: z.literal("1"),
    providerId: z.literal("gonkarouter"),
    systemPrompt: z.string(),
    jsonFallbackSuffix: z.string(),
    repairSystemPrompt: z.string(),
    temperature: z.literal(0),
    maxOutputTokens: z.literal(4096),
    responseFormat: z.literal("json_object"),
  })
  .strict() satisfies z.ZodType<PromptSpecV1>;

const promptSpecV2Schema = z
  .object({
    version: z.literal("2"),
    providerId: z.literal("gonkarouter"),
    systemPrompt: z.string(),
    jsonFallbackSuffix: z.string(),
    repairSystemPrompt: z.string(),
    temperature: z.literal(0),
    maxOutputTokens: z.literal(4096),
    responseFormat: z.literal("json_object"),
  })
  .strict() satisfies z.ZodType<PromptSpecV2>;

const promptSpecV3Schema = promptSpecV2Schema
  .extend({ version: z.literal("3") })
  .strict() satisfies z.ZodType<PromptSpecV3>;

const promptSpecV4Schema = promptSpecV2Schema
  .extend({ version: z.literal("4") })
  .strict() satisfies z.ZodType<PromptSpecV4>;

/** V6 validates the fixed shape of the no-tools table-vote prompt. */
const tableVotePromptSpecV1Schema = z
  .object({
    version: z.literal("1"),
    providerId: z.literal("gonkarouter"),
    systemPrompt: z.string().min(1),
    temperature: z.literal(0),
    maxOutputTokens: z.literal(2048),
    responseFormat: z.literal("json_object"),
  })
  .strict() satisfies z.ZodType<TableVotePromptSpecV1>;

const toolPolicyV2Schema = z
  .object({
    version: z.literal("2"),
    tools: z.tuple([z.literal("search"), z.literal("open")]),
    provider: z.literal("firecrawl"),
    maxSearches: z.number().int().positive(),
    maxOpens: z.number().int().positive(),
    maxTurns: z.number().int().positive(),
    resultsPerSearch: z.number().int().positive(),
    snippetChars: z.number().int().positive(),
    pageSliceChars: z.number().int().positive(),
    maxPageChars: z.number().int().positive(),
    maxLoopMs: z.number().int().positive(),
  })
  .strict() satisfies z.ZodType<ToolPolicyV2>;

const toolPolicyV3Schema = toolPolicyV2Schema
  .extend({
    version: z.literal("3"),
    requireChallengeSearch: z.literal(true),
    minCitationDomains: z.number().int().positive(),
    minOpensPerSide: z.number().int().positive(),
  })
  .strict() satisfies z.ZodType<ToolPolicyV3>;

const toolPolicyV4Schema = toolPolicyV3Schema
  .extend({
    version: z.literal("4"),
    maxOpensPerTurn: z.number().int().positive(),
  })
  .strict() satisfies z.ZodType<ToolPolicyV4>;

const agentManifestDocumentV2Schema = z
  .object({
    version: z.literal("2"),
    network: z.enum(["localnet", "testnet", "mainnet"]),
    backingKind: z.enum([
      "TESTNET_DEMO_ALLOWLIST",
      "ZKLOGIN_BACKED",
      "WALLET_STAKED",
    ]),
    humanBackingHash: hexStringSchema,
    humanVerificationProvider: z.string(),
    operationalOwner: hexStringSchema,
    role: z.string(),
    modelId: z.string(),
    providerId: z.literal("gonkarouter"),
    promptSpec: promptSpecV1Schema,
    promptHash: hexStringSchema,
    toolPolicy: z
      .object({
        version: z.literal("1"),
        tools: z.tuple([]),
      })
      .strict(),
    toolPolicyHash: hexStringSchema,
    evidencePolicyId: z.string(),
    evidencePolicyHash: hexStringSchema,
  })
  .strict() satisfies z.ZodType<AgentManifestDocumentV2>;

const agentManifestDocumentV3Schema = z
  .object({
    version: z.literal("3"),
    network: z.enum(["localnet", "testnet", "mainnet"]),
    backingKind: z.enum([
      "TESTNET_DEMO_ALLOWLIST",
      "ZKLOGIN_BACKED",
      "WALLET_STAKED",
    ]),
    humanBackingHash: hexStringSchema,
    humanVerificationProvider: z.string(),
    operationalOwner: hexStringSchema,
    role: z.string(),
    modelId: z.string(),
    providerId: z.literal("gonkarouter"),
    promptSpec: promptSpecV2Schema,
    promptHash: hexStringSchema,
    toolPolicy: toolPolicyV2Schema,
    toolPolicyHash: hexStringSchema,
    evidencePolicyId: z.string(),
    evidencePolicyHash: hexStringSchema,
  })
  .strict() satisfies z.ZodType<AgentManifestDocumentV3>;

const agentManifestDocumentV4Schema = agentManifestDocumentV3Schema
  .extend({
    version: z.literal("4"),
    promptSpec: promptSpecV3Schema,
    toolPolicy: toolPolicyV3Schema,
  })
  .strict() satisfies z.ZodType<AgentManifestDocumentV4>;

const agentManifestDocumentV5Schema = agentManifestDocumentV4Schema
  .extend({
    version: z.literal("5"),
    promptSpec: promptSpecV4Schema,
    toolPolicy: toolPolicyV4Schema,
  })
  .strict() satisfies z.ZodType<AgentManifestDocumentV5>;

/** V6 binds the table-vote prompt beside the unchanged v5 fields. */
const agentManifestDocumentV6Schema = agentManifestDocumentV5Schema
  .extend({
    version: z.literal("6"),
    tableVotePromptSpec: tableVotePromptSpecV1Schema,
    tableVotePromptHash: hexStringSchema,
  })
  .strict() satisfies z.ZodType<AgentManifestDocumentV6>;

const agentManifestDocumentSchema = z.discriminatedUnion("version", [
  agentManifestDocumentV2Schema,
  agentManifestDocumentV3Schema,
  agentManifestDocumentV4Schema,
  agentManifestDocumentV5Schema,
  agentManifestDocumentV6Schema,
]);

export type BuildAgentManifestDocumentParams = {
  network: AgentManifestDocumentV2["network"];
  backingKind: AgentBackingKind;
  humanBackingHash: HexString;
  humanVerificationProvider: string;
  operationalOwner: HexString;
  role: string;
  modelId: string;
  promptSpec: PromptSpec;
  toolPolicy?: ToolPolicyV2 | ToolPolicyV3 | ToolPolicyV4;
  tableVotePromptSpec?: TableVotePromptSpecV1;
  evidencePolicyId: string;
};

export type BuiltAgentManifestDocument = {
  document: AgentManifestDocument;
  bytes: Uint8Array;
  manifestHash: HexString;
  promptHash: HexString;
  toolPolicyHash: HexString;
  tableVotePromptHash?: HexString;
};

export function buildAgentManifestDocument(
  params: BuildAgentManifestDocumentParams,
): BuiltAgentManifestDocument {
  const promptHash = promptSpecHash(params.promptSpec);
  const evidencePolicyHash = toHex(
    blake2b256(utf8.encode(params.evidencePolicyId)),
  );
  let document: AgentManifestDocument;
  let policyHash: HexString;
  let tableVotePromptHash: HexString | undefined;

  if (params.promptSpec.version === "4") {
    if (params.toolPolicy?.version !== "4") {
      throw new Error("a v4 prompt spec requires a v4 tool policy");
    }
    policyHash = toolPolicyHash(params.toolPolicy);
    const v5Document: AgentManifestDocumentV5 = {
      version: "5",
      network: params.network,
      backingKind: params.backingKind,
      humanBackingHash: params.humanBackingHash,
      humanVerificationProvider: params.humanVerificationProvider,
      operationalOwner: params.operationalOwner,
      role: params.role,
      modelId: params.modelId,
      providerId: "gonkarouter",
      promptSpec: params.promptSpec,
      promptHash,
      toolPolicy: params.toolPolicy,
      toolPolicyHash: policyHash,
      evidencePolicyId: params.evidencePolicyId,
      evidencePolicyHash,
    };
    if (params.tableVotePromptSpec) {
      tableVotePromptHash = promptSpecHash(params.tableVotePromptSpec);
      document = {
        ...v5Document,
        version: "6",
        tableVotePromptSpec: params.tableVotePromptSpec,
        tableVotePromptHash,
      };
    } else {
      document = v5Document;
    }
  } else if (params.promptSpec.version === "3") {
    if (params.toolPolicy?.version !== "3") {
      throw new Error("a v3 prompt spec requires a v3 tool policy");
    }
    policyHash = toolPolicyHash(params.toolPolicy);
    document = {
      version: "4",
      network: params.network,
      backingKind: params.backingKind,
      humanBackingHash: params.humanBackingHash,
      humanVerificationProvider: params.humanVerificationProvider,
      operationalOwner: params.operationalOwner,
      role: params.role,
      modelId: params.modelId,
      providerId: "gonkarouter",
      promptSpec: params.promptSpec,
      promptHash,
      toolPolicy: params.toolPolicy,
      toolPolicyHash: policyHash,
      evidencePolicyId: params.evidencePolicyId,
      evidencePolicyHash,
    };
  } else if (params.promptSpec.version === "2") {
    if (params.toolPolicy?.version !== "2") {
      throw new Error("a v2 prompt spec requires a tool policy");
    }
    policyHash = toolPolicyHash(params.toolPolicy);
    document = {
      version: "3",
      network: params.network,
      backingKind: params.backingKind,
      humanBackingHash: params.humanBackingHash,
      humanVerificationProvider: params.humanVerificationProvider,
      operationalOwner: params.operationalOwner,
      role: params.role,
      modelId: params.modelId,
      providerId: "gonkarouter",
      promptSpec: params.promptSpec,
      promptHash,
      toolPolicy: params.toolPolicy,
      toolPolicyHash: policyHash,
      evidencePolicyId: params.evidencePolicyId,
      evidencePolicyHash,
    };
  } else {
    const toolPolicy: AgentManifestDocumentV2["toolPolicy"] = {
      version: "1",
      tools: [],
    };
    policyHash = toolPolicyHash(toolPolicy);
    document = {
      version: "2",
      network: params.network,
      backingKind: params.backingKind,
      humanBackingHash: params.humanBackingHash,
      humanVerificationProvider: params.humanVerificationProvider,
      operationalOwner: params.operationalOwner,
      role: params.role,
      modelId: params.modelId,
      providerId: "gonkarouter",
      promptSpec: params.promptSpec,
      promptHash,
      toolPolicy,
      toolPolicyHash: policyHash,
      evidencePolicyId: params.evidencePolicyId,
      evidencePolicyHash,
    };
  }
  const bytes = canonicalJsonBytes(document);
  return {
    document,
    bytes,
    manifestHash: toHex(blake2b256(bytes)),
    promptHash,
    toolPolicyHash: policyHash,
    ...(tableVotePromptHash === undefined ? {} : { tableVotePromptHash }),
  };
}

export function parseAgentManifestDocument(
  bytes: Uint8Array,
): AgentManifestDocument {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  return agentManifestDocumentSchema.parse(value);
}

import type { ClaimMode, VoteOutcome } from "./constants";
import type { GonkaAttemptRecord } from "../gonka/types";

export type HexString = `0x${string}`;
export type U64Input = number | bigint | string;

/** Exact Move commitment preimage. Field names mirror the Move struct. */
export type VotePreimageV1 = {
  claim_id: string;
  agent_profile_id: string;
  jury_seat_id: string;
  phase: 1 | 2;
  outcome: VoteOutcome;
  confidence_bps: number;
  evidence_root: Uint8Array;
  output_hash: Uint8Array;
  run_hash: Uint8Array;
  salt: Uint8Array;
};

/** Canonical off-chain run record committed by computeRunHash. */
export type RunRecordV1 = {
  run_id: string;
  claim_object_id: string;
  agent_profile_id: string;
  jury_seat_id: string;
  phase: 1 | 2;
  attempt: number;
  provider_id: "gonkarouter";
  model_id: string;
  gonka_request_id: string;
  prompt_hash: Uint8Array;
  input_hash: Uint8Array;
  output_hash: Uint8Array;
  tool_transcript_hash: Uint8Array;
  evidence_root: Uint8Array;
  requested_at_ms: U64Input;
  completed_at_ms: U64Input;
};

/** Claim fingerprint fields, ordered to match PRD section 16.3. */
export type ClaimIntentV1 = {
  chain_identifier: string;
  package_id: string;
  registry_object_id: string;
  creator: string;
  creator_nonce: U64Input;
  statement_hash: Uint8Array;
  criteria_hash: Uint8Array;
  evidence_policy_id: Uint8Array;
  claim_mode: ClaimMode;
  proposal_deadline_ms: U64Input;
  challenge_deadline_ms: U64Input;
  first_commit_deadline_ms: U64Input;
  first_reveal_deadline_ms: U64Input;
  discussion_deadline_ms: U64Input;
  second_commit_deadline_ms: U64Input;
  second_reveal_deadline_ms: U64Input;
  outcome_set: VoteOutcome[];
};

/** Public, versioned agent identity and policy manifest. */
export type AgentManifest = {
  agentProfileId: HexString;
  owner: HexString;
  humanAttestationHash: HexString;
  humanVerificationProvider: string;
  version: string;
  manifestBlobId: string;
  manifestHash: HexString;
  codeCommit?: string;
  containerDigest?: string;
  promptHash: HexString;
  modelId: string;
  modelRevision?: string;
  providerId: "gonkarouter";
  toolPolicyHash: HexString;
  evidencePolicyHash: HexString;
  publicKey: string;
  registeredAtMs: number;
  registeredCheckpoint: number;
};

export type InferenceRunStatus =
  | "RECEIVED"
  | "SCHEMA_VALID"
  | "INVALID_SCHEMA"
  | "CITATION_INVALID"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

/** Public metadata needed to audit one visible provider attempt. */
export type InferenceRunAudit = {
  runId: HexString;
  claimObjectId: HexString;
  agentProfileId: HexString;
  jurySeatId: HexString;
  phase: 1 | 2;
  attempt: number;
  providerId: "gonkarouter";
  modelId: string;
  responseModelId?: string;
  gonkaRequestId: string;
  promptHash: HexString;
  inputHash: HexString;
  outputHash: HexString;
  runWalrusBlobId: string;
  toolTranscriptHash: HexString;
  toolTranscriptWalrusBlobId: string;
  toolCallCount: number;
  evidenceRoot: HexString;
  requestedAtMs: number;
  completedAtMs: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  gatewayRequestId?: string;
  devshardId?: string;
  systemFingerprint?: string;
  gatewayFallback?: string;
  status: InferenceRunStatus;
};

export type OracleInferenceInput = {
  protocolVersion: "1.0";
  runId: string;
  agentRole: string;
  promptVersion: "1" | "2" | "3" | "4";
  submission: {
    kind: "TEXT" | "URL" | "TEXT_AND_URL";
    submittedTextHash?: string;
    submittedUrls: string[];
  };
  claim: {
    statement: string;
    resolutionCriteria: string;
    outcomes: ["YES", "NO", "UNSURE"];
    relevantDeadline: string;
  };
  evidenceManifest: {
    root: string;
    items: Array<{
      evidenceId: string;
      sourceClass: string;
      retrievedAt: string;
      walrusBlobId: string;
      contentHash: string;
      excerpt: string;
    }>;
  };
  outputContract: {
    requiredOutcome: true;
    requiredEvidenceIds: true;
    maximumReasonLength: number;
  };
};

export type OracleInferenceOutput = {
  outcome: "YES" | "NO" | "UNSURE";
  confidenceBps: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  unsupportedClaims: string[];
  decisiveEvidence: string[];
  reasoning: string;
  publicReasoningTrace: Array<{
    check: string;
    evidenceIds: string[];
    assessment: "SUPPORTS" | "CONTRADICTS" | "MIXED" | "INSUFFICIENT";
    finding: string;
  }>;
  citations?: Citation[];
  counterEvidenceSummary?: string;
};

export type PromptSpecV1 = {
  version: "1";
  providerId: "gonkarouter";
  systemPrompt: string;
  jsonFallbackSuffix: string;
  repairSystemPrompt: string;
  temperature: 0;
  maxOutputTokens: 4096;
  responseFormat: "json_object";
};

export type AgentBackingKind = "TESTNET_DEMO_ALLOWLIST" | "ZKLOGIN_BACKED";

export type AgentManifestDocumentV2 = {
  version: "2";
  network: "localnet" | "testnet" | "mainnet";
  backingKind: AgentBackingKind;
  humanBackingHash: HexString;
  humanVerificationProvider: string;
  operationalOwner: HexString;
  role: string;
  modelId: string;
  providerId: "gonkarouter";
  promptSpec: PromptSpecV1;
  promptHash: HexString;
  toolPolicy: { version: "1"; tools: [] };
  toolPolicyHash: HexString;
  evidencePolicyId: string;
  evidencePolicyHash: HexString;
};

export type GatewayResponseMeta = {
  gatewayRequestId?: string;
  devshardId?: string;
  systemFingerprint?: string;
  /** X-Gonka-Fallback response header, recorded if the gateway ever
   *  substitutes a model despite X-Gonka-No-Fallback (should not happen). */
  gatewayFallback?: string;
};

export type ProviderRequestRecord = {
  model: string;
  temperature: 0;
  maxTokens: number;
  responseFormat: "json_object" | "none";
  attemptKind: "PRIMARY" | "RETRY" | "HEDGE" | "JSON_PROMPT_FALLBACK" | "REPAIR";
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
};

export type PublicRunBundleCoreV2 = {
  version: 2;
  kind: "run-bundle";
  runId: HexString;
  claimId: HexString;
  phase: 1 | 2;
  agentProfileId: HexString;
  jurySeatId: HexString;
  promptSpec: PromptSpecV1;
  promptHash: HexString;
  input: OracleInferenceInput;
  inputHash: HexString;
  request: ProviderRequestRecord;
  attempts: unknown[];
  rawResponse: unknown;
  gateway: GatewayResponseMeta;
  validatedOutput: OracleInferenceOutput;
  outputHash: HexString;
  audit: InferenceRunAudit;
  runHash: HexString;
  verify: {
    promptHash: "blake2b256(canonicalJson(promptSpec))";
    inputHash: "blake2b256(canonicalJson(input))";
    outputHash: "blake2b256(canonicalJson(validatedOutput))";
    runHash: "blake2b256(BCS(RunRecordV1))";
    commitment: "blake2b256(BCS(VotePreimageV1))";
  };
};

export type RunBundleSeal = {
  algorithm: "AES-256-GCM";
  keyHex: HexString;
  ivHex: HexString;
  aad: string;
  sealedBlobId: string;
  coreHash: HexString;
};

export type PublicRunBundleV2 = PublicRunBundleCoreV2 & { seal: RunBundleSeal };

export type SealEscrowV1 = {
  version: 1;
  provider: "seal";
  packageId: HexString;
  identityHex: HexString;
  deadlineMs: number;
  threshold: number;
  keyServers: Array<{
    objectId: HexString;
    weight: number;
    aggregatorUrl?: string;
  }>;
  encryptedObjectBase64: string;
  aad: string;
};

export type SealedRunBundleV2 = {
  version: 2;
  kind: "sealed-run-bundle";
  runId: HexString;
  algorithm: "AES-256-GCM";
  ivHex: HexString;
  aad: string;
  coreHash: HexString;
  ciphertextBase64: string;
  /** Unhashed insurance in the cited blob; core hashes and commitments stay unchanged. */
  escrow?: SealEscrowV1;
};

/** A page quote a juror cites; evidenceId must be a page opened in the same run. */
export type Citation = { evidenceId: string; url: string; quote: string };

export type PromptSpecV2 = {
  version: "2";
  providerId: "gonkarouter";
  systemPrompt: string;
  jsonFallbackSuffix: string;
  repairSystemPrompt: string;
  temperature: 0;
  maxOutputTokens: 4096;
  responseFormat: "json_object";
};
export type PromptSpecV3 = Omit<PromptSpecV2, "version"> & { version: "3" };
export type PromptSpecV4 = Omit<PromptSpecV3, "version"> & { version: "4" };
export type PromptSpec =
  | PromptSpecV1
  | PromptSpecV2
  | PromptSpecV3
  | PromptSpecV4;

export type ToolPolicyV1 = { version: "1"; tools: [] };
/** Research budgets; every value is hashed into the manifest's toolPolicyHash. */
export type ToolPolicyV2 = {
  version: "2";
  tools: ["search", "open"];
  provider: "firecrawl";
  maxSearches: number;
  maxOpens: number;
  maxTurns: number;
  resultsPerSearch: number;
  snippetChars: number;
  pageSliceChars: number;
  maxPageChars: number;
  maxLoopMs: number;
};
export type ToolPolicyV3 = Omit<ToolPolicyV2, "version"> & {
  version: "3";
  requireChallengeSearch: true;
  minCitationDomains: number;
  minOpensPerSide: number;
};
export type ToolPolicyV4 = Omit<ToolPolicyV3, "version"> & {
  version: "4";
  maxOpensPerTurn: number;
};
export type ToolPolicy =
  | ToolPolicyV1
  | ToolPolicyV2
  | ToolPolicyV3
  | ToolPolicyV4;

export type AgentManifestDocumentV3 = Omit<
  AgentManifestDocumentV2,
  "version" | "promptSpec" | "toolPolicy"
> & { version: "3"; promptSpec: PromptSpecV2; toolPolicy: ToolPolicyV2 };
export type AgentManifestDocumentV4 = Omit<
  AgentManifestDocumentV3,
  "version" | "promptSpec" | "toolPolicy"
> & { version: "4"; promptSpec: PromptSpecV3; toolPolicy: ToolPolicyV3 };
export type AgentManifestDocumentV5 = Omit<
  AgentManifestDocumentV4,
  "version" | "promptSpec" | "toolPolicy"
> & { version: "5"; promptSpec: PromptSpecV4; toolPolicy: ToolPolicyV4 };
export type AgentManifestDocument =
  | AgentManifestDocumentV2
  | AgentManifestDocumentV3
  | AgentManifestDocumentV4
  | AgentManifestDocumentV5;

export type ResearchSearchResult = {
  rank: number;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
};

export type ResearchPageOrigin = "SEARCH" | "SUBMITTED";

export type ResearchOpenedPage = {
  evidenceId: string;
  ref: string;
  url: string;
  finalUrl: string;
  origin: ResearchPageOrigin;
  title?: string;
  contentHash: HexString;
  canonicalHash: HexString;
  canonicalWalrusBlobId: string;
  totalChars: number;
  truncated: boolean;
  sides?: Array<"support" | "challenge">;
};

export type ResearchAction =
  | {
      action: "search";
      query: string;
      intent?: "support" | "challenge";
    }
  | { action: "open"; url: string; urls?: never; from?: number }
  | { action: "open"; url?: never; urls: string[]; from?: number }
  | { action: "answer"; output: OracleInferenceOutput };

export type ResearchToolErrorCode =
  | "BUDGET_SEARCHES"
  | "BUDGET_OPENS"
  | "BUDGET_TURNS"
  | "URL_NOT_SEEN"
  | "OPEN_FAILED"
  | "SEARCH_FAILED"
  | "INVALID_ACTION"
  | "INVALID_ANSWER"
  /** A YES or NO answered before any page found by the model's own search was opened. */
  | "RESEARCH_REQUIRED"
  | "CHALLENGE_REQUIRED"
  | "CORROBORATION_REQUIRED";

export type ResearchOpenToolPage = {
  url: string;
  evidenceId: string;
  ref: string;
  from: number;
  chars: number;
  totalChars: number;
  truncated: boolean;
  text: string;
};

export type ResearchOpenToolPageError = {
  url: string;
  error: ResearchToolErrorCode;
};

export type ResearchToolResult =
  | {
      tool: "search";
      query: string;
      results: Array<{
        n: number;
        title: string;
        url: string;
        snippet: string;
        publishedAt?: string;
      }>;
    }
  | ({ tool: "open" } & ResearchOpenToolPage)
  | {
      tool: "open_many";
      pages: Array<ResearchOpenToolPage | ResearchOpenToolPageError>;
    }
  | {
      tool: "error";
      code: ResearchToolErrorCode;
      message: string;
      errors?: string[];
    };

export type ResearchTranscriptStep = {
  index: number;
  turn: number;
  startedAtMs: number;
  completedAtMs: number;
  modelRequestId: string;
  batch?: { size: number; position: number };
  action: ResearchAction | { action: "invalid"; content: string };
  result:
    | {
        tool: "search";
        cached: boolean;
        resultsHash: HexString;
        results: ResearchSearchResult[];
      }
    | {
        tool: "open";
        cached: boolean;
        evidenceId: string;
        origin: ResearchPageOrigin;
        from: number;
        chars: number;
        totalChars: number;
        contentHash: HexString;
        canonicalWalrusBlobId: string;
      }
    | { tool: "error"; code: ResearchToolErrorCode; message: string }
    | { tool: "answer"; valid: boolean; errors: string[] };
};

export type ResearchTranscriptV1 = {
  version: 1;
  runId: HexString;
  provider: { name: string; mode: string };
  policyHash: HexString;
  steps: ResearchTranscriptStep[];
  opened: ResearchOpenedPage[];
  citations: Array<Citation & { found: boolean }>;
  counts: {
    searches: number;
    opens: number;
    turns: number;
    challengeSearches?: number;
  };
};

/** Public audit material captured before a juror seat failed. */
export type InferenceFailureV1 = {
  version: 1;
  status: InferenceRunAudit["status"];
  message: string;
  failedAtMs: number;
  transcript: ResearchTranscriptV1 | null;
  attempts: GonkaAttemptRecord[];
  walrusBlobId?: string;
};

export type PublicRunBundleCoreV3 = Omit<
  PublicRunBundleCoreV2,
  "version" | "promptSpec" | "verify"
> & {
  version: 3;
  promptSpec: PromptSpecV2;
  toolPolicy: ToolPolicyV2;
  toolPolicyHash: HexString;
  transcript: ResearchTranscriptV1;
  verify: PublicRunBundleCoreV2["verify"] & {
    toolPolicyHash: "blake2b256(canonicalJson(toolPolicy))";
    toolTranscriptHash: "blake2b256(canonicalJson(transcript))";
    systemPrompt: "promptSpec.systemPrompt + '\\n' + canonicalJson({budgets: toolPolicy})";
  };
};
export type PublicRunBundleV3 = PublicRunBundleCoreV3 & {
  seal: RunBundleSeal;
};
export type PublicRunBundleCoreV4 = Omit<
  PublicRunBundleCoreV3,
  "version" | "promptSpec" | "toolPolicy"
> & {
  version: 4;
  promptSpec: PromptSpecV3;
  toolPolicy: ToolPolicyV3;
};
export type PublicRunBundleV4 = PublicRunBundleCoreV4 & {
  seal: RunBundleSeal;
};
export type PublicRunBundleCoreV5 = Omit<
  PublicRunBundleCoreV4,
  "version" | "promptSpec" | "toolPolicy"
> & {
  version: 5;
  promptSpec: PromptSpecV4;
  toolPolicy: ToolPolicyV4;
};
export type PublicRunBundleV5 = PublicRunBundleCoreV5 & {
  seal: RunBundleSeal;
};
export type PublicRunBundleCore =
  | PublicRunBundleCoreV2
  | PublicRunBundleCoreV3
  | PublicRunBundleCoreV4
  | PublicRunBundleCoreV5;
export type PublicRunBundle =
  | PublicRunBundleV2
  | PublicRunBundleV3
  | PublicRunBundleV4
  | PublicRunBundleV5;

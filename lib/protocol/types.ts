import type { ClaimMode, VoteOutcome } from "./constants";

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
  status: InferenceRunStatus;
};

export type OracleInferenceInput = {
  protocolVersion: "1.0";
  runId: string;
  agentRole: string;
  promptVersion: string;
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
};

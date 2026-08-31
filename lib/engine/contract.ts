import type {
  AgentManifestDocument,
  GatewayResponseMeta,
  HexString,
  InferenceFailureV1,
  InferenceRunAudit,
  OracleInferenceOutput,
  PublicRunBundle,
  SealEscrowV1,
  SealedRunBundleV2,
} from "../protocol/types";
import type { ClaimMode, ClaimState, VoteOutcome } from "../protocol/constants";

/**
 * Orchestrator-owned seam between the engine (workers/CLI/API) and every
 * consumer. lib/engine implements it; app/api and the CLI depend only on the
 * types in this file plus `getServerEngine()` from lib/engine/server.
 * All DTOs are JSON-serializable: ids/hashes as 0x-hex or base64url strings.
 */

// ---------------------------------------------------------------------------
// Resolution events (PRD §29.12)
// ---------------------------------------------------------------------------

export type ResolutionEventSource =
  | "ENGINE"
  | "GONKA_ROUTER"
  | "TOOL"
  | "EVIDENCE"
  | "SUI";

export type ResolutionEventVisibility =
  | "PUBLIC_NOW"
  | "PUBLIC_AFTER_REVEAL"
  | "INTERNAL_REDACTED";

export type ResolutionEvent = {
  eventId: string;
  claimId: string;
  sequence: number;
  phase: string;
  kind: string;
  source: ResolutionEventSource;
  visibility: ResolutionEventVisibility;
  actorId?: string;
  runId?: string;
  occurredAt: string;
  publishedAt?: string;
  transactionDigest?: string;
  checkpoint?: number;
  artifactHash?: `0x${string}`;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type FactCheckRequest = {
  /** Bounded claim statement. */
  claim: string;
  /** Optional pasted explanatory text (stored as evidence). */
  text?: string;
  /** Zero or more public https URLs submitted as evidence. */
  urls: string[];
  /** Resolution criteria; a deterministic default is derived when omitted. */
  resolutionCriteria?: string;
  /** Optional explicit deadlines (canary/operator use); network defaults otherwise. */
  deadlines?: ClaimCreateRequest["deadlines"];
};

export type ClaimCreateRequest = {
  statement: string;
  resolutionCriteria: string;
  mode: ClaimMode;
  /** Millisecond epoch deadlines, strictly increasing per PRD §16.1. */
  deadlines: {
    evidenceCutoffMs: number;
    proposalDeadlineMs: number;
    challengeDeadlineMs: number;
    firstCommitDeadlineMs: number;
    firstRevealDeadlineMs: number;
    discussionDeadlineMs: number;
    secondCommitDeadlineMs: number;
    secondRevealDeadlineMs: number;
  };
  /** Budget amounts in the settlement coin's smallest unit, as decimal strings. */
  committeeBudget: string;
  evidenceBudget: string;
};

export type ChallengeReason = {
  reason: string;
  evidenceUrls: string[];
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TxResult = {
  digest: string;
  checkpoint?: number;
  /** Object ids created or mutated that consumers may need to follow. */
  objectIds?: Record<string, string>;
};

export type AgentRunSummary = {
  runId: string;
  agentProfileId: string;
  modelId: string;
  gonkaRequestId: string;
  status: InferenceRunAudit["status"];
  attempt: number;
  latencyMs: number;
  /** Present only after a valid reveal or for engine-internal callers. */
  output?: OracleInferenceOutput;
};

export type JuryRunReport = {
  claimId: string;
  phase: 1 | 2;
  runs: AgentRunSummary[];
};

export type RunProof = {
  runId: string;
  claimId: string;
  phase: 1 | 2;
  agentProfileId: string;
  jurySeatId: string;
  promptHash: HexString;
  inputHash: HexString;
  outputHash: HexString;
  runHash: HexString;
  gateway: GatewayResponseMeta;
  sealedBlobId: string | null;
  sealed: SealedRunBundleV2 | null;
  revealedBlobId: string | null;
  revealed: boolean;
  bundle: PublicRunBundle | null;
  failure?: InferenceFailureV1;
  claimDeadlines?: {
    firstRevealDeadlineMs: number;
    secondRevealDeadlineMs: number;
  };
  sealPolicy?: {
    packageId: HexString;
    threshold: number;
    keyServers: SealEscrowV1["keyServers"];
  };
};

export type FailedRunProof = Omit<
  RunProof,
  | "runHash"
  | "sealedBlobId"
  | "sealed"
  | "revealedBlobId"
  | "revealed"
  | "bundle"
  | "failure"
> & {
  runHash: null;
  sealedBlobId: null;
  sealed: null;
  revealedBlobId: null;
  revealed: false;
  bundle: null;
  failure: InferenceFailureV1;
};

export type RunProofResult = RunProof | FailedRunProof;

export type FinalizeReport = {
  claimId: string;
  result: "YES" | "NO" | "UNSURE" | "UNRESOLVED";
  truthScoreBps: number | null;
  certificateId: string;
  digest: string;
};

export type CommitmentStatus = {
  jurySeatId: string;
  agentProfileId: string;
  /** The seat's model, from the agent's registered manifest; resolves juror
      identity even for seats that failed before any inference completed. */
  modelId?: string;
  committed: boolean;
  revealed: boolean;
  outcome?: VoteOutcome;
  confidenceBps?: number;
  /** Set when the seat failed before committing (status of its failure record). */
  failureStatus?: string;
};

export type ClaimInspection = {
  claimId: string;
  mode: ClaimMode;
  state: ClaimState;
  statement: string;
  resolutionCriteria: string;
  deadlines: ClaimCreateRequest["deadlines"];
  proposedOutcome?: "YES" | "NO" | "UNSURE";
  committeeId?: string;
  evidenceRoots: { phase: 1 | 2; root: `0x${string}`; bundleId: string }[];
  commitments: CommitmentStatus[];
  result?: FinalizeReport;
  /** Populated when inspect() is called with { verify: true }. */
  verification?: {
    commitmentsRecomputed: boolean;
    truthScoreRecomputed: boolean;
    evidenceRootsRecomputed: boolean;
    issues: string[];
  };
};

export type AgentCard = {
  agentProfileId: string;
  owner: string;
  modelId: string;
  role: string;
  outcome: "YES" | "NO" | "UNSURE";
  confidenceBps: number;
  gonkaRequestId: string;
  evidenceIds: string[];
  reasoning: string;
  publicReasoningTrace: OracleInferenceOutput["publicReasoningTrace"];
};

/** Public fact-check report per PRD §26.9, in display order. */
export type FactCheckReport = {
  claimId: string;
  statement: string;
  submittedUrls: string[];
  label: "YES" | "NO" | "UNSURE" | "UNRESOLVED" | "PENDING";
  truthScore: number | null;
  truthScoreFormula: string;
  finalRoundVotes: { outcome: "YES" | "NO" | "UNSURE"; confidenceBps: number }[];
  agents: AgentCard[];
  evidence: {
    evidenceId: string;
    sourceUrl: string;
    blobId: string;
    contentHash: `0x${string}`;
  }[];
  evidenceRoot?: `0x${string}`;
  sui: {
    claimObjectId: string;
    committeeId?: string;
    certificateId?: string;
    revealedVoteIds: string[];
  };
  /** Complete machine-readable audit bundle (identifiers + hashes). */
  auditBundle: Record<string, unknown>;
};

export type EngineStatus = {
  appVersion: string;
  network: string;
  packageId: string;
  registryObjectId: string;
  suiHealthy: boolean;
  latestCheckpoint?: number;
  gonkaMode: "fake" | "live";
  walrusMode: "local" | "testnet" | "mainnet";
  dbHealthy: boolean;
  paused: boolean;
};

export type AgentDirectoryEntry = {
  agentProfileId: string;
  owner: string;
  modelId: string;
  role: string;
  manifestHash: `0x${string}`;
  active: boolean;
  reputation: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Engine interface (plan contract C5)
// ---------------------------------------------------------------------------

/**
 * zkLogin-backed agent registration (plan T7b): the OWNER identity is a
 * zkLogin (social-login) address; under one OAuth aud with a fixed salt
 * service, one social account = one address = one backing hash, and the Move
 * rule "one committee seat per human_backing_hash" makes it one seat.
 * Authentication + Sybil-cost raise only. NEVER proof of personhood.
 */
export type ZkBackedRegistrationRequest = {
  /** The zkLogin address that owns/backs this agent. */
  zkLoginAddress: string;
  /** Base64 zkLogin signature over the canonical backing message. */
  signature: string;
  /** Model id from the release manifest catalog. */
  modelId: string;
  /** Role label, e.g. SKEPTIC / SOURCE_AUTHENTICITY. */
  role: string;
};

export type ZkBackedRegistrationResult = {
  agentProfileId: string;
  humanBackingHash: `0x${string}`;
  backingKind: "ZKLOGIN_BACKED";
  digest: string;
};

export interface Engine {
  factCheckStart(req: FactCheckRequest): Promise<{ claimId: string }>;
  /** Verify the zkLogin signature, derive the backing hash, register on-chain. */
  registerZkBackedAgent(
    req: ZkBackedRegistrationRequest,
  ): Promise<ZkBackedRegistrationResult>;
  claimCreate(req: ClaimCreateRequest): Promise<{ claimId: string; digest: string }>;
  propose(claimId: string, outcome: VoteOutcome): Promise<TxResult>;
  challenge(claimId: string, reason: ChallengeReason): Promise<TxResult>;
  selectCommittee(claimId: string): Promise<TxResult>;
  evidenceFreeze(claimId: string, phase: 1 | 2): Promise<TxResult>;
  juryRun(claimId: string, phase: 1 | 2): Promise<JuryRunReport>;
  votesCommit(claimId: string, phase: 1 | 2): Promise<TxResult[]>;
  votesReveal(claimId: string, phase: 1 | 2): Promise<TxResult[]>;
  advance(claimId: string): Promise<TxResult | null>;
  finalize(claimId: string): Promise<FinalizeReport>;
  inspect(claimId: string, opts?: { verify?: boolean }): Promise<ClaimInspection>;
  report(claimId: string): Promise<FactCheckReport>;
  listClaims(filter?: { state?: ClaimState }): Promise<ClaimInspection[]>;
  listAgents(): Promise<AgentDirectoryEntry[]>;
  runProof(claimId: string, runId: string): Promise<RunProofResult>;
  agentManifestDocument(
    agentProfileId: string,
  ): Promise<AgentManifestDocument | null>;
  status(): Promise<EngineStatus>;
  events(claimId: string, fromSequence?: number): AsyncIterable<ResolutionEvent>;
}

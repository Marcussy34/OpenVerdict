import type {
  ClaimCreateRequest,
  DeliberationTurnPublic,
  ResolutionEvent,
} from "../engine/contract";
import type {
  AgentManifest,
  InferenceFailureV1,
  InferenceRunAudit,
  OracleInferenceOutput,
} from "../protocol/types";
import type { EvidenceSourceClass } from "../evidence/types";
import type { ClaimMode, ClaimState, VoteOutcome } from "../protocol/constants";

export type Network = "localnet" | "testnet" | "mainnet";

export interface ClaimRecord {
  claimId: string;
  network: Network;
  packageId: string;
  registryObjectId: string;
  objectVersion?: string;
  objectDigest?: string;
  transactionDigest?: string;
  checkpoint?: number;
  packageVersion?: number;
  coinType: string;
  mode: ClaimMode;
  state: ClaimState;
  creator?: string;
  statement: string;
  resolutionCriteria: string;
  deadlines: ClaimCreateRequest["deadlines"];
  committeeBudget: string;
  evidenceBudget: string;
  submittedText?: string;
  submittedUrls: string[];
  statementBlobId?: string;
  criteriaBlobId?: string;
  evidencePolicyId: `0x${string}`;
  proposedOutcome?: VoteOutcome;
  committeeId?: string;
  certificateId?: string;
  result?: "YES" | "NO" | "UNSURE" | "UNRESOLVED";
  truthScoreBps?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitteeRecord {
  committeeId: string;
  claimId: string;
  phase: 1 | 2;
  roundTallyId: string;
  agentProfileIds: string[];
  jurySeatIds: string[];
  reserveAgentProfileIds: string[];
  randomnessTransactionDigest?: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export type JurySeatStatus =
  | "OFFERED"
  | "ACCEPTED"
  | "RUN_APPROVED"
  | "COMMITTED"
  | "REVEALED"
  | "NO_VALID_INFERENCE";

export interface JurySeatRecord {
  jurySeatId: string;
  claimId: string;
  committeeId: string;
  agentProfileId: string;
  agentOwner: string;
  agentCapId?: string;
  phase: 1 | 2;
  status: JurySeatStatus;
  evidenceRoot?: `0x${string}`;
  /** True once bind_jury_seat_evidence landed on chain (agent-signed; retried until it does). */
  evidenceBound?: boolean;
  commitment?: `0x${string}`;
  runHash?: `0x${string}`;
  createdAt: string;
  updatedAt: string;
}

export interface RoundTallyRecord {
  roundTallyId: string;
  claimId: string;
  committeeId: string;
  phase: 1 | 2;
  expectedJurySeatIds: string[];
  revealedJurySeatIds: string[];
  revealedVoteIds: string[];
  yesCount: number;
  noCount: number;
  unsureCount: number;
  truthProbabilitySumBps: number;
  truthProbabilityCount: number;
  evidenceRoot?: `0x${string}`;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceSubmissionRecord {
  submissionId: string;
  evidenceId: string;
  claimId: string;
  phase: 1 | 2;
  sourceUrl?: string;
  submittedText?: string;
  sourceClass: string;
  submittedBy?: string;
  retrievalStatus: "PENDING" | "ACCEPTED" | "REJECTED";
  rejectionCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceArtifactRecord {
  evidenceId: string;
  submissionId: string;
  claimId: string;
  phase: 1 | 2;
  sourceClass?: EvidenceSourceClass;
  discoveredByRunId?: string;
  sourceUrl: string;
  finalUrl: string;
  mimeType: string;
  byteLength: number;
  contentHash: `0x${string}`;
  canonicalHash: `0x${string}`;
  rawWalrusBlobId: string;
  rawWalrusObjectId?: string;
  canonicalWalrusBlobId: string;
  canonicalWalrusObjectId?: string;
  walrusEndEpoch?: number;
  parserVersion: string;
  title?: string;
  excerpt: string;
  retrievedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceManifestRecord {
  manifestId: string;
  claimId: string;
  phase: 1 | 2;
  evidenceBundleId?: string;
  root: `0x${string}`;
  manifestBlobId: string;
  manifestBlobObjectId?: string;
  sourceCount: number;
  policyId: `0x${string}`;
  walrusEndEpoch?: number;
  sortedLeaves: string[];
  transactionDigest?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InferenceRunRecord {
  runId: string;
  claimId: string;
  phase: 1 | 2;
  agentProfileId: string;
  jurySeatId: string;
  attempt: number;
  providerId: "gonkarouter";
  modelId: string;
  gonkaRequestId: string;
  promptHash: `0x${string}`;
  inputHash: `0x${string}`;
  outputHash: `0x${string}`;
  runHash?: `0x${string}`;
  runWalrusBlobId?: string;
  runWalrusObjectId?: string;
  sealKeyHex?: `0x${string}`;
  sealIvHex?: `0x${string}`;
  coreHash?: `0x${string}`;
  sealedBlobId?: string;
  sealedObjectId?: string;
  revealedBlobId?: string;
  revealedObjectId?: string;
  toolTranscriptHash: `0x${string}`;
  toolTranscriptWalrusBlobId?: string;
  toolTranscriptWalrusObjectId?: string;
  walrusEndEpoch?: number;
  evidenceRoot: `0x${string}`;
  validationStatus: InferenceRunAudit["status"] | "NO_VALID_INFERENCE";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  output?: OracleInferenceOutput;
  audit: InferenceRunAudit & { bundleCore?: string };
  failure?: InferenceFailureV1;
  requestedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunProofRecord {
  runId: string;
  claimId: string;
  phase: 1 | 2;
  proofJson: string;
  builtAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DeliberationTurnRecord = DeliberationTurnPublic & {
  turnId: string;
  gonkaRequestId?: string;
  promptSpecHash: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export type VerificationAttemptStatus = "ACTIVE" | "VOIDED" | "SETTLED" | "GAVE_UP";

export interface VerificationAttemptRecord {
  verificationId: string;
  claimId: string;
  attempt: 1 | 2 | 3;
  parentClaimId?: string;
  status: VerificationAttemptStatus;
  voidReason?: string;
  voidMessage?: string;
  voidedSeatId?: string;
  voidedModelId?: string;
  voidedPhase?: 1 | 2;
  voidedAt?: string;
  relaunchedAs?: string;
  gaveUpReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GonkaWeatherRecord {
  modelId: string;
  ok: boolean;
  latencyMs: number;
  status: string;
  probedAt: string;
}

export interface RunApprovalRecord {
  runApprovalId: string;
  runId: string;
  claimId: string;
  jurySeatId: string;
  agentProfileId: string;
  runHash: `0x${string}`;
  transactionDigest: string;
  attestor: string;
  validationErrors: string[];
  consumed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VotePackageRecord {
  votePackageId: string;
  claimId: string;
  phase: 1 | 2;
  jurySeatId: string;
  agentProfileId: string;
  runId: string;
  outcome: VoteOutcome;
  confidenceBps: number;
  evidenceRoot: `0x${string}`;
  outputHash: `0x${string}`;
  runHash: `0x${string}`;
  commitment: `0x${string}`;
  saltHex: `0x${string}`;
  commitmentTransactionDigest?: string;
  committed: boolean;
  revealed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevealRecord {
  revealedVoteId: string;
  votePackageId: string;
  claimId: string;
  phase: 1 | 2;
  roundTallyId: string;
  jurySeatId: string;
  agentProfileId: string;
  runId: string;
  outcome: VoteOutcome;
  confidenceBps: number;
  valid: boolean;
  transactionDigest: string;
  checkpoint?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolutionCertificateRecord {
  certificateId: string;
  claimId: string;
  result: "YES" | "NO" | "UNSURE" | "UNRESOLVED";
  truthScoreBps?: number;
  finalPhase: 1 | 2;
  finalRoundVoteIds: string[];
  transactionDigest: string;
  checkpoint?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentManifestRecord {
  manifest: AgentManifest;
  role: string;
  agentCapId?: string;
  active: boolean;
  reputation: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/** A stake reservation lives from prepare until the confirm reads the chain. */
export type StakeReservationStatus = "PENDING" | "CONFIRMED" | "EXPIRED";

/**
 * One reserved operational slot, held while a staker signs and executes the
 * stake transaction. PENDING reservations that have not expired keep their
 * slot out of the free pool so two stakers never share one signing key.
 */
export interface StakeReservationRecord {
  reservationId: string;
  stakerAddress: string;
  slotIndex: number;
  operationalOwner: string;
  modelId: string;
  role: string;
  manifestHash: string;
  manifestBlobId: string;
  documentVersion: string;
  promptHash: string;
  toolPolicyHash: string;
  tableVotePromptHash?: string;
  evidencePolicyHash: string;
  stakerHash: string;
  status: StakeReservationStatus;
  createdAt: string;
  expiresAt: string;
  /** Set once the stake transaction is confirmed. */
  digest?: string;
  agentProfileId?: string;
  /** Confirmed bond in MIST, and how the seat's gas float ended up. */
  stakeMist?: string;
  gasFloat?: "funded" | "skipped" | "failed";
}

export interface PayoutTicketRecord {
  payoutTicketId: string;
  claimId: string;
  recipient: string;
  amount: string;
  coinType: string;
  reason: number;
  consumed: boolean;
  createdTransactionDigest: string;
  consumedTransactionDigest?: string;
  createdAt: string;
  updatedAt: string;
}

export type ResolutionEventInsert = Omit<ResolutionEvent, "sequence"> & {
  sequence?: number;
  sourceCursor?: string;
};

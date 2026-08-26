import type { TxResult } from "../engine/contract";
import type { VoteOutcome } from "../protocol/constants";
import type {
  ApproveRunTransactionInput,
  ChallengeOutcomeTransactionInput,
  CommitVoteTransactionInput,
  CreateClaimTransactionInput,
  FreezeEvidenceTransactionInput,
  ProposeOutcomeTransactionInput,
  RegisterAgentTransactionInput,
  RevealVoteTransactionInput,
} from "./builders";

export interface SuiAgentIdentity {
  agentProfileId: string;
  owner: string;
  agentCapId?: string;
  modelId?: string;
  role?: string;
}

export interface ClaimCreationResult extends TxResult {
  claimId: string;
  creator?: string;
}

export interface CommitteeSeat {
  jurySeatId: string;
  agentProfileId: string;
  owner: string;
  agentCapId?: string;
}

export interface CommitteeSelectionResult extends TxResult {
  committeeId: string;
  roundTallyId: string;
  seats: CommitteeSeat[];
  reserveAgentProfileIds: string[];
}

export interface EvidenceFreezeResult extends TxResult {
  evidenceBundleId: string;
}

export interface RunApprovalResult extends TxResult {
  runApprovalId: string;
}

export interface RevealVoteResult extends TxResult {
  revealedVoteId: string;
}

export interface FinalizeChainResult extends TxResult {
  certificateId: string;
  payoutTicketIds: string[];
  payoutTickets: Array<{
    payoutTicketId: string;
    recipient: string;
    amount: string;
    reason: number;
  }>;
}

export interface SuiGatewayHealth {
  healthy: boolean;
  latestCheckpoint?: number;
  paused: boolean;
}

export interface GatewayCreateClaimInput extends CreateClaimTransactionInput {
  directReviewStarted?: boolean;
}

export interface GatewayAcceptSeatInput {
  jurySeatId: string;
  agentProfileId: string;
}

export interface GatewayBindEvidenceInput extends GatewayAcceptSeatInput {
  roundTallyId: string;
  evidenceBundleId: string;
}

export type GatewayApproveRunInput = Omit<
  ApproveRunTransactionInput,
  "runAttestorCapId"
>;

export interface GatewayCommitVoteInput
  extends Omit<CommitVoteTransactionInput, "agentCapId"> {
  agentProfileId: string;
}

export interface GatewayRevealVoteInput
  extends Omit<RevealVoteTransactionInput, "agentCapId"> {
  agentProfileId: string;
}

export interface SuiGateway {
  registerAgent(
    input: RegisterAgentTransactionInput & { agentIndex: number },
  ): Promise<SuiAgentIdentity & TxResult>;
  createClaim(input: GatewayCreateClaimInput): Promise<ClaimCreationResult>;
  startDirectReview(claimId: string): Promise<TxResult>;
  startChallengedReview(claimId: string): Promise<TxResult>;
  propose(input: ProposeOutcomeTransactionInput): Promise<TxResult>;
  challenge(input: ChallengeOutcomeTransactionInput): Promise<TxResult>;
  selectCommittee(claimId: string): Promise<CommitteeSelectionResult>;
  acceptJurySeat(input: GatewayAcceptSeatInput): Promise<TxResult>;
  freezeEvidence(
    input: Omit<FreezeEvidenceTransactionInput, "evidenceCapId">,
  ): Promise<EvidenceFreezeResult>;
  bindJurySeatEvidence(input: GatewayBindEvidenceInput): Promise<TxResult>;
  lockCommittee(input: {
    claimId: string;
    committeeId: string;
    roundTallyId: string;
  }): Promise<TxResult>;
  approveRun(input: GatewayApproveRunInput): Promise<RunApprovalResult>;
  commitVote(input: GatewayCommitVoteInput): Promise<TxResult>;
  revealVote(input: GatewayRevealVoteInput): Promise<RevealVoteResult>;
  advancePhase(claimId: string): Promise<TxResult>;
  openDiscussion(input: {
    claimId: string;
    firstRoundTallyId: string;
  }): Promise<TxResult>;
  createSecondRound(input: {
    claimId: string;
    committeeId: string;
    firstRoundTallyId: string;
  }): Promise<CommitteeSelectionResult>;
  finalize(input: {
    claimId: string;
    committeeId: string;
    roundTallyId: string;
    evidenceBundleId: string;
  }): Promise<FinalizeChainResult>;
  finalizeUnchallenged(claimId: string): Promise<FinalizeChainResult>;
  withdrawPayout(input: {
    claimId: string;
    payoutTicketId: string;
  }): Promise<TxResult>;
  health(): Promise<SuiGatewayHealth>;
}

export function outcomeLabel(outcome: VoteOutcome): "YES" | "NO" | "UNSURE" {
  if (outcome === 1) return "YES";
  if (outcome === 2) return "NO";
  return "UNSURE";
}

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
  UpdateAgentManifestTransactionInput,
} from "./builders";
import type { JuryDiversity } from "./jury-diversity";
import type { RegistryRosterSeat } from "./registry-roster";

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

/** Current Sui epoch and its duration (both from the system state object). */
export type ChainEpochInfo = { currentEpoch: number; epochDurationMs: number };

/**
 * What one confirmed `agent_registry::register_staked_agent` transaction says,
 * read back from its AgentStaked and AgentRegistered events plus the AgentCap
 * it created. `sender` is the staker: the account that posted the bond and
 * receives the seat's jury rewards.
 */
export interface StakeRegistrationRead {
  sender: string;
  agentProfileId: string;
  agentCapId: string;
  operationalOwner: string;
  /** Decimal-string MIST posted as the seat's bond. */
  amountMist: string;
  manifestHash: `0x${string}`;
  checkpoint?: number;
}

export interface GatewayFundAddressInput {
  address: string;
  /** Decimal MIST to transfer from the operator. */
  amountMist: string | number | bigint;
  /** Skip the transfer when the address already holds at least this much. */
  minBalanceMist?: string | number | bigint;
}

export interface GatewayFundAddressResult {
  funded: boolean;
  /** The address's SUI balance in MIST as it was read before funding. */
  balanceMist: string;
  digest?: string;
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
  updateAgentManifest(
    input: UpdateAgentManifestTransactionInput & { agentIndex: number },
  ): Promise<TxResult & { version?: number }>;
  /** Read one staked registration back from the chain; throws when not found. */
  readStakeRegistration(digest: string): Promise<StakeRegistrationRead>;
  /** Top a staked seat's signing key up from the operator's own gas. */
  fundAddress(input: GatewayFundAddressInput): Promise<GatewayFundAddressResult>;
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
  advancePhase(claimId: string, roundTallyId: string): Promise<TxResult>;
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
  /** Current Sui epoch and its length; retention epochs sent on chain are Sui epochs. */
  epochInfo(): Promise<ChainEpochInfo>;
  /** The registry's model-family rule the next draw will use. */
  juryDiversity(): Promise<JuryDiversity>;
  /**
   * Every eligibility record the current registry holds, which is the only
   * set of seats `select_committee` can draw from. The engine's own agent
   * mirror is wider: it keeps rows registered against earlier package
   * versions, and those registries are not this one.
   */
  registryRoster(): Promise<RegistryRosterSeat[]>;
  /** The rule one committee was drawn under, recorded on the committee itself. */
  committeeDiversity(committeeId: string): Promise<JuryDiversity>;
}

export function outcomeLabel(outcome: VoteOutcome): "YES" | "NO" | "UNSURE" {
  if (outcome === 1) return "YES";
  if (outcome === 2) return "NO";
  return "UNSURE";
}

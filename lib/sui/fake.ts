import { blake2b256, toHex } from "../protocol/hash";
import type { VoteOutcome } from "../protocol/constants";
import type {
  CommitteeSeat,
  CommitteeSelectionResult,
  EvidenceFreezeResult,
  FinalizeChainResult,
  GatewayAcceptSeatInput,
  GatewayApproveRunInput,
  GatewayBindEvidenceInput,
  GatewayCommitVoteInput,
  GatewayCreateClaimInput,
  GatewayFundAddressInput,
  GatewayFundAddressResult,
  GatewayRevealVoteInput,
  RevealVoteResult,
  RunApprovalResult,
  StakeRegistrationRead,
  SuiAgentIdentity,
  SuiGateway,
  SuiGatewayHealth,
  ChainEpochInfo,
} from "./gateway-types";
import type {
  ChallengeOutcomeTransactionInput,
  FreezeEvidenceTransactionInput,
  ProposeOutcomeTransactionInput,
  RegisterAgentTransactionInput,
  UpdateAgentManifestTransactionInput,
} from "./builders";
import type { TxResult } from "../engine/contract";

export interface FakeSuiAgent extends SuiAgentIdentity {
  agentCapId: string;
  modelId: string;
  role: string;
  manifestHash?: Uint8Array;
  manifestBlobId?: string;
  modelHash?: Uint8Array;
  roleHash?: Uint8Array;
  version?: number;
}

/** Deterministic chain seam for lifecycle unit tests. */
export class FakeSuiGateway implements SuiGateway {
  readonly agents: FakeSuiAgent[];
  #counter = 0;
  #claimCounter = 0;
  #phaseByClaim = new Map<string, 1 | 2>();
  #claimByTally = new Map<string, string>();
  #expectedSeatsByTally = new Map<string, Set<string>>();
  #committedSeatsByTally = new Map<string, Set<string>>();
  #revealedSeatsByTally = new Map<string, Set<string>>();

  constructor(agents: FakeSuiAgent[] = defaultFakeAgents()) {
    this.agents = agents;
  }

  async registerAgent(
    input: RegisterAgentTransactionInput & { agentIndex: number },
  ): Promise<SuiAgentIdentity & TxResult> {
    const agent = this.agents[input.agentIndex];
    if (!agent) throw new Error(`fake agent ${input.agentIndex} does not exist`);
    return { ...agent, ...this.tx("register_agent") };
  }

  async updateAgentManifest(
    input: UpdateAgentManifestTransactionInput & { agentIndex: number },
  ): Promise<TxResult & { version?: number }> {
    const agent = this.agents[input.agentIndex];
    if (!agent) throw new Error(`fake agent ${input.agentIndex} does not exist`);
    agent.manifestHash = input.manifestHash;
    agent.manifestBlobId = input.manifestBlobId;
    agent.modelHash = input.modelHash;
    agent.roleHash = input.roleHash;
    agent.version = (agent.version ?? 1) + 1;
    return { ...this.tx("update_agent_manifest"), version: agent.version };
  }

  /**
   * Scripted staked registrations, keyed by digest. Engine tests push what the
   * chain would have said before they call confirmStake.
   */
  readonly stakeRegistrations = new Map<string, StakeRegistrationRead>();
  /** Every fundAddress call, plus the balance each address reports. */
  readonly fundings: GatewayFundAddressInput[] = [];
  balancesMist = new Map<string, string>();
  /** Set to make the next fundAddress throw, the way a broken operator would. */
  fundAddressError: Error | undefined;

  async readStakeRegistration(digest: string): Promise<StakeRegistrationRead> {
    const registration = this.stakeRegistrations.get(digest);
    if (!registration) {
      throw new Error(`fake chain has no stake transaction ${digest}`);
    }
    return registration;
  }

  async fundAddress(
    input: GatewayFundAddressInput,
  ): Promise<GatewayFundAddressResult> {
    this.fundings.push(input);
    if (this.fundAddressError) throw this.fundAddressError;
    const balanceMist = this.balancesMist.get(input.address) ?? "0";
    if (
      input.minBalanceMist !== undefined &&
      BigInt(balanceMist) >= BigInt(input.minBalanceMist)
    ) {
      return { funded: false, balanceMist };
    }
    return { funded: true, balanceMist, ...this.tx("fund_address") };
  }

  async createClaim(input: GatewayCreateClaimInput) {
    this.#claimCounter += 1;
    const claimId = fakeId(`claim:${this.#claimCounter}`);
    this.#phaseByClaim.set(claimId, 1);
    const result = this.tx(input.directReviewStarted ? "start_fact_check" : "create_claim");
    return {
      ...result,
      claimId,
      creator: fakeId("operator"),
      objectIds: { claim: claimId },
    };
  }

  async startDirectReview(): Promise<TxResult> {
    return this.tx("start_direct_review");
  }

  async startChallengedReview(): Promise<TxResult> {
    return this.tx("start_challenged_review");
  }

  async propose(input: ProposeOutcomeTransactionInput): Promise<TxResult> {
    return this.tx(`propose_outcome:${input.claimId}`);
  }

  async challenge(input: ChallengeOutcomeTransactionInput): Promise<TxResult> {
    return this.tx(`challenge_outcome:${input.claimId}`);
  }

  async selectCommittee(claimId: string): Promise<CommitteeSelectionResult> {
    return this.selection(claimId, 1, "select_committee");
  }

  async acceptJurySeat(input: GatewayAcceptSeatInput): Promise<TxResult> {
    void input;
    return this.tx("accept_jury_seat");
  }

  async freezeEvidence(
    input: Omit<FreezeEvidenceTransactionInput, "evidenceCapId">,
  ): Promise<EvidenceFreezeResult> {
    const result = this.tx("freeze_evidence");
    const evidenceBundleId = fakeId(`bundle:${input.claimId}:${input.phase}`);
    return { ...result, evidenceBundleId, objectIds: { evidenceBundle: evidenceBundleId } };
  }

  async bindJurySeatEvidence(input: GatewayBindEvidenceInput): Promise<TxResult> {
    void input;
    return this.tx("bind_jury_seat_evidence");
  }

  async lockCommittee(): Promise<TxResult> {
    return this.tx("lock_committee");
  }

  async approveRun(input: GatewayApproveRunInput): Promise<RunApprovalResult> {
    const result = this.tx("approve_run");
    const runApprovalId = fakeId(`approval:${input.jurySeatId}:${input.phase}`);
    return { ...result, runApprovalId, objectIds: { runApproval: runApprovalId } };
  }

  async commitVote(input: GatewayCommitVoteInput): Promise<TxResult> {
    const expected = this.expectedSeats(input.roundTallyId);
    if (!expected.has(input.jurySeatId)) throw new Error("fake tally rejected an unexpected seat");
    const committed = this.#committedSeatsByTally.get(input.roundTallyId)!;
    if (committed.has(input.jurySeatId)) throw new Error("fake tally rejected a duplicate commit");
    committed.add(input.jurySeatId);
    return this.tx("commit_vote");
  }

  async revealVote(input: GatewayRevealVoteInput): Promise<RevealVoteResult> {
    const expected = this.expectedSeats(input.roundTallyId);
    if (!expected.has(input.jurySeatId)) throw new Error("fake tally rejected an unexpected seat");
    const committed = this.#committedSeatsByTally.get(input.roundTallyId)!;
    if (!committed.has(input.jurySeatId)) throw new Error("fake tally rejected an uncommitted seat");
    const revealed = this.#revealedSeatsByTally.get(input.roundTallyId)!;
    if (revealed.has(input.jurySeatId)) throw new Error("fake tally rejected a duplicate reveal");
    revealed.add(input.jurySeatId);
    const result = this.tx("reveal_vote");
    const revealedVoteId = fakeId(`reveal:${input.jurySeatId}`);
    return { ...result, revealedVoteId, objectIds: { revealedVote: revealedVoteId } };
  }

  async advancePhase(claimId: string, roundTallyId: string): Promise<TxResult> {
    if (this.#claimByTally.get(roundTallyId) !== claimId) {
      throw new Error("fake phase advance received the wrong tally");
    }
    return this.tx("advance_phase");
  }

  committedJurySeatIds(roundTallyId: string): string[] {
    return [...(this.#committedSeatsByTally.get(roundTallyId) ?? [])].sort();
  }

  revealedJurySeatIds(roundTallyId: string): string[] {
    return [...(this.#revealedSeatsByTally.get(roundTallyId) ?? [])].sort();
  }

  allSeatsCommitted(roundTallyId: string): boolean {
    const expected = this.expectedSeats(roundTallyId);
    return expected.size > 0 && this.committedJurySeatIds(roundTallyId).length === expected.size;
  }

  allSeatsRevealed(roundTallyId: string): boolean {
    const expected = this.expectedSeats(roundTallyId);
    return expected.size > 0 && this.revealedJurySeatIds(roundTallyId).length === expected.size;
  }

  async openDiscussion(): Promise<TxResult> {
    return this.tx("open_discussion");
  }

  async createSecondRound(input: {
    claimId: string;
    committeeId: string;
    firstRoundTallyId: string;
  }): Promise<CommitteeSelectionResult> {
    this.#phaseByClaim.set(input.claimId, 2);
    return this.selection(input.claimId, 2, "create_second_round_seats", input.committeeId);
  }

  async finalize(input: {
    claimId: string;
    committeeId: string;
    roundTallyId: string;
    evidenceBundleId: string;
  }): Promise<FinalizeChainResult> {
    const result = this.tx("finalize_claim");
    const certificateId = fakeId(`certificate:${input.claimId}`);
    return {
      ...result,
      certificateId,
      payoutTicketIds: [],
      payoutTickets: [],
      objectIds: { resolutionCertificate: certificateId },
    };
  }

  async finalizeUnchallenged(claimId: string): Promise<FinalizeChainResult> {
    const result = this.tx("finalize_unchallenged");
    const certificateId = fakeId(`certificate:${claimId}`);
    return {
      ...result,
      certificateId,
      payoutTicketIds: [],
      payoutTickets: [],
      objectIds: { resolutionCertificate: certificateId },
    };
  }

  async withdrawPayout(): Promise<TxResult> {
    return this.tx("withdraw_payout");
  }

  async health(): Promise<SuiGatewayHealth> {
    return { healthy: true, latestCheckpoint: this.#counter, paused: false };
  }

  /** Tests set this to model a chain whose epoch counter is far ahead of Walrus. */
  epoch: ChainEpochInfo = { currentEpoch: 900, epochDurationMs: 86_400_000 };

  async epochInfo(): Promise<ChainEpochInfo> {
    return { ...this.epoch };
  }

  private selection(
    claimId: string,
    phase: 1 | 2,
    label: string,
    existingCommitteeId?: string,
  ): CommitteeSelectionResult {
    if (this.agents.length < 5) throw new Error("fake committee requires five agents");
    const committeeId = existingCommitteeId ?? fakeId(`committee:${claimId}`);
    const roundTallyId = fakeId(`tally:${claimId}:${phase}`);
    const seats: CommitteeSeat[] = this.agents.slice(0, 5).map((agent, index) => ({
      jurySeatId: fakeId(`seat:${claimId}:${phase}:${index}`),
      agentProfileId: agent.agentProfileId,
      owner: agent.owner,
      agentCapId: agent.agentCapId,
    }));
    this.#claimByTally.set(roundTallyId, claimId);
    this.#expectedSeatsByTally.set(
      roundTallyId,
      new Set(seats.map((seat) => seat.jurySeatId)),
    );
    this.#committedSeatsByTally.set(roundTallyId, new Set());
    this.#revealedSeatsByTally.set(roundTallyId, new Set());
    const result = this.tx(label);
    return {
      ...result,
      committeeId,
      roundTallyId,
      seats,
      reserveAgentProfileIds: this.agents.slice(5).map((agent) => agent.agentProfileId),
      objectIds: { committee: committeeId, roundTally: roundTallyId },
    };
  }

  private tx(label: string): TxResult {
    this.#counter += 1;
    return { digest: `fake-${String(this.#counter).padStart(4, "0")}-${label}`, checkpoint: this.#counter };
  }

  private expectedSeats(roundTallyId: string): Set<string> {
    const expected = this.#expectedSeatsByTally.get(roundTallyId);
    if (!expected) throw new Error("fake tally does not exist");
    return expected;
  }
}

export function defaultFakeAgents(): FakeSuiAgent[] {
  const models = ["model-a", "model-b", "model-c", "model-a", "model-b"];
  const roles = ["SKEPTIC", "SOURCE_AUTHENTICITY", "ANALYST", "ANALYST", "SKEPTIC"];
  return models.map((modelId, index) => ({
    agentProfileId: fakeId(`agent-profile:${index}`),
    owner: fakeId(`agent-owner:${index}`),
    agentCapId: fakeId(`agent-cap:${index}`),
    modelId,
    role: roles[index] ?? "ANALYST",
  }));
}

export function fakeId(label: string): `0x${string}` {
  return toHex(blake2b256(new TextEncoder().encode(`fake-sui:${label}`)));
}

export function outcomeFromLabel(label: "YES" | "NO" | "UNSURE"): VoteOutcome {
  if (label === "YES") return 1;
  if (label === "NO") return 2;
  return 3;
}

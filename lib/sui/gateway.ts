import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { TxResult } from "../engine/contract";
import { toHex } from "../protocol/hash";
import {
  buildAcceptJurySeatTransaction,
  buildAdvancePhaseTransaction,
  buildApproveRunTransaction,
  buildBindJurySeatEvidenceTransaction,
  buildChallengeOutcomeTransaction,
  buildCommitVoteTransaction,
  buildCreateClaimTransaction,
  buildCreateSecondRoundSeatsTransaction,
  buildFinalizeClaimTransaction,
  buildFinalizeUnchallengedTransaction,
  buildFreezeEvidenceTransaction,
  buildLockCommitteeTransaction,
  buildOpenDiscussionTransaction,
  buildProposeOutcomeTransaction,
  buildRegisterAgentTransaction,
  buildRevealVoteTransaction,
  buildSelectCommitteeTransaction,
  buildStartDirectReviewTransaction,
  buildStartChallengedReviewTransaction,
  buildStartFactCheckTransaction,
  buildUpdateAgentManifestTransaction,
  buildWithdrawPayoutTransaction,
  type ChallengeOutcomeTransactionInput,
  type FreezeEvidenceTransactionInput,
  type ProposeOutcomeTransactionInput,
  type RegisterAgentTransactionInput,
  type UpdateAgentManifestTransactionInput,
} from "./builders";
import { executeAndWait, waitForGasIndex, type ExecutedMoveEvent } from "./execute";
import type {
  ClaimCreationResult,
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
import type { OpenVerdictSuiClient } from "./client";
import {
  readCommitteeDiversity,
  readJuryDiversity,
  type JuryDiversity,
} from "./jury-diversity";
import { runOnOperatorLane } from "./operator-lane";
import type { ReleaseManifest } from "./manifest";
import { SignerRegistry, SignerRegistryError } from "./signers";

export interface SuiGatewayConfig {
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  signers: SignerRegistry;
}

/** Epoch info changes about once a day; refetch at most once a minute. */
const EPOCH_CACHE_MS = 60_000;

/** Real Sui implementation of the narrow lifecycle seam used by the engine. */
export class RealSuiGateway implements SuiGateway {
  readonly #client: OpenVerdictSuiClient;
  readonly #manifest: ReleaseManifest;
  readonly #signers: SignerRegistry;
  #epochCache: { value: ChainEpochInfo; fetchedAtMs: number } | undefined;

  constructor(config: SuiGatewayConfig) {
    this.#client = config.client;
    this.#manifest = config.manifest;
    this.#signers = config.signers;
  }

  async registerAgent(
    input: RegisterAgentTransactionInput & { agentIndex: number },
  ): Promise<SuiAgentIdentity & TxResult> {
    const agent = this.#signers.getAgentAt(input.agentIndex);
    const result = await executeAndWait(
      this.#client,
      agent.keypair,
      () => buildRegisterAgentTransaction(this.#manifest, input),
    );
    const profileId = requiredObjectId(result, "agentProfile");
    const capId = requiredObjectId(result, "agentCap");
    this.#signers.bindAgentProfile({
      agentProfileId: profileId,
      agentCapId: capId,
      owner: agent.address,
    });
    return {
      digest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
      ...(result.objectIds === undefined ? {} : { objectIds: result.objectIds }),
      agentProfileId: profileId,
      owner: agent.address,
      agentCapId: capId,
    };
  }

  async updateAgentManifest(
    input: UpdateAgentManifestTransactionInput & { agentIndex: number },
  ): Promise<TxResult & { version?: number }> {
    const agent = this.#signers.getAgentAt(input.agentIndex);
    const result = await executeAndWait(
      this.#client,
      agent.keypair,
      () => buildUpdateAgentManifestTransaction(this.#manifest, input),
    );
    const event = findEvent(result.moveEvents, "AgentManifestUpdated");
    const version = integerValue(event?.json?.version);
    return { ...txResult(result), ...(version === undefined ? {} : { version }) };
  }

  /**
   * Read one staked registration back from its digest. Binding happens here,
   * exactly the way registerAgent binds after it executes: the staker signs
   * and pays, so the engine only ever sees the settled transaction, and it
   * still needs the slot bound before it can sign this seat's votes.
   */
  async readStakeRegistration(digest: string): Promise<StakeRegistrationRead> {
    const settled = await this.#client.core.waitForTransaction({
      digest,
      include: { effects: true, events: true, objectTypes: true },
    });
    if (settled.$kind === "FailedTransaction") {
      throw new Error(`stake transaction ${digest} failed on chain`);
    }
    const value = settled.Transaction;
    const events = (value.events ?? []).map((event) => ({
      packageId: event.packageId,
      module: event.module,
      eventType: event.eventType,
      sender: event.sender,
      json: event.json,
    }));
    const staked = findEvent(events, "AgentStaked");
    if (!staked) {
      throw new Error(`stake transaction ${digest} emitted no AgentStaked event`);
    }
    const registered = findEvent(events, "AgentRegistered");
    if (!registered) {
      throw new Error(
        `stake transaction ${digest} emitted no AgentRegistered event`,
      );
    }
    const agentProfileId =
      optionalId(staked.json?.agent_profile_id) ??
      optionalId(staked.json?.agentProfileId);
    const operationalOwner =
      optionalId(staked.json?.operational_owner) ??
      optionalId(staked.json?.operationalOwner);
    const amountMist = decimalString(staked.json?.amount);
    // The AgentStaked event names the staker; the envelope sender is the same
    // account, because gas sponsorship only replaces the gas owner.
    const sender =
      optionalId(staked.json?.staker) ?? staked.sender ?? registered.sender;
    const manifestHash =
      byteVectorHex(registered.json?.manifest_hash) ??
      byteVectorHex(registered.json?.manifestHash);
    if (!agentProfileId || !operationalOwner || amountMist === undefined) {
      throw new Error(`AgentStaked in ${digest} is missing required fields`);
    }
    if (!sender || !manifestHash) {
      throw new Error(`AgentRegistered in ${digest} is missing required fields`);
    }
    const agentCapId = createdObjectOfType(value, "AgentCap");
    if (!agentCapId) {
      throw new Error(`stake transaction ${digest} created no AgentCap`);
    }
    // A slot whose key this process does not hold is not an error here: the
    // seat still exists on chain, and agentForProfile re-binds on demand.
    try {
      this.#signers.bindAgentProfile({
        agentProfileId,
        agentCapId,
        owner: operationalOwner,
      });
    } catch (error) {
      if (!(error instanceof SignerRegistryError)) throw error;
    }
    return {
      sender,
      agentProfileId,
      agentCapId,
      operationalOwner,
      amountMist,
      manifestHash,
    };
  }

  /**
   * Send a fixed SUI float from the operator to a staked seat's signing key so
   * it can pay for its own commits and reveals. Skips when the seat already
   * holds `minBalanceMist`.
   */
  async fundAddress(
    input: GatewayFundAddressInput,
  ): Promise<GatewayFundAddressResult> {
    const operator = this.#signers.getOperator();
    const { balance } = await this.#client.core.getBalance({
      owner: input.address,
      coinType: "0x2::sui::SUI",
    });
    const balanceMist = String(balance.balance);
    if (
      input.minBalanceMist !== undefined &&
      BigInt(balanceMist) >= BigInt(input.minBalanceMist)
    ) {
      return { funded: false, balanceMist };
    }
    const amount = BigInt(input.amountMist);
    if (amount <= 0n) throw new RangeError("fundAddress amount must be positive");
    // Built here rather than in builders.ts: this is a plain SUI transfer with
    // no OpenVerdict move call, so it belongs to the gateway, not the package.
    const result = await executeAndWait(this.#client, operator, () => {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
      if (!coin) throw new Error("split did not produce a gas float coin");
      tx.transferObjects([coin], tx.pure.address(input.address));
      return tx;
    });
    return { funded: true, balanceMist, digest: result.digest };
  }

  async createClaim(input: GatewayCreateClaimInput): Promise<ClaimCreationResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      () =>
        input.directReviewStarted
          ? buildStartFactCheckTransaction(this.#manifest, input)
          : buildCreateClaimTransaction(this.#manifest, input),
    );
    const event = findEvent(result.moveEvents, "ClaimCreated");
    const claimId = optionalId(event?.json?.claim_id) ?? requiredObjectId(result, "claim");
    const creator = optionalId(event?.json?.creator);
    return {
      ...txResult(result),
      claimId,
      ...(creator === undefined ? {} : { creator }),
    };
  }

  async startDirectReview(claimId: string): Promise<TxResult> {
    return this.executeOperator(
      () => buildStartDirectReviewTransaction(this.#manifest, { claimId }),
    );
  }

  async startChallengedReview(claimId: string): Promise<TxResult> {
    return this.executeOperator(
      () => buildStartChallengedReviewTransaction(this.#manifest, { claimId }),
    );
  }

  async propose(input: ProposeOutcomeTransactionInput): Promise<TxResult> {
    return this.executeOperator(() => buildProposeOutcomeTransaction(this.#manifest, input));
  }

  async challenge(input: ChallengeOutcomeTransactionInput): Promise<TxResult> {
    return txResult(
      await executeAndWait(
        this.#client,
        this.#signers.getChallenger(),
        () => buildChallengeOutcomeTransaction(this.#manifest, input),
      ),
    );
  }

  async selectCommittee(claimId: string): Promise<CommitteeSelectionResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      () => buildSelectCommitteeTransaction(this.#manifest, { claimId }),
    );
    return this.selectionResult(result, 1);
  }

  async acceptJurySeat(input: GatewayAcceptSeatInput): Promise<TxResult> {
    const agent = await this.agentForProfile(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        () => buildAcceptJurySeatTransaction(this.#manifest, {
          jurySeatId: input.jurySeatId,
          agentCapId,
        }),
      ),
    );
  }

  async freezeEvidence(
    input: Omit<FreezeEvidenceTransactionInput, "evidenceCapId">,
  ): Promise<EvidenceFreezeResult> {
    const operator = this.#signers.getOperator();
    const evidenceCapId = await this.findOwnedObject(
      operator.toSuiAddress(),
      `${typePackageId(this.#manifest)}::agent_registry::EvidenceCap`,
    );
    const result = await executeAndWait(
      this.#client,
      operator,
      () => buildFreezeEvidenceTransaction(this.#manifest, { ...input, evidenceCapId }),
    );
    const event = findEvent(result.moveEvents, "EvidenceFrozen");
    const evidenceBundleId =
      optionalId(event?.json?.evidence_bundle_id) ??
      requiredObjectId(result, "evidenceBundle");
    return { ...txResult(result), evidenceBundleId };
  }

  async bindJurySeatEvidence(input: GatewayBindEvidenceInput): Promise<TxResult> {
    const agent = await this.agentForProfile(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        () => buildBindJurySeatEvidenceTransaction(this.#manifest, {
          jurySeatId: input.jurySeatId,
          roundTallyId: input.roundTallyId,
          evidenceBundleId: input.evidenceBundleId,
          agentCapId,
        }),
      ),
    );
  }

  async lockCommittee(input: {
    claimId: string;
    committeeId: string;
    roundTallyId: string;
  }): Promise<TxResult> {
    return this.executeOperator(() => buildLockCommitteeTransaction(this.#manifest, input));
  }

  // juryRun processes seats concurrently, but every approveRun is signed by
  // the operator whose gas coin and RunAttestorCap admit ONE transaction at a
  // time — parallel approvals equivocate and 4 of 5 seats die ("reserved for
  // another transaction"). Tail-chain them so approvals execute sequentially
  // while the agent-signed parts of each seat stay parallel. (The localnet E2E
  // harness proved this serialization as an external proxy; this is the same
  // fix at the source.)
  #approveTail: Promise<unknown> = Promise.resolve();

  async approveRun(input: GatewayApproveRunInput): Promise<RunApprovalResult> {
    const task = this.#approveTail.then(() => this.approveRunNow(input));
    this.#approveTail = task.catch(() => undefined);
    return task;
  }

  private async approveRunNow(input: GatewayApproveRunInput): Promise<RunApprovalResult> {
    const operator = this.#signers.getOperator();
    const runAttestorCapId = await this.findOwnedObject(
      operator.toSuiAddress(),
      `${typePackageId(this.#manifest)}::agent_registry::RunAttestorCap`,
    );
    const result = await executeAndWait(
      this.#client,
      operator,
      () => buildApproveRunTransaction(this.#manifest, { ...input, runAttestorCapId }),
    );
    const event = findEvent(result.moveEvents, "RunApproved");
    const runApprovalId =
      optionalId(event?.json?.run_approval_id) ?? requiredObjectId(result, "runApproval");
    return { ...txResult(result), runApprovalId };
  }

  async commitVote(input: GatewayCommitVoteInput): Promise<TxResult> {
    const agent = await this.agentForProfile(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        () => buildCommitVoteTransaction(this.#manifest, { ...input, agentCapId }),
      ),
    );
  }

  async revealVote(input: GatewayRevealVoteInput): Promise<RevealVoteResult> {
    const agent = await this.agentForProfile(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    const result = await executeAndWait(
      this.#client,
      agent.keypair,
      () => buildRevealVoteTransaction(this.#manifest, { ...input, agentCapId }),
    );
    const event = findEvent(result.moveEvents, "VoteRevealed");
    const revealedVoteId =
      optionalId(event?.json?.revealed_vote_id) ??
      requiredObjectId(result, "revealedVote");
    return { ...txResult(result), revealedVoteId };
  }

  async advancePhase(claimId: string, roundTallyId: string): Promise<TxResult> {
    return this.executeOperator(() =>
      buildAdvancePhaseTransaction(this.#manifest, { claimId, roundTallyId }),
    );
  }

  async openDiscussion(input: {
    claimId: string;
    firstRoundTallyId: string;
  }): Promise<TxResult> {
    return this.executeOperator(() => buildOpenDiscussionTransaction(this.#manifest, input));
  }

  async createSecondRound(input: {
    claimId: string;
    committeeId: string;
    firstRoundTallyId: string;
  }): Promise<CommitteeSelectionResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      () => buildCreateSecondRoundSeatsTransaction(this.#manifest, input),
    );
    return this.selectionResult(result, 2, input.committeeId);
  }

  async finalize(input: {
    claimId: string;
    committeeId: string;
    roundTallyId: string;
    evidenceBundleId: string;
  }): Promise<FinalizeChainResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      () => buildFinalizeClaimTransaction(this.#manifest, input),
    );
    return finalizeResult(result);
  }

  async finalizeUnchallenged(claimId: string): Promise<FinalizeChainResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      () => buildFinalizeUnchallengedTransaction(this.#manifest, { claimId }),
    );
    return finalizeResult(result);
  }

  async withdrawPayout(input: {
    claimId: string;
    payoutTicketId: string;
  }): Promise<TxResult> {
    return this.executeOperator(() => buildWithdrawPayoutTransaction(this.#manifest, input));
  }

  async epochInfo(): Promise<ChainEpochInfo> {
    // Retention epochs handed to Move are compared with ctx.epoch(), the Sui
    // epoch; cached briefly because an epoch lasts about a day.
    const now = Date.now();
    if (this.#epochCache && now - this.#epochCache.fetchedAtMs < EPOCH_CACHE_MS) {
      return this.#epochCache.value;
    }
    const { systemState } = await this.#client.core.getCurrentSystemState();
    const value = {
      currentEpoch: Number(systemState.epoch),
      epochDurationMs: Number(systemState.parameters.epochDurationMs),
    };
    if (
      !Number.isFinite(value.currentEpoch) ||
      value.currentEpoch < 0 ||
      !Number.isFinite(value.epochDurationMs) ||
      value.epochDurationMs <= 0
    ) {
      throw new Error("Sui system state reported an invalid epoch");
    }
    this.#epochCache = { value, fetchedAtMs: now };
    return value;
  }

  async health(): Promise<SuiGatewayHealth> {
    try {
      await this.#client.core.getChainIdentifier();
      const registry = await this.#client.core.getObject({
        objectId: this.#manifest.registryObjectId,
        include: { json: true },
      });
      return {
        healthy: true,
        paused: registry.object.json?.paused === true,
      };
    } catch {
      return { healthy: false, paused: false };
    }
  }

  async juryDiversity(): Promise<JuryDiversity> {
    return readJuryDiversity(this.#client, this.#manifest);
  }

  async committeeDiversity(committeeId: string): Promise<JuryDiversity> {
    return readCommitteeDiversity(this.#client, this.#manifest, committeeId);
  }

  private async executeOperator(transaction: Parameters<typeof executeAndWait>[2]): Promise<TxResult> {
    // Operator transactions from this process run one at a time, on the
    // lane shared with Walrus writes: they all spend from the same gas coin,
    // and five seats approving and writing together made the validators
    // reject each other's transactions.
    return txResult(
      await runOnOperatorLane(async () => {
        const operator = this.#signers.getOperator();
        const result = await executeAndWait(this.#client, operator, transaction);
        // Let the owned-object index catch up before the next operation
        // (a Walrus write) selects gas from it.
        await waitForGasIndex(this.#client, operator.toSuiAddress());
        return result;
      }),
    );
  }

  private async selectionResult(
    result: Awaited<ReturnType<typeof executeAndWait>>,
    phase: 1 | 2,
    existingCommitteeId?: string,
  ): Promise<CommitteeSelectionResult> {
    const event = findEvent(result.moveEvents, "CommitteeSelected");
    const profileIds = idVector(event?.json?.agent_profile_ids);
    const jurySeatIds = idVector(event?.json?.jury_seat_ids);
    if (profileIds.length !== jurySeatIds.length || profileIds.length !== 5) {
      throw new Error("CommitteeSelected did not contain five matched profiles and seats");
    }
    const seats = await Promise.all(profileIds.map(async (agentProfileId, index) => {
      const jurySeatId = jurySeatIds[index];
      if (!jurySeatId) throw new Error("CommitteeSelected omitted a jury seat ID");
      let signer;
      try {
        signer = this.#signers.getAgentByProfileId(agentProfileId);
      } catch (error) {
        if (!(error instanceof SignerRegistryError)) throw error;
        const seat = await this.#client.core.getObject({
          objectId: jurySeatId,
          include: { json: true },
        });
        const owner =
          optionalId(seat.object.json?.agent_owner) ??
          optionalId(seat.object.json?.agentOwner);
        if (!owner) throw new Error(`jury seat ${jurySeatId} has no readable agent owner`);
        signer = this.#signers.getAgentByOwner(owner);
        const agentCapId = await this.findAgentCap(owner, agentProfileId);
        signer = this.#signers.bindAgentProfile({
          agentProfileId,
          owner,
          agentCapId,
        });
      }
      return {
        jurySeatId,
        agentProfileId,
        owner: signer.address,
        ...(signer.agentCapId === undefined ? {} : { agentCapId: signer.agentCapId }),
      };
    }));
    const committeeId =
      existingCommitteeId ??
      optionalId(event?.json?.committee_id) ??
      requiredObjectId(result, "committee");
    const roundTallyId =
      optionalId(event?.json?.first_round_tally_id) ??
      requiredObjectId(result, "roundTally");
    const committeeObject = await this.#client.core.getObject({
      objectId: committeeId,
      include: { json: true },
    });
    const reserveAgentProfileIds = idVector(
      committeeObject.object.json?.reserve_profile_ids ??
        committeeObject.object.json?.reserveProfileIds,
    );
    return {
      ...txResult(result),
      committeeId,
      roundTallyId,
      seats,
      reserveAgentProfileIds,
    };
  }

  /** Resolve a signer for an agent profile, self-healing across processes.
   * Committee selection binds profile→signer in the process that ran it, but
   * each worker holds its own in-memory SignerRegistry — so a worker that did
   * not process the selection must re-derive the binding from the on-chain
   * profile's owner before it can sign for a seat. */
  private async agentForProfile(agentProfileId: string) {
    try {
      return this.#signers.getAgentByProfileId(agentProfileId);
    } catch (error) {
      if (!(error instanceof SignerRegistryError)) throw error;
      const profile = await this.#client.core.getObject({
        objectId: agentProfileId,
        include: { json: true },
      });
      const owner = optionalId(profile.object.json?.owner);
      if (!owner) {
        throw new Error(`agent profile ${agentProfileId} has no readable owner`);
      }
      const agentCapId = await this.findAgentCap(owner, agentProfileId);
      return this.#signers.bindAgentProfile({ agentProfileId, owner, agentCapId });
    }
  }

  private async agentCapId(agentProfileId: string): Promise<string> {
    const agent = await this.agentForProfile(agentProfileId);
    if (agent.agentCapId) return agent.agentCapId;
    const capId = await this.findAgentCap(agent.address, agentProfileId);
    this.#signers.bindAgentProfile({
      agentProfileId,
      owner: agent.address,
      agentCapId: capId,
    });
    return capId;
  }

  private async findOwnedObject(owner: string, type: string): Promise<string> {
    let cursor: string | null = null;
    do {
      const page: {
        objects: Array<{ objectId: string }>;
        cursor: string | null;
        hasNextPage: boolean;
      } = await this.#client.core.listOwnedObjects({
        owner,
        type,
        cursor,
        limit: 50,
      });
      const object = page.objects[0];
      if (object) return object.objectId;
      cursor = page.cursor;
      if (!page.hasNextPage) break;
    } while (cursor !== null);
    throw new Error(`required owned object ${type} was not found for ${owner}`);
  }

  private async findAgentCap(owner: string, agentProfileId: string): Promise<string> {
    let cursor: string | null = null;
    const type = `${typePackageId(this.#manifest)}::agent_registry::AgentCap`;
    do {
      const page: {
        objects: Array<{
          objectId: string;
          json: Record<string, unknown> | null;
        }>;
        cursor: string | null;
        hasNextPage: boolean;
      } = await this.#client.core.listOwnedObjects({
        owner,
        type,
        cursor,
        limit: 50,
        include: { json: true },
      });
      const cap = page.objects.find(
        (object) =>
          optionalId(object.json?.agent_profile_id) === agentProfileId ||
          optionalId(object.json?.agentProfileId) === agentProfileId,
      );
      if (cap) return cap.objectId;
      cursor = page.cursor;
      if (!page.hasNextPage) break;
    } while (cursor !== null);
    throw new Error(`AgentCap for profile ${agentProfileId} was not found for ${owner}`);
  }
}

export function createSuiGateway(config: SuiGatewayConfig): SuiGateway {
  return new RealSuiGateway(config);
}

function txResult(result: Awaited<ReturnType<typeof executeAndWait>>): TxResult {
  return {
    digest: result.digest,
    ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    ...(result.objectIds === undefined ? {} : { objectIds: result.objectIds }),
  };
}

function finalizeResult(
  result: Awaited<ReturnType<typeof executeAndWait>>,
): FinalizeChainResult {
  const event =
    findEvent(result.moveEvents, "ClaimFinalized") ??
    findEvent(result.moveEvents, "ClaimUnresolved");
  const certificateId =
    optionalId(event?.json?.certificate_id) ??
    requiredObjectId(result, "resolutionCertificate");
  const payoutTicketIds = Object.entries(result.objectIds ?? {})
    .filter(([name]) => name.startsWith("payoutTicket"))
    .map(([, id]) => id);
  const payoutTickets = result.moveEvents.flatMap((moveEvent) => {
    if (!eventHasName(moveEvent, "PayoutTicketCreated")) return [];
    const payoutTicketId = optionalId(moveEvent.json?.ticket_id);
    const recipient = optionalId(moveEvent.json?.recipient);
    const amount = decimalString(moveEvent.json?.amount);
    const reason = integerValue(moveEvent.json?.reason);
    if (!payoutTicketId || !recipient || amount === undefined || reason === undefined) {
      return [];
    }
    return [{ payoutTicketId, recipient, amount, reason }];
  });
  return { ...txResult(result), certificateId, payoutTicketIds, payoutTickets };
}

function requiredObjectId(
  result: Awaited<ReturnType<typeof executeAndWait>>,
  name: string,
): string {
  const value = result.objectIds?.[name];
  if (!value) throw new Error(`Sui transaction did not create expected ${name} object`);
  return value;
}

/** Object types keep the first-published address across package upgrades. */
function typePackageId(manifest: ReleaseManifest): string {
  return manifest.originalPackageId?.length ? manifest.originalPackageId : manifest.packageId;
}

function findEvent(
  events: ExecutedMoveEvent[],
  name: string,
): ExecutedMoveEvent | undefined {
  return events.find((event) => event.eventType.split("::").at(-1)?.split("<", 1)[0] === name);
}

function eventHasName(event: ExecutedMoveEvent, name: string): boolean {
  return event.eventType.split("::").at(-1)?.split("<", 1)[0] === name;
}

/** The first object this transaction created whose type ends in `structName`. */
function createdObjectOfType(
  value: {
    effects?: { changedObjects: Array<{ objectId: string; idOperation: string }> } | undefined;
    objectTypes?: Record<string, string> | undefined;
  },
  structName: string,
): string | undefined {
  const objectTypes = value.objectTypes ?? {};
  for (const object of value.effects?.changedObjects ?? []) {
    if (object.idOperation !== "Created") continue;
    const type = objectTypes[object.objectId];
    if (type && type.split("::").at(-1)?.split("<", 1)[0] === structName) {
      return object.objectId;
    }
  }
  return undefined;
}

/**
 * A Move `vector<u8>` as 0x-hex. Transports disagree on the JSON shape: gRPC
 * sends base64, JSON-RPC an array of byte numbers, and either may already have
 * hex, so all three are accepted and anything else fails closed.
 */
function byteVectorHex(value: unknown): `0x${string}` | undefined {
  if (Array.isArray(value)) {
    if (!value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return undefined;
    }
    return toHex(Uint8Array.from(value as number[]));
  }
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    return value.toLowerCase() as `0x${string}`;
  }
  try {
    return toHex(fromBase64(value));
  } catch {
    return undefined;
  }
}

function idVector(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(optionalId).filter((id): id is string => id !== undefined);
}

function optionalId(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("0x")) return value;
  if (typeof value !== "object" || value === null) return undefined;
  for (const key of ["id", "bytes", "value"]) {
    if (key in value) {
      const nested = optionalId((value as Record<string, unknown>)[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function decimalString(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

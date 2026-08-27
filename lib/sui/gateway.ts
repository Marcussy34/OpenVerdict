import type { TxResult } from "../engine/contract";
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
  buildWithdrawPayoutTransaction,
  type ChallengeOutcomeTransactionInput,
  type FreezeEvidenceTransactionInput,
  type ProposeOutcomeTransactionInput,
  type RegisterAgentTransactionInput,
} from "./builders";
import { executeAndWait, type ExecutedMoveEvent } from "./execute";
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
  GatewayRevealVoteInput,
  RevealVoteResult,
  RunApprovalResult,
  SuiAgentIdentity,
  SuiGateway,
  SuiGatewayHealth,
} from "./gateway-types";
import type { OpenVerdictSuiClient } from "./client";
import type { ReleaseManifest } from "./manifest";
import { SignerRegistry, SignerRegistryError } from "./signers";

export interface SuiGatewayConfig {
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  signers: SignerRegistry;
}

/** Real Sui implementation of the narrow lifecycle seam used by the engine. */
export class RealSuiGateway implements SuiGateway {
  readonly #client: OpenVerdictSuiClient;
  readonly #manifest: ReleaseManifest;
  readonly #signers: SignerRegistry;

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
      buildRegisterAgentTransaction(this.#manifest, input),
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

  async createClaim(input: GatewayCreateClaimInput): Promise<ClaimCreationResult> {
    const transaction = input.directReviewStarted
      ? buildStartFactCheckTransaction(this.#manifest, input)
      : buildCreateClaimTransaction(this.#manifest, input);
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      transaction,
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
      buildStartDirectReviewTransaction(this.#manifest, { claimId }),
    );
  }

  async startChallengedReview(claimId: string): Promise<TxResult> {
    return this.executeOperator(
      buildStartChallengedReviewTransaction(this.#manifest, { claimId }),
    );
  }

  async propose(input: ProposeOutcomeTransactionInput): Promise<TxResult> {
    return this.executeOperator(buildProposeOutcomeTransaction(this.#manifest, input));
  }

  async challenge(input: ChallengeOutcomeTransactionInput): Promise<TxResult> {
    return txResult(
      await executeAndWait(
        this.#client,
        this.#signers.getChallenger(),
        buildChallengeOutcomeTransaction(this.#manifest, input),
      ),
    );
  }

  async selectCommittee(claimId: string): Promise<CommitteeSelectionResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      buildSelectCommitteeTransaction(this.#manifest, { claimId }),
    );
    return this.selectionResult(result, 1);
  }

  async acceptJurySeat(input: GatewayAcceptSeatInput): Promise<TxResult> {
    const agent = this.#signers.getAgentByProfileId(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        buildAcceptJurySeatTransaction(this.#manifest, {
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
      `${this.#manifest.packageId}::agent_registry::EvidenceCap`,
    );
    const result = await executeAndWait(
      this.#client,
      operator,
      buildFreezeEvidenceTransaction(this.#manifest, { ...input, evidenceCapId }),
    );
    const event = findEvent(result.moveEvents, "EvidenceFrozen");
    const evidenceBundleId =
      optionalId(event?.json?.evidence_bundle_id) ??
      requiredObjectId(result, "evidenceBundle");
    return { ...txResult(result), evidenceBundleId };
  }

  async bindJurySeatEvidence(input: GatewayBindEvidenceInput): Promise<TxResult> {
    const agent = this.#signers.getAgentByProfileId(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        buildBindJurySeatEvidenceTransaction(this.#manifest, {
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
    return this.executeOperator(buildLockCommitteeTransaction(this.#manifest, input));
  }

  async approveRun(input: GatewayApproveRunInput): Promise<RunApprovalResult> {
    const operator = this.#signers.getOperator();
    const runAttestorCapId = await this.findOwnedObject(
      operator.toSuiAddress(),
      `${this.#manifest.packageId}::agent_registry::RunAttestorCap`,
    );
    const result = await executeAndWait(
      this.#client,
      operator,
      buildApproveRunTransaction(this.#manifest, { ...input, runAttestorCapId }),
    );
    const event = findEvent(result.moveEvents, "RunApproved");
    const runApprovalId =
      optionalId(event?.json?.run_approval_id) ?? requiredObjectId(result, "runApproval");
    return { ...txResult(result), runApprovalId };
  }

  async commitVote(input: GatewayCommitVoteInput): Promise<TxResult> {
    const agent = this.#signers.getAgentByProfileId(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    return txResult(
      await executeAndWait(
        this.#client,
        agent.keypair,
        buildCommitVoteTransaction(this.#manifest, { ...input, agentCapId }),
      ),
    );
  }

  async revealVote(input: GatewayRevealVoteInput): Promise<RevealVoteResult> {
    const agent = this.#signers.getAgentByProfileId(input.agentProfileId);
    const agentCapId = await this.agentCapId(input.agentProfileId);
    const result = await executeAndWait(
      this.#client,
      agent.keypair,
      buildRevealVoteTransaction(this.#manifest, { ...input, agentCapId }),
    );
    const event = findEvent(result.moveEvents, "VoteRevealed");
    const revealedVoteId =
      optionalId(event?.json?.revealed_vote_id) ??
      requiredObjectId(result, "revealedVote");
    return { ...txResult(result), revealedVoteId };
  }

  async advancePhase(claimId: string): Promise<TxResult> {
    return this.executeOperator(buildAdvancePhaseTransaction(this.#manifest, { claimId }));
  }

  async openDiscussion(input: {
    claimId: string;
    firstRoundTallyId: string;
  }): Promise<TxResult> {
    return this.executeOperator(buildOpenDiscussionTransaction(this.#manifest, input));
  }

  async createSecondRound(input: {
    claimId: string;
    committeeId: string;
    firstRoundTallyId: string;
  }): Promise<CommitteeSelectionResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      buildCreateSecondRoundSeatsTransaction(this.#manifest, input),
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
      buildFinalizeClaimTransaction(this.#manifest, input),
    );
    return finalizeResult(result);
  }

  async finalizeUnchallenged(claimId: string): Promise<FinalizeChainResult> {
    const result = await executeAndWait(
      this.#client,
      this.#signers.getOperator(),
      buildFinalizeUnchallengedTransaction(this.#manifest, { claimId }),
    );
    return finalizeResult(result);
  }

  async withdrawPayout(input: {
    claimId: string;
    payoutTicketId: string;
  }): Promise<TxResult> {
    return this.executeOperator(buildWithdrawPayoutTransaction(this.#manifest, input));
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

  private async executeOperator(transaction: Parameters<typeof executeAndWait>[2]): Promise<TxResult> {
    return txResult(
      await executeAndWait(this.#client, this.#signers.getOperator(), transaction),
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

  private async agentCapId(agentProfileId: string): Promise<string> {
    const agent = this.#signers.getAgentByProfileId(agentProfileId);
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
    const type = `${this.#manifest.packageId}::agent_registry::AgentCap`;
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

function findEvent(
  events: ExecutedMoveEvent[],
  name: string,
): ExecutedMoveEvent | undefined {
  return events.find((event) => event.eventType.split("::").at(-1)?.split("<", 1)[0] === name);
}

function eventHasName(event: ExecutedMoveEvent, name: string): boolean {
  return event.eventType.split("::").at(-1)?.split("<", 1)[0] === name;
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

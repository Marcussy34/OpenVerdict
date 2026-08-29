import { Transaction } from "@mysten/sui/transactions";
import type { ClaimCreateRequest } from "../engine/contract";
import type { VoteOutcome } from "../protocol/constants";
import { assertDeployedManifest, type ReleaseManifest } from "./manifest";

type Amount = bigint | number | string;

export interface RegisterAgentTransactionInput {
  bondAmount: Amount;
  manifestHash: Uint8Array;
  manifestBlobId: string;
  modelHash: Uint8Array;
  roleHash: Uint8Array;
  humanBackingHash: Uint8Array;
}

export interface UpdateAgentManifestTransactionInput {
  agentProfileId: string;
  agentCapId: string;
  manifestHash: Uint8Array;
  manifestBlobId: string;
  modelHash: Uint8Array;
  roleHash: Uint8Array;
}

export interface CreateClaimTransactionInput extends ClaimCreateRequest {
  creationBudget?: string;
  contentHash: Uint8Array;
  statementBlobId: string;
  criteriaBlobId: string;
  evidencePolicyId: Uint8Array;
}

export type StartFactCheckTransactionInput = Omit<
  CreateClaimTransactionInput,
  "mode"
>;

export interface ClaimObjectInput {
  claimId: string;
}

export interface ProposeOutcomeTransactionInput extends ClaimObjectInput {
  proposerBondAmount: Amount;
  outcome: VoteOutcome;
}

export interface ChallengeOutcomeTransactionInput extends ClaimObjectInput {
  challengerBondAmount: Amount;
  reasonHash: Uint8Array;
  reasonBlobId: string;
}

export interface AcceptJurySeatTransactionInput {
  jurySeatId: string;
  agentCapId: string;
}

export interface FreezeEvidenceTransactionInput extends ClaimObjectInput {
  evidenceCapId: string;
  phase: 1 | 2;
  root: Uint8Array;
  manifestBlobId: string;
  manifestBlobObjectId: string;
  sourceCount: number;
  policyId: Uint8Array;
  walrusEndEpoch: Amount;
}

export interface ApproveRunTransactionInput {
  runAttestorCapId: string;
  claimId: string;
  committeeId: string;
  jurySeatId: string;
  agentProfileId: string;
  agentOwner: string;
  phase: 1 | 2;
  runHash: Uint8Array;
  runBlobId: string;
  runBlobObjectId: string;
  toolBlobId: string;
  toolBlobObjectId: string;
  walrusEndEpoch: Amount;
}

export interface CommitVoteTransactionInput {
  jurySeatId: string;
  agentCapId: string;
  runApprovalId: string;
  commitment: Uint8Array;
}

export interface RevealVoteTransactionInput {
  jurySeatId: string;
  roundTallyId: string;
  agentCapId: string;
  outcome: VoteOutcome;
  confidenceBps: number;
  outputHash: Uint8Array;
  runHash: Uint8Array;
  salt: Uint8Array;
  argumentBlobId: string;
  argumentBlobObjectId: string;
  argumentWalrusEndEpoch: Amount;
}

export interface FinalizeClaimTransactionInput extends ClaimObjectInput {
  committeeId: string;
  roundTallyId: string;
  evidenceBundleId: string;
}

export interface WithdrawPayoutTransactionInput extends ClaimObjectInput {
  payoutTicketId: string;
}

export interface CreateDemoPoolTransactionInput extends ClaimObjectInput {
  acceptedPackageVersion: Amount;
  closeAtMs: Amount;
}

export interface EnterDemoPoolTransactionInput {
  poolId: string;
  stakeAmount: Amount;
  outcome: 1 | 2;
}

export interface SettleDemoPoolTransactionInput {
  poolId: string;
  certificateId: string;
}

export interface RedeemDemoPoolTransactionInput {
  poolId: string;
  positionId: string;
}

export interface BindJurySeatEvidenceTransactionInput {
  jurySeatId: string;
  roundTallyId: string;
  evidenceBundleId: string;
  agentCapId: string;
}

export interface LockCommitteeTransactionInput extends ClaimObjectInput {
  committeeId: string;
  roundTallyId: string;
}

export interface OpenDiscussionTransactionInput extends ClaimObjectInput {
  firstRoundTallyId: string;
}

export interface CreateSecondRoundTransactionInput extends ClaimObjectInput {
  committeeId: string;
  firstRoundTallyId: string;
}

export function buildRegisterAgentTransaction(
  manifest: ReleaseManifest,
  input: RegisterAgentTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "agent_registry", "register_agent"),
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.coin({ type: "0x2::sui::SUI", balance: toBigInt(input.bondAmount) }),
      bytes(tx, input.manifestHash),
      bytes(tx, input.manifestBlobId),
      bytes(tx, input.modelHash),
      bytes(tx, input.roleHash),
      bytes(tx, input.humanBackingHash),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

/** Updates an existing agent's on-chain manifest pointers. */
export function buildUpdateAgentManifestTransaction(
  manifest: ReleaseManifest,
  input: UpdateAgentManifestTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "agent_registry", "update_agent_manifest"),
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.agentProfileId),
      tx.object(input.agentCapId),
      bytes(tx, input.manifestHash),
      bytes(tx, input.manifestBlobId),
      bytes(tx, input.modelHash),
      bytes(tx, input.roleHash),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildCreateClaimTransaction(
  manifest: ReleaseManifest,
  input: CreateClaimTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  const creation = toBigInt(input.creationBudget ?? "0");
  const committee = toBigInt(input.committeeBudget);
  const evidence = toBigInt(input.evidenceBudget);
  tx.moveCall({
    target: target(manifest, "claim", "create_claim"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.coin({ type: manifest.coinType, balance: creation + committee + evidence }),
      tx.pure.u8(input.mode),
      ...deadlineArguments(tx, input.deadlines),
      tx.pure.u64(creation),
      tx.pure.u64(committee),
      tx.pure.u64(evidence),
      bytes(tx, input.contentHash),
      bytes(tx, input.statementBlobId),
      bytes(tx, input.criteriaBlobId),
      bytes(tx, input.evidencePolicyId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

/** Demo direct-review constructor that creates and starts the claim atomically. */
export function buildStartFactCheckTransaction(
  manifest: ReleaseManifest,
  input: StartFactCheckTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  const creation = toBigInt(input.creationBudget ?? "0");
  const committee = toBigInt(input.committeeBudget);
  const evidence = toBigInt(input.evidenceBudget);
  tx.moveCall({
    target: target(manifest, "demo_fact_checker", "start_fact_check"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.coin({ type: manifest.coinType, balance: creation + committee + evidence }),
      ...deadlineArguments(tx, input.deadlines),
      tx.pure.u64(creation),
      tx.pure.u64(committee),
      tx.pure.u64(evidence),
      bytes(tx, input.contentHash),
      bytes(tx, input.statementBlobId),
      bytes(tx, input.criteriaBlobId),
      bytes(tx, input.evidencePolicyId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildStartDirectReviewTransaction(
  manifest: ReleaseManifest,
  input: ClaimObjectInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "claim", "start_direct_review"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildStartChallengedReviewTransaction(
  manifest: ReleaseManifest,
  input: ClaimObjectInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "claim", "start_challenged_review"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildProposeOutcomeTransaction(
  manifest: ReleaseManifest,
  input: ProposeOutcomeTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "claim", "propose_outcome"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.coin({ type: manifest.coinType, balance: toBigInt(input.proposerBondAmount) }),
      tx.pure.u8(input.outcome),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildChallengeOutcomeTransaction(
  manifest: ReleaseManifest,
  input: ChallengeOutcomeTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "claim", "challenge_outcome"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.coin({ type: manifest.coinType, balance: toBigInt(input.challengerBondAmount) }),
      bytes(tx, input.reasonHash),
      bytes(tx, input.reasonBlobId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildSelectCommitteeTransaction(
  manifest: ReleaseManifest,
  input: ClaimObjectInput,
): Transaction {
  const tx = transactionFor(manifest);
  // Random-dependent MoveCall must remain the final PTB command.
  tx.moveCall({
    target: target(manifest, "jury", "select_committee"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.object(manifest.randomObjectId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildAcceptJurySeatTransaction(
  manifest: ReleaseManifest,
  input: AcceptJurySeatTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "accept_jury_seat"),
    arguments: [
      tx.object(input.jurySeatId),
      tx.object(input.agentCapId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildFreezeEvidenceTransaction(
  manifest: ReleaseManifest,
  input: FreezeEvidenceTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "evidence", "freeze_evidence"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.evidenceCapId),
      tx.pure.u8(input.phase),
      bytes(tx, input.root),
      bytes(tx, input.manifestBlobId),
      tx.pure.id(input.manifestBlobObjectId),
      tx.pure.u32(input.sourceCount),
      bytes(tx, input.policyId),
      tx.pure.u64(input.walrusEndEpoch),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildApproveRunTransaction(
  manifest: ReleaseManifest,
  input: ApproveRunTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "approve_run"),
    arguments: [
      tx.object(input.runAttestorCapId),
      tx.pure.id(input.claimId),
      tx.pure.id(input.committeeId),
      tx.pure.id(input.jurySeatId),
      tx.pure.id(input.agentProfileId),
      tx.pure.address(input.agentOwner),
      tx.pure.u8(input.phase),
      bytes(tx, input.runHash),
      bytes(tx, input.runBlobId),
      tx.pure.id(input.runBlobObjectId),
      bytes(tx, input.toolBlobId),
      tx.pure.id(input.toolBlobObjectId),
      tx.pure.u64(input.walrusEndEpoch),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildCommitVoteTransaction(
  manifest: ReleaseManifest,
  input: CommitVoteTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "commit_vote"),
    arguments: [
      tx.object(input.jurySeatId),
      tx.object(input.agentCapId),
      tx.object(input.runApprovalId),
      bytes(tx, input.commitment),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildRevealVoteTransaction(
  manifest: ReleaseManifest,
  input: RevealVoteTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "reveal_vote"),
    arguments: [
      tx.object(input.jurySeatId),
      tx.object(input.roundTallyId),
      tx.object(input.agentCapId),
      tx.pure.u8(input.outcome),
      tx.pure.u16(input.confidenceBps),
      bytes(tx, input.outputHash),
      bytes(tx, input.runHash),
      bytes(tx, input.salt),
      bytes(tx, input.argumentBlobId),
      tx.pure.id(input.argumentBlobObjectId),
      tx.pure.u64(input.argumentWalrusEndEpoch),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildAdvancePhaseTransaction(
  manifest: ReleaseManifest,
  input: ClaimObjectInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "claim", "advance_phase"),
    typeArguments: [manifest.coinType],
    arguments: [tx.object(input.claimId), tx.object(manifest.clockObjectId)],
  });
  return tx;
}

export function buildFinalizeClaimTransaction(
  manifest: ReleaseManifest,
  input: FinalizeClaimTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "settlement", "finalize_claim"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.committeeId),
      tx.object(input.roundTallyId),
      tx.object(input.evidenceBundleId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildFinalizeUnchallengedTransaction(
  manifest: ReleaseManifest,
  input: ClaimObjectInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "settlement", "finalize_unchallenged"),
    typeArguments: [manifest.coinType],
    arguments: [tx.object(input.claimId), tx.object(manifest.clockObjectId)],
  });
  return tx;
}

export function buildWithdrawPayoutTransaction(
  manifest: ReleaseManifest,
  input: WithdrawPayoutTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "settlement", "withdraw_payout"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.payoutTicketId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildBindJurySeatEvidenceTransaction(
  manifest: ReleaseManifest,
  input: BindJurySeatEvidenceTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "bind_jury_seat_evidence"),
    arguments: [
      tx.object(input.jurySeatId),
      tx.object(input.roundTallyId),
      tx.object(input.evidenceBundleId),
      tx.object(input.agentCapId),
    ],
  });
  return tx;
}

export function buildLockCommitteeTransaction(
  manifest: ReleaseManifest,
  input: LockCommitteeTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "lock_committee"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.committeeId),
      tx.object(input.roundTallyId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildOpenDiscussionTransaction(
  manifest: ReleaseManifest,
  input: OpenDiscussionTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "open_discussion"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.firstRoundTallyId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildCreateSecondRoundSeatsTransaction(
  manifest: ReleaseManifest,
  input: CreateSecondRoundTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "jury", "create_second_round_seats"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.claimId),
      tx.object(input.committeeId),
      tx.object(input.firstRoundTallyId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildCreateDemoPoolTransaction(
  manifest: ReleaseManifest,
  input: CreateDemoPoolTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "demo_binary_pool", "create_pool"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.claimId),
      tx.pure.u64(input.acceptedPackageVersion),
      tx.pure.u64(input.closeAtMs),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildEnterDemoPoolTransaction(
  manifest: ReleaseManifest,
  input: EnterDemoPoolTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "demo_binary_pool", "enter"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(input.poolId),
      tx.coin({ type: manifest.coinType, balance: toBigInt(input.stakeAmount) }),
      tx.pure.u8(input.outcome),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildSettleDemoPoolTransaction(
  manifest: ReleaseManifest,
  input: SettleDemoPoolTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "demo_binary_pool", "settle_pool"),
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(input.poolId),
      tx.object(input.certificateId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

export function buildRedeemDemoPoolTransaction(
  manifest: ReleaseManifest,
  input: RedeemDemoPoolTransactionInput,
): Transaction {
  const tx = transactionFor(manifest);
  tx.moveCall({
    target: target(manifest, "demo_binary_pool", "redeem"),
    typeArguments: [manifest.coinType],
    arguments: [tx.object(input.poolId), tx.object(input.positionId)],
  });
  return tx;
}

function transactionFor(manifest: ReleaseManifest): Transaction {
  assertDeployedManifest(manifest);
  return new Transaction();
}

function target(
  manifest: ReleaseManifest,
  moduleName: string,
  functionName: string,
): `${string}::${string}::${string}` {
  return `${manifest.packageId}::${moduleName}::${functionName}`;
}

function bytes(tx: Transaction, value: Uint8Array | string) {
  const encoded = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return tx.pure.vector("u8", encoded);
}

function deadlineArguments(
  tx: Transaction,
  deadlines: ClaimCreateRequest["deadlines"],
) {
  return [
    tx.pure.u64(deadlines.proposalDeadlineMs),
    tx.pure.u64(deadlines.challengeDeadlineMs),
    tx.pure.u64(deadlines.firstCommitDeadlineMs),
    tx.pure.u64(deadlines.firstRevealDeadlineMs),
    tx.pure.u64(deadlines.discussionDeadlineMs),
    tx.pure.u64(deadlines.secondCommitDeadlineMs),
    tx.pure.u64(deadlines.secondRevealDeadlineMs),
  ];
}

function toBigInt(value: Amount): bigint {
  const amount = BigInt(value);
  if (amount < 0n) throw new RangeError("coin amount must not be negative");
  return amount;
}

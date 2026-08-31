import { randomBytes, randomUUID } from "node:crypto";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import {
  buildEvidenceManifest,
  canonicalizeHtml,
  retrieveEvidence,
  type EvidenceManifestItem,
  type RetrievalPolicy,
  type RetrievedArtifact,
} from "../evidence";
import {
  EMPTY_TOOL_TRANSCRIPT_HASH,
  GonkaRunError,
  canonicalJsonBytes,
  canonicalJsonString,
  hashCanonicalJson,
  promptSpecHash,
  toolPolicyHash,
  type GonkaAttemptRecord,
  type GonkaRouterAdapter,
  type GonkaRunResult,
} from "../gonka";
import {
  CLAIM_MODE,
  CLAIM_STATE,
  OUTCOME,
  agentProbabilityBps,
  blake2b256,
  computeRunHash,
  computeTruthScoreBps,
  computeVoteCommitment,
  fromHex,
  toHex,
  type AgentManifest,
  type AgentManifestDocument,
  type AgentManifestDocumentV3,
  type AgentManifestDocumentV4,
  type AgentManifestDocumentV5,
  type InferenceFailureV1,
  type InferenceRunAudit,
  type OracleInferenceInput,
  type OracleInferenceOutput,
  type PromptSpecV2,
  type PromptSpecV3,
  type PromptSpecV4,
  type PublicRunBundle,
  type PublicRunBundleCore,
  type ResearchTranscriptV1,
  type SealedRunBundleV2,
  type ToolPolicyV2,
  type ToolPolicyV3,
  type ToolPolicyV4,
  type VoteOutcome,
} from "../protocol";
import {
  createFakeResearchProvider,
  createSearchCache,
  runResearchLoop,
  transcriptHash,
  type PageStore,
  type ResearchLoopFailureStatus,
  type ResearchProvider,
  type SearchCache,
  type PageStorePage,
} from "../research";
import {
  createRepository,
  migrate,
  type AgentManifestRecord,
  type ClaimRecord,
  type CommitteeRecord,
  type EvidenceArtifactRecord,
  type EvidenceManifestRecord,
  type EvidenceSubmissionRecord,
  type InferenceRunRecord,
  type JurySeatRecord,
  type Repository,
  type ResolutionCertificateRecord,
  type RevealRecord,
  type RoundTallyRecord,
  type RunApprovalRecord,
  type VotePackageRecord,
  type RunProofRecord,
} from "../storage";
import { getOrBuildPublicRunProof } from "../verify/public-run-proof";
import {
  createSuiGateway,
  loadReleaseManifest,
  outcomeLabel,
  toChainRetentionEpoch,
  type ReleaseManifest,
  type SuiGateway,
} from "../sui";
import type { SealEscrowService } from "../seal/escrow";
import { serializePublicEvent } from "../events";
import type { WalrusStore, WalrusPutResult } from "../walrus";
import type {
  AgentBackingStatus,
  AgentCard,
  AgentDirectoryEntry,
  AgentRunSummary,
  AgentTrackRecord,
  ChallengeReason,
  ClaimCreateRequest,
  ClaimInspection,
  CommitmentStatus,
  Engine,
  EngineStatus,
  FactCheckReport,
  FactCheckRequest,
  FinalizeReport,
  JuryRunReport,
  ResolutionEvent,
  ResolutionEventSource,
  ResolutionEventVisibility,
  RunProofResult,
  TxResult,
  ZkBackedRegistrationRequest,
  ZkBackedRegistrationResult,
} from "./contract";
import type { EngineAgentConfig, EngineConfig } from "./config";
import {
  ClaimNotFoundError,
  EngineNoEvidenceError,
  EngineStateError,
  EngineValidationError,
  ZkLoginVerificationError,
} from "./errors";
import {
  EVIDENCE_POLICY_V1_LABEL,
  buildAgentManifestDocument,
  parseAgentManifestDocument,
} from "./agentManifestDocument";
import {
  buildRunBundleCore,
  canonicalCoreBytes,
  sealRunBundle,
} from "./runBundle";
import {
  buildZkLoginBackingMessage,
  ZKLOGIN_AGENT_ROLES,
  type ZkLoginAgentRole,
  type ZkLoginVerificationInput,
  type ZkLoginVerifier,
} from "./zklogin";

const ZERO_OBJECT_ID = `0x${"00".repeat(32)}` as const;
const MAX_LOCAL_WALRUS_EPOCH = Number.MAX_SAFE_INTEGER;
const SUI_ADDRESS_PATTERN = /^0x[0-9a-f]{64}$/;
const MAX_ZKLOGIN_SIGNATURE_LENGTH = 16_384;
const MAX_FACT_CHECK_TEXT_LENGTH = 20_000;
const ZKLOGIN_VERIFICATION_PROVIDER = "zklogin:enoki";
const DEMO_ALLOWLIST_VERIFICATION_PROVIDER = "demo-allowlist";
// move/openverdict/sources/settlement.move defines REASON_JURY_REWARD as 2.
const JURY_REWARD_REASON = 2;
const CLAIM_STATEMENT_SOURCE_URL = "urn:openverdict:claim-statement";
const ROUND_ONE_PUBLIC_RECORD_SOURCE_URL =
  "urn:openverdict:round-1-public-record";

export function agentBackingStatus(
  humanVerificationProvider: string,
): AgentBackingStatus {
  switch (humanVerificationProvider) {
    case ZKLOGIN_VERIFICATION_PROVIDER:
      return { kind: "ZKLOGIN", label: humanVerificationProvider };
    // Two historical spellings: the engine's registration path writes
    // "demo-allowlist", the testnet seed documents carry the longer form.
    case DEMO_ALLOWLIST_VERIFICATION_PROVIDER:
    case "testnet-demo-allowlist":
      return { kind: "ALLOWLIST", label: humanVerificationProvider };
    default:
      return { kind: "UNKNOWN", label: humanVerificationProvider };
  }
}

function trackRecordFor(
  trackRecords: Map<string, AgentTrackRecord>,
  agentProfileId: string,
): AgentTrackRecord {
  const existing = trackRecords.get(agentProfileId);
  if (existing !== undefined) return existing;
  const trackRecord: AgentTrackRecord = {
    seatsServed: 0,
    committed: 0,
    revealed: 0,
    agreedWithCertificate: 0,
  };
  trackRecords.set(agentProfileId, trackRecord);
  return trackRecord;
}

type PriorRoundPublicRecord = NonNullable<OracleInferenceInput["priorRound"]>;

type SeatResearchConfig =
  | {
      bundleVersion: 3;
      spec: PromptSpecV2;
      policy: ToolPolicyV2;
    }
  | {
      bundleVersion: 4;
      spec: PromptSpecV3;
      policy: ToolPolicyV3;
    }
  | {
      bundleVersion: 5;
      spec: PromptSpecV4;
      policy: ToolPolicyV4;
    };

class ResearchLoopError extends GonkaRunError {
  readonly status: ResearchLoopFailureStatus;
  readonly transcript?: ResearchTranscriptV1;

  constructor(
    status: ResearchLoopFailureStatus,
    message: string,
    attempts: GonkaAttemptRecord[] = [],
    transcript?: ResearchTranscriptV1,
  ) {
    super(message, attempts);
    this.name = "ResearchLoopError";
    this.status = status;
    if (transcript !== undefined) this.transcript = transcript;
  }
}
const DEFAULT_EVIDENCE_POLICY: RetrievalPolicy = {
  maxBytes: 5_000_000,
  maxRedirects: 3,
  timeoutMs: 15_000,
  allowedMime: [
    "text/html",
    "text/plain",
    "application/json",
    "application/pdf",
  ],
};

interface EngineDependencies {
  repository: Repository;
  manifest: ReleaseManifest;
  gateway: SuiGateway;
  walrus: WalrusStore;
  gonka: GonkaRouterAdapter;
  research: ResearchProvider | undefined;
  now: () => number;
  retrieve: NonNullable<EngineConfig["retrieve"]>;
  retrievalPolicy: RetrievalPolicy;
  eventPollIntervalMs: number;
  zkLoginVerifier: ZkLoginVerifier;
  operationalAgentSlots: readonly { address: string; index: number }[];
  sealEscrow: SealEscrowService | undefined;
}

export async function createEngine(
  config: EngineConfig & { sealEscrow?: SealEscrowService },
): Promise<Engine> {
  const manifest = await loadReleaseManifest(config.manifestPath);
  if (manifest.network !== config.network) {
    throw new EngineValidationError(
      `engine network ${config.network} does not match manifest network ${manifest.network}`,
    );
  }
  await migrate(config.db);
  const repository = createRepository(config.db);
  const gateway = resolveGateway(config, manifest);
  const operationalAgentSlots =
    config.signers?.listAgents().map(({ address, index }) => ({ address, index })) ?? [];
  const engine = new OpenVerdictEngine({
    repository,
    manifest,
    gateway,
    walrus: config.walrus,
    gonka: config.gonka,
    research:
      config.research ??
      (manifest.gonka.mode === "fake" ? createFakeResearchProvider() : undefined),
    now: config.now ?? Date.now,
    retrieve: config.retrieve ?? retrieveEvidence,
    retrievalPolicy: config.retrievalPolicy ?? manifestEvidencePolicy(manifest),
    eventPollIntervalMs: config.eventPollIntervalMs ?? 1_000,
    zkLoginVerifier: config.zkLoginVerifier ?? createDefaultZkLoginVerifier(config),
    operationalAgentSlots,
    sealEscrow: config.sealEscrow,
  });
  await engine.initialize(config.initialAgents ?? []);
  return engine;
}

class OpenVerdictEngine implements Engine {
  readonly #repository: Repository;
  readonly #manifest: ReleaseManifest;
  readonly #gateway: SuiGateway;
  readonly #walrus: WalrusStore;
  readonly #gonka: GonkaRouterAdapter;
  readonly #research: ResearchProvider | undefined;
  readonly #now: () => number;
  /** Per-claim chain of votesCommit calls so seats commit as they finish, never concurrently. */
  readonly #commitQueues = new Map<string, Promise<void>>();
  readonly #retrieve: NonNullable<EngineConfig["retrieve"]>;
  readonly #retrievalPolicy: RetrievalPolicy;
  readonly #eventPollIntervalMs: number;
  readonly #zkLoginVerifier: ZkLoginVerifier;
  readonly #operationalAgentSlots: readonly { address: string; index: number }[];
  readonly #sealEscrow: SealEscrowService | undefined;
  #registrationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: EngineDependencies) {
    this.#repository = dependencies.repository;
    this.#manifest = dependencies.manifest;
    this.#gateway = dependencies.gateway;
    this.#walrus = dependencies.walrus;
    this.#gonka = dependencies.gonka;
    this.#research = dependencies.research;
    this.#now = dependencies.now;
    this.#retrieve = dependencies.retrieve;
    this.#retrievalPolicy = dependencies.retrievalPolicy;
    this.#eventPollIntervalMs = dependencies.eventPollIntervalMs;
    this.#zkLoginVerifier = dependencies.zkLoginVerifier;
    this.#operationalAgentSlots = dependencies.operationalAgentSlots;
    this.#sealEscrow = dependencies.sealEscrow;
  }

  async initialize(agents: EngineAgentConfig[]): Promise<void> {
    for (const agent of agents) {
      const timestamp = this.isoNow();
      await this.#repository.saveAgentManifest({
        manifest: agent.manifest,
        role: agent.role,
        ...(agent.agentCapId === undefined ? {} : { agentCapId: agent.agentCapId }),
        active: agent.active ?? true,
        reputation: agent.reputation ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  async factCheckStart(req: FactCheckRequest): Promise<{ claimId: string }> {
    validateFactCheckRequest(req);
    if (process.env.OPENVERDICT_DEBUG_DEADLINES === "1") {
      console.error("FCS req.deadlines:", JSON.stringify(req.deadlines));
    }
    // The public form sends only the statement; every such claim is judged by
    // this one public rubric (the API and CLI may still pass their own).
    const resolutionCriteria =
      req.resolutionCriteria?.trim() ||
      "Decide whether the statement is true as written, as of the claim's evidence cutoff. Weigh evidence for and against from primary sources found through your own research; the submitter's material is context only. Answer YES or NO only when credible sources agree; answer UNSURE when they conflict or are insufficient.";
    const claim = await this.createClaimRecord(
      {
        statement: req.claim.trim(),
        resolutionCriteria,
        mode: CLAIM_MODE.DIRECT_REVIEW,
        // Without explicit deadlines the ladder starts at the create_claim
        // transaction (createClaimRecord), after the request's Walrus writes.
        ...(req.deadlines === undefined ? {} : { deadlines: req.deadlines }),
        committeeBudget: process.env.OPENVERDICT_DEFAULT_COMMITTEE_BUDGET ?? "10000000",
        evidenceBudget: process.env.OPENVERDICT_DEFAULT_EVIDENCE_BUDGET ?? "0",
      },
      {
        directReviewStarted: true,
        submittedText: req.text?.trim(),
        submittedUrls: req.urls,
      },
    );
    await this.ingestFactCheckEvidence(claim, req);
    return { claimId: claim.claimId };
  }

  async registerZkBackedAgent(
    req: ZkBackedRegistrationRequest,
  ): Promise<ZkBackedRegistrationResult> {
    validateZkBackedRegistrationRequest(req, this.#manifest);
    const message = buildZkLoginBackingMessage(
      req.zkLoginAddress,
      this.#manifest.network,
    );

    let verified: boolean;
    try {
      verified = await this.#zkLoginVerifier.verify({
        zkLoginAddress: req.zkLoginAddress,
        message,
        signature: req.signature,
      });
    } catch (error) {
      throw new ZkLoginVerificationError(
        "zkLogin signature verification is temporarily unavailable",
        { cause: error },
      );
    }
    if (!verified) {
      throw new EngineValidationError("zkLogin signature is invalid for the backing message");
    }

    const humanBackingHash = toHex(blake2b256(fromHex(req.zkLoginAddress)));
    return this.withRegistrationLock(() =>
      this.registerVerifiedZkBackedAgent(req, humanBackingHash),
    );
  }

  async claimCreate(req: ClaimCreateRequest): Promise<{ claimId: string; digest: string }> {
    validateClaimCreateRequest(req);
    const claim = await this.createClaimRecord(req, {
      directReviewStarted: false,
      submittedUrls: [],
    });
    return { claimId: claim.claimId, digest: claim.transactionDigest ?? "" };
  }

  async propose(claimId: string, outcome: VoteOutcome): Promise<TxResult> {
    const claim = await this.claim(claimId);
    if (claim.mode !== CLAIM_MODE.OPTIMISTIC_SETTLEMENT || claim.state !== CLAIM_STATE.CREATED) {
      throw new EngineStateError("only a newly-created optimistic claim accepts a proposal");
    }
    const result = await this.#gateway.propose({
      claimId,
      outcome,
      proposerBondAmount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
    });
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.PROPOSED,
      proposedOutcome: outcome,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    });
    await this.emit({
      claimId,
      phase: "PROPOSAL",
      kind: "proposal_submitted",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        outcome: outcomeLabel(outcome),
        transaction_digest: result.digest,
        amount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      },
    });
    return result;
  }

  async challenge(claimId: string, reason: ChallengeReason): Promise<TxResult> {
    const claim = await this.claim(claimId);
    if (claim.state !== CLAIM_STATE.PROPOSED) {
      throw new EngineStateError("only a proposed claim can be challenged");
    }
    if (reason.reason.trim().length === 0) {
      throw new EngineValidationError("challenge reason must not be empty");
    }
    validateHttpsUrls(reason.evidenceUrls);
    const reasonBytes = new TextEncoder().encode(reason.reason.trim());
    const storedReason = await this.#walrus.put(reasonBytes, {
      identifier: `challenge-${claimId}.txt`,
    });
    const result = await this.#gateway.challenge({
      claimId,
      challengerBondAmount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      reasonHash: blake2b256(reasonBytes),
      reasonBlobId: storedReason.blobId,
    });
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.CHALLENGED,
      transactionDigest: result.digest,
    });
    await this.emit({
      claimId,
      phase: "CHALLENGE",
      kind: "challenge_submitted",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        transaction_digest: result.digest,
        reason_blob_id: storedReason.blobId,
        amount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      },
    });
    await Promise.all(
      reason.evidenceUrls.map((url, index) =>
        this.ingestUrl(claim, url, 1, `challenge-${index + 1}`),
      ),
    );
    return result;
  }

  async selectCommittee(claimId: string): Promise<TxResult> {
    let claim = await this.claim(claimId);
    const existing = await this.#repository.getCommitteeForClaim(claimId);
    if (existing !== undefined) {
      await this.acceptOfferedSeats(claimId, 1);
      return {
        digest: existing.randomnessTransactionDigest ?? "already-selected",
        objectIds: {
          committee: existing.committeeId,
          roundTally: existing.roundTallyId,
        },
      };
    }
    if (claim.state === CLAIM_STATE.CREATED && claim.mode === CLAIM_MODE.DIRECT_REVIEW) {
      await this.#gateway.startDirectReview(claimId);
      claim = await this.saveClaim({ ...claim, state: CLAIM_STATE.REVIEW_REQUESTED });
    } else if (claim.state === CLAIM_STATE.CHALLENGED) {
      await this.#gateway.startChallengedReview(claimId);
      claim = await this.saveClaim({ ...claim, state: CLAIM_STATE.REVIEW_REQUESTED });
    }
    if (claim.state !== CLAIM_STATE.REVIEW_REQUESTED) {
      throw new EngineStateError("committee selection requires REVIEW_REQUESTED");
    }

    const result = await this.#gateway.selectCommittee(claimId);
    const timestamp = this.isoNow();
    const committee: CommitteeRecord = {
      committeeId: result.committeeId,
      claimId,
      phase: 1,
      roundTallyId: result.roundTallyId,
      agentProfileIds: result.seats.map((seat) => seat.agentProfileId),
      jurySeatIds: result.seats.map((seat) => seat.jurySeatId),
      reserveAgentProfileIds: result.reserveAgentProfileIds,
      randomnessTransactionDigest: result.digest,
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveCommittee(committee);
    await this.#repository.saveRoundTally(emptyTally(committee, timestamp));

    for (const [index, selected] of result.seats.entries()) {
      await this.ensureAgent(selected.agentProfileId, selected.owner, index, selected.agentCapId);
      await this.#repository.saveJurySeat({
        jurySeatId: selected.jurySeatId,
        claimId,
        committeeId: result.committeeId,
        agentProfileId: selected.agentProfileId,
        agentOwner: selected.owner,
        ...(selected.agentCapId === undefined ? {} : { agentCapId: selected.agentCapId }),
        phase: 1,
        status: "OFFERED",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.COMMIT_1,
      committeeId: result.committeeId,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    });
    await this.emit({
      claimId,
      phase: "COMMIT_1",
      kind: "committee_selected",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        committee_id: result.committeeId,
        first_round_tally_id: result.roundTallyId,
        agent_profile_ids: committee.agentProfileIds,
        jury_seat_ids: committee.jurySeatIds,
        transaction_digest: result.digest,
      },
    });
    await this.acceptOfferedSeats(claimId, 1);
    return result;
  }

  async evidenceFreeze(claimId: string, phase: 1 | 2): Promise<TxResult> {
    const claim = await this.claim(claimId);
    // Move rejects a freeze after the phase window (commit deadline for
    // phase one, discussion deadline for phase two); refuse here, before
    // the manifest upload, so a closed window costs no Walrus write.
    const windowEndMs =
      phase === 1
        ? claim.deadlines.firstCommitDeadlineMs
        : claim.deadlines.discussionDeadlineMs;
    if (this.#now() > windowEndMs) {
      throw new EngineStateError(
        `evidence freeze window for phase ${phase} closed at ${new Date(windowEndMs).toISOString()}`,
      );
    }
    const existing = await this.#repository.getEvidenceManifest(claimId, phase);
    if (existing?.evidenceBundleId) {
      const tally = await this.#repository.getRoundTally(claimId, phase);
      if (tally) {
        await this.bindSeatsToEvidence(
          claimId,
          phase,
          tally.roundTallyId,
          existing.evidenceBundleId,
          existing.root,
        );
      }
      return {
        digest: existing.transactionDigest ?? "already-frozen",
        objectIds: { evidenceBundle: existing.evidenceBundleId },
      };
    }

    let publicRecordArtifact: EvidenceArtifactRecord | undefined;
    let artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 2) {
      const priorRound = await this.roundOnePublicRecord(claimId);
      publicRecordArtifact = await this.ensureRoundOnePublicRecordArtifact(
        claim,
        priorRound,
      );
      artifacts = artifacts.filter(
        (artifact) => artifact.evidenceId !== publicRecordArtifact?.evidenceId,
      );
      if (artifacts.length === 0) {
        artifacts = await this.#repository.listEvidenceArtifacts(claimId, 1);
      }
    }
    artifacts = uniqueEvidenceArtifacts(statementArtifactFirst(artifacts));
    if (publicRecordArtifact) artifacts.push(publicRecordArtifact);
    if (artifacts.length === 0) {
      throw new EngineNoEvidenceError();
    }
    const manifestItems = artifacts.map(toEvidenceManifestItem);
    const built = buildEvidenceManifest(manifestItems);
    const manifestUpload = await this.#walrus.put(
      new TextEncoder().encode(built.manifestJson),
      { identifier: `evidence-${claimId}-${phase}.json` },
    );
    const root = toHex(built.root);
    const policyId = evidencePolicyId(this.#manifest);
    const result = await this.#gateway.freezeEvidence({
      claimId,
      phase,
      root: built.root,
      manifestBlobId: manifestUpload.blobId,
      manifestBlobObjectId: manifestUpload.objectId ?? ZERO_OBJECT_ID,
      sourceCount: artifacts.length,
      policyId: fromHex(policyId),
      walrusEndEpoch: await this.chainRetentionEpoch(manifestUpload.endEpoch),
    });
    const timestamp = this.isoNow();
    const record: EvidenceManifestRecord = {
      manifestId: deterministicId(`manifest:${claimId}:${phase}`),
      claimId,
      phase,
      evidenceBundleId: result.evidenceBundleId,
      root,
      manifestBlobId: manifestUpload.blobId,
      ...(manifestUpload.objectId === undefined
        ? {}
        : { manifestBlobObjectId: manifestUpload.objectId }),
      sourceCount: artifacts.length,
      policyId,
      ...(manifestUpload.endEpoch === undefined
        ? { walrusEndEpoch: MAX_LOCAL_WALRUS_EPOCH }
        : { walrusEndEpoch: manifestUpload.endEpoch }),
      sortedLeaves: artifacts.map((artifact) => artifact.evidenceId).sort(),
      transactionDigest: result.digest,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceManifest(record);

    const tally = await this.#repository.getRoundTally(claimId, phase);
    if (tally !== undefined) {
      await this.#repository.saveRoundTally({ ...tally, evidenceRoot: root, updatedAt: timestamp });
      await this.bindSeatsToEvidence(claimId, phase, tally.roundTallyId, result.evidenceBundleId, root);
    }
    await this.emit({
      claimId,
      phase: `ROUND_${phase}`,
      kind: "evidence_frozen",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      artifactHash: root,
      transaction: result,
      payload: {
        claim_id: claimId,
        phase,
        evidence_bundle_id: result.evidenceBundleId,
        root,
        manifest_blob_id: manifestUpload.blobId,
        transaction_digest: result.digest,
      },
    });
    return result;
  }

  async juryRun(claimId: string, phase: 1 | 2): Promise<JuryRunReport> {
    const claim = await this.claim(claimId);
    const evidence = await this.requiredEvidenceManifest(claimId, phase);
    const committee = await this.requiredCommittee(claimId);
    const seats = await this.#repository.listJurySeats(claimId, phase);
    if (seats.length !== 5) throw new EngineStateError("jury run requires five selected seats");
    const priorRound =
      phase === 2 ? await this.roundOnePublicRecord(claimId) : undefined;
    const researchConfigs = new Map<string, SeatResearchConfig>();
    for (const seat of seats) {
      const agent = await this.requiredAgent(seat.agentProfileId);
      if (
        agent.manifest.version === "3" ||
        agent.manifest.version === "4" ||
        agent.manifest.version === "5"
      ) {
        const document = await this.agentManifestDocument(seat.agentProfileId);
        if (
          document === null ||
          document.version !== agent.manifest.version ||
          (document.version !== "3" &&
            document.version !== "4" &&
            document.version !== "5")
        ) {
          throw new EngineValidationError(
            `agent ${seat.agentProfileId} manifest document is missing or has the wrong version`,
          );
        }
        this.assertResearchManifestHashes(agent.manifest, document);
        let researchConfig: SeatResearchConfig;
        if (document.version === "5") {
          researchConfig = {
            bundleVersion: 5,
            spec: document.promptSpec,
            policy: document.toolPolicy,
          };
        } else if (document.version === "4") {
          researchConfig = {
            bundleVersion: 4,
            spec: document.promptSpec,
            policy: document.toolPolicy,
          };
        } else {
          researchConfig = {
            bundleVersion: 3,
            spec: document.promptSpec,
            policy: document.toolPolicy,
          };
        }
        researchConfigs.set(seat.agentProfileId, researchConfig);
        continue;
      }

      // Older synthetic manifests have no stored document. Keep their v2
      // binding path unchanged for local fixtures and migration tooling.
      const spec = this.#gonka.promptSpec();
      const policy = this.#gonka.toolPolicy();
      const liveHash = promptSpecHash(spec);
      const liveToolPolicyHash = toolPolicyHash(policy);
      if (agent.manifest.promptHash !== liveHash) {
        throw new EngineValidationError(
          `agent ${seat.agentProfileId} manifest prompt hash ${agent.manifest.promptHash} does not match the engine prompt spec ${liveHash}; run pnpm tsx scripts/publish-agent-manifests.ts`,
        );
      }
      if (agent.manifest.toolPolicyHash !== liveToolPolicyHash) {
        throw new EngineValidationError(
          `agent ${seat.agentProfileId} manifest tool policy hash ${agent.manifest.toolPolicyHash} does not match the engine tool policy ${liveToolPolicyHash}; run pnpm tsx scripts/publish-agent-manifests.ts`,
        );
      }
      researchConfigs.set(seat.agentProfileId, {
        bundleVersion: 3,
        spec,
        policy,
      });
    }
    const research = this.#research;
    if (!research) {
      throw new EngineValidationError("research provider not configured");
    }
    // approve_run and commit_vote need the seat bound to the frozen evidence
    // (jury.move E_EVIDENCE_NOT_BOUND). Binds are agent-signed and can fail;
    // retry them here every tick and let an unbound seat wait for the next
    // tick instead of failing it closed.
    if (evidence.evidenceBundleId) {
      const tally = await this.requiredTally(claimId, phase);
      await this.bindSeatsToEvidence(
        claimId,
        phase,
        tally.roundTallyId,
        evidence.evidenceBundleId,
        evidence.root,
      );
    }
    const boundSeats = (await this.#repository.listJurySeats(claimId, phase)).filter(
      (seat) => seat.evidenceBound,
    );
    if (boundSeats.length < seats.length) {
      process.stderr.write(
        `jury run: claim ${claimId.slice(0, 10)}…: ${seats.length - boundSeats.length} seat(s) not yet bound, running the rest\n`,
      );
    }
    const artifacts = await this.artifactsForPhase(claimId, phase);
    const searchCache = createSearchCache();
    const storedPageCache = new Map<string, Promise<PageStorePage>>();
    // Background Walrus writes of discovered pages, keyed by evidence id.
    const pageUploads = new Map<string, Promise<void>>();
    // Every seat must finish early enough for the lock, the approvals and
    // the commits to land before the commit deadline; a seat past this point
    // fails closed while its committee mates still commit (4 of 5 settle).
    const commitDeadlineMs =
      phase === 1
        ? claim.deadlines.firstCommitDeadlineMs
        : claim.deadlines.secondCommitDeadlineMs;
    const seatDeadlineMs = commitDeadlineMs - SEAT_COMMIT_MARGIN_MS;
    const commitFloorMs = acceptanceFloorMs(committee, phase, commitDeadlineMs);

    // Commit pump: the chain allows lock_committee only from the acceptance
    // floor, seats finish at different times, and the slowest seat must not
    // decide when the others commit. From the floor until the deadline, push
    // the queued commit every few seconds while seats are still running.
    let seatsDone = false;
    let signalSeatsDone: () => void = () => undefined;
    const seatsSettled = new Promise<void>((resolve) => {
      signalSeatsDone = resolve;
    });
    const pump = (async () => {
      while (!seatsDone) {
        await Promise.race([seatsSettled, sleep(COMMIT_PUMP_INTERVAL_MS)]);
        if (seatsDone) break;
        const now = this.#now();
        if (now < commitFloorMs || now > commitDeadlineMs) continue;
        await this.queueCommit(claimId, phase);
      }
    })();

    try {
      await Promise.all(
        boundSeats.map(async (seat) => {
          const existing = (await this.#repository.listInferenceRuns(claimId, phase)).find(
            (run) => run.jurySeatId === seat.jurySeatId,
          );
          if (existing !== undefined) return;
          const researchConfig = researchConfigs.get(seat.agentProfileId);
          if (researchConfig === undefined) {
            throw new EngineValidationError(
              `agent ${seat.agentProfileId} has no validated research configuration`,
            );
          }
          await this.runSeat(
            claim,
            committee,
            seat,
            evidence,
            artifacts,
            priorRound,
            research,
            searchCache,
            storedPageCache,
            pageUploads,
            researchConfig,
            seatDeadlineMs,
            commitFloorMs,
          );
        }),
      );
    } finally {
      seatsDone = true;
      signalSeatsDone();
    }
    await pump;
    // Let background page uploads finish inside this tick; failures were
    // already attributed to the seats that cited those pages.
    await Promise.allSettled([...pageUploads.values()]);
    await this.#commitQueues.get(claimId);
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    return {
      claimId,
      phase,
      runs: runs.map(toAgentRunSummary),
    };
  }

  async votesCommit(claimId: string, phase: 1 | 2): Promise<TxResult[]> {
    const claim = await this.claim(claimId);
    assertCommitState(claim.state, phase);
    const committee = await this.requiredCommittee(claimId);
    const tally = await this.requiredTally(claimId, phase);
    if (!committee.locked) {
      await this.#gateway.lockCommittee({
        claimId,
        committeeId: committee.committeeId,
        roundTallyId: tally.roundTallyId,
      });
      await this.#repository.saveCommittee({
        ...committee,
        locked: true,
        updatedAt: this.isoNow(),
      });
    }
    const existingPackages = await this.#repository.listVotePackages(claimId, phase);
    const existingBySeat = new Map(existingPackages.map((item) => [item.jurySeatId, item]));
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    const validRuns = runs.filter(
      (run) => run.validationStatus === "SCHEMA_VALID" && run.output && run.runHash,
    );
    const results: TxResult[] = [];

    for (const run of validRuns) {
      const existing = existingBySeat.get(run.jurySeatId);
      if (existing?.committed) {
        results.push({ digest: existing.commitmentTransactionDigest ?? "already-committed" });
        continue;
      }
      const output = run.output;
      const runHash = run.runHash;
      if (!output || !runHash) continue;
      const approval = await this.#repository.getRunApproval(run.runId);
      if (!approval || approval.consumed) continue;
      const outcome = outcomeCode(output.outcome);
      const salt = randomBytes(32);
      const commitment = toHex(
        computeVoteCommitment({
          claim_id: claimId,
          agent_profile_id: run.agentProfileId,
          jury_seat_id: run.jurySeatId,
          phase,
          outcome,
          confidence_bps: output.confidenceBps,
          evidence_root: fromHex(run.evidenceRoot),
          output_hash: fromHex(run.outputHash),
          run_hash: fromHex(runHash),
          salt,
        }),
      );
      const result = await this.#gateway.commitVote({
        jurySeatId: run.jurySeatId,
        roundTallyId: tally.roundTallyId,
        agentProfileId: run.agentProfileId,
        runApprovalId: approval.runApprovalId,
        commitment: fromHex(commitment),
      });
      const timestamp = this.isoNow();
      // TODO: V1 local recovery stores plaintext hex. Encrypt salts before production.
      const votePackage: VotePackageRecord = {
        votePackageId: deterministicId(`vote:${claimId}:${phase}:${run.jurySeatId}`),
        claimId,
        phase,
        jurySeatId: run.jurySeatId,
        agentProfileId: run.agentProfileId,
        runId: run.runId,
        outcome,
        confidenceBps: output.confidenceBps,
        evidenceRoot: run.evidenceRoot,
        outputHash: run.outputHash,
        runHash,
        commitment,
        saltHex: toHex(salt),
        commitmentTransactionDigest: result.digest,
        committed: true,
        revealed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveVotePackage(votePackage);
      await this.#repository.saveRunApproval({
        ...approval,
        consumed: true,
        updatedAt: timestamp,
      });
      await this.updateSeat(run.jurySeatId, { status: "COMMITTED", commitment, runHash });
      await this.emit({
        claimId,
        phase: `COMMIT_${phase}`,
        kind: "vote_committed",
        source: "SUI",
        visibility: "PUBLIC_NOW",
        actorId: run.agentProfileId,
        runId: run.runId,
        transaction: result,
        payload: {
          claim_id: claimId,
          phase,
          agent_profile_id: run.agentProfileId,
          jury_seat_id: run.jurySeatId,
          transaction_digest: result.digest,
        },
      });
      results.push(result);
    }
    return results;
  }

  async votesReveal(claimId: string, phase: 1 | 2): Promise<TxResult[]> {
    const claim = await this.claim(claimId);
    assertRevealState(claim.state, phase);
    const tally = await this.requiredTally(claimId, phase);
    const packages = await this.#repository.listVotePackages(claimId, phase);
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const results: TxResult[] = [];
    let updatedTally = tally;

    // Publish every bundle first, in parallel (each Walrus write takes seconds
    // and the reveal window is short), then reveal on chain one seat at a
    // time because all reveals share the operator signer.
    const pending = packages.flatMap((votePackage) => {
      if (!votePackage.committed || votePackage.revealed) return [];
      const run = runById.get(votePackage.runId);
      if (
        !run?.output ||
        !run.runHash ||
        !run.sealKeyHex ||
        !run.sealIvHex ||
        !run.coreHash ||
        !run.sealedBlobId ||
        !run.audit.bundleCore
      ) {
        return [];
      }
      const core = JSON.parse(
        run.audit.bundleCore,
      ) as PublicRunBundleCore;
      const bundle: PublicRunBundle = {
        ...core,
        seal: {
          algorithm: "AES-256-GCM",
          keyHex: run.sealKeyHex,
          ivHex: run.sealIvHex,
          aad: run.runId,
          sealedBlobId: run.sealedBlobId,
          coreHash: run.coreHash,
        },
      };
      return [{ votePackage, run, output: run.output, bundle }];
    });
    const uploads = await Promise.all(
      pending.map(async ({ run, bundle }): Promise<WalrusPutResult | undefined> => {
        try {
          return await this.#walrus.put(canonicalJsonBytes(bundle), {
            identifier: `${run.runId}-run-bundle.json`,
          });
        } catch {
          // A failed publication must not consume the on-chain reveal opportunity.
          return undefined;
        }
      }),
    );

    // Reveal on chain in parallel: every seat transaction is signed and paid
    // by its own agent, so seats never contend on gas (two seats of one
    // agent stay sequential), and a failed reveal must not stop its
    // siblings; the shared bookkeeping below runs in order afterwards.
    type RevealWork = (typeof pending)[number] & {
      upload: WalrusPutResult | undefined;
      result?: Awaited<ReturnType<SuiGateway["revealVote"]>>;
    };
    const work: RevealWork[] = pending.map((entry, index) => ({
      ...entry,
      upload: uploads[index],
    }));
    const byAgent = new Map<string, RevealWork[]>();
    for (const item of work) {
      if (!item.upload) continue;
      const list = byAgent.get(item.votePackage.agentProfileId) ?? [];
      list.push(item);
      byAgent.set(item.votePackage.agentProfileId, list);
    }
    const failures: unknown[] = [];
    await Promise.all(
      [...byAgent.values()].map(async (items) => {
        for (const item of items) {
          const { votePackage, upload } = item;
          if (!upload) continue;
          try {
            item.result = await this.#gateway.revealVote({
              jurySeatId: votePackage.jurySeatId,
              roundTallyId: tally.roundTallyId,
              agentProfileId: votePackage.agentProfileId,
              outcome: votePackage.outcome,
              confidenceBps: votePackage.confidenceBps,
              outputHash: fromHex(votePackage.outputHash),
              runHash: fromHex(votePackage.runHash),
              salt: fromHex(votePackage.saltHex),
              argumentBlobId: upload.blobId,
              argumentBlobObjectId: upload.objectId ?? ZERO_OBJECT_ID,
              argumentWalrusEndEpoch: await this.chainRetentionEpoch(upload.endEpoch),
            });
          } catch (error) {
            failures.push(error);
          }
        }
      }),
    );

    for (const { votePackage, run, output, upload: argumentUpload, result } of work) {
      if (!argumentUpload || !result) continue;
      const timestamp = this.isoNow();
      await this.#repository.saveInferenceRun({
        ...run,
        revealedBlobId: argumentUpload.blobId,
        ...(argumentUpload.objectId === undefined
          ? {}
          : { revealedObjectId: argumentUpload.objectId }),
        updatedAt: timestamp,
      });
      const reveal: RevealRecord = {
        revealedVoteId: result.revealedVoteId,
        votePackageId: votePackage.votePackageId,
        claimId,
        phase,
        roundTallyId: tally.roundTallyId,
        jurySeatId: votePackage.jurySeatId,
        agentProfileId: votePackage.agentProfileId,
        runId: votePackage.runId,
        outcome: votePackage.outcome,
        confidenceBps: votePackage.confidenceBps,
        valid: true,
        transactionDigest: result.digest,
        ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveReveal(reveal);
      await this.#repository.saveVotePackage({
        ...votePackage,
        revealed: true,
        updatedAt: timestamp,
      });
      updatedTally = addRevealToTally(updatedTally, reveal);
      await this.#repository.saveRoundTally(updatedTally);
      await this.updateSeat(votePackage.jurySeatId, { status: "REVEALED" });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "vote_revealed",
        source: "SUI",
        visibility: "PUBLIC_NOW",
        actorId: votePackage.agentProfileId,
        runId: votePackage.runId,
        transaction: result,
        payload: {
          claim_id: claimId,
          phase,
          round_tally_id: tally.roundTallyId,
          agent_profile_id: votePackage.agentProfileId,
          jury_seat_id: votePackage.jurySeatId,
          revealed_vote_id: result.revealedVoteId,
          outcome: outcomeLabel(votePackage.outcome),
          confidence_bps: votePackage.confidenceBps,
          valid: true,
          transaction_digest: result.digest,
        },
      });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "inference_completed",
        source: "GONKA_ROUTER",
        visibility: "PUBLIC_AFTER_REVEAL",
        actorId: run.agentProfileId,
        runId: run.runId,
        occurredAt: run.completedAt,
        publishedAt: timestamp,
        artifactHash: run.outputHash,
        payload: {
          run_id: run.runId,
          gonka_request_id: run.gonkaRequestId,
          model_id: run.modelId,
          latency_ms: run.latencyMs,
          schema_status: run.validationStatus,
          token_usage: {
            input: run.inputTokens,
            output: run.outputTokens,
          },
          output: run.output,
        },
      });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "argument_published",
        source: "GONKA_ROUTER",
        visibility: "PUBLIC_AFTER_REVEAL",
        actorId: votePackage.agentProfileId,
        runId: votePackage.runId,
        artifactHash: run.outputHash,
        payload: {
          claim_id: claimId,
          phase,
          agent_id: votePackage.agentProfileId,
          gonka_request_id: run.gonkaRequestId,
          argument_hash: run.outputHash,
          reasoning_trace_hash: hashCanonicalJson(output.publicReasoningTrace),
          evidence_ids: citedEvidenceIds(output),
          reasoning: output.reasoning,
          public_reasoning_trace: output.publicReasoningTrace,
        },
      });
      results.push(result);
    }
    // Surface a lost seat only after every other seat's reveal is recorded.
    if (failures.length > 0) throw failures[0];
    return results;
  }

  async advance(claimId: string): Promise<TxResult | null> {
    const claim = await this.claim(claimId);
    if (
      claim.state === CLAIM_STATE.REVIEW_REQUESTED ||
      claim.state === CLAIM_STATE.CHALLENGED ||
      (claim.state === CLAIM_STATE.CREATED && claim.mode === CLAIM_MODE.DIRECT_REVIEW)
    ) {
      return this.selectCommittee(claimId);
    }
    if (claim.state === CLAIM_STATE.COMMIT_1 || claim.state === CLAIM_STATE.COMMIT_2) {
      const phase = claim.state === CLAIM_STATE.COMMIT_1 ? 1 : 2;
      const tally = await this.requiredTally(claimId, phase);
      const result = await this.#gateway.advancePhase(claimId, tally.roundTallyId);
      const next = phase === 1 ? CLAIM_STATE.REVEAL_1 : CLAIM_STATE.REVEAL_2;
      await this.changePhase(claim, next, result);
      return result;
    }
    if (claim.state === CLAIM_STATE.REVEAL_1) {
      const tally = await this.requiredTally(claimId, 1);
      if (thresholdOutcome(tally) !== null) return null;
      const result = await this.#gateway.openDiscussion({
        claimId,
        firstRoundTallyId: tally.roundTallyId,
      });
      await this.#repository.saveRoundTally({ ...tally, closed: true, updatedAt: this.isoNow() });
      await this.changePhase(claim, CLAIM_STATE.DISCUSSION, result);
      return result;
    }
    if (claim.state === CLAIM_STATE.DISCUSSION) {
      const evidence = await this.#repository.getEvidenceManifest(claimId, 2);
      const evidenceBundleId = evidence?.evidenceBundleId;
      if (!evidenceBundleId) {
        throw new EngineStateError(
          "phase-two evidence must be frozen before the discussion deadline",
        );
      }
      if (!evidence) throw new EngineStateError("phase-two evidence manifest is missing");
      const committee = await this.requiredCommittee(claimId);
      const firstTally = await this.requiredTally(claimId, 1);
      const result = await this.#gateway.createSecondRound({
        claimId,
        committeeId: committee.committeeId,
        firstRoundTallyId: firstTally.roundTallyId,
      });
      const timestamp = this.isoNow();
      const phaseTwoCommittee: CommitteeRecord = {
        ...committee,
        phase: 2,
        roundTallyId: result.roundTallyId,
        jurySeatIds: result.seats.map((seat) => seat.jurySeatId),
        updatedAt: timestamp,
      };
      await this.#repository.saveCommittee(phaseTwoCommittee);
      await this.#repository.saveRoundTally(emptyTally(phaseTwoCommittee, timestamp));
      for (const selected of result.seats) {
        await this.#repository.saveJurySeat({
          jurySeatId: selected.jurySeatId,
          claimId,
          committeeId: committee.committeeId,
          agentProfileId: selected.agentProfileId,
          agentOwner: selected.owner,
          ...(selected.agentCapId === undefined ? {} : { agentCapId: selected.agentCapId }),
          phase: 2,
          status: "ACCEPTED",
          evidenceRoot: evidence.root,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      // The chain is in COMMIT_2 as soon as the transaction lands; record
      // that before the agent-signed binds, which may fail and are retried
      // by juryRun. Otherwise a failed bind left the database in DISCUSSION
      // and every later advance aborted with E_INVALID_CLAIM_STATE.
      await this.changePhase(claim, CLAIM_STATE.COMMIT_2, result);
      await this.bindSeatsToEvidence(
        claimId,
        2,
        result.roundTallyId,
        evidenceBundleId,
        evidence.root,
      );
      return result;
    }
    return null;
  }

  async finalize(claimId: string): Promise<FinalizeReport> {
    const claim = await this.claim(claimId);
    const existing = await this.#repository.getResolutionCertificate(claimId);
    if (existing) return certificateToFinalizeReport(existing);
    if (claim.state === CLAIM_STATE.PROPOSED && claim.proposedOutcome !== undefined) {
      const chain = await this.#gateway.finalizeUnchallenged(claimId);
      const result =
        claim.proposedOutcome === OUTCOME.UNSURE
          ? "UNRESOLVED"
          : outcomeLabel(claim.proposedOutcome);
      return this.persistFinalization(claim, chain, result, null, 1, []);
    }
    const phase = claim.state === CLAIM_STATE.REVEAL_1 ? 1 : claim.state === CLAIM_STATE.REVEAL_2 ? 2 : null;
    if (phase === null) throw new EngineStateError("claim is not in a finalizable reveal phase");
    const tally = await this.requiredTally(claimId, phase);
    const threshold = thresholdOutcome(tally);
    if (phase === 1 && threshold === null) {
      throw new EngineStateError("round one has no threshold; advance to discussion");
    }
    const result =
      threshold === null || threshold === OUTCOME.UNSURE
        ? "UNRESOLVED"
        : outcomeLabel(threshold);
    const reveals = await this.#repository.listReveals(claimId, phase);
    const truthScoreBps = computeTruthScoreBps(
      reveals.filter((reveal) => reveal.valid).map((reveal) => ({
        outcome: reveal.outcome,
        confidenceBps: reveal.confidenceBps,
      })),
    );
    const committee = await this.requiredCommittee(claimId);
    const evidence = await this.requiredEvidenceManifest(claimId, phase);
    if (!evidence.evidenceBundleId) throw new EngineStateError("evidence bundle is missing");
    const chain = await this.#gateway.finalize({
      claimId,
      committeeId: committee.committeeId,
      roundTallyId: tally.roundTallyId,
      evidenceBundleId: evidence.evidenceBundleId,
    });
    return this.persistFinalization(
      claim,
      chain,
      result,
      truthScoreBps,
      phase,
      reveals.map((reveal) => reveal.revealedVoteId),
    );
  }

  async inspect(claimId: string, opts: { verify?: boolean } = {}): Promise<ClaimInspection> {
    const claim = await this.claim(claimId);
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    const manifests = await this.evidenceManifests(claimId);
    const packages = [
      ...(await this.#repository.listVotePackages(claimId, 1)),
      ...(await this.#repository.listVotePackages(claimId, 2)),
    ];
    const tallies = (
      await Promise.all([
        this.#repository.getRoundTally(claimId, 1),
        this.#repository.getRoundTally(claimId, 2),
      ])
    ).filter((tally): tally is RoundTallyRecord => tally !== undefined);
    const seats = [
      ...(await this.#repository.listJurySeats(claimId, 1)),
      ...(await this.#repository.listJurySeats(claimId, 2)),
    ];
    const packageBySeat = new Map(packages.map((item) => [item.jurySeatId, item]));
    const reveals = await this.#repository.listReveals(claimId);
    const revealBySeat = new Map(reveals.map((reveal) => [reveal.jurySeatId, reveal]));
    // A seat that failed before committing keeps a failure record on its run
    // row; the claim page marks the seat from it without loading the proof.
    const failureBySeat = new Map(
      (await this.#repository.listInferenceRuns(claimId))
        .filter((run) => run.failure !== undefined)
        .map((run) => [run.jurySeatId, run.failure?.status ?? "PROVIDER_ERROR"]),
    );
    // Each seat's model comes from its agent's registered manifest, so juror
    // identity (and the canvas family mascot) resolves even for seats that
    // failed before any inference completed.
    const modelByAgent = new Map<string, string>();
    for (const agentProfileId of new Set(seats.map((seat) => seat.agentProfileId))) {
      const manifest = await this.#repository.getAgentManifest(agentProfileId);
      const modelId = manifest?.manifest.modelId;
      if (modelId !== undefined) modelByAgent.set(agentProfileId, modelId);
    }
    const commitments: CommitmentStatus[] = seats.map((seat) => {
      const item = packageBySeat.get(seat.jurySeatId);
      const reveal = revealBySeat.get(seat.jurySeatId);
      const failureStatus = failureBySeat.get(seat.jurySeatId);
      const modelId = modelByAgent.get(seat.agentProfileId);
      return {
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        ...(modelId === undefined ? {} : { modelId }),
        committed: item?.committed ?? false,
        revealed: item?.revealed ?? false,
        ...(reveal === undefined
          ? {}
          : { outcome: reveal.outcome, confidenceBps: reveal.confidenceBps }),
        ...(failureStatus !== undefined && !(item?.committed ?? false)
          ? { failureStatus }
          : {}),
      };
    });
    const rounds = tallies.map((tally) => ({
      phase: tally.phase,
      expectedJurySeatIds: tally.expectedJurySeatIds,
      committedJurySeatIds: tally.expectedJurySeatIds.filter(
        (jurySeatId) => packageBySeat.get(jurySeatId)?.committed,
      ),
      revealedJurySeatIds: tally.revealedJurySeatIds,
    }));
    const result = await this.#repository.getResolutionCertificate(claimId);
    const inspection: ClaimInspection = {
      claimId,
      mode: claim.mode,
      state: claim.state,
      statement: claim.statement,
      resolutionCriteria: claim.resolutionCriteria,
      deadlines: claim.deadlines,
      ...(claim.proposedOutcome === undefined
        ? {}
        : { proposedOutcome: outcomeLabel(claim.proposedOutcome) }),
      ...(committee === undefined ? {} : { committeeId: committee.committeeId }),
      evidenceRoots: manifests.map((manifest) => ({
        phase: manifest.phase,
        root: manifest.root,
        bundleId: manifest.evidenceBundleId ?? "",
      })),
      commitments,
      rounds,
      ...(result === undefined ? {} : { result: certificateToFinalizeReport(result) }),
    };
    if (opts.verify) inspection.verification = await this.verifyClaim(claim, manifests, packages, result);
    return inspection;
  }

  async report(claimId: string): Promise<FactCheckReport> {
    const claim = await this.claim(claimId);
    const certificate = await this.#repository.getResolutionCertificate(claimId);
    const finalPhase = certificate?.finalPhase ?? (claim.state >= CLAIM_STATE.COMMIT_2 ? 2 : 1);
    const reveals = await this.#repository.listReveals(claimId, finalPhase);
    const runs = await this.#repository.listInferenceRuns(claimId, finalPhase);
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const agentsById = new Map<string, AgentManifestRecord>(
      (await this.#repository.listAgentManifests()).map((agent) => [
        agent.manifest.agentProfileId,
        agent,
      ]),
    );
    const agents: AgentCard[] = reveals.flatMap((reveal) => {
      const run = runById.get(reveal.runId);
      const agent = agentsById.get(reveal.agentProfileId);
      if (!run?.output || !agent) return [];
      return [toAgentCard(reveal, { ...run, output: run.output }, agent)];
    });
    const artifacts = await this.#repository.listEvidenceArtifacts(claimId);
    const evidence = await this.#repository.getEvidenceManifest(claimId, finalPhase);
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    const approvals = await this.#repository.listRunApprovals(claimId);
    const votePackages = [
      ...(await this.#repository.listVotePackages(claimId, 1)),
      ...(await this.#repository.listVotePackages(claimId, 2)),
    ];
    const truthScoreBps = certificate?.truthScoreBps ?? null;
    return {
      claimId,
      statement: claim.statement,
      submittedUrls: claim.submittedUrls,
      label: certificate?.result ?? "PENDING",
      truthScore: truthScoreBps === null ? null : truthScoreBps / 100,
      truthScoreFormula:
        "mean(YES confidence, NO (10000-confidence), UNSURE 5000), rounded half-up; displayed as basis-points / 100",
      finalRoundVotes: reveals.map((reveal) => ({
        outcome: outcomeLabel(reveal.outcome),
        confidenceBps: reveal.confidenceBps,
      })),
      agents,
      evidence: artifacts.map((artifact) => ({
        evidenceId: artifact.evidenceId,
        sourceUrl: artifact.sourceUrl,
        blobId: artifact.canonicalWalrusBlobId,
        contentHash: artifact.contentHash,
      })),
      ...(evidence === undefined ? {} : { evidenceRoot: evidence.root }),
      sui: {
        claimObjectId: claimId,
        ...(committee === undefined ? {} : { committeeId: committee.committeeId }),
        ...(certificate === undefined ? {} : { certificateId: certificate.certificateId }),
        revealedVoteIds: reveals.map((reveal) => reveal.revealedVoteId),
      },
      auditBundle: {
        version: 1,
        claim: {
          claimId,
          packageId: claim.packageId,
          transactionDigest: claim.transactionDigest,
        },
        committee:
          committee === undefined
            ? null
            : {
                committeeId: committee.committeeId,
                roundTallyId: committee.roundTallyId,
                agentProfileIds: committee.agentProfileIds,
                jurySeatIds: committee.jurySeatIds,
                transactionDigest: committee.randomnessTransactionDigest,
              },
        evidence: (await this.evidenceManifests(claimId)).map((manifest) => ({
          phase: manifest.phase,
          root: manifest.root,
          manifestBlobId: manifest.manifestBlobId,
          evidenceBundleId: manifest.evidenceBundleId,
        })),
        evidenceArtifacts: artifacts.map((artifact) => ({
          evidenceId: artifact.evidenceId,
          contentHash: artifact.contentHash,
          canonicalHash: artifact.canonicalHash,
          rawWalrusBlobId: artifact.rawWalrusBlobId,
          canonicalWalrusBlobId: artifact.canonicalWalrusBlobId,
        })),
        runs: reveals.flatMap((reveal) => {
          const run = runById.get(reveal.runId);
          return run
            ? [{
                runId: run.runId,
                agentProfileId: run.agentProfileId,
                gonkaRequestId: run.gonkaRequestId,
                promptHash: run.promptHash,
                inputHash: run.inputHash,
                outputHash: run.outputHash,
                runHash: run.runHash,
                runWalrusBlobId: run.runWalrusBlobId,
                toolTranscriptHash: run.toolTranscriptHash,
                toolTranscriptWalrusBlobId: run.toolTranscriptWalrusBlobId,
              }]
            : [];
        }),
        runApprovals: approvals.map((approval) => ({
          runApprovalId: approval.runApprovalId,
          runId: approval.runId,
          runHash: approval.runHash,
          transactionDigest: approval.transactionDigest,
        })),
        commitments: votePackages.map((item) => ({
          votePackageId: item.votePackageId,
          phase: item.phase,
          jurySeatId: item.jurySeatId,
          agentProfileId: item.agentProfileId,
          commitment: item.commitment,
          transactionDigest: item.commitmentTransactionDigest,
          revealed: item.revealed,
        })),
        reveals: reveals.map((reveal) => ({
          revealedVoteId: reveal.revealedVoteId,
          runId: reveal.runId,
          transactionDigest: reveal.transactionDigest,
        })),
        certificate: certificate ?? null,
      },
    };
  }

  async listClaims(filter: { state?: ClaimRecord["state"] } = {}): Promise<ClaimInspection[]> {
    const claims = await this.#repository.listClaims(filter.state);
    return Promise.all(claims.map((claim) => this.inspect(claim.claimId)));
  }

  async listAgents(): Promise<AgentDirectoryEntry[]> {
    const [agents, jurySeats, votePackages, reveals, certificates, payoutTickets] =
      await Promise.all([
        this.#repository.listAgentManifests(),
        this.#repository.listAllJurySeats(),
        this.#repository.listAllVotePackages(),
        this.#repository.listAllReveals(),
        this.#repository.listAllResolutionCertificates(),
        this.#repository.listAllPayoutTickets(),
      ]);
    const trackRecords = new Map<string, AgentTrackRecord>();
    for (const seat of jurySeats) {
      trackRecordFor(trackRecords, seat.agentProfileId).seatsServed += 1;
    }
    for (const votePackage of votePackages) {
      const trackRecord = trackRecordFor(trackRecords, votePackage.agentProfileId);
      if (votePackage.committed) trackRecord.committed += 1;
      if (votePackage.revealed) trackRecord.revealed += 1;
    }
    const certificateByClaim = new Map(
      certificates.map((certificate) => [certificate.claimId, certificate]),
    );
    for (const reveal of reveals) {
      if (!reveal.valid) continue;
      const certificate = certificateByClaim.get(reveal.claimId);
      if (
        certificate !== undefined &&
        outcomeLabel(reveal.outcome) === certificate.result
      ) {
        trackRecordFor(trackRecords, reveal.agentProfileId).agreedWithCertificate += 1;
      }
    }
    const earnedMistByOwner = new Map<string, bigint>();
    for (const payoutTicket of payoutTickets) {
      if (payoutTicket.reason !== JURY_REWARD_REASON) continue;
      const owner = payoutTicket.recipient.toLowerCase();
      earnedMistByOwner.set(
        owner,
        (earnedMistByOwner.get(owner) ?? 0n) + BigInt(payoutTicket.amount),
      );
    }

    return agents.map((record) => ({
      agentProfileId: record.manifest.agentProfileId,
      owner: record.manifest.owner,
      modelId: record.manifest.modelId,
      role: record.role,
      manifestHash: record.manifest.manifestHash,
      active: record.active,
      reputation: record.reputation,
      backing: agentBackingStatus(record.manifest.humanVerificationProvider),
      trackRecord: trackRecordFor(trackRecords, record.manifest.agentProfileId),
      earnedMist: String(
        earnedMistByOwner.get(record.manifest.owner.toLowerCase()) ?? 0n,
      ),
    }));
  }

  /** Proof persistence surface consumed by lib/verify/public-run-proof. */
  async getStoredRunProof(runId: string): Promise<RunProofRecord | undefined> {
    return this.#repository.getRunProof(runId);
  }

  async saveStoredRunProof(
    record: RunProofRecord,
    options: { replace: boolean },
  ): Promise<void> {
    if (options.replace) await this.#repository.replaceRunProof(record);
    else await this.#repository.saveRunProof(record);
  }

  /** Builds and stores every revealed run's proof, strictly one at a time. */
  private async warmRunProofs(claimId: string): Promise<void> {
    // The warmer runs detached from finalize, so nothing here may ever
    // reject: a torn-down store (tests, shutdown) only logs and stops.
    try {
      const reveals = [
        ...(await this.#repository.listReveals(claimId, 1)),
        ...(await this.#repository.listReveals(claimId, 2)),
      ];
      for (const reveal of reveals) {
        try {
          await getOrBuildPublicRunProof(this, claimId, reveal.runId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `run proof warm: claim ${claimId} run ${reveal.runId} failed: ${message}\n`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`run proof warm: claim ${claimId} failed: ${message}\n`);
    }
  }

  async runProof(claimId: string, runId: string): Promise<RunProofResult> {
    const claim = await this.claim(claimId);
    const run = (await this.#repository.listInferenceRuns(claimId)).find(
      (candidate) => candidate.runId === runId,
    );
    if (!run) {
      throw new EngineValidationError(
        `inference run ${runId} was not found for claim ${claimId}`,
      );
    }
    const common = {
      runId: run.runId,
      claimId: run.claimId,
      phase: run.phase,
      agentProfileId: run.agentProfileId,
      jurySeatId: run.jurySeatId,
      promptHash: run.promptHash,
      inputHash: run.inputHash,
      outputHash: run.outputHash,
      gateway: {
        ...(run.audit.gatewayRequestId === undefined
          ? {}
          : { gatewayRequestId: run.audit.gatewayRequestId }),
        ...(run.audit.devshardId === undefined
          ? {}
          : { devshardId: run.audit.devshardId }),
        ...(run.audit.systemFingerprint === undefined
          ? {}
          : { systemFingerprint: run.audit.systemFingerprint }),
      },
      claimDeadlines: {
        firstRevealDeadlineMs: claim.deadlines.firstRevealDeadlineMs,
        secondRevealDeadlineMs: claim.deadlines.secondRevealDeadlineMs,
      },
      ...(this.#manifest.seal === undefined
        ? {}
        : {
            sealPolicy: {
              packageId: this.#manifest.seal.packageId as `0x${string}`,
              threshold: this.#manifest.seal.threshold,
              keyServers: this.#manifest.seal.keyServers.map((server) => ({
                ...server,
                objectId: server.objectId as `0x${string}`,
              })),
            },
          }),
    };
    if (run.failure) {
      return {
        ...common,
        runHash: null,
        sealedBlobId: null,
        sealed: null,
        revealedBlobId: null,
        revealed: false,
        bundle: null,
        failure: run.failure,
      };
    }
    if (!run.runHash) {
      throw new EngineValidationError(
        `inference run ${runId} has no validated run hash`,
      );
    }
    const sealedBlobId = run.sealedBlobId ?? null;
    const revealedBlobId = run.revealedBlobId ?? null;
    // Both blobs live on Walrus and testnet reads are slow; fetch them
    // together instead of back to back.
    const [sealedBytes, revealedBytes] = await Promise.all([
      sealedBlobId === null ? null : this.#walrus.get(sealedBlobId),
      revealedBlobId === null ? null : this.#walrus.get(revealedBlobId),
    ]);
    const sealed =
      sealedBytes === null
        ? null
        : JSON.parse(new TextDecoder().decode(sealedBytes)) as SealedRunBundleV2;
    const bundle =
      revealedBytes === null
        ? null
        : JSON.parse(new TextDecoder().decode(revealedBytes)) as PublicRunBundle;
    return {
      ...common,
      runHash: run.runHash,
      sealedBlobId,
      sealed,
      revealedBlobId,
      revealed: revealedBlobId !== null,
      bundle,
    };
  }

  async agentManifestDocument(
    agentProfileId: string,
  ): Promise<AgentManifestDocument | null> {
    const record = await this.#repository.getAgentManifest(agentProfileId);
    if (
      !record ||
      (record.manifest.version !== "2" &&
        record.manifest.version !== "3" &&
        record.manifest.version !== "4" &&
        record.manifest.version !== "5")
    ) {
      return null;
    }
    const bytes = await this.#walrus.get(record.manifest.manifestBlobId);
    try {
      return parseAgentManifestDocument(bytes);
    } catch {
      return null;
    }
  }

  /**
   * Move compares retention epochs with ctx.epoch(), the SUI epoch, while
   * Walrus reports its own epoch numbers; convert before anything goes on
   * chain. Local stores have no retention clock, so they keep the sentinel.
   */
  private async chainRetentionEpoch(
    walrusEndEpoch: number | undefined,
  ): Promise<number> {
    if (walrusEndEpoch === undefined || this.#walrus.epochInfo === undefined) {
      return MAX_LOCAL_WALRUS_EPOCH;
    }
    const [walrus, sui] = await Promise.all([
      this.#walrus.epochInfo(),
      this.#gateway.epochInfo(),
    ]);
    return toChainRetentionEpoch({
      walrusEndEpoch,
      walrusCurrentEpoch: walrus.currentEpoch,
      walrusEpochDurationMs: walrus.epochDurationMs,
      suiCurrentEpoch: sui.currentEpoch,
      suiEpochDurationMs: sui.epochDurationMs,
    });
  }

  async status(): Promise<EngineStatus> {
    const [sui, dbHealthy] = await Promise.all([
      this.#gateway.health(),
      this.#repository.healthy(),
    ]);
    return {
      appVersion: "0.1.0",
      network: this.#manifest.network,
      packageId: this.#manifest.packageId,
      registryObjectId: this.#manifest.registryObjectId,
      suiHealthy: sui.healthy,
      ...(sui.latestCheckpoint === undefined
        ? {}
        : { latestCheckpoint: sui.latestCheckpoint }),
      gonkaMode: this.#manifest.gonka.mode,
      walrusMode: this.#manifest.walrus.mode,
      dbHealthy,
      paused: sui.paused,
    };
  }

  async *events(
    claimId: string,
    fromSequence = 1,
  ): AsyncIterable<ResolutionEvent> {
    let nextSequence = Math.max(1, fromSequence);
    while (true) {
      const rows = await this.#repository.listResolutionEvents(claimId, nextSequence);
      const revealedRunIds = await this.#repository.revealedRunIds(claimId);
      for (const row of rows) {
        nextSequence = Math.max(nextSequence, row.sequence + 1);
        const publicEvent = serializePublicEvent(row, { revealedRunIds });
        if (publicEvent) yield publicEvent;
      }
      const claim = await this.#repository.getClaim(claimId);
      if (claim === undefined) throw new ClaimNotFoundError(claimId);
      if (isTerminalState(claim.state) && rows.length === 0) return;
      await delay(this.#eventPollIntervalMs);
    }
  }

  private async createClaimRecord(
    request: Omit<ClaimCreateRequest, "deadlines"> & {
      /** Omitted for hosted fact-checks: the default ladder is measured from the transaction. */
      deadlines?: ClaimCreateRequest["deadlines"];
    },
    submission: {
      directReviewStarted: boolean;
      submittedText?: string;
      submittedUrls: string[];
    },
  ): Promise<ClaimRecord> {
    const ladder = (): ClaimCreateRequest["deadlines"] =>
      request.deadlines ?? defaultDeadlines(this.#now(), this.#manifest.network);
    validateClaimCreateRequest({ ...request, deadlines: ladder() });
    const [statementUpload, criteriaUpload] = await Promise.all([
      this.#walrus.put(
        new TextEncoder().encode(request.statement),
        { identifier: "claim-statement.txt" },
      ),
      this.#walrus.put(
        new TextEncoder().encode(request.resolutionCriteria),
        { identifier: "resolution-criteria.txt" },
      ),
    ]);
    const policyId = evidencePolicyId(this.#manifest);
    const contentHash = blake2b256(
      canonicalJsonBytes({
        statement: request.statement,
        resolutionCriteria: request.resolutionCriteria,
      }),
    );
    // The two writes above take about 35 s on testnet; a ladder computed at
    // the start of the request would already have spent its evidence cutoff
    // before the workers can see the claim, so measure it from here.
    const deadlines = ladder();
    validateClaimCreateRequest({ ...request, deadlines });
    const result = await this.#gateway.createClaim({
      ...request,
      deadlines,
      directReviewStarted: submission.directReviewStarted,
      contentHash,
      statementBlobId: statementUpload.blobId,
      criteriaBlobId: criteriaUpload.blobId,
      evidencePolicyId: fromHex(policyId),
    });
    const timestamp = this.isoNow();
    const claim: ClaimRecord = {
      claimId: result.claimId,
      network: this.#manifest.network,
      packageId: this.#manifest.packageId,
      registryObjectId: this.#manifest.registryObjectId,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
      packageVersion: 1,
      coinType: this.#manifest.coinType,
      mode: request.mode,
      state: submission.directReviewStarted
        ? CLAIM_STATE.REVIEW_REQUESTED
        : CLAIM_STATE.CREATED,
      ...(result.creator === undefined ? {} : { creator: result.creator }),
      statement: request.statement,
      resolutionCriteria: request.resolutionCriteria,
      deadlines,
      committeeBudget: request.committeeBudget,
      evidenceBudget: request.evidenceBudget,
      ...(submission.submittedText === undefined
        ? {}
        : { submittedText: submission.submittedText }),
      submittedUrls: submission.submittedUrls,
      statementBlobId: statementUpload.blobId,
      criteriaBlobId: criteriaUpload.blobId,
      evidencePolicyId: policyId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveClaim(claim);
    await this.emit({
      claimId: result.claimId,
      phase: "CREATE",
      kind: "claim_created",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: result.claimId,
        claim_mode: request.mode,
        package_id: this.#manifest.packageId,
        transaction_digest: result.digest,
        checkpoint: result.checkpoint,
        policy_id: policyId,
        coin_type_hash: toHex(
          blake2b256(new TextEncoder().encode(this.#manifest.coinType)),
        ),
      },
    });
    return claim;
  }

  private async ingestFactCheckEvidence(
    claim: ClaimRecord,
    request: FactCheckRequest,
  ): Promise<void> {
    await this.ingestText(claim, claim.statement, 1, {
      evidenceLabel: `statement:${claim.claimId}:1`,
      sourceUrl: CLAIM_STATEMENT_SOURCE_URL,
    });
    const tasks: Promise<void>[] = request.urls.map((url, index) =>
      this.ingestUrl(claim, url, 1, `url-${index + 1}`),
    );
    if (request.text?.trim()) {
      tasks.push(this.ingestText(claim, request.text.trim(), 1));
    }
    await Promise.all(tasks);
  }

  private async ingestText(
    claim: ClaimRecord,
    text: string,
    phase: 1 | 2,
    options: {
      evidenceId?: string;
      evidenceLabel?: string;
      sourceUrl?: string;
    } = {},
  ): Promise<void> {
    const evidenceId =
      options.evidenceId ??
      deterministicId(options.evidenceLabel ?? `text:${claim.claimId}:${phase}`);
    const sourceUrl = options.sourceUrl ?? "urn:openverdict:submitted-text";
    const timestamp = this.isoNow();
    const submission: EvidenceSubmissionRecord = {
      submissionId: deterministicId(`submission:${evidenceId}`),
      evidenceId,
      claimId: claim.claimId,
      phase,
      submittedText: text,
      sourceClass: "USER_SUBMITTED",
      retrievalStatus: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceSubmission(submission);
    await this.emitEvidenceSubmitted(submission);
    const bytes = new TextEncoder().encode(text);
    const raw = await this.#walrus.put(bytes, { identifier: `${evidenceId}-raw.txt` });
    const canonical = await this.#walrus.put(bytes, {
      identifier: `${evidenceId}-canonical.txt`,
    });
    const completedAt = this.isoNow();
    await this.#repository.saveEvidenceArtifact({
      evidenceId,
      submissionId: submission.submissionId,
      claimId: claim.claimId,
      phase,
      sourceUrl,
      finalUrl: sourceUrl,
      sourceClass: "USER_SUBMITTED",
      mimeType: "text/plain",
      byteLength: bytes.byteLength,
      contentHash: toHex(blake2b256(bytes)),
      canonicalHash: toHex(blake2b256(bytes)),
      rawWalrusBlobId: raw.blobId,
      ...(raw.objectId === undefined ? {} : { rawWalrusObjectId: raw.objectId }),
      canonicalWalrusBlobId: canonical.blobId,
      ...(canonical.objectId === undefined
        ? {}
        : { canonicalWalrusObjectId: canonical.objectId }),
      ...(endEpoch(raw, canonical) === undefined
        ? {}
        : { walrusEndEpoch: endEpoch(raw, canonical) }),
      parserVersion: "utf8-text-v1",
      excerpt: text.slice(0, 500),
      retrievedAt: completedAt,
      createdAt: timestamp,
      updatedAt: completedAt,
    });
    await this.#repository.saveEvidenceSubmission({
      ...submission,
      retrievalStatus: "ACCEPTED",
      updatedAt: completedAt,
    });
    await this.emitEvidenceRetrieved(claim.claimId, evidenceId, "ACCEPTED", 0, bytes.byteLength);
  }

  private async ingestUrl(
    claim: ClaimRecord,
    url: string,
    phase: 1 | 2,
    suffix: string,
  ): Promise<void> {
    validateHttpsUrls([url]);
    const evidenceId = deterministicId(`url:${claim.claimId}:${phase}:${suffix}:${url}`);
    const startedAt = this.#now();
    const timestamp = new Date(startedAt).toISOString();
    const submission: EvidenceSubmissionRecord = {
      submissionId: deterministicId(`submission:${evidenceId}`),
      evidenceId,
      claimId: claim.claimId,
      phase,
      sourceUrl: url,
      sourceClass: "USER_SUBMITTED",
      retrievalStatus: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceSubmission(submission);
    await this.emitEvidenceSubmitted(submission);
    const retrieved = await this.#retrieve(url, this.#retrievalPolicy);
    if ("rejectionCode" in retrieved) {
      await this.#repository.saveEvidenceSubmission({
        ...submission,
        retrievalStatus: "REJECTED",
        rejectionCode: retrieved.rejectionCode,
        updatedAt: this.isoNow(),
      });
      await this.emitEvidenceRetrieved(
        claim.claimId,
        evidenceId,
        "REJECTED",
        Math.max(0, this.#now() - startedAt),
        0,
      );
      return;
    }
    await this.persistRetrievedArtifact(claim, submission, retrieved, startedAt);
  }

  private async persistRetrievedArtifact(
    claim: ClaimRecord,
    submission: EvidenceSubmissionRecord,
    retrieved: RetrievedArtifact,
    startedAt: number,
  ): Promise<void> {
    const canonical = canonicalArtifact(retrieved);
    const rawUpload = await this.#walrus.put(retrieved.bytes, {
      identifier: `${submission.evidenceId}-raw`,
    });
    const canonicalBytes = new TextEncoder().encode(canonical.text);
    const canonicalUpload = await this.#walrus.put(canonicalBytes, {
      identifier: `${submission.evidenceId}-canonical.txt`,
    });
    const timestamp = this.isoNow();
    const artifact: EvidenceArtifactRecord = {
      evidenceId: submission.evidenceId,
      submissionId: submission.submissionId,
      claimId: claim.claimId,
      phase: submission.phase,
      sourceUrl: submission.sourceUrl ?? retrieved.finalUrl,
      finalUrl: retrieved.finalUrl,
      mimeType: retrieved.mimeType,
      byteLength: retrieved.byteLength,
      contentHash: toHex(retrieved.contentHash),
      canonicalHash: toHex(blake2b256(canonicalBytes)),
      rawWalrusBlobId: rawUpload.blobId,
      ...(rawUpload.objectId === undefined
        ? {}
        : { rawWalrusObjectId: rawUpload.objectId }),
      canonicalWalrusBlobId: canonicalUpload.blobId,
      ...(canonicalUpload.objectId === undefined
        ? {}
        : { canonicalWalrusObjectId: canonicalUpload.objectId }),
      ...(endEpoch(rawUpload, canonicalUpload) === undefined
        ? {}
        : { walrusEndEpoch: endEpoch(rawUpload, canonicalUpload) }),
      parserVersion: canonical.parserVersion,
      excerpt: canonical.text.slice(0, 500),
      retrievedAt: new Date(retrieved.retrievedAt).toISOString(),
      createdAt: submission.createdAt,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceArtifact(artifact);
    await this.#repository.saveEvidenceSubmission({
      ...submission,
      retrievalStatus: "ACCEPTED",
      updatedAt: timestamp,
    });
    await this.emitEvidenceRetrieved(
      claim.claimId,
      submission.evidenceId,
      "ACCEPTED",
      Math.max(0, this.#now() - startedAt),
      retrieved.byteLength,
    );
  }

  private async runSeat(
    claim: ClaimRecord,
    committee: CommitteeRecord,
    seat: JurySeatRecord,
    evidence: EvidenceManifestRecord,
    artifacts: EvidenceArtifactRecord[],
    priorRound: PriorRoundPublicRecord | undefined,
    research: ResearchProvider,
    searchCache: SearchCache,
    storedPageCache: Map<string, Promise<PageStorePage>>,
    pageUploads: Map<string, Promise<void>>,
    researchConfig: SeatResearchConfig,
    seatDeadlineMs: number,
    commitFloorMs: number,
  ): Promise<void> {
    const agent = await this.requiredAgent(seat.agentProfileId);
    const baseRunId = deterministicId(`run:${claim.claimId}:${seat.jurySeatId}:${seat.phase}`);
    const input = oracleInput(
      claim,
      seat,
      evidence,
      artifacts,
      priorRound,
      agent.role,
      baseRunId,
      researchConfig.spec.version,
    );
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "inference_started",
      source: "GONKA_ROUTER",
      visibility: "INTERNAL_REDACTED",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: {
        run_id: baseRunId,
        agent_id: seat.agentProfileId,
        provider_id: "gonkarouter",
        model_id: agent.manifest.modelId,
        attempt: 1,
      },
    });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: { genericStage: "INFERENCE", status: "RUNNING", latencyMs: 0 },
    });

    try {
      const pages: PageStore = {
        lookup: async (evidenceId) => {
          const pending = storedPageCache.get(evidenceId);
          if (pending) return pending;
          const record = await this.#repository.getEvidenceArtifact(evidenceId);
          if (!record || record.sourceClass !== "DISCOVERED") return undefined;
          const text = new TextDecoder().decode(
            await this.#walrus.get(record.canonicalWalrusBlobId),
          );
          const stored: PageStorePage = {
            evidenceId,
            url: record.sourceUrl,
            finalUrl: record.finalUrl,
            ...(record.title === undefined ? {} : { title: record.title }),
            text,
            totalChars: text.length,
            truncated: record.byteLength > text.length,
            contentHash: record.contentHash,
            canonicalHash: record.canonicalHash,
            canonicalWalrusBlobId: record.canonicalWalrusBlobId,
          };
          storedPageCache.set(evidenceId, Promise.resolve(stored));
          return stored;
        },
        store: async (page, meta) => {
          const existing = storedPageCache.get(meta.evidenceId);
          if (existing) return existing;
          const truncated = page.markdown.length > meta.maxPageChars;
          const text = truncated
            ? page.markdown.slice(0, meta.maxPageChars)
            : page.markdown;
          const bytes = new TextEncoder().encode(text);
          const hash = toHex(blake2b256(bytes));
          const identifier = `${meta.evidenceId}-discovered.md`;
          const stored = (blobId: string): PageStorePage => ({
            evidenceId: meta.evidenceId,
            url: meta.normalizedUrl,
            finalUrl: page.finalUrl,
            ...(page.title === undefined ? {} : { title: page.title }),
            text,
            totalChars: text.length,
            truncated,
            contentHash: hash,
            canonicalHash: hash,
            canonicalWalrusBlobId: blobId,
          });
          // Records the discovered page once its bytes are on Walrus.
          const persist = async (upload: WalrusPutResult): Promise<void> => {
            const timestamp = this.isoNow();
            const submissionId = deterministicId(`submission:${meta.evidenceId}`);
            await this.#repository.saveEvidenceSubmission({
              submissionId,
              evidenceId: meta.evidenceId,
              claimId: claim.claimId,
              phase: seat.phase,
              sourceUrl: meta.normalizedUrl,
              sourceClass: "DISCOVERED",
              retrievalStatus: "ACCEPTED",
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            await this.#repository.saveEvidenceArtifact({
              evidenceId: meta.evidenceId,
              submissionId,
              claimId: claim.claimId,
              phase: seat.phase,
              sourceUrl: meta.normalizedUrl,
              finalUrl: page.finalUrl,
              mimeType: "text/markdown",
              byteLength: new TextEncoder().encode(page.markdown).byteLength,
              contentHash: hash,
              canonicalHash: hash,
              rawWalrusBlobId: upload.blobId,
              canonicalWalrusBlobId: upload.blobId,
              ...(upload.objectId === undefined
                ? {}
                : {
                    rawWalrusObjectId: upload.objectId,
                    canonicalWalrusObjectId: upload.objectId,
                  }),
              ...(upload.endEpoch === undefined
                ? {}
                : { walrusEndEpoch: upload.endEpoch }),
              parserVersion: "firecrawl-markdown-v1",
              ...(page.title === undefined ? {} : { title: page.title }),
              excerpt: text.slice(0, 500),
              retrievedAt: new Date(page.fetchedAtMs).toISOString(),
              createdAt: timestamp,
              updatedAt: timestamp,
              sourceClass: "DISCOVERED",
              discoveredByRunId: input.runId,
            });
          };
          const walrus = this.#walrus;
          const blobId = walrus.blobIdFor ? await walrus.blobIdFor(bytes) : undefined;
          if (blobId === undefined) {
            // No content address ahead of the write: upload before the model sees the page.
            const pending = (async (): Promise<PageStorePage> => {
              const upload = await walrus.put(bytes, { identifier });
              await persist(upload);
              return stored(upload.blobId);
            })();
            storedPageCache.set(meta.evidenceId, pending);
            try {
              return await pending;
            } catch (error) {
              if (storedPageCache.get(meta.evidenceId) === pending) {
                storedPageCache.delete(meta.evidenceId);
              }
              throw error;
            }
          }
          // Walrus blob ids are content addresses, so the id is known before
          // the write (about 14 s on testnet). Hand the page to the model now
          // and upload in the background; every seat awaits the uploads of the
          // pages it opened before sealing, so a failed write still fails that
          // seat closed.
          const upload = (async (): Promise<void> => {
            const result = await walrus.put(bytes, { identifier });
            if (result.blobId !== blobId) {
              throw new Error(
                `discovered page ${meta.evidenceId} uploaded as ${result.blobId}, expected ${blobId}`,
              );
            }
            await persist(result);
          })();
          // The seats that opened the page observe the rejection; never leave it unhandled.
          upload.catch(() => undefined);
          pageUploads.set(meta.evidenceId, upload);
          const ready = stored(blobId);
          storedPageCache.set(meta.evidenceId, Promise.resolve(ready));
          return ready;
        },
      };
      const loop = await runResearchLoop({
        complete: (request) => this.#gonka.complete(request),
        provider: research,
        policy: researchConfig.policy,
        spec: researchConfig.spec,
        input,
        manifest: agent.manifest,
        claimId: claim.claimId,
        phase: seat.phase,
        pages,
        searchCache,
        now: this.#now,
        deadlineMs: seatDeadlineMs,
        onStep: ({ kind, ordinal }) => {
          // Public ticks expose activity shape only and cannot fail the seat.
          void this.emit({
            claimId: claim.claimId,
            phase: `INFERENCE_${seat.phase}`,
            kind: "RESEARCH_TICK",
            source: "ENGINE",
            visibility: "PUBLIC_NOW",
            actorId: seat.agentProfileId,
            runId: baseRunId,
            payload: { jurySeatId: seat.jurySeatId, kind, ordinal },
          }).catch(() => undefined);
        },
      });
      if (!loop.ok) {
        throw new ResearchLoopError(
          loop.status,
          loop.message,
          loop.attempts,
          loop.transcript,
        );
      }
      // Every page this run opened must be on Walrus before the run is sealed
      // and cited on chain; a failed background upload fails the seat closed.
      await Promise.all(
        loop.opened.map((page) => pageUploads.get(page.evidenceId)),
      );
      const response: GonkaRunResult = {
        type: "gonka-run-result",
        attempts: loop.attempts,
        response: loop.response,
        request: loop.request,
        gateway: loop.gateway,
      };
      const adapterAudit = await this.#gonka.buildRunAudit(response);
      const normalized = {
        gonkaRequestId: adapterAudit.gonkaRequestId,
        modelId: adapterAudit.responseModelId ?? adapterAudit.modelId,
        output: loop.output,
      };
      // One canonical run ID spans visible retry attempts for this jury seat.
      const runId = baseRunId;
      const outputHash = toHex(blake2b256(canonicalJsonBytes(normalized.output)));
      const toolTranscriptHash = transcriptHash(loop.transcript);
      const audit: InferenceRunAudit = {
        ...adapterAudit,
        runId: runId as `0x${string}`,
        claimObjectId: claim.claimId as `0x${string}`,
        agentProfileId: seat.agentProfileId as `0x${string}`,
        jurySeatId: seat.jurySeatId as `0x${string}`,
        phase: seat.phase,
        modelId: agent.manifest.modelId,
        responseModelId: normalized.modelId,
        gonkaRequestId: normalized.gonkaRequestId,
        inputHash: hashCanonicalJson(input),
        outputHash,
        // The sealed blob ID is known only after this core is encrypted and uploaded.
        runWalrusBlobId: "",
        toolTranscriptHash,
        toolTranscriptWalrusBlobId: "",
        toolCallCount:
          loop.transcript.counts.searches + loop.transcript.counts.opens,
        evidenceRoot: evidence.root,
        ...response.gateway,
        status: "SCHEMA_VALID",
      };
      const runHash = toHex(
        computeRunHash({
          run_id: audit.runId,
          claim_object_id: claim.claimId,
          agent_profile_id: seat.agentProfileId,
          jury_seat_id: seat.jurySeatId,
          phase: seat.phase,
          attempt: audit.attempt,
          provider_id: "gonkarouter",
          model_id: agent.manifest.modelId,
          gonka_request_id: normalized.gonkaRequestId,
          prompt_hash: fromHex(agent.manifest.promptHash),
          input_hash: fromHex(audit.inputHash),
          output_hash: fromHex(outputHash),
          tool_transcript_hash: fromHex(audit.toolTranscriptHash),
          evidence_root: fromHex(evidence.root),
          requested_at_ms: audit.requestedAtMs,
          completed_at_ms: audit.completedAtMs,
        }),
      );
      const bundleParams = {
        input,
        runResult: response,
        validatedOutput: normalized.output,
        audit,
        runHash,
        transcript: loop.transcript,
      };
      let core: PublicRunBundleCore;
      if (researchConfig.bundleVersion === 5) {
        core = buildRunBundleCore({
          ...bundleParams,
          promptSpec: researchConfig.spec,
          toolPolicy: researchConfig.policy,
        });
      } else if (researchConfig.bundleVersion === 4) {
        core = buildRunBundleCore({
          ...bundleParams,
          promptSpec: researchConfig.spec,
          toolPolicy: researchConfig.policy,
        });
      } else {
        core = buildRunBundleCore({
          ...bundleParams,
          promptSpec: researchConfig.spec,
          toolPolicy: researchConfig.policy,
        });
      }
      const bundleCore = new TextDecoder().decode(canonicalCoreBytes(core));
      const { sealed, seal } = sealRunBundle(core, { runId: audit.runId });
      let sealedDocument = sealed;
      if (this.#sealEscrow) {
        const deadlineMs =
          seat.phase === 1
            ? claim.deadlines.firstRevealDeadlineMs
            : claim.deadlines.secondRevealDeadlineMs;
        try {
          const escrow = await this.#sealEscrow.escrowKey({
            claimId: claim.claimId as `0x${string}`,
            jurySeatId: seat.jurySeatId as `0x${string}`,
            phase: seat.phase,
            deadlineMs,
            runId: audit.runId,
            keyBytes: fromHex(seal.keyHex),
          });
          sealedDocument = { ...sealed, escrow };
        } catch (error) {
          // Escrow is insurance and must never cost a jury seat.
          process.stderr.write(
            `seal-escrow failed: claim ${claim.claimId} seat ${seat.jurySeatId}: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        }
      }
      const sealedUpload = await this.#walrus.put(
        canonicalJsonBytes(sealedDocument),
        { identifier: `${baseRunId}-sealed-run-bundle.json` },
      );
      const retainedUntil =
        endEpoch(sealedUpload) ?? MAX_LOCAL_WALRUS_EPOCH;
      // The database keeps the Walrus epoch (renewals); the chain gets Sui epochs.
      const chainRetainedUntil = await this.chainRetentionEpoch(endEpoch(sealedUpload));
      const approval = await this.#gateway.approveRun({
        claimId: claim.claimId,
        committeeId: committee.committeeId,
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        agentOwner: seat.agentOwner,
        phase: seat.phase,
        runHash: fromHex(runHash),
        runBlobId: sealedUpload.blobId,
        runBlobObjectId: sealedUpload.objectId ?? ZERO_OBJECT_ID,
        toolBlobId: sealedUpload.blobId,
        toolBlobObjectId: sealedUpload.objectId ?? ZERO_OBJECT_ID,
        walrusEndEpoch: chainRetainedUntil,
      });
      const timestamp = this.isoNow();
      const storedAudit: InferenceRunRecord["audit"] = {
        ...audit,
        runWalrusBlobId: sealedUpload.blobId,
        toolTranscriptWalrusBlobId: sealedUpload.blobId,
        bundleCore,
      };
      const run: InferenceRunRecord = {
        runId: audit.runId,
        claimId: claim.claimId,
        phase: seat.phase,
        agentProfileId: seat.agentProfileId,
        jurySeatId: seat.jurySeatId,
        attempt: audit.attempt,
        providerId: "gonkarouter",
        modelId: agent.manifest.modelId,
        gonkaRequestId: normalized.gonkaRequestId,
        promptHash: agent.manifest.promptHash,
        inputHash: audit.inputHash,
        outputHash,
        runHash,
        runWalrusBlobId: sealedUpload.blobId,
        ...(sealedUpload.objectId === undefined
          ? {}
          : { runWalrusObjectId: sealedUpload.objectId }),
        sealKeyHex: seal.keyHex,
        sealIvHex: seal.ivHex,
        coreHash: seal.coreHash,
        sealedBlobId: sealedUpload.blobId,
        ...(sealedUpload.objectId === undefined
          ? {}
          : { sealedObjectId: sealedUpload.objectId }),
        toolTranscriptHash: audit.toolTranscriptHash,
        toolTranscriptWalrusBlobId: sealedUpload.blobId,
        ...(sealedUpload.objectId === undefined
          ? {}
          : { toolTranscriptWalrusObjectId: sealedUpload.objectId }),
        walrusEndEpoch: retainedUntil,
        evidenceRoot: evidence.root,
        validationStatus: "SCHEMA_VALID",
        latencyMs: audit.latencyMs,
        ...(audit.inputTokens === undefined ? {} : { inputTokens: audit.inputTokens }),
        ...(audit.outputTokens === undefined ? {} : { outputTokens: audit.outputTokens }),
        output: normalized.output,
        audit: storedAudit,
        requestedAt: new Date(audit.requestedAtMs).toISOString(),
        completedAt: new Date(audit.completedAtMs).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveInferenceRun(run);
      const approvalRecord: RunApprovalRecord = {
        runApprovalId: approval.runApprovalId,
        runId: run.runId,
        claimId: claim.claimId,
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        runHash,
        transactionDigest: approval.digest,
        attestor: "operator",
        validationErrors: [],
        consumed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveRunApproval(approvalRecord);
      await this.updateSeat(seat.jurySeatId, { status: "RUN_APPROVED", runHash });
      await this.emitRunApproval(claim.claimId, run, approvalRecord);
    } catch (error) {
      await this.persistInferenceFailure(claim, seat, agent, input, error);
      return;
    }
    // Commit this seat now instead of after the slowest seat: one seat that
    // overruns must not push every commit past the commit deadline. Before
    // the acceptance floor the chain refuses the lock; the pump in juryRun
    // picks the run up once the floor has passed.
    if (this.#now() >= commitFloorMs) {
      await this.queueCommit(claim.claimId, seat.phase);
    }
  }

  /**
   * Runs votesCommit for a claim after any earlier queued commit finished, so
   * seats finishing together never race on the lock or double-commit. A
   * failure (for example the committee's acceptance window still open on
   * chain) is logged; the next seat, or the worker's final votesCommit,
   * tries again.
   */
  private queueCommit(claimId: string, phase: 1 | 2): Promise<void> {
    const previous = this.#commitQueues.get(claimId) ?? Promise.resolve();
    const next = previous
      .then(() => this.votesCommit(claimId, phase))
      .then(
        () => undefined,
        (error: unknown) => {
          process.stderr.write(
            `commit after seat: claim ${claimId.slice(0, 10)}…: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        },
      );
    this.#commitQueues.set(claimId, next);
    return next;
  }

  private async persistInferenceFailure(
    claim: ClaimRecord,
    seat: JurySeatRecord,
    agent: AgentManifestRecord,
    input: OracleInferenceInput,
    error: unknown,
  ): Promise<void> {
    // Surface the underlying cause: the audit row only keeps a category
    // (PROVIDER_ERROR etc.), which made real failures (an on-chain abort in
    // acceptJurySeat, a Walrus read error) invisible in operations.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `inference failed: claim ${claim.claimId.slice(0, 10)}… seat ${seat.jurySeatId.slice(0, 10)}… (${agent.manifest.modelId}): ${
        message
      }\n`,
    );
    const failedAudit = terminalFailureAudit(error);
    const timestampMs = this.#now();
    const runId = input.runId as `0x${string}`;
    const status =
      terminalFailureStatus(error) ?? failedAudit?.status ?? "PROVIDER_ERROR";
    const timestamp = new Date(timestampMs).toISOString();
    const zeroHash = hashCanonicalJson(null);
    let failure: InferenceFailureV1 = {
      version: 1,
      status,
      message,
      failedAtMs: timestampMs,
      transcript:
        error instanceof ResearchLoopError ? error.transcript ?? null : null,
      attempts:
        error instanceof GonkaRunError ? error.result.attempts : [],
    };
    try {
      const upload = await this.#walrus.put(canonicalJsonBytes(failure), {
        identifier: `${runId}-failed-run.json`,
      });
      failure = { ...failure, walrusBlobId: upload.blobId };
    } catch (uploadError) {
      // A Walrus outage must not hide the local failure audit.
      process.stderr.write(
        `failed-run upload: ${
          uploadError instanceof Error ? uploadError.message : String(uploadError)
        }\n`,
      );
    }
    const audit: InferenceRunAudit = {
      ...(failedAudit ?? {
        runId: runId as `0x${string}`,
        attempt: 1,
        providerId: "gonkarouter" as const,
        modelId: agent.manifest.modelId,
        gonkaRequestId: "",
        outputHash: zeroHash,
        runWalrusBlobId: "",
        toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
        toolTranscriptWalrusBlobId: "",
        toolCallCount: 0,
        requestedAtMs: timestampMs,
        completedAtMs: timestampMs,
        latencyMs: 0,
        status,
      }),
      runId,
      claimObjectId: claim.claimId as `0x${string}`,
      agentProfileId: seat.agentProfileId as `0x${string}`,
      jurySeatId: seat.jurySeatId as `0x${string}`,
      phase: seat.phase,
      promptHash: agent.manifest.promptHash,
      inputHash: hashCanonicalJson(input),
      evidenceRoot: input.evidenceManifest.root as `0x${string}`,
      status,
    };
    const record: InferenceRunRecord = {
      runId: audit.runId,
      claimId: claim.claimId,
      phase: seat.phase,
      agentProfileId: seat.agentProfileId,
      jurySeatId: seat.jurySeatId,
      attempt: audit.attempt,
      providerId: "gonkarouter",
      modelId: agent.manifest.modelId,
      gonkaRequestId: audit.gonkaRequestId,
      promptHash: agent.manifest.promptHash,
      inputHash: audit.inputHash,
      outputHash: audit.outputHash,
      toolTranscriptHash: audit.toolTranscriptHash,
      evidenceRoot: input.evidenceManifest.root as `0x${string}`,
      validationStatus: status,
      latencyMs: audit.latencyMs,
      audit,
      failure,
      requestedAt: new Date(audit.requestedAtMs).toISOString(),
      completedAt: new Date(audit.completedAtMs).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveInferenceRun(record);
    await this.updateSeat(seat.jurySeatId, { status: "NO_VALID_INFERENCE" });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "inference_failed",
      source: "GONKA_ROUTER",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: record.runId,
      payload: {
        run_id: record.runId,
        category: status,
        retry_count: Math.max(0, audit.attempt - 1),
      },
    });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: record.runId,
      payload: {
        genericStage: "INFERENCE",
        status: "NO_VALID_INFERENCE",
        latencyMs: audit.latencyMs,
      },
    });
  }

  private async emitRunApproval(
    claimId: string,
    run: InferenceRunRecord,
    approval: RunApprovalRecord,
  ): Promise<void> {
    await this.emit({
      claimId,
      phase: `INFERENCE_${run.phase}`,
      kind: "run_approved",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      actorId: run.agentProfileId,
      runId: run.runId,
      transactionDigest: approval.transactionDigest,
      artifactHash: approval.runHash,
      payload: {
        run_id: run.runId,
        agent_profile_id: run.agentProfileId,
        jury_seat_id: run.jurySeatId,
        run_approval_id: approval.runApprovalId,
        run_hash: approval.runHash,
        transaction_digest: approval.transactionDigest,
      },
    });
    await this.emit({
      claimId,
      phase: `INFERENCE_${run.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: run.agentProfileId,
      runId: run.runId,
      payload: {
        genericStage: "INFERENCE",
        status: "COMPLETED",
        latencyMs: run.latencyMs,
      },
    });
  }

  private async persistFinalization(
    claim: ClaimRecord,
    chain: Awaited<ReturnType<SuiGateway["finalize"]>>,
    result: ResolutionCertificateRecord["result"],
    truthScoreBps: number | null,
    phase: 1 | 2,
    voteIds: string[],
  ): Promise<FinalizeReport> {
    const timestamp = this.isoNow();
    const certificate: ResolutionCertificateRecord = {
      certificateId: chain.certificateId,
      claimId: claim.claimId,
      result,
      ...(truthScoreBps === null ? {} : { truthScoreBps }),
      finalPhase: phase,
      finalRoundVoteIds: voteIds,
      transactionDigest: chain.digest,
      ...(chain.checkpoint === undefined ? {} : { checkpoint: chain.checkpoint }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveResolutionCertificate(certificate);
    const payoutTickets =
      chain.payoutTickets.length > 0
        ? chain.payoutTickets
        : chain.payoutTicketIds.map((payoutTicketId) => ({
            payoutTicketId,
            recipient: claim.creator ?? ZERO_OBJECT_ID,
            amount: "0",
            reason: 0,
          }));
    for (const payout of payoutTickets) {
      await this.#repository.savePayoutTicket({
        payoutTicketId: payout.payoutTicketId,
        claimId: claim.claimId,
        recipient: payout.recipient,
        amount: payout.amount,
        coinType: claim.coinType,
        reason: payout.reason,
        consumed: false,
        createdTransactionDigest: chain.digest,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const nextState =
      result === "UNRESOLVED"
        ? CLAIM_STATE.UNRESOLVED
        : claim.state === CLAIM_STATE.PROPOSED
          ? CLAIM_STATE.FINALIZED_UNCHALLENGED
          : CLAIM_STATE.FINALIZED_REVIEWED;
    await this.saveClaim({
      ...claim,
      state: nextState,
      certificateId: chain.certificateId,
      result,
      ...(truthScoreBps === null ? {} : { truthScoreBps }),
      transactionDigest: chain.digest,
    });
    const tally = await this.#repository.getRoundTally(claim.claimId, phase);
    if (tally) {
      await this.#repository.saveRoundTally({ ...tally, closed: true, updatedAt: timestamp });
    }
    await this.emit({
      claimId: claim.claimId,
      phase: "FINALIZED",
      kind: "claim_finalized",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: chain,
      payload: {
        claim_id: claim.claimId,
        certificate_id: chain.certificateId,
        outcome: result,
        reviewed: claim.state !== CLAIM_STATE.PROPOSED,
        truth_score_bps: truthScoreBps,
        transaction_digest: chain.digest,
      },
    });
    // Fire-and-forget: warm and persist this claim's public run proofs so no
    // viewer (or fresh deploy) ever pays the first heavy build. A failed build
    // only logs; finalization never waits on it.
    void this.warmRunProofs(claim.claimId);
    return certificateToFinalizeReport(certificate);
  }

  private async verifyClaim(
    claim: ClaimRecord,
    manifests: EvidenceManifestRecord[],
    packages: VotePackageRecord[],
    certificate?: ResolutionCertificateRecord,
  ): Promise<NonNullable<ClaimInspection["verification"]>> {
    const issues: string[] = [];
    let commitmentsRecomputed = true;
    for (const item of packages) {
      const recomputed = toHex(
        computeVoteCommitment({
          claim_id: item.claimId,
          agent_profile_id: item.agentProfileId,
          jury_seat_id: item.jurySeatId,
          phase: item.phase,
          outcome: item.outcome,
          confidence_bps: item.confidenceBps,
          evidence_root: fromHex(item.evidenceRoot),
          output_hash: fromHex(item.outputHash),
          run_hash: fromHex(item.runHash),
          salt: fromHex(item.saltHex),
        }),
      );
      if (recomputed !== item.commitment) {
        commitmentsRecomputed = false;
        issues.push(`commitment mismatch for jury seat ${item.jurySeatId}`);
      }
    }
    let evidenceRootsRecomputed = true;
    for (const manifest of manifests) {
      const artifacts = uniqueEvidenceArtifacts(
        await this.artifactsForPhase(claim.claimId, manifest.phase),
      );
      const recomputed = toHex(
        buildEvidenceManifest(artifacts.map(toEvidenceManifestItem)).root,
      );
      if (recomputed !== manifest.root) {
        evidenceRootsRecomputed = false;
        issues.push(`evidence root mismatch for phase ${manifest.phase}`);
      }
    }
    let truthScoreRecomputed = true;
    if (certificate) {
      const reveals = await this.#repository.listReveals(claim.claimId, certificate.finalPhase);
      const recomputed = computeTruthScoreBps(
        reveals.filter((reveal) => reveal.valid).map((reveal) => ({
          outcome: reveal.outcome,
          confidenceBps: reveal.confidenceBps,
        })),
      );
      if (recomputed !== (certificate.truthScoreBps ?? null)) {
        truthScoreRecomputed = false;
        issues.push("truth score mismatch");
      }
    }
    return {
      commitmentsRecomputed,
      truthScoreRecomputed,
      evidenceRootsRecomputed,
      issues,
    };
  }

  private async registerVerifiedZkBackedAgent(
    req: ValidatedZkBackedRegistrationRequest,
    humanBackingHash: `0x${string}`,
  ): Promise<ZkBackedRegistrationResult> {
    const agents = await this.#repository.listAgentManifests();
    if (
      agents.some(
        (agent) =>
          agent.active &&
          agent.manifest.humanAttestationHash.toLowerCase() ===
            humanBackingHash,
      )
    ) {
      throw new EngineValidationError(
        "an active agent already uses this backing; one social account can back only one active jury seat",
      );
    }

    // Demo signers are a fixed deterministic pool. Never reuse a slot whose
    // operational address already appears in a persisted agent manifest.
    const usedOwners = new Set(
      agents.map((agent) => agent.manifest.owner.toLowerCase()),
    );
    const slot = this.#operationalAgentSlots.find(
      (candidate) => !usedOwners.has(candidate.address.toLowerCase()),
    );
    if (!slot) {
      throw new EngineValidationError(
        `operational agent signer capacity exhausted (${this.#operationalAgentSlots.length} deterministic slots configured)`,
      );
    }

    // Persist only the pseudonymous backing hash; the social address and its
    // signature are used for authentication and deliberately not stored.
    const built = buildAgentManifestDocument({
      network: this.#manifest.network,
      backingKind: "ZKLOGIN_BACKED",
      humanBackingHash,
      humanVerificationProvider: ZKLOGIN_VERIFICATION_PROVIDER,
      operationalOwner: slot.address as `0x${string}`,
      role: req.role,
      modelId: req.modelId,
      promptSpec: this.#gonka.promptSpec(),
      toolPolicy: this.#gonka.toolPolicy(),
      // The document carries the human-readable label; verifiers hash it.
      evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
    });
    // Fail closed if the document's policy hash and the id the engine records
    // at evidence freeze ever diverge (a release manifest that overrides
    // evidencePolicy.id needs a matching document label first).
    const enginePolicyId = evidencePolicyId(this.#manifest);
    if (built.document.evidencePolicyHash !== enginePolicyId) {
      throw new EngineValidationError(
        `manifest document evidence policy hash ${built.document.evidencePolicyHash} does not match the engine evidence policy id ${enginePolicyId}`,
      );
    }
    const manifestUpload = await this.#walrus.put(built.bytes, {
      identifier: `agent-${humanBackingHash.slice(2, 18)}.json`,
    });
    const result = await this.#gateway.registerAgent({
      agentIndex: slot.index,
      bondAmount: 1,
      manifestHash: fromHex(built.manifestHash),
      manifestBlobId: manifestUpload.blobId,
      modelHash: blake2b256(new TextEncoder().encode(req.modelId)),
      roleHash: blake2b256(
        new TextEncoder().encode(`OPENVERDICT_ROLE_${req.role}`),
      ),
      humanBackingHash: fromHex(humanBackingHash),
    });

    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: result.agentProfileId as `0x${string}`,
      owner: result.owner as `0x${string}`,
      humanAttestationHash: humanBackingHash,
      humanVerificationProvider: ZKLOGIN_VERIFICATION_PROVIDER,
      version: built.document.version,
      manifestBlobId: manifestUpload.blobId,
      manifestHash: built.manifestHash,
      promptHash: built.promptHash,
      modelId: req.modelId,
      providerId: "gonkarouter",
      toolPolicyHash: built.toolPolicyHash,
      evidencePolicyHash: built.document.evidencePolicyHash,
      publicKey: result.owner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: result.checkpoint ?? 0,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role: req.role,
      ...(result.agentCapId === undefined
        ? {}
        : { agentCapId: result.agentCapId }),
      active: true,
      reputation: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      agentProfileId: result.agentProfileId,
      humanBackingHash,
      backingKind: "ZKLOGIN_BACKED",
      digest: result.digest,
    };
  }

  private async withRegistrationLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#registrationTail.then(operation);
    this.#registrationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async requiredCommittee(claimId: string): Promise<CommitteeRecord> {
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    if (!committee) throw new EngineStateError("claim has no selected committee");
    return committee;
  }

  private async requiredTally(claimId: string, phase: 1 | 2): Promise<RoundTallyRecord> {
    const tally = await this.#repository.getRoundTally(claimId, phase);
    if (!tally) throw new EngineStateError(`claim has no round ${phase} tally`);
    return tally;
  }

  private async requiredEvidenceManifest(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceManifestRecord> {
    const manifest = await this.#repository.getEvidenceManifest(claimId, phase);
    if (!manifest) throw new EngineStateError(`round ${phase} evidence is not frozen`);
    return manifest;
  }

  private assertResearchManifestHashes(
    manifest: AgentManifest,
    document:
      | AgentManifestDocumentV3
      | AgentManifestDocumentV4
      | AgentManifestDocumentV5,
  ): void {
    if (document.modelId !== manifest.modelId) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest document model does not match the registered model`,
      );
    }
    const computedPromptHash = promptSpecHash(document.promptSpec);
    if (
      document.promptHash.toLowerCase() !== computedPromptHash.toLowerCase() ||
      manifest.promptHash.toLowerCase() !== computedPromptHash.toLowerCase()
    ) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest prompt hash does not match its prompt document; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
    const computedToolPolicyHash = toolPolicyHash(document.toolPolicy);
    if (
      document.toolPolicyHash.toLowerCase() !==
        computedToolPolicyHash.toLowerCase() ||
      manifest.toolPolicyHash.toLowerCase() !==
        computedToolPolicyHash.toLowerCase()
    ) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest tool policy hash does not match its policy document; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
  }

  private async requiredAgent(agentProfileId: string): Promise<AgentManifestRecord> {
    const agent = await this.#repository.getAgentManifest(agentProfileId);
    if (!agent) throw new EngineStateError(`agent manifest is missing: ${agentProfileId}`);
    return agent;
  }

  private async ensureAgent(
    agentProfileId: string,
    owner: string,
    index: number,
    agentCapId?: string,
  ): Promise<void> {
    if (await this.#repository.getAgentManifest(agentProfileId)) return;
    if (this.#manifest.gonka.mode === "live") {
      throw new EngineStateError(
        `live mode requires the registered manifest for agent ${agentProfileId}`,
      );
    }
    // Fake mode may synthesize display metadata for a freshly deployed demo registry.
    const hash = (label: string) =>
      toHex(blake2b256(new TextEncoder().encode(`${label}:${agentProfileId}`)));
    const role =
      index === 0
        ? "SKEPTIC"
        : index === 1
          ? "SOURCE_AUTHENTICITY"
          : "ANALYST";
    const humanBackingHash = hash("human");
    const modelId =
      this.#manifest.gonka.models[index % this.#manifest.gonka.models.length] ??
      "unknown";
    const built = buildAgentManifestDocument({
      network: this.#manifest.network,
      backingKind: "TESTNET_DEMO_ALLOWLIST",
      humanBackingHash,
      humanVerificationProvider: DEMO_ALLOWLIST_VERIFICATION_PROVIDER,
      operationalOwner: owner as `0x${string}`,
      role,
      modelId,
      promptSpec: this.#gonka.promptSpec(),
      toolPolicy: this.#gonka.toolPolicy(),
      evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
    });
    const manifestUpload = await this.#walrus.put(built.bytes, {
      identifier: `agent-demo-${agentProfileId.slice(2, 18)}.json`,
    });
    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: agentProfileId as `0x${string}`,
      owner: owner as `0x${string}`,
      humanAttestationHash: humanBackingHash,
      humanVerificationProvider: DEMO_ALLOWLIST_VERIFICATION_PROVIDER,
      version: built.document.version,
      manifestBlobId: manifestUpload.blobId,
      manifestHash: built.manifestHash,
      promptHash: built.promptHash,
      modelId,
      providerId: "gonkarouter",
      toolPolicyHash: built.toolPolicyHash,
      evidencePolicyHash: built.document.evidencePolicyHash,
      publicKey: owner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: 0,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role,
      ...(agentCapId === undefined ? {} : { agentCapId }),
      active: true,
      reputation: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private async bindSeatsToEvidence(
    claimId: string,
    phase: 1 | 2,
    roundTallyId: string,
    evidenceBundleId: string,
    root: `0x${string}`,
  ): Promise<void> {
    // Idempotent and never fatal: each bind is signed by the seat's agent
    // (its own gas), so one failure must not take the whole round down. A
    // seat that stays unbound is retried by the next juryRun tick.
    const seats = await this.#repository.listJurySeats(claimId, phase);
    for (const seat of seats) {
      if (seat.evidenceBound) continue;
      try {
        await this.#gateway.bindJurySeatEvidence({
          jurySeatId: seat.jurySeatId,
          agentProfileId: seat.agentProfileId,
          roundTallyId,
          evidenceBundleId,
        });
      } catch (error) {
        process.stderr.write(
          `bind seat: claim ${claimId.slice(0, 10)}… seat ${seat.jurySeatId.slice(0, 10)}…: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        continue;
      }
      await this.#repository.saveJurySeat({
        ...seat,
        evidenceRoot: root,
        evidenceBound: true,
        updatedAt: this.isoNow(),
      });
    }
  }

  private async acceptOfferedSeats(
    claimId: string,
    phase: 1 | 2,
  ): Promise<void> {
    const seats = await this.#repository.listJurySeats(claimId, phase);
    for (const seat of seats) {
      if (seat.status !== "OFFERED") continue;
      await this.#gateway.acceptJurySeat({
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
      });
      await this.#repository.saveJurySeat({
        ...seat,
        status: "ACCEPTED",
        updatedAt: this.isoNow(),
      });
    }
  }

  private async updateSeat(
    jurySeatId: string,
    patch: Partial<Pick<JurySeatRecord, "status" | "commitment" | "runHash">>,
  ): Promise<void> {
    const seat = await this.#repository.getJurySeat(jurySeatId);
    if (!seat) throw new EngineStateError(`jury seat is missing: ${jurySeatId}`);
    await this.#repository.saveJurySeat({
      ...seat,
      ...patch,
      updatedAt: this.isoNow(),
    });
  }

  private async changePhase(
    claim: ClaimRecord,
    state: ClaimRecord["state"],
    transaction: TxResult,
  ): Promise<void> {
    await this.saveClaim({ ...claim, state, transactionDigest: transaction.digest });
    await this.emit({
      claimId: claim.claimId,
      phase: claimStateName(state),
      kind: "phase_changed",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction,
      payload: {
        claim_id: claim.claimId,
        previous_phase: claimStateName(claim.state),
        new_phase: claimStateName(state),
        checkpoint: transaction.checkpoint,
        transaction_digest: transaction.digest,
      },
    });
  }

  private async emitEvidenceSubmitted(record: EvidenceSubmissionRecord): Promise<void> {
    await this.emit({
      claimId: record.claimId,
      phase: `EVIDENCE_${record.phase}`,
      kind: "evidence_submitted",
      source: "EVIDENCE",
      visibility: "PUBLIC_NOW",
      payload: {
        claim_id: record.claimId,
        evidence_id: record.evidenceId,
        source_class: record.sourceClass,
      },
    });
  }

  private async emitEvidenceRetrieved(
    claimId: string,
    evidenceId: string,
    status: string,
    latencyMs: number,
    bytes: number,
  ): Promise<void> {
    await this.emit({
      claimId,
      phase: "EVIDENCE",
      kind: "evidence_retrieved",
      source: "EVIDENCE",
      visibility: "PUBLIC_NOW",
      payload: {
        evidence_id: evidenceId,
        status,
        latency_ms: latencyMs,
        bytes,
      },
    });
  }

  private async emit(input: {
    claimId: string;
    phase: string;
    kind: string;
    source: ResolutionEventSource;
    visibility: ResolutionEventVisibility;
    actorId?: string;
    runId?: string;
    transaction?: TxResult;
    transactionDigest?: string;
    artifactHash?: `0x${string}`;
    occurredAt?: string;
    publishedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<ResolutionEvent> {
    return this.#repository.appendResolutionEvent({
      eventId: randomUUID(),
      claimId: input.claimId,
      phase: input.phase,
      kind: input.kind,
      source: input.source,
      visibility: input.visibility,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      occurredAt: input.occurredAt ?? this.isoNow(),
      ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
      ...(input.transaction?.digest === undefined && input.transactionDigest === undefined
        ? {}
        : { transactionDigest: input.transaction?.digest ?? input.transactionDigest }),
      ...(input.transaction?.checkpoint === undefined
        ? {}
        : { checkpoint: input.transaction.checkpoint }),
      ...(input.artifactHash === undefined ? {} : { artifactHash: input.artifactHash }),
      payload: compactRecord(input.payload),
    });
  }

  private async claim(claimId: string): Promise<ClaimRecord> {
    const claim = await this.#repository.getClaim(claimId);
    if (!claim) throw new ClaimNotFoundError(claimId);
    return claim;
  }

  private async saveClaim(claim: ClaimRecord): Promise<ClaimRecord> {
    const updated = { ...claim, updatedAt: this.isoNow() };
    await this.#repository.saveClaim(updated);
    return updated;
  }

  /** Assemble only vote data already made public by the round one reveal. */
  private async roundOnePublicRecord(
    claimId: string,
  ): Promise<PriorRoundPublicRecord> {
    const [tally, reveals, runs] = await Promise.all([
      this.requiredTally(claimId, 1),
      this.#repository.listReveals(claimId, 1),
      this.#repository.listInferenceRuns(claimId, 1),
    ]);
    if (
      tally.revealedJurySeatIds.length === 0 ||
      reveals.length !== tally.revealedJurySeatIds.length
    ) {
      throw new EngineStateError("round one revealed public record is incomplete");
    }
    const seatIndexById = new Map(
      tally.expectedJurySeatIds.map((jurySeatId, seatIndex) => [
        jurySeatId,
        seatIndex,
      ]),
    );
    const revealBySeat = new Map(
      reveals.map((reveal) => [reveal.jurySeatId, reveal]),
    );
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const seats = tally.revealedJurySeatIds.map((jurySeatId) => {
      const seatIndex = seatIndexById.get(jurySeatId);
      const reveal = revealBySeat.get(jurySeatId);
      const run = reveal === undefined ? undefined : runById.get(reveal.runId);
      if (seatIndex === undefined || reveal === undefined || run?.output === undefined) {
        throw new EngineStateError(
          `round one revealed public record is missing seat ${jurySeatId}`,
        );
      }
      return {
        seatIndex,
        modelId: run.modelId,
        outcome: outcomeLabel(reveal.outcome),
        confidenceBps: reveal.confidenceBps,
        publicReasoningTrace: run.output.publicReasoningTrace,
      };
    });
    return {
      phase: 1,
      seats: seats.sort((left, right) => left.seatIndex - right.seatIndex),
    };
  }

  private async ensureRoundOnePublicRecordArtifact(
    claim: ClaimRecord,
    priorRound: PriorRoundPublicRecord,
  ): Promise<EvidenceArtifactRecord> {
    const evidenceId = roundOnePublicRecordEvidenceId(claim.claimId);
    const content = canonicalJsonString(priorRound);
    const contentHash = toHex(blake2b256(new TextEncoder().encode(content)));
    const existing = await this.#repository.getEvidenceArtifact(evidenceId);
    if (existing !== undefined) {
      if (
        existing.claimId !== claim.claimId ||
        existing.phase !== 2 ||
        existing.sourceUrl !== ROUND_ONE_PUBLIC_RECORD_SOURCE_URL ||
        existing.contentHash !== contentHash
      ) {
        throw new EngineStateError("round one public record evidence is inconsistent");
      }
      return existing;
    }
    await this.ingestText(claim, content, 2, {
      evidenceId,
      sourceUrl: ROUND_ONE_PUBLIC_RECORD_SOURCE_URL,
    });
    const artifact = await this.#repository.getEvidenceArtifact(evidenceId);
    if (artifact === undefined) {
      throw new EngineStateError("round one public record evidence is missing");
    }
    return artifact;
  }

  private async artifactsForPhase(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceArtifactRecord[]> {
    const artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 1) return statementArtifactFirst(artifacts);
    const publicRecordEvidenceId = roundOnePublicRecordEvidenceId(claimId);
    const publicRecordArtifact = artifacts.find(
      (artifact) => artifact.evidenceId === publicRecordEvidenceId,
    );
    if (publicRecordArtifact === undefined) {
      throw new EngineStateError("round one public record evidence is missing");
    }
    let secondRoundArtifacts = artifacts.filter(
      (artifact) => artifact.evidenceId !== publicRecordEvidenceId,
    );
    if (secondRoundArtifacts.length === 0) {
      secondRoundArtifacts = await this.#repository.listEvidenceArtifacts(claimId, 1);
    }
    return [
      ...statementArtifactFirst(secondRoundArtifacts),
      publicRecordArtifact,
    ];
  }

  private async evidenceManifests(claimId: string): Promise<EvidenceManifestRecord[]> {
    const values = await Promise.all([
      this.#repository.getEvidenceManifest(claimId, 1),
      this.#repository.getEvidenceManifest(claimId, 2),
    ]);
    return values.filter((value): value is EvidenceManifestRecord => value !== undefined);
  }

  private isoNow(): string {
    return new Date(this.#now()).toISOString();
  }
}

type ValidatedZkBackedRegistrationRequest = ZkBackedRegistrationRequest & {
  zkLoginAddress: `0x${string}`;
  role: ZkLoginAgentRole;
};

function validateZkBackedRegistrationRequest(
  request: ZkBackedRegistrationRequest,
  manifest: ReleaseManifest,
): asserts request is ValidatedZkBackedRegistrationRequest {
  if (
    typeof request.zkLoginAddress !== "string" ||
    !SUI_ADDRESS_PATTERN.test(request.zkLoginAddress)
  ) {
    throw new EngineValidationError(
      "zkLoginAddress must be a canonical lowercase 32-byte Sui address",
    );
  }
  if (
    typeof request.signature !== "string" ||
    request.signature.length === 0 ||
    request.signature.length > MAX_ZKLOGIN_SIGNATURE_LENGTH ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(request.signature)
  ) {
    throw new EngineValidationError("signature must be a bounded base64 string");
  }
  if (
    typeof request.modelId !== "string" ||
    !manifest.gonka.models.includes(request.modelId)
  ) {
    throw new EngineValidationError(
      "modelId must be present in the release manifest catalog",
    );
  }
  if (typeof request.role !== "string" || !isZkLoginAgentRole(request.role)) {
    throw new EngineValidationError(
      `role must be one of ${ZKLOGIN_AGENT_ROLES.join(", ")}`,
    );
  }
}

function isZkLoginAgentRole(role: string): role is ZkLoginAgentRole {
  return ZKLOGIN_AGENT_ROLES.some((candidate) => candidate === role);
}

function createDefaultZkLoginVerifier(config: EngineConfig): ZkLoginVerifier {
  const configuredUrl = config.zkLoginGraphqlUrl?.trim();
  const graphqlUrl =
    configuredUrl ||
    (config.network === "localnet"
      ? undefined
      : `https://sui-${config.network}.mystenlabs.com/graphql`);
  return new MystenSdkZkLoginVerifier(config.network, graphqlUrl);
}

/** Uses the SDK helper, which delegates zkLogin JWK/epoch checks to GraphQL. */
class MystenSdkZkLoginVerifier implements ZkLoginVerifier {
  readonly #client?: SuiGraphQLClient;

  constructor(
    network: EngineConfig["network"],
    graphqlUrl: string | undefined,
  ) {
    if (graphqlUrl) {
      this.#client = new SuiGraphQLClient({
        network,
        url: graphqlUrl,
      });
    }
  }

  async verify(input: ZkLoginVerificationInput): Promise<boolean> {
    try {
      if (parseSerializedSignature(input.signature).signatureScheme !== "ZkLogin") {
        return false;
      }
    } catch {
      return false;
    }

    if (!this.#client) {
      throw new Error(
        "zkLogin GraphQL verification requires zkLoginGraphqlUrl on localnet",
      );
    }

    return isValidPersonalMessageSignature(input.message, input.signature, {
      address: input.zkLoginAddress,
      client: this.#client,
    });
  }
}

function resolveGateway(config: EngineConfig, manifest: ReleaseManifest): SuiGateway {
  if (config.suiGateway) return config.suiGateway;
  if (!config.suiClient || !config.signers) {
    throw new EngineValidationError(
      "createEngine requires suiClient and signers when suiGateway is not injected",
    );
  }
  return createSuiGateway({
    client: config.suiClient,
    signers: config.signers,
    manifest,
  });
}

export function manifestEvidencePolicy(manifest: ReleaseManifest): RetrievalPolicy {
  return manifest.evidencePolicy
    ? {
        maxBytes: manifest.evidencePolicy.maxBytes,
        maxRedirects: manifest.evidencePolicy.maxRedirects,
        timeoutMs: manifest.evidencePolicy.timeoutMs,
        allowedMime: manifest.evidencePolicy.allowedMime,
      }
    : DEFAULT_EVIDENCE_POLICY;
}

function evidencePolicyId(manifest: ReleaseManifest): `0x${string}` {
  return (
    manifest.evidencePolicy?.id ??
    toHex(blake2b256(new TextEncoder().encode(EVIDENCE_POLICY_V1_LABEL)))
  ) as `0x${string}`;
}

/** Time reserved after the last seat for lock_committee, approvals and commit_vote txs. */
const SEAT_COMMIT_MARGIN_MS = 60_000;
/** How often juryRun retries the queued commit between the acceptance floor and the deadline. */
const COMMIT_PUMP_INTERVAL_MS = 5_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Chain floor for lock_committee: the midpoint between the phase start and
 * the commit deadline (jury.move acceptance_deadline_ms). The database
 * timestamps trail the chain by a few seconds, so this estimate is never
 * early; an unparsable timestamp defers to the worker's final votesCommit.
 */
function acceptanceFloorMs(
  committee: CommitteeRecord,
  phase: 1 | 2,
  commitDeadlineMs: number,
): number {
  const startMs = Date.parse(phase === 1 ? committee.createdAt : committee.updatedAt);
  if (!Number.isFinite(startMs) || startMs >= commitDeadlineMs) return commitDeadlineMs;
  return startMs + Math.floor((commitDeadlineMs - startMs) / 2) + 2_000;
}

function defaultDeadlines(
  now: number,
  network: ReleaseManifest["network"],
): ClaimCreateRequest["deadlines"] {
  if (network === "localnet") {
    // Worker-friendly ladder: multi-process worker cadence (poll loops +
    // acceptance window = selection + half-way-to-commit) needs real room, or
    // browser-submitted claims miss every commit window and finalize
    // UNRESOLVED. Test harnesses pass explicit deadlines and are unaffected.
    return {
      evidenceCutoffMs: now + 45_000,
      proposalDeadlineMs: now + 50_000,
      challengeDeadlineMs: now + 55_000,
      // Minutes-scale windows: the three workers share one operator signer,
      // so equivocation stalls (objects reserved by a sibling's tx) can eat
      // tens of seconds per phase; short ladders lose whole windows to it.
      firstCommitDeadlineMs: now + 360_000,
      firstRevealDeadlineMs: now + 480_000,
      discussionDeadlineMs: now + 540_000,
      secondCommitDeadlineMs: now + 720_000,
      secondRevealDeadlineMs: now + 840_000,
    };
  }
  // Fast ladder (hosted), measured from the create_claim transaction (the
  // request's own Walrus writes come before it): a certificate can land
  // only after the reveal deadline (settlement.move) and the committee
  // locks only after the midpoint of the commit window (jury.move), so
  // these windows, not the models, set the time to resolution. The cutoff
  // leaves room for the statement artifact write that follows creation;
  // hosted seats took 19 to 45 s with page writes off the critical path; a
  // seat that misses the commit window fails closed and 4 of 5 still settle.
  // Committees must span three model families (jury.move
  // E_INSUFFICIENT_DIVERSE_AGENTS) and a round needs four matching reveals
  // of five (REQUIRED_MATCHING), so the slowest family must usually make it:
  // Kimi-K2.6 answered in 33 to 100 s on 2026-08-30. Juror research v2
  // (a support search, a challenge search, pages on both sides, nudges)
  // runs six to ten turns per seat; with a 240 s commit window every
  // seat of claim #20 hit the seat deadline mid-research, so the commit
  // window is 330 s (about 230 s of research). The reveal window must
  // hold the advance (about 15 s after the commit deadline) plus five
  // reveal-bundle writes, which run one at a time on the operator lane at
  // about 15 s each: a 60 s window lost every reveal of claim #15, so it
  // is 120 s.
  // 2026-08-30 22:30: the owner keeps all jurors at equal selection weight
  // and accepts slower verdicts so that the slow family finishes. Kimi's
  // calls on claim #22 took 60, 5 and 36 s and its fourth (the minimum
  // trail under policy v4 is four turns) was cut at 97 s by the seat
  // bound, so the commit window grows from 330 s to 450 s (about 350 s of
  // research; a certificate lands about 10 min after the POST). The reveal
  // window and the discussion window keep their lengths and shift with it.
  // 2026-08-30 23:00: round two used to get only 120 s of research (its
  // commit deadline minus the 60 s seat margin minus the discussion
  // deadline), a sprint that cut two seats of claim #24 mid-call and left
  // every two-round claim UNRESOLVED, so the second commit window is now
  // as long as the first (450 s after the discussion deadline) and the
  // second reveal window stays 120 s: a two-round claim ends about 21 min
  // after the POST, a one-round verdict still at about 10 min.
  const second = 1_000;
  return {
    evidenceCutoffMs: now + 60 * second,
    proposalDeadlineMs: now + 65 * second,
    challengeDeadlineMs: now + 70 * second,
    firstCommitDeadlineMs: now + 450 * second,
    firstRevealDeadlineMs: now + 570 * second,
    discussionDeadlineMs: now + 630 * second,
    secondCommitDeadlineMs: now + 1080 * second,
    secondRevealDeadlineMs: now + 1200 * second,
  };
}

function validateFactCheckRequest(request: FactCheckRequest): void {
  if (request.claim.trim().length === 0 || request.claim.length > 32_000) {
    throw new EngineValidationError("claim must contain 1 to 32000 characters");
  }
  if (
    request.text !== undefined &&
    request.text.length > MAX_FACT_CHECK_TEXT_LENGTH
  ) {
    throw new EngineValidationError(
      `text exceeds maximum length of ${MAX_FACT_CHECK_TEXT_LENGTH} characters`,
    );
  }
  validateHttpsUrls(request.urls);
}

function validateClaimCreateRequest(request: ClaimCreateRequest): void {
  if (request.statement.trim().length === 0 || request.statement.length > 32_000) {
    throw new EngineValidationError("statement must contain 1 to 32000 characters");
  }
  if (
    request.resolutionCriteria.trim().length === 0 ||
    request.resolutionCriteria.length > 32_000
  ) {
    throw new EngineValidationError(
      "resolution criteria must contain 1 to 32000 characters",
    );
  }
  const deadlines = Object.values(request.deadlines);
  if (
    deadlines.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    deadlines.some((value, index) => index > 0 && value <= deadlines[index - 1]!)
  ) {
    throw new EngineValidationError("claim deadlines must be safe, strictly increasing milliseconds");
  }
  for (const [name, value] of [
    ["committeeBudget", request.committeeBudget],
    ["evidenceBudget", request.evidenceBudget],
  ] as const) {
    if (!/^\d+$/.test(value)) {
      throw new EngineValidationError(`${name} must be a non-negative decimal string`);
    }
  }
}

function validateHttpsUrls(urls: string[]): void {
  if (urls.length > 16) throw new EngineValidationError("at most 16 evidence URLs are allowed");
  for (const value of urls) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new EngineValidationError(`invalid evidence URL: ${value}`);
    }
    if (parsed.protocol !== "https:") {
      throw new EngineValidationError(`evidence URL must use HTTPS: ${value}`);
    }
  }
}

function emptyTally(committee: CommitteeRecord, timestamp: string): RoundTallyRecord {
  return {
    roundTallyId: committee.roundTallyId,
    claimId: committee.claimId,
    committeeId: committee.committeeId,
    phase: committee.phase,
    expectedJurySeatIds: committee.jurySeatIds,
    revealedJurySeatIds: [],
    revealedVoteIds: [],
    yesCount: 0,
    noCount: 0,
    unsureCount: 0,
    truthProbabilitySumBps: 0,
    truthProbabilityCount: 0,
    closed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toEvidenceManifestItem(record: EvidenceArtifactRecord): EvidenceManifestItem {
  return {
    evidenceId: record.evidenceId,
    contentHash: fromHex(record.contentHash),
    canonicalHash: fromHex(record.canonicalHash),
    sourceUrl: record.sourceUrl,
    finalUrl: record.finalUrl,
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    retrievedAt: Date.parse(record.retrievedAt),
    parserVersion: record.parserVersion,
    rawWalrusBlobId: record.rawWalrusBlobId,
    ...(record.rawWalrusObjectId === undefined
      ? {}
      : { rawWalrusObjectId: record.rawWalrusObjectId as `0x${string}` }),
    canonicalWalrusBlobId: record.canonicalWalrusBlobId,
    ...(record.canonicalWalrusObjectId === undefined
      ? {}
      : { canonicalWalrusObjectId: record.canonicalWalrusObjectId as `0x${string}` }),
    ...(record.walrusEndEpoch === undefined
      ? {}
      : { walrusEndEpoch: record.walrusEndEpoch }),
  };
}

function uniqueEvidenceArtifacts(
  artifacts: EvidenceArtifactRecord[],
): EvidenceArtifactRecord[] {
  const contentHashes = new Set<string>();
  const canonicalHashes = new Set<string>();
  return artifacts.filter((artifact) => {
    if (
      contentHashes.has(artifact.contentHash) ||
      canonicalHashes.has(artifact.canonicalHash)
    ) {
      return false;
    }
    contentHashes.add(artifact.contentHash);
    canonicalHashes.add(artifact.canonicalHash);
    return true;
  });
}

function statementArtifactFirst(
  artifacts: EvidenceArtifactRecord[],
): EvidenceArtifactRecord[] {
  return [
    ...artifacts.filter(
      (artifact) => artifact.sourceUrl === CLAIM_STATEMENT_SOURCE_URL,
    ),
    ...artifacts.filter(
      (artifact) => artifact.sourceUrl !== CLAIM_STATEMENT_SOURCE_URL,
    ),
  ];
}

function roundOnePublicRecordEvidenceId(claimId: string): string {
  return `round-1-public-record:${claimId}`;
}

function canonicalArtifact(artifact: RetrievedArtifact): {
  text: string;
  parserVersion: string;
} {
  if (artifact.mimeType === "text/html") return canonicalizeHtml(artifact.bytes);
  if (artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json") {
    return {
      text: new TextDecoder("utf8", { fatal: false }).decode(artifact.bytes).trim(),
      parserVersion: "utf8-text-v1",
    };
  }
  return {
    text: Buffer.from(artifact.bytes).toString("base64"),
    parserVersion: "binary-base64-v1",
  };
}

function endEpoch(...uploads: WalrusPutResult[]): number | undefined {
  const epochs = uploads.flatMap((upload) =>
    upload.endEpoch === undefined ? [] : [upload.endEpoch],
  );
  return epochs.length === 0 ? undefined : Math.min(...epochs);
}

function oracleInput(
  claim: ClaimRecord,
  seat: JurySeatRecord,
  manifest: EvidenceManifestRecord,
  artifacts: EvidenceArtifactRecord[],
  priorRound: PriorRoundPublicRecord | undefined,
  role: string,
  runId: string,
  promptVersion: "2" | "3" | "4",
): OracleInferenceInput {
  return {
    protocolVersion: "1.0",
    runId,
    agentRole: role,
    promptVersion,
    submission: {
      kind:
        claim.submittedText && claim.submittedUrls.length > 0
          ? "TEXT_AND_URL"
          : claim.submittedText
            ? "TEXT"
            : "URL",
      ...(claim.submittedText === undefined
        ? {}
        : {
            submittedTextHash: toHex(
              blake2b256(new TextEncoder().encode(claim.submittedText)),
            ),
          }),
      submittedUrls: claim.submittedUrls,
    },
    claim: {
      statement: claim.statement,
      resolutionCriteria: claim.resolutionCriteria,
      outcomes: ["YES", "NO", "UNSURE"],
      relevantDeadline: new Date(
        seat.phase === 1
          ? claim.deadlines.firstCommitDeadlineMs
          : claim.deadlines.secondCommitDeadlineMs,
      ).toISOString(),
    },
    evidenceManifest: {
      root: manifest.root,
      items: artifacts.map((artifact) => ({
        evidenceId: artifact.evidenceId,
        sourceClass: "USER_SUBMITTED",
        retrievedAt: artifact.retrievedAt,
        walrusBlobId: artifact.canonicalWalrusBlobId,
        contentHash: artifact.contentHash,
        excerpt: artifact.excerpt,
      })),
    },
    ...(priorRound === undefined ? {} : { priorRound }),
    outputContract: {
      requiredOutcome: true,
      requiredEvidenceIds: true,
      maximumReasonLength: 4_000,
    },
  };
}

function toAgentRunSummary(run: InferenceRunRecord): AgentRunSummary {
  return {
    runId: run.runId,
    agentProfileId: run.agentProfileId,
    modelId: run.modelId,
    gonkaRequestId: run.gonkaRequestId,
    status: run.audit.status,
    attempt: run.attempt,
    latencyMs: run.latencyMs,
  };
}

function terminalFailureAudit(error: unknown): InferenceRunAudit | undefined {
  if (!(error instanceof GonkaRunError)) return undefined;
  return error.result.attempts.at(-1)?.audit;
}

function terminalFailureStatus(
  error: unknown,
): InferenceRunAudit["status"] | undefined {
  return error instanceof ResearchLoopError ? error.status : undefined;
}

function outcomeCode(outcome: OracleInferenceOutput["outcome"]): VoteOutcome {
  if (outcome === "YES") return OUTCOME.YES;
  if (outcome === "NO") return OUTCOME.NO;
  return OUTCOME.UNSURE;
}

function addRevealToTally(
  tally: RoundTallyRecord,
  reveal: RevealRecord,
): RoundTallyRecord {
  return {
    ...tally,
    revealedJurySeatIds: [...tally.revealedJurySeatIds, reveal.jurySeatId],
    revealedVoteIds: [...tally.revealedVoteIds, reveal.revealedVoteId],
    yesCount: tally.yesCount + (reveal.outcome === OUTCOME.YES ? 1 : 0),
    noCount: tally.noCount + (reveal.outcome === OUTCOME.NO ? 1 : 0),
    unsureCount: tally.unsureCount + (reveal.outcome === OUTCOME.UNSURE ? 1 : 0),
    truthProbabilitySumBps:
      tally.truthProbabilitySumBps +
      agentProbabilityBps(reveal.outcome, reveal.confidenceBps),
    truthProbabilityCount: tally.truthProbabilityCount + 1,
    updatedAt: reveal.updatedAt,
  };
}

function thresholdOutcome(tally: RoundTallyRecord): VoteOutcome | null {
  if (tally.yesCount >= 4) return OUTCOME.YES;
  if (tally.noCount >= 4) return OUTCOME.NO;
  if (tally.unsureCount >= 4) return OUTCOME.UNSURE;
  return null;
}

function assertCommitState(state: ClaimRecord["state"], phase: 1 | 2): void {
  const expected = phase === 1 ? CLAIM_STATE.COMMIT_1 : CLAIM_STATE.COMMIT_2;
  if (state !== expected) {
    throw new EngineStateError(`round ${phase} votes cannot commit in ${claimStateName(state)}`);
  }
}

function assertRevealState(state: ClaimRecord["state"], phase: 1 | 2): void {
  const expected = phase === 1 ? CLAIM_STATE.REVEAL_1 : CLAIM_STATE.REVEAL_2;
  if (state !== expected) {
    throw new EngineStateError(`round ${phase} votes cannot reveal in ${claimStateName(state)}`);
  }
}

function certificateToFinalizeReport(
  record: ResolutionCertificateRecord,
): FinalizeReport {
  return {
    claimId: record.claimId,
    result: record.result,
    truthScoreBps: record.truthScoreBps ?? null,
    certificateId: record.certificateId,
    digest: record.transactionDigest,
  };
}

function toAgentCard(
  reveal: RevealRecord,
  run: InferenceRunRecord & { output: OracleInferenceOutput },
  agent: AgentManifestRecord,
): AgentCard {
  return {
    agentProfileId: reveal.agentProfileId,
    owner: agent.manifest.owner,
    modelId: run.modelId,
    role: agent.role,
    outcome: outcomeLabel(reveal.outcome),
    confidenceBps: reveal.confidenceBps,
    gonkaRequestId: run.gonkaRequestId,
    evidenceIds: citedEvidenceIds(run.output),
    reasoning: run.output.reasoning,
    publicReasoningTrace: run.output.publicReasoningTrace,
  };
}

function citedEvidenceIds(output: OracleInferenceOutput): string[] {
  return [
    ...new Set([
      ...output.evidenceFor,
      ...output.evidenceAgainst,
      ...output.unsupportedClaims,
      ...output.decisiveEvidence,
      ...output.publicReasoningTrace.flatMap((entry) => entry.evidenceIds),
    ]),
  ];
}

function claimStateName(state: ClaimRecord["state"]): string {
  const name = Object.entries(CLAIM_STATE).find(([, value]) => value === state)?.[0];
  return name ?? `UNKNOWN_${state}`;
}

function isTerminalState(state: ClaimRecord["state"]): boolean {
  return (
    state === CLAIM_STATE.FINALIZED_UNCHALLENGED ||
    state === CLAIM_STATE.FINALIZED_REVIEWED ||
    state === CLAIM_STATE.UNRESOLVED ||
    state === CLAIM_STATE.CANCELLED
  );
}

function deterministicId(label: string): `0x${string}` {
  return toHex(blake2b256(new TextEncoder().encode(label)));
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import { randomBytes, randomUUID } from "node:crypto";
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
  hashCanonicalJson,
  type GonkaRouterAdapter,
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
  type InferenceRunAudit,
  type OracleInferenceInput,
  type OracleInferenceOutput,
  type VoteOutcome,
} from "../protocol";
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
} from "../storage";
import {
  createSuiGateway,
  loadReleaseManifest,
  outcomeLabel,
  type ReleaseManifest,
  type SuiGateway,
} from "../sui";
import { serializePublicEvent } from "../events";
import type { WalrusStore, WalrusPutResult } from "../walrus";
import type {
  AgentCard,
  AgentDirectoryEntry,
  AgentRunSummary,
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
  TxResult,
} from "./contract";
import type { EngineAgentConfig, EngineConfig } from "./config";
import {
  ClaimNotFoundError,
  EngineStateError,
  EngineValidationError,
} from "./errors";

const ZERO_OBJECT_ID = `0x${"00".repeat(32)}` as const;
const MAX_LOCAL_WALRUS_EPOCH = Number.MAX_SAFE_INTEGER;
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
  now: () => number;
  retrieve: NonNullable<EngineConfig["retrieve"]>;
  retrievalPolicy: RetrievalPolicy;
  eventPollIntervalMs: number;
}

export async function createEngine(config: EngineConfig): Promise<Engine> {
  const manifest = await loadReleaseManifest(config.manifestPath);
  if (manifest.network !== config.network) {
    throw new EngineValidationError(
      `engine network ${config.network} does not match manifest network ${manifest.network}`,
    );
  }
  await migrate(config.db);
  const repository = createRepository(config.db);
  const gateway = resolveGateway(config, manifest);
  const engine = new OpenVerdictEngine({
    repository,
    manifest,
    gateway,
    walrus: config.walrus,
    gonka: config.gonka,
    now: config.now ?? Date.now,
    retrieve: config.retrieve ?? retrieveEvidence,
    retrievalPolicy: config.retrievalPolicy ?? manifestEvidencePolicy(manifest),
    eventPollIntervalMs: config.eventPollIntervalMs ?? 1_000,
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
  readonly #now: () => number;
  readonly #retrieve: NonNullable<EngineConfig["retrieve"]>;
  readonly #retrievalPolicy: RetrievalPolicy;
  readonly #eventPollIntervalMs: number;

  constructor(dependencies: EngineDependencies) {
    this.#repository = dependencies.repository;
    this.#manifest = dependencies.manifest;
    this.#gateway = dependencies.gateway;
    this.#walrus = dependencies.walrus;
    this.#gonka = dependencies.gonka;
    this.#now = dependencies.now;
    this.#retrieve = dependencies.retrieve;
    this.#retrievalPolicy = dependencies.retrievalPolicy;
    this.#eventPollIntervalMs = dependencies.eventPollIntervalMs;
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
    const deadlines =
      req.deadlines ?? defaultDeadlines(this.#now(), this.#manifest.network);
    if (process.env.OPENVERDICT_DEBUG_DEADLINES === "1") {
      console.error("FCS req.deadlines:", JSON.stringify(req.deadlines));
      console.error("FCS effective:", JSON.stringify(deadlines), "now:", Date.now());
    }
    const resolutionCriteria =
      req.resolutionCriteria?.trim() ||
      "Determine whether the bounded claim is supported by the frozen evidence available before the evidence cutoff. Return YES, NO, or UNSURE when evidence conflicts or is insufficient.";
    const claim = await this.createClaimRecord(
      {
        statement: req.claim.trim(),
        resolutionCriteria,
        mode: CLAIM_MODE.DIRECT_REVIEW,
        deadlines,
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
    await this.claim(claimId);
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

    let artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 2 && artifacts.length === 0) {
      artifacts = await this.#repository.listEvidenceArtifacts(claimId, 1);
    }
    artifacts = uniqueEvidenceArtifacts(artifacts);
    if (artifacts.length === 0) {
      throw new EngineStateError("evidence cannot be frozen without an accepted artifact");
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
      walrusEndEpoch: manifestUpload.endEpoch ?? MAX_LOCAL_WALRUS_EPOCH,
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
    const artifacts = await this.artifactsForPhase(claimId, phase);

    await Promise.all(
      seats.map(async (seat) => {
        const existing = (await this.#repository.listInferenceRuns(claimId, phase)).find(
          (run) => run.jurySeatId === seat.jurySeatId,
        );
        if (existing !== undefined) return;
        await this.runSeat(claim, committee, seat, evidence, artifacts);
      }),
    );
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
    if (!committee.locked) {
      await this.#gateway.lockCommittee({
        claimId,
        committeeId: committee.committeeId,
        roundTallyId: (await this.requiredTally(claimId, phase)).roundTallyId,
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

    for (const votePackage of packages) {
      if (!votePackage.committed || votePackage.revealed) continue;
      const run = runById.get(votePackage.runId);
      if (!run?.output || !run.runHash || !run.runWalrusBlobId) continue;
      const result = await this.#gateway.revealVote({
        jurySeatId: votePackage.jurySeatId,
        roundTallyId: tally.roundTallyId,
        agentProfileId: votePackage.agentProfileId,
        outcome: votePackage.outcome,
        confidenceBps: votePackage.confidenceBps,
        outputHash: fromHex(votePackage.outputHash),
        runHash: fromHex(votePackage.runHash),
        salt: fromHex(votePackage.saltHex),
        argumentBlobId: run.runWalrusBlobId,
        argumentBlobObjectId: run.runWalrusObjectId ?? ZERO_OBJECT_ID,
        argumentWalrusEndEpoch: run.walrusEndEpoch ?? MAX_LOCAL_WALRUS_EPOCH,
      });
      const timestamp = this.isoNow();
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
          reasoning_trace_hash: hashCanonicalJson(run.output.publicReasoningTrace),
          evidence_ids: citedEvidenceIds(run.output),
          reasoning: run.output.reasoning,
          public_reasoning_trace: run.output.publicReasoningTrace,
        },
      });
      results.push(result);
    }
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
      const result = await this.#gateway.advancePhase(claimId);
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
      await this.bindSeatsToEvidence(
        claimId,
        2,
        result.roundTallyId,
        evidenceBundleId,
        evidence.root,
      );
      await this.changePhase(claim, CLAIM_STATE.COMMIT_2, result);
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
    const seats = [
      ...(await this.#repository.listJurySeats(claimId, 1)),
      ...(await this.#repository.listJurySeats(claimId, 2)),
    ];
    const packageBySeat = new Map(packages.map((item) => [item.jurySeatId, item]));
    const reveals = await this.#repository.listReveals(claimId);
    const revealBySeat = new Map(reveals.map((reveal) => [reveal.jurySeatId, reveal]));
    const commitments: CommitmentStatus[] = seats.map((seat) => {
      const item = packageBySeat.get(seat.jurySeatId);
      const reveal = revealBySeat.get(seat.jurySeatId);
      return {
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        committed: item?.committed ?? false,
        revealed: item?.revealed ?? false,
        ...(reveal === undefined
          ? {}
          : { outcome: reveal.outcome, confidenceBps: reveal.confidenceBps }),
      };
    });
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
    return (await this.#repository.listAgentManifests()).map((record) => ({
      agentProfileId: record.manifest.agentProfileId,
      owner: record.manifest.owner,
      modelId: record.manifest.modelId,
      role: record.role,
      manifestHash: record.manifest.manifestHash,
      active: record.active,
      reputation: record.reputation,
    }));
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
    request: ClaimCreateRequest,
    submission: {
      directReviewStarted: boolean;
      submittedText?: string;
      submittedUrls: string[];
    },
  ): Promise<ClaimRecord> {
    validateClaimCreateRequest(request);
    const statementUpload = await this.#walrus.put(
      new TextEncoder().encode(request.statement),
      { identifier: "claim-statement.txt" },
    );
    const criteriaUpload = await this.#walrus.put(
      new TextEncoder().encode(request.resolutionCriteria),
      { identifier: "resolution-criteria.txt" },
    );
    const policyId = evidencePolicyId(this.#manifest);
    const contentHash = blake2b256(
      canonicalJsonBytes({
        statement: request.statement,
        resolutionCriteria: request.resolutionCriteria,
      }),
    );
    const result = await this.#gateway.createClaim({
      ...request,
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
      deadlines: request.deadlines,
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
  ): Promise<void> {
    const evidenceId = deterministicId(`text:${claim.claimId}:${phase}`);
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
      sourceUrl: "urn:openverdict:submitted-text",
      finalUrl: "urn:openverdict:submitted-text",
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
  ): Promise<void> {
    const agent = await this.requiredAgent(seat.agentProfileId);
    const baseRunId = deterministicId(`run:${claim.claimId}:${seat.jurySeatId}:${seat.phase}`);
    const input = oracleInput(claim, seat, evidence, artifacts, agent.role, baseRunId);
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
      const response = await this.#gonka.run(input, agent.manifest);
      const normalized = await this.#gonka.normalizeResponse(response);
      await this.#gonka.validateOutput(normalized.output, input.evidenceManifest);
      const adapterAudit = await this.#gonka.buildRunAudit(response);
      const rawUpload = await this.#walrus.put(
        new TextEncoder().encode(JSON.stringify(response)),
        { identifier: `${baseRunId}-gonka-response.json` },
      );
      const toolUpload = await this.#walrus.put(new TextEncoder().encode("[]"), {
        identifier: `${baseRunId}-tool-transcript.json`,
      });
      // One canonical run ID spans visible retry attempts for this jury seat.
      const runId = baseRunId;
      const outputHash = toHex(blake2b256(canonicalJsonBytes(normalized.output)));
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
        runWalrusBlobId: rawUpload.blobId,
        toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
        toolTranscriptWalrusBlobId: toolUpload.blobId,
        evidenceRoot: evidence.root,
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
      const runBundleUpload = await this.#walrus.put(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            rawResponse: response,
            validatedOutput: normalized.output,
            audit,
            runHash,
          }),
        ),
        { identifier: `${baseRunId}-public-run-bundle.json` },
      );
      const retainedUntil =
        endEpoch(runBundleUpload, toolUpload) ?? MAX_LOCAL_WALRUS_EPOCH;
      const approval = await this.#gateway.approveRun({
        claimId: claim.claimId,
        committeeId: committee.committeeId,
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        agentOwner: seat.agentOwner,
        phase: seat.phase,
        runHash: fromHex(runHash),
        runBlobId: runBundleUpload.blobId,
        runBlobObjectId: runBundleUpload.objectId ?? ZERO_OBJECT_ID,
        toolBlobId: toolUpload.blobId,
        toolBlobObjectId: toolUpload.objectId ?? ZERO_OBJECT_ID,
        walrusEndEpoch: retainedUntil,
      });
      const timestamp = this.isoNow();
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
        runWalrusBlobId: runBundleUpload.blobId,
        ...(runBundleUpload.objectId === undefined
          ? {}
          : { runWalrusObjectId: runBundleUpload.objectId }),
        toolTranscriptHash: audit.toolTranscriptHash,
        toolTranscriptWalrusBlobId: toolUpload.blobId,
        ...(toolUpload.objectId === undefined
          ? {}
          : { toolTranscriptWalrusObjectId: toolUpload.objectId }),
        walrusEndEpoch: retainedUntil,
        evidenceRoot: evidence.root,
        validationStatus: "SCHEMA_VALID",
        latencyMs: audit.latencyMs,
        ...(audit.inputTokens === undefined ? {} : { inputTokens: audit.inputTokens }),
        ...(audit.outputTokens === undefined ? {} : { outputTokens: audit.outputTokens }),
        output: normalized.output,
        audit,
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
    }
  }

  private async persistInferenceFailure(
    claim: ClaimRecord,
    seat: JurySeatRecord,
    agent: AgentManifestRecord,
    input: OracleInferenceInput,
    error: unknown,
  ): Promise<void> {
    const failedAudit = terminalFailureAudit(error);
    const timestampMs = this.#now();
    const runId = failedAudit?.runId ?? deterministicId(`failed:${input.runId}`);
    const status = failedAudit?.status ?? "PROVIDER_ERROR";
    const timestamp = new Date(timestampMs).toISOString();
    const zeroHash = hashCanonicalJson(null);
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
      claimObjectId: claim.claimId as `0x${string}`,
      agentProfileId: seat.agentProfileId as `0x${string}`,
      jurySeatId: seat.jurySeatId as `0x${string}`,
      phase: seat.phase,
      promptHash: agent.manifest.promptHash,
      inputHash: hashCanonicalJson(input),
      evidenceRoot: input.evidenceManifest.root as `0x${string}`,
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
      validationStatus: "NO_VALID_INFERENCE",
      latencyMs: audit.latencyMs,
      audit,
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
    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: agentProfileId as `0x${string}`,
      owner: owner as `0x${string}`,
      humanAttestationHash: hash("human"),
      humanVerificationProvider: "demo-allowlist",
      version: "1",
      manifestBlobId: `unindexed-${agentProfileId}`,
      manifestHash: hash("manifest"),
      promptHash: hash("prompt"),
      modelId: this.#manifest.gonka.models[index % this.#manifest.gonka.models.length] ?? "unknown",
      providerId: "gonkarouter",
      toolPolicyHash: hash("tools"),
      evidencePolicyHash: evidencePolicyId(this.#manifest),
      publicKey: owner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: 0,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role: index === 0 ? "SKEPTIC" : index === 1 ? "SOURCE_AUTHENTICITY" : "ANALYST",
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
    const seats = await this.#repository.listJurySeats(claimId, phase);
    for (const seat of seats) {
      await this.#gateway.bindJurySeatEvidence({
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        roundTallyId,
        evidenceBundleId,
      });
      await this.#repository.saveJurySeat({
        ...seat,
        evidenceRoot: root,
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

  private async artifactsForPhase(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceArtifactRecord[]> {
    const artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 2 && artifacts.length === 0) {
      return this.#repository.listEvidenceArtifacts(claimId, 1);
    }
    return artifacts;
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

function manifestEvidencePolicy(manifest: ReleaseManifest): RetrievalPolicy {
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
    toHex(blake2b256(new TextEncoder().encode("OPENVERDICT_EVIDENCE_POLICY_V1")))
  ) as `0x${string}`;
}

function defaultDeadlines(
  now: number,
  network: ReleaseManifest["network"],
): ClaimCreateRequest["deadlines"] {
  if (network === "localnet") {
    return {
      evidenceCutoffMs: now + 8_000,
      proposalDeadlineMs: now + 10_000,
      challengeDeadlineMs: now + 12_000,
      firstCommitDeadlineMs: now + 20_000,
      firstRevealDeadlineMs: now + 30_000,
      discussionDeadlineMs: now + 40_000,
      secondCommitDeadlineMs: now + 55_000,
      secondRevealDeadlineMs: now + 65_000,
    };
  }
  const minute = 60_000;
  return {
    evidenceCutoffMs: now + 5 * minute,
    proposalDeadlineMs: now + 10 * minute,
    challengeDeadlineMs: now + 15 * minute,
    firstCommitDeadlineMs: now + 30 * minute,
    firstRevealDeadlineMs: now + 45 * minute,
    discussionDeadlineMs: now + 60 * minute,
    secondCommitDeadlineMs: now + 75 * minute,
    secondRevealDeadlineMs: now + 90 * minute,
  };
}

function validateFactCheckRequest(request: FactCheckRequest): void {
  if (request.claim.trim().length === 0 || request.claim.length > 32_000) {
    throw new EngineValidationError("claim must contain 1 to 32000 characters");
  }
  if (!request.text?.trim() && request.urls.length === 0) {
    throw new EngineValidationError("fact check requires submitted text, an HTTPS URL, or both");
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
  role: string,
  runId: string,
): OracleInferenceInput {
  return {
    protocolVersion: "1.0",
    runId,
    agentRole: role,
    promptVersion: "1",
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

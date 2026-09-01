import { randomUUID } from "node:crypto";
import type { ResolutionEvent } from "../engine/contract";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import type { DbHandle } from "./database";
import type {
  AgentManifestRecord,
  ClaimRecord,
  CommitteeRecord,
  DeliberationTurnRecord,
  EvidenceArtifactRecord,
  EvidenceManifestRecord,
  EvidenceSubmissionRecord,
  InferenceRunRecord,
  JurySeatRecord,
  PayoutTicketRecord,
  ResolutionCertificateRecord,
  ResolutionEventInsert,
  RevealRecord,
  RoundTallyRecord,
  RunApprovalRecord,
  RunProofRecord,
  VotePackageRecord,
} from "./types";

interface JsonRow {
  record_json: unknown;
}

interface SequenceRow {
  sequence: number;
}

interface RunProofRow {
  run_id: string;
  claim_id: string;
  phase: 1 | 2;
  proof_json: string;
  built_at: string;
  created_at: string;
  updated_at: string;
}

type SqlValue = string | number | boolean | null | undefined;

export class Repository {
  readonly db: DbHandle;
  #eventAppendTail: Promise<void> = Promise.resolve();

  constructor(db: DbHandle) {
    this.db = db;
  }

  async saveClaim(record: ClaimRecord): Promise<void> {
    await saveRecord(this.db, "claims", ["claim_id"], {
      claim_id: record.claimId,
      network: record.network,
      package_id: record.packageId,
      registry_object_id: record.registryObjectId,
      object_version: record.objectVersion,
      object_digest: record.objectDigest,
      transaction_digest: record.transactionDigest,
      checkpoint: record.checkpoint,
      package_version: record.packageVersion ?? 1,
      coin_type: record.coinType,
      mode: record.mode,
      state: record.state,
      creator: record.creator,
      statement: record.statement,
      resolution_criteria: record.resolutionCriteria,
      deadlines: json(record.deadlines),
      committee_budget: record.committeeBudget,
      evidence_budget: record.evidenceBudget,
      submitted_text: record.submittedText,
      submitted_urls: json(record.submittedUrls),
      statement_blob_id: record.statementBlobId,
      criteria_blob_id: record.criteriaBlobId,
      evidence_policy_id: record.evidencePolicyId,
      proposed_outcome: record.proposedOutcome,
      committee_id: record.committeeId,
      certificate_id: record.certificateId,
      result: record.result,
      truth_score_bps: record.truthScoreBps,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getClaim(claimId: string): Promise<ClaimRecord | undefined> {
    return getRecord<ClaimRecord>(this.db, "claims", "claim_id = $1", [claimId]);
  }

  async listClaims(state?: number): Promise<ClaimRecord[]> {
    // Newest first: the landing hero, the console home and the directory all
    // take the API order as "latest", so the oldest claim must not lead.
    return listRecords<ClaimRecord>(
      this.db,
      `SELECT record_json FROM claims${state === undefined ? "" : " WHERE state = $1"} ORDER BY created_at DESC, claim_id DESC`,
      state === undefined ? [] : [state],
    );
  }

  async saveCommittee(record: CommitteeRecord): Promise<void> {
    await saveRecord(this.db, "committees", ["committee_id"], {
      committee_id: record.committeeId,
      claim_id: record.claimId,
      phase: record.phase,
      round_tally_id: record.roundTallyId,
      agent_profile_ids: json(record.agentProfileIds),
      jury_seat_ids: json(record.jurySeatIds),
      reserve_agent_profile_ids: json(record.reserveAgentProfileIds),
      randomness_transaction_digest: record.randomnessTransactionDigest,
      locked: record.locked,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getCommitteeForClaim(claimId: string): Promise<CommitteeRecord | undefined> {
    return getRecord<CommitteeRecord>(this.db, "committees", "claim_id = $1", [claimId]);
  }

  async saveJurySeat(record: JurySeatRecord): Promise<void> {
    await saveRecord(this.db, "jury_seats", ["jury_seat_id"], {
      jury_seat_id: record.jurySeatId,
      claim_id: record.claimId,
      committee_id: record.committeeId,
      agent_profile_id: record.agentProfileId,
      agent_owner: record.agentOwner,
      agent_cap_id: record.agentCapId,
      phase: record.phase,
      status: record.status,
      evidence_root: record.evidenceRoot,
      commitment: record.commitment,
      run_hash: record.runHash,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listJurySeats(claimId: string, phase: 1 | 2): Promise<JurySeatRecord[]> {
    return listRecords<JurySeatRecord>(
      this.db,
      "SELECT record_json FROM jury_seats WHERE claim_id = $1 AND phase = $2 ORDER BY jury_seat_id",
      [claimId, phase],
    );
  }

  async listAllJurySeats(): Promise<JurySeatRecord[]> {
    return listRecords<JurySeatRecord>(
      this.db,
      "SELECT record_json FROM jury_seats ORDER BY claim_id, jury_seat_id",
      [],
    );
  }

  async getJurySeat(jurySeatId: string): Promise<JurySeatRecord | undefined> {
    return getRecord<JurySeatRecord>(
      this.db,
      "jury_seats",
      "jury_seat_id = $1",
      [jurySeatId],
    );
  }

  async saveRoundTally(record: RoundTallyRecord): Promise<void> {
    await saveRecord(this.db, "round_tallies", ["round_tally_id"], {
      round_tally_id: record.roundTallyId,
      claim_id: record.claimId,
      committee_id: record.committeeId,
      phase: record.phase,
      expected_jury_seat_ids: json(record.expectedJurySeatIds),
      revealed_jury_seat_ids: json(record.revealedJurySeatIds),
      revealed_vote_ids: json(record.revealedVoteIds),
      yes_count: record.yesCount,
      no_count: record.noCount,
      unsure_count: record.unsureCount,
      truth_probability_sum_bps: record.truthProbabilitySumBps,
      truth_probability_count: record.truthProbabilityCount,
      evidence_root: record.evidenceRoot,
      closed: record.closed,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getRoundTally(claimId: string, phase: 1 | 2): Promise<RoundTallyRecord | undefined> {
    return getRecord<RoundTallyRecord>(
      this.db,
      "round_tallies",
      "claim_id = $1 AND phase = $2",
      [claimId, phase],
    );
  }

  async saveEvidenceSubmission(record: EvidenceSubmissionRecord): Promise<void> {
    await saveRecord(this.db, "evidence_submissions", ["submission_id"], {
      submission_id: record.submissionId,
      evidence_id: record.evidenceId,
      claim_id: record.claimId,
      phase: record.phase,
      source_url: record.sourceUrl,
      submitted_text: record.submittedText,
      source_class: record.sourceClass,
      submitted_by: record.submittedBy,
      retrieval_status: record.retrievalStatus,
      rejection_code: record.rejectionCode,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listEvidenceSubmissions(
    claimId?: string,
    status?: EvidenceSubmissionRecord["retrievalStatus"],
  ): Promise<EvidenceSubmissionRecord[]> {
    const predicates: string[] = [];
    const parameters: SqlValue[] = [];
    if (claimId !== undefined) {
      parameters.push(claimId);
      predicates.push(`claim_id = $${parameters.length}`);
    }
    if (status !== undefined) {
      parameters.push(status);
      predicates.push(`retrieval_status = $${parameters.length}`);
    }
    const where = predicates.length === 0 ? "" : ` WHERE ${predicates.join(" AND ")}`;
    return listRecords<EvidenceSubmissionRecord>(
      this.db,
      `SELECT record_json FROM evidence_submissions${where} ORDER BY created_at, submission_id`,
      parameters,
    );
  }

  async saveEvidenceArtifact(record: EvidenceArtifactRecord): Promise<void> {
    await saveRecord(this.db, "evidence_artifacts", ["evidence_id"], {
      evidence_id: record.evidenceId,
      submission_id: record.submissionId,
      claim_id: record.claimId,
      phase: record.phase,
      source_class: record.sourceClass ?? null,
      source_url: record.sourceUrl,
      final_url: record.finalUrl,
      mime_type: record.mimeType,
      byte_length: record.byteLength,
      content_hash: record.contentHash,
      canonical_hash: record.canonicalHash,
      raw_walrus_blob_id: record.rawWalrusBlobId,
      raw_walrus_object_id: record.rawWalrusObjectId,
      canonical_walrus_blob_id: record.canonicalWalrusBlobId,
      canonical_walrus_object_id: record.canonicalWalrusObjectId,
      walrus_end_epoch: record.walrusEndEpoch,
      parser_version: record.parserVersion,
      title: record.title,
      excerpt: record.excerpt,
      retrieved_at: record.retrievedAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listEvidenceArtifacts(
    claimId: string,
    phase?: 1 | 2,
    options: { includeDiscovered?: boolean } = {},
  ): Promise<EvidenceArtifactRecord[]> {
    const discoveredFilter = options.includeDiscovered
      ? ""
      : " AND (source_class IS NULL OR source_class <> 'DISCOVERED')";
    return listRecords<EvidenceArtifactRecord>(
      this.db,
      `SELECT record_json FROM evidence_artifacts WHERE claim_id = $1${phase === undefined ? "" : " AND phase = $2"}${discoveredFilter} ORDER BY evidence_id`,
      phase === undefined ? [claimId] : [claimId, phase],
    );
  }

  async getEvidenceArtifact(
    evidenceId: string,
  ): Promise<EvidenceArtifactRecord | undefined> {
    return getRecord<EvidenceArtifactRecord>(
      this.db,
      "evidence_artifacts",
      "evidence_id = $1",
      [evidenceId],
    );
  }

  async saveEvidenceManifest(record: EvidenceManifestRecord): Promise<void> {
    await saveRecord(this.db, "evidence_manifests", ["claim_id", "phase"], {
      manifest_id: record.manifestId,
      claim_id: record.claimId,
      phase: record.phase,
      evidence_bundle_id: record.evidenceBundleId,
      root: record.root,
      manifest_blob_id: record.manifestBlobId,
      manifest_blob_object_id: record.manifestBlobObjectId,
      source_count: record.sourceCount,
      policy_id: record.policyId,
      walrus_end_epoch: record.walrusEndEpoch,
      sorted_leaves: json(record.sortedLeaves),
      transaction_digest: record.transactionDigest,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getEvidenceManifest(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceManifestRecord | undefined> {
    return getRecord<EvidenceManifestRecord>(
      this.db,
      "evidence_manifests",
      "claim_id = $1 AND phase = $2",
      [claimId, phase],
    );
  }

  async saveInferenceRun(record: InferenceRunRecord): Promise<void> {
    await saveRecord(this.db, "inference_runs", ["run_id"], {
      run_id: record.runId,
      claim_id: record.claimId,
      phase: record.phase,
      agent_profile_id: record.agentProfileId,
      jury_seat_id: record.jurySeatId,
      attempt: record.attempt,
      provider_id: record.providerId,
      model_id: record.modelId,
      gonka_request_id: record.gonkaRequestId,
      prompt_hash: record.promptHash,
      input_hash: record.inputHash,
      output_hash: record.outputHash,
      run_hash: record.runHash,
      run_walrus_blob_id: record.runWalrusBlobId,
      run_walrus_object_id: record.runWalrusObjectId,
      seal_key_hex: record.sealKeyHex,
      seal_iv_hex: record.sealIvHex,
      core_hash: record.coreHash,
      sealed_blob_id: record.sealedBlobId,
      sealed_object_id: record.sealedObjectId,
      revealed_blob_id: record.revealedBlobId,
      revealed_object_id: record.revealedObjectId,
      tool_transcript_hash: record.toolTranscriptHash,
      tool_transcript_walrus_blob_id: record.toolTranscriptWalrusBlobId,
      tool_transcript_walrus_object_id: record.toolTranscriptWalrusObjectId,
      walrus_end_epoch: record.walrusEndEpoch,
      evidence_root: record.evidenceRoot,
      validation_status: record.validationStatus,
      latency_ms: record.latencyMs,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      output: record.output === undefined ? undefined : json(record.output),
      audit: json(record.audit),
      failure: record.failure === undefined ? null : json(record.failure),
      requested_at: record.requestedAt,
      completed_at: record.completedAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listInferenceRuns(claimId: string, phase?: 1 | 2): Promise<InferenceRunRecord[]> {
    return listRecords<InferenceRunRecord>(
      this.db,
      `SELECT record_json FROM inference_runs WHERE claim_id = $1${phase === undefined ? "" : " AND phase = $2"} ORDER BY phase, jury_seat_id, attempt`,
      phase === undefined ? [claimId] : [claimId, phase],
    );
  }

  /** Store the first completed proof and preserve it on later writes. */
  async saveRunProof(record: RunProofRecord): Promise<void> {
    await execute(
      this.db,
      `INSERT INTO run_proofs (
        run_id, claim_id, phase, proof_json, built_at, created_at, updated_at, record_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (run_id) DO NOTHING`,
      [
        record.runId,
        record.claimId,
        record.phase,
        record.proofJson,
        record.builtAt,
        record.createdAt,
        record.updatedAt,
        json(record),
      ],
    );
  }

  /** Replace only a stored proof that failed JSON validation. */
  async replaceRunProof(record: RunProofRecord): Promise<void> {
    await saveRecord(this.db, "run_proofs", ["run_id"], {
      run_id: record.runId,
      claim_id: record.claimId,
      phase: record.phase,
      proof_json: record.proofJson,
      built_at: record.builtAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getRunProof(runId: string): Promise<RunProofRecord | undefined> {
    const [row] = await listRows<RunProofRow>(
      this.db,
      `SELECT run_id, claim_id, phase, proof_json, built_at, created_at, updated_at
       FROM run_proofs WHERE run_id = $1 LIMIT 1`,
      [runId],
    );
    if (!row) return undefined;
    return {
      runId: row.run_id,
      claimId: row.claim_id,
      phase: row.phase,
      proofJson: row.proof_json,
      builtAt: row.built_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listRunProofIdsForClaim(claimId: string): Promise<string[]> {
    const rows = await listRows<{ run_id: string }>(
      this.db,
      "SELECT run_id FROM run_proofs WHERE claim_id = $1 ORDER BY run_id",
      [claimId],
    );
    return rows.map((row) => row.run_id);
  }

  /** Store the first result for an ordinal so retries cannot rewrite debate history. */
  async saveDeliberationTurn(record: DeliberationTurnRecord): Promise<void> {
    await execute(
      this.db,
      `INSERT INTO deliberation_turns (
        turn_id, claim_id, ordinal, created_at, updated_at, record_json
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (turn_id) DO NOTHING`,
      [
        record.turnId,
        record.claimId,
        record.ordinal,
        record.createdAt,
        record.updatedAt,
        json(record),
      ],
    );
  }

  async listDeliberationTurns(claimId: string): Promise<DeliberationTurnRecord[]> {
    return listRecords<DeliberationTurnRecord>(
      this.db,
      "SELECT record_json FROM deliberation_turns WHERE claim_id = $1 ORDER BY ordinal",
      [claimId],
    );
  }

  async saveRunApproval(record: RunApprovalRecord): Promise<void> {
    await saveRecord(this.db, "run_approvals", ["run_id"], {
      run_approval_id: record.runApprovalId,
      run_id: record.runId,
      claim_id: record.claimId,
      jury_seat_id: record.jurySeatId,
      agent_profile_id: record.agentProfileId,
      run_hash: record.runHash,
      transaction_digest: record.transactionDigest,
      attestor: record.attestor,
      validation_errors: json(record.validationErrors),
      consumed: record.consumed,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getRunApproval(runId: string): Promise<RunApprovalRecord | undefined> {
    return getRecord<RunApprovalRecord>(this.db, "run_approvals", "run_id = $1", [runId]);
  }

  async listRunApprovals(claimId: string): Promise<RunApprovalRecord[]> {
    return listRecords<RunApprovalRecord>(
      this.db,
      "SELECT record_json FROM run_approvals WHERE claim_id = $1 ORDER BY jury_seat_id",
      [claimId],
    );
  }

  async saveVotePackage(record: VotePackageRecord): Promise<void> {
    await saveRecord(this.db, "vote_packages", ["claim_id", "phase", "jury_seat_id"], {
      vote_package_id: record.votePackageId,
      claim_id: record.claimId,
      phase: record.phase,
      jury_seat_id: record.jurySeatId,
      agent_profile_id: record.agentProfileId,
      run_id: record.runId,
      outcome: record.outcome,
      confidence_bps: record.confidenceBps,
      evidence_root: record.evidenceRoot,
      output_hash: record.outputHash,
      run_hash: record.runHash,
      commitment: record.commitment,
      salt_hex: record.saltHex,
      commitment_transaction_digest: record.commitmentTransactionDigest,
      committed: record.committed,
      revealed: record.revealed,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listVotePackages(claimId: string, phase: 1 | 2): Promise<VotePackageRecord[]> {
    return listRecords<VotePackageRecord>(
      this.db,
      "SELECT record_json FROM vote_packages WHERE claim_id = $1 AND phase = $2 ORDER BY jury_seat_id",
      [claimId, phase],
    );
  }

  async listAllVotePackages(): Promise<VotePackageRecord[]> {
    return listRecords<VotePackageRecord>(
      this.db,
      "SELECT record_json FROM vote_packages ORDER BY claim_id, jury_seat_id",
      [],
    );
  }

  async saveReveal(record: RevealRecord): Promise<void> {
    await saveRecord(this.db, "reveals", ["vote_package_id"], {
      revealed_vote_id: record.revealedVoteId,
      vote_package_id: record.votePackageId,
      claim_id: record.claimId,
      phase: record.phase,
      round_tally_id: record.roundTallyId,
      jury_seat_id: record.jurySeatId,
      agent_profile_id: record.agentProfileId,
      run_id: record.runId,
      outcome: record.outcome,
      confidence_bps: record.confidenceBps,
      valid: record.valid,
      transaction_digest: record.transactionDigest,
      checkpoint: record.checkpoint,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listReveals(claimId: string, phase?: 1 | 2): Promise<RevealRecord[]> {
    return listRecords<RevealRecord>(
      this.db,
      `SELECT record_json FROM reveals WHERE claim_id = $1${phase === undefined ? "" : " AND phase = $2"} ORDER BY jury_seat_id`,
      phase === undefined ? [claimId] : [claimId, phase],
    );
  }

  async listAllReveals(): Promise<RevealRecord[]> {
    return listRecords<RevealRecord>(
      this.db,
      "SELECT record_json FROM reveals ORDER BY claim_id, jury_seat_id",
      [],
    );
  }

  async revealedRunIds(claimId: string): Promise<Set<string>> {
    const records = await listRows<{ run_id: string }>(
      this.db,
      "SELECT run_id FROM reveals WHERE claim_id = $1 AND valid = TRUE",
      [claimId],
    );
    return new Set(records.map((record) => record.run_id));
  }

  async saveResolutionCertificate(record: ResolutionCertificateRecord): Promise<void> {
    await saveRecord(this.db, "resolution_certificates", ["claim_id"], {
      certificate_id: record.certificateId,
      claim_id: record.claimId,
      result: record.result,
      truth_score_bps: record.truthScoreBps,
      final_phase: record.finalPhase,
      final_round_vote_ids: json(record.finalRoundVoteIds),
      transaction_digest: record.transactionDigest,
      checkpoint: record.checkpoint,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async getResolutionCertificate(
    claimId: string,
  ): Promise<ResolutionCertificateRecord | undefined> {
    return getRecord<ResolutionCertificateRecord>(
      this.db,
      "resolution_certificates",
      "claim_id = $1",
      [claimId],
    );
  }

  async listAllResolutionCertificates(): Promise<ResolutionCertificateRecord[]> {
    return listRecords<ResolutionCertificateRecord>(
      this.db,
      "SELECT record_json FROM resolution_certificates ORDER BY claim_id",
      [],
    );
  }

  async saveAgentManifest(record: AgentManifestRecord): Promise<void> {
    await saveRecord(this.db, "agent_manifests", ["agent_profile_id", "version"], {
      agent_profile_id: record.manifest.agentProfileId,
      version: record.manifest.version,
      owner: record.manifest.owner,
      agent_cap_id: record.agentCapId,
      manifest_hash: record.manifest.manifestHash,
      manifest_blob_id: record.manifest.manifestBlobId,
      model_id: record.manifest.modelId,
      role: record.role,
      active: record.active,
      reputation: json(record.reputation),
      registered_checkpoint: record.manifest.registeredCheckpoint,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listAgentManifests(): Promise<AgentManifestRecord[]> {
    return listRecords<AgentManifestRecord>(
      this.db,
      "SELECT DISTINCT ON (agent_profile_id) record_json FROM agent_manifests ORDER BY agent_profile_id, registered_checkpoint DESC, created_at DESC",
      [],
    );
  }

  async getAgentManifest(agentProfileId: string): Promise<AgentManifestRecord | undefined> {
    const records = await listRecords<AgentManifestRecord>(
      this.db,
      "SELECT record_json FROM agent_manifests WHERE agent_profile_id = $1 ORDER BY registered_checkpoint DESC, created_at DESC LIMIT 1",
      [agentProfileId],
    );
    return records[0];
  }

  async savePayoutTicket(record: PayoutTicketRecord): Promise<void> {
    await saveRecord(this.db, "payout_tickets", ["payout_ticket_id"], {
      payout_ticket_id: record.payoutTicketId,
      claim_id: record.claimId,
      recipient: record.recipient,
      amount: record.amount,
      coin_type: record.coinType,
      reason: record.reason,
      consumed: record.consumed,
      created_transaction_digest: record.createdTransactionDigest,
      consumed_transaction_digest: record.consumedTransactionDigest,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      record_json: json(record),
    });
  }

  async listAllPayoutTickets(): Promise<PayoutTicketRecord[]> {
    return listRecords<PayoutTicketRecord>(
      this.db,
      "SELECT record_json FROM payout_tickets ORDER BY claim_id, payout_ticket_id",
      [],
    );
  }

  async appendResolutionEvent(input: ResolutionEventInsert): Promise<ResolutionEvent> {
    const result = this.#eventAppendTail.then(() => this.appendResolutionEventNow(input));
    this.#eventAppendTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async appendResolutionEventNow(
    input: ResolutionEventInsert,
  ): Promise<ResolutionEvent> {
    const existing = await getRecord<ResolutionEvent>(
      this.db,
      "resolution_events",
      "event_id = $1",
      [input.eventId],
    );
    if (existing !== undefined) return existing;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sequenceRows = await listRows<SequenceRow>(
        this.db,
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM resolution_events WHERE claim_id = $1",
        [input.claimId],
      );
      const sequence = Number(sequenceRows[0]?.sequence ?? 1);
      const event: ResolutionEvent = {
        eventId: input.eventId || randomUUID(),
        claimId: input.claimId,
        sequence,
        phase: input.phase,
        kind: input.kind,
        source: input.source,
        visibility: input.visibility,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        occurredAt: input.occurredAt,
        ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
        ...(input.transactionDigest === undefined
          ? {}
          : { transactionDigest: input.transactionDigest }),
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
        ...(input.artifactHash === undefined ? {} : { artifactHash: input.artifactHash }),
        payload: input.payload,
      };

      try {
        await execute(
          this.db,
          `INSERT INTO resolution_events (
            event_id, claim_id, sequence, phase, kind, source, visibility, actor_id,
            run_id, occurred_at, published_at, transaction_digest, checkpoint,
            artifact_hash, source_cursor, payload, record_json
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)`,
          [
            event.eventId,
            event.claimId,
            event.sequence,
            event.phase,
            event.kind,
            event.source,
            event.visibility,
            event.actorId,
            event.runId,
            event.occurredAt,
            event.publishedAt,
            event.transactionDigest,
            event.checkpoint,
            event.artifactHash,
            input.sourceCursor,
            json(event.payload),
            json(event),
          ],
        );
        return event;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const duplicate = await getRecord<ResolutionEvent>(
          this.db,
          "resolution_events",
          "event_id = $1",
          [input.eventId],
        );
        if (duplicate !== undefined) return duplicate;
      }
    }
    throw new Error(`could not allocate a resolution event sequence for ${input.claimId}`);
  }

  async listResolutionEvents(claimId: string, fromSequence = 1): Promise<ResolutionEvent[]> {
    return listRecords<ResolutionEvent>(
      this.db,
      "SELECT record_json FROM resolution_events WHERE claim_id = $1 AND sequence >= $2 ORDER BY sequence",
      [claimId, fromSequence],
    );
  }

  async latestSuiCursor(moduleName: string): Promise<string | undefined> {
    const rows = await listRows<{ source_cursor: string }>(
      this.db,
      `SELECT source_cursor FROM resolution_events
       WHERE source = 'SUI' AND source_cursor IS NOT NULL AND payload->>'module' = $1
       ORDER BY occurred_at DESC, sequence DESC LIMIT 1`,
      [moduleName],
    );
    return rows[0]?.source_cursor;
  }

  async saveSuiCursor(moduleName: string, cursor: string): Promise<void> {
    await this.appendResolutionEvent({
      eventId: `sui-cursor:${moduleName}:${cursor}`,
      claimId: `__sui_cursor__:${moduleName}`,
      phase: "INDEXER",
      kind: "_sui_cursor",
      source: "SUI",
      visibility: "INTERNAL_REDACTED",
      occurredAt: new Date().toISOString(),
      sourceCursor: cursor,
      payload: { module: moduleName },
    });
  }

  async healthy(): Promise<boolean> {
    try {
      await execute(this.db, "SELECT 1", []);
      return true;
    } catch {
      return false;
    }
  }
}

export function createRepository(db: DbHandle): Repository {
  return new Repository(db);
}

async function saveRecord(
  db: DbHandle,
  table: string,
  conflictColumns: string[],
  valuesByColumn: Record<string, SqlValue>,
): Promise<void> {
  const entries = Object.entries(valuesByColumn).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => column);
  const values = entries.map(([, value]) => value ?? null);
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const updates = columns
    .filter((column) => !conflictColumns.includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`);
  await execute(
    db,
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
     ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${updates.join(", ")}`,
    values,
  );
}

async function getRecord<T>(
  db: DbHandle,
  table: string,
  predicate: string,
  parameters: SqlValue[],
): Promise<T | undefined> {
  const records = await listRecords<T>(
    db,
    `SELECT record_json FROM ${table} WHERE ${predicate} LIMIT 1`,
    parameters,
  );
  return records[0];
}

async function listRecords<T>(
  db: DbHandle,
  sqlText: string,
  parameters: SqlValue[],
): Promise<T[]> {
  const rows = await listRows<JsonRow>(db, sqlText, parameters);
  return rows.map((row) => decodeJson<T>(row.record_json));
}

async function listRows<T>(
  db: DbHandle,
  sqlText: string,
  parameters: SqlValue[],
): Promise<T[]> {
  const result =
    db instanceof PGlite
      ? await db.query(sqlText, parameters)
      : await (db as Pool).query(sqlText, parameters);
  return result.rows as T[];
}

async function execute(
  db: DbHandle,
  sqlText: string,
  parameters: SqlValue[],
): Promise<void> {
  if (db instanceof PGlite) await db.query(sqlText, parameters);
  else await (db as Pool).query(sqlText, parameters);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function decodeJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

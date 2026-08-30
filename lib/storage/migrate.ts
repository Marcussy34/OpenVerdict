import type { DbHandle } from "./database";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY, network TEXT NOT NULL, package_id TEXT NOT NULL,
  registry_object_id TEXT NOT NULL, object_version TEXT, object_digest TEXT,
  transaction_digest TEXT, checkpoint BIGINT, package_version INTEGER NOT NULL DEFAULT 1,
  coin_type TEXT NOT NULL, mode INTEGER NOT NULL, state INTEGER NOT NULL, creator TEXT,
  statement TEXT NOT NULL, resolution_criteria TEXT NOT NULL, deadlines JSONB NOT NULL,
  committee_budget TEXT NOT NULL, evidence_budget TEXT NOT NULL, submitted_text TEXT,
  submitted_urls JSONB NOT NULL, statement_blob_id TEXT, criteria_blob_id TEXT,
  evidence_policy_id TEXT NOT NULL, proposed_outcome INTEGER, committee_id TEXT,
  certificate_id TEXT, result TEXT, truth_score_bps INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS committees (
  committee_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, phase INTEGER NOT NULL,
  round_tally_id TEXT NOT NULL, agent_profile_ids JSONB NOT NULL, jury_seat_ids JSONB NOT NULL,
  reserve_agent_profile_ids JSONB NOT NULL, randomness_transaction_digest TEXT,
  locked BOOLEAN NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS jury_seats (
  jury_seat_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, committee_id TEXT NOT NULL,
  agent_profile_id TEXT NOT NULL, agent_owner TEXT NOT NULL, agent_cap_id TEXT,
  phase INTEGER NOT NULL, status TEXT NOT NULL, evidence_root TEXT, commitment TEXT,
  run_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS round_tallies (
  round_tally_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, committee_id TEXT NOT NULL,
  phase INTEGER NOT NULL, expected_jury_seat_ids JSONB NOT NULL,
  revealed_jury_seat_ids JSONB NOT NULL, revealed_vote_ids JSONB NOT NULL,
  yes_count INTEGER NOT NULL DEFAULT 0, no_count INTEGER NOT NULL DEFAULT 0,
  unsure_count INTEGER NOT NULL DEFAULT 0, truth_probability_sum_bps INTEGER NOT NULL DEFAULT 0,
  truth_probability_count INTEGER NOT NULL DEFAULT 0, evidence_root TEXT,
  closed BOOLEAN NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_submissions (
  submission_id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL UNIQUE, claim_id TEXT NOT NULL,
  phase INTEGER NOT NULL, source_url TEXT, submitted_text TEXT, source_class TEXT NOT NULL,
  submitted_by TEXT, retrieval_status TEXT NOT NULL, rejection_code TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_artifacts (
  evidence_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, claim_id TEXT NOT NULL,
  phase INTEGER NOT NULL, source_class TEXT, source_url TEXT NOT NULL, final_url TEXT NOT NULL,
  mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, content_hash TEXT NOT NULL,
  canonical_hash TEXT NOT NULL, raw_walrus_blob_id TEXT NOT NULL, raw_walrus_object_id TEXT,
  canonical_walrus_blob_id TEXT NOT NULL, canonical_walrus_object_id TEXT,
  walrus_end_epoch BIGINT, parser_version TEXT NOT NULL, title TEXT, excerpt TEXT NOT NULL,
  retrieved_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_manifests (
  manifest_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, phase INTEGER NOT NULL,
  evidence_bundle_id TEXT, root TEXT NOT NULL, manifest_blob_id TEXT NOT NULL,
  manifest_blob_object_id TEXT, source_count INTEGER NOT NULL, policy_id TEXT NOT NULL,
  walrus_end_epoch BIGINT, sorted_leaves JSONB NOT NULL, transaction_digest TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL,
  UNIQUE (claim_id, phase)
);

CREATE TABLE IF NOT EXISTS inference_runs (
  run_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, phase INTEGER NOT NULL,
  agent_profile_id TEXT NOT NULL, jury_seat_id TEXT NOT NULL, attempt INTEGER NOT NULL,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, gonka_request_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL, input_hash TEXT NOT NULL, output_hash TEXT NOT NULL,
  run_hash TEXT, run_walrus_blob_id TEXT, run_walrus_object_id TEXT,
  tool_transcript_hash TEXT NOT NULL, tool_transcript_walrus_blob_id TEXT,
  tool_transcript_walrus_object_id TEXT, walrus_end_epoch BIGINT, evidence_root TEXT NOT NULL,
  validation_status TEXT NOT NULL, latency_ms INTEGER NOT NULL, input_tokens INTEGER,
  output_tokens INTEGER, output JSONB, audit JSONB NOT NULL, failure JSONB,
  requested_at TEXT NOT NULL,
  completed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, call_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL, argument_hash TEXT NOT NULL, result_hash TEXT,
  status TEXT NOT NULL, latency_ms INTEGER, artifact_hash TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, record_json JSONB NOT NULL, UNIQUE (run_id, call_index)
);

CREATE TABLE IF NOT EXISTS run_approvals (
  run_approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, claim_id TEXT NOT NULL,
  jury_seat_id TEXT NOT NULL, agent_profile_id TEXT NOT NULL, run_hash TEXT NOT NULL,
  transaction_digest TEXT NOT NULL, attestor TEXT NOT NULL, validation_errors JSONB NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS vote_packages (
  vote_package_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, phase INTEGER NOT NULL,
  jury_seat_id TEXT NOT NULL, agent_profile_id TEXT NOT NULL, run_id TEXT NOT NULL,
  outcome INTEGER NOT NULL, confidence_bps INTEGER NOT NULL, evidence_root TEXT NOT NULL,
  output_hash TEXT NOT NULL, run_hash TEXT NOT NULL, commitment TEXT NOT NULL,
  salt_hex TEXT NOT NULL, commitment_transaction_digest TEXT,
  committed BOOLEAN NOT NULL DEFAULT FALSE, revealed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL,
  UNIQUE (claim_id, phase, jury_seat_id)
);

CREATE TABLE IF NOT EXISTS reveals (
  revealed_vote_id TEXT PRIMARY KEY, vote_package_id TEXT NOT NULL UNIQUE,
  claim_id TEXT NOT NULL, phase INTEGER NOT NULL, round_tally_id TEXT NOT NULL,
  jury_seat_id TEXT NOT NULL, agent_profile_id TEXT NOT NULL, run_id TEXT NOT NULL,
  outcome INTEGER NOT NULL, confidence_bps INTEGER NOT NULL, valid BOOLEAN NOT NULL,
  transaction_digest TEXT NOT NULL, checkpoint BIGINT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS resolution_certificates (
  certificate_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL UNIQUE, result TEXT NOT NULL,
  truth_score_bps INTEGER, final_phase INTEGER NOT NULL, final_round_vote_ids JSONB NOT NULL,
  transaction_digest TEXT NOT NULL, checkpoint BIGINT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, record_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS resolution_events (
  event_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  phase TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, visibility TEXT NOT NULL,
  actor_id TEXT, run_id TEXT, occurred_at TEXT NOT NULL, published_at TEXT,
  transaction_digest TEXT, checkpoint BIGINT, artifact_hash TEXT, source_cursor TEXT,
  payload JSONB NOT NULL, record_json JSONB NOT NULL, UNIQUE (claim_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_manifests (
  agent_profile_id TEXT NOT NULL, version TEXT NOT NULL, owner TEXT NOT NULL,
  agent_cap_id TEXT, manifest_hash TEXT NOT NULL, manifest_blob_id TEXT NOT NULL,
  model_id TEXT NOT NULL, role TEXT NOT NULL, active BOOLEAN NOT NULL,
  reputation JSONB NOT NULL, registered_checkpoint BIGINT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json JSONB NOT NULL,
  PRIMARY KEY (agent_profile_id, version)
);

CREATE TABLE IF NOT EXISTS payout_tickets (
  payout_ticket_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, recipient TEXT NOT NULL,
  amount TEXT NOT NULL, coin_type TEXT NOT NULL, reason INTEGER NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT FALSE, created_transaction_digest TEXT NOT NULL,
  consumed_transaction_digest TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  record_json JSONB NOT NULL
);

ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS walrus_end_epoch BIGINT;
/* Same trust boundary as vote_packages.salt_hex. Encrypt at rest before production. */
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS seal_key_hex TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS seal_iv_hex TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS core_hash TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS sealed_blob_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS sealed_object_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS revealed_blob_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS revealed_object_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS failure JSONB;
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS source_class TEXT;

CREATE INDEX IF NOT EXISTS claims_state_idx ON claims (state);
CREATE INDEX IF NOT EXISTS jury_seats_claim_phase_idx ON jury_seats (claim_id, phase);
CREATE INDEX IF NOT EXISTS evidence_submissions_status_idx ON evidence_submissions (retrieval_status);
CREATE INDEX IF NOT EXISTS inference_runs_claim_phase_idx ON inference_runs (claim_id, phase);
CREATE INDEX IF NOT EXISTS resolution_events_claim_sequence_idx ON resolution_events (claim_id, sequence);
`;

/** Apply the complete idempotent schema in one driver-neutral Postgres batch. */
export async function migrate(db: DbHandle): Promise<void> {
  if (db instanceof PGlite) {
    await db.exec(MIGRATION_SQL);
    return;
  }
  await db.query(MIGRATION_SQL);
}

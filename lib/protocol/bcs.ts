import { bcs } from "@mysten/sui/bcs";

const Bytes = bcs.vector(bcs.u8());

/** Must stay byte-for-byte aligned with Move VotePreimageV1. */
export const VotePreimageV1Bcs = bcs.struct("VotePreimageV1", {
  claim_id: bcs.Address,
  agent_profile_id: bcs.Address,
  jury_seat_id: bcs.Address,
  phase: bcs.u8(),
  outcome: bcs.u8(),
  confidence_bps: bcs.u16(),
  evidence_root: Bytes,
  output_hash: Bytes,
  run_hash: Bytes,
  salt: Bytes,
});

/** Canonical run-hash record from PRD section 17.7. */
export const RunRecordV1Bcs = bcs.struct("RunRecordV1", {
  run_id: bcs.Address,
  claim_object_id: bcs.Address,
  agent_profile_id: bcs.Address,
  jury_seat_id: bcs.Address,
  phase: bcs.u8(),
  attempt: bcs.u16(),
  provider_id: bcs.string(),
  model_id: bcs.string(),
  gonka_request_id: bcs.string(),
  prompt_hash: Bytes,
  input_hash: Bytes,
  output_hash: Bytes,
  tool_transcript_hash: Bytes,
  evidence_root: Bytes,
  requested_at_ms: bcs.u64(),
  completed_at_ms: bcs.u64(),
});

/** Canonical claim fingerprint from PRD section 16.3. */
export const ClaimIntentV1Bcs = bcs.struct("ClaimIntentV1", {
  chain_identifier: bcs.string(),
  package_id: bcs.Address,
  registry_object_id: bcs.Address,
  creator: bcs.Address,
  creator_nonce: bcs.u64(),
  statement_hash: Bytes,
  criteria_hash: Bytes,
  evidence_policy_id: Bytes,
  claim_mode: bcs.u8(),
  proposal_deadline_ms: bcs.u64(),
  challenge_deadline_ms: bcs.u64(),
  first_commit_deadline_ms: bcs.u64(),
  first_reveal_deadline_ms: bcs.u64(),
  discussion_deadline_ms: bcs.u64(),
  second_commit_deadline_ms: bcs.u64(),
  second_reveal_deadline_ms: bcs.u64(),
  outcome_set: bcs.vector(bcs.u8()),
});

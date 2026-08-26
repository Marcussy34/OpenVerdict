import { describe, expect, it } from "vitest";
import { RunRecordV1Bcs, VotePreimageV1Bcs } from "./bcs";
import { computeRunHash, computeVoteCommitment } from "./commitment";
import { blake2b256, toHex } from "./hash";

describe("protocol commitments", () => {
  it("hashes the exact VotePreimageV1 BCS bytes", () => {
    const preimage = {
      claim_id: "0x1",
      agent_profile_id: "0x2",
      jury_seat_id: "0x3",
      phase: 1 as const,
      outcome: 1 as const,
      confidence_bps: 9000,
      evidence_root: new Uint8Array([1, 2]),
      output_hash: new Uint8Array([3]),
      run_hash: new Uint8Array([4]),
      salt: new Uint8Array([5, 6, 7]),
    };

    const expected = blake2b256(VotePreimageV1Bcs.serialize(preimage).toBytes());
    expect(computeVoteCommitment(preimage)).toEqual(expected);
    expect(toHex(expected)).toHaveLength(66);
  });

  it("hashes the canonical RunRecordV1 BCS bytes", () => {
    const runRecord = {
      run_id: "0x1",
      claim_object_id: "0x2",
      agent_profile_id: "0x3",
      jury_seat_id: "0x4",
      phase: 1 as const,
      attempt: 1,
      provider_id: "gonkarouter" as const,
      model_id: "model-a",
      gonka_request_id: "msg_1",
      prompt_hash: new Uint8Array([1]),
      input_hash: new Uint8Array([2]),
      output_hash: new Uint8Array([3]),
      tool_transcript_hash: new Uint8Array([4]),
      evidence_root: new Uint8Array([5]),
      requested_at_ms: 10,
      completed_at_ms: 20,
    };

    const expected = blake2b256(RunRecordV1Bcs.serialize(runRecord).toBytes());
    expect(computeRunHash(runRecord)).toEqual(expected);
  });
});

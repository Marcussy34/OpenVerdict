import { describe, expect, it } from "vitest";
import { ClaimIntentV1Bcs, RunRecordV1Bcs, VotePreimageV1Bcs } from "./bcs";

const addressBytes = (lastByte: number): number[] => [
  ...Array<number>(31).fill(0),
  lastByte,
];

const u64Le = (value: number): number[] => [value, 0, 0, 0, 0, 0, 0, 0];

describe("protocol BCS schemas", () => {
  it("serializes VotePreimageV1 in the exact Move field order", () => {
    const salt = new Uint8Array(128);
    const actual = VotePreimageV1Bcs.serialize({
      claim_id: "0x1",
      agent_profile_id: "0x2",
      jury_seat_id: "0x3",
      phase: 1,
      outcome: 2,
      confidence_bps: 513,
      evidence_root: new Uint8Array([0xaa, 0xbb]),
      output_hash: new Uint8Array(),
      run_hash: new Uint8Array([0xcc]),
      salt,
    }).toBytes();

    // Addresses are 32 bytes. Vector lengths are ULEB128: 2 => 0x02,
    // 128 => 0x80 0x01. The u16 value 513 is little-endian 0x01 0x02.
    const expected = new Uint8Array([
      ...addressBytes(1),
      ...addressBytes(2),
      ...addressBytes(3),
      0x01,
      0x02,
      0x01,
      0x02,
      0x02,
      0xaa,
      0xbb,
      0x00,
      0x01,
      0xcc,
      0x80,
      0x01,
      ...salt,
    ]);

    expect(actual).toEqual(expected);
  });

  it("serializes RunRecordV1 with canonical string and vector prefixes", () => {
    const actual = RunRecordV1Bcs.serialize({
      run_id: "0x1",
      claim_object_id: "0x2",
      agent_profile_id: "0x3",
      jury_seat_id: "0x4",
      phase: 2,
      attempt: 513,
      provider_id: "g",
      model_id: "m",
      gonka_request_id: "r",
      prompt_hash: new Uint8Array([0x10]),
      input_hash: new Uint8Array([0x11]),
      output_hash: new Uint8Array([0x12]),
      tool_transcript_hash: new Uint8Array([0x13]),
      evidence_root: new Uint8Array([0x14]),
      requested_at_ms: 1,
      completed_at_ms: 2,
    }).toBytes();

    // One-byte strings/vectors use a 0x01 ULEB128 prefix. Attempt is a
    // little-endian u16; timestamps are little-endian u64 values.
    const expected = new Uint8Array([
      ...addressBytes(1),
      ...addressBytes(2),
      ...addressBytes(3),
      ...addressBytes(4),
      0x02,
      0x01,
      0x02,
      0x01,
      0x67,
      0x01,
      0x6d,
      0x01,
      0x72,
      0x01,
      0x10,
      0x01,
      0x11,
      0x01,
      0x12,
      0x01,
      0x13,
      0x01,
      0x14,
      ...u64Le(1),
      ...u64Le(2),
    ]);

    expect(actual).toEqual(expected);
  });

  it("serializes ClaimIntentV1 in fingerprint order", () => {
    const actual = ClaimIntentV1Bcs.serialize({
      chain_identifier: "s",
      package_id: "0x1",
      registry_object_id: "0x2",
      creator: "0x3",
      creator_nonce: 1,
      statement_hash: new Uint8Array([0x21]),
      criteria_hash: new Uint8Array([0x22]),
      evidence_policy_id: new Uint8Array([0x23]),
      claim_mode: 2,
      proposal_deadline_ms: 1,
      challenge_deadline_ms: 2,
      first_commit_deadline_ms: 3,
      first_reveal_deadline_ms: 4,
      discussion_deadline_ms: 5,
      second_commit_deadline_ms: 6,
      second_reveal_deadline_ms: 7,
      outcome_set: [1, 2, 3],
    }).toBytes();

    // "s" and each one-byte vector have a 0x01 ULEB128 prefix. The
    // outcome vector has prefix 0x03; nonce and deadlines are u64 LE.
    const expected = new Uint8Array([
      0x01,
      0x73,
      ...addressBytes(1),
      ...addressBytes(2),
      ...addressBytes(3),
      ...u64Le(1),
      0x01,
      0x21,
      0x01,
      0x22,
      0x01,
      0x23,
      0x02,
      ...u64Le(1),
      ...u64Le(2),
      ...u64Le(3),
      ...u64Le(4),
      ...u64Le(5),
      ...u64Le(6),
      ...u64Le(7),
      0x03,
      0x01,
      0x02,
      0x03,
    ]);

    expect(actual).toEqual(expected);
  });
});

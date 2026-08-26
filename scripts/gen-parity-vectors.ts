/**
 * TS↔Move commitment parity vectors (plan Task 4).
 * Generates the canonical vectors both suites assert, so the BCS layout and
 * blake2b256 usage can never drift silently between TypeScript and Move.
 *
 * Run: pnpm tsx scripts/gen-parity-vectors.ts        (prints vectors + Move literals)
 */
import { computeVoteCommitment } from "../lib/protocol/commitment";
import { OUTCOME } from "../lib/protocol/constants";
import type { VotePreimageV1 } from "../lib/protocol/types";

const filled = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
const addr = (lastByte: number): string =>
  `0x${"00".repeat(31)}${lastByte.toString(16).padStart(2, "0")}`;

export type ParityVector = {
  name: string;
  preimage: VotePreimageV1;
  commitment: number[];
};

/** Vector 1 mirrors the hand-written Move test exactly; the rest vary every field. */
export function buildParityVectors(): ParityVector[] {
  const cases: Array<{ name: string; preimage: VotePreimageV1 }> = [
    {
      name: "yes_high_confidence",
      preimage: {
        claim_id: addr(1),
        agent_profile_id: addr(2),
        jury_seat_id: addr(3),
        phase: 1,
        outcome: OUTCOME.YES,
        confidence_bps: 9001,
        evidence_root: filled(1),
        output_hash: filled(2),
        run_hash: filled(3),
        salt: new TextEncoder().encode("salt"),
      },
    },
    {
      name: "no_low_confidence_phase2",
      preimage: {
        claim_id: addr(0x11),
        agent_profile_id: addr(0x22),
        jury_seat_id: addr(0x33),
        phase: 2,
        outcome: OUTCOME.NO,
        confidence_bps: 250,
        evidence_root: filled(0xaa),
        output_hash: filled(0xbb),
        run_hash: filled(0xcc),
        salt: new TextEncoder().encode("second-round-salt"),
      },
    },
    {
      name: "unsure_mid_confidence",
      preimage: {
        claim_id: addr(0x7f),
        agent_profile_id: addr(0x80),
        jury_seat_id: addr(0x81),
        phase: 1,
        outcome: OUTCOME.UNSURE,
        confidence_bps: 5000,
        evidence_root: filled(0x10),
        output_hash: filled(0x20),
        run_hash: filled(0x30),
        salt: new Uint8Array([0]),
      },
    },
    {
      name: "boundary_confidence_zero",
      preimage: {
        claim_id: addr(0xff),
        agent_profile_id: addr(0xfe),
        jury_seat_id: addr(0xfd),
        phase: 1,
        outcome: OUTCOME.NO,
        confidence_bps: 0,
        evidence_root: filled(0),
        output_hash: filled(0),
        run_hash: filled(0),
        salt: new Uint8Array(0),
      },
    },
    {
      name: "boundary_confidence_max",
      preimage: {
        claim_id: addr(4),
        agent_profile_id: addr(5),
        jury_seat_id: addr(6),
        phase: 2,
        outcome: OUTCOME.YES,
        confidence_bps: 10_000,
        evidence_root: filled(0x5a),
        output_hash: filled(0xa5),
        run_hash: filled(0x0f),
        salt: filled(0x77),
      },
    },
    {
      name: "long_salt_128_bytes",
      preimage: {
        claim_id: addr(0x0a),
        agent_profile_id: addr(0x0b),
        jury_seat_id: addr(0x0c),
        phase: 1,
        outcome: OUTCOME.UNSURE,
        confidence_bps: 4_321,
        evidence_root: filled(0x99),
        output_hash: filled(0x88),
        run_hash: filled(0x66),
        salt: new Uint8Array(128).map((_, i) => i % 251),
      },
    },
  ];

  return cases.map(({ name, preimage }) => ({
    name,
    preimage,
    commitment: Array.from(computeVoteCommitment(preimage)),
  }));
}

function formatMoveBytes(bytes: number[]): string {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    rows.push("            " + bytes.slice(i, i + 8).join(", ") + ",");
  }
  return rows.join("\n");
}

if (process.argv[1]?.endsWith("gen-parity-vectors.ts")) {
  for (const vector of buildParityVectors()) {
    console.log(`// ${vector.name}`);
    console.log(`        let expected = vector[`);
    console.log(formatMoveBytes(vector.commitment));
    console.log(`        ];`);
    console.log("");
  }
}

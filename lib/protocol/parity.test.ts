import { describe, expect, it } from "vitest";
import { buildParityVectors } from "../../scripts/gen-parity-vectors";

/**
 * TS side of the TS↔Move commitment parity gate (plan Task 4).
 * The identical byte arrays are asserted in
 * move/openverdict/tests/parity_tests.move — a serialization change on either
 * side breaks exactly one of the two suites, exposing the drift.
 */
const EXPECTED: Record<string, number[]> = {
  yes_high_confidence: [
    174, 207, 59, 12, 142, 92, 199, 12, 229, 251, 203, 168, 192, 10, 22, 186,
    64, 48, 139, 3, 205, 156, 237, 155, 118, 169, 240, 141, 247, 8, 101, 206,
  ],
  no_low_confidence_phase2: [
    127, 89, 150, 18, 5, 117, 34, 20, 209, 138, 156, 51, 20, 41, 160, 161,
    190, 120, 97, 151, 216, 87, 121, 45, 153, 242, 176, 137, 2, 34, 32, 16,
  ],
  unsure_mid_confidence: [
    75, 94, 215, 188, 108, 34, 250, 185, 198, 33, 121, 128, 135, 110, 38, 43,
    50, 174, 24, 232, 206, 38, 192, 235, 27, 16, 49, 213, 106, 185, 103, 219,
  ],
  boundary_confidence_zero: [
    234, 36, 123, 131, 84, 131, 181, 66, 63, 129, 187, 11, 49, 126, 226, 248,
    124, 203, 27, 171, 21, 190, 76, 76, 66, 99, 138, 11, 190, 233, 125, 135,
  ],
  boundary_confidence_max: [
    72, 1, 7, 8, 53, 113, 163, 74, 189, 205, 144, 132, 45, 150, 135, 53,
    40, 68, 223, 204, 179, 224, 176, 37, 112, 61, 162, 188, 196, 22, 94, 148,
  ],
  long_salt_128_bytes: [
    142, 120, 248, 109, 41, 183, 179, 156, 166, 217, 99, 123, 215, 6, 204, 39,
    170, 74, 79, 180, 213, 247, 237, 68, 79, 237, 93, 129, 126, 229, 136, 228,
  ],
};

describe("TS↔Move commitment parity vectors", () => {
  const vectors = buildParityVectors();

  it("covers every pinned vector exactly once", () => {
    expect(vectors.map((vector) => vector.name).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`matches the Move-pinned commitment for ${name}`, () => {
      const vector = vectors.find((candidate) => candidate.name === name);
      expect(vector).toBeDefined();
      expect(vector!.commitment).toEqual(expected);
    });
  }
});

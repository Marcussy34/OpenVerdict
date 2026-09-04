import { describe, expect, it } from "vitest";
import { tickLockKey } from "./runtime";

describe("tickLockKey", () => {
  it("gives every worker role its own lock, and the same one on every replica", () => {
    const evidence = tickLockKey("evidence-worker");
    const inference = tickLockKey("inference-worker");
    const resolution = tickLockKey("resolution-worker");

    // Two replicas of one worker must still exclude each other.
    expect(tickLockKey("evidence-worker")).toEqual(evidence);
    // Different roles must not: that is the whole point of the split.
    expect(new Set([evidence.objectId, inference.objectId, resolution.objectId]).size).toBe(3);
    expect([evidence, inference, resolution].map((key) => key.classId)).toEqual([
      1_869_640_753,
      1_869_640_753,
      1_869_640_753,
    ]);
  });

  it("stays inside the int4 range pg_advisory_xact_lock accepts", () => {
    for (const name of ["evidence-worker", "inference-worker", "resolution-worker", "web", ""]) {
      const { classId, objectId } = tickLockKey(name);
      expect(Number.isInteger(objectId)).toBe(true);
      expect(objectId).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(objectId).toBeLessThanOrEqual(2_147_483_647);
      expect(classId).toBe(1_869_640_753);
    }
  });
});

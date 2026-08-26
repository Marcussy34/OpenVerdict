import { describe, expect, it } from "vitest";
import { agentProbabilityBps, computeTruthScoreBps } from "./truthScore";

describe("agentProbabilityBps", () => {
  it.each([
    [1, 0, 0],
    [1, 10_000, 10_000],
    [2, 0, 10_000],
    [2, 10_000, 0],
    [3, 0, 5_000],
    [3, 10_000, 5_000],
  ] as const)("maps outcome %i at %i bps to %i", (outcome, confidence, expected) => {
    expect(agentProbabilityBps(outcome, confidence)).toBe(expected);
  });

  it("rejects an out-of-range confidence at runtime", () => {
    expect(() => agentProbabilityBps(1, 10_001)).toThrow(/confidence/i);
  });
});

describe("computeTruthScoreBps", () => {
  it.each([
    {
      name: "all YES",
      votes: [
        { outcome: 1 as const, confidenceBps: 9_000 },
        { outcome: 1 as const, confidenceBps: 8_000 },
        { outcome: 1 as const, confidenceBps: 7_000 },
      ],
      expected: 8_000,
    },
    {
      name: "all NO",
      votes: [
        { outcome: 2 as const, confidenceBps: 9_000 },
        { outcome: 2 as const, confidenceBps: 8_000 },
      ],
      expected: 1_500,
    },
    {
      name: "mixed outcomes",
      votes: [
        { outcome: 1 as const, confidenceBps: 8_000 },
        { outcome: 2 as const, confidenceBps: 8_000 },
        { outcome: 3 as const, confidenceBps: 9_999 },
      ],
      expected: 5_000,
    },
    {
      name: "UNSURE ignores confidence",
      votes: [
        { outcome: 3 as const, confidenceBps: 0 },
        { outcome: 3 as const, confidenceBps: 10_000 },
      ],
      expected: 5_000,
    },
    {
      name: "missing reveals use only valid terminal-round votes",
      votes: [
        { outcome: 1 as const, confidenceBps: 7_000 },
        { outcome: 1 as const, confidenceBps: 9_000 },
      ],
      expected: 8_000,
    },
    {
      name: "half-up rounding",
      votes: [
        { outcome: 1 as const, confidenceBps: 5_000 },
        { outcome: 1 as const, confidenceBps: 5_001 },
      ],
      expected: 5_001,
    },
  ])("computes the PRD vector family: $name", ({ votes, expected }) => {
    expect(computeTruthScoreBps(votes)).toBe(expected);
  });

  it("uses only the round passed by the caller", () => {
    const firstRound = [{ outcome: 1 as const, confidenceBps: 9_000 }];
    const terminalSecondRound = [{ outcome: 2 as const, confidenceBps: 9_000 }];

    expect(computeTruthScoreBps(firstRound)).toBe(9_000);
    expect(computeTruthScoreBps(terminalSecondRound)).toBe(1_000);
  });

  it("returns null when there are no valid reveals", () => {
    expect(computeTruthScoreBps([])).toBeNull();
  });
});

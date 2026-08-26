import { OUTCOME, type VoteOutcome } from "./constants";

function assertConfidenceBps(confidenceBps: number): void {
  if (!Number.isInteger(confidenceBps) || confidenceBps < 0 || confidenceBps > 10_000) {
    throw new RangeError("confidenceBps must be an integer from 0 through 10000");
  }
}

/** Map a revealed vote into its deterministic truth probability. */
export function agentProbabilityBps(
  outcome: VoteOutcome,
  confidenceBps: number,
): number {
  assertConfidenceBps(confidenceBps);

  if (outcome === OUTCOME.YES) return confidenceBps;
  if (outcome === OUTCOME.NO) return 10_000 - confidenceBps;
  if (outcome === OUTCOME.UNSURE) return 5_000;

  throw new RangeError("outcome must be YES, NO, or UNSURE");
}

/** Compute the unweighted score for the terminal valid jury round only. */
export function computeTruthScoreBps(
  votes: Array<{ outcome: VoteOutcome; confidenceBps: number }>,
): number | null {
  if (votes.length === 0) return null;

  const sum = votes.reduce(
    (total, vote) => total + agentProbabilityBps(vote.outcome, vote.confidenceBps),
    0,
  );

  // PRD half-up integer arithmetic. Jury sizes are bounded well below i32.
  return ((sum + Math.floor(votes.length / 2)) / votes.length) | 0;
}

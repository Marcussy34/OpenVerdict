import type { ClaimInspection } from "../lib/engine/contract";
import { getServerEngine } from "../lib/engine/server";
import { EngineStateError } from "../lib/engine/errors";
import { CLAIM_STATE } from "../lib/protocol";
import { forEachClaim, isWorkerEntrypoint, runWorker } from "./runtime";

// Move treats phase deadlines as floors (advance_phase, open_discussion,
// create_second_round and finalize_claim abort with E_DEADLINE_NOT_REACHED
// before them), so submitting earlier only burns gas on an abort every tick.
// The margin absorbs the gap between this clock and the chain's timestamp.
const DEADLINE_MARGIN_MS = 2_000;

function reached(deadlineMs: number): boolean {
  return Date.now() >= deadlineMs + DEADLINE_MARGIN_MS;
}

const TERMINAL_STATES = new Set<number>([
  CLAIM_STATE.FINALIZED_UNCHALLENGED,
  CLAIM_STATE.FINALIZED_REVIEWED,
  CLAIM_STATE.UNRESOLVED,
  CLAIM_STATE.CANCELLED,
]);

/**
 * Claims that can never change on chain again: finalized ones, and stuck
 * ones whose last deadline has passed or that sit in DISCUSSION past the
 * discussion deadline without phase-two evidence (round two cannot open,
 * finalize needs a reveal phase). Grinding through them cost whole reveal
 * windows: a tick that spent 40 s on dead claims reached a live claim after
 * its one-minute reveal window had closed.
 */
export function isDead(claim: ClaimInspection, nowMs: number): boolean {
  if (TERMINAL_STATES.has(claim.state)) return true;
  if (claim.deadlines.secondRevealDeadlineMs < nowMs) return true;
  return (
    claim.state === CLAIM_STATE.DISCUSSION &&
    claim.deadlines.discussionDeadlineMs < nowMs &&
    !claim.evidenceRoots.some((root) => root.phase === 2)
  );
}

/** Time-sensitive phases first: reveal windows are the shortest. */
export function urgency(state: number): number {
  if (state === CLAIM_STATE.REVEAL_1 || state === CLAIM_STATE.REVEAL_2) return 0;
  if (
    state === CLAIM_STATE.COMMIT_1 ||
    state === CLAIM_STATE.COMMIT_2 ||
    state === CLAIM_STATE.REVIEW_REQUESTED
  ) {
    return 1;
  }
  return 2;
}

export async function resolutionWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const now = Date.now();
  const claims = (await engine.listClaims())
    .filter((claim) => !isDead(claim, now))
    .sort((a, b) => urgency(a.state) - urgency(b.state));
  await forEachClaim("resolution-worker", claims, async (claim) => {
    if (claim.state === CLAIM_STATE.REVIEW_REQUESTED) {
      await engine.selectCommittee(claim.claimId);
      return;
    }
    if (claim.state === CLAIM_STATE.COMMIT_1 || claim.state === CLAIM_STATE.COMMIT_2) {
      const commitDeadlineMs =
        claim.state === CLAIM_STATE.COMMIT_1
          ? claim.deadlines.firstCommitDeadlineMs
          : claim.deadlines.secondCommitDeadlineMs;
      if (!reached(commitDeadlineMs)) return;
      await engine.advance(claim.claimId);
      return;
    }
    if (claim.state === CLAIM_STATE.REVEAL_1 || claim.state === CLAIM_STATE.REVEAL_2) {
      const phase = claim.state === CLAIM_STATE.REVEAL_1 ? 1 : 2;
      // Reveals must land before the deadline; finalize (or discussion) only
      // after it. A reveal error (a seat past the deadline, a Walrus write)
      // must not block that transition, so it is logged and the tick goes on.
      try {
        await engine.votesReveal(claim.claimId, phase);
      } catch (error) {
        process.stderr.write(
          `resolution-worker: claim ${claim.claimId.slice(0, 10)}…: reveal: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
      const revealDeadlineMs =
        phase === 1
          ? claim.deadlines.firstRevealDeadlineMs
          : claim.deadlines.secondRevealDeadlineMs;
      if (!reached(revealDeadlineMs)) return;
      try {
        await engine.finalize(claim.claimId);
      } catch (error) {
        if (!(error instanceof EngineStateError)) throw error;
        await engine.advance(claim.claimId);
      }
      return;
    }
    if (claim.state === CLAIM_STATE.DISCUSSION) {
      if (!reached(claim.deadlines.discussionDeadlineMs)) return;
      try {
        await engine.advance(claim.claimId);
      } catch (error) {
        // Say why round two did not open before trying the fallback; the
        // fallback's own error otherwise hides it.
        process.stderr.write(
          `resolution-worker: claim ${claim.claimId.slice(0, 10)}…: round two not opened: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        // A committee that never locked can't open round two; once the final
        // deadline passes, finalize still resolves the claim (UNRESOLVED).
        await engine.finalize(claim.claimId);
      }
    }
  });
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "resolution-worker", tick: resolutionWorkerTick }).catch((error) => {
    process.stderr.write(`resolution-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

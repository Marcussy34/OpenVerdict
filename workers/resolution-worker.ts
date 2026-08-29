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

export async function resolutionWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const claims = await engine.listClaims();
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
      // Reveals must land before the deadline; finalize (or discussion) only after it.
      await engine.votesReveal(claim.claimId, phase);
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

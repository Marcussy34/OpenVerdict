import { getServerEngine } from "../lib/engine/server";
import { EngineNoEvidenceError } from "../lib/engine/errors";
import { CLAIM_STATE } from "../lib/protocol";
import { forEachClaim, isWorkerEntrypoint, runWorker } from "./runtime";

const skippedNoEvidenceClaims = new Set<string>();

export async function evidenceWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const claims = await engine.listClaims();
  await forEachClaim("evidence-worker", claims, async (claim) => {
    if (skippedNoEvidenceClaims.has(claim.claimId)) return;
    try {
      // Move accepts a freeze only inside its window (phase one until the
      // commit deadline, phase two until the discussion deadline). Trying
      // afterwards uploads a manifest to Walrus (two transactions) every
      // tick before the freeze aborts, which churned the operator's coins
      // and made unrelated transactions fail on stale versions.
      const now = Date.now();
      if (
        claim.state === CLAIM_STATE.COMMIT_1 &&
        now <= claim.deadlines.firstCommitDeadlineMs &&
        !claim.evidenceRoots.some((root) => root.phase === 1)
      ) {
        await engine.evidenceFreeze(claim.claimId, 1);
      }
      // Phase two freezes as soon as discussion opens: the freeze needs a
      // Walrus manifest write (about 15 s) before its transaction, and the
      // fast ladder's discussion window is only a minute, so a freeze
      // scheduled near the deadline lands after it and the claim dies.
      if (
        claim.state === CLAIM_STATE.DISCUSSION &&
        now < claim.deadlines.discussionDeadlineMs &&
        !claim.evidenceRoots.some((root) => root.phase === 2)
      ) {
        await engine.evidenceFreeze(claim.claimId, 2);
      }
    } catch (error) {
      if (
        error instanceof EngineNoEvidenceError &&
        claim.deadlines.evidenceCutoffMs < Date.now()
      ) {
        skippedNoEvidenceClaims.add(claim.claimId);
        process.stderr.write(
          `evidence-worker: claim ${claim.claimId} skipped: cutoff passed with no accepted artifact\n`,
        );
        return;
      }
      throw error;
    }
  });
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "evidence-worker", tick: evidenceWorkerTick }).catch((error) => {
    process.stderr.write(`evidence-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

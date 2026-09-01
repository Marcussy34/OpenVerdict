import { getServerEngine } from "../lib/engine/server";
import { EngineNoEvidenceError } from "../lib/engine/errors";
import { CLAIM_STATE } from "../lib/protocol";
import {
  LIVE_CLAIM_STATES,
  forEachClaim,
  isWorkerEntrypoint,
  listLiveClaims,
  runWorker,
} from "./runtime";

const skippedNoEvidenceClaims = new Set<string>();
const NO_EVIDENCE_GRACE_MS = 60_000;

/** Resolves true while any claim is in flight (keeps the fast poll). */
export async function evidenceWorkerTick(): Promise<boolean> {
  const engine = await getServerEngine();
  // Every live state, not only the two this worker acts on: the phase-two
  // freeze must land within seconds of discussion opening, so the worker
  // stays on the fast poll through the reveal phase before it.
  const claims = await listLiveClaims(engine, LIVE_CLAIM_STATES);
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
      // The engine settles deliberation first, then preserves enough lead
      // time for the phase-two Walrus write and freeze transaction.
      if (
        claim.state === CLAIM_STATE.DISCUSSION &&
        now < claim.deadlines.discussionDeadlineMs &&
        !claim.evidenceRoots.some((root) => root.phase === 2)
      ) {
        await engine.evidenceFreeze(claim.claimId, 2);
      }
    } catch (error) {
      // Give the request path a grace period after the cutoff: the statement
      // artifact is ingested (a Walrus write) only after the claim exists.
      if (
        error instanceof EngineNoEvidenceError &&
        claim.deadlines.evidenceCutoffMs + NO_EVIDENCE_GRACE_MS < Date.now()
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
  return claims.length > 0;
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "evidence-worker", tick: evidenceWorkerTick }).catch((error) => {
    process.stderr.write(`evidence-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

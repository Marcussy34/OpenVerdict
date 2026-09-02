import { getServerEngine } from "../lib/engine/server";
import { isVoidedAttempt } from "../lib/engine/claim-lifecycle";
import { CLAIM_STATE } from "../lib/protocol";
import {
  LIVE_CLAIM_STATES,
  forEachClaim,
  isWorkerEntrypoint,
  listLiveClaims,
  runWorker,
} from "./runtime";

/** Resolves true while any claim is in flight (keeps the fast poll). */
export async function inferenceWorkerTick(): Promise<boolean> {
  const engine = await getServerEngine();
  const claims = (await listLiveClaims(engine, LIVE_CLAIM_STATES)).filter(
    (claim) => !isVoidedAttempt(claim),
  );
  await forEachClaim("inference-worker", claims, async (claim) => {
    if (claim.state === CLAIM_STATE.DISCUSSION) {
      await engine.runDeliberation(claim.claimId);
      return;
    }
    const phase =
      claim.state === CLAIM_STATE.COMMIT_1
        ? 1
        : claim.state === CLAIM_STATE.COMMIT_2
          ? 2
          : null;
    if (phase === null || !claim.evidenceRoots.some((root) => root.phase === phase)) {
      return;
    }
    await engine.juryRun(claim.claimId, phase);
    await engine.votesCommit(claim.claimId, phase);
  });
  return claims.length > 0;
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "inference-worker", tick: inferenceWorkerTick }).catch((error) => {
    process.stderr.write(`inference-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

import { getServerEngine } from "../lib/engine/server";
import { CLAIM_STATE } from "../lib/protocol";
import { forEachClaim, isWorkerEntrypoint, runWorker } from "./runtime";

export async function inferenceWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const claims = await engine.listClaims();
  await forEachClaim("inference-worker", claims, async (claim) => {
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
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "inference-worker", tick: inferenceWorkerTick }).catch((error) => {
    process.stderr.write(`inference-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

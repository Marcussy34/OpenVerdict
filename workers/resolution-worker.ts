import { getServerEngine } from "../lib/engine/server";
import { EngineStateError } from "../lib/engine/errors";
import { CLAIM_STATE } from "../lib/protocol";
import { isWorkerEntrypoint, runWorker } from "./runtime";

export async function resolutionWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const claims = await engine.listClaims();
  for (const claim of claims) {
    if (claim.state === CLAIM_STATE.REVIEW_REQUESTED) {
      await engine.selectCommittee(claim.claimId);
      continue;
    }
    if (claim.state === CLAIM_STATE.COMMIT_1 || claim.state === CLAIM_STATE.COMMIT_2) {
      await engine.advance(claim.claimId);
      continue;
    }
    if (claim.state === CLAIM_STATE.REVEAL_1 || claim.state === CLAIM_STATE.REVEAL_2) {
      const phase = claim.state === CLAIM_STATE.REVEAL_1 ? 1 : 2;
      await engine.votesReveal(claim.claimId, phase);
      try {
        await engine.finalize(claim.claimId);
      } catch (error) {
        if (!(error instanceof EngineStateError)) throw error;
        await engine.advance(claim.claimId);
      }
      continue;
    }
    if (claim.state === CLAIM_STATE.DISCUSSION) {
      await engine.advance(claim.claimId);
    }
  }
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "resolution-worker", tick: resolutionWorkerTick }).catch((error) => {
    process.stderr.write(`resolution-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

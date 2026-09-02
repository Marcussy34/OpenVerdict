import { getServerEngine } from "../lib/engine/server";
import {
  isStrandedDiscussion,
  isVoidedAttempt,
} from "../lib/engine/claim-lifecycle";
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
  // Stranded discussions and voided attempts are dead: retrying their
  // deliberation every tick only logs errors.
  const now = Date.now();
  const claims = (await listLiveClaims(engine, LIVE_CLAIM_STATES)).filter(
    (claim) => !isVoidedAttempt(claim) && !isStrandedDiscussion(claim, now),
  );
  // Claims run side by side: a claim's seats take most of its commit window,
  // so a second claim queued behind the first would miss its own deadline
  // (seen live 2026-09-03: three claims launched a minute apart, the second
  // and third voided with every seat "deadline reached before the commit
  // window"). Each claim keeps its own error isolation.
  await Promise.all(
    claims.map((claim) =>
      forEachClaim("inference-worker", [claim], async (claim) => {
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
        if (
          phase === null ||
          !claim.evidenceRoots.some((root) => root.phase === phase)
        ) {
          return;
        }
        await engine.juryRun(claim.claimId, phase);
        await engine.votesCommit(claim.claimId, phase);
      }),
    ),
  );
  return claims.length > 0;
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "inference-worker", tick: inferenceWorkerTick }).catch(
    (error) => {
      process.stderr.write(`inference-worker: ${String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

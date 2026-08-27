import { getServerEngine } from "../lib/engine/server";
import { CLAIM_STATE } from "../lib/protocol";
import { forEachClaim, isWorkerEntrypoint, runWorker } from "./runtime";

export async function evidenceWorkerTick(): Promise<void> {
  const engine = await getServerEngine();
  const claims = await engine.listClaims();
  const configuredFreezeLeadMs = Number(
    process.env.OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS ?? 2_000,
  );
  const discussionFreezeLeadMs =
    Number.isFinite(configuredFreezeLeadMs) && configuredFreezeLeadMs >= 0
      ? configuredFreezeLeadMs
      : 2_000;
  await forEachClaim("evidence-worker", claims, async (claim) => {
    if (
      claim.state === CLAIM_STATE.COMMIT_1 &&
      !claim.evidenceRoots.some((root) => root.phase === 1)
    ) {
      await engine.evidenceFreeze(claim.claimId, 1);
    }
    if (
      claim.state === CLAIM_STATE.DISCUSSION &&
      Date.now() >= claim.deadlines.discussionDeadlineMs - discussionFreezeLeadMs &&
      !claim.evidenceRoots.some((root) => root.phase === 2)
    ) {
      await engine.evidenceFreeze(claim.claimId, 2);
    }
  });
}

if (isWorkerEntrypoint(import.meta.url)) {
  runWorker({ name: "evidence-worker", tick: evidenceWorkerTick }).catch((error) => {
    process.stderr.write(`evidence-worker: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

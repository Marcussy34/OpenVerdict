import { CLAIM_STATE } from "../protocol/constants";
import type { ClaimInspection } from "./contract";

/** Voided and exhausted attempts are terminal to every claim worker. */
export function isVoidedAttempt(
  claim: Pick<ClaimInspection, "attemptChain">,
): boolean {
  return (
    claim.attemptChain?.status === "VOIDED" ||
    claim.attemptChain?.status === "GAVE_UP"
  );
}

/** A discussion-round claim whose second round can no longer start: the second commit window closed, or the discussion window closed without any phase-2 evidence root. The chain keeps it in DISCUSSION forever and the worker skips it. */
export function isStrandedDiscussion(
  claim: Pick<ClaimInspection, "state" | "deadlines" | "evidenceRoots">,
  nowMs: number,
): boolean {
  if (claim.state !== CLAIM_STATE.DISCUSSION) return false;
  if (claim.deadlines.secondCommitDeadlineMs < nowMs) return true;
  return (
    claim.deadlines.discussionDeadlineMs < nowMs &&
    !claim.evidenceRoots.some((root) => root.phase === 2)
  );
}

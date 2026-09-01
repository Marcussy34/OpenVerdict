import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimInspection } from "../lib/engine/contract";
import { CLAIM_MODE, CLAIM_STATE } from "../lib/protocol";

const serverMocks = vi.hoisted(() => ({
  getServerEngine: vi.fn(),
}));

vi.mock("../lib/engine/server", () => ({
  getServerEngine: serverMocks.getServerEngine,
}));

import { inferenceWorkerTick } from "./inference-worker";

beforeEach(() => {
  serverMocks.getServerEngine.mockReset();
});

describe("inference worker", () => {
  it("runs public deliberation for discussion claims", async () => {
    const discussion = claimInState(CLAIM_STATE.DISCUSSION);
    const engine = {
      listClaims: vi.fn(async (filter?: { state?: number }) =>
        filter?.state === CLAIM_STATE.DISCUSSION ? [discussion] : []),
      runDeliberation: vi.fn(async () => undefined),
      juryRun: vi.fn(async () => ({
        claimId: discussion.claimId,
        phase: 1 as const,
        runs: [],
      })),
      votesCommit: vi.fn(async () => []),
    };
    serverMocks.getServerEngine.mockResolvedValue(engine);

    await expect(inferenceWorkerTick()).resolves.toBe(true);

    expect(engine.runDeliberation).toHaveBeenCalledWith(discussion.claimId);
    expect(engine.juryRun).not.toHaveBeenCalled();
    expect(engine.votesCommit).not.toHaveBeenCalled();
  });
});

function claimInState(state: ClaimInspection["state"]): ClaimInspection {
  return {
    claimId: "claim-discussion",
    mode: CLAIM_MODE.DIRECT_REVIEW,
    state,
    statement: "A split claim.",
    resolutionCriteria: "Use the public record.",
    deadlines: {
      evidenceCutoffMs: 1,
      proposalDeadlineMs: 2,
      challengeDeadlineMs: 3,
      firstCommitDeadlineMs: 4,
      firstRevealDeadlineMs: 5,
      discussionDeadlineMs: 6,
      secondCommitDeadlineMs: 7,
      secondRevealDeadlineMs: 8,
    },
    evidenceRoots: [{ phase: 1, root: "0x00", bundleId: "bundle-1" }],
    commitments: [],
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  getServerEngine: vi.fn(),
}));

vi.mock("@/lib/engine/server", () => {
  class EngineNotWiredError extends Error {}
  return {
    EngineNotWiredError,
    getServerEngine: serverMocks.getServerEngine,
  };
});

import { GET } from "../../app/api/claims/[id]/runs/[runId]/proof/route";

function proofFixture(claimId: string, runId: string) {
  return {
    runId,
    claimId,
    phase: 1 as const,
    agentProfileId: "agent-1",
    jurySeatId: "seat-1",
    promptHash: "0xprompt",
    inputHash: "0xinput",
    outputHash: "0xoutput",
    runHash: "0xrun",
    gateway: {},
    claimDeadlines: {
      firstRevealDeadlineMs: 1,
      secondRevealDeadlineMs: 2,
    },
    sealedBlobId: "sealed-1",
    sealed: null,
    revealedBlobId: "revealed-1",
    revealed: true,
    bundle: {
      audit: { claimObjectId: claimId },
    },
  };
}

function storedBody(claimId: string, runId: string) {
  const proof = proofFixture(claimId, runId);
  return {
    ...proof,
    sui: {
      claimObjectId: claimId,
      agentProfileId: proof.agentProfileId,
      jurySeatId: proof.jurySeatId,
    },
  };
}

function engineFixture(claimId: string, runId: string) {
  return {
    getStoredRunProof: vi.fn(),
    saveStoredRunProof: vi.fn(),
    runProof: vi.fn().mockResolvedValue(proofFixture(claimId, runId)),
    report: vi.fn().mockResolvedValue({
      auditBundle: {
        runApprovals: [],
        commitments: [],
        reveals: [],
      },
    }),
  };
}

async function requestProof(claimId: string, runId: string) {
  return GET(new Request(`http://localhost/api/claims/${claimId}/runs/${runId}/proof`), {
    params: Promise.resolve({ id: claimId, runId }),
  });
}

beforeEach(() => {
  serverMocks.getServerEngine.mockReset();
});

describe("run proof route", () => {
  it("serves a valid persisted proof before building", async () => {
    const claimId = "claim-db";
    const runId = "run-db";
    const body = storedBody(claimId, runId);
    const engine = engineFixture(claimId, runId);
    engine.getStoredRunProof.mockResolvedValue({
      runId,
      claimId,
      phase: 1,
      proofJson: JSON.stringify(body),
      builtAt: "2026-08-27T00:00:00.000Z",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await requestProof(claimId, runId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(body);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(engine.runProof).not.toHaveBeenCalled();
    expect(engine.report).not.toHaveBeenCalled();
    expect(engine.saveStoredRunProof).not.toHaveBeenCalled();
  });

  it("builds and persists a revealed proof after a database miss", async () => {
    const claimId = "claim-miss";
    const runId = "run-miss";
    const engine = engineFixture(claimId, runId);
    engine.getStoredRunProof.mockResolvedValue(undefined);
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await requestProof(claimId, runId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(storedBody(claimId, runId));
    expect(engine.getStoredRunProof).toHaveBeenCalledWith(runId);
    expect(engine.getStoredRunProof.mock.invocationCallOrder[0]).toBeLessThan(
      engine.runProof.mock.invocationCallOrder[0] ?? 0,
    );
    expect(engine.saveStoredRunProof).toHaveBeenCalledOnce();
    const [record, options] = engine.saveStoredRunProof.mock.calls[0] ?? [];
    expect(JSON.parse(record.proofJson)).toEqual(body);
    expect(record).toMatchObject({ runId, claimId, phase: 1 });
    expect(options).toEqual({ replace: false });
  });

  it("rebuilds and replaces corrupt persisted JSON", async () => {
    const claimId = "claim-corrupt";
    const runId = "run-corrupt";
    const engine = engineFixture(claimId, runId);
    engine.getStoredRunProof.mockResolvedValue({
      runId,
      claimId,
      phase: 1,
      proofJson: "{not-json",
      builtAt: "2026-08-27T00:00:00.000Z",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await requestProof(claimId, runId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(storedBody(claimId, runId));
    expect(engine.runProof).toHaveBeenCalledWith(claimId, runId);
    expect(engine.saveStoredRunProof).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        claimId,
        createdAt: "2026-08-27T00:00:00.000Z",
      }),
      { replace: true },
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ZkLoginVerificationError } from "./errors";
import { POST } from "../../app/api/agents/register/route";

const STAKER_ADDRESS = `0x${"ab".repeat(32)}`;

function stakeResult() {
  return {
    agentProfileId: `0x${"11".repeat(32)}`,
    humanBackingHash: `0x${"22".repeat(32)}`,
    backingKind: "WALLET_STAKED" as const,
    digest: "digest-1",
    role: "INVESTIGATOR",
  };
}

function engineFixture() {
  return {
    registerZkBackedAgent: vi.fn().mockResolvedValue(stakeResult()),
  };
}

async function postStake(body: unknown) {
  return POST(
    new Request("http://localhost/api/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  serverMocks.getServerEngine.mockReset();
  vi.stubEnv("OPENVERDICT_PUBLIC_WRITES", "enabled");
  // The operator posts the bond on this path, so it is opt-in per deployment.
  vi.stubEnv("OPENVERDICT_FREE_SEATS", "enabled");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agent stake route", () => {
  it("accepts the address field and forwards it to the engine", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      address: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(stakeResult());
    expect(engine.registerZkBackedAgent).toHaveBeenCalledWith({
      zkLoginAddress: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });
  });

  it("sends no role when the caller names none: the engine assigns it", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      address: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ role: "INVESTIGATOR" });
    expect(engine.registerZkBackedAgent).toHaveBeenCalledWith({
      zkLoginAddress: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
    });
  });

  it("rejects a role that is not a bounded string", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      address: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "S".repeat(33),
    });

    expect(response.status).toBe(400);
    expect(engine.registerZkBackedAgent).not.toHaveBeenCalled();
  });

  it("still accepts the legacy zkLoginAddress field", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      zkLoginAddress: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(response.status).toBe(201);
    expect(engine.registerZkBackedAgent).toHaveBeenCalledWith(
      expect.objectContaining({ zkLoginAddress: STAKER_ADDRESS }),
    );
  });

  it("prefers address when a caller sends both fields", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    await postStake({
      address: STAKER_ADDRESS,
      zkLoginAddress: `0x${"cd".repeat(32)}`,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(engine.registerZkBackedAgent).toHaveBeenCalledWith(
      expect.objectContaining({ zkLoginAddress: STAKER_ADDRESS }),
    );
  });

  it("rejects a request with no address at all", async () => {
    serverMocks.getServerEngine.mockResolvedValue(engineFixture());

    const response = await postStake({
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
    });
  });

  it("answers 403 free_seats_disabled when the flag is off", async () => {
    vi.stubEnv("OPENVERDICT_FREE_SEATS", "");
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      address: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "free_seats_disabled",
      message: "stake on a seat through /agents",
    });
    expect(engine.registerZkBackedAgent).not.toHaveBeenCalled();
  });

  it("reports an unavailable verifier as 503 without changing the error code", async () => {
    const engine = engineFixture();
    engine.registerZkBackedAgent.mockRejectedValue(
      new ZkLoginVerificationError("verifier down"),
    );
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postStake({
      address: STAKER_ADDRESS,
      signature: "c2lnbmF0dXJl",
      modelId: "model-a",
      role: "INVESTIGATOR",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "zklogin_verification_unavailable",
      message: "Signature verification is temporarily unavailable",
    });
  });
});

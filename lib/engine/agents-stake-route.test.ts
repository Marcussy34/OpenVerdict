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

import {
  ChainReadError,
  EngineCapacityError,
  EngineValidationError,
  StakeReservationNotFoundError,
} from "./errors";
import { POST as prepare } from "../../app/api/agents/stake/prepare/route";
import { POST as confirm } from "../../app/api/agents/stake/confirm/route";

const STAKER_ADDRESS = `0x${"ab".repeat(32)}`;
const OPERATIONAL_OWNER = `0x${"cd".repeat(32)}`;
const DIGEST = "HvtKY9RwuE7NC4gLauLFPY3h5qepEy8R7aZHnc4gJu6G";

function preparation() {
  return {
    reservationId: "11111111-2222-3333-4444-555555555555",
    expiresAt: "2026-09-04T00:15:00.000Z",
    role: "INVESTIGATOR",
    target: {
      packageId: `0x${"15".repeat(32)}`,
      registryObjectId: `0x${"40".repeat(32)}`,
      clockObjectId: "0x6",
    },
    args: {
      manifestHash: `0x${"11".repeat(32)}`,
      manifestBlobId: "blob-1",
      modelHash: `0x${"22".repeat(32)}`,
      roleHash: `0x${"33".repeat(32)}`,
      stakerHash: `0x${"44".repeat(32)}`,
      operationalOwner: OPERATIONAL_OWNER,
    },
    minStakeMist: "100000000",
  };
}

function confirmation() {
  return {
    agentProfileId: `0x${"66".repeat(32)}`,
    staker: STAKER_ADDRESS,
    stakeMist: "100000000",
    digest: DIGEST,
    backingKind: "WALLET_STAKED" as const,
    operationalOwner: OPERATIONAL_OWNER,
    gasFloat: "funded" as const,
  };
}

function engineFixture() {
  return {
    prepareStake: vi.fn().mockResolvedValue(preparation()),
    confirmStake: vi.fn().mockResolvedValue(confirmation()),
  };
}

async function postPrepare(body: unknown) {
  return prepare(
    new Request("http://localhost/api/agents/stake/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function postConfirm(body: unknown) {
  return confirm(
    new Request("http://localhost/api/agents/stake/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  serverMocks.getServerEngine.mockReset();
  vi.stubEnv("OPENVERDICT_PUBLIC_WRITES", "enabled");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stake prepare route", () => {
  it("forwards the three public fields and returns the preparation", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
      role: "SKEPTIC",
      slotIndex: 3,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preparation());
    expect(engine.prepareStake).toHaveBeenCalledWith({
      stakerAddress: STAKER_ADDRESS,
      modelId: "model-a",
      role: "SKEPTIC",
    });
  });

  it("sends no role when the caller names none: the engine assigns it", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ role: "INVESTIGATOR" });
    expect(engine.prepareStake).toHaveBeenCalledWith({
      stakerAddress: STAKER_ADDRESS,
      modelId: "model-a",
    });
  });

  it("rejects a role that is not a bounded string", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
      role: "S".repeat(33),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
    });
    expect(engine.prepareStake).not.toHaveBeenCalled();
  });

  it("rejects a request with no address at all", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({ modelId: "model-a", role: "SKEPTIC" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
    });
    expect(engine.prepareStake).not.toHaveBeenCalled();
  });

  it("maps an engine validation error to 400", async () => {
    const engine = engineFixture();
    engine.prepareStake.mockRejectedValue(
      new EngineValidationError("modelId must be present in the release manifest catalog"),
    );
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "unknown-model",
      role: "SKEPTIC",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
    });
  });

  it("answers 409 slots_exhausted when every signing slot is taken", async () => {
    const engine = engineFixture();
    engine.prepareStake.mockRejectedValue(
      new EngineCapacityError("operational agent signer capacity exhausted (16 slots)"),
    );
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
      role: "SKEPTIC",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "slots_exhausted" });
  });

  it("answers 503 when the engine is not wired", async () => {
    const { EngineNotWiredError } = await import("@/lib/engine/server");
    serverMocks.getServerEngine.mockRejectedValue(
      new EngineNotWiredError("no manifest"),
    );

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
      role: "SKEPTIC",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "engine_not_wired" });
  });

  it("answers 403 when public writes are disabled", async () => {
    vi.stubEnv("OPENVERDICT_PUBLIC_WRITES", "disabled");
    serverMocks.getServerEngine.mockResolvedValue(engineFixture());

    const response = await postPrepare({
      address: STAKER_ADDRESS,
      modelId: "model-a",
      role: "SKEPTIC",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "writes_disabled",
    });
  });
});

describe("stake confirm route", () => {
  it("forwards the reservation and digest and returns the confirmation", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postConfirm({
      reservationId: preparation().reservationId,
      digest: DIGEST,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(confirmation());
    expect(engine.confirmStake).toHaveBeenCalledWith({
      reservationId: preparation().reservationId,
      digest: DIGEST,
    });
  });

  it("rejects a body without a digest", async () => {
    const engine = engineFixture();
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postConfirm({
      reservationId: preparation().reservationId,
    });

    expect(response.status).toBe(400);
    expect(engine.confirmStake).not.toHaveBeenCalled();
  });

  it("answers 400 when the transaction does not match the reservation", async () => {
    const engine = engineFixture();
    engine.confirmStake.mockRejectedValue(
      new EngineValidationError(
        "the stake transaction carries a different manifest hash than the reservation",
      ),
    );
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postConfirm({
      reservationId: preparation().reservationId,
      digest: DIGEST,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "validation_error",
    });
  });

  it("answers 404 for an unknown or expired reservation", async () => {
    const engine = engineFixture();
    engine.confirmStake.mockRejectedValue(
      new StakeReservationNotFoundError("missing-reservation"),
    );
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postConfirm({
      reservationId: "missing-reservation",
      digest: DIGEST,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "reservation_not_found",
    });
  });

  it("answers 502 when the chain read fails", async () => {
    const engine = engineFixture();
    engine.confirmStake.mockRejectedValue(new ChainReadError("fullnode is down"));
    serverMocks.getServerEngine.mockResolvedValue(engine);

    const response = await postConfirm({
      reservationId: preparation().reservationId,
      digest: DIGEST,
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "chain_read_failed",
    });
  });

  it("answers 503 when the engine is not wired", async () => {
    const { EngineNotWiredError } = await import("@/lib/engine/server");
    serverMocks.getServerEngine.mockRejectedValue(
      new EngineNotWiredError("no manifest"),
    );

    const response = await postConfirm({
      reservationId: preparation().reservationId,
      digest: DIGEST,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "engine_not_wired" });
  });
});

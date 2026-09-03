import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
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

import { POST } from "../../app/api/sponsor/route";

const PACKAGE_ID = `0x${"15".repeat(32)}`;
const SENDER = `0x${"ab".repeat(32)}`;
const COIN_TYPE = "0x2::sui::SUI";

const sponsorship = {
  txBytes: "dHhCeXRlcw==",
  txDigest: "HvtKY9RwuE7NC4gLauLFPY3h5qepEy8R7aZHnc4gJu6G",
  signature: "c3BvbnNvclNpZw==",
  expireAtTime: 1695267721,
};

function sponsorRequest(body: unknown): Request {
  return new Request("http://localhost/api/sponsor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Same shape the pool panel sends: split a stake off an owned coin, enter. */
async function poolEntryKind(): Promise<string> {
  const tx = new Transaction();
  const [stake] = tx.splitCoins(
    tx.objectRef({
      objectId: `0x${"61".repeat(32)}`,
      version: "9",
      digest: "11111111111111111111111111111111",
    }),
    [tx.pure.u64(1_000n)],
  );
  tx.moveCall({
    target: `${PACKAGE_ID}::demo_binary_pool::enter`,
    typeArguments: [COIN_TYPE],
    arguments: [
      tx.sharedObjectRef({ objectId: `0x${"40".repeat(32)}`, initialSharedVersion: 1, mutable: false }),
      tx.sharedObjectRef({ objectId: `0x${"50".repeat(32)}`, initialSharedVersion: 1, mutable: true }),
      stake!,
      tx.pure.u8(1),
      tx.sharedObjectRef({ objectId: "0x6", initialSharedVersion: 1, mutable: false }),
    ],
  });
  tx.setSender(SENDER);
  return toBase64(await tx.build({ onlyTransactionKind: true }));
}

async function foreignKind(): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `0x${"99".repeat(32)}::drainer::take`,
    arguments: [
      tx.objectRef({
        objectId: `0x${"62".repeat(32)}`,
        version: "9",
        digest: "11111111111111111111111111111111",
      }),
    ],
  });
  tx.setSender(SENDER);
  return toBase64(await tx.build({ onlyTransactionKind: true }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const previousEnv = {
  writes: process.env.OPENVERDICT_PUBLIC_WRITES,
  key: process.env.SHINAMI_GAS_ACCESS_KEY,
  endpoint: process.env.SHINAMI_GAS_ENDPOINT,
};

beforeEach(() => {
  process.env.OPENVERDICT_PUBLIC_WRITES = "enabled";
  process.env.SHINAMI_GAS_ACCESS_KEY = "route-test-key";
  delete process.env.SHINAMI_GAS_ENDPOINT;
  serverMocks.getServerEngine.mockReset();
  serverMocks.getServerEngine.mockResolvedValue({
    status: vi.fn().mockResolvedValue({ packageId: PACKAGE_ID, network: "testnet" }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore("OPENVERDICT_PUBLIC_WRITES", previousEnv.writes);
  restore("SHINAMI_GAS_ACCESS_KEY", previousEnv.key);
  restore("SHINAMI_GAS_ENDPOINT", previousEnv.endpoint);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("sponsor route", () => {
  it("sponsors an allowlisted pool entry and returns the gas station payload", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ jsonrpc: "2.0", id: 1, result: sponsorship }));
    vi.stubGlobal("fetch", fetchImpl);
    const transactionKind = await poolEntryKind();

    const response = await POST(sponsorRequest({ transactionKind, sender: SENDER }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      txBytes: sponsorship.txBytes,
      sponsorSignature: sponsorship.signature,
      txDigest: sponsorship.txDigest,
      expireAtTime: sponsorship.expireAtTime,
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init.headers["X-Api-Key"]).toBe("route-test-key");
    // Server-side budget cap, never a client-supplied one.
    expect(JSON.parse(init.body).params).toEqual([transactionKind, SENDER, 50_000_000]);
  });

  it("answers 503 when no access key is configured", async () => {
    delete process.env.SHINAMI_GAS_ACCESS_KEY;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(
      sponsorRequest({ transactionKind: await poolEntryKind(), sender: SENDER }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "sponsor_unavailable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 403 when public writes are disabled", async () => {
    process.env.OPENVERDICT_PUBLIC_WRITES = "disabled";

    const response = await POST(
      sponsorRequest({ transactionKind: await poolEntryKind(), sender: SENDER }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "writes_disabled" });
  });

  it("rejects a bad sender and a bad kind with 400", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const transactionKind = await poolEntryKind();

    const badSender = await POST(sponsorRequest({ transactionKind, sender: "0xnope" }));
    expect(badSender.status).toBe(400);
    await expect(badSender.json()).resolves.toMatchObject({ error: "sponsor_rejected" });

    const badKind = await POST(
      sponsorRequest({ transactionKind: "not-a-kind", sender: SENDER }),
    );
    expect(badKind.status).toBe(400);
    await expect(badKind.json()).resolves.toMatchObject({
      error: "sponsor_rejected",
      message: "transaction bytes are not a valid TransactionKind",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a foreign move call before spending a sponsorship", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(
      sponsorRequest({ transactionKind: await foreignKind(), sender: SENDER }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "sponsor_rejected",
      message: "move call drainer::take is not sponsorable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a gas station failure to 502 without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32602, message: "gas budget too low" },
          },
          400,
        ),
      ),
    );

    const response = await POST(
      sponsorRequest({ transactionKind: await poolEntryKind(), sender: SENDER }),
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "sponsor_failed", message: "gas budget too low" });
    expect(JSON.stringify(body)).not.toContain("route-test-key");
  });

  it("answers 503 when the engine is not wired", async () => {
    const { EngineNotWiredError } = await import("@/lib/engine/server");
    serverMocks.getServerEngine.mockRejectedValue(new EngineNotWiredError("no manifest"));
    vi.stubGlobal("fetch", vi.fn());

    const response = await POST(
      sponsorRequest({ transactionKind: await poolEntryKind(), sender: SENDER }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "engine_not_wired" });
  });
});

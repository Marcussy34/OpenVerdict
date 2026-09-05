import { describe, expect, it } from "vitest";
import { blake2b256 } from "../protocol/hash";
import { readRegistryRoster, readRegistrySeat } from "./registry-roster";
import type { OpenVerdictSuiClient } from "./client";
import type { ReleaseManifest } from "./manifest";

const REGISTRY = `0x${"33".repeat(32)}`;
const MODELS = [
  "deepseek-ai/DeepSeek-V4-Flash-0731",
  "MiniMaxAI/MiniMax-M2.7",
  "moonshotai/Kimi-K2.6",
];

const manifest = {
  network: "testnet",
  suiRpcUrl: "https://fullnode.testnet.sui.io:443",
  packageId: `0x${"11".repeat(32)}`,
  registryObjectId: REGISTRY,
  demoPoolObjectId: "",
  clockObjectId: "0x6",
  randomObjectId: "0x8",
  coinType: "0x2::sui::SUI",
  walrus: { mode: "testnet" },
  gonka: { mode: "live", baseUrl: "https://example.invalid/v1", models: MODELS },
  committee: { size: 5, threshold: 4, maxSeatsPerModel: 2, minDistinctModels: 3 },
  explorerTxTemplate: "",
} as unknown as ReleaseManifest;

const encoder = new TextEncoder();
const hash = (value: string): number[] =>
  Array.from(blake2b256(encoder.encode(value)));

/** One record as the JSON-RPC transport returns it, with fields inlined. */
function record(input: {
  id: string;
  modelId: string;
  role: string;
  active: boolean;
  weight: number;
}) {
  return {
    agent_profile_id: input.id,
    owner: `0xowner${input.id.slice(-1)}`,
    human_backing_hash: hash("human"),
    model_hash: hash(input.modelId),
    role_hash: hash(`OPENVERDICT_ROLE_${input.role}`),
    weight: String(input.weight),
    active: input.active,
  };
}

function clientWith(records: unknown): OpenVerdictSuiClient {
  return {
    core: {
      getObject: async () => ({ object: { json: { eligible_agents: records } } }),
    },
  } as unknown as OpenVerdictSuiClient;
}

const LIVE = [
  record({ id: "0xa1", modelId: MODELS[0]!, role: "SOURCE_AUTHENTICITY", active: true, weight: 10_000 }),
  record({ id: "0xa2", modelId: MODELS[0]!, role: "INVESTIGATOR", active: true, weight: 10_000 }),
  record({ id: "0xa3", modelId: MODELS[0]!, role: "SKEPTIC", active: false, weight: 10_000 }),
  record({ id: "0xb1", modelId: MODELS[1]!, role: "SKEPTIC", active: true, weight: 10_000 }),
  record({ id: "0xc1", modelId: MODELS[2]!, role: "SKEPTIC", active: true, weight: 10_000 }),
];

describe("readRegistryRoster", () => {
  it("resolves the model and role hashes the registry stores", async () => {
    const roster = await readRegistryRoster(clientWith(LIVE), manifest);

    expect(roster).toHaveLength(5);
    expect(roster[0]).toEqual({
      agentProfileId: "0xa1",
      owner: "0xowner1",
      modelId: MODELS[0],
      role: "SOURCE_AUTHENTICITY",
      active: true,
      weight: 10_000,
    });
    expect(roster[2]?.active).toBe(false);
  });

  it("reads the weight the seat carries, never a default", async () => {
    const roster = await readRegistryRoster(clientWith(LIVE), manifest);

    expect(roster.map((seat) => seat.weight)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_000,
    ]);
  });

  it("reads records whose fields the transport wraps", async () => {
    const wrapped = LIVE.map((fields) => ({ type: "0x2::x::EligibilityRecord", fields }));

    const roster = await readRegistryRoster(clientWith(wrapped), manifest);

    expect(roster.map((seat) => seat.modelId)).toEqual([
      MODELS[0], MODELS[0], MODELS[0], MODELS[1], MODELS[2],
    ]);
  });

  it("keeps a short hash for a model or role it does not know", async () => {
    const unknown = [
      record({ id: "0xd1", modelId: "vendor/model-z", role: "ARBITER", active: true, weight: 1 }),
    ];

    const roster = await readRegistryRoster(clientWith(unknown), manifest);

    expect(roster[0]?.modelId).toMatch(/^0x[0-9a-f]{8}\.\.\.$/);
    expect(roster[0]?.role).toMatch(/^0x[0-9a-f]{8}\.\.\.$/);
  });

  it("throws when the registry object carries no records", async () => {
    await expect(readRegistryRoster(clientWith(undefined), manifest)).rejects.toThrow(
      "has no eligible_agents",
    );
  });
});

describe("readRegistrySeat", () => {
  it("finds one seat by profile id, case-insensitively", async () => {
    await expect(readRegistrySeat(clientWith(LIVE), manifest, "0xB1")).resolves.toMatchObject({
      agentProfileId: "0xb1",
      role: "SKEPTIC",
      weight: 10_000,
    });
  });

  it("answers undefined for a profile the registry does not hold", async () => {
    await expect(
      readRegistrySeat(clientWith(LIVE), manifest, "0xnope"),
    ).resolves.toBeUndefined();
  });
});

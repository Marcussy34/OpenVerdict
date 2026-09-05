import { describe, expect, it } from "vitest";
import { bcs } from "@mysten/sui/bcs";
import {
  DEFAULT_JURY_DIVERSITY,
  readCommitteeDiversity,
  readJuryDiversity,
} from "./jury-diversity";
import type { OpenVerdictSuiClient } from "./client";
import type { ReleaseManifest } from "./manifest";

const PACKAGE = `0x${"11".repeat(32)}`;
const ORIGINAL = `0x${"22".repeat(32)}`;
const REGISTRY = `0x${"33".repeat(32)}`;
const COMMITTEE = `0x${"44".repeat(32)}`;

function manifestWith(originalPackageId?: string): ReleaseManifest {
  return {
    network: "testnet",
    suiRpcUrl: "https://fullnode.testnet.sui.io:443",
    packageId: PACKAGE,
    registryObjectId: REGISTRY,
    demoPoolObjectId: "",
    clockObjectId: "0x6",
    randomObjectId: "0x8",
    coinType: "0x2::sui::SUI",
    walrus: { mode: "testnet" },
    gonka: { mode: "live", baseUrl: "https://example.invalid/v1", models: ["a", "b", "c"] },
    committee: { size: 5, threshold: 4, maxSeatsPerModel: 2, minDistinctModels: 3 },
    explorerTxTemplate: "",
    ...(originalPackageId === undefined ? {} : { originalPackageId }),
  } as ReleaseManifest;
}

/** Two u8, the layout of agent_registry::JuryDiversity. */
function diversityBytes(required: number, perModel: number): Uint8Array {
  return bcs
    .struct("JuryDiversity", { required_models: bcs.u8(), max_seats_per_model: bcs.u8() })
    .serialize({ required_models: required, max_seats_per_model: perModel })
    .toBytes();
}

type Call = { parentId: string; type: string; bcs: Uint8Array };

/** A client that answers one dynamic field and throws for anything else. */
function clientWith(
  field: { parentId: string; value: Uint8Array } | undefined,
  calls: Call[] = [],
): OpenVerdictSuiClient {
  return {
    core: {
      getDynamicField: async (options: { parentId: string; name: { type: string; bcs: Uint8Array } }) => {
        calls.push({
          parentId: options.parentId,
          type: options.name.type,
          bcs: options.name.bcs,
        });
        if (field === undefined || field.parentId !== options.parentId) {
          throw new Error("dynamic field not found");
        }
        return { dynamicField: { value: { type: "", bcs: field.value } } };
      },
    },
  } as unknown as OpenVerdictSuiClient;
}

describe("readJuryDiversity", () => {
  it("reads the pair the operator set on the registry", async () => {
    const client = clientWith({ parentId: REGISTRY, value: diversityBytes(2, 3) });

    await expect(readJuryDiversity(client, manifestWith())).resolves.toEqual({
      requiredModels: 2,
      maxSeatsPerModel: 3,
    });
  });

  it("answers the protocol defaults when the field was never set", async () => {
    await expect(readJuryDiversity(clientWith(undefined), manifestWith())).resolves.toEqual(
      DEFAULT_JURY_DIVERSITY,
    );
  });

  it("keeps the defaults when the node cannot be reached, so a read never loosens the rule", async () => {
    const client = {
      core: {
        getDynamicField: async () => {
          throw new Error("network down");
        },
      },
    } as unknown as OpenVerdictSuiClient;

    await expect(readJuryDiversity(client, manifestWith())).resolves.toEqual(
      DEFAULT_JURY_DIVERSITY,
    );
  });

  it("tries the recorded address first, then the current and the original package", async () => {
    const calls: Call[] = [];
    const introduced = `0x${"44".repeat(32)}`;
    await readJuryDiversity(
      clientWith(undefined, calls),
      { ...manifestWith(ORIGINAL), juryDiversityPackageId: introduced },
    );

    expect(calls.map((call) => call.type)).toEqual([
      `${introduced}::agent_registry::JuryDiversityKey`,
      `${PACKAGE}::agent_registry::JuryDiversityKey`,
      `${ORIGINAL}::agent_registry::JuryDiversityKey`,
    ]);
    // Move gives a fieldless struct an implicit dummy_field: bool, so the key
    // is one zero byte. An empty array derives the wrong dynamic field id.
    expect(calls[0]?.bcs).toEqual(new Uint8Array([0]));
  });
});

describe("readCommitteeDiversity", () => {
  it("reads the pair recorded on the committee, not the registry's current one", async () => {
    const calls: Call[] = [];
    const client = clientWith({ parentId: COMMITTEE, value: diversityBytes(2, 3) }, calls);

    await expect(
      readCommitteeDiversity(client, manifestWith(), COMMITTEE),
    ).resolves.toEqual({ requiredModels: 2, maxSeatsPerModel: 3 });
    expect(calls[0]?.parentId).toBe(COMMITTEE);
  });

  it("answers the defaults for a committee drawn before degraded mode existed", async () => {
    await expect(
      readCommitteeDiversity(clientWith(undefined), manifestWith(), COMMITTEE),
    ).resolves.toEqual(DEFAULT_JURY_DIVERSITY);
  });
});

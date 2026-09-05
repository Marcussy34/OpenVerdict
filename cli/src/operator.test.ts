import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { RegistryRosterSeat } from "../../lib/sui";
import {
  createDb,
  createRepository,
  migrate,
  type AgentManifestRecord,
} from "../../lib/storage";
import { reconcileAgentMirror } from "./operator";

const openDatabases: PGlite[] = [];

async function testRepository() {
  const db = createDb({ dataDir: "memory://" });
  if (!(db instanceof PGlite)) throw new Error("expected an embedded pglite database");
  openDatabases.push(db);
  await migrate(db);
  return createRepository(db);
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.close()));
});

/** One mirrored seat at the manifest version the row records. */
function mirrorRow(
  agentProfileId: string,
  version: string,
  active: boolean,
): AgentManifestRecord {
  return {
    manifest: {
      agentProfileId: agentProfileId as `0x${string}`,
      owner: `0x${"ab".repeat(32)}` as `0x${string}`,
      humanAttestationHash: `0x${"cd".repeat(32)}` as `0x${string}`,
      humanVerificationProvider: "demo-allowlist",
      version,
      manifestBlobId: `blob-${version}`,
      manifestHash: `0x${"11".repeat(32)}` as `0x${string}`,
      promptHash: `0x${"22".repeat(32)}` as `0x${string}`,
      modelId: "moonshotai/Kimi-K2.6",
      providerId: "gonkarouter",
      toolPolicyHash: `0x${"44".repeat(32)}` as `0x${string}`,
      evidencePolicyHash: `0x${"55".repeat(32)}` as `0x${string}`,
      publicKey: `0x${"66".repeat(32)}` as `0x${string}`,
      registeredAtMs: 1,
      registeredCheckpoint: Number(version),
    },
    role: "SKEPTIC",
    active,
    reputation: {},
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

function registrySeat(agentProfileId: string, active: boolean): RegistryRosterSeat {
  return {
    agentProfileId,
    owner: `0x${"ab".repeat(32)}`,
    modelId: "moonshotai/Kimi-K2.6",
    role: "SKEPTIC",
    active,
    weight: 10_000,
  };
}

describe("registry sync-mirror", () => {
  it("takes the registry's flags, marks rows outside it stale and names seats it has no row for", async () => {
    const repository = await testRepository();
    // Two version rows of one seat, so the reconciliation has to move both.
    await repository.saveAgentManifest(mirrorRow("0xactiveonchain", "5", false));
    await repository.saveAgentManifest(mirrorRow("0xactiveonchain", "6", false));
    await repository.saveAgentManifest(mirrorRow("0xinactiveonchain", "6", true));
    await repository.saveAgentManifest(mirrorRow("0xagreesalready", "6", true));
    // The rows the operator had to clear by hand on 2026-09-05: seats of an
    // earlier package registry that the current one does not hold.
    await repository.saveAgentManifest(mirrorRow("0xoldregistry", "6", true));

    const report = await reconcileAgentMirror(
      repository,
      [
        registrySeat("0xactiveonchain", true),
        registrySeat("0xinactiveonchain", false),
        registrySeat("0xagreesalready", true),
        registrySeat("0xnotmirrored", true),
      ],
      "2026-09-05T14:00:00.000Z",
    );

    expect(report).toEqual({
      activated: ["0xactiveonchain"],
      deactivated: ["0xinactiveonchain"],
      stale: ["0xoldregistry"],
      missing: ["0xnotmirrored"],
    });
    const mirrored = await repository.listAgentManifests();
    expect(mirrored.map((record) => [record.manifest.agentProfileId, record.active])).toEqual([
      ["0xactiveonchain", true],
      ["0xagreesalready", true],
      ["0xinactiveonchain", false],
      ["0xoldregistry", false],
    ]);
    // Running it again changes nothing: the mirror already matches the chain.
    await expect(
      reconcileAgentMirror(repository, [
        registrySeat("0xactiveonchain", true),
        registrySeat("0xinactiveonchain", false),
        registrySeat("0xagreesalready", true),
        registrySeat("0xnotmirrored", true),
      ]),
    ).resolves.toEqual({
      activated: [],
      deactivated: [],
      stale: [],
      missing: ["0xnotmirrored"],
    });
  });

  it("refuses a registry record whose profile id did not decode", async () => {
    const repository = await testRepository();
    await repository.saveAgentManifest(mirrorRow("0xrealseat", "6", true));

    // readRegistryRoster reports "unknown" for a record it cannot read, and
    // taking that at face value would mark every real row stale.
    await expect(
      reconcileAgentMirror(repository, [registrySeat("unknown", true)]),
    ).rejects.toThrow(/no readable agent profile id/);
    expect((await repository.listAgentManifests())[0]?.active).toBe(true);
  });
});

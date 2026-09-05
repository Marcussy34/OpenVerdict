import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Transaction } from "@mysten/sui/transactions";
import {
  SignerRegistry,
  buildSetAgentEligibilityTransaction,
  buildSetJuryDiversityTransaction,
  createSuiClients,
  executeAndWait,
  loadReleaseManifest,
  readJuryDiversity,
  readRegistryRoster,
  type OpenVerdictSuiClient,
  type RegistryRosterSeat,
  type ReleaseManifest,
} from "../../lib/sui";
import { closeDb, createDb, createRepository } from "../../lib/storage";

/**
 * Operator-only registry transactions.
 *
 * These sign with the operator key and the AdminCap recorded in the release
 * manifest, so they never go through the engine: the observer holds no signer
 * and the Engine seam exposes no admin path, deliberately.
 */
export interface OperatorClient {
  setJuryDiversity(input: {
    requiredModels: number;
    maxSeatsPerModel: number;
  }): Promise<OperatorTxResult>;
  setAgentEligibility(input: {
    agentProfileId: string;
    active: boolean;
  }): Promise<OperatorTxResult>;
  /** Read-only: the seats the draw can actually see, grouped by model family. */
  registryRoster(): Promise<RegistryRosterReport>;
}

/** What the registry holds right now, which is not the app's agent directory. */
export type RegistryRosterReport = {
  network: string;
  packageId: string;
  registryObjectId: string;
  /** The draw rule in force: three families normally, two in degraded mode. */
  requiredFamilies: number;
  maxSeatsPerModel: number;
  totalSeats: number;
  activeSeats: number;
  /** Distinct model families holding at least one active seat. */
  activeFamilies: number;
  /**
   * Active seats of each reserve role that survive any legal committee. A
   * committee takes at most three seats of one role, so a role with four
   * active seats always leaves one for the reserve pair and a role with three
   * can be taken whole. Zero here means a draw can strand its reserves.
   */
  spareSkeptics: number;
  spareSourceAuthenticity: number;
  families: Array<{
    modelId: string;
    active: number;
    inactive: number;
    /** Active seats per role, so a missing reserve role is visible at a glance. */
    activeRoles: Record<string, number>;
  }>;
  seats: RegistryRosterSeat[];
};

export type OperatorTxResult = {
  digest: string;
  network: string;
  packageId: string;
  registryObjectId: string;
  adminCapObjectId: string;
  /**
   * Eligibility only. The draw reads the chain, the weather gate reads the
   * engine's own roster, so both have to move together.
   */
  rosterMirror?: "updated" | "not found" | "skipped (no DATABASE_URL)";
  /** Eligibility only: the weight the seat carried, passed back unchanged. */
  weight?: number;
};

/** Same resolution the engine uses, so the CLI and the server agree. */
function manifestPath(env: Record<string, string | undefined>): string {
  return env.OPENVERDICT_RELEASE_MANIFEST?.trim() || "config/release.localnet.json";
}

/**
 * Capability object ids sit at the top level of the raw config; the manifest
 * schema strips keys it does not know, so the file is read again for them.
 */
async function readAdminCapId(path: string): Promise<string> {
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    adminCapObjectId?: unknown;
  };
  const adminCapId = typeof raw.adminCapObjectId === "string" ? raw.adminCapObjectId : "";
  if (adminCapId.length === 0) {
    throw Object.assign(new Error(`adminCapObjectId is not recorded in ${path}`), {
      code: "ADMIN_CAP_NOT_CONFIGURED",
    });
  }
  return adminCapId;
}

async function loadOperatorManifest(
  env: Record<string, string | undefined>,
): Promise<{ path: string; manifest: ReleaseManifest; adminCapId: string }> {
  const path = manifestPath(env);
  if (!existsSync(path)) {
    throw Object.assign(new Error(`release manifest is missing: ${path}`), {
      code: "RELEASE_MANIFEST_MISSING",
    });
  }
  return {
    path,
    manifest: await loadReleaseManifest(path),
    adminCapId: await readAdminCapId(path),
  };
}

/**
 * Flip the engine's own copy of a seat's eligibility. The committee draw reads
 * the registry on chain, but the weather gate counts the families that still
 * hold an active seat in the engine's roster, so a deactivation that only
 * lands on chain would keep the gate shut on a family nobody can draw.
 */
async function mirrorEligibility(
  env: Record<string, string | undefined>,
  agentProfileId: string,
  active: boolean,
): Promise<NonNullable<OperatorTxResult["rosterMirror"]>> {
  if (!env.DATABASE_URL?.trim()) return "skipped (no DATABASE_URL)";
  const db = createDb({ url: env.DATABASE_URL });
  try {
    const repository = createRepository(db);
    const record = await repository.getAgentManifest(agentProfileId);
    if (record === undefined) return "not found";
    await repository.saveAgentManifest({
      ...record,
      active,
      updatedAt: new Date().toISOString(),
    });
    return "updated";
  } finally {
    await closeDb(db);
  }
}

/** Group the registry's seats by model family, active roles first. */
function summarizeRoster(seats: RegistryRosterSeat[]): RegistryRosterReport["families"] {
  const byModel = new Map<string, RegistryRosterReport["families"][number]>();
  for (const seat of seats) {
    const family = byModel.get(seat.modelId) ?? {
      modelId: seat.modelId,
      active: 0,
      inactive: 0,
      activeRoles: {},
    };
    if (seat.active) {
      family.active += 1;
      family.activeRoles[seat.role] = (family.activeRoles[seat.role] ?? 0) + 1;
    } else {
      family.inactive += 1;
    }
    byModel.set(seat.modelId, family);
  }
  return [...byModel.values()];
}

/** jury.move can_add_selected: count_role(selected, role) < 3. */
const MAX_SEATS_PER_ROLE = 3;

/** How many seats of one role no committee can consume. */
function spareSeats(seats: RegistryRosterSeat[], role: string): number {
  const active = seats.filter((seat) => seat.active && seat.role === role).length;
  return Math.max(0, active - MAX_SEATS_PER_ROLE);
}

/** Build the real operator client; tests inject their own instead. */
export function createOperatorClient(
  env: Record<string, string | undefined> = process.env,
): OperatorClient {
  const connect = async (): Promise<{
    manifest: ReleaseManifest;
    adminCapId: string;
    client: OpenVerdictSuiClient;
  }> => {
    const { manifest, adminCapId } = await loadOperatorManifest(env);
    return { manifest, adminCapId, client: createSuiClients(manifest) };
  };

  const execute = async (
    build: (manifest: ReleaseManifest, adminCapId: string) => Transaction,
    connected?: Awaited<ReturnType<typeof connect>>,
  ): Promise<OperatorTxResult> => {
    const { manifest, adminCapId, client } = connected ?? (await connect());
    const signer = SignerRegistry.fromEnv(env).getOperator();
    // executeAndWait normalizes the v2 result union, waits for indexing and
    // throws SUI_TRANSACTION_FAILED on a Move abort.
    const result = await executeAndWait(client, signer, () =>
      build(manifest, adminCapId),
    );
    return {
      digest: result.digest,
      network: manifest.network,
      packageId: manifest.packageId,
      registryObjectId: manifest.registryObjectId,
      adminCapObjectId: adminCapId,
    };
  };

  return {
    async setJuryDiversity(input) {
      return execute((manifest, adminCapId) =>
        buildSetJuryDiversityTransaction(manifest, { adminCapId, ...input }),
      );
    },
    async setAgentEligibility(input) {
      const connected = await connect();
      // set_agent_eligibility overwrites the stored weight, so the seat's own
      // weight is read first and passed back unchanged. Live seats carry
      // 10000; a default of 1 here would quietly reweight the draw.
      const seat = (await readRegistryRoster(connected.client, connected.manifest)).find(
        (record) => record.agentProfileId === input.agentProfileId.toLowerCase(),
      );
      if (seat === undefined) {
        throw Object.assign(
          new Error(
            `${input.agentProfileId} is not in registry ${connected.manifest.registryObjectId}`,
          ),
          { code: "SEAT_NOT_IN_REGISTRY" },
        );
      }
      const result = await execute(
        (manifest, adminCapId) =>
          buildSetAgentEligibilityTransaction(manifest, {
            adminCapId,
            agentProfileId: input.agentProfileId,
            active: input.active,
            weight: seat.weight,
          }),
        connected,
      );
      return {
        ...result,
        weight: seat.weight,
        rosterMirror: await mirrorEligibility(env, input.agentProfileId, input.active),
      };
    },
    async registryRoster() {
      const { manifest, client } = await connect();
      const [seats, diversity] = await Promise.all([
        readRegistryRoster(client, manifest),
        readJuryDiversity(client, manifest),
      ]);
      const families = summarizeRoster(seats);
      return {
        network: manifest.network,
        packageId: manifest.packageId,
        registryObjectId: manifest.registryObjectId,
        requiredFamilies: diversity.requiredModels,
        maxSeatsPerModel: diversity.maxSeatsPerModel,
        totalSeats: seats.length,
        activeSeats: seats.filter((seat) => seat.active).length,
        activeFamilies: families.filter((family) => family.active > 0).length,
        spareSkeptics: spareSeats(seats, "SKEPTIC"),
        spareSourceAuthenticity: spareSeats(seats, "SOURCE_AUTHENTICITY"),
        families,
        seats,
      };
    },
  };
}

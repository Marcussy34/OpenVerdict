import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import { readAgentSlots, readEnv } from "../../lib/engine/server";
import {
  SignerRegistry,
  buildSetAgentEligibilityTransaction,
  buildSetJuryDiversityTransaction,
  createSuiClients,
  createSuiGateway,
  executeAndWait,
  loadReleaseManifest,
  readJuryDiversity,
  readRegistryRoster,
  type BoundWriter,
  type OpenVerdictSuiClient,
  type RegistryRosterSeat,
  type ReleaseManifest,
} from "../../lib/sui";
import { closeDb, createDb, createRepository, type Repository } from "../../lib/storage";
import { createLocalWalrusStore } from "../../lib/walrus/local";
import type { WalrusStore } from "../../lib/walrus/store";
import {
  republishAgentManifests,
  type RepublishReport,
  type RepublishSelection,
} from "./republish";

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
  /** Bring the engine's agent mirror back in line with the current registry. */
  syncMirror(): Promise<MirrorSyncReport>;
  /** Move seats onto the prompt generation the engine publishes today. */
  republishManifests(selection: RepublishSelection): Promise<RepublishReport>;
}

/** What `registry sync-mirror` changed in the engine's own agent mirror. */
export type MirrorSyncReport = {
  network: string;
  registryObjectId: string;
  /** Eligibility records the registry holds right now. */
  registrySeats: number;
  /** Profiles the registry lists as eligible whose mirror rows were not. */
  activated: string[];
  /** Profiles the registry lists as ineligible whose mirror rows were not. */
  deactivated: string[];
  /** Profiles absent from the registry whose mirror rows were still active. */
  stale: string[];
  /** Registry seats with no row in the mirror at all; nothing was written. */
  missing: string[];
};

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
  /** Eligibility only: manifest version rows the mirror update moved. */
  rosterMirrorRows?: number;
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

/** The release manifest alone; only AdminCap-gated commands need the cap id. */
async function loadConfiguredManifest(
  env: Record<string, string | undefined>,
): Promise<{ path: string; manifest: ReleaseManifest }> {
  const path = manifestPath(env);
  if (!existsSync(path)) {
    throw Object.assign(new Error(`release manifest is missing: ${path}`), {
      code: "RELEASE_MANIFEST_MISSING",
    });
  }
  return { path, manifest: await loadReleaseManifest(path) };
}

async function loadOperatorManifest(
  env: Record<string, string | undefined>,
): Promise<{ path: string; manifest: ReleaseManifest; adminCapId: string }> {
  const { path, manifest } = await loadConfiguredManifest(env);
  return { path, manifest, adminCapId: await readAdminCapId(path) };
}

/** Object types keep the first-published address across package upgrades. */
function typePackageId(manifest: ReleaseManifest): string {
  return manifest.originalPackageId?.length
    ? manifest.originalPackageId
    : manifest.packageId;
}

/**
 * The AgentCap that authorizes update_agent_manifest for one seat. A staked
 * seat's cap belongs to its operational owner, so the mirror's recorded id is
 * used only once the chain confirms it names this seat, and the owner's own
 * objects are scanned otherwise.
 */
async function findAgentCapId(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  input: { owner: string; agentProfileId: string; agentCapId?: string },
): Promise<string> {
  const wanted = input.agentProfileId.toLowerCase();
  if (input.agentCapId !== undefined) {
    try {
      const { object } = await client.core.getObject({
        objectId: input.agentCapId,
        include: { json: true },
      });
      if (capProfileId(object.json) === wanted) return input.agentCapId;
    } catch {
      // A cap id the chain no longer holds falls through to the scan.
    }
  }
  const type = `${typePackageId(manifest)}::agent_registry::AgentCap`;
  let cursor: string | null = null;
  do {
    const page: {
      objects: Array<{ objectId: string; json?: Record<string, unknown> | null }>;
      cursor: string | null;
      hasNextPage: boolean;
    } = await client.core.listOwnedObjects({
      owner: input.owner,
      type,
      cursor,
      limit: 50,
      include: { json: true },
    });
    const cap = page.objects.find((object) => capProfileId(object.json) === wanted);
    if (cap) return cap.objectId;
    cursor = page.cursor;
    if (!page.hasNextPage) break;
  } while (cursor !== null);
  throw Object.assign(
    new Error(
      `no ${type} naming seat ${input.agentProfileId} is owned by ${input.owner}`,
    ),
    { code: "AGENT_CAP_NOT_FOUND" },
  );
}

function capProfileId(json: Record<string, unknown> | null | undefined): string | undefined {
  const value = json?.agent_profile_id ?? json?.agentProfileId;
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

/**
 * The store the republish uploads through. Same shape the engine builds in
 * lib/engine/server.ts, so a document written here is retrievable there; the
 * Walrus WASM stays behind a dynamic import, as it does in the engine.
 */
async function createOperatorWalrusStore(
  env: Record<string, string | undefined>,
  manifest: ReleaseManifest,
  signer: Signer,
  writers: readonly BoundWriter[],
): Promise<WalrusStore> {
  if (manifest.walrus.mode === "local") {
    return createLocalWalrusStore(manifest.walrus.localDir ?? ".localnet/walrus-local");
  }
  const { createRealWalrusStore } = await import("../../lib/walrus/real");
  return createRealWalrusStore({
    network: manifest.walrus.mode,
    baseUrl: readEnv(env.OPENVERDICT_SUI_GRPC_URL, manifest.suiRpcUrl),
    signer,
    writers,
    epochs: manifest.walrus.epochs ?? 10,
    ...(env.WALRUS_UPLOAD_RELAY_URL?.trim()
      ? {
          uploadRelay: {
            host: env.WALRUS_UPLOAD_RELAY_URL.trim(),
            sendTip: { max: relayMaxTipMist(env) },
          },
        }
      : {}),
  });
}

/** The relay tip ceiling the engine uses, read from the same variable. */
function relayMaxTipMist(env: Record<string, string | undefined>): number {
  const raw = env.WALRUS_UPLOAD_RELAY_MAX_TIP_MIST?.trim();
  if (!raw) return 1_000;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error("WALRUS_UPLOAD_RELAY_MAX_TIP_MIST must be numeric");
  }
  return value;
}

/**
 * Flip the engine's own copy of a seat's eligibility. The committee draw reads
 * the registry on chain, but the weather gate counts the families that still
 * hold an active seat in the engine's roster, so a deactivation that only
 * lands on chain would keep the gate shut on a family nobody can draw.
 *
 * Every manifest version row of that profile moves, and both copies of the
 * flag with it: the table keeps one row per version and the engine reads the
 * `record_json` copy, so flipping the newest row's column alone (what this
 * did until 2026-09-05) left the gate reading the old answer.
 */
async function mirrorEligibility(
  env: Record<string, string | undefined>,
  agentProfileId: string,
  active: boolean,
): Promise<{
  status: NonNullable<OperatorTxResult["rosterMirror"]>;
  rows?: number;
}> {
  if (!env.DATABASE_URL?.trim()) return { status: "skipped (no DATABASE_URL)" };
  const db = createDb({ url: env.DATABASE_URL });
  try {
    const repository = createRepository(db);
    if ((await repository.getAgentManifest(agentProfileId)) === undefined) {
      return { status: "not found" };
    }
    return {
      status: "updated",
      rows: await repository.setAgentManifestActive(agentProfileId, active),
    };
  } finally {
    await closeDb(db);
  }
}

/**
 * Bring the engine's agent mirror in line with a set of registry records:
 * eligible seats become active, ineligible seats inactive, and every row
 * whose profile the registry does not hold at all is taken out of the gate's
 * count. Exported so the reconciliation can be tested without a chain.
 */
export async function reconcileAgentMirror(
  repository: Repository,
  seats: readonly RegistryRosterSeat[],
  nowIso: string = new Date().toISOString(),
): Promise<Pick<MirrorSyncReport, "activated" | "deactivated" | "stale" | "missing">> {
  // A record whose profile id did not decode reads as "unknown"; treating it
  // as a registry member would mark every real mirror row stale.
  const unreadable = seats.filter((seat) => !seat.agentProfileId.startsWith("0x"));
  if (unreadable.length > 0) {
    throw Object.assign(
      new Error(`${unreadable.length} registry record(s) have no readable agent profile id`),
      { code: "REGISTRY_RECORD_UNREADABLE" },
    );
  }
  const mirrored = new Set(
    (await repository.listAgentManifests()).map((record) =>
      record.manifest.agentProfileId.toLowerCase(),
    ),
  );
  const activated: string[] = [];
  const deactivated: string[] = [];
  const missing: string[] = [];
  for (const seat of seats) {
    if (!mirrored.has(seat.agentProfileId.toLowerCase())) {
      // A seat the engine never registered locally: say so rather than
      // inventing a manifest row the engine could not use anyway.
      missing.push(seat.agentProfileId);
      continue;
    }
    const rows = await repository.setAgentManifestActive(
      seat.agentProfileId,
      seat.active,
      nowIso,
    );
    if (rows === 0) continue;
    (seat.active ? activated : deactivated).push(seat.agentProfileId);
  }
  const stale = await repository.deactivateAgentManifestsOutsideRegistry(
    seats.map((seat) => seat.agentProfileId),
    nowIso,
  );
  return { activated, deactivated, stale, missing };
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
      const mirror = await mirrorEligibility(env, input.agentProfileId, input.active);
      return {
        ...result,
        weight: seat.weight,
        rosterMirror: mirror.status,
        ...(mirror.rows === undefined ? {} : { rosterMirrorRows: mirror.rows }),
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
    async republishManifests(selection) {
      if (!env.DATABASE_URL?.trim()) {
        throw Object.assign(
          new Error("DATABASE_URL is not set; the agent mirror lives in the engine's database"),
          { code: "DATABASE_URL_NOT_CONFIGURED" },
        );
      }
      // No AdminCap here: each seat's own operational key signs its update,
      // exactly as register_staked_agent left the cap with that key.
      const { manifest } = await loadConfiguredManifest(env);
      const client = createSuiClients(manifest);
      const signers = SignerRegistry.fromEnv(env, readAgentSlots(env));
      const walrus = await createOperatorWalrusStore(
        env,
        manifest,
        signers.getOperator(),
        signers.listWalrusWriters(),
      );
      const db = createDb({ url: env.DATABASE_URL });
      try {
        return await republishAgentManifests(
          {
            repository: createRepository(db),
            walrus,
            gateway: createSuiGateway({ client, manifest, signers }),
            slotAddresses: signers.listAgentAddresses(),
            resolveAgentCapId: (seat) => findAgentCapId(client, manifest, seat),
          },
          selection,
        );
      } finally {
        await closeDb(db);
      }
    },
    async syncMirror() {
      if (!env.DATABASE_URL?.trim()) {
        throw Object.assign(
          new Error("DATABASE_URL is not set; the agent mirror lives in the engine's database"),
          { code: "DATABASE_URL_NOT_CONFIGURED" },
        );
      }
      const { manifest, client } = await connect();
      // The chain is read before the database is opened: an unreadable
      // registry must leave the mirror exactly as it was.
      const seats = await readRegistryRoster(client, manifest);
      const db = createDb({ url: env.DATABASE_URL });
      try {
        return {
          network: manifest.network,
          registryObjectId: manifest.registryObjectId,
          registrySeats: seats.length,
          ...(await reconcileAgentMirror(createRepository(db), seats)),
        };
      } finally {
        await closeDb(db);
      }
    },
  };
}

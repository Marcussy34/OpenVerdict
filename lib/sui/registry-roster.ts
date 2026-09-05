import { blake2b256, toHex } from "../protocol/hash";
import type { OpenVerdictSuiClient } from "./client";
import type { ReleaseManifest } from "./manifest";

/**
 * The registry's own eligibility records, which are the only seats the draw
 * can see. The app's agent directory is wider: it keeps rows from earlier
 * package versions, and those registries are not the one `select_committee`
 * reads. Anything operational (a count before degraded mode, a seat's current
 * weight) has to come from here.
 */
export type RegistryRosterSeat = {
  agentProfileId: string;
  owner: string;
  /** Model id when the hash matches the release catalog, else the short hash. */
  modelId: string;
  /** Role label when the hash matches a known role, else the short hash. */
  role: string;
  active: boolean;
  /**
   * The selection weight the record carries now. `set_agent_eligibility`
   * overwrites it, so an operator flipping `active` has to pass this back
   * unchanged or the seat silently changes how often it is drawn.
   */
  weight: number;
};

/** Roles a seat can hold; the draw needs a Skeptic and a Source-authenticity. */
const ROLE_LABELS = ["SKEPTIC", "SOURCE_AUTHENTICITY", "INVESTIGATOR", "ANALYST"] as const;

const encoder = new TextEncoder();

function hashOf(value: string): string {
  return toHex(blake2b256(encoder.encode(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Move byte vectors arrive as number arrays, base64 or 0x-hex by transport. */
function hexFromMoveBytes(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.startsWith("0x")) return value.toLowerCase();
    try {
      return toHex(Uint8Array.from(Buffer.from(value, "base64")));
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value) && value.every((byte) => typeof byte === "number")) {
    return toHex(Uint8Array.from(value as number[]));
  }
  return undefined;
}

function objectIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.toLowerCase();
  if (isRecord(value) && typeof value.id === "string") return value.id.toLowerCase();
  if (isRecord(value) && isRecord(value.id) && typeof value.id.id === "string") {
    return value.id.id.toLowerCase();
  }
  return undefined;
}

function numberOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

/** blake2b256 of the model id, and of the OPENVERDICT_ROLE_ prefixed role. */
function labelLookup(manifest: ReleaseManifest): {
  models: Map<string, string>;
  roles: Map<string, string>;
} {
  const models = new Map(manifest.gonka.models.map((modelId) => [hashOf(modelId), modelId]));
  const roles = new Map(
    ROLE_LABELS.map((role) => [hashOf(`OPENVERDICT_ROLE_${role}`), role as string]),
  );
  return { models, roles };
}

/** A hash nobody recognizes still has to print as something short and stable. */
function shortHash(hash: string | undefined): string {
  return hash === undefined ? "unknown" : `${hash.slice(0, 10)}...`;
}

/**
 * Read every eligibility record the registry holds. Throws when the object
 * cannot be read or carries no records: an operator command that guesses here
 * would deactivate the wrong seat or reset a weight.
 */
export async function readRegistryRoster(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
): Promise<RegistryRosterSeat[]> {
  const { object } = await client.core.getObject({
    objectId: manifest.registryObjectId,
    include: { json: true },
  });
  const records = (object.json as Record<string, unknown> | undefined)?.eligible_agents;
  if (!Array.isArray(records)) {
    throw new Error(`registry ${manifest.registryObjectId} has no eligible_agents`);
  }
  const { models, roles } = labelLookup(manifest);
  return records.map((raw) => {
    // Transports differ: some wrap struct fields, some inline them.
    const fields = isRecord(raw) && isRecord(raw.fields) ? raw.fields : (raw as Record<string, unknown>);
    const modelHash = hexFromMoveBytes(fields.model_hash);
    const roleHash = hexFromMoveBytes(fields.role_hash);
    return {
      agentProfileId: objectIdOf(fields.agent_profile_id) ?? "unknown",
      owner: objectIdOf(fields.owner) ?? "unknown",
      modelId: (modelHash && models.get(modelHash)) ?? shortHash(modelHash),
      role: (roleHash && roles.get(roleHash)) ?? shortHash(roleHash),
      active: fields.active === true,
      weight: numberOf(fields.weight),
    };
  });
}

/** One seat by profile id, so a command can reuse its recorded weight. */
export async function readRegistrySeat(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  agentProfileId: string,
): Promise<RegistryRosterSeat | undefined> {
  const wanted = agentProfileId.toLowerCase();
  return (await readRegistryRoster(client, manifest)).find(
    (seat) => seat.agentProfileId === wanted,
  );
}

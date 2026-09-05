import { bcs } from "@mysten/sui/bcs";
import type { OpenVerdictSuiClient } from "./client";
import type { ReleaseManifest } from "./manifest";

/**
 * The committee draw's model-family rule, as the chain stores it.
 *
 * Sui's compatible upgrade policy forbids new fields on `Registry` or
 * `Committee`, so the pair lives in a dynamic field under
 * `agent_registry::JuryDiversityKey {}`. An absent field means the registry
 * predates degraded mode and behaves exactly as before, hence the defaults.
 */
export type JuryDiversity = {
  /** Distinct model families a committee must span. */
  requiredModels: number;
  /** Seats one model family may hold on a committee. */
  maxSeatsPerModel: number;
};

/** agent_registry::jury_diversity returns this pair when the field is absent. */
export const DEFAULT_JURY_DIVERSITY: JuryDiversity = {
  requiredModels: 3,
  maxSeatsPerModel: 2,
};

/** Move `JuryDiversity has store, copy, drop { required_models, max_seats_per_model }`. */
const JuryDiversityBcs = bcs.struct("JuryDiversity", {
  required_models: bcs.u8(),
  max_seats_per_model: bcs.u8(),
});

/**
 * `JuryDiversityKey` declares no fields, and Move gives such a struct an
 * implicit `dummy_field: bool`, so its BCS is one zero byte rather than none.
 * The dynamic field id is derived from these bytes: an empty array derives a
 * different id and the read misses a field that is there.
 */
const KEY_BCS = new Uint8Array([0]);

/**
 * The addresses the key type may carry, in the order to try them. A struct
 * introduced by an upgrade is addressed by the package version that introduced
 * it (on testnet 0x437443b0..., recorded as juryDiversityPackageId), which is
 * neither the current nor the first-published id once the package moves on;
 * a fresh publish (localnet) makes all three the same. Trying the recorded
 * address first, then the current and the original, keeps the read correct
 * across every deployment without a silent fall back to the defaults.
 */
function keyTypes(manifest: ReleaseManifest): string[] {
  const candidates = [
    manifest.juryDiversityPackageId,
    manifest.packageId,
    manifest.originalPackageId,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(candidates)].map((id) => `${id}::agent_registry::JuryDiversityKey`);
}

/**
 * Read one `JuryDiversity` dynamic field. Returns undefined when the parent
 * carries no such field, which is also what a read failure looks like: the
 * caller decides whether that means the defaults or an unknown value.
 */
async function readDiversityField(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  parentId: string,
): Promise<JuryDiversity | undefined> {
  for (const type of keyTypes(manifest)) {
    try {
      const { dynamicField } = await client.core.getDynamicField({
        parentId,
        name: { type, bcs: KEY_BCS },
      });
      const value = JuryDiversityBcs.parse(dynamicField.value.bcs);
      return {
        requiredModels: value.required_models,
        maxSeatsPerModel: value.max_seats_per_model,
      };
    } catch {
      // A miss under one address is not an answer yet; the next address may
      // hold the field. Missing field and unreachable node look the same, and
      // every caller falls back explicitly when nothing answers.
    }
  }
  return undefined;
}

/**
 * The registry's current rule, which the next draw will use. Falls back to the
 * protocol defaults so a registry with no field behaves exactly as today.
 */
export async function readJuryDiversity(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
): Promise<JuryDiversity> {
  return (
    (await readDiversityField(client, manifest, manifest.registryObjectId)) ??
    DEFAULT_JURY_DIVERSITY
  );
}

/**
 * The pair one committee was actually drawn under, recorded on the committee
 * itself so a replacement uses the draw's numbers and never the registry's
 * current ones. Absent on every committee drawn before degraded mode existed,
 * which is exactly the default pair.
 */
export async function readCommitteeDiversity(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  committeeId: string,
): Promise<JuryDiversity> {
  return (
    (await readDiversityField(client, manifest, committeeId)) ??
    DEFAULT_JURY_DIVERSITY
  );
}

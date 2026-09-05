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

/** Object types keep the first-published address across package upgrades. */
function typePackageId(manifest: ReleaseManifest): string {
  return manifest.originalPackageId?.length
    ? manifest.originalPackageId
    : manifest.packageId;
}

function keyType(manifest: ReleaseManifest): string {
  return `${typePackageId(manifest)}::agent_registry::JuryDiversityKey`;
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
  try {
    const { dynamicField } = await client.core.getDynamicField({
      parentId,
      name: { type: keyType(manifest), bcs: KEY_BCS },
    });
    const value = JuryDiversityBcs.parse(dynamicField.value.bcs);
    return {
      requiredModels: value.required_models,
      maxSeatsPerModel: value.max_seats_per_model,
    };
  } catch {
    // Missing field and unreachable node look the same here; both mean "the
    // chain did not tell us a pair", and every caller falls back explicitly.
    return undefined;
  }
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

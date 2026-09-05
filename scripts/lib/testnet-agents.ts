import assert from "node:assert/strict";

import { toHex, type HexString } from "../../lib/protocol";
import type {
  OpenVerdictSuiClient,
  ReleaseManifest,
  SignerRegistry,
} from "../../lib/sui";

const AGENT_COUNT = 7;
const HASH_LENGTH = 32;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface DiscoveredAgent {
  index: number;
  owner: HexString;
  profileId: HexString;
  capId: string;
  manifestHash: HexString;
  manifestBlobId: string;
  humanBackingHash: HexString;
  modelHash: HexString;
  roleHash: HexString;
}

/** Read the canonical cap and authoritative profile for each demo signer. */
export async function discoverAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<DiscoveredAgent[]> {
  assert.ok(manifest.packageId, "release manifest has no packageId");
  // Object types keep the first-published address across package upgrades, so
  // filtering by the current packageId found nothing after an upgrade.
  const typePackageId = manifest.originalPackageId?.length
    ? manifest.originalPackageId
    : manifest.packageId;
  const capType = `${typePackageId}::agent_registry::AgentCap`;
  const profileType = `${typePackageId}::agent_registry::AgentProfile`;
  const found: DiscoveredAgent[] = [];

  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const signerOwner = signers.getAgentAt(index).address;
    const caps: Array<{
      objectId: string;
      json?: Record<string, unknown> | null;
    }> = [];
    let cursor: string | null = null;

    do {
      const page = (await client.core.listOwnedObjects({
        owner: signerOwner,
        type: capType,
        cursor,
        limit: 50,
        include: { json: true },
      })) as {
        objects: Array<{
          objectId: string;
          json?: Record<string, unknown> | null;
        }>;
        cursor: string | null;
        hasNextPage: boolean;
      };
      caps.push(...page.objects);
      cursor = page.cursor;
      if (!page.hasNextPage) break;
    } while (cursor !== null);

    // Prior runs may leave multiple caps. The lowest object ID is canonical.
    const cap = caps.sort((a, b) => a.objectId.localeCompare(b.objectId))[0];
    if (!cap) {
      throw new Error(
        `no AgentCap found for owner ${signerOwner} (index ${index}). ` +
          "Agents are not registered on chain yet: run scripts/testnet-canary.ts first.",
      );
    }
    assert.ok(cap.json, `AgentCap ${cap.objectId} has no JSON fields`);
    const profileId = asHexString(
      cap.json.agent_profile_id ?? cap.json.agentProfileId,
      `AgentCap ${cap.objectId} agent_profile_id`,
    );

    const { object: profile } = await client.core.getObject({
      objectId: profileId,
      include: { json: true },
    });
    assert.equal(profile.type, profileType, `${profileId} is not an AgentProfile`);
    assert.ok(profile.json, `AgentProfile ${profileId} has no JSON fields`);

    const owner = asHexString(profile.json.owner, `${profileId}.owner`);
    assert.equal(
      owner.toLowerCase(),
      signerOwner.toLowerCase(),
      `AgentProfile ${profileId} owner does not match signer ${index}`,
    );

    found.push({
      index,
      owner,
      profileId,
      capId: cap.objectId,
      manifestHash: hashField(profile.json.manifest_hash, `${profileId}.manifest_hash`),
      manifestBlobId: textField(
        profile.json.manifest_blob_id,
        `${profileId}.manifest_blob_id`,
      ),
      humanBackingHash: hashField(
        profile.json.human_backing_hash,
        `${profileId}.human_backing_hash`,
      ),
      modelHash: hashField(profile.json.model_hash, `${profileId}.model_hash`),
      roleHash: hashField(profile.json.role_hash, `${profileId}.role_hash`),
    });
  }

  return found;
}

function asHexString(value: unknown, label: string): HexString {
  assert.ok(
    typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value),
    `${label} is not a 0x-prefixed hex string`,
  );
  return value as HexString;
}

function hashField(value: unknown, label: string): HexString {
  const bytes = moveBytes(value, label);
  assert.equal(bytes.length, HASH_LENGTH, `${label} must contain 32 bytes`);
  return toHex(bytes);
}

function textField(value: unknown, label: string): string {
  const text = typeof value === "string" ? value : utf8.decode(moveBytes(value, label));
  assert.ok(text.length > 0, `${label} must not be empty`);
  return text;
}

function moveBytes(value: unknown, label: string): Uint8Array {
  if (
    Array.isArray(value) &&
    value.every(
      (byte): byte is number =>
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  ) {
    return Uint8Array.from(value);
  }
  if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
  }
  throw new Error(`${label} is not a Move vector<u8>`);
}

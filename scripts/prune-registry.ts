/**
 * Registry hygiene tool (operator-only): early canary attempts registered a
 * fresh AgentProfile per run under the same 7 deterministic owner addresses,
 * so the shared Registry accumulated ~25 stale-but-active records. A random
 * committee draw that picks one the engine has not bound fails live mode
 * ("live mode requires the registered manifest"). This marks every eligible
 * record EXCEPT the canonical cap per owner (lowest AgentCap objectId — the
 * same deterministic pick scripts/testnet-canary.ts binds) inactive via the
 * AdminCap-gated agent_registry::set_agent_eligibility.
 *
 *   pnpm tsx scripts/prune-registry.ts            # uses config/release.testnet.json + .env
 */
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import {
  SignerRegistry,
  createFallbackClient,
  loadReleaseManifest,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
} from "../lib/sui";

const AGENT_COUNT = 7;

function envOf(key: string): string {
  const line = readFileSync(".env", "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) throw new Error(`missing ${key} in .env`);
  return line.slice(key.length + 1).trim();
}

type MoveRecord = { type: string; fields: Record<string, unknown> };

async function canonicalProfiles(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<Set<string>> {
  const type = `${manifest.packageId}::agent_registry::AgentCap`;
  const keep = new Set<string>();
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const owner = signers.getAgentAt(index).address;
    let cursor: string | null = null;
    const caps: Array<{ objectId: string; json?: Record<string, unknown> }> = [];
    do {
      const page = (await client.core.listOwnedObjects({
        owner,
        type,
        cursor,
        limit: 50,
        include: { json: true },
      })) as {
        objects: Array<{ objectId: string; json?: Record<string, unknown> }>;
        cursor: string | null;
        hasNextPage: boolean;
      };
      caps.push(...page.objects);
      cursor = page.cursor;
      if (!page.hasNextPage) break;
    } while (cursor !== null);
    // Same deterministic pick as testnet-canary discoverAgents.
    const cap = caps.sort((a, b) => a.objectId.localeCompare(b.objectId))[0];
    if (!cap) throw new Error(`owner ${owner} holds no AgentCap`);
    const profileId =
      (cap.json?.agent_profile_id as string | undefined) ??
      (cap.json?.agentProfileId as string | undefined);
    if (!profileId) throw new Error(`cap ${cap.objectId} has no agent_profile_id`);
    keep.add(profileId.toLowerCase());
  }
  return keep;
}

const manifest = await loadReleaseManifest("config/release.testnet.json");
const rpcUrl =
  (manifest as { suiRpcFallbackUrl?: string }).suiRpcFallbackUrl ?? manifest.suiRpcUrl;
const client = createFallbackClient({ network: "testnet", suiRpcUrl: rpcUrl });
const signers = SignerRegistry.fromEnv(
  {
    SUI_OPERATOR_SECRET_KEY: envOf("SUI_OPERATOR_SECRET_KEY"),
    OPENVERDICT_AGENT_SEED: envOf("OPENVERDICT_AGENT_SEED"),
  },
  AGENT_COUNT,
);

const keep = await canonicalProfiles(client, manifest, signers);
console.log(`canonical profiles kept: ${keep.size}`);

const { object: registry } = await client.core.getObject({
  objectId: manifest.registryObjectId,
  include: { json: true },
});
const records = (registry.json as Record<string, unknown>).eligible_agents as MoveRecord[];
const profileIdOf = (record: MoveRecord): string => {
  const value = record.fields.profile_id ?? record.fields.agent_profile_id;
  if (typeof value !== "string") {
    throw new Error(`unrecognized record shape: ${JSON.stringify(record).slice(0, 200)}`);
  }
  return value.toLowerCase();
};
const active = records.filter((record) => record.fields.active === true);
const prune = active.filter((record) => !keep.has(profileIdOf(record)));
console.log(`eligible records: ${records.length}, active: ${active.length}, to prune: ${prune.length}`);
if (prune.length === 0) {
  console.log("registry already clean");
  process.exit(0);
}

// Cap ids sit at the top level of the raw config; the manifest schema strips
// keys it does not know, so read the file directly for them.
const rawConfig = JSON.parse(readFileSync("config/release.testnet.json", "utf8")) as {
  adminCapObjectId?: string;
};
const adminCapId = rawConfig.adminCapObjectId;
if (!adminCapId) throw new Error("adminCapObjectId not in config/release.testnet.json");
const tx = new Transaction();
for (const record of prune) {
  tx.moveCall({
    target: `${manifest.packageId}::agent_registry::set_agent_eligibility`,
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(adminCapId),
      tx.object(profileIdOf(record)),
      tx.pure.bool(false),
      tx.pure.u64(1),
    ],
  });
}
const result = await client.signAndExecuteTransaction({
  transaction: tx,
  signer: signers.getOperator(),
});
console.log("prune digest:", result.digest);
await client.core.waitForTransaction({ digest: result.digest });

const { object: after } = await client.core.getObject({
  objectId: manifest.registryObjectId,
  include: { json: true },
});
const remaining = ((after.json as Record<string, unknown>).eligible_agents as MoveRecord[]).filter(
  (record) => record.fields.active === true,
);
console.log(`active after prune: ${remaining.length} (expected ${keep.size})`);

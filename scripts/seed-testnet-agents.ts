#!/usr/bin/env node
/**
 * Bind the deployed engine to the agents that already exist on testnet.
 *
 * The hosted engine builds with no initialAgents, so its database starts with
 * an empty agent directory. A committee draw that lands on a profile the
 * engine has not bound fails live mode ("live mode requires the registered
 * manifest for agent 0x…"), which means no claim can ever deliberate.
 *
 * The seven AgentCaps are already registered on chain under the deterministic
 * owner addresses derived from OPENVERDICT_AGENT_SEED, so this only reads them
 * back and writes the matching manifests into the engine's database. It
 * registers nothing and spends no SUI.
 *
 * The canonical cap per owner is the lowest objectId, matching the pick made
 * by scripts/testnet-canary.ts and scripts/prune-registry.ts, so all three
 * agree on which profile is live.
 *
 *   DATABASE_URL=<neon url> pnpm tsx scripts/seed-testnet-agents.ts
 */
import assert from "node:assert/strict";
import { blake2b256, toHex, type AgentManifest, type HexString } from "../lib/protocol";
import { closeDb, createDb, createRepository, migrate } from "../lib/storage";
import {
  SignerRegistry,
  createFallbackClient,
  loadReleaseManifest,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
} from "../lib/sui";

const AGENT_COUNT = 7;
const MANIFEST_PATH = "config/release.testnet.json";

function env(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

const hexHash = (label: string) => toHex(blake2b256(new TextEncoder().encode(label)));

interface DiscoveredAgent {
  index: number;
  owner: string;
  profileId: string;
  capId: string;
}

/** Read back the caps registered under each deterministic owner address. */
async function discoverAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<DiscoveredAgent[]> {
  const type = `${manifest.packageId}::agent_registry::AgentCap`;
  const found: DiscoveredAgent[] = [];
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const owner = signers.getAgentAt(index).address;
    const caps: Array<{ objectId: string; json?: Record<string, unknown> }> = [];
    let cursor: string | null = null;
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

    // Lowest objectId is the canonical cap, matching the canary and the prune tool.
    const cap = caps.sort((a, b) => a.objectId.localeCompare(b.objectId))[0];
    if (!cap) {
      throw new Error(
        `no AgentCap found for owner ${owner} (index ${index}). ` +
          `Agents are not registered on chain yet: run scripts/testnet-canary.ts first.`,
      );
    }
    const profileId =
      (cap.json?.agent_profile_id as string | undefined) ??
      (cap.json?.agentProfileId as string | undefined);
    assert.ok(profileId, `AgentCap ${cap.objectId} has no agent profile id`);
    found.push({ index, owner, profileId, capId: cap.objectId });
  }
  return found;
}

async function main(): Promise<void> {
  const manifest = await loadReleaseManifest(MANIFEST_PATH);
  assert.ok(manifest.packageId, "config/release.testnet.json has no packageId");

  const signers = SignerRegistry.fromEnv(
    {
      SUI_OPERATOR_SECRET_KEY: env("SUI_OPERATOR_SECRET_KEY"),
      OPENVERDICT_AGENT_SEED: env("OPENVERDICT_AGENT_SEED"),
    },
    AGENT_COUNT,
  );

  const client = createFallbackClient({
    network: "testnet",
    suiRpcUrl: manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl,
  });

  console.log(`discovering agents under package ${manifest.packageId} …`);
  const discovered = await discoverAgents(client, manifest, signers);

  const db = createDb({ url: env("DATABASE_URL") });
  try {
    await migrate(db);
    const repository = createRepository(db);
    const models = manifest.gonka.models;
    const timestamp = new Date().toISOString();

    for (const agent of discovered) {
      // Role and model assignment mirror scripts/testnet-canary.ts exactly, so
      // a committee keeps its three distinct model families.
      const sourceRole = agent.index < 3;
      const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
      const modelId = models[sourceRole ? 0 : agent.index < 5 ? 1 : 2]!;

      await repository.saveAgentManifest({
        role,
        agentCapId: agent.capId,
        active: true,
        reputation: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        manifest: {
          agentProfileId: agent.profileId as HexString,
          owner: agent.owner as HexString,
          humanAttestationHash: hexHash(`testnet-human-${agent.index}`),
          humanVerificationProvider: "testnet-demo-allowlist",
          version: "1",
          manifestBlobId: `testnet-manifest-${agent.index}`,
          manifestHash: hexHash(`testnet-manifest-${agent.index}`),
          promptHash: hexHash(`prompt-${agent.index}`),
          modelId,
          providerId: "gonkarouter",
          toolPolicyHash: hexHash(`tools-${agent.index}`),
          evidencePolicyHash: hexHash("OPENVERDICT_EVIDENCE_POLICY_V1"),
          publicKey: agent.owner as HexString,
          registeredAtMs: Date.now(),
          registeredCheckpoint: 0,
        } satisfies AgentManifest,
      });
      console.log(`bound agent ${agent.index} (${role}, ${modelId}) -> ${agent.profileId}`);
    }

    const bound = await repository.listAgentManifests();
    console.log(`\ndone: ${bound.length} agent manifests in the database`);
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Rebuild database agent rows from the published v2 or v3 testnet manifests.
 *
 *   SUI_OPERATOR_SECRET_KEY=<secret> OPENVERDICT_AGENT_SEED=<seed> DATABASE_URL=<url> OPENVERDICT_SUI_GRPC_URL=<url> pnpm tsx scripts/seed-testnet-agents.ts
 */
import assert from "node:assert/strict";

import { parseAgentManifestDocument } from "../lib/engine";
import {
  blake2b256,
  toHex,
  type AgentManifest,
  type AgentManifestDocument,
} from "../lib/protocol";
import {
  closeDb,
  createDb,
  createRepository,
  migrate,
} from "../lib/storage";
import {
  SignerRegistry,
  createFallbackClient,
  loadReleaseManifest,
} from "../lib/sui";
import { createRealWalrusStore, type WalrusStore } from "../lib/walrus";
import {
  discoverAgents,
  type DiscoveredAgent,
} from "./lib/testnet-agents";

const AGENT_COUNT = 7;
const MANIFEST_PATH = "config/release.testnet.json";

class PlaceholderManifestError extends Error {
  override readonly name = "PlaceholderManifestError";

  constructor(profileId: string, options?: ErrorOptions) {
    super(
      `profile ${profileId} still carries a placeholder manifest: run scripts/publish-agent-manifests.ts first`,
      options,
    );
  }
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

async function readManifestDocument(
  walrus: WalrusStore,
  agent: DiscoveredAgent,
): Promise<{ bytes: Uint8Array; document: AgentManifestDocument }> {
  try {
    const bytes = await walrus.get(agent.manifestBlobId);
    return { bytes, document: parseAgentManifestDocument(bytes) };
  } catch (cause) {
    throw new PlaceholderManifestError(agent.profileId, { cause });
  }
}

async function main(): Promise<void> {
  const manifest = await loadReleaseManifest(MANIFEST_PATH);
  assert.equal(manifest.network, "testnet", `${MANIFEST_PATH} is not testnet`);
  assert.ok(manifest.packageId, `${MANIFEST_PATH} has no packageId`);

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
  const baseUrl =
    process.env.OPENVERDICT_SUI_GRPC_URL?.trim() || manifest.suiRpcUrl;
  const walrus = createRealWalrusStore({
    network: "testnet",
    baseUrl,
    signer: signers.getOperator(),
    epochs: manifest.walrus.epochs ?? 10,
  });

  console.log(`discovering agents under package ${manifest.packageId}`);
  const discovered = await discoverAgents(client, manifest, signers);

  const db = createDb({ url: env("DATABASE_URL") });
  try {
    await migrate(db);
    const repository = createRepository(db);
    const timestamp = new Date().toISOString();

    for (const agent of discovered) {
      const { bytes, document } = await readManifestDocument(walrus, agent);
      const manifestHash = toHex(blake2b256(bytes));
      assert.equal(
        manifestHash.toLowerCase(),
        agent.manifestHash.toLowerCase(),
        `profile ${agent.profileId} manifest hash does not match its Walrus document`,
      );
      assert.equal(document.network, "testnet", `${agent.profileId} manifest is not testnet`);
      assert.equal(
        document.operationalOwner.toLowerCase(),
        agent.owner.toLowerCase(),
        `${agent.profileId} manifest owner does not match its profile`,
      );
      assert.equal(
        document.humanBackingHash.toLowerCase(),
        agent.humanBackingHash.toLowerCase(),
        `${agent.profileId} human backing hash does not match its profile`,
      );

      await repository.saveAgentManifest({
        role: document.role,
        agentCapId: agent.capId,
        active: true,
        reputation: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        manifest: {
          agentProfileId: agent.profileId,
          owner: agent.owner,
          humanAttestationHash: agent.humanBackingHash,
          humanVerificationProvider: document.humanVerificationProvider,
          version: document.version,
          manifestBlobId: agent.manifestBlobId,
          manifestHash,
          promptHash: document.promptHash,
          modelId: document.modelId,
          providerId: document.providerId,
          toolPolicyHash: document.toolPolicyHash,
          evidencePolicyHash: document.evidencePolicyHash,
          publicKey: agent.owner,
          registeredAtMs: Date.now(),
          registeredCheckpoint: 0,
        } satisfies AgentManifest,
      });
      console.log(
        `bound agent ${agent.index} (${document.role}, ${document.modelId}) -> ${agent.profileId}`,
      );
    }

    const bound = await repository.listAgentManifests();
    console.log(`done: ${bound.length} agent manifests in the database`);
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  if (error instanceof PlaceholderManifestError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
  process.exitCode = 1;
});

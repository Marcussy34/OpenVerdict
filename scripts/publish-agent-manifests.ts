#!/usr/bin/env node
/**
 * Publish deterministic v6 manifests for the seven existing testnet agents.
 * Manifest v6 pins the table-vote prompt (TABLE_VOTE_PROMPT_SPEC_V1) alongside
 * the existing research prompt and tool policy, so the engine can verify a
 * juror's table-vote runs the same way it verifies research runs.
 *
 * Dry run:
 *   SUI_OPERATOR_SECRET_KEY=<secret> OPENVERDICT_AGENT_SEED=<seed> DATABASE_URL=<url> OPENVERDICT_SUI_GRPC_URL=<url> pnpm tsx scripts/publish-agent-manifests.ts --dry-run
 *
 * Live:
 *   SUI_OPERATOR_SECRET_KEY=<secret> OPENVERDICT_AGENT_SEED=<seed> DATABASE_URL=<url> OPENVERDICT_SUI_GRPC_URL=<url> pnpm tsx scripts/publish-agent-manifests.ts
 */
import assert from "node:assert/strict";

import { SuiGrpcClient } from "@mysten/sui/grpc";

import { buildAgentManifestDocument } from "../lib/engine";
import {
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
} from "../lib/gonka";
import {
  blake2b256,
  fromHex,
  type AgentManifest,
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
  createSuiGateway,
  loadReleaseManifest,
} from "../lib/sui";
import { createRealWalrusStore } from "../lib/walrus";
import { discoverAgents } from "./lib/testnet-agents";

const AGENT_COUNT = 7;
const EVIDENCE_POLICY_ID = "OPENVERDICT_EVIDENCE_POLICY_V1";
const MANIFEST_PATH = "config/release.testnet.json";
const encoder = new TextEncoder();

interface PublishRow {
  index: number;
  profile: string;
  "old hash": string;
  "new hash": string;
  "table vote hash": string;
  "blob id": string;
  digest: string;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

function dryRunFlag(): boolean {
  const args = process.argv.slice(2);
  const unsupported = args.filter((arg) => arg !== "--dry-run");
  assert.deepEqual(unsupported, [], `unsupported arguments: ${unsupported.join(", ")}`);
  return args.includes("--dry-run");
}

async function main(): Promise<void> {
  const dryRun = dryRunFlag();
  const databaseUrl = env("DATABASE_URL");
  const manifest = await loadReleaseManifest(MANIFEST_PATH);
  assert.equal(manifest.network, "testnet", `${MANIFEST_PATH} is not testnet`);
  assert.ok(
    manifest.packageId && manifest.registryObjectId,
    `${MANIFEST_PATH} is missing deployed object IDs`,
  );

  const signers = SignerRegistry.fromEnv(
    {
      SUI_OPERATOR_SECRET_KEY: env("SUI_OPERATOR_SECRET_KEY"),
      OPENVERDICT_AGENT_SEED: env("OPENVERDICT_AGENT_SEED"),
    },
    AGENT_COUNT,
  );
  const readClient = createFallbackClient({
    network: "testnet",
    suiRpcUrl: manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl,
  });
  const baseUrl =
    process.env.OPENVERDICT_SUI_GRPC_URL?.trim() || manifest.suiRpcUrl;
  const writeClient = new SuiGrpcClient({ network: "testnet", baseUrl });
  const gateway = createSuiGateway({ client: writeClient, manifest, signers });
  const walrus = createRealWalrusStore({
    network: "testnet",
    baseUrl,
    signer: signers.getOperator(),
    epochs: manifest.walrus.epochs ?? 10,
  });

  const discovered = await discoverAgents(readClient, manifest, signers);
  const db = dryRun ? undefined : createDb({ url: databaseUrl });
  const rows: PublishRow[] = [];

  try {
    const repository = db === undefined ? undefined : createRepository(db);
    if (db !== undefined) await migrate(db);

    for (const agent of discovered) {
      const sourceRole = agent.index < 3;
      const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
      const modelIndex = sourceRole ? 0 : agent.index < 5 ? 1 : 2;
      const modelId = manifest.gonka.models[modelIndex];
      assert.ok(modelId, `release manifest is missing model ${modelIndex}`);
      const built = buildAgentManifestDocument({
        network: "testnet",
        backingKind: "TESTNET_DEMO_ALLOWLIST",
        humanBackingHash: agent.humanBackingHash,
        humanVerificationProvider: "testnet-demo-allowlist",
        operationalOwner: agent.owner,
        role,
        modelId,
        promptSpec: DEFAULT_PROMPT_SPEC_V4,
        toolPolicy: DEFAULT_TOOL_POLICY_V4,
        tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
        evidencePolicyId: EVIDENCE_POLICY_ID,
      });
      // v6 always pins a table-vote hash because tableVotePromptSpec is always passed above.
      assert.ok(built.tableVotePromptHash, "manifest v6 requires a table vote prompt hash");
      const tableVotePromptHash = built.tableVotePromptHash;
      const row = {
        index: agent.index,
        profile: agent.profileId,
        "old hash": agent.manifestHash,
        "new hash": built.manifestHash,
        "table vote hash": tableVotePromptHash,
        "blob id": agent.manifestBlobId,
        digest: "skipped",
      } satisfies PublishRow;

      if (agent.manifestHash.toLowerCase() === built.manifestHash.toLowerCase()) {
        rows.push(row);
        continue;
      }
      if (dryRun) {
        rows.push({
          ...row,
          "blob id": "(dry run)",
          digest: "(dry run)",
        });
        continue;
      }

      const upload = await walrus.put(built.bytes, {
        identifier: `testnet-agent-${agent.index}-manifest-v6.json`,
      });
      const modelHash = blake2b256(encoder.encode(modelId));
      const roleHash = blake2b256(encoder.encode(`OPENVERDICT_ROLE_${role}`));
      const update = await gateway.updateAgentManifest({
        agentIndex: agent.index,
        agentProfileId: agent.profileId,
        agentCapId: agent.capId,
        manifestHash: fromHex(built.manifestHash),
        manifestBlobId: upload.blobId,
        modelHash,
        roleHash,
      });

      assert.ok(repository, "repository is required for a live publish");
      const timestamp = new Date().toISOString();
      await repository.saveAgentManifest({
        role,
        agentCapId: agent.capId,
        active: true,
        reputation: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        manifest: {
          agentProfileId: agent.profileId,
          owner: agent.owner,
          humanAttestationHash: agent.humanBackingHash,
          humanVerificationProvider: "testnet-demo-allowlist",
          version: built.document.version,
          manifestBlobId: upload.blobId,
          manifestHash: built.manifestHash,
          promptHash: built.promptHash,
          tableVotePromptHash,
          modelId,
          providerId: "gonkarouter",
          toolPolicyHash: built.toolPolicyHash,
          evidencePolicyHash: built.document.evidencePolicyHash,
          publicKey: agent.owner,
          registeredAtMs: Date.now(),
          registeredCheckpoint: 0,
        } satisfies AgentManifest,
      });
      rows.push({
        ...row,
        "blob id": upload.blobId,
        digest: update.digest,
      });
    }

    console.table(rows);
  } finally {
    if (db !== undefined) await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});


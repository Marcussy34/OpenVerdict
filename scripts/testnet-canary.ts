#!/usr/bin/env node
/**
 * Sui TESTNET canary (plan T8a/T8b): one complete direct-review lifecycle on
 * the deployed public package with the LIVE GonkaRouter jury — five real
 * inference calls across three model families, commit-reveal on testnet, an
 * immutable ResolutionCertificate, and a recomputed-vs-on-chain Truth Score.
 *
 * Artifacts (LocalWalrusStore) stay on disk: testnet Walrus upload needs WAL
 * tokens and is documented as a follow-up in docs/demo/runbook.md.
 *
 * Run: pnpm tsx scripts/testnet-canary.ts   (≈12 minutes; costs ≈0.1 SUI)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createEngine, type Engine, type EngineAgentConfig } from "../lib/engine";
import { createGonkaAdapter } from "../lib/gonka";
import { blake2b256, computeTruthScoreBps, toHex, type AgentManifest, type HexString } from "../lib/protocol";
import { closeDb, createDb } from "../lib/storage";
import {
  SignerRegistry,
  createFallbackClient,
  createSuiGateway,
  executeAndWait,
  loadReleaseManifest,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
} from "../lib/sui";
import { createLocalWalrusStore } from "../lib/walrus";
import { repositoryRoot, writeEngineCompatibleManifest } from "./deploy-localnet";
import { serializeRunApprovals } from "./localnet-e2e";

const AGENT_COUNT = 7;
const AGENT_FUND_MIST = 20_000_000n; // 0.02 SUI top-up per underfunded agent
const MINUTE = 60_000;

function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const raw = readFileSync(join(repositoryRoot, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
    if (match) return match[1]!.trim();
  } catch {
    // fall through
  }
  throw new Error(`${name} is required (env or .env)`);
}

function hexHash(label: string): HexString {
  return toHex(blake2b256(new TextEncoder().encode(label)));
}

async function fundAgents(
  client: OpenVerdictSuiClient,
  operator: Ed25519Keypair,
  addresses: string[],
): Promise<string> {
  const tx = new Transaction();
  const amounts = addresses.map(() => tx.pure.u64(AGENT_FUND_MIST));
  const coins = tx.splitCoins(tx.gas, amounts);
  addresses.forEach((address, index) => {
    tx.transferObjects([coins[index]!], address);
  });
  const result = await executeAndWait(client, operator, tx);
  return result.digest;
}


interface DiscoveredAgent {
  index: number;
  owner: string;
  profileId: string;
  capId: string;
}

/** Reuse prior registrations: one AgentCap per deterministic owner address. */
async function discoverAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<DiscoveredAgent[] | null> {
  const type = `${manifest.packageId}::agent_registry::AgentCap`;
  const found: DiscoveredAgent[] = [];
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const owner = signers.getAgentAt(index).address;
    let cursor: string | null = null;
    // Prior attempts registered several profiles per owner. Collect EVERY cap
    // and pick the lowest objectId so runs (and the registry prune tool) agree
    // deterministically on which profile per owner stays live.
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
    const cap = caps.sort((a, b) => a.objectId.localeCompare(b.objectId))[0] ?? null;
    if (!cap) return null;
    const profileId =
      (cap.json?.agent_profile_id as string | undefined) ??
      (cap.json?.agentProfileId as string | undefined);
    if (!profileId) return null;
    found.push({ index, owner, profileId, capId: cap.objectId });
  }
  return found;
}

async function registerAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<Array<{ config: EngineAgentConfig; profileId: string; modelId: string }>> {
  const gateway = createSuiGateway({ client, manifest, signers });
  const models = manifest.gonka.models;
  const registered: Array<{ config: EngineAgentConfig; profileId: string; modelId: string }> = [];
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const sourceRole = index < 3;
    const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
    const modelId = models[sourceRole ? 0 : index < 5 ? 1 : 2]!;
    const humanHash = blake2b256(new TextEncoder().encode(`testnet-human-${index}`));
    const manifestHash = blake2b256(new TextEncoder().encode(`testnet-manifest-${index}`));
    const result = await gateway.registerAgent({
      agentIndex: index,
      bondAmount: 1,
      manifestHash,
      manifestBlobId: `testnet-manifest-${index}`,
      modelHash: blake2b256(new TextEncoder().encode(modelId)),
      roleHash: blake2b256(new TextEncoder().encode(`OPENVERDICT_ROLE_${role}`)),
      humanBackingHash: humanHash,
    });
    assert.ok(result.agentCapId, `agent ${index} missing AgentCap`);
    const owner = signers.getAgentAt(index).address;
    registered.push({
      profileId: result.agentProfileId,
      modelId,
      config: {
        role,
        agentCapId: result.agentCapId,
        manifest: {
          agentProfileId: result.agentProfileId as HexString,
          owner: owner as HexString,
          humanAttestationHash: toHex(humanHash),
          humanVerificationProvider: "testnet-demo-allowlist",
          version: "1",
          manifestBlobId: `testnet-manifest-${index}`,
          manifestHash: toHex(manifestHash),
          promptHash: hexHash(`prompt-${index}`),
          modelId,
          providerId: "gonkarouter",
          toolPolicyHash: hexHash(`tools-${index}`),
          evidencePolicyHash: hexHash("OPENVERDICT_EVIDENCE_POLICY_V1"),
          publicKey: owner,
          registeredAtMs: Date.now(),
          registeredCheckpoint: 0,
        } satisfies AgentManifest,
      },
    });
    console.log(`registered agent ${index} (${role}, ${modelId}) -> ${result.agentProfileId}`);
  }
  return registered;
}

async function waitUntil(label: string, deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return;
  console.log(`waiting ${(remaining / 1000).toFixed(0)}s until ${label} …`);
  await new Promise((resolve) => setTimeout(resolve, remaining + 3_000));
}

async function main(): Promise<void> {
  // Strip deploy-only cap keys into an engine-compatible runtime manifest,
  // mirroring the localnet flow.
  const runtimeManifestPath = join(repositoryRoot, ".testnet/release.runtime.json");
  await writeEngineCompatibleManifest(
    join(repositoryRoot, "config/release.testnet.json"),
    runtimeManifestPath,
  );
  const manifest = await loadReleaseManifest(runtimeManifestPath);
  assert.ok(manifest.packageId, "run scripts/deploy-testnet.ts first");
  const rpcUrl = manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl;
  const client = createFallbackClient({ network: "testnet", suiRpcUrl: rpcUrl });

  const operator = Ed25519Keypair.fromSecretKey(env("SUI_OPERATOR_SECRET_KEY"));
  const signers = SignerRegistry.fromEnv(
    {
      SUI_OPERATOR_SECRET_KEY: operator.getSecretKey(),
      OPENVERDICT_AGENT_SEED: env("OPENVERDICT_AGENT_SEED"),
    },
    AGENT_COUNT,
  );

  const underfunded: string[] = [];
  for (const address of signers.listAgentAddresses()) {
    const balance = await client.core.getBalance({ owner: address });
    if (BigInt(balance.balance.balance ?? 0) < 15_000_000n) underfunded.push(address);
  }
  if (underfunded.length === 0) {
    console.log("agents already funded; skipping fund step");
  } else {
    const fundDigest = await fundAgents(client, operator, underfunded);
    console.log(`topped up ${underfunded.length} agents in ${fundDigest}`);
  }

  let agents: Array<{ config: EngineAgentConfig; profileId: string; modelId: string }>;
  const discovered = await discoverAgents(client, manifest, signers);
  if (discovered) {
    console.log(`reusing ${discovered.length} previously registered agents`);
    agents = discovered.map(({ index, owner, profileId, capId }) => {
      signers.bindAgentProfile({ agentProfileId: profileId, agentCapId: capId, owner });
      const sourceRole = index < 3;
      const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
      const modelId = manifest.gonka.models[sourceRole ? 0 : index < 5 ? 1 : 2]!;
      const humanHash = blake2b256(new TextEncoder().encode(`testnet-human-${index}`));
      const manifestHash = blake2b256(new TextEncoder().encode(`testnet-manifest-${index}`));
      return {
        profileId,
        modelId,
        config: {
          role,
          agentCapId: capId,
          manifest: {
            agentProfileId: profileId as HexString,
            owner: owner as HexString,
            humanAttestationHash: toHex(humanHash),
            humanVerificationProvider: "testnet-demo-allowlist",
            version: "1",
            manifestBlobId: `testnet-manifest-${index}`,
            manifestHash: toHex(manifestHash),
            promptHash: hexHash(`prompt-${index}`),
            modelId,
            providerId: "gonkarouter",
            toolPolicyHash: hexHash(`tools-${index}`),
            evidencePolicyHash: hexHash("OPENVERDICT_EVIDENCE_POLICY_V1"),
            publicKey: owner,
            registeredAtMs: Date.now(),
            registeredCheckpoint: 0,
          } satisfies AgentManifest,
        },
      };
    });
  } else {
    agents = await registerAgents(client, manifest, signers);
  }

  const gonka = createGonkaAdapter({
    baseUrl: env("GONKA_ROUTER_BASE_URL"),
    apiKey: env("GONKA_ROUTER_API_KEY"),
    timeoutMs: 240_000,
    maxRetries: 1,
  });
  const db = createDb({ dataDir: join(repositoryRoot, ".testnet/pglite") });
  const engine: Engine = await createEngine({
    network: "testnet",
    manifestPath: runtimeManifestPath,
    db,
    walrus: createLocalWalrusStore(join(repositoryRoot, ".testnet/walrus-local")),
    gonka,
    suiGateway: serializeRunApprovals(
      createSuiGateway({ client, manifest, signers }),
    ),
    initialAgents: agents.map((agent) => agent.config),
  });

  try {
    const now = Date.now();
    const statement =
      "The Sui testnet chain identifier reported by JSON-RPC is 4c78adac.";
    const { claimId } = await engine.factCheckStart({
      claim: statement,
      text:
        "Snapshot: POST sui_getChainIdentifier to the public testnet JSON-RPC " +
        "endpoint returned {\"jsonrpc\":\"2.0\",\"result\":\"4c78adac\"} on 2026-08-27.",
      urls: [],
      resolutionCriteria:
        "YES if the canonical Sui testnet chain identifier equals 4c78adac per " +
        "sui_getChainIdentifier before the evidence cutoff; NO if it differs; " +
        "UNSURE if the endpoint cannot be read. Admissible: the submitted " +
        "statement text snapshot.",
      deadlines: {
        evidenceCutoffMs: now + 40_000,
        proposalDeadlineMs: now + 45_000,
        challengeDeadlineMs: now + 50_000,
        // Serial live runs finish in ~2-3 min; the binding constraint is the
        // ACCEPTANCE window (selection + half-way-to-commit) that lock waits
        // for. 15 min to commit ⇒ acceptance ~7.5 min ⇒ ~20 min end to end.
        firstCommitDeadlineMs: now + 15 * MINUTE,
        firstRevealDeadlineMs: now + 18 * MINUTE,
        discussionDeadlineMs: now + 20 * MINUTE,
        secondCommitDeadlineMs: now + 28 * MINUTE,
        secondRevealDeadlineMs: now + 32 * MINUTE,
      },
    });
    console.log(`claim created: ${claimId}`);

    await waitUntil("evidence cutoff", now + 40_000);
    await engine.evidenceFreeze(claimId, 1);
    console.log("evidence frozen (phase 1)");
    const selectedAtMs = Date.now();
    const committee = await engine.selectCommittee(claimId);
    console.log(`committee selected in ${committee.digest}`);

    const jury = await engine.juryRun(claimId, 1);
    for (const run of jury.runs) {
      console.log(
        `LIVE run ${run.agentProfileId.slice(0, 10)}… model=${run.modelId} ` +
          `status=${run.status} gonkaRequestId=${run.gonkaRequestId}`,
      );
    }
    // jury::lock_committee opens at selection + (commit − selection) / 2
    // (E_DEADLINE_NOT_REACHED = 20 before that) — wait the window out.
    const preCommit = await engine.inspect(claimId);
    const acceptanceMs =
      selectedAtMs +
      Math.floor((preCommit.deadlines.firstCommitDeadlineMs - selectedAtMs) / 2);
    await waitUntil("acceptance window", acceptanceMs + 5_000);
    const commits = await engine.votesCommit(claimId, 1);
    console.log(`committed ${commits.length} votes`);

    const inspection = await engine.inspect(claimId);
    await waitUntil("first reveal window", inspection.deadlines.firstCommitDeadlineMs);
    // COMMIT_1 → REVEAL_1 transition is explicit; reveal refuses in COMMIT_1.
    await engine.advance(claimId);
    const reveals = await engine.votesReveal(claimId, 1);
    console.log(`revealed ${reveals.length} votes`);

    await waitUntil("finalization window", inspection.deadlines.firstRevealDeadlineMs);
    const finalize = await engine.finalize(claimId);
    console.log(`finalized: ${finalize.result} score=${finalize.truthScoreBps}`);
    console.log(`certificate: ${finalize.certificateId}`);

    const report = await engine.report(claimId);
    const recomputed = computeTruthScoreBps(
      report.finalRoundVotes.map((vote) => ({
        outcome:
          vote.outcome === "YES" ? 1 : vote.outcome === "NO" ? 2 : 3,
        confidenceBps: vote.confidenceBps,
      })),
    );
    assert.equal(
      recomputed,
      finalize.truthScoreBps,
      "recomputed truth score must equal the certificate value",
    );

    console.log("\n=== TESTNET CANARY SUMMARY ===");
    console.log(`claim            ${claimId}`);
    console.log(`result           ${finalize.result}`);
    console.log(`truth score bps  ${finalize.truthScoreBps} (recomputed ${recomputed})`);
    console.log(`certificate      ${finalize.certificateId}`);
    console.log(`finalize digest  ${finalize.digest}`);
    console.log(`evidence root    ${report.evidenceRoot ?? "-"}`);
    console.log("gonka request ids:");
    for (const agent of report.agents) {
      console.log(`  ${agent.modelId}  ${agent.gonkaRequestId}`);
    }
    console.log(
      `explorer         https://suiscan.xyz/testnet/object/${finalize.certificateId}`,
    );
  } finally {
    if (db) await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

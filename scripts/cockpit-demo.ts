#!/usr/bin/env node
/**
 * Cockpit demo harness: spin a localnet, run one COMPLETED fact-check
 * lifecycle plus one claim frozen mid-jury (sealed commitments), then exit
 * LEAVING the localnet and the .pglite state alive so `pnpm dev` renders the
 * observer against real data. Used for the visual verification pass.
 *
 *   pnpm tsx scripts/cockpit-demo.ts          # then: pnpm dev
 *   pkill -f "sui start" when finished.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createEngine, type Engine, type EngineAgentConfig } from "../lib/engine";
import { createFakeGonkaAdapter, type GonkaRouterAdapter } from "../lib/gonka";
import { blake2b256, toHex, type AgentManifest, type HexString } from "../lib/protocol";
import { closeDb, createDb } from "../lib/storage";
import {
  SignerRegistry,
  createSuiGateway,
  loadReleaseManifest,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
} from "../lib/sui";
import { createLocalWalrusStore } from "../lib/walrus";
import {
  createLocalnetRpcClient,
  deployLocalnet,
  fundAddress,
  localnetConfigPath,
  localnetFaucetUrl,
  repositoryRoot,
  writeEngineCompatibleManifest,
} from "./deploy-localnet";
import { serializeRunApprovals, waitForOnChainDeadline } from "./localnet-e2e";

const AGENT_COUNT = 7;
const runtimeManifestPath = join(repositoryRoot, ".localnet/release.runtime.json");

// Fixed demo credentials so `pnpm dev` (reading .env.demo values) rebinds cleanly.
const DEMO_OPERATOR = new Ed25519Keypair();
const DEMO_SEED = "cockpit-demo-fixed-seed";

function hexHash(label: string): HexString {
  return toHex(blake2b256(new TextEncoder().encode(label)));
}

async function waitForRpc(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:9000", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getChainIdentifier", params: [] }),
        signal: AbortSignal.timeout(1500),
      });
      const json = (await response.json()) as { result?: unknown };
      if (typeof json.result === "string") return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("localnet RPC not ready");
}

async function registerAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
): Promise<EngineAgentConfig[]> {
  const gateway = createSuiGateway({ client, manifest, signers });
  const configs: EngineAgentConfig[] = [];
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    const sourceRole = index < 3;
    const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
    const modelId = manifest.gonka.models[sourceRole ? 0 : index < 5 ? 1 : 2]!;
    const humanHash = blake2b256(new TextEncoder().encode(`cockpit-human-${index}`));
    const manifestHash = blake2b256(new TextEncoder().encode(`cockpit-manifest-${index}`));
    const result = await gateway.registerAgent({
      agentIndex: index,
      bondAmount: 1,
      manifestHash,
      manifestBlobId: `cockpit-manifest-${index}`,
      modelHash: blake2b256(new TextEncoder().encode(modelId)),
      roleHash: blake2b256(new TextEncoder().encode(`OPENVERDICT_ROLE_${role}`)),
      humanBackingHash: humanHash,
    });
    configs.push({
      role,
      agentCapId: result.agentCapId!,
      manifest: {
        agentProfileId: result.agentProfileId as HexString,
        owner: signers.getAgentAt(index).address as HexString,
        humanAttestationHash: toHex(humanHash),
        humanVerificationProvider: "cockpit-demo-allowlist",
        version: "1",
        manifestBlobId: `cockpit-manifest-${index}`,
        manifestHash: toHex(manifestHash),
        promptHash: hexHash(`prompt-${index}`),
        modelId,
        providerId: "gonkarouter",
        toolPolicyHash: hexHash(`tools-${index}`),
        evidencePolicyHash: hexHash("OPENVERDICT_EVIDENCE_POLICY_V1"),
        publicKey: signers.getAgentAt(index).address,
        registeredAtMs: Date.now(),
        registeredCheckpoint: 0,
      } satisfies AgentManifest,
    });
  }
  return configs;
}

function fakeJury(outcomes: Array<"YES" | "NO" | "UNSURE">, profileIds: HexString[]): GonkaRouterAdapter {
  const fixtures = profileIds.map((agentProfileId, index) => ({
    agentProfileId,
    outcome: outcomes[index % outcomes.length]!,
    confidenceBps: 8_000 + index * 250,
  }));
  return createFakeGonkaAdapter(fixtures);
}


/** The fast-profile acceptance window makes lock timing racy; retry through it. */
async function commitWithRetry(engine: Engine, claimId: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await engine.votesCommit(claimId, 1);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 8 && message.includes("abort code: 20")) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        continue;
      }
      throw error;
    }
  }
}

async function main(): Promise<void> {
  await rm(join(repositoryRoot, ".pglite"), { recursive: true, force: true });
  await rm(join(repositoryRoot, ".localnet/walrus-local"), { recursive: true, force: true });

  const child = spawn("sui", ["start", "--with-faucet", "--force-regenesis"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SUI_CONFIG_DIR: join(repositoryRoot, ".localnet/sui-config") },
  });
  child.unref();
  console.log(`localnet spawned (pid ${child.pid}) — left RUNNING for pnpm dev`);
  await waitForRpc(120_000);
  // Faucet (9123) comes up after the RPC; probe until it answers HTTP.
  const faucetDeadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(localnetFaucetUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ FixedAmountRequest: { recipient: "0x1" } }),
        signal: AbortSignal.timeout(1500),
      });
      break; // any HTTP response (even 4xx) means the listener is up
    } catch {
      if (Date.now() > faucetDeadline) throw new Error("localnet faucet not ready");
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  const client = createLocalnetRpcClient();
  await deployLocalnet({ client, force: true, publisherKeypair: DEMO_OPERATOR, log: console.log });
  await writeEngineCompatibleManifest(localnetConfigPath, runtimeManifestPath);
  const manifest = await loadReleaseManifest(runtimeManifestPath);

  const signers = SignerRegistry.fromEnv(
    {
      SUI_OPERATOR_SECRET_KEY: DEMO_OPERATOR.getSecretKey(),
      OPENVERDICT_AGENT_SEED: DEMO_SEED,
    },
    AGENT_COUNT,
  );
  for (const address of signers.listAgentAddresses()) {
    await fundAddress({ client, address, faucetUrl: localnetFaucetUrl });
  }
  const agents = await registerAgents(client, manifest, signers);
  const profileIds = agents.map((agent) => agent.manifest.agentProfileId);

  const db = createDb();
  const buildEngine = async (adapter: GonkaRouterAdapter): Promise<Engine> =>
    createEngine({
      network: "localnet",
      manifestPath: runtimeManifestPath,
      db,
      walrus: createLocalWalrusStore(join(repositoryRoot, ".localnet/walrus-local")),
      gonka: adapter,
      suiGateway: serializeRunApprovals(createSuiGateway({ client, manifest, signers })),
      initialAgents: agents,
    });

  // Claim #1: complete lifecycle → report page shows a full verdict.
  const engine1 = await buildEngine(fakeJury(["YES", "YES", "YES", "YES", "NO"], profileIds));
  const claim1 = await engine1.factCheckStart({
    claim: "The demo protocol completed all three published launch conditions before the deadline.",
    text: "Launch snapshot: condition A shipped, condition B shipped, condition C shipped before the cutoff.",
    urls: [],
  });
  console.log("claim #1:", claim1.claimId);
  await engine1.evidenceFreeze(claim1.claimId, 1);
  await engine1.selectCommittee(claim1.claimId);
  // Idempotent re-freeze AFTER selection binds seats to the evidence root
  // (jury::commit_vote aborts 21 E_EVIDENCE_NOT_BOUND otherwise) — E2E pattern.
  await engine1.evidenceFreeze(claim1.claimId, 1);
  // Acceptance window: lock requires now >= selection + (commit - selection)/2.
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await engine1.juryRun(claim1.claimId, 1);
  await commitWithRetry(engine1, claim1.claimId);
  const inspect1 = await engine1.inspect(claim1.claimId);
  // E2E sequence: on-chain deadline → advance (COMMIT_1→REVEAL_1) → reveal → finalize.
  await waitForOnChainDeadline(client, inspect1.deadlines.firstCommitDeadlineMs, "claim #1 reveal");
  await engine1.advance(claim1.claimId);
  await engine1.votesReveal(claim1.claimId, 1);
  await waitForOnChainDeadline(client, inspect1.deadlines.firstRevealDeadlineMs, "claim #1 finalize");
  const final1 = await engine1.finalize(claim1.claimId);
  console.log("claim #1 finalized:", final1.result, final1.truthScoreBps, final1.certificateId);

  // Claim #2: stop after commitments → observer shows sealed lanes.
  const claim2 = await engine1.factCheckStart({
    claim: "The observer renders sealed commitments before any reveal.",
    text: "Cockpit demo second claim held in the sealed-commitment phase.",
    urls: [],
  });
  console.log("claim #2:", claim2.claimId);
  await engine1.evidenceFreeze(claim2.claimId, 1);
  await engine1.selectCommittee(claim2.claimId);
  await engine1.evidenceFreeze(claim2.claimId, 1); // re-freeze binds seats (see claim #1)
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await engine1.juryRun(claim2.claimId, 1);
  await commitWithRetry(engine1, claim2.claimId);
  console.log("claim #2 left SEALED (committed, unrevealed)");

  await closeDb(db);
  console.log("\nSTATE READY — run the observer:");
  console.log(`  SUI_OPERATOR_SECRET_KEY=${DEMO_OPERATOR.getSecretKey()}`);
  console.log(`  OPENVERDICT_AGENT_SEED=${DEMO_SEED}`);
  console.log(`  OPENVERDICT_RELEASE_MANIFEST=${runtimeManifestPath}`);
  console.log("  pnpm dev   (then pkill -f 'sui start' when done)");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, open, type FileHandle } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  COMMITTEE_ACCEPTANCE_WINDOW_MS,
  buildAgentManifestDocument,
  createEngine,
  type ClaimInspection,
  type Engine,
  type EngineAgentConfig,
  type FinalizeReport,
} from "../lib/engine";
import {
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V4,
  DELIBERATION_PROMPT_SPEC_V1,
  DELIBERATION_PROMPT_SPEC_V2,
  DELIBERATION_PROMPT_SPEC_V3,
  TABLE_VOTE_PROMPT_SPEC_V1,
  createFakeGonkaAdapter,
  hashCanonicalJson,
  tableVotePromptSpecHash,
  type GonkaCompletionResult,
  type GonkaRouterAdapter,
} from "../lib/gonka";
import {
  CLAIM_STATE,
  OUTCOME,
  blake2b256,
  computeTruthScoreBps,
  fromHex,
  toHex,
  type AgentManifest,
  type HexString,
  type OracleInferenceInput,
  type OracleInferenceOutput,
} from "../lib/protocol";
import type { ResearchProvider } from "../lib/research";
import { closeDb, createDb, type DbHandle } from "../lib/storage";
import {
  SignerRegistry,
  buildCreateDemoPoolTransaction,
  buildRedeemDemoPoolTransaction,
  buildRegisterStakedAgentTransaction,
  buildSettleDemoPoolTransaction,
  createSuiGateway,
  executeAndWait,
  loadReleaseManifest,
  sponsorAndExecute,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
  type SuiGateway,
} from "../lib/sui";
import { createLocalWalrusStore, type WalrusStore } from "../lib/walrus";
import {
  deployLocalnet,
  createLocalnetRpcClient,
  fundAddress,
  localnetConfigPath,
  localnetFaucetUrl,
  localnetRpcUrl,
  recordDemoPoolObjectId,
  repositoryRoot,
  writeEngineCompatibleManifest,
} from "./deploy-localnet";

const localnetDir = join(repositoryRoot, ".localnet");
const localnetSuiConfigDir = join(localnetDir, "sui-config");
const runtimeManifestPath = join(localnetDir, "release.runtime.json");
const localnetPorts = [9000, 9123] as const;
const agentCount = 7;
// Slot seven runs the sponsored staked seat; slots zero to six run the demo agents.
const signerSlotCount = agentCount + 1;
const stakedSeatSlot = agentCount;
const minStakeMist = 100_000_000n;
const poolStake = 100_000_000n;
const evidencePolicyId = "OPENVERDICT_EVIDENCE_POLICY_V1";

const directStatement = "OpenVerdict localnet direct-review proof is operational.";
const splitStatement = "OpenVerdict localnet split-vote proof reaches discussion.";
const unresolvedStatement = "OpenVerdict localnet unresolved proof has no threshold.";

interface RunningLocalnet {
  child?: ChildProcess;
  log: FileHandle;
  path: "spawned" | "reused";
}

interface RegisteredAgent {
  profileId: string;
  owner: string;
  modelId: string;
  role: string;
  manifest: AgentManifest;
  agentCapId: string;
}

interface LifecycleResult {
  claimId: string;
  selectDigest: string;
  finalize: FinalizeReport;
  truthScoreBps: number;
  onChainTruthScoreBps: number;
  createDigest: string;
}

interface PoolProof {
  poolId: string;
  positionId: string;
  createDigest: string;
  sponsoredDigest: string;
  settleDigest: string;
  redeemDigest: string;
  payout: bigint;
  fee: bigint;
}

interface StakedSeatProof {
  profileId: string;
  positionId: string;
  operationalOwner: string;
  staker: string;
  stakeDigest: string;
  unstakeDigest: string;
}

interface VoteInstruction {
  outcome: OracleInferenceOutput["outcome"];
  confidenceBps: number;
}

interface FakeController {
  adapter: GonkaRouterAdapter;
  configure(
    statement: string,
    profileIds: string[],
    rounds: OracleInferenceOutput["outcome"][][],
  ): void;
}

interface E2eContext {
  engine: Engine;
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  controller: FakeController;
  agents: RegisteredAgent[];
  signerRegistry: SignerRegistry;
}

interface StepTimings {
  localnetStartupMs: number;
  deploymentMs: number;
  totalMs: number;
}

let activeStep = "initialization";

async function main(): Promise<void> {
  const totalStartedAt = Date.now();
  const previousFreezeLead = process.env.OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS;
  process.env.OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS = "0";
  let localnet: RunningLocalnet | undefined;
  let db: DbHandle | undefined;
  let dbClosed = false;
  const timings: StepTimings = {
    localnetStartupMs: 0,
    deploymentMs: 0,
    totalMs: 0,
  };

  try {
    localnet = await step("1. start isolated Sui localnet", 125_000, async () => {
      const startedAt = Date.now();
      const running = await startLocalnet();
      await waitForLocalnet(running, 120_000);
      timings.localnetStartupMs = Date.now() - startedAt;
      return running;
    });

    const client = createLocalnetRpcClient();
    const operator = new Ed25519Keypair();
    const deployment = await step("2. deploy Move package", 240_000, async () => {
      const startedAt = Date.now();
      const result = await deployLocalnet({
        client,
        force: true,
        publisherKeypair: operator,
        log: logDetail,
      });
      assert.equal(result.published, true, "fresh regenesis must publish a package");
      assert.equal(
        result.publisherKeypair?.toSuiAddress(),
        operator.toSuiAddress(),
        "operator must own the deployment capabilities",
      );
      timings.deploymentMs = Date.now() - startedAt;
      return result;
    });
    await writeEngineCompatibleManifest(localnetConfigPath, runtimeManifestPath);
    const manifest = await loadReleaseManifest(runtimeManifestPath);
    assert.equal(manifest.packageId, deployment.packageId);
    assert.equal(manifest.registryObjectId, deployment.registryObjectId);

    const agentSeed = `localnet-e2e-${Date.now()}`;
    const signerRegistry = SignerRegistry.fromEnv(
      {
        SUI_OPERATOR_SECRET_KEY: operator.getSecretKey(),
        OPENVERDICT_AGENT_SEED: agentSeed,
      },
      signerSlotCount,
    );
    const user = new Ed25519Keypair();
    await step("3. fund and register the jury registry", 180_000, async () => {
      for (const address of [
        ...signerRegistry.listAgentAddresses(),
        user.toSuiAddress(),
      ]) {
        await fundAddress({
          client,
          address,
          faucetUrl: localnetFaucetUrl,
        });
      }
      const addresses = new Set([
        operator.toSuiAddress(),
        ...signerRegistry.listAgentAddresses(),
        user.toSuiAddress(),
      ]);
      assert.equal(addresses.size, signerSlotCount + 2, "all funded actors must be distinct");
    });
    const walrus = createLocalWalrusStore(join(localnetDir, "walrus-local"));
    const agents = await registerAgents(client, manifest, signerRegistry, walrus);
    assert.equal(agents.length, agentCount);
    assert.ok(new Set(agents.map((agent) => agent.owner)).size === agentCount);
    assert.ok(new Set(agents.map((agent) => agent.manifest.humanAttestationHash)).size === agentCount);
    assert.ok(new Set(agents.map((agent) => agent.modelId)).size >= 3);
    logDetail("registered 7 profiles: 5 jurors plus 2 protocol-required reserves");

    // The staked seat is retired inside this step, so the lifecycles below
    // still draw from exactly the seven demo profiles.
    const staked = await step("3b. sponsored staked seat", 120_000, async () => {
      return runStakedSeatProof({
        client,
        manifest,
        operator,
        user,
        signers: signerRegistry,
        walrus,
      });
    });

    const controller = createFakeController();
    db = createDb();
    const engineGateway = rebaseDeadlinesForLocalLifecycle(
      serializeRunApprovals(
        createSuiGateway({ client, manifest, signers: signerRegistry }),
      ),
    );
    const engine = await createEngine({
      network: "localnet",
      manifestPath: runtimeManifestPath,
      db,
      walrus,
      gonka: controller.adapter,
      research: createLocalnetResearchProvider(),
      suiGateway: engineGateway,
      initialAgents: agents.map<EngineAgentConfig>((agent) => ({
        manifest: agent.manifest,
        role: agent.role,
        agentCapId: agent.agentCapId,
      })),
    });
    const context: E2eContext = {
      engine,
      client,
      manifest,
      controller,
      agents,
      signerRegistry,
    };

    let poolSetup: Omit<PoolProof, "settleDigest" | "redeemDigest" | "payout" | "fee"> | undefined;
    const direct = await step("4. direct-review lifecycle", 180_000, async () => {
      return runLifecycle(context, {
        label: "claim #1 direct review",
        statement: directStatement,
        phaseOne: ["YES", "YES", "YES", "YES", "YES"],
        expectedState: CLAIM_STATE.FINALIZED_REVIEWED,
        expectedResult: "YES",
        onCreated: async (claimId, inspection) => {
          poolSetup = await createAndEnterPool({
            client,
            manifest,
            operator,
            user,
            claimId,
            challengeDeadlineMs: inspection.deadlines.challengeDeadlineMs,
          });
          await recordDemoPoolObjectId(poolSetup.poolId);
          await writeEngineCompatibleManifest(localnetConfigPath, runtimeManifestPath);
        },
      });
    });

    const split = await step("5a. split-vote discussion lifecycle", 240_000, async () => {
      return runLifecycle(context, {
        label: "claim #2 split vote",
        statement: splitStatement,
        phaseOne: ["YES", "YES", "YES", "NO", "NO"],
        phaseTwo: ["YES", "YES", "YES", "YES", "NO"],
        expectedState: CLAIM_STATE.FINALIZED_REVIEWED,
        expectedResult: "YES",
      });
    });

    const unresolved = await step("5b. unresolved two-round lifecycle", 240_000, async () => {
      return runLifecycle(context, {
        label: "claim #3 unresolved",
        statement: unresolvedStatement,
        phaseOne: ["YES", "YES", "YES", "NO", "NO"],
        phaseTwo: ["YES", "YES", "NO", "NO", "NO"],
        expectedState: CLAIM_STATE.UNRESOLVED,
        expectedResult: "UNRESOLVED",
      });
    });

    const completedPoolSetup = required(
      poolSetup,
      "claim #1 demo pool created before the challenge deadline",
    );
    const pool = await step("6. settle and redeem sponsored demo pool", 90_000, async () => {
      return settleAndRedeemPool({
        client,
        manifest,
        operator,
        user,
        certificateId: direct.finalize.certificateId,
        setup: completedPoolSetup,
      });
    });

    await closeDb(db);
    dbClosed = true;
    const cliInspection = await step("7. CLI subprocess parity", 60_000, async () => {
      return runCliInspection(direct.claimId, {
        SUI_OPERATOR_SECRET_KEY: operator.getSecretKey(),
        OPENVERDICT_AGENT_SEED: agentSeed,
        OPENVERDICT_RELEASE_MANIFEST: runtimeManifestPath,
      });
    });
    assert.equal(cliInspection.claimId, direct.claimId);
    assert.equal(cliInspection.state, CLAIM_STATE.FINALIZED_REVIEWED);
    assert.equal(cliInspection.result?.result, "YES");
    assert.equal(cliInspection.result?.truthScoreBps, direct.truthScoreBps);

    timings.totalMs = Date.now() - totalStartedAt;
    printSummary({ direct, split, unresolved, pool, staked, timings });
  } finally {
    if (db && !dbClosed) await closeDb(db).catch(() => undefined);
    if (localnet) await stopLocalnet(localnet);
    if (previousFreezeLead === undefined) {
      delete process.env.OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS;
    } else {
      process.env.OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS = previousFreezeLead;
    }
  }
}

/** ONLY serializes approveRun (concurrent operator txs equivocate gas). */
export function serializeRunApprovals(gateway: SuiGateway): SuiGateway {
  let approvalTail = Promise.resolve();
  return new Proxy(gateway, {
    get(target, property, receiver) {
      if (property === "approveRun") {
        return (input: Parameters<SuiGateway["approveRun"]>[0]) => {
          const result = approvalTail.then(() => target.approveRun(input));
          approvalTail = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Localnet-lifecycle deadline rebase: at createClaim time, replace whatever
 * deadlines the caller computed with a fixed fast ladder anchored to NOW, so
 * long harness setup cannot drift claims into already-passed windows.
 * LOCAL HARNESSES ONLY (E2E + cockpit). This silently overrode the testnet
 * canary's wide deadlines for four runs when it lived inside
 * serializeRunApprovals; never compose it into a live-network gateway.
 */
export function rebaseDeadlinesForLocalLifecycle(gateway: SuiGateway): SuiGateway {
  return new Proxy(gateway, {
    get(target, property, receiver) {
      if (property === "createClaim") {
        return (input: Parameters<SuiGateway["createClaim"]>[0]) => {
          const now = Date.now();
          Object.assign(input.deadlines, {
            evidenceCutoffMs: now + 30_000,
            proposalDeadlineMs: now + 35_000,
            challengeDeadlineMs: now + 45_000,
            firstCommitDeadlineMs: now + 80_000,
            firstRevealDeadlineMs: now + 100_000,
            // Leave one full 60 s deliberation budget after the first commit deadline.
            discussionDeadlineMs: now + 160_000,
            secondCommitDeadlineMs: now + 170_000,
            secondRevealDeadlineMs: now + 190_000,
          });
          return target.createClaim(input);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function registerAgents(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  signers: SignerRegistry,
  walrus: WalrusStore,
): Promise<RegisteredAgent[]> {
  const gateway = createSuiGateway({ client, manifest, signers });
  const models = manifest.gonka.models;
  const encoder = new TextEncoder();
  const registered: RegisteredAgent[] = [];

  for (let index = 0; index < agentCount; index += 1) {
    // Three source-authenticity profiles share model A; skeptic profiles split B/C.
    const sourceRole = index < 3;
    const role = sourceRole ? "SOURCE_AUTHENTICITY" : "SKEPTIC";
    const modelIndex = sourceRole ? 0 : index < 5 ? 1 : 2;
    const modelId = models[modelIndex];
    assert.ok(modelId, `release manifest is missing model ${modelIndex}`);
    const roleLabel = sourceRole
      ? "OPENVERDICT_ROLE_SOURCE_AUTHENTICITY"
      : "OPENVERDICT_ROLE_SKEPTIC";
    const humanHash = blake2b256(encoder.encode(`localnet-human-${index}`));
    const owner = signers.getAgentAt(index).address;
    const built = buildAgentManifestDocument({
      network: "localnet",
      backingKind: "TESTNET_DEMO_ALLOWLIST",
      humanBackingHash: toHex(humanHash),
      humanVerificationProvider: "localnet-demo-allowlist",
      operationalOwner: asHex(owner),
      role,
      modelId,
      promptSpec: DEFAULT_PROMPT_SPEC_V4,
      toolPolicy: DEFAULT_TOOL_POLICY_V4,
      tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
      evidencePolicyId,
    });
    assert.ok(built.tableVotePromptHash, "manifest v6 requires a table vote prompt hash");
    const tableVotePromptHash = built.tableVotePromptHash;
    const manifestUpload = await walrus.put(built.bytes, {
      identifier: `localnet-agent-${index}-manifest-v6.json`,
    });
    const result = await gateway.registerAgent({
      agentIndex: index,
      bondAmount: 1,
      manifestHash: fromHex(built.manifestHash),
      manifestBlobId: manifestUpload.blobId,
      modelHash: blake2b256(encoder.encode(modelId)),
      roleHash: blake2b256(encoder.encode(roleLabel)),
      humanBackingHash: humanHash,
    });
    assert.ok(result.agentCapId, `agent ${index} registration omitted AgentCap`);
    const profileId = result.agentProfileId;
    registered.push({
      profileId,
      owner,
      modelId,
      role,
      agentCapId: result.agentCapId,
      manifest: {
        agentProfileId: asHex(profileId),
        owner: asHex(owner),
        humanAttestationHash: toHex(humanHash),
        humanVerificationProvider: "localnet-demo-allowlist",
        version: built.document.version,
        manifestBlobId: manifestUpload.blobId,
        manifestHash: built.manifestHash,
        promptHash: built.promptHash,
        tableVotePromptHash,
        modelId,
        providerId: "gonkarouter",
        toolPolicyHash: built.toolPolicyHash,
        evidencePolicyHash: built.document.evidencePolicyHash,
        publicKey: owner,
        registeredAtMs: Date.now(),
        registeredCheckpoint: result.checkpoint ?? 0,
      },
    });
    logDetail(`agent ${index + 1}/${agentCount}: ${profileId}`);
  }
  return registered;
}

async function runLifecycle(
  context: E2eContext,
  options: {
    label: string;
    statement: string;
    phaseOne: OracleInferenceOutput["outcome"][];
    phaseTwo?: OracleInferenceOutput["outcome"][];
    expectedState: number;
    expectedResult: FinalizeReport["result"];
    onCreated?: (claimId: string, inspection: ClaimInspection) => Promise<void>;
  },
): Promise<LifecycleResult> {
  const { claimId } = await withTimeout(
    context.engine.factCheckStart({
      claim: options.statement,
      text: `Submitted evidence artifact for ${options.label}.`,
      urls: [],
    }),
    30_000,
    `${options.label} creation`,
  );
  let inspection = await context.engine.inspect(claimId);
  await options.onCreated?.(claimId, inspection);
  logDetail(`${options.label}: created ${claimId}`);

  const freeze = await withTimeout(
    context.engine.evidenceFreeze(claimId, 1),
    30_000,
    `${options.label} evidence freeze`,
  );
  logDetail(`${options.label}: phase 1 evidence ${freeze.digest}`);

  const selectedAt = Date.now();
  const selected = await withTimeout(
    context.engine.selectCommittee(claimId),
    60_000,
    `${options.label} committee selection`,
  );
  const selectedCompletedAt = Date.now();
  await context.engine.evidenceFreeze(claimId, 1);
  inspection = await context.engine.inspect(claimId);
  const profileIds = inspection.commitments.map((seat) => seat.agentProfileId);
  assert.equal(profileIds.length, 5, `${options.label} must select five jurors`);
  assert.equal(new Set(profileIds).size, 5, `${options.label} jurors must be distinct`);
  assertCommitteeDiversity(profileIds, context.agents);
  context.controller.configure(
    options.statement,
    profileIds,
    options.phaseTwo
      ? [options.phaseOne, options.phaseTwo]
      : [options.phaseOne],
  );
  logDetail(`${options.label}: committee selected ${selected.digest}`);

  await runJuryAndCommit(context, {
    label: options.label,
    claimId,
    phase: 1,
    selectedAt: Math.max(selectedAt, selectedCompletedAt),
    commitDeadlineMs: inspection.deadlines.firstCommitDeadlineMs,
  });
  await waitForOnChainDeadline(
    context.client,
    inspection.deadlines.firstCommitDeadlineMs,
    `${options.label} reveal 1`,
  );
  await context.engine.advance(claimId);
  const reveals = await context.engine.votesReveal(claimId, 1);
  assert.equal(reveals.length, 5, `${options.label} must reveal five phase-one votes`);
  logDetail(`${options.label}: phase 1 revealed 5/5 votes`);

  if (options.phaseTwo) {
    await context.engine.advance(claimId);
    const discussion = await context.engine.inspect(claimId);
    assert.equal(discussion.state, CLAIM_STATE.DISCUSSION);
    logDetail(`${options.label}: entered DISCUSSION on the fifth reveal (before the reveal deadline)`);
    await context.engine.evidenceFreeze(claimId, 2);
    const frozenDiscussion = await context.engine.inspect(claimId);
    assert.ok(
      frozenDiscussion.evidenceRoots.some((root) => root.phase === 2),
      `${options.label} must freeze phase-two evidence`,
    );
    const deliberationTurns = frozenDiscussion.deliberation ?? [];
    if (frozenDiscussion.deliberation !== undefined) {
      assert.ok(
        deliberationTurns.some((turn) => turn.status === "SPOKEN"),
        `${options.label} must record at least one spoken deliberation turn`,
      );
    }
    logDetail(`${options.label}: froze ${deliberationTurns.length} deliberation turns`);
    const secondSelectionStarted = Date.now();
    await context.engine.advance(claimId);
    const phaseTwoInspection = await context.engine.inspect(claimId);
    assert.equal(phaseTwoInspection.state, CLAIM_STATE.COMMIT_2);
    const secondProfiles = phaseTwoInspection.commitments
      .slice(-5)
      .map((seat) => seat.agentProfileId);
    assert.deepEqual(
      [...secondProfiles].sort(),
      [...profileIds].sort(),
      `${options.label} must reuse committee profiles`,
    );
    logDetail(
      `${options.label}: round two opened on the frozen transcript (before the discussion deadline)`,
    );
    await runJuryAndCommit(context, {
      label: options.label,
      claimId,
      phase: 2,
      selectedAt: secondSelectionStarted,
      commitDeadlineMs: inspection.deadlines.secondCommitDeadlineMs,
    });
    await waitForOnChainDeadline(
      context.client,
      inspection.deadlines.secondCommitDeadlineMs,
      `${options.label} reveal 2`,
    );
    await context.engine.advance(claimId);
    const secondReveals = await context.engine.votesReveal(claimId, 2);
    assert.equal(secondReveals.length, 5, `${options.label} must reveal five phase-two votes`);
    logDetail(`${options.label}: phase 2 revealed 5/5 votes`);
    await waitForOnChainDeadline(
      context.client,
      inspection.deadlines.secondRevealDeadlineMs,
      `${options.label} finalization`,
    );
  } else {
    await waitForOnChainDeadline(
      context.client,
      inspection.deadlines.firstRevealDeadlineMs,
      `${options.label} finalization`,
    );
  }

  const finalized = await context.engine.finalize(claimId);
  const finalInspection = await context.engine.inspect(claimId, { verify: true });
  assert.equal(finalInspection.state, options.expectedState);
  assert.equal(finalized.result, options.expectedResult);
  assert.equal(finalInspection.verification?.issues.length, 0);
  const truthScoreBps = recomputeTruthScore(finalInspection);
  assert.equal(finalized.truthScoreBps, truthScoreBps);
  const onChain = await assertOnChainFinalization(
    context.client,
    claimId,
    finalized,
    options.expectedState,
    truthScoreBps,
  );
  const createDigest = await claimCreateDigest(context.engine, claimId);
  logDetail(
    `${options.label}: ${options.expectedResult} state=${options.expectedState} score=${truthScoreBps} digest=${finalized.digest}`,
  );
  return {
    claimId,
    selectDigest: selected.digest,
    finalize: finalized,
    truthScoreBps,
    onChainTruthScoreBps: onChain,
    createDigest,
  };
}

async function runJuryAndCommit(
  context: E2eContext,
  input: {
    label: string;
    claimId: string;
    phase: 1 | 2;
    selectedAt: number;
    commitDeadlineMs: number;
  },
): Promise<void> {
  const report = await withTimeout(
    context.engine.juryRun(input.claimId, input.phase),
    60_000,
    `${input.label} jury phase ${input.phase}`,
  );
  assert.equal(report.runs.length, 5, `${input.label} must record five fake runs`);
  assert.ok(
    report.runs.every((run) => run.status === "SCHEMA_VALID"),
    `${input.label} fake runs must all validate`,
  );
  if (input.phase === 2) {
    const expectedPromptHash = tableVotePromptSpecHash();
    const proofs = await Promise.all(
      report.runs.map((run) => context.engine.runProof(input.claimId, run.runId)),
    );
    for (const proof of proofs) {
      assert.equal(
        proof.promptHash,
        expectedPromptHash,
        `${input.label} phase-two run must bind the table vote prompt`,
      );
    }
  }
  if (input.phase === 1) {
    await assertRunApprovalCount(context.client, context.manifest, context.agents, 5);
    logDetail(`${input.label}: phase ${input.phase} recorded 5 on-chain run approvals`);
  } else {
    // Phase two has no acceptance floor: a table-vote seat commits the moment
    // its run is approved (commit_vote consumes the RunApproval), so none is
    // outstanding and the five newest seats are already committed.
    await assertRunApprovalCount(context.client, context.manifest, context.agents, 0);
    const committed = (await context.engine.inspect(input.claimId)).commitments
      .slice(-5)
      .filter((seat) => seat.committed);
    assert.equal(committed.length, 5, `${input.label} phase-two seats must commit on approval`);
    logDetail(`${input.label}: phase 2 seats committed on approval (no approval outstanding)`);
  }

  if (input.phase === 1) {
    // jury.move acceptance_deadline: one minute after selection, capped at the commit deadline.
    const acceptanceDeadline = Math.min(
      input.commitDeadlineMs,
      input.selectedAt + COMMITTEE_ACCEPTANCE_WINDOW_MS,
    );
    await waitUntil(acceptanceDeadline + 750, `${input.label} committee lock`);
  }
  assert.ok(
    Date.now() < input.commitDeadlineMs - 1_000,
    `${input.label} does not have enough commit-window time remaining`,
  );
  const commits = await context.engine.votesCommit(input.claimId, input.phase);
  assert.equal(commits.length, 5, `${input.label} must commit five votes`);
  logDetail(`${input.label}: phase ${input.phase} committed 5/5 votes`);
}

/**
 * One real staked seat: the user posts the 0.1 SUI bond and the operator pays
 * the gas, then the user unstakes. The seat is deactivated again here so the
 * lifecycles keep drawing from the seven demo profiles.
 */
async function runStakedSeatProof(input: {
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  operator: Ed25519Keypair;
  user: Ed25519Keypair;
  signers: SignerRegistry;
  walrus: WalrusStore;
}): Promise<StakedSeatProof> {
  const encoder = new TextEncoder();
  const staker = input.user.toSuiAddress();
  const operationalOwner = input.signers.getAgentAt(stakedSeatSlot).address;
  const modelId = required(input.manifest.gonka.models[0], "release manifest model 0");
  const stakerHash = blake2b256(encoder.encode(`localnet-staker-${staker}`));
  const built = buildAgentManifestDocument({
    network: "localnet",
    backingKind: "WALLET_STAKED",
    humanBackingHash: toHex(stakerHash),
    humanVerificationProvider: "sui-wallet-stake",
    operationalOwner: asHex(operationalOwner),
    role: "SKEPTIC",
    modelId,
    promptSpec: DEFAULT_PROMPT_SPEC_V4,
    toolPolicy: DEFAULT_TOOL_POLICY_V4,
    tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
    evidencePolicyId,
  });
  const upload = await input.walrus.put(built.bytes, {
    identifier: "localnet-staked-seat-manifest-v6.json",
  });

  const staking = await sponsorAndExecute({
    client: input.client,
    tx: buildRegisterStakedAgentTransaction(input.manifest, {
      stakeMist: minStakeMist,
      manifestHash: fromHex(built.manifestHash),
      manifestBlobId: upload.blobId,
      modelHash: blake2b256(encoder.encode(modelId)),
      roleHash: blake2b256(encoder.encode("OPENVERDICT_ROLE_SKEPTIC")),
      stakerHash,
      operationalOwner,
    }),
    senderKeypair: input.user,
    sponsorKeypair: input.operator,
    gasBudget: 100_000_000,
  });
  const settled = await input.client.core.waitForTransaction({
    digest: staking.digest,
    timeout: 60_000,
    include: { transaction: true, effects: true, objectTypes: true },
  });
  if (settled.$kind !== "Transaction") throw new Error("staked registration failed");
  assert.equal(settled.Transaction.transaction.sender, staker);
  assert.equal(settled.Transaction.transaction.gasData.owner, input.operator.toSuiAddress());
  const profileId = createdObjectByType(
    settled.Transaction.effects.changedObjects,
    settled.Transaction.objectTypes,
    `${input.manifest.packageId}::agent_registry::AgentProfile`,
  );
  const positionId = createdObjectByType(
    settled.Transaction.effects.changedObjects,
    settled.Transaction.objectTypes,
    `${input.manifest.packageId}::agent_registry::StakePosition`,
  );

  const owned = await input.client.core.listOwnedObjects({
    owner: staker,
    type: `${input.manifest.packageId}::agent_registry::StakePosition`,
    limit: 10,
  });
  assert.deepEqual(
    owned.objects.map((object) => object.objectId),
    [positionId],
    "the staker must own exactly one stake position",
  );

  const staked = await readEligibilityRecord(input.client, input.manifest, agentCount);
  assert.equal(staked.active, true, "the staked seat must start active");
  assert.equal(staked.owner, operationalOwner, "slot seven must own the staked record");
  assert.equal(staked.profileId, profileId);

  // Jury rewards for the seat must route to the staker, not to the slot.
  const payout = await input.client.core.getDynamicField({
    parentId: input.manifest.registryObjectId,
    name: {
      type: `${input.manifest.packageId}::agent_registry::PayoutRecipientKey`,
      bcs: bcs.Address.serialize(profileId).toBytes(),
    },
  });
  assert.equal(bcs.Address.parse(payout.dynamicField.value.bcs), staker);
  logDetail(`staked seat: ${profileId} staked ${minStakeMist} MIST, payout to ${staker}`);

  const unstaking = await sponsorAndExecute({
    client: input.client,
    tx: buildSponsoredUnstakeRequest(input.manifest, profileId, positionId),
    senderKeypair: input.user,
    sponsorKeypair: input.operator,
    gasBudget: 100_000_000,
  });
  await input.client.core.waitForTransaction({
    digest: unstaking.digest,
    timeout: 60_000,
    include: { effects: true },
  });
  const retired = await readEligibilityRecord(input.client, input.manifest, agentCount);
  assert.equal(retired.active, false, "unstaking must deactivate the registry record");
  const fields = await input.client.core.listDynamicFields({ parentId: profileId });
  assert.ok(
    fields.dynamicFields.some((field) =>
      field.name.type.endsWith("::agent_registry::UnstakeKey"),
    ),
    "the profile must carry the maturing unstake request",
  );
  logDetail("staked seat: unstake requested, the bond returns after the 24 h delay");
  return {
    profileId,
    positionId,
    operationalOwner,
    staker,
    stakeDigest: staking.digest,
    unstakeDigest: unstaking.digest,
  };
}

/** Read one bounded eligibility record straight from the registry object. */
async function readEligibilityRecord(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  index: number,
): Promise<{ profileId: string; owner: string; active: boolean }> {
  const { object } = await client.core.getObject({
    objectId: manifest.registryObjectId,
    include: { json: true },
  });
  const records = (object.json as Record<string, unknown> | undefined)?.eligible_agents;
  assert.ok(Array.isArray(records), "registry json is missing eligible_agents");
  assert.equal(records.length, agentCount + 1, "the staked seat must be the eighth record");
  const raw = records[index] as unknown;
  assert.ok(isRecord(raw), "eligibility record is not a Move struct");
  // Transports differ: some wrap struct fields, some inline them.
  const fields = isRecord(raw.fields) ? raw.fields : raw;
  return {
    profileId: required(moveObjectId(fields.agent_profile_id), "record.agent_profile_id"),
    owner: required(moveObjectId(fields.owner), "record.owner"),
    active: fields.active === true,
  };
}

function buildSponsoredUnstakeRequest(
  manifest: ReleaseManifest,
  profileId: string,
  positionId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${manifest.packageId}::agent_registry::request_unstake`,
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(profileId),
      tx.object(positionId),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

async function createAndEnterPool(input: {
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  operator: Ed25519Keypair;
  user: Ed25519Keypair;
  claimId: string;
  challengeDeadlineMs: number;
}): Promise<Omit<PoolProof, "settleDigest" | "redeemDigest" | "payout" | "fee">> {
  const closeAtMs = Math.min(input.challengeDeadlineMs - 500, Date.now() + 5_000);
  assert.ok(closeAtMs > Date.now() + 1_000, "demo pool has no usable entry window");
  const created = await executeAndWait(
    input.client,
    input.operator,
    buildCreateDemoPoolTransaction(input.manifest, {
      claimId: input.claimId,
      acceptedPackageVersion: 1,
      closeAtMs,
    }),
  );
  const poolEvent = created.moveEvents.find((event) =>
    event.eventType.endsWith("::PoolCreated"),
  );
  const poolId = required(
    moveObjectId(poolEvent?.json?.pool_id),
    "PoolCreated.pool_id",
  );

  const deposit = await sponsorAndExecute({
    client: input.client,
    tx: buildSponsoredPoolEntry(input.manifest, poolId, poolStake),
    senderKeypair: input.user,
    sponsorKeypair: input.operator,
    gasBudget: 100_000_000,
  });
  const settledDeposit = await input.client.core.waitForTransaction({
    digest: deposit.digest,
    timeout: 60_000,
    include: { transaction: true, effects: true, objectTypes: true },
  });
  assert.equal(settledDeposit.$kind, "Transaction");
  if (settledDeposit.$kind !== "Transaction") throw new Error("sponsored deposit failed");
  assert.equal(settledDeposit.Transaction.transaction.sender, input.user.toSuiAddress());
  assert.equal(
    settledDeposit.Transaction.transaction.gasData.owner,
    input.operator.toSuiAddress(),
  );
  const positionId = createdObjectByType(
    settledDeposit.Transaction.effects.changedObjects,
    settledDeposit.Transaction.objectTypes,
    `${input.manifest.packageId}::demo_binary_pool::Position`,
  );
  const pool = await input.client.core.getObject({
    objectId: poolId,
    include: { json: true },
  });
  assert.equal(moveNumber(pool.object.json?.yes_stake), Number(poolStake));
  assert.equal(moveNumber(pool.object.json?.no_stake), 0);
  logDetail(`claim #1 pool: sponsored deposit ${deposit.digest}`);
  return {
    poolId,
    positionId,
    createDigest: created.digest,
    sponsoredDigest: deposit.digest,
  };
}

async function settleAndRedeemPool(input: {
  client: OpenVerdictSuiClient;
  manifest: ReleaseManifest;
  operator: Ed25519Keypair;
  user: Ed25519Keypair;
  certificateId: string;
  setup: Omit<PoolProof, "settleDigest" | "redeemDigest" | "payout" | "fee">;
}): Promise<PoolProof> {
  const settled = await executeAndWait(
    input.client,
    input.operator,
    buildSettleDemoPoolTransaction(input.manifest, {
      poolId: input.setup.poolId,
      certificateId: input.certificateId,
    }),
  );
  const redeemed = await executeAndWait(
    input.client,
    input.user,
    buildRedeemDemoPoolTransaction(input.manifest, {
      poolId: input.setup.poolId,
      positionId: input.setup.positionId,
    }),
  );
  const redemptionEvent = redeemed.moveEvents.find((event) =>
    event.eventType.endsWith("::PositionRedeemed"),
  );
  const payout = moveBigInt(redemptionEvent?.json?.amount);
  const fee = 0n;
  const pool = await input.client.core.getObject({
    objectId: input.setup.poolId,
    include: { json: true },
  });
  const remaining =
    moveBigInt(pool.object.json?.yes_pool) +
    moveBigInt(pool.object.json?.no_pool) +
    moveBigInt(pool.object.json?.payout_vault);
  assert.equal(poolStake, payout + fee + remaining, "pool value must be conserved");
  assert.equal(remaining, 0n, "winning redemption must empty the single-sided pool");
  logDetail(`demo pool: deposit=${poolStake} payout=${payout} fee=${fee} remaining=${remaining}`);
  return {
    ...input.setup,
    settleDigest: settled.digest,
    redeemDigest: redeemed.digest,
    payout,
    fee,
  };
}

function buildSponsoredPoolEntry(
  manifest: ReleaseManifest,
  poolId: string,
  stake: bigint,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${manifest.packageId}::demo_binary_pool::enter`,
    typeArguments: [manifest.coinType],
    arguments: [
      tx.object(manifest.registryObjectId),
      tx.object(poolId),
      // A sponsored SUI transfer must not split the sponsor-owned gas coin.
      tx.coin({ type: manifest.coinType, balance: stake, useGasCoin: false }),
      tx.pure.u8(OUTCOME.YES),
      tx.object(manifest.clockObjectId),
    ],
  });
  return tx;
}

/** V4 fake research needs both sides and two independent citation sites. */
function createLocalnetResearchProvider(): ResearchProvider {
  const pages = new Map([
    [
      "https://support-evidence.test/localnet-record",
      {
        title: "Localnet support record",
        text: "The localnet support record confirms the claim for deterministic end-to-end testing.",
      },
    ],
    [
      "https://challenge-evidence.test/localnet-record",
      {
        title: "Localnet challenge record",
        text: "The localnet challenge record supplies contrary evidence for deterministic end-to-end testing.",
      },
    ],
  ]);
  return {
    name: "fake",
    mode: "fake",
    async probe() {
      return { ok: true, latencyMs: 0, status: "200" };
    },
    async search(query) {
      const challenge = query.startsWith("challenge:");
      const url = challenge
        ? "https://challenge-evidence.test/localnet-record"
        : "https://support-evidence.test/localnet-record";
      const page = required(pages.get(url), `localnet research page ${url}`);
      return [{ rank: 1, url, title: page.title, snippet: page.text }];
    },
    async open(url) {
      const page = required(pages.get(url), `localnet research page ${url}`);
      return {
        url,
        finalUrl: url,
        title: page.title,
        markdown: page.text,
        fetchedAtMs: 0,
        statusCode: 200,
      };
    },
  };
}

type CompletionRequest = Parameters<GonkaRouterAdapter["complete"]>[0];

function buildLocalnetResearchContent(
  request: CompletionRequest,
  vote: VoteInstruction,
): string {
  const turn = request.messages.filter((message) => message.role === "assistant").length;
  if (turn === 0) {
    return JSON.stringify({
      action: "search",
      query: `support: ${request.input.claim.statement}`,
      intent: "support",
    });
  }
  if (turn === 1) {
    return JSON.stringify({ action: "open", url: lastSearchUrl(request), from: 0 });
  }
  if (turn === 2) {
    return JSON.stringify({
      action: "search",
      query: `challenge: ${request.input.claim.statement}`,
      intent: "challenge",
    });
  }
  if (turn === 3) {
    return JSON.stringify({ action: "open", url: lastSearchUrl(request), from: 0 });
  }

  const opened = request.messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const payload = parseJsonRecord(message.content);
    if (
      payload?.tool !== "open" ||
      typeof payload.evidenceId !== "string" ||
      typeof payload.url !== "string" ||
      typeof payload.text !== "string"
    ) {
      return [];
    }
    return [{
      evidenceId: payload.evidenceId,
      url: payload.url,
      quote: payload.text.replace(/\s+/g, " ").trim(),
    }];
  });
  assert.equal(opened.length, 2, "v4 fake research must open support and challenge pages");
  const support = required(opened[0], "support research page");
  const challenge = required(opened[1], "challenge research page");
  const decisiveEvidence = vote.outcome === "YES"
    ? [support.evidenceId]
    : vote.outcome === "NO"
      ? [challenge.evidenceId]
      : [support.evidenceId, challenge.evidenceId];
  const assessment = vote.outcome === "YES"
    ? "SUPPORTS"
    : vote.outcome === "NO"
      ? "CONTRADICTS"
      : "MIXED";
  return JSON.stringify({
    action: "answer",
    output: {
      outcome: vote.outcome,
      confidenceBps: vote.confidenceBps,
      evidenceFor: [support.evidenceId],
      evidenceAgainst: [challenge.evidenceId],
      unsupportedClaims: [],
      decisiveEvidence,
      reasoning: `The deterministic two-sided record supports a ${vote.outcome} vote.`,
      publicReasoningTrace: [{
        check: "Compare the support and challenge records.",
        evidenceIds: [support.evidenceId, challenge.evidenceId],
        assessment,
        finding: `The scripted localnet verdict is ${vote.outcome}.`,
      }],
      citations: [support, challenge],
      counterEvidenceSummary:
        "The contrary record was considered and weighed against the scripted verdict.",
    },
  });
}

function lastSearchUrl(request: CompletionRequest): string {
  const content = request.messages.findLast((message) => message.role === "user")?.content;
  const payload = content === undefined ? undefined : parseJsonRecord(content);
  const result = Array.isArray(payload?.results) ? payload.results[0] : undefined;
  if (!isRecord(result) || typeof result.url !== "string") {
    throw new Error("v4 fake research requires a prior search result URL");
  }
  return result.url;
}

function rewriteFakeCompletion(
  completion: Extract<GonkaCompletionResult, { ok: true }>,
  content: string,
): void {
  const response = completionResponseWithContent(completion.response, content);
  const outputValue: unknown = JSON.parse(content);
  completion.content = content;
  completion.response = response;
  completion.attempt.response = response;
  completion.attempt.audit.outputHash = hashCanonicalJson(outputValue);
}

function completionResponseWithContent(response: unknown, content: string): unknown {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new Error("fake completion response omitted choices");
  }
  const [firstChoice, ...remainingChoices] = response.choices;
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("fake completion response omitted its first message");
  }
  return {
    ...response,
    choices: [
      { ...firstChoice, message: { ...firstChoice.message, content } },
      ...remainingChoices,
    ],
  };
}

function parseJsonRecord(content: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFakeController(): FakeController {
  const plans = new Map<string, Map<string, VoteInstruction[]>>();
  const cursors = new Map<string, number>();
  const utilityId = asHex(`0x${"00".repeat(32)}`);
  const utility = createFakeGonkaAdapter([{ agentProfileId: utilityId }]);
  const completionAdapters = new WeakMap<object, GonkaRouterAdapter>();
  const adapterFor = (
    input: Pick<OracleInferenceInput, "runId"> & {
      claim: Pick<OracleInferenceInput["claim"], "statement" | "resolutionCriteria">;
    },
    manifest: AgentManifest,
    consumeFixture = true,
  ): GonkaRouterAdapter => {
    const queue = plans.get(input.claim.statement)?.get(manifest.agentProfileId);
    if (!queue) {
      throw new Error(`no lifecycle fixture for ${manifest.agentProfileId}`);
    }
    const key = `${input.claim.statement}:${manifest.agentProfileId}`;
    const cursor = cursors.get(key) ?? 0;
    const fixtureIndex = consumeFixture ? cursor : cursor - 1;
    const vote = queue[fixtureIndex];
    if (!vote) {
      const reason = consumeFixture ? "fixture queue exhausted" : "no consumed fixture";
      throw new Error(`${reason} for ${manifest.agentProfileId}`);
    }
    if (consumeFixture) cursors.set(key, cursor + 1);
    return createFakeGonkaAdapter([
      {
        agentProfileId: manifest.agentProfileId,
        outcome: vote.outcome,
        confidenceBps: vote.confidenceBps,
        gonkaRequestId: `msg_e2e_${toHex(blake2b256(new TextEncoder().encode(key))).slice(2, 18)}_${fixtureIndex + 1}`,
        actions: [],
      },
    ]);
  };

  const latestVoteFor = (
    input: Pick<OracleInferenceInput, "runId"> & {
      claim: Pick<OracleInferenceInput["claim"], "statement" | "resolutionCriteria">;
    },
    manifest: AgentManifest,
  ): VoteInstruction => {
    const queue = plans.get(input.claim.statement)?.get(manifest.agentProfileId);
    const key = `${input.claim.statement}:${manifest.agentProfileId}`;
    const cursor = cursors.get(key) ?? 0;
    const vote = queue?.[cursor - 1];
    if (!vote) throw new Error(`no consumed fixture for ${manifest.agentProfileId}`);
    return vote;
  };

  return {
    configure(statement, profileIds, rounds) {
      assert.ok(rounds.every((round) => round.length === profileIds.length));
      const byProfile = new Map<string, VoteInstruction[]>();
      for (const [index, profileId] of profileIds.entries()) {
        byProfile.set(
          profileId,
          rounds.map((round, roundIndex) => ({
            outcome: required(round[index], "fixture outcome"),
            confidenceBps: 7_800 + index * 250 + roundIndex * 100,
          })),
        );
      }
      plans.set(statement, byProfile);
    },
    adapter: {
      promptSpec: utility.promptSpec,
      promptSpecHash: utility.promptSpecHash,
      toolPolicy: utility.toolPolicy,
      toolPolicyHash: utility.toolPolicyHash,
      legacyPromptSpec: utility.legacyPromptSpec,
      async run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown> {
        return adapterFor(input, manifest).run(input, manifest);
      },
      async complete(request) {
        const systemPrompt = request.messages[0]?.content;
        const requestKind = systemPrompt === TABLE_VOTE_PROMPT_SPEC_V1.systemPrompt
          ? "TABLE_VOTE"
          : systemPrompt === DELIBERATION_PROMPT_SPEC_V1.systemPrompt ||
              systemPrompt === DELIBERATION_PROMPT_SPEC_V2.systemPrompt ||
              systemPrompt === DELIBERATION_PROMPT_SPEC_V3.systemPrompt
            ? "DELIBERATION"
            : "RESEARCH";
        let adapter = completionAdapters.get(request.attempts);
        if (!adapter) {
          // Debate turns reuse the revealed round-one vote without consuming round two.
          adapter = adapterFor(
            request.input,
            request.manifest,
            requestKind !== "DELIBERATION",
          );
          completionAdapters.set(request.attempts, adapter);
        }
        const completion = await adapter.complete(request);
        if (requestKind === "RESEARCH" && completion.ok) {
          rewriteFakeCompletion(
            completion,
            buildLocalnetResearchContent(
              request,
              latestVoteFor(request.input, request.manifest),
            ),
          );
        }
        return completion;
      },
      probeModels: utility.probeModels,
      normalizeResponse: utility.normalizeResponse,
      validateOutput: utility.validateOutput,
      buildRunAudit: utility.buildRunAudit,
    },
  };
}

function assertCommitteeDiversity(
  profileIds: string[],
  agents: RegisteredAgent[],
): void {
  const byProfile = new Map(agents.map((agent) => [agent.profileId, agent]));
  const selected = profileIds.map((id) => required(byProfile.get(id), `registered agent ${id}`));
  assert.equal(new Set(selected.map((agent) => agent.owner)).size, 5);
  assert.equal(new Set(selected.map((agent) => agent.manifest.humanAttestationHash)).size, 5);
  assert.ok(new Set(selected.map((agent) => agent.modelId)).size >= 3);
  for (const model of new Set(selected.map((agent) => agent.modelId))) {
    assert.ok(selected.filter((agent) => agent.modelId === model).length <= 2);
  }
}

async function assertRunApprovalCount(
  client: OpenVerdictSuiClient,
  manifest: ReleaseManifest,
  agents: RegisteredAgent[],
  expected: number,
): Promise<void> {
  const type = `${manifest.packageId}::jury::RunApproval`;
  const counts = await Promise.all(
    agents.map(async (agent) => {
      const page = await client.core.listOwnedObjects({
        owner: agent.owner,
        type,
        limit: 50,
      });
      return page.objects.length;
    }),
  );
  assert.equal(counts.reduce((sum, count) => sum + count, 0), expected);
}

function recomputeTruthScore(inspection: ClaimInspection): number {
  const revealed = inspection.commitments
    .filter(
      (vote): vote is typeof vote & { outcome: 1 | 2 | 3; confidenceBps: number } =>
        vote.revealed && vote.outcome !== undefined && vote.confidenceBps !== undefined,
    )
    .slice(-5)
    .map((vote) => ({ outcome: vote.outcome, confidenceBps: vote.confidenceBps }));
  const score = computeTruthScoreBps(revealed);
  assert.notEqual(score, null, "final round must have valid revealed votes");
  return required(score, "truth score");
}

async function assertOnChainFinalization(
  client: OpenVerdictSuiClient,
  claimId: string,
  finalized: FinalizeReport,
  expectedState: number,
  truthScoreBps: number,
): Promise<number> {
  const certificate = await client.core.getObject({
    objectId: finalized.certificateId,
    include: { json: true },
  });
  const onChainScore = moveNumber(
    certificate.object.json?.truth_score_bps ?? certificate.object.json?.truthScoreBps,
  );
  assert.equal(onChainScore, truthScoreBps, "on-chain certificate Truth Score must match TS");
  const claim = await client.core.getObject({
    objectId: claimId,
    include: { json: true },
  });
  assert.equal(moveNumber(claim.object.json?.state), expectedState);
  return onChainScore;
}

async function claimCreateDigest(engine: Engine, claimId: string): Promise<string> {
  for await (const event of engine.events(claimId)) {
    if (event.kind === "claim_created" && event.transactionDigest) {
      return event.transactionDigest;
    }
  }
  throw new Error(`claim ${claimId} has no claim_created transaction digest`);
}

async function runCliInspection(
  claimId: string,
  additions: Record<string, string>,
): Promise<ClaimInspection> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...additions };
  delete env.DATABASE_URL;
  const result = await runChild(
    process.execPath,
    ["cli/bin.mjs", "claim", "inspect", "--claim", claimId, "--json"],
    { cwd: repositoryRoot, env, timeoutMs: 60_000 },
  );
  if (result.code !== 0) {
    throw new Error(`CLI inspect failed with exit ${result.code}: ${result.stderr.trim()}`);
  }
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error("CLI inspect produced no JSON output");
  return JSON.parse(line) as ClaimInspection;
}

async function startLocalnet(): Promise<RunningLocalnet> {
  await mkdir(localnetDir, { recursive: true });
  const configExists = await pathExists(localnetSuiConfigDir);
  if (configExists && (await localnetReady())) {
    const log = await open(join(localnetDir, "sui.log"), "a");
    logDetail("localnet path: reused (JSON-RPC, Clock 0x6, and faucet are ready)");
    return { log, path: "reused" };
  }
  if (!configExists && (await localnetReady())) {
    logDetail("localnet cleanup: rejected a ready orphan because sui-config was cleared");
  }

  await terminateStraySuiProcesses();
  await waitForLocalnetPortsFree(10_000);
  const log = await open(join(localnetDir, "sui.log"), "w");
  const child = spawn(
    "sui",
    ["start", "--with-faucet", "--force-regenesis"],
    {
      cwd: repositoryRoot,
      detached: true,
      env: {
        ...process.env,
        SUI_CONFIG_DIR: localnetSuiConfigDir,
      },
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  await new Promise<void>((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  logDetail(`localnet path: spawned fresh sui start process (pid ${child.pid ?? "unknown"})`);
  return { child, log, path: "spawned" };
}

async function waitForLocalnet(
  running: RunningLocalnet,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (running.child?.exitCode !== null && running.child?.exitCode !== undefined) {
      throw new Error(`sui localnet exited early with code ${running.child.exitCode}`);
    }
    try {
      if (await localnetReady()) {
        logDetail(
          `localnet readiness: ${running.path} path passed JSON-RPC, Clock 0x6, and faucet probes`,
        );
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Sui RPC was not ready within ${timeoutMs}ms`, { cause: lastError });
}

async function localnetReady(): Promise<boolean> {
  if (!(await jsonRpcReady())) return false;
  try {
    await createLocalnetRpcClient().core.getObject({ objectId: "0x6" });
    return faucetReady();
  } catch {
    return false;
  }
}

async function faucetReady(): Promise<boolean> {
  try {
    const response = await fetch(new URL("/", localnetFaucetUrl), {
      signal: AbortSignal.timeout(1_500),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

async function terminateStraySuiProcesses(): Promise<void> {
  const initial = await listSuiProcessIds();
  if (initial.length === 0) {
    logDetail("localnet cleanup: no stray sui start/sui-node processes found");
    return;
  }

  signalProcesses(initial, "SIGTERM");
  await delay(750);
  const survivors = await listSuiProcessIds();
  if (survivors.length > 0) {
    signalProcesses(survivors, "SIGKILL");
    await delay(500);
  }
  const remaining = await listSuiProcessIds();
  if (remaining.length > 0) {
    throw new Error(`could not stop stray Sui processes: ${remaining.join(", ")}`);
  }
  logDetail(`localnet cleanup: stopped ${initial.length} stray Sui process(es)`);
}

async function listSuiProcessIds(): Promise<number[]> {
  const queries: string[][] = [
    ["-t", "-c", "sui-node"],
    ["-t", "-c", "sui-faucet"],
  ];
  const logPath = join(localnetDir, "sui.log");
  if (await pathExists(logPath)) {
    // The detached `sui start` parent and its children inherit this log handle.
    queries.push(["-t", "-a", "-c", "sui", logPath]);
  }

  const pids = new Set<number>();
  for (const args of queries) {
    const result = await runChild("lsof", args, {
      cwd: repositoryRoot,
      env: process.env,
      timeoutMs: 5_000,
    });
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`could not inspect Sui processes: ${result.stderr.trim()}`);
    }
    for (const line of result.stdout.split("\n")) {
      const pid = Number(line.trim());
      if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
    }
  }
  return [...pids];
}

function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function waitForLocalnetPortsFree(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let occupied: number[] = [];
  while (Date.now() < deadline) {
    occupied = [];
    for (const port of localnetPorts) {
      if (await tcpPortOpen(port)) occupied.push(port);
    }
    if (occupied.length === 0) return;
    await delay(250);
  }
  throw new Error(`localnet ports are still occupied: ${occupied.join(", ")}`);
}

function tcpPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (openPort: boolean): void => {
      socket.destroy();
      resolvePromise(openPort);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function stopLocalnet(running: RunningLocalnet): Promise<void> {
  if (!running.child) {
    await running.log.close();
    return;
  }
  const child = running.child;
  const pid = child.pid;
  if (pid && child.exitCode === null) {
    child.kill("SIGTERM");
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Direct-child signaling above is still sufficient on single-process localnet.
    }
    await Promise.race([onceExit(child), delay(5_000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Direct SIGKILL above is the final fallback.
      }
      await Promise.race([onceExit(child), delay(2_000)]);
    }
  }
  await running.log.close();
}

async function jsonRpcReady(): Promise<boolean> {
  try {
    const response = await fetch(localnetRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getChainIdentifier",
        params: [],
      }),
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const value = (await response.json()) as { result?: unknown };
    return typeof value.result === "string" && value.result.length > 0;
  } catch {
    return false;
  }
}

function onceExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once("exit", () => resolvePromise()));
}

async function step<T>(
  name: string,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  activeStep = name;
  const startedAt = Date.now();
  process.stdout.write(`\n[${name}]\n`);
  try {
    const value = await withTimeout(operation(), timeoutMs, name);
    process.stdout.write(`PASS ${name} (${formatDuration(Date.now() - startedAt)})\n`);
    return value;
  } catch (error) {
    throw new Error(`${name} failed: ${errorMessage(error)}`, { cause: error });
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitUntil(timestampMs: number, label: string): Promise<void> {
  const remaining = timestampMs - Date.now();
  if (remaining > 0) {
    logDetail(`${label}: waiting ${formatDuration(remaining)} for the on-chain deadline`);
    await delay(remaining);
  }
}

export async function waitForOnChainDeadline(
  client: OpenVerdictSuiClient,
  timestampMs: number,
  label: string,
): Promise<void> {
  const localRemaining = timestampMs - Date.now();
  if (localRemaining > 0) {
    logDetail(`${label}: waiting ${formatDuration(localRemaining)} for the on-chain deadline`);
    await delay(localRemaining);
  }

  const timeoutAt = Date.now() + 15_000;
  while (Date.now() < timeoutAt) {
    const { object } = await client.core.getObject({
      objectId: "0x6",
      include: { json: true },
    });
    const clockTimestamp = moveNumber(
      object.json?.timestamp_ms ?? object.json?.timestampMs,
    );
    if (clockTimestamp > timestampMs) return;
    await delay(250);
  }
  throw new Error(`${label} did not reach ${timestampMs} on the Sui Clock`);
}

function createdObjectByType(
  changed: Array<{ objectId: string; idOperation: string }>,
  types: Record<string, string>,
  prefix: string,
): string {
  const object = changed.find(
    (item) => item.idOperation === "Created" && types[item.objectId]?.startsWith(prefix),
  );
  if (!object) throw new Error(`transaction did not create ${prefix}`);
  return object.objectId;
}

function moveNumber(value: unknown): number {
  const numeric = moveBigInt(value);
  const result = Number(numeric);
  if (!Number.isSafeInteger(result)) throw new Error(`Move value is not a safe number: ${numeric}`);
  return result;
}

function moveObjectId(value: unknown): string | undefined {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return value;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "bytes", "value"]) {
    const id = moveObjectId(record[key]);
    if (id) return id;
  }
  return undefined;
}

function moveBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (Array.isArray(value) && value.length === 1) return moveBigInt(value[0]);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "vec", "Some", "some"]) {
      if (record[key] !== undefined) return moveBigInt(record[key]);
    }
  }
  throw new Error(`could not decode Move integer from ${JSON.stringify(value)}`);
}

function asHex(value: string): HexString {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`invalid 0x-hex value: ${value}`);
  return value as HexString;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`);
  return value;
}

function logDetail(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

function printSummary(input: {
  direct: LifecycleResult;
  split: LifecycleResult;
  unresolved: LifecycleResult;
  pool: PoolProof;
  staked: StakedSeatProof;
  timings: StepTimings;
}): void {
  process.stdout.write("\n[8. operational proof summary]\n");
  const rows: Array<readonly [string, string]> = [
    ["Claims created", "3"],
    ["Claim #1", `${input.direct.claimId} (FINALIZED_REVIEWED/YES)`],
    ["Claim #2", `${input.split.claimId} (DISCUSSION -> FINALIZED_REVIEWED/YES)`],
    ["Claim #3", `${input.unresolved.claimId} (DISCUSSION -> UNRESOLVED)`],
    ["Claim create digests", [input.direct.createDigest, input.split.createDigest, input.unresolved.createDigest].join(", ")],
    ["Finalization digests", [input.direct.finalize.digest, input.split.finalize.digest, input.unresolved.finalize.digest].join(", ")],
    ["Truth Score #1", `${input.direct.truthScoreBps} bps (on-chain ${input.direct.onChainTruthScoreBps})`],
    ["Sponsored tx", input.pool.sponsoredDigest],
    ["Staked seat", `${input.staked.profileId} (${minStakeMist} MIST by ${input.staked.staker})`],
    ["Stake tx digests", `${input.staked.stakeDigest}, ${input.staked.unstakeDigest}`],
    ["Pool tx digests", `${input.pool.createDigest}, ${input.pool.settleDigest}, ${input.pool.redeemDigest}`],
    ["Pool conservation", `${poolStake} = ${input.pool.payout} payout + ${input.pool.fee} fees`],
    ["Localnet startup", formatDuration(input.timings.localnetStartupMs)],
    ["Deployment", formatDuration(input.timings.deploymentMs)],
    ["Full E2E", formatDuration(input.timings.totalMs)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    process.stdout.write(`| ${label.padEnd(width)} | ${value} |\n`);
  }
  process.stdout.write("PASS 8. operational proof summary\n");
}

async function runChild(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

// Entry guard: the canary imports helpers from this module without running it.
if (process.argv[1]?.endsWith("localnet-e2e.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`E2E_LOCALNET_FAILED [${activeStep}]: ${errorMessage(error)}\n`);
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack.slice(0, 8_000)}\n`);
    }
    process.stderr.write(`See ${join(localnetDir, "sui.log")} for localnet logs.\n`);
    process.exitCode = 1;
  });
}

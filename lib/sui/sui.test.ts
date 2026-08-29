import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import {
  FakeSuiGateway,
  SignerRegistry,
  buildAcceptJurySeatTransaction,
  buildAdvancePhaseTransaction,
  buildApproveRunTransaction,
  buildChallengeOutcomeTransaction,
  buildCommitVoteTransaction,
  buildCreateClaimTransaction,
  buildCreateDemoPoolTransaction,
  buildEnterDemoPoolTransaction,
  buildFinalizeClaimTransaction,
  buildFreezeEvidenceTransaction,
  buildProposeOutcomeTransaction,
  buildRedeemDemoPoolTransaction,
  buildRegisterAgentTransaction,
  buildRevealVoteTransaction,
  buildSelectCommitteeTransaction,
  buildSettleDemoPoolTransaction,
  buildStartDirectReviewTransaction,
  buildUpdateAgentManifestTransaction,
  buildWithdrawPayoutTransaction,
  createFallbackClient,
  createSuiClients,
  loadReleaseManifest,
  parseReleaseManifest,
  type ReleaseManifest,
} from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

const manifest: ReleaseManifest = {
  network: "localnet",
  suiRpcUrl: "http://127.0.0.1:9000",
  suiFaucetUrl: "http://127.0.0.1:9123/v2/gas",
  packageId: `0x${"11".repeat(32)}`,
  registryObjectId: `0x${"22".repeat(32)}`,
  demoPoolObjectId: "",
  clockObjectId: "0x6",
  randomObjectId: "0x8",
  coinType: "0x2::sui::SUI",
  walrus: { mode: "local", localDir: ".localnet/walrus-local" },
  gonka: {
    mode: "fake",
    baseUrl: "https://api.gonkarouter.io/v1",
    models: ["model-a", "model-b", "model-c"],
  },
  committee: {
    size: 5,
    threshold: 4,
    maxSeatsPerModel: 2,
    minDistinctModels: 3,
  },
  explorerTxTemplate: "",
};

describe("release manifest", () => {
  it("loads a validated manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openverdict-manifest-"));
    const path = join(directory, "release.json");
    await writeFile(path, JSON.stringify(manifest));

    await expect(loadReleaseManifest(path)).resolves.toEqual(manifest);
  });

  it("rejects system-object drift and malformed networks", () => {
    expect(() =>
      parseReleaseManifest({ ...manifest, clockObjectId: "0x7" }),
    ).toThrow(/clock/i);
    expect(() =>
      parseReleaseManifest({ ...manifest, network: "devnet" }),
    ).toThrow();
    expect(() =>
      parseReleaseManifest({
        ...manifest,
        network: "testnet",
        walrus: { mode: "local", localDir: ".walrus" },
      }),
    ).toThrow(/Walrus mode/i);
    expect(() =>
      parseReleaseManifest({
        ...manifest,
        gonka: { ...manifest.gonka, models: ["only-one-model"] },
      }),
    ).toThrow(/minDistinctModels/);
  });
});

describe("Sui client transport", () => {
  it("uses JSON-RPC for localnet", () => {
    expect(createSuiClients(manifest)).toBeInstanceOf(SuiJsonRpcClient);
  });

  it.each(["testnet", "mainnet"] as const)("keeps %s on gRPC", (network) => {
    expect(
      createSuiClients({
        ...manifest,
        network,
        suiRpcUrl: `https://fullnode.${network}.sui.io`,
        walrus: { mode: network },
      }),
    ).toBeInstanceOf(SuiGrpcClient);
  });

  it("uses the manifest JSON-RPC fallback URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { info: { version: "1.52.2" } },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fallbackUrl = "https://fallback.testnet.example";
    const client = createFallbackClient({
      network: "testnet",
      suiRpcUrl: "https://grpc.testnet.example",
      suiRpcFallbackUrl: fallbackUrl,
    });

    await expect(client.getRpcApiVersion()).resolves.toBe("1.52.2");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fallbackUrl);
  });
});

describe("transaction builders", () => {
  it("targets direct review with registry, claim, and immutable clock", () => {
    const tx = buildStartDirectReviewTransaction(manifest, {
      claimId: `0x${"33".repeat(32)}`,
    });
    const data = tx.getData();

    expect(JSON.stringify(data)).toContain("start_direct_review");
    expect(JSON.stringify(data)).toContain(manifest.registryObjectId.slice(2));
    expect(JSON.stringify(data)).toContain("0000000000000000000000000000000000000000000000000000000000000006");
  });

  it("keeps the Random-dependent committee call as the final command", () => {
    const tx = buildSelectCommitteeTransaction(manifest, {
      claimId: `0x${"33".repeat(32)}`,
    });
    const data = tx.getData() as { commands: Array<{ $kind: string; MoveCall?: { function: string } }> };

    expect(data.commands).toHaveLength(1);
    expect(data.commands[0]).toMatchObject({
      $kind: "MoveCall",
      MoveCall: { function: "select_committee" },
    });
  });

  it.each(transactionCases())(
    "builds $functionName with the Move-source argument count",
    ({ transaction, functionName, argumentCount }) => {
      const moveCall = lastMoveCall(transaction);
      expect(moveCall.function).toBe(functionName);
      expect(moveCall.arguments).toHaveLength(argumentCount);
    },
  );
});

describe("FakeSuiGateway", () => {
  it("updates an agent manifest and increments its version", async () => {
    const gateway = new FakeSuiGateway();
    const agent = gateway.agents[0];
    if (!agent) throw new Error("missing default fake agent");
    const manifestHash = new Uint8Array(32).fill(1);
    const modelHash = new Uint8Array(32).fill(2);
    const roleHash = new Uint8Array(32).fill(3);

    const result = await gateway.updateAgentManifest({
      agentIndex: 0,
      agentProfileId: agent.agentProfileId,
      agentCapId: agent.agentCapId,
      manifestHash,
      manifestBlobId: "updated-manifest",
      modelHash,
      roleHash,
    });

    expect(result.version).toBeGreaterThan(1);
    expect(gateway.agents[0]?.manifestHash).toEqual(manifestHash);
    expect(gateway.agents[0]?.manifestBlobId).toBe("updated-manifest");
    expect(gateway.agents[0]?.modelHash).toEqual(modelHash);
    expect(gateway.agents[0]?.roleHash).toEqual(roleHash);
  });
});

describe("SignerRegistry", () => {
  it("derives the test-only demo allowlist deterministically", () => {
    const first = SignerRegistry.fromEnv({
      OPENVERDICT_AGENT_SEED: "offline-test-seed",
    });
    const second = SignerRegistry.fromEnv({
      OPENVERDICT_AGENT_SEED: "offline-test-seed",
    });

    expect(first.listAgentAddresses()).toHaveLength(5);
    expect(first.listAgentAddresses()).toEqual(second.listAgentAddresses());
    expect(new Set(first.listAgentAddresses()).size).toBe(5);
    expect(first.challengerAddress()).toBe(second.challengerAddress());
    expect(first.challengerAddress()).not.toBe(first.operatorAddress());
    expect(first.listAgentAddresses()).not.toContain(first.challengerAddress());
  });

  it("loads the bech32 operator key without exposing it", () => {
    const operator = new Ed25519Keypair();
    const registry = SignerRegistry.fromEnv({
      SUI_OPERATOR_SECRET_KEY: operator.getSecretKey(),
      OPENVERDICT_AGENT_SEED: "operator-test-seed",
    });

    expect(registry.operatorAddress()).toBe(operator.toSuiAddress());
    expect(registry.getOperator().toSuiAddress()).toBe(operator.toSuiAddress());
  });
});

function transactionCases(): Array<{
  functionName: string;
  argumentCount: number;
  transaction: Transaction;
}> {
  const id = (byte: string) => `0x${byte.repeat(64)}`;
  const hash = new Uint8Array(32).fill(7);
  const deadlines = {
    evidenceCutoffMs: 1,
    proposalDeadlineMs: 2,
    challengeDeadlineMs: 3,
    firstCommitDeadlineMs: 4,
    firstRevealDeadlineMs: 5,
    discussionDeadlineMs: 6,
    secondCommitDeadlineMs: 7,
    secondRevealDeadlineMs: 8,
  };
  return [
    {
      functionName: "register_agent",
      argumentCount: 8,
      transaction: buildRegisterAgentTransaction(manifest, {
        bondAmount: 1,
        manifestHash: hash,
        manifestBlobId: "manifest",
        modelHash: hash,
        roleHash: hash,
        humanBackingHash: hash,
      }),
    },
    {
      functionName: "update_agent_manifest",
      argumentCount: 8,
      transaction: buildUpdateAgentManifestTransaction(manifest, {
        agentProfileId: id("3"),
        agentCapId: id("5"),
        manifestHash: hash,
        manifestBlobId: "manifest",
        modelHash: hash,
        roleHash: hash,
      }),
    },
    {
      functionName: "create_claim",
      argumentCount: 18,
      transaction: buildCreateClaimTransaction(manifest, {
        statement: "claim",
        resolutionCriteria: "criteria",
        mode: 1,
        deadlines,
        committeeBudget: "1",
        evidenceBudget: "1",
        contentHash: hash,
        statementBlobId: "statement",
        criteriaBlobId: "criteria",
        evidencePolicyId: hash,
      }),
    },
    {
      functionName: "propose_outcome",
      argumentCount: 5,
      transaction: buildProposeOutcomeTransaction(manifest, {
        claimId: id("3"),
        proposerBondAmount: 1,
        outcome: 1,
      }),
    },
    {
      functionName: "challenge_outcome",
      argumentCount: 6,
      transaction: buildChallengeOutcomeTransaction(manifest, {
        claimId: id("3"),
        challengerBondAmount: 1,
        reasonHash: hash,
        reasonBlobId: "reason",
      }),
    },
    {
      functionName: "accept_jury_seat",
      argumentCount: 3,
      transaction: buildAcceptJurySeatTransaction(manifest, {
        jurySeatId: id("4"),
        agentCapId: id("5"),
      }),
    },
    {
      functionName: "freeze_evidence",
      argumentCount: 10,
      transaction: buildFreezeEvidenceTransaction(manifest, {
        claimId: id("3"),
        evidenceCapId: id("6"),
        phase: 1,
        root: hash,
        manifestBlobId: "manifest",
        manifestBlobObjectId: id("7"),
        sourceCount: 1,
        policyId: hash,
        walrusEndEpoch: 10,
      }),
    },
    {
      functionName: "approve_run",
      argumentCount: 14,
      transaction: buildApproveRunTransaction(manifest, {
        runAttestorCapId: id("8"),
        claimId: id("3"),
        committeeId: id("9"),
        jurySeatId: id("4"),
        agentProfileId: id("a"),
        agentOwner: id("b"),
        phase: 1,
        runHash: hash,
        runBlobId: "run",
        runBlobObjectId: id("c"),
        toolBlobId: "tools",
        toolBlobObjectId: id("d"),
        walrusEndEpoch: 10,
      }),
    },
    {
      functionName: "commit_vote",
      argumentCount: 5,
      transaction: buildCommitVoteTransaction(manifest, {
        jurySeatId: id("4"),
        agentCapId: id("5"),
        runApprovalId: id("e"),
        commitment: hash,
      }),
    },
    {
      functionName: "reveal_vote",
      argumentCount: 12,
      transaction: buildRevealVoteTransaction(manifest, {
        jurySeatId: id("4"),
        roundTallyId: id("f"),
        agentCapId: id("5"),
        outcome: 1,
        confidenceBps: 8_000,
        outputHash: hash,
        runHash: hash,
        salt: hash,
        argumentBlobId: "argument",
        argumentBlobObjectId: id("1"),
        argumentWalrusEndEpoch: 10,
      }),
    },
    {
      functionName: "advance_phase",
      argumentCount: 2,
      transaction: buildAdvancePhaseTransaction(manifest, { claimId: id("3") }),
    },
    {
      functionName: "finalize_claim",
      argumentCount: 5,
      transaction: buildFinalizeClaimTransaction(manifest, {
        claimId: id("3"),
        committeeId: id("9"),
        roundTallyId: id("f"),
        evidenceBundleId: id("2"),
      }),
    },
    {
      functionName: "withdraw_payout",
      argumentCount: 3,
      transaction: buildWithdrawPayoutTransaction(manifest, {
        claimId: id("3"),
        payoutTicketId: id("4"),
      }),
    },
    {
      functionName: "create_pool",
      argumentCount: 5,
      transaction: buildCreateDemoPoolTransaction(manifest, {
        claimId: id("3"),
        acceptedPackageVersion: 1,
        closeAtMs: 10,
      }),
    },
    {
      functionName: "enter",
      argumentCount: 5,
      transaction: buildEnterDemoPoolTransaction(manifest, {
        poolId: id("4"),
        stakeAmount: 1,
        outcome: 1,
      }),
    },
    {
      functionName: "settle_pool",
      argumentCount: 3,
      transaction: buildSettleDemoPoolTransaction(manifest, {
        poolId: id("4"),
        certificateId: id("5"),
      }),
    },
    {
      functionName: "redeem",
      argumentCount: 2,
      transaction: buildRedeemDemoPoolTransaction(manifest, {
        poolId: id("4"),
        positionId: id("5"),
      }),
    },
  ];
}

function lastMoveCall(transaction: Transaction): {
  function: string;
  arguments: unknown[];
} {
  const data = transaction.getData() as {
    commands: Array<{
      $kind: string;
      MoveCall?: { function: string; arguments: unknown[] };
    }>;
  };
  const command = [...data.commands].reverse().find((item) => item.$kind === "MoveCall");
  if (!command?.MoveCall) throw new Error("transaction has no Move call");
  return command.MoveCall;
}

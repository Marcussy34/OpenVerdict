import { describe, expect, it, vi } from "vitest";
import type { Engine } from "../../lib/engine/contract";
import { runCli } from "./index";

describe("OpenVerdict CLI", () => {
  it("parses nested report arguments and emits one JSON object per line", async () => {
    const engine = fakeEngine();
    const report = vi.spyOn(engine, "report");
    const inspect = vi.spyOn(engine, "inspect");
    const output: string[] = [];

    const code = await runCli(
      ["fact-check", "report", "--claim", "0xclaim", "--verify", "--json"],
      { engine, stdout: (value) => output.push(value), stderr: () => undefined },
    );

    expect(code).toBe(0);
    expect(report).toHaveBeenCalledWith("0xclaim");
    expect(inspect).toHaveBeenCalledWith("0xclaim", { verify: true });
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      claimId: "0xclaim",
      verification: { commitmentsRecomputed: true },
    });
  });

  it("prints the state-change preflight before invoking the engine", async () => {
    const engine = fakeEngine();
    const order: string[] = [];
    vi.spyOn(engine, "propose").mockImplementation(async () => {
      order.push("action");
      return { digest: "digest-1" };
    });

    const code = await runCli(
      ["--json", "claim", "propose", "--claim", "0xclaim", "--outcome", "NO"],
      {
        engine,
        stdout: (value) => {
          order.push(JSON.parse(value).type ?? "result");
        },
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(order).toEqual(["preflight", "action", "result"]);
    expect(engine.propose).toHaveBeenCalledWith("0xclaim", 2);
  });

  it("returns a stable non-zero error code for invalid phase arguments", async () => {
    const errors: string[] = [];
    const code = await runCli(
      ["evidence", "freeze", "--claim", "0xclaim", "--phase", "3"],
      {
        engine: fakeEngine(),
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
      },
    );

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });
});

function fakeEngine(): Engine {
  return {
    factCheckStart: async () => ({ claimId: "0xclaim" }),
    registerZkBackedAgent: async () => ({
      agentProfileId: "0xagent",
      humanBackingHash: "0xbacking",
      backingKind: "ZKLOGIN_BACKED",
      digest: "digest-register",
    }),
    claimCreate: async () => ({ claimId: "0xclaim", digest: "digest-create" }),
    propose: async () => ({ digest: "digest-propose" }),
    challenge: async () => ({ digest: "digest-challenge" }),
    selectCommittee: async () => ({ digest: "digest-select" }),
    evidenceFreeze: async () => ({ digest: "digest-evidence" }),
    juryRun: async (claimId, phase) => ({ claimId, phase, runs: [] }),
    votesCommit: async () => [],
    votesReveal: async () => [],
    // Proof reads are not exercised by the CLI tests; fail loudly if they ever are.
    runProof: async () => {
      throw new Error("fake engine: runProof is not implemented");
    },
    agentManifestDocument: async () => null,
    advance: async () => null,
    finalize: async (claimId) => ({
      claimId,
      result: "YES",
      truthScoreBps: 8_000,
      certificateId: "0xcertificate",
      digest: "digest-finalize",
    }),
    inspect: async (claimId, options) => ({
      claimId,
      mode: 1,
      state: 10,
      statement: "fixture",
      resolutionCriteria: "fixture",
      deadlines: {
        evidenceCutoffMs: 1,
        proposalDeadlineMs: 2,
        challengeDeadlineMs: 3,
        firstCommitDeadlineMs: 4,
        firstRevealDeadlineMs: 5,
        discussionDeadlineMs: 6,
        secondCommitDeadlineMs: 7,
        secondRevealDeadlineMs: 8,
      },
      evidenceRoots: [],
      commitments: [],
      ...(options?.verify
        ? {
            verification: {
              commitmentsRecomputed: true,
              truthScoreRecomputed: true,
              evidenceRootsRecomputed: true,
              issues: [],
            },
          }
        : {}),
    }),
    report: async (claimId) => ({
      claimId,
      statement: "fixture",
      submittedUrls: [],
      label: "YES",
      truthScore: 80,
      truthScoreFormula: "fixture",
      finalRoundVotes: [],
      agents: [],
      evidence: [],
      sui: { claimObjectId: claimId, revealedVoteIds: [] },
      auditBundle: {},
    }),
    listClaims: async () => [],
    listAgents: async () => [],
    status: async () => ({
      appVersion: "0.1.0",
      network: "localnet",
      packageId: "0xpackage",
      registryObjectId: "0xregistry",
      suiHealthy: true,
      gonkaMode: "fake",
      walrusMode: "local",
      dbHealthy: true,
      paused: false,
    }),
    events: async function* () {},
  };
}

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../../lib/engine/contract";
import { runCli } from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

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

  it("extracts pasted text and prints each claim with its quote", async () => {
    const sourceText =
      "Acme opened a Penang factory in 2023. It employed 800 people there in 2024.";
    const requests: unknown[] = [];
    const output: string[] = [];

    const code = await runCli(
      ["fact-check", "extract", "--text", sourceText],
      {
        claimExtractionHandler: async (request) => {
          requests.push(await request.json());
          return Response.json({
            claims: [
              {
                claim: "Acme opened a factory in Penang in 2023.",
                reason: "The opening can be checked.",
                quote: "Acme opened a Penang factory in 2023.",
              },
              {
                claim: "Acme employed 800 people in Penang in 2024.",
                reason: "The dated headcount can be checked.",
                quote: "It employed 800 people there in 2024.",
              },
            ],
            language: "en",
            claim: "Acme opened a factory in Penang in 2023.",
            modelId: "vendor/model-a",
          });
        },
        stdout: (value) => output.push(value),
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(requests).toEqual([{ text: sourceText }]);
    expect(output).toEqual([
      [
        "1. Acme opened a factory in Penang in 2023.",
        "   Acme opened a Penang factory in 2023.",
        "2. Acme employed 800 people in Penang in 2024.",
        "   It employed 800 people there in 2024.",
      ].join("\n"),
    ]);
  });

  it("fails with the weather refusal when the jury cannot sit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openverdict-cli-"));
    temporaryDirectories.push(directory);
    const requestPath = join(directory, "request.json");
    await writeFile(
      requestPath,
      JSON.stringify({ claim: "Bad weather refuses this claim.", urls: [] }),
    );
    const engine = fakeEngine();
    vi.spyOn(engine, "factCheckSubmit").mockResolvedValue({
      kind: "refused",
      reason: "WEATHER_NOT_CLEAR",
      weather: {
        probedAtMs: 1,
        stale: false,
        clear: false,
        families: [
          {
            modelId: "deepseek-r1",
            family: "deepseek",
            ok: true,
            latencyMs: 12,
            status: "200",
          },
          {
            modelId: "minimax-m2",
            family: "minimax",
            ok: false,
            latencyMs: 60_000,
            status: "TIMEOUT",
          },
          {
            modelId: "kimi-k2",
            family: "kimi",
            ok: true,
            latencyMs: 31,
            status: "200",
          },
        ],
      },
    });
    const errors: string[] = [];

    const code = await runCli(
      ["fact-check", "start", "--file", requestPath],
      {
        engine,
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
      },
    );

    expect(code).toBe(1);
    const rendered = errors.join("\n");
    expect(rendered).toContain("WEATHER_NOT_CLEAR");
    expect(rendered).toContain(
      "The jury cannot sit right now: MiniMax is down.",
    );
  });
});

function fakeEngine(): Engine {
  return {
    factCheckSubmit: async () => ({ kind: "claim", claimId: "0xclaim" }),
    weatherTick: async () => undefined,
    weather: async () => ({
      probedAtMs: null,
      stale: true,
      clear: false,
      families: [],
    }),
    factCheckStart: async () => ({ claimId: "0xclaim" }),
    registerZkBackedAgent: async () => ({
      agentProfileId: "0xagent",
      humanBackingHash: "0xbacking",
      backingKind: "ZKLOGIN_BACKED",
      digest: "digest-register",
      role: "SKEPTIC",
    }),
    // Staking runs through the web app and pnpm stake:seat, never the CLI.
    prepareStake: async () => {
      throw new Error("fake engine: prepareStake is not implemented");
    },
    confirmStake: async () => {
      throw new Error("fake engine: confirmStake is not implemented");
    },
    claimCreate: async () => ({ claimId: "0xclaim", digest: "digest-create" }),
    propose: async () => ({ digest: "digest-propose" }),
    challenge: async () => ({ digest: "digest-challenge" }),
    selectCommittee: async () => ({ digest: "digest-select" }),
    evidenceFreeze: async () => ({ digest: "digest-evidence" }),
    runDeliberation: async () => undefined,
    voidAttempt: async () => undefined,
    relaunchTick: async () => undefined,
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

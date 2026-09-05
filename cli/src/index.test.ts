import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../../lib/engine/contract";
import { runCli } from "./index";
import type { OperatorClient } from "./operator";

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
        requiredFamilies: 3,
        activeFamilies: ["deepseek", "minimax", "kimi"],
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

describe("operator registry commands", () => {
  it("parses the diversity pair and signs one set_jury_diversity call", async () => {
    const calls: unknown[] = [];
    const output: string[] = [];

    const code = await runCli(
      ["--json", "registry", "diversity", "--required", "2", "--per-model", "3"],
      {
        engine: fakeEngine(),
        operator: fakeOperator(calls),
        stdout: (value) => output.push(value),
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([{ requiredModels: 2, maxSeatsPerModel: 3 }]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({ digest: "operator-digest" });
  });

  it("refuses two families with two seats per model, which cannot fill five seats", async () => {
    const errors: string[] = [];

    const code = await runCli(
      ["registry", "diversity", "--required", "2", "--per-model", "2"],
      {
        engine: fakeEngine(),
        operator: fakeOperator([]),
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
      },
    );

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });

  it("rejects a diversity count the Move entry would abort on", async () => {
    const errors: string[] = [];

    const code = await runCli(
      ["registry", "diversity", "--required", "4", "--per-model", "3"],
      {
        engine: fakeEngine(),
        operator: fakeOperator([]),
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
      },
    );

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });

  it("takes one seat out of the draw by profile id", async () => {
    const calls: unknown[] = [];

    const code = await runCli(
      ["--json", "agents", "eligibility", "0xprofile", "--active", "false"],
      {
        engine: fakeEngine(),
        operator: fakeOperator(calls),
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([{ agentProfileId: "0xprofile", active: false }]);
  });

  it("prints the registry roster with the draw rule and the active count", async () => {
    const output: string[] = [];

    const code = await runCli(["registry", "roster"], {
      engine: fakeEngine(),
      operator: fakeOperator([]),
      stdout: (value) => output.push(value),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    const printed = output.join("\n");
    expect(printed).toContain("rule       3 model families, 2 seats per model");
    expect(printed).toContain("seats      1 active of 2");
    expect(printed).toContain("1 active, 1 inactive (1 SOURCE_AUTHENTICITY)");
    expect(printed).toContain("0xseat1 active   deepseek-ai/DeepSeek-V4-Flash-0731 SOURCE_AUTHENTICITY weight 10000");
    // The line the procedure reads before it deactivates a family.
    expect(printed).toContain(
      "summary    1 active seats, 1 families; spare SKEPTIC: 0, spare SOURCE_AUTHENTICITY: 0",
    );
  });

  it("reconciles the agent mirror with the registry and names what changed", async () => {
    const output: string[] = [];
    const calls: unknown[] = [];

    const code = await runCli(["registry", "sync-mirror"], {
      engine: fakeEngine(),
      operator: fakeOperator(calls),
      stdout: (value) => output.push(value),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([{ syncMirror: true }]);
    const printed = output.join("\n");
    expect(printed).toContain("registry   0xregistry (2 seats)");
    expect(printed).toContain("activated  1: 0xseat1");
    expect(printed).toContain("stale      1: 0xstale");
    // Nothing is claimed about the two kinds that did not change.
    expect(printed).not.toContain("deactivated");
    expect(printed).not.toContain("missing");
  });

  it("reports the weight the eligibility change preserved", async () => {
    const output: string[] = [];

    const code = await runCli(
      ["--json", "agents", "eligibility", "0xprofile", "--active", "false"],
      {
        engine: fakeEngine(),
        operator: fakeOperator([]),
        stdout: (value) => output.push(value),
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({ weight: 10_000 });
  });

  it("dry-runs a republish of every active seat and leaves the mirror alone", async () => {
    const calls: unknown[] = [];
    const output: string[] = [];

    const code = await runCli(["agents", "republish", "--active", "--dry-run"], {
      engine: fakeEngine(),
      operator: fakeOperator(calls),
      stdout: (value) => output.push(value),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([{ republish: { active: true, dryRun: true } }]);
    const printed = output.join("\n");
    expect(printed).toContain(
      "Republish only while no claim is live",
    );
    expect(printed).toContain("mode       dry run");
    expect(printed).toContain("seats      2 selected, 0 republished, 1 already current");
    expect(printed).toContain("slot 3 deepseek-ai/DeepSeek-V4-Flash-0731 SOURCE_AUTHENTICITY v3");
    expect(printed).toContain("to v6");
    // Nothing moved, so the mirror is not reconciled behind the operator's back.
    expect(printed).not.toContain("registry   0xregistry");
  });

  it("republishes named seats and reconciles the mirror afterwards", async () => {
    const calls: unknown[] = [];
    const output: string[] = [];

    const code = await runCli(["agents", "republish", "0xseat1", "0xseat2"], {
      engine: fakeEngine(),
      operator: fakeOperator(calls),
      stdout: (value) => output.push(value),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { republish: { agentProfileIds: ["0xseat1", "0xseat2"] } },
      { syncMirror: true },
    ]);
    const printed = output.join("\n");
    expect(printed).toContain("mode       live");
    expect(printed).toContain("republish-digest");
    expect(printed).toContain("registry   0xregistry (2 seats)");
  });

  it("refuses a republish that names neither seats nor --active", async () => {
    const errors: string[] = [];

    const code = await runCli(["agents", "republish"], {
      engine: fakeEngine(),
      operator: fakeOperator([]),
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });

  it("refuses a republish that mixes --active with named seats", async () => {
    const errors: string[] = [];

    const code = await runCli(["agents", "republish", "0xseat1", "--active"], {
      engine: fakeEngine(),
      operator: fakeOperator([]),
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });

  it("refuses an --active value that is neither true nor false", async () => {
    const errors: string[] = [];

    const code = await runCli(
      ["agents", "eligibility", "0xprofile", "--active", "off"],
      {
        engine: fakeEngine(),
        operator: fakeOperator([]),
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
      },
    );

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("CLI_USAGE");
  });
});

/** Records what the CLI asked for instead of signing anything. */
function fakeOperator(calls: unknown[]): OperatorClient {
  const result = {
    digest: "operator-digest",
    network: "localnet",
    packageId: "0xpackage",
    registryObjectId: "0xregistry",
    adminCapObjectId: "0xadmincap",
  };
  return {
    async setJuryDiversity(input) {
      calls.push(input);
      return result;
    },
    async setAgentEligibility(input) {
      calls.push(input);
      // The real client reads the seat's recorded weight and passes it back.
      return { ...result, weight: 10_000, rosterMirror: "updated" as const };
    },
    async republishManifests(selection) {
      calls.push({ republish: selection });
      return {
        dryRun: selection.dryRun === true,
        republished: selection.dryRun === true ? 0 : 1,
        upToDate: 1,
        seats: [
          {
            agentProfileId: "0xseat1",
            modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
            role: "SOURCE_AUTHENTICITY",
            slotIndex: 3,
            oldVersion: "3",
            oldPromptHash: `0x${"c6".repeat(32)}`,
            newVersion: "6",
            newPromptHash: `0x${"a2".repeat(32)}`,
            manifestBlobId: "blob-new",
            status: selection.dryRun === true ? "dry run" : "republished",
            ...(selection.dryRun === true ? {} : { digest: "republish-digest" }),
          },
          {
            agentProfileId: "0xseat2",
            modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
            role: "SKEPTIC",
            slotIndex: 4,
            oldVersion: "6",
            oldPromptHash: `0x${"a2".repeat(32)}`,
            newVersion: "6",
            newPromptHash: `0x${"a2".repeat(32)}`,
            manifestBlobId: "blob-current",
            status: "up to date",
          },
        ],
      };
    },
    async syncMirror() {
      calls.push({ syncMirror: true });
      return {
        network: "testnet",
        registryObjectId: "0xregistry",
        registrySeats: 2,
        activated: ["0xseat1"],
        deactivated: [],
        stale: ["0xstale"],
        missing: [],
      };
    },
    async registryRoster() {
      calls.push({ registryRoster: true });
      return {
        network: "testnet",
        packageId: "0xpackage",
        registryObjectId: "0xregistry",
        requiredFamilies: 3,
        maxSeatsPerModel: 2,
        totalSeats: 2,
        activeSeats: 1,
        activeFamilies: 1,
        spareSkeptics: 0,
        spareSourceAuthenticity: 0,
        families: [
          {
            modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
            active: 1,
            inactive: 1,
            activeRoles: { SOURCE_AUTHENTICITY: 1 },
          },
        ],
        seats: [
          {
            agentProfileId: "0xseat1",
            owner: "0xowner1",
            modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
            role: "SOURCE_AUTHENTICITY",
            active: true,
            weight: 10_000,
          },
          {
            agentProfileId: "0xseat2",
            owner: "0xowner2",
            modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
            role: "SKEPTIC",
            active: false,
            weight: 10_000,
          },
        ],
      };
    },
  };
}

function fakeEngine(): Engine {
  return {
    factCheckSubmit: async () => ({ kind: "claim", claimId: "0xclaim" }),
    weatherTick: async () => undefined,
    weather: async () => ({
      probedAtMs: null,
      stale: true,
      clear: false,
      families: [],
      requiredFamilies: 3,
      activeFamilies: [],
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

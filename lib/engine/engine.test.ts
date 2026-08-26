import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeGonkaAdapter } from "../gonka";
import { blake2b256, toHex, type AgentManifest } from "../protocol";
import { createDb } from "../storage";
import {
  FakeSuiGateway,
  type GatewayAcceptSeatInput,
  type GatewayBindEvidenceInput,
  type FakeSuiAgent,
  type ReleaseManifest,
} from "../sui";
import { createLocalWalrusStore } from "../walrus";
import { createEngine, type EngineAgentConfig } from "./index";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("headless engine", () => {
  it("runs a direct review and excludes NO_VALID_INFERENCE from voting", async () => {
    const gateway = new FakeSuiGateway();
    const setup = await engineSetup(gateway, 4);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "The deterministic engine fixture is supported.",
      text: "A bounded local evidence artifact supports the fixture.",
      urls: [],
    });

    await setup.engine.advance(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const jury = await setup.engine.juryRun(claimId, 1);
    expect(jury.runs).toHaveLength(5);
    expect(jury.runs.filter((run) => run.status === "PROVIDER_ERROR")).toHaveLength(1);

    expect(await setup.engine.votesCommit(claimId, 1)).toHaveLength(4);
    await setup.engine.advance(claimId);
    expect(await setup.engine.votesReveal(claimId, 1)).toHaveLength(4);
    const finalized = await setup.engine.finalize(claimId);

    expect(finalized).toMatchObject({
      claimId,
      result: "YES",
      truthScoreBps: 8_000,
    });
    const report = await setup.engine.report(claimId);
    expect(report.label).toBe("YES");
    expect(report.truthScore).toBe(80);
    expect(report.agents).toHaveLength(4);
    expect(report.finalRoundVotes).toHaveLength(4);

    const inspection = await setup.engine.inspect(claimId, { verify: true });
    expect(inspection.verification).toEqual({
      commitmentsRecomputed: true,
      truthScoreRecomputed: true,
      evidenceRootsRecomputed: true,
      issues: [],
    });

    const publicEvents = [];
    for await (const event of setup.engine.events(claimId)) publicEvents.push(event);
    expect(publicEvents.some((event) => event.kind === "claim_finalized")).toBe(true);
    expect(publicEvents.filter((event) => event.kind === "inference_completed")).toHaveLength(4);
    expect(JSON.stringify(publicEvents)).not.toContain("saltHex");
  });

  it("does not expose agent outputs in a report before reveal", async () => {
    const gateway = new FakeSuiGateway();
    const setup = await engineSetup(gateway, 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Pre-reveal output remains hidden.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);

    const report = await setup.engine.report(claimId);
    expect(report.agents).toEqual([]);
    expect(JSON.stringify(report.auditBundle)).not.toContain("Deterministic fake inference");
    expect(JSON.stringify(report)).not.toContain("salt");
    const events = await collectEvents(setup.engine.events(claimId), 24);
    expect(events.some((event) => event.kind === "agent_activity")).toBe(true);
    expect(events.some((event) => event.kind === "inference_completed")).toBe(false);
  });

  it("recovers partially completed seat acceptance and evidence binding", async () => {
    class FlakyGateway extends FakeSuiGateway {
      acceptFailures = 1;
      bindFailures = 1;

      override async acceptJurySeat(input: GatewayAcceptSeatInput) {
        if (this.acceptFailures > 0) {
          this.acceptFailures -= 1;
          throw new Error("transient acceptance failure");
        }
        return super.acceptJurySeat(input);
      }

      override async bindJurySeatEvidence(input: GatewayBindEvidenceInput) {
        if (this.bindFailures > 0) {
          this.bindFailures -= 1;
          throw new Error("transient bind failure");
        }
        return super.bindJurySeatEvidence(input);
      }
    }

    const gateway = new FlakyGateway();
    const setup = await engineSetup(gateway, 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Retryable orchestration persists before external follow-up calls.",
      text: "Local evidence.",
      urls: [],
    });

    await expect(setup.engine.selectCommittee(claimId)).rejects.toThrow(
      "transient acceptance failure",
    );
    await expect(setup.engine.selectCommittee(claimId)).resolves.toMatchObject({
      objectIds: { committee: expect.any(String) },
    });
    await expect(setup.engine.evidenceFreeze(claimId, 1)).rejects.toThrow(
      "transient bind failure",
    );
    await expect(setup.engine.evidenceFreeze(claimId, 1)).resolves.toMatchObject({
      objectIds: { evidenceBundle: expect.any(String) },
    });
    expect((await setup.engine.inspect(claimId)).commitments).toHaveLength(5);
  });

  it("opens discussion and finalizes from an independent second round", async () => {
    const gateway = new FakeSuiGateway();
    const setup = await engineSetup(gateway, [
      ["YES", "YES", "YES", "NO", "NO"],
      ["NO", "NO", "NO", "NO", "YES"],
    ]);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A split first round requires an independent second round.",
      text: "Local evidence for both rounds.",
      urls: [],
    });

    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);
    await setup.engine.votesReveal(claimId, 1);
    await setup.engine.advance(claimId);
    await setup.engine.evidenceFreeze(claimId, 2);
    await setup.engine.advance(claimId);

    await setup.engine.juryRun(claimId, 2);
    await setup.engine.votesCommit(claimId, 2);
    await setup.engine.advance(claimId);
    await setup.engine.votesReveal(claimId, 2);
    const finalized = await setup.engine.finalize(claimId);

    expect(finalized).toMatchObject({ result: "NO", truthScoreBps: 3_200 });
    expect((await setup.engine.inspect(claimId)).state).toBe(10);
    expect((await setup.engine.report(claimId)).finalRoundVotes).toHaveLength(5);
  });
});

async function engineSetup(
  gateway: FakeSuiGateway,
  runPlan: number | Array<Array<"YES" | "NO" | "UNSURE">>,
) {
  const directory = await mkdtemp(join(tmpdir(), "openverdict-engine-"));
  const manifest = testManifest();
  const manifestPath = join(directory, "release.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const db = createDb({ dataDir: "memory://" });
  if (!(db instanceof PGlite)) throw new Error("expected pglite");
  databases.push(db);
  const initialAgents = gateway.agents.map(toEngineAgent);
  const fixtures =
    typeof runPlan === "number"
      ? gateway.agents.map((agent, index) => ({
          agentProfileId: agent.agentProfileId as `0x${string}`,
          outcome: "YES" as const,
          confidenceBps: 8_000,
          ...(index < runPlan ? {} : { failure: "provider_5xx" as const }),
        }))
      : gateway.agents.flatMap((agent, index) =>
          runPlan.map((round) => ({
            agentProfileId: agent.agentProfileId as `0x${string}`,
            outcome: round[index] ?? "UNSURE",
            confidenceBps: 8_000,
          })),
        );
  const engine = await createEngine({
    network: "localnet",
    manifestPath,
    db,
    walrus: createLocalWalrusStore(join(directory, "walrus")),
    gonka: createFakeGonkaAdapter(fixtures),
    suiGateway: gateway,
    initialAgents,
    now: () => Date.parse("2026-08-27T00:00:00.000Z"),
    eventPollIntervalMs: 5,
  });
  return { engine, db };
}

async function collectEvents(
  iterable: AsyncIterable<import("./contract").ResolutionEvent>,
  count: number,
): Promise<import("./contract").ResolutionEvent[]> {
  const events: import("./contract").ResolutionEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    if (events.length === count) break;
  }
  return events;
}

function toEngineAgent(agent: FakeSuiAgent, index: number): EngineAgentConfig {
  const hash = (label: string) =>
    toHex(blake2b256(new TextEncoder().encode(`${label}:${index}`)));
  const manifest: AgentManifest = {
    agentProfileId: agent.agentProfileId as `0x${string}`,
    owner: agent.owner as `0x${string}`,
    humanAttestationHash: hash("human"),
    humanVerificationProvider: "test-only",
    version: "1",
    manifestBlobId: `manifest-${index}`,
    manifestHash: hash("manifest"),
    promptHash: hash("prompt"),
    modelId: agent.modelId,
    providerId: "gonkarouter",
    toolPolicyHash: hash("tools"),
    evidencePolicyHash: hash("evidence"),
    publicKey: agent.owner,
    registeredAtMs: 0,
    registeredCheckpoint: 0,
  };
  return {
    manifest,
    role: agent.role,
    agentCapId: agent.agentCapId,
    reputation: {},
  };
}

function testManifest(): ReleaseManifest {
  return {
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
}

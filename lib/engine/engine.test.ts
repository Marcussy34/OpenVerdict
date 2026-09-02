import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELIBERATION_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V3,
  DEFAULT_PROMPT_SPEC_V4,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V3,
  DEFAULT_TOOL_POLICY_V4,
  EMPTY_TOOL_TRANSCRIPT_HASH,
  TABLE_VOTE_PROMPT_SPEC_V1,
  canonicalJsonBytes,
  createFakeGonkaAdapter,
  promptSpecHash,
  tableVotePromptSpecHash,
  toolPolicyHash,
  type FakeAction,
  type FakeFailure,
} from "../gonka";
import {
  CLAIM_MODE,
  CLAIM_STATE,
  blake2b256,
  fromHex,
  toHex,
  type AgentManifest,
  type PublicRunBundleCoreV3,
  type PublicRunBundleCoreV5,
  type PublicRunBundleCoreV6,
  type SealedRunBundleV2,
  type TableVoteStance,
} from "../protocol";
import { sampleTableVoteInput } from "../protocol/table-vote.fixture";
import {
  createFakeResearchProvider,
  transcriptHash,
  type ResearchProvider,
} from "../research";
import type { SealEscrowService } from "../seal/escrow";
import { parseSealIdentity, sealIdentityHex } from "../seal/identity";
import {
  Repository,
  createDb,
  createRepository,
  migrate,
  type EvidenceArtifactRecord,
  type DeliberationTurnRecord,
  type FactCheckQueueRecord,
} from "../storage";
import {
  FakeSuiGateway,
  SignerRegistry,
  fakeId,
  type BoundAgentSigner,
  type GatewayAcceptSeatInput,
  type GatewayBindEvidenceInput,
  type FakeSuiAgent,
  type ReleaseManifest,
} from "../sui";
import { createLocalWalrusStore, type WalrusStore } from "../walrus";
import {
  EVIDENCE_POLICY_V1_LABEL,
  buildAgentManifestDocument,
  parseAgentManifestDocument,
} from "./agentManifestDocument";
import { openSealedRunBundle } from "./runBundle";
import { isVoidedAttempt } from "./claim-lifecycle";
import {
  QUEUE_LAUNCH_SPACING_MS,
  RESEARCH_WEATHER_ID,
  QUEUE_TTL_MS,
  RELAUNCH_GIVE_UP_MS,
  WEATHER_PROBE_INTERVAL_MS,
  WEATHER_STALE_MS,
  agentBackingStatus,
  buildZkLoginBackingMessage,
  createEngine,
  debateConvergedAfterExchange,
  defaultDeadlines,
  deliberationTurnInstructions,
  EngineNoEvidenceError,
  EngineStateError,
  EngineValidationError,
  validateTableVote,
  type EngineAgentConfig,
} from "./index";
import { isDead } from "../../workers/resolution-worker";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("validateTableVote", () => {
  const input = sampleTableVoteInput();
  const output = input.self.roundOneOutput;
  const ctx = {
    frozenEvidenceIds: input.evidenceManifest.items.map((item) => item.evidenceId),
    maximumReasonLength: input.outputContract.maximumReasonLength,
  };

  it("accepts a well-formed vote whose evidence ids are frozen", () => {
    expect(validateTableVote(JSON.stringify(output), ctx)).toEqual({
      ok: true,
      output,
      repairs: [],
    });
  });

  it("drops prose from unsupportedClaims and records the repair", () => {
    const prose = "The claim is stated as an absolute but research is divided.";

    expect(
      validateTableVote(
        JSON.stringify({ ...output, unsupportedClaims: [prose] }),
        ctx,
      ),
    ).toEqual({
      ok: true,
      output: { ...output, unsupportedClaims: [] },
      repairs: [
        `unsupportedClaims: dropped entry that is not an evidence id: "${prose}"`,
      ],
    });
  });

  it("rejects a vote with an unknown evidence id", () => {
    const result = validateTableVote(
      JSON.stringify({ ...output, evidenceFor: ["unknown-evidence"] }),
      ctx,
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("rejects confidence outside basis-point bounds", () => {
    const result = validateTableVote(
      JSON.stringify({ ...output, confidenceBps: 10_001 }),
      ctx,
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("rejects reasoning longer than the output contract", () => {
    const result = validateTableVote(
      JSON.stringify({ ...output, reasoning: "too long" }),
      { ...ctx, maximumReasonLength: 4 },
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a vote with a missing required key", () => {
    const missingReasoning = {
      outcome: output.outcome,
      confidenceBps: output.confidenceBps,
      evidenceFor: output.evidenceFor,
      evidenceAgainst: output.evidenceAgainst,
      unsupportedClaims: output.unsupportedClaims,
      decisiveEvidence: output.decisiveEvidence,
      publicReasoningTrace: output.publicReasoningTrace,
    };

    expect(validateTableVote(JSON.stringify(missingReasoning), ctx)).toMatchObject({
      ok: false,
    });
  });
});

describe("defaultDeadlines", () => {
  it("uses the table-vote deadline ladder for hosted and localnet claims", () => {
    const now = Date.parse("2026-09-02T00:00:00.000Z");

    expect(defaultDeadlines(now, "testnet")).toMatchObject({
      firstCommitDeadlineMs: now + 600_000,
      firstRevealDeadlineMs: now + 720_000,
      discussionDeadlineMs: now + 1_560_000,
      secondCommitDeadlineMs: now + 1_800_000,
      secondRevealDeadlineMs: now + 1_920_000,
    });
    expect(defaultDeadlines(now, "localnet")).toMatchObject({
      discussionDeadlineMs: now + 600_000,
      secondCommitDeadlineMs: now + 720_000,
      secondRevealDeadlineMs: now + 840_000,
    });
  });
});

describe("evidence artifact storage", () => {
  it("hides discovered artifacts from listings but retrieves them by id", async () => {
    const db = createDb({ dataDir: "memory://" });
    if (!(db instanceof PGlite)) throw new Error("expected pglite");
    databases.push(db);
    await migrate(db);
    const repository = createRepository(db);
    const submitted: EvidenceArtifactRecord = {
      evidenceId: "evidence-submitted",
      submissionId: "submission-submitted",
      claimId: "claim-storage",
      phase: 1,
      sourceUrl: "https://example.com/submitted",
      finalUrl: "https://example.com/submitted",
      mimeType: "text/markdown",
      byteLength: 16,
      contentHash: `0x${"11".repeat(32)}`,
      canonicalHash: `0x${"11".repeat(32)}`,
      rawWalrusBlobId: "raw-submitted",
      canonicalWalrusBlobId: "canonical-submitted",
      parserVersion: "test-v1",
      excerpt: "Submitted page",
      retrievedAt: "2026-08-29T00:00:00.000Z",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      sourceClass: "USER_SUBMITTED",
    };
    const discovered: EvidenceArtifactRecord = {
      ...submitted,
      evidenceId: "evidence-discovered",
      submissionId: "submission-discovered",
      sourceUrl: "https://example.com/discovered",
      finalUrl: "https://example.com/discovered",
      rawWalrusBlobId: "raw-discovered",
      canonicalWalrusBlobId: "canonical-discovered",
      sourceClass: "DISCOVERED",
      discoveredByRunId: `0x${"22".repeat(32)}`,
    };

    await repository.saveEvidenceArtifact(submitted);
    await repository.saveEvidenceArtifact(discovered);

    await expect(repository.listEvidenceArtifacts("claim-storage", 1)).resolves.toEqual([
      submitted,
    ]);
    await expect(
      repository.listEvidenceArtifacts("claim-storage", 1, {
        includeDiscovered: true,
      }),
    ).resolves.toEqual([discovered, submitted]);
    await expect(
      repository.getEvidenceArtifact(discovered.evidenceId),
    ).resolves.toEqual(discovered);
  });
});

describe("weather-aware submissions", () => {
  it("stores probes and shares the fresh cache with relaunches", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Fresh weather should serve both queues and relaunches.",
      urls: [],
    });
    await setup.engine.voidAttempt(claimId, {
      reason: "PROVIDER_ERROR",
      phase: 1,
    });
    const probe = vi.spyOn(setup.gonka, "probeModels");

    await setup.engine.weatherTick();
    await setup.engine.weatherTick();

    const rows = await createRepository(setup.db).listGonkaWeather();
    // Three families plus the research provider's row.
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.ok)).toBe(true);
    expect(rows.every((row) => row.status === "200")).toBe(true);
    expect(rows.some((row) => row.modelId === RESEARCH_WEATHER_ID)).toBe(true);
    await expect(setup.engine.weather()).resolves.toMatchObject({
      probedAtMs: setup.now(),
      stale: false,
      clear: true,
    });

    await setup.engine.relaunchTick();

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("validates before reading weather", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const weather = vi.spyOn(setup.engine, "weather");

    await expect(
      setup.engine.factCheckSubmit({ claim: "", urls: [] }),
    ).rejects.toThrow("claim must contain 1 to 32000 characters");

    expect(weather).not.toHaveBeenCalled();
  });

  it("derives family labels and marks down or old probes unclear", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const repository = createRepository(setup.db);
    const probedAt = new Date(setup.now()).toISOString();
    await repository.saveGonkaWeather([
      {
        modelId: "provider/DeepSeek-R1",
        ok: true,
        latencyMs: 10,
        status: "200",
        probedAt,
      },
      {
        modelId: "MiniMax-M2",
        ok: true,
        latencyMs: 20,
        status: "200",
        probedAt,
      },
      {
        modelId: "kimi-k2",
        ok: true,
        latencyMs: 30,
        status: "200",
        probedAt,
      },
    ]);

    const clear = await setup.engine.weather();
    expect(clear.clear).toBe(true);
    expect(clear.families.map((family) => family.family).sort()).toEqual([
      "deepseek",
      "kimi",
      "minimax",
    ]);

    await repository.saveGonkaWeather([
      {
        modelId: "MiniMax-M2",
        ok: false,
        latencyMs: 60_000,
        status: "TIMEOUT",
        probedAt,
      },
    ]);
    await expect(setup.engine.weather()).resolves.toMatchObject({
      stale: false,
      clear: false,
    });

    setup.setNow(setup.now() + WEATHER_STALE_MS + 1);
    await expect(setup.engine.weather()).resolves.toMatchObject({
      stale: true,
      clear: false,
    });
  });

  it("queues on fresh bad weather and launches on clear or unknown weather", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    setup.gonka.setWeather([{ modelId: "model-b", ok: false }]);
    await setup.engine.weatherTick();

    const queued = await setup.engine.factCheckSubmit({
      claim: "Known bad weather should hold this submission.",
      urls: [],
    });
    expect(queued.kind).toBe("queued");
    if (queued.kind !== "queued") throw new Error("expected a queued submission");
    expect(queued.queueId).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(setup.engine.getQueuedFactCheck(queued.queueId)).resolves.toMatchObject({
      queueId: queued.queueId,
      status: "QUEUED",
      statement: "Known bad weather should hold this submission.",
    });
    await expect(setup.engine.listQueuedFactChecks()).resolves.toHaveLength(1);

    setup.setNow(setup.now() + WEATHER_PROBE_INTERVAL_MS);
    setup.gonka.setWeather([{ modelId: "model-b", ok: true }]);
    await setup.engine.weatherTick();
    await expect(
      setup.engine.factCheckSubmit({
        claim: "Clear weather should launch this submission.",
        urls: [],
      }),
    ).resolves.toMatchObject({ kind: "claim" });

    setup.setNow(setup.now() + WEATHER_STALE_MS + 1);
    await expect(
      setup.engine.factCheckSubmit({
        claim: "Unknown weather should preserve immediate launch behavior.",
        urls: [],
      }),
    ).resolves.toMatchObject({ kind: "claim" });
  });

  it("launches the oldest queued claim at the launch spacing", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    setup.gonka.setWeather([{ modelId: "model-b", ok: false }]);
    await setup.engine.weatherTick();
    const first = await setup.engine.factCheckSubmit({
      claim: "The oldest queued submission launches first.",
      urls: [],
    });
    setup.setNow(setup.now() + 1);
    const second = await setup.engine.factCheckSubmit({
      claim: "The newer queued submission waits one minute.",
      urls: [],
    });
    if (first.kind !== "queued" || second.kind !== "queued") {
      throw new Error("expected queued submissions");
    }

    setup.setNow(setup.now() + WEATHER_PROBE_INTERVAL_MS);
    setup.gonka.setWeather([{ modelId: "model-b", ok: true }]);
    await setup.engine.weatherTick();
    await setup.engine.queueTick();
    await expect(setup.engine.getQueuedFactCheck(first.queueId)).resolves.toMatchObject({
      status: "LAUNCHED",
      claimId: expect.any(String),
    });
    await expect(setup.engine.getQueuedFactCheck(second.queueId)).resolves.toMatchObject({
      status: "QUEUED",
    });

    await setup.engine.queueTick();
    await expect(setup.engine.getQueuedFactCheck(second.queueId)).resolves.toMatchObject({
      status: "QUEUED",
    });

    setup.setNow(setup.now() + QUEUE_LAUNCH_SPACING_MS);
    // The worker refreshes the weather every tick; the spacing outlasts the stale window.
    await setup.engine.weatherTick();
    await setup.engine.queueTick();
    await expect(setup.engine.getQueuedFactCheck(second.queueId)).resolves.toMatchObject({
      status: "LAUNCHED",
      claimId: expect.any(String),
    });
  });

  it("holds submissions while the research provider is down", async () => {
    const research = createFakeResearchProvider({ probeOk: false });
    const setup = await engineSetup(new FakeSuiGateway(), 5, { research });
    setup.gonka.setWeather([{ modelId: "model-b", ok: true }]);
    await setup.engine.weatherTick();
    const weather = await setup.engine.weather();
    expect(weather.clear).toBe(false);
    expect(
      weather.families.find((family) => family.family === "research"),
    ).toMatchObject({ ok: false, status: "402" });

    const submission = await setup.engine.factCheckSubmit({
      claim: "No web search means no jury for now.",
      urls: [],
    });
    expect(submission.kind).toBe("queued");

    research.setProbeOk(true);
    setup.setNow(setup.now() + WEATHER_PROBE_INTERVAL_MS);
    await setup.engine.weatherTick();
    expect((await setup.engine.weather()).clear).toBe(true);
  });

  it("expires queued submissions after six hours", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    setup.gonka.setWeather([{ modelId: "model-b", ok: false }]);
    await setup.engine.weatherTick();
    const queued = await setup.engine.factCheckSubmit({
      claim: "A queue entry must not wait forever.",
      urls: [],
    });
    if (queued.kind !== "queued") throw new Error("expected a queued submission");

    setup.setNow(setup.now() + QUEUE_TTL_MS);
    await setup.engine.queueTick();

    await expect(setup.engine.getQueuedFactCheck(queued.queueId)).resolves.toMatchObject({
      status: "EXPIRED",
    });
  });

  it("cancels requests that no longer pass launch validation", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    await setup.engine.weatherTick();
    const now = new Date(setup.now()).toISOString();
    const item: FactCheckQueueRecord = {
      queueId: `0x${"33".repeat(32)}`,
      status: "QUEUED",
      request: { claim: "", urls: [] },
      holdReason: "WEATHER",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(setup.now() + QUEUE_TTL_MS).toISOString(),
    };
    const repository = createRepository(setup.db);
    await repository.saveFactCheckQueueItem(item);

    await setup.engine.queueTick();

    await expect(repository.getFactCheckQueueItem(item.queueId)).resolves.toMatchObject({
      status: "CANCELLED",
      launchError: "claim must contain 1 to 32000 characters",
    });
  });

  it("keeps transient launch failures queued for a later tick", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    await setup.engine.weatherTick();
    const now = new Date(setup.now()).toISOString();
    const item: FactCheckQueueRecord = {
      queueId: `0x${"44".repeat(32)}`,
      status: "QUEUED",
      request: { claim: "A transient failure should be retried.", urls: [] },
      holdReason: "WEATHER",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(setup.now() + QUEUE_TTL_MS).toISOString(),
    };
    const repository = createRepository(setup.db);
    await repository.saveFactCheckQueueItem(item);
    const start = vi
      .spyOn(setup.engine, "factCheckStart")
      .mockRejectedValueOnce(new Error("temporary launch failure"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await setup.engine.queueTick();

    await expect(repository.getFactCheckQueueItem(item.queueId)).resolves.toMatchObject({
      status: "QUEUED",
      launchError: "temporary launch failure",
    });
    expect(stderr).toHaveBeenCalled();
    start.mockRestore();
    stderr.mockRestore();

    await setup.engine.queueTick();

    const launched = await repository.getFactCheckQueueItem(item.queueId);
    expect(launched).toMatchObject({
      status: "LAUNCHED",
      launchedClaimId: expect.any(String),
    });
    expect(launched).not.toHaveProperty("launchError");
  });
});

describe("verification attempt lifecycle", () => {
  it("creates an active first attempt for a fact check", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Every fact check starts a visible verification attempt.",
      urls: [],
    });
    const repository = createRepository(setup.db);

    await expect(repository.getVerificationAttempt(claimId)).resolves.toMatchObject({
      verificationId: claimId,
      claimId,
      attempt: 1,
      status: "ACTIVE",
    });
    await expect(setup.engine.inspect(claimId)).resolves.toMatchObject({
      attemptChain: {
        verificationId: claimId,
        attempt: 1,
        maxAttempts: 3,
        status: "ACTIVE",
        previousAttempts: [],
      },
    });
  });

  it("voids a research attempt when one seat fails", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5, {
      failures: { 0: "provider_5xx" },
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A failed binding jury seat voids the whole attempt.",
      text: "Local evidence for the failure-path test.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);

    const repository = createRepository(setup.db);
    const failedRun = (await repository.listInferenceRuns(claimId, 1)).find(
      (run) => run.failure !== undefined,
    );
    if (!failedRun) throw new Error("expected a failed inference run");
    await expect(repository.getVerificationAttempt(claimId)).resolves.toMatchObject({
      status: "VOIDED",
      voidReason: failedRun.failure?.status,
      voidedSeatId: failedRun.jurySeatId,
      voidedModelId: failedRun.modelId,
      voidedPhase: 1,
    });
    const events = await repository.listResolutionEvents(claimId, 1);
    expect(events.filter((event) => event.kind === "verification_voided")).toHaveLength(1);

    const inspection = await setup.engine.inspect(claimId);
    expect(inspection.attemptChain?.status).toBe("VOIDED");
    expect(isVoidedAttempt(inspection)).toBe(true);
    expect(isDead(inspection, setup.now())).toBe(true);
  });

  it("adopts a next attempt created by an earlier partial relaunch instead of launching twice", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const request = {
      claim: "A partial relaunch must not create a second attempt.",
      urls: [] as string[],
    };
    const { claimId } = await setup.engine.factCheckStart(request);
    await setup.engine.voidAttempt(claimId, { reason: "PROVIDER_ERROR", phase: 1 });
    const repository = createRepository(setup.db);
    // Simulate a tick that created attempt 2 and failed before linking it.
    const { claimId: nextClaimId } = await setup.engine.factCheckStart(request, {
      verificationId: claimId,
      attempt: 2,
      parentClaimId: claimId,
    });
    const first = await repository.getVerificationAttempt(claimId);
    // The link is written the moment the relaunched claim exists.
    expect(first?.relaunchedAs).toBe(nextClaimId);
    await repository.saveVerificationAttempt({
      ...first!,
      relaunchedAs: undefined,
    });
    expect((await repository.getVerificationAttempt(claimId))?.relaunchedAs).toBeUndefined();

    await setup.engine.relaunchTick();

    const attempts = await repository.listVerificationAttempts(claimId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.relaunchedAs).toBe(nextClaimId);
  });

  it("relaunches a voided attempt once when every model is healthy", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const request = {
      claim: "A healthy model fleet permits the same verification.",
      text: "The submitted context must survive the relaunch.",
      urls: [] as string[],
    };
    const { claimId } = await setup.engine.factCheckStart(request);
    await setup.engine.voidAttempt(claimId, { reason: "PROVIDER_ERROR", phase: 1 });

    await setup.engine.relaunchTick();

    const repository = createRepository(setup.db);
    const attempts = await repository.listVerificationAttempts(claimId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      claimId,
      attempt: 1,
      status: "VOIDED",
      relaunchedAs: attempts[1]?.claimId,
    });
    expect(attempts[1]).toMatchObject({
      verificationId: claimId,
      attempt: 2,
      parentClaimId: claimId,
      status: "ACTIVE",
    });
    const relaunchedClaim = await repository.getClaim(attempts[1]!.claimId);
    expect(relaunchedClaim).toMatchObject({
      statement: request.claim,
      submittedText: request.text,
      submittedUrls: request.urls,
    });
    const firstEvents = await repository.listResolutionEvents(claimId, 1);
    expect(
      firstEvents.filter((event) => event.kind === "verification_relaunched"),
    ).toHaveLength(1);

    await setup.engine.relaunchTick();

    await expect(repository.listVerificationAttempts(claimId)).resolves.toHaveLength(2);
    const secondEvents = await repository.listResolutionEvents(claimId, 1);
    expect(
      secondEvents.filter((event) => event.kind === "verification_relaunched"),
    ).toHaveLength(1);
  });

  it("gives up after unhealthy weather exceeds the relaunch window", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A persistently unavailable model family eventually stops retries.",
      urls: [],
    });
    setup.gonka.setWeather([{ modelId: "model-b", ok: false }]);
    await setup.engine.voidAttempt(claimId, { reason: "TIMEOUT", phase: 1 });

    await setup.engine.relaunchTick();

    const repository = createRepository(setup.db);
    await expect(repository.listVerificationAttempts(claimId)).resolves.toHaveLength(1);
    const voided = await repository.getVerificationAttempt(claimId);
    expect(voided?.status).toBe("VOIDED");
    expect(voided?.relaunchedAs).toBeUndefined();

    setup.setNow(setup.now() + RELAUNCH_GIVE_UP_MS + 1);
    await setup.engine.relaunchTick();

    await expect(repository.getVerificationAttempt(claimId)).resolves.toMatchObject({
      status: "GAVE_UP",
      gaveUpReason: "WEATHER_TIMEOUT",
    });
    const events = await repository.listResolutionEvents(claimId, 1);
    expect(events.filter((event) => event.kind === "verification_gave_up")).toHaveLength(1);
  });

  it("gives up an exhausted third attempt without probing weather", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A third failed attempt cannot launch a fourth claim.",
      urls: [],
    });
    const repository = createRepository(setup.db);
    const attempt = await repository.getVerificationAttempt(claimId);
    if (!attempt) throw new Error("expected a verification attempt");
    await repository.saveVerificationAttempt({
      ...attempt,
      attempt: 3,
      status: "VOIDED",
      voidReason: "PROVIDER_ERROR",
      voidedAt: new Date(setup.now()).toISOString(),
      updatedAt: new Date(setup.now()).toISOString(),
    });
    const probe = vi.spyOn(setup.gonka, "probeModels");

    await setup.engine.relaunchTick();

    await expect(repository.getVerificationAttempt(claimId)).resolves.toMatchObject({
      status: "GAVE_UP",
      gaveUpReason: "ATTEMPTS_EXHAUSTED",
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("marks the attempt settled after finalization", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A finalized claim settles its verification attempt.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);
    await setup.engine.votesReveal(claimId, 1);
    await setup.engine.finalize(claimId);

    await expect(
      createRepository(setup.db).getVerificationAttempt(claimId),
    ).resolves.toMatchObject({ status: "SETTLED" });
  });
});

describe("headless engine", () => {
  it("runs a statement-only fact check through the full lifecycle", async () => {
    const statement = "The claim statement is sufficient to begin juror research.";
    const gateway = new FakeSuiGateway();
    const finalize = gateway.finalize.bind(gateway);
    vi.spyOn(gateway, "finalize").mockImplementation(async (input) => {
      const result = await finalize(input);
      const payoutTickets = gateway.agents.map((agent) => ({
        payoutTicketId: fakeId(`payout:${input.claimId}:${agent.agentProfileId}`),
        recipient: agent.owner,
        amount: "1",
        reason: 2,
      }));
      return {
        ...result,
        payoutTicketIds: payoutTickets.map((ticket) => ticket.payoutTicketId),
        payoutTickets,
      };
    });
    const setup = await engineSetup(gateway, 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: statement,
      urls: [],
    });
    const repository = createRepository(setup.db);
    const artifacts = await repository.listEvidenceArtifacts(claimId, 1);
    const expectedEvidenceId = toHex(
      blake2b256(
        new TextEncoder().encode(`statement:${claimId}:1`),
      ),
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      evidenceId: expectedEvidenceId,
      sourceUrl: "urn:openverdict:claim-statement",
      finalUrl: "urn:openverdict:claim-statement",
      mimeType: "text/plain",
      parserVersion: "utf8-text-v1",
      excerpt: statement,
      sourceClass: "USER_SUBMITTED",
    });

    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const manifest = await repository.getEvidenceManifest(claimId, 1);
    if (!manifest) throw new Error("expected a frozen evidence manifest");
    const frozenManifest = JSON.parse(
      new TextDecoder().decode(await setup.walrus.get(manifest.manifestBlobId)),
    ) as { items: Array<{ evidenceId: string; sourceUrl: string }> };
    expect(frozenManifest.items).toEqual([
      expect.objectContaining({
        evidenceId: expectedEvidenceId,
        sourceUrl: "urn:openverdict:claim-statement",
      }),
    ]);

    const jury = await setup.engine.juryRun(claimId, 1);
    expect(jury.runs).toHaveLength(5);
    expect(jury.runs.every((run) => run.status === "SCHEMA_VALID")).toBe(true);
    const firstRequest = setup.gonkaComplete.mock.calls[0]?.[0];
    if (!firstRequest) throw new Error("expected a model request");
    expect(firstRequest.input.evidenceManifest.items[0]?.excerpt).toBe(statement);
    expect(firstRequest.input).not.toHaveProperty("priorRound");
    const serializedInput = JSON.parse(
      firstRequest.messages[1]?.content ?? "null",
    ) as Record<string, unknown>;
    expect(serializedInput).toEqual(firstRequest.input);
    expect(serializedInput).not.toHaveProperty("priorRound");
    const recordedRun = (await repository.listInferenceRuns(claimId, 1)).find(
      (run) => run.runId === firstRequest.input.runId,
    );
    expect(recordedRun?.inputHash).toBe(
      toHex(blake2b256(canonicalJsonBytes(firstRequest.input))),
    );

    expect(await setup.engine.votesCommit(claimId, 1)).toHaveLength(5);
    const tally = await repository.getRoundTally(claimId, 1);
    if (!tally) throw new Error("expected the first round tally");
    expect(gateway.allSeatsCommitted(tally.roundTallyId)).toBe(true);
    await setup.engine.advance(claimId);
    expect(await setup.engine.votesReveal(claimId, 1)).toHaveLength(5);
    expect(gateway.allSeatsRevealed(tally.roundTallyId)).toBe(true);
    await expect(setup.engine.finalize(claimId)).resolves.toMatchObject({
      claimId,
      result: "YES",
    });

    const participatingAgentIds = new Set(
      jury.runs.map((run) => run.agentProfileId),
    );
    const participatingAgents = (await setup.engine.listAgents()).filter((agent) =>
      participatingAgentIds.has(agent.agentProfileId),
    );
    expect(participatingAgents).toHaveLength(5);
    for (const agent of participatingAgents) {
      expect(agent.backing).toEqual({ kind: "UNKNOWN", label: "test-only" });
      expect(agent.trackRecord).toEqual({
        seatsServed: 1,
        committed: 1,
        revealed: 1,
        agreedWithCertificate: 1,
      });
      expect(BigInt(agent.earnedMist)).toBeGreaterThan(0n);
    }
  });

  it("resumes a committee selection that crashed mid seat write", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Committee recovery statement for the torn selection test.",
      urls: [],
    });
    const repository = createRepository(setup.db);

    // Crash the first selection on its last seat write: committee and tally
    // rows persist, one seat row is missing, the claim never reaches COMMIT_1.
    const originalSaveJurySeat = Repository.prototype.saveJurySeat;
    let seatWrites = 0;
    const seatSpy = vi
      .spyOn(Repository.prototype, "saveJurySeat")
      .mockImplementation(async function (
        this: Repository,
        record: Parameters<Repository["saveJurySeat"]>[0],
      ) {
        seatWrites += 1;
        if (seatWrites === 5) {
          throw new Error("simulated crash before the last seat write");
        }
        return originalSaveJurySeat.call(this, record);
      });
    try {
      await expect(setup.engine.selectCommittee(claimId)).rejects.toThrow(
        "simulated crash before the last seat write",
      );
    } finally {
      seatSpy.mockRestore();
    }
    expect(await repository.listJurySeats(claimId, 1)).toHaveLength(4);
    expect((await setup.engine.inspect(claimId)).state).not.toBe(CLAIM_STATE.COMMIT_1);

    // The retry must finish the interrupted writes instead of no-opping on
    // the existing committee row.
    await setup.engine.selectCommittee(claimId);
    expect(await repository.listJurySeats(claimId, 1)).toHaveLength(5);
    expect((await setup.engine.inspect(claimId)).state).toBe(CLAIM_STATE.COMMIT_1);
  });

  it("warms revealed run proofs sequentially without failing finalization", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Finalization should warm every revealed public proof.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);
    await setup.engine.votesReveal(claimId, 1);

    const repository = createRepository(setup.db);
    const reveals = await repository.listReveals(claimId, 1);
    const failedRunId = reveals[0]?.runId;
    if (!failedRunId) throw new Error("expected revealed runs");
    const expectedProofIds = reveals
      .slice(1)
      .map((reveal) => reveal.runId)
      .sort();
    const originalRunProof = setup.engine.runProof.bind(setup.engine);
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    vi.spyOn(setup.engine, "runProof").mockImplementation(
      async (proofClaimId, proofRunId) => {
        activeBuilds += 1;
        maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
        try {
          if (proofRunId === failedRunId) throw new Error("proof build failed");
          return await originalRunProof(proofClaimId, proofRunId);
        } finally {
          activeBuilds -= 1;
        }
      },
    );
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    try {
      await expect(setup.engine.finalize(claimId)).resolves.toMatchObject({
        claimId,
        result: "YES",
      });
      await vi.waitFor(async () => {
        await expect(
          repository.listRunProofIdsForClaim(claimId),
        ).resolves.toEqual(expectedProofIds);
      });
      expect(maxActiveBuilds).toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(`run proof warm: claim ${claimId} run ${failedRunId}`),
      );
    } finally {
      stderr.mockRestore();
    }
  });

  it("publishes content-free research ticks through the engine event stream", async () => {
    const statement = "Research ticks must never reveal this query.";
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: statement,
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);

    const repository = createRepository(setup.db);
    const events = await repository.listResolutionEvents(claimId, 1);
    const ticks = events.filter((event) => event.kind === "RESEARCH_TICK");

    expect(ticks).toHaveLength(10);
    for (const tick of ticks) {
      expect(tick.source).toBe("ENGINE");
      expect(tick.visibility).toBe("PUBLIC_NOW");
      expect(Object.keys(tick.payload).sort()).toEqual([
        "jurySeatId",
        "kind",
        "ordinal",
      ]);
      const values = Object.values(tick.payload).map(String);
      expect(values.some((value) => value.includes(statement))).toBe(false);
      expect(values.some((value) => /https?:\/\//i.test(value))).toBe(false);
    }
  });

  it("uses a typed error when evidence freeze has no accepted artifact", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const start = Date.parse("2026-08-27T00:00:00.000Z");
    const { claimId } = await setup.engine.claimCreate({
      statement: "A claim created without evidence cannot freeze yet.",
      resolutionCriteria: "Resolve from accepted evidence.",
      mode: CLAIM_MODE.DIRECT_REVIEW,
      deadlines: {
        evidenceCutoffMs: start + 1,
        proposalDeadlineMs: start + 2,
        challengeDeadlineMs: start + 3,
        firstCommitDeadlineMs: start + 4,
        firstRevealDeadlineMs: start + 5,
        discussionDeadlineMs: start + 6,
        secondCommitDeadlineMs: start + 7,
        secondRevealDeadlineMs: start + 8,
      },
      committeeBudget: "1",
      evidenceBudget: "0",
    });

    await expect(
      setup.engine.evidenceFreeze(claimId, 1),
    ).rejects.toBeInstanceOf(EngineNoEvidenceError);
    await expect(
      setup.engine.evidenceFreeze(claimId, 1),
    ).rejects.toThrow("evidence cannot be frozen without an accepted artifact");
  });

  it("fails closed before provider calls when a manifest prompt hash differs", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5, {
      promptHash: `0x${"ab".repeat(32)}`,
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Prompt binding must fail closed.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);

    let thrown: unknown;
    try {
      await setup.engine.juryRun(claimId, 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EngineValidationError);
    expect((thrown as Error).message).toContain("prompt hash");
    expect((thrown as Error).message).toContain("publish-agent-manifests");
    expect(setup.gonkaComplete).not.toHaveBeenCalled();
  });

  it("fails closed before provider calls when a v4 document prompt hash differs", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A v4 manifest document must bind its prompt hash.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const repository = createRepository(setup.db);
    const agents = await repository.listAgentManifests();

    for (const [index, agent] of agents.entries()) {
      const built = buildAgentManifestDocument({
        network: "localnet",
        backingKind: "TESTNET_DEMO_ALLOWLIST",
        humanBackingHash: agent.manifest.humanAttestationHash,
        humanVerificationProvider: agent.manifest.humanVerificationProvider,
        operationalOwner: agent.manifest.owner,
        role: agent.role,
        modelId: agent.manifest.modelId,
        promptSpec: DEFAULT_PROMPT_SPEC_V3,
        toolPolicy: DEFAULT_TOOL_POLICY_V3,
        evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
      });
      const upload = await setup.walrus.put(built.bytes, {
        identifier: `agent-${index}-manifest-v4.json`,
      });
      await repository.saveAgentManifest({
        ...agent,
        manifest: {
          ...agent.manifest,
          version: built.document.version,
          manifestBlobId: upload.blobId,
          manifestHash: built.manifestHash,
          promptHash:
            index === 0 ? `0x${"ab".repeat(32)}` : built.promptHash,
          toolPolicyHash: built.toolPolicyHash,
          evidencePolicyHash: built.document.evidencePolicyHash,
          registeredCheckpoint: agent.manifest.registeredCheckpoint + 1,
        },
      });
    }

    await expect(setup.engine.juryRun(claimId, 1)).rejects.toThrow(
      /manifest prompt hash does not match its prompt document/,
    );
    expect(setup.gonkaComplete).not.toHaveBeenCalled();
  });

  it("selects v4 research from v5 documents and seals bundle core v5", async () => {
    const gateway = new FakeSuiGateway();
    const outcomes = Array.from(
      { length: 5 },
      () => "UNSURE" as const,
    );
    const setup = await engineSetup(gateway, [outcomes], {
      actions: [],
      decisiveEvidence: [],
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A v5 manifest selects batched research policy v4.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const repository = createRepository(setup.db);
    const agents = await repository.listAgentManifests();

    for (const [index, agent] of agents.entries()) {
      const built = buildAgentManifestDocument({
        network: "localnet",
        backingKind: "TESTNET_DEMO_ALLOWLIST",
        humanBackingHash: agent.manifest.humanAttestationHash,
        humanVerificationProvider: agent.manifest.humanVerificationProvider,
        operationalOwner: agent.manifest.owner,
        role: agent.role,
        modelId: agent.manifest.modelId,
        promptSpec: DEFAULT_PROMPT_SPEC_V4,
        toolPolicy: DEFAULT_TOOL_POLICY_V4,
        evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
      });
      const upload = await setup.walrus.put(built.bytes, {
        identifier: `agent-${index}-manifest-v5.json`,
      });
      await repository.saveAgentManifest({
        ...agent,
        manifest: {
          ...agent.manifest,
          version: built.document.version,
          manifestBlobId: upload.blobId,
          manifestHash: built.manifestHash,
          promptHash: built.promptHash,
          toolPolicyHash: built.toolPolicyHash,
          evidencePolicyHash: built.document.evidencePolicyHash,
          registeredCheckpoint: agent.manifest.registeredCheckpoint + 1,
        },
      });
    }

    const jury = await setup.engine.juryRun(claimId, 1);
    expect(jury.runs).toHaveLength(5);
    expect(jury.runs.every((run) => run.status === "SCHEMA_VALID")).toBe(true);
    const records = await repository.listInferenceRuns(claimId, 1);
    const cores = records.map((record) =>
      JSON.parse(record.audit.bundleCore ?? "null") as PublicRunBundleCoreV5,
    );
    expect(cores.every((core) => core.version === 5)).toBe(true);
    expect(cores.every((core) => core.promptSpec.version === "4")).toBe(true);
    expect(cores.every((core) => core.toolPolicy.version === "4")).toBe(true);
    expect(
      setup.gonkaComplete.mock.calls.every(
        ([request]) =>
          !("kind" in request.input) && request.input.promptVersion === "4",
      ),
    ).toBe(true);
  });

  it("fails closed when a manifest tool policy hash differs", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5, {
      toolPolicyHash: `0x${"cd".repeat(32)}`,
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Tool policy binding must fail closed.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);

    await expect(setup.engine.juryRun(claimId, 1)).rejects.toThrow(
      /manifest tool policy hash.*engine tool policy/,
    );
    expect(setup.gonkaComplete).not.toHaveBeenCalled();
  });

  it("sends Sui retention epochs on chain when the Walrus store has a clock", async () => {
    // A real store reports Walrus epochs (here 240, blobs kept until 250);
    // the chain compares with its own epoch (900), so it must receive 910.
    const directory = await mkdtemp(join(tmpdir(), "openverdict-epoch-"));
    const base = createLocalWalrusStore(join(directory, "walrus"));
    const walrus: WalrusStore = {
      put: async (bytes, opts) => ({ ...(await base.put(bytes, opts)), endEpoch: 250 }),
      get: (blobId) => base.get(blobId),
      epochInfo: async () => ({ currentEpoch: 240, epochDurationMs: 86_400_000 }),
    };
    const gateway = new FakeSuiGateway();
    gateway.epoch = { currentEpoch: 900, epochDurationMs: 86_400_000 };
    const freeze = vi.spyOn(gateway, "freezeEvidence");
    const approve = vi.spyOn(gateway, "approveRun");
    const reveal = vi.spyOn(gateway, "revealVote");
    const setup = await engineSetup(gateway, 5, { walrus });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Retention epochs are converted before they reach the chain.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);
    await setup.engine.votesReveal(claimId, 1);
    await expect(setup.engine.finalize(claimId)).resolves.toMatchObject({
      claimId,
      result: "YES",
    });

    expect(freeze).toHaveBeenCalledWith(expect.objectContaining({ walrusEndEpoch: 910 }));
    expect(approve).toHaveBeenCalledTimes(5);
    for (const [input] of approve.mock.calls) {
      expect(input.walrusEndEpoch).toBe(910);
    }
    expect(reveal).toHaveBeenCalledTimes(5);
    for (const [input] of reveal.mock.calls) {
      expect(input.argumentWalrusEndEpoch).toBe(910);
    }
    const chainEpochs = [
      freeze.mock.calls[0]?.[0].walrusEndEpoch,
      ...approve.mock.calls.map(([input]) => input.walrusEndEpoch),
      ...reveal.mock.calls.map(([input]) => input.argumentWalrusEndEpoch),
    ];
    expect(
      chainEpochs.every((epoch) => typeof epoch === "number" && epoch >= 900),
    ).toBe(true);

    const repository = createRepository(setup.db);
    const record = (await repository.listInferenceRuns(claimId, 1))[0];
    // The database keeps the Walrus epoch for renewals.
    expect(record?.walrusEndEpoch).toBe(250);
    expect((await repository.getEvidenceManifest(claimId, 1))?.walrusEndEpoch).toBe(250);
  });

  it("hands a research page to the model before its Walrus upload finishes and seals only after it lands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openverdict-deferred-"));
    const base = createLocalWalrusStore(join(directory, "walrus"));
    const events: string[] = [];
    let releaseUpload: () => void = () => undefined;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    // Discovered page writes are held back until the test releases them.
    const walrus: WalrusStore = {
      put: async (bytes, opts) => {
        if (opts?.identifier?.endsWith("-discovered.md")) {
          events.push("upload-started");
          await uploadGate;
          events.push("upload-finished");
        }
        return base.put(bytes, opts);
      },
      get: (blobId) => base.get(blobId),
      blobIdFor: (bytes) => {
        if (!base.blobIdFor) throw new Error("local store lacks blobIdFor");
        return base.blobIdFor(bytes);
      },
    };
    const gateway = new FakeSuiGateway();
    const approve = vi.spyOn(gateway, "approveRun");
    const setup = await engineSetup(gateway, 5, { walrus });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Pages reach the model before their upload lands.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const running = setup.engine.juryRun(claimId, 1);

    // The answer turn (the request carrying the open tool result) must be
    // requested while the page upload is still held back. The request holds
    // the loop's live message array, so any message may carry the result.
    await vi.waitFor(() => {
      expect(
        setup.gonkaComplete.mock.calls.some(([request]) =>
          request.messages.some((message) => message.content.includes('"tool":"open"')),
        ),
      ).toBe(true);
    });
    expect(events).toEqual(["upload-started"]);
    expect(approve).not.toHaveBeenCalled();

    releaseUpload();
    await running;
    expect(events).toEqual(["upload-started", "upload-finished"]);
    expect(approve).toHaveBeenCalledTimes(5);
    const repository = createRepository(setup.db);
    const record = (await repository.listInferenceRuns(claimId, 1))[0];
    const core = JSON.parse(record?.audit.bundleCore ?? "{}") as PublicRunBundleCoreV3;
    const opened = core.transcript.opened[0];
    if (!opened) throw new Error("expected an opened research page");
    // The transcript cites the content address the background write produced.
    await expect(repository.getEvidenceArtifact(opened.evidenceId)).resolves.toMatchObject({
      canonicalWalrusBlobId: opened.canonicalWalrusBlobId,
      sourceClass: "DISCOVERED",
    });
  });

  it("fails a seat closed when the upload of a page it opened fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openverdict-upload-fail-"));
    const base = createLocalWalrusStore(join(directory, "walrus"));
    const walrus: WalrusStore = {
      put: async (bytes, opts) => {
        if (opts?.identifier?.endsWith("-discovered.md")) {
          throw new Error("storage nodes unavailable");
        }
        return base.put(bytes, opts);
      },
      get: (blobId) => base.get(blobId),
      blobIdFor: (bytes) => {
        if (!base.blobIdFor) throw new Error("local store lacks blobIdFor");
        return base.blobIdFor(bytes);
      },
    };
    const gateway = new FakeSuiGateway();
    const approve = vi.spyOn(gateway, "approveRun");
    const setup = await engineSetup(gateway, 5, { walrus });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A lost page upload must not become a vote.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const jury = await setup.engine.juryRun(claimId, 1);

    expect(jury.runs).toHaveLength(5);
    expect(approve).not.toHaveBeenCalled();
    const repository = createRepository(setup.db);
    const runs = await repository.listInferenceRuns(claimId, 1);
    expect(runs.map((run) => run.validationStatus)).toEqual(
      Array.from({ length: 5 }, () => "PROVIDER_ERROR"),
    );
  });

  it("runs when every manifest binds the live prompt spec", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Prompt binding matches the live spec.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);

    await expect(setup.engine.juryRun(claimId, 1)).resolves.toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ status: "SCHEMA_VALID" }),
      ]),
    });
    expect(setup.gonkaComplete).toHaveBeenCalledTimes(15);
  });

  it("records a research transcript inside the sealed core and cites the sealed blob as the tool blob", async () => {
    const gateway = new FakeSuiGateway();
    const approve = vi.spyOn(gateway, "approveRun");
    const setup = await engineSetup(gateway, 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Research transcripts bind every opened source.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const jury = await setup.engine.juryRun(claimId, 1);
    const summary = jury.runs[0];
    if (!summary) throw new Error("expected a jury run");

    const repository = createRepository(setup.db);
    const record = (await repository.listInferenceRuns(claimId, 1)).find(
      (candidate) => candidate.runId === summary.runId,
    );
    if (!record?.audit.bundleCore || !record.sealedBlobId) {
      throw new Error("expected a sealed run with a persisted core");
    }
    const core = JSON.parse(record.audit.bundleCore) as PublicRunBundleCoreV3;
    const opened = core.transcript.opened[0];
    if (!opened) throw new Error("expected one opened research page");

    expect(core.version).toBe(3);
    expect(record.audit.toolCallCount).toBe(2);
    expect(record.toolTranscriptHash).toBe(transcriptHash(core.transcript));
    expect(opened.evidenceId).toMatch(/^0x/);
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        jurySeatId: record.jurySeatId,
        runBlobId: record.sealedBlobId,
        toolBlobId: record.sealedBlobId,
      }),
    );
    await expect(
      repository.getEvidenceArtifact(opened.evidenceId),
    ).resolves.toMatchObject({ sourceClass: "DISCOVERED" });
    expect(
      await repository.listEvidenceArtifacts(claimId, 1),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: opened.evidenceId }),
      ]),
    );
    const requestsForRun = setup.gonkaComplete.mock.calls
      .map(([request]) => request)
      .filter((request) => request.input.runId === summary.runId);
    expect(requestsForRun).toHaveLength(3);
    expect(
      requestsForRun.every((request) =>
        request.input.evidenceManifest.items.every(
          (item) => item.sourceClass === "USER_SUBMITTED",
        ),
      ),
    ).toBe(true);
  });

  it("seals each run before commit and publishes plaintext only at reveal", async () => {
    const gateway = new FakeSuiGateway();
    const approve = vi.spyOn(gateway, "approveRun");
    const reveal = vi.spyOn(gateway, "revealVote");
    const sealPolicy: SealEscrowService["policy"] = {
      packageId: `0x${"77".repeat(32)}`,
      threshold: 1,
      keyServers: [{ objectId: `0x${"88".repeat(32)}`, weight: 1 }],
    };
    const escrowKey = vi.fn<SealEscrowService["escrowKey"]>(async (params) => ({
      version: 1,
      provider: "seal",
      packageId: sealPolicy.packageId,
      identityHex: sealIdentityHex(params),
      deadlineMs: params.deadlineMs,
      threshold: sealPolicy.threshold,
      keyServers: sealPolicy.keyServers,
      encryptedObjectBase64: "c2VhbC1lbmNyeXB0ZWQ=",
      aad: params.runId,
    }));
    const setup = await engineSetup(gateway, 5, {
      seal: sealPolicy,
      sealEscrow: { policy: sealPolicy, escrowKey },
    });
    const put = vi.spyOn(setup.walrus, "put");
    const { claimId } = await setup.engine.factCheckStart({
      claim: "The run proof exposes every bound hash.",
      text: "Local evidence.",
      urls: [],
    });
    const claim = await setup.engine.inspect(claimId);
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const jury = await setup.engine.juryRun(claimId, 1);
    const run = jury.runs[0];
    if (!run) throw new Error("expected a jury run");
    expect(escrowKey).toHaveBeenCalledTimes(5);
    expect(escrowKey).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId,
        phase: 1,
        deadlineMs: claim.deadlines.firstRevealDeadlineMs,
        runId: run.runId,
        keyBytes: expect.any(Uint8Array),
      }),
    );

    const record = (await createRepository(setup.db).listInferenceRuns(claimId, 1))
      .find((candidate) => candidate.runId === run.runId);
    if (
      !record?.sealedBlobId ||
      !record.sealKeyHex ||
      !record.sealIvHex ||
      !record.coreHash ||
      !record.audit.bundleCore ||
      !record.toolTranscriptWalrusBlobId ||
      !record.output
    ) {
      throw new Error("expected persisted run seal metadata");
    }
    const storedCore = JSON.parse(
      record.audit.bundleCore,
    ) as PublicRunBundleCoreV3;
    const openedPage = storedCore.transcript.opened[0];
    if (!openedPage) throw new Error("expected an opened research page");
    const runWrites = put.mock.calls.filter(([, options]) =>
      options?.identifier === `${run.runId}-sealed-run-bundle.json` ||
      options?.identifier === `${openedPage.evidenceId}-discovered.md`,
    );
    expect(runWrites).toHaveLength(2);
    expect(
      runWrites.map(([, options]) => options?.identifier).sort(),
    ).toEqual(
      [
        `${run.runId}-sealed-run-bundle.json`,
        `${openedPage.evidenceId}-discovered.md`,
      ].sort(),
    );
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        jurySeatId: record.jurySeatId,
        runBlobId: record.sealedBlobId,
        toolBlobId: record.sealedBlobId,
      }),
    );
    const validatedOutcomeText = record.output.reasoning;
    for (const [bytes] of put.mock.calls) {
      expect(new TextDecoder().decode(bytes)).not.toContain(validatedOutcomeText);
    }

    const proofBeforeReveal = await setup.engine.runProof(claimId, run.runId);
    expect(proofBeforeReveal).toMatchObject({
      runId: run.runId,
      claimId,
      phase: 1,
      promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V2),
      sealedBlobId: record.sealedBlobId,
      revealedBlobId: null,
      revealed: false,
      bundle: null,
      claimDeadlines: {
        firstRevealDeadlineMs: claim.deadlines.firstRevealDeadlineMs,
        secondRevealDeadlineMs: claim.deadlines.secondRevealDeadlineMs,
      },
      sealPolicy,
      sealed: {
        version: 2,
        kind: "sealed-run-bundle",
        runId: run.runId,
        escrow: {
          provider: "seal",
          deadlineMs: claim.deadlines.firstRevealDeadlineMs,
          aad: run.runId,
        },
      },
      gateway: {
        gatewayRequestId: expect.stringMatching(/^request_/),
        devshardId: expect.stringMatching(/^devshard-fake-/),
        systemFingerprint: "fake-system-fingerprint",
      },
    });
    const sealed = JSON.parse(
      new TextDecoder().decode(await setup.walrus.get(record.sealedBlobId)),
    ) as SealedRunBundleV2;
    expect(sealed).toMatchObject({
      version: 2,
      kind: "sealed-run-bundle",
      runId: run.runId,
      coreHash: record.coreHash,
      escrow: {
        packageId: sealPolicy.packageId,
        threshold: sealPolicy.threshold,
        keyServers: sealPolicy.keyServers,
      },
    });
    if (!sealed.escrow) throw new Error("expected a Seal escrow");
    expect(parseSealIdentity(sealed.escrow.identityHex)).toEqual({
      claimId,
      jurySeatId: record.jurySeatId,
      phase: 1,
      deadlineMs: claim.deadlines.firstRevealDeadlineMs,
    });
    expect(
      openSealedRunBundle(sealed, {
        keyHex: record.sealKeyHex,
        ivHex: record.sealIvHex,
        aad: run.runId,
      }),
    ).toEqual(storedCore);

    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);
    expect(await setup.engine.votesReveal(claimId, 1)).toHaveLength(5);

    const proofAfterReveal = await setup.engine.runProof(claimId, run.runId);
    expect(proofAfterReveal).toMatchObject({
      sealedBlobId: record.sealedBlobId,
      revealedBlobId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      revealed: true,
      sealed,
      bundle: {
        version: 3,
        kind: "run-bundle",
        runId: run.runId,
        validatedOutput: record.output,
        seal: {
          algorithm: "AES-256-GCM",
          keyHex: record.sealKeyHex,
          ivHex: record.sealIvHex,
          aad: run.runId,
          sealedBlobId: record.sealedBlobId,
          coreHash: record.coreHash,
        },
      },
    });
    if (!proofAfterReveal.bundle || !proofAfterReveal.revealedBlobId) {
      throw new Error("expected a revealed plaintext run bundle");
    }
    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({
        jurySeatId: record.jurySeatId,
        argumentBlobId: proofAfterReveal.revealedBlobId,
      }),
    );
    const { seal, ...revealedCore } = proofAfterReveal.bundle;
    expect(seal.sealedBlobId).toBe(record.sealedBlobId);
    expect(openSealedRunBundle(sealed, seal)).toEqual(revealedCore);
    expect(
      JSON.parse(
        new TextDecoder().decode(
          await setup.walrus.get(proofAfterReveal.revealedBlobId),
        ),
      ),
    ).toEqual(proofAfterReveal.bundle);
  });

  it("keeps a seat when Seal escrow encryption fails", async () => {
    const gateway = new FakeSuiGateway();
    const sealPolicy: SealEscrowService["policy"] = {
      packageId: `0x${"77".repeat(32)}`,
      threshold: 1,
      keyServers: [{ objectId: `0x${"88".repeat(32)}`, weight: 1 }],
    };
    const escrowKey = vi.fn<SealEscrowService["escrowKey"]>(async () => {
      throw new Error("key server unavailable");
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    try {
      const setup = await engineSetup(gateway, 1, {
        seal: sealPolicy,
        sealEscrow: { policy: sealPolicy, escrowKey },
      });
      const { claimId } = await setup.engine.factCheckStart({
        claim: "Seal outages must not cost a jury seat.",
        text: "Local evidence.",
        urls: [],
      });
      await setup.engine.selectCommittee(claimId);
      await setup.engine.evidenceFreeze(claimId, 1);
      const jury = await setup.engine.juryRun(claimId, 1);
      const run = jury.runs.find(
        (candidate) => candidate.status === "SCHEMA_VALID",
      );
      if (!run) throw new Error("expected a jury run");

      expect(escrowKey).toHaveBeenCalledOnce();
      expect(
        (await setup.engine.runProof(claimId, run.runId)).sealed?.escrow,
      ).toBeUndefined();
      expect(
        stderr.mock.calls.some(
          ([message]) =>
            String(message).includes(
              `seal-escrow failed: claim ${claimId} seat `,
            ) && String(message).includes("key server unavailable"),
        ),
      ).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });

  it("leaves a seat retryable when plaintext publication fails", async () => {
    const gateway = new FakeSuiGateway();
    const setup = await engineSetup(gateway, 5);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A transient reveal upload failure remains retryable.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);
    await setup.engine.votesCommit(claimId, 1);
    await setup.engine.advance(claimId);

    vi.spyOn(setup.walrus, "put").mockRejectedValueOnce(
      new Error("transient plaintext upload failure"),
    );
    const reveal = vi.spyOn(gateway, "revealVote");
    await expect(setup.engine.votesReveal(claimId, 1)).resolves.toHaveLength(4);
    expect(reveal).toHaveBeenCalledTimes(4);
    await expect(setup.engine.votesReveal(claimId, 1)).resolves.toHaveLength(1);
    expect(reveal).toHaveBeenCalledTimes(5);
  });

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

  it("a CITATION_INVALID seat casts no vote and the round still settles", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), 5, {
      failures: { 0: "no_independent_citation" },
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Independent citations are required for a decisive answer.",
      text: "Local evidence.",
      urls: [],
    });
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    await setup.engine.juryRun(claimId, 1);

    const runs = await createRepository(setup.db).listInferenceRuns(claimId, 1);
    expect(
      runs.filter((run) => run.validationStatus === "CITATION_INVALID"),
    ).toHaveLength(1);
    expect(await setup.engine.votesCommit(claimId, 1)).toHaveLength(4);
    await setup.engine.advance(claimId);
    expect(await setup.engine.votesReveal(claimId, 1)).toHaveLength(4);
    await expect(setup.engine.finalize(claimId)).resolves.toMatchObject({
      result: "YES",
    });
  });

  it("persists a failed research seat under its derived run id and returns its proof", async () => {
    const sealPolicy = {
      packageId: `0x${"77".repeat(32)}` as const,
      threshold: 1,
      keyServers: [{ objectId: `0x${"88".repeat(32)}` as const, weight: 1 }],
    };
    const setup = await engineSetup(new FakeSuiGateway(), 5, {
      failures: { 0: "no_independent_citation" },
      seal: sealPolicy,
    });
    const { claimId } = await setup.engine.factCheckStart({
      claim: "A failed juror must leave a public research trail.",
      text: "Local evidence.",
      urls: [],
    });
    const claim = await setup.engine.inspect(claimId);
    await setup.engine.selectCommittee(claimId);
    await setup.engine.evidenceFreeze(claimId, 1);
    const put = vi.spyOn(setup.walrus, "put");

    await setup.engine.juryRun(claimId, 1);

    const repository = createRepository(setup.db);
    const failed = (await repository.listInferenceRuns(claimId, 1)).find(
      (run) => run.validationStatus === "CITATION_INVALID",
    );
    if (!failed?.failure) throw new Error("expected a persisted failure record");
    const expectedRunId = toHex(
      blake2b256(
        new TextEncoder().encode(
          `run:${claimId}:${failed.jurySeatId}:1`,
        ),
      ),
    );
    expect(failed.runId).toBe(expectedRunId);
    expect(failed.failure).toMatchObject({
      version: 1,
      status: "CITATION_INVALID",
      failedAtMs: Date.parse("2026-08-27T00:00:00.000Z"),
      transcript: {
        version: 1,
        runId: expectedRunId,
        counts: { turns: expect.any(Number) },
        steps: expect.arrayContaining([
          expect.objectContaining({ result: expect.objectContaining({ tool: "error" }) }),
        ]),
      },
      attempts: expect.arrayContaining([
        expect.objectContaining({
          type: "gonka-attempt",
          response: expect.objectContaining({ id: expect.stringMatching(/^msg_fake_/) }),
        }),
      ]),
      walrusBlobId: expect.any(String),
    });
    expect(failed.failure.attempts).toHaveLength(4);

    const failedWrite = put.mock.calls.find(
      ([, options]) => options?.identifier === `${expectedRunId}-failed-run.json`,
    );
    if (!failedWrite) throw new Error("expected a failed-run Walrus write");
    const canonicalFailure = new TextDecoder().decode(failedWrite[0]);
    expect(canonicalFailure).not.toMatch(
      /"(?:sealKeyHex|keyHex|saltHex|apiKey)":/,
    );

    await expect(setup.engine.runProof(claimId, expectedRunId)).resolves.toMatchObject({
      runId: expectedRunId,
      runHash: null,
      sealedBlobId: null,
      sealed: null,
      revealedBlobId: null,
      revealed: false,
      bundle: null,
      failure: failed.failure,
      claimDeadlines: {
        firstRevealDeadlineMs: claim.deadlines.firstRevealDeadlineMs,
        secondRevealDeadlineMs: claim.deadlines.secondRevealDeadlineMs,
      },
      sealPolicy,
    });
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
    // A transient bind failure no longer fails the freeze (binds are
    // agent-signed and retried): the seat stays unbound and the next bind
    // attempt, here a second freeze call and in production the next
    // juryRun tick, completes it.
    await expect(setup.engine.evidenceFreeze(claimId, 1)).resolves.toMatchObject({
      objectIds: { evidenceBundle: expect.any(String) },
    });
    const repository = createRepository(setup.db);
    const boundSeats = async () =>
      (await repository.listJurySeats(claimId, 1)).filter((seat) => seat.evidenceBound).length;
    expect(await boundSeats()).toBe(4);
    await expect(setup.engine.evidenceFreeze(claimId, 1)).resolves.toMatchObject({
      objectIds: { evidenceBundle: expect.any(String) },
    });
    expect(await boundSeats()).toBe(5);
    expect((await setup.engine.inspect(claimId)).commitments).toHaveLength(5);
  });

  it("repairs prose and runs phase two as five sealed table votes", async () => {
    const prose = "The claim is stated as an absolute but research is divided.";
    const setup = await roundTwoSetup("6", { unsupportedClaims: [prose] });
    const repository = createRepository(setup.db);
    const firstRuns = await repository.listInferenceRuns(setup.claimId, 1);
    const spokenTurns = (await repository.listDeliberationTurns(setup.claimId)).filter(
      (turn) => turn.status === "SPOKEN",
    );
    const callsBeforeTableVote = setup.gonkaComplete.mock.calls.length;

    await setup.engine.juryRun(setup.claimId, 2);

    const tableVoteCalls = setup.gonkaComplete.mock.calls.slice(callsBeforeTableVote);
    expect(tableVoteCalls).toHaveLength(5);
    expect(
      tableVoteCalls.every(
        ([request]) =>
          request.messages[0]?.content === TABLE_VOTE_PROMPT_SPEC_V1.systemPrompt,
      ),
    ).toBe(true);
    const phaseTwoRuns = await repository.listInferenceRuns(setup.claimId, 2);
    expect(phaseTwoRuns).toHaveLength(5);
    for (const run of phaseTwoRuns) {
      expect(run.output?.unsupportedClaims).toEqual([]);
      expect(run.promptHash).toBe(tableVotePromptSpecHash());
      expect(run.audit.promptHash).toBe(tableVotePromptSpecHash());
      expect(run.audit.toolTranscriptHash).toBe(EMPTY_TOOL_TRANSCRIPT_HASH);
      expect(run.audit.toolCallCount).toBe(0);
      const core = JSON.parse(
        run.audit.bundleCore ?? "null",
      ) as PublicRunBundleCoreV6;
      expect(core.version).toBe(6);
      expect(core.input.kind).toBe("TABLE_VOTE");
      expect(core.input.debate).toHaveLength(spokenTurns.length);
      const firstRun = firstRuns.find(
        (candidate) => candidate.agentProfileId === run.agentProfileId,
      );
      expect(core.input.self.roundOneOutput).toEqual(firstRun?.output);
      expect("transcript" in core).toBe(false);
    }
    const repairEvents = (await repository.listResolutionEvents(setup.claimId)).filter(
      (event) => event.kind === "output_repaired",
    );
    expect(
      repairEvents.filter((event) => event.payload.phase === 1),
    ).toHaveLength(5);
    const tableVoteRepairEvents = repairEvents.filter(
      (event) => event.payload.phase === 2,
    );
    expect(tableVoteRepairEvents).toHaveLength(5);
    for (const event of tableVoteRepairEvents) {
      expect(event).toMatchObject({
        phase: "COMMIT_2",
        source: "ENGINE",
        visibility: "PUBLIC_NOW",
        payload: {
          claim_id: setup.claimId,
          jury_seat_id: expect.any(String),
          agent_profile_id: expect.any(String),
          run_id: expect.any(String),
          phase: 2,
          field: "unsupportedClaims",
          dropped: [
            `unsupportedClaims: dropped entry that is not an evidence id: "${prose}"`,
          ],
        },
      });
    }

    await setup.engine.votesCommit(setup.claimId, 2);
    await setup.engine.advance(setup.claimId);
    await setup.engine.votesReveal(setup.claimId, 2);
    const finalized = await setup.engine.finalize(setup.claimId);

    expect(finalized).toMatchObject({ result: "NO", truthScoreBps: 3_200 });
    expect((await setup.engine.inspect(setup.claimId)).state).toBe(10);
    expect((await setup.engine.report(setup.claimId)).finalRoundVotes).toHaveLength(5);
  });

  it("rejects v5 manifests before phase-two table votes with republish guidance", async () => {
    const setup = await roundTwoSetup("5");
    const callsBeforeTableVote = setup.gonkaComplete.mock.calls.length;

    await expect(setup.engine.juryRun(setup.claimId, 2)).rejects.toThrow(
      /run pnpm tsx scripts\/publish-agent-manifests\.ts/,
    );
    expect(setup.gonkaComplete).toHaveBeenCalledTimes(callsBeforeTableVote);
  });

  it("fails closed when round one reveals are missing before phase two", async () => {
    const setup = await engineSetup(new FakeSuiGateway(), [
      ["YES", "YES", "YES", "NO", "NO"],
      ["NO", "NO", "NO", "NO", "YES"],
    ]);
    const { claimId } = await setup.engine.factCheckStart({
      claim: "Discussion requires the revealed first round record.",
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
    await setup.db.query("DELETE FROM reveals WHERE claim_id = $1", [claimId]);
    const callsBeforeFreeze = setup.gonkaComplete.mock.calls.length;

    await expect(setup.engine.evidenceFreeze(claimId, 2)).rejects.toBeInstanceOf(
      EngineStateError,
    );
    expect(setup.gonkaComplete).toHaveBeenCalledTimes(callsBeforeFreeze);
    await expect(
      createRepository(setup.db).listEvidenceArtifacts(claimId, 2),
    ).resolves.toEqual([]);
  });
});

describe("debateConvergedAfterExchange", () => {
  const roundOneStances = new Map<string, TableVoteStance>([
    ["seat-0", "YES"],
    ["seat-1", "NO"],
  ]);

  it("returns exchange one when every stance holds", () => {
    expect(debateConvergedAfterExchange([
      { jurySeatId: "seat-0", exchange: 1, status: "SPOKEN", stance: "YES" },
      { jurySeatId: "seat-1", exchange: 1, status: "SPOKEN", stance: "NO" },
    ], roundOneStances)).toBe(1);
  });

  it("returns exchange two when a seat moves once and then holds", () => {
    expect(debateConvergedAfterExchange([
      { jurySeatId: "seat-0", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-1", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-0", exchange: 2, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-1", exchange: 2, status: "SPOKEN", stance: "NO" },
    ], roundOneStances)).toBe(2);
  });

  it("returns null when a seat moves in every exchange", () => {
    expect(debateConvergedAfterExchange([
      { jurySeatId: "seat-0", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-1", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-0", exchange: 2, status: "SPOKEN", stance: "YES" },
      { jurySeatId: "seat-1", exchange: 2, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-0", exchange: 3, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-1", exchange: 3, status: "SPOKEN", stance: "NO" },
    ], roundOneStances)).toBeNull();
  });

  it("ignores an incomplete exchange", () => {
    expect(debateConvergedAfterExchange([
      { jurySeatId: "seat-0", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-1", exchange: 1, status: "SPOKEN", stance: "NO" },
      { jurySeatId: "seat-0", exchange: 2, status: "SPOKEN", stance: "NO" },
    ], roundOneStances)).toBeNull();
  });

  it("keeps the previous stance for a skipped turn", () => {
    expect(debateConvergedAfterExchange([
      { jurySeatId: "seat-0", exchange: 1, status: "SKIPPED" },
      { jurySeatId: "seat-1", exchange: 1, status: "SPOKEN", stance: "NO" },
    ], roundOneStances)).toBe(1);
  });
});

describe("deliberationTurnInstructions", () => {
  it("steelmans YES for a unanimous NO jury in exchange two", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 2,
      role: "SOURCE_AUTHENTICITY",
      outcome: "NO",
      seatIndex: 0,
      roundOneSeats: [
        { seatIndex: 0, outcome: "NO" },
        { seatIndex: 1, outcome: "NO" },
      ],
      mostRecentSpeaker: 1,
      movedSoFar: false,
    });

    expect(instructions).toContain("best case for YES");
  });

  it("names a dissenter and requires a specific dispute in exchange one", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 1,
      role: "SOURCE_AUTHENTICITY",
      outcome: "YES",
      seatIndex: 0,
      roundOneSeats: [
        { seatIndex: 0, outcome: "YES" },
        { seatIndex: 3, outcome: "NO" },
      ],
      mostRecentSpeaker: 3,
      movedSoFar: false,
    });

    expect(instructions).toContain("Seat 3 voted NO");
    expect(instructions).toContain("dispute one specific citation");
  });

  it("steelmans a definite outcome for a unanimous UNSURE jury", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 2,
      role: "SOURCE_AUTHENTICITY",
      outcome: "UNSURE",
      seatIndex: 0,
      roundOneSeats: [
        { seatIndex: 0, outcome: "UNSURE" },
        { seatIndex: 1, outcome: "UNSURE" },
      ],
      mostRecentSpeaker: 1,
      movedSoFar: false,
    });

    expect(instructions).toContain("a definite YES or NO");
  });

  it("adds the SKEPTIC role instruction", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 1,
      role: "SKEPTIC",
      outcome: "YES",
      seatIndex: 0,
      roundOneSeats: [{ seatIndex: 0, outcome: "YES" }],
      mostRecentSpeaker: null,
      movedSoFar: false,
    });

    expect(instructions).toContain("SKEPTIC role");
  });

  it("uses the evidence instruction for an unknown role", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 1,
      role: "OTHER",
      outcome: "YES",
      seatIndex: 0,
      roundOneSeats: [{ seatIndex: 0, outcome: "YES" }],
      mostRecentSpeaker: null,
      movedSoFar: false,
    });

    expect(instructions).toContain("Argue only from the evidence");
  });

  it("adds movement and final duties to exchange three", () => {
    const instructions = deliberationTurnInstructions({
      exchange: 3,
      role: "SKEPTIC",
      outcome: "YES",
      seatIndex: 0,
      roundOneSeats: [
        { seatIndex: 0, outcome: "YES" },
        { seatIndex: 1, outcome: "NO" },
      ],
      mostRecentSpeaker: 1,
      movedSoFar: true,
    });

    expect(instructions).toMatch(
      /^Exchange three\. At least one seat changed its stance in the previous exchange;/,
    );
    expect(instructions).toContain("This is the last exchange:");
    expect(instructions).toContain(
      "State your current stance and confidence in the stance and confidenceBps fields. You hold the SKEPTIC role",
    );
  });
});

describe("public deliberation", () => {
  it("stops after one converged exchange and freezes the public stances", async () => {
    const setup = await discussionSetup(2, {
      0: [deliberationResponse("Seat 0 opening", [], "YES", 8_200)],
      1: [deliberationResponse("Seat 1 opening", [], "YES", 7_900)],
    });
    const callsBefore = setup.gonkaComplete.mock.calls.length;

    await setup.engine.runDeliberation(setup.claimId);

    const repository = createRepository(setup.db);
    const stored = await repository.listDeliberationTurns(setup.claimId);
    const turns = stored.map(publicDeliberationTurn);
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => ({
      ordinal: turn.ordinal,
      exchange: turn.exchange,
      status: turn.status,
      stance: turn.stance,
      confidenceBps: turn.confidenceBps,
    }))).toEqual([
      {
        ordinal: 0,
        exchange: 1,
        status: "SPOKEN",
        stance: "YES",
        confidenceBps: 8_200,
      },
      {
        ordinal: 1,
        exchange: 1,
        status: "SPOKEN",
        stance: "YES",
        confidenceBps: 7_900,
      },
    ]);
    expect(stored.every((turn) => turn.gonkaRequestId !== undefined)).toBe(true);
    expect(stored.every(
      (turn) => turn.promptSpecHash === promptSpecHash(DELIBERATION_PROMPT_SPEC_V3),
    )).toBe(true);

    const events = (await repository.listResolutionEvents(setup.claimId)).filter(
      (event) => event.kind === "DELIBERATION_TURN",
    );
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.visibility === "PUBLIC_NOW")).toBe(true);
    expect(events.every((event) => event.phase === "DISCUSSION")).toBe(true);
    expect(events.map((event) => event.payload)).toEqual(turns);
    const [convergedEvent] = (
      await repository.listResolutionEvents(setup.claimId)
    ).filter((event) => event.kind === "debate_converged");
    expect(convergedEvent).toMatchObject({
      phase: "DISCUSSION",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: { claim_id: setup.claimId, exchange: 1 },
    });

    const artifact = await repository.getEvidenceArtifact(
      `deliberation-transcript:${setup.claimId}`,
    );
    expect(artifact).toMatchObject({
      claimId: setup.claimId,
      phase: 2,
      sourceUrl: "urn:openverdict:deliberation-transcript",
    });
    if (!artifact) throw new Error("expected a deliberation transcript artifact");
    const transcript = JSON.parse(
      new TextDecoder().decode(
        await setup.walrus.get(artifact.canonicalWalrusBlobId),
      ),
    ) as Record<string, unknown>;
    expect(transcript).toEqual({
      version: 1,
      kind: "deliberation-transcript",
      convergedAfterExchange: 1,
      turns,
    });
    expect(await setup.engine.inspect(setup.claimId)).toMatchObject({
      deliberation: turns,
      debateConvergedAfterExchange: 1,
    });

    const requests = setup.gonkaComplete.mock.calls.slice(callsBefore);
    expect(requests).toHaveLength(2);
    expect(requests.every(([request]) => request.messages.length === 2)).toBe(true);
    expect(requests[0]?.[0].messages[0]?.content).toBe(
      DELIBERATION_PROMPT_SPEC_V3.systemPrompt,
    );
    const firstInput = JSON.parse(
      requests[0]?.[0].messages[1]?.content ?? "null",
    ) as Record<string, unknown>;
    expect(firstInput).toMatchObject({
      statement: expect.any(String),
      resolutionCriteria: expect.any(String),
      roundOneRecord: { phase: 1 },
      debateSoFar: [],
      exchange: 1,
      mostRecentSpeaker: null,
      turnInstructions: expect.stringContaining("Exchange one"),
      self: { seatIndex: 0, role: expect.any(String) },
      allowedCitations: expect.any(Array),
    });
    const secondInput = JSON.parse(
      requests[1]?.[0].messages[1]?.content ?? "null",
    ) as Record<string, unknown>;
    expect(secondInput).toMatchObject({
      exchange: 1,
      mostRecentSpeaker: 0,
      turnInstructions: expect.stringContaining("Begin by answering Seat 0"),
    });
    const phaseOneManifest = await repository.getEvidenceManifest(setup.claimId, 1);
    const allowedCitations = firstInput.allowedCitations as string[];
    expect(allowedCitations).toEqual(
      expect.arrayContaining(phaseOneManifest?.sortedLeaves ?? []),
    );
    expect(
      allowedCitations.some((citation) =>
        citation.startsWith("https://fake.evidence.test/")),
    ).toBe(true);
  });

  it("runs two exchanges when one stance moves once and then holds", async () => {
    const setup = await discussionSetup(2, {
      0: [
        deliberationResponse("Seat 0 moves", [], "NO"),
        deliberationResponse("Seat 0 holds", [], "NO"),
      ],
      1: [
        deliberationResponse("Seat 1 holds", [], "YES"),
        deliberationResponse("Seat 1 still holds", [], "YES"),
      ],
    });
    const callsBefore = setup.gonkaComplete.mock.calls.length;

    await setup.engine.runDeliberation(setup.claimId);

    expect(setup.gonkaComplete.mock.calls.slice(callsBefore)).toHaveLength(4);
    expect(await setup.engine.inspect(setup.claimId)).toMatchObject({
      debateConvergedAfterExchange: 2,
    });
  });

  it("runs all three exchanges when a stance changes every time", async () => {
    const setup = await discussionSetup(2, {
      0: [
        deliberationResponse("Seat 0 moves", [], "NO"),
        deliberationResponse("Seat 0 moves back", [], "YES"),
        deliberationResponse("Seat 0 moves again", [], "NO"),
      ],
      1: [
        deliberationResponse("Seat 1 holds", [], "YES"),
        deliberationResponse("Seat 1 still holds", [], "YES"),
        deliberationResponse("Seat 1 finally holds", [], "YES"),
      ],
    });
    const callsBefore = setup.gonkaComplete.mock.calls.length;

    await setup.engine.runDeliberation(setup.claimId);

    expect(setup.gonkaComplete.mock.calls.slice(callsBefore)).toHaveLength(6);
    const inspection = await setup.engine.inspect(setup.claimId);
    expect(inspection.debateConvergedAfterExchange ?? null).toBeNull();
    const artifact = await createRepository(setup.db).getEvidenceArtifact(
      `deliberation-transcript:${setup.claimId}`,
    );
    if (!artifact) throw new Error("expected a deliberation transcript artifact");
    const transcript = JSON.parse(
      new TextDecoder().decode(
        await setup.walrus.get(artifact.canonicalWalrusBlobId),
      ),
    ) as Record<string, unknown>;
    expect(transcript.convergedAfterExchange).toBeNull();
  });

  it("skips malformed output and continues later turns", async () => {
    const setup = await discussionSetup(2, {
      0: ["not-json", deliberationResponse("Seat 0 response")],
      1: [
        deliberationResponse("Seat 1 opening"),
        deliberationResponse("Seat 1 response"),
      ],
    });

    await setup.engine.runDeliberation(setup.claimId);

    const turns = await createRepository(setup.db).listDeliberationTurns(
      setup.claimId,
    );
    expect(turns.map((turn) => [turn.status, turn.failureStatus])).toEqual([
      ["SKIPPED", "INVALID_OUTPUT"],
      ["SPOKEN", undefined],
    ]);
  });

  it("skips citations outside the allowed set", async () => {
    const setup = await discussionSetup(2, {
      0: [
        deliberationResponse("Seat 0 opening", ["not-allowed"]),
        deliberationResponse("Seat 0 response"),
      ],
      1: [
        deliberationResponse("Seat 1 opening"),
        deliberationResponse("Seat 1 response"),
      ],
    });

    await setup.engine.runDeliberation(setup.claimId);

    const [first] = await createRepository(setup.db).listDeliberationTurns(
      setup.claimId,
    );
    expect(first).toMatchObject({
      ordinal: 0,
      status: "SKIPPED",
      failureStatus: "INVALID_CITATIONS",
      argument: "",
      citations: [],
    });
  });

  it("force-settles remaining turns when the freeze window is exhausted", async () => {
    const setup = await discussionSetup(2);
    const repository = createRepository(setup.db);
    const claim = await repository.getClaim(setup.claimId);
    if (!claim) throw new Error("expected a discussion claim");
    const now = Date.parse("2026-08-27T00:00:00.000Z");
    await repository.saveClaim({
      ...claim,
      deadlines: {
        ...claim.deadlines,
        discussionDeadlineMs: now + 1_000,
      },
      updatedAt: new Date(now).toISOString(),
    });
    const callsBefore = setup.gonkaComplete.mock.calls.length;

    await setup.engine.runDeliberation(setup.claimId);

    const turns = await repository.listDeliberationTurns(setup.claimId);
    expect(turns).toHaveLength(2);
    expect(turns.every(
      (turn) =>
        turn.status === "SKIPPED" &&
        turn.failureStatus === "WINDOW_EXHAUSTED",
    )).toBe(true);
    expect(setup.gonkaComplete).toHaveBeenCalledTimes(callsBefore);
    await expect(
      setup.engine.evidenceFreeze(setup.claimId, 2),
    ).resolves.toMatchObject({
      objectIds: { evidenceBundle: expect.any(String) },
    });
  });

  it("freezes an empty transcript when no juror revealed", async () => {
    const setup = await discussionSetup(0);

    await setup.engine.runDeliberation(setup.claimId);

    const repository = createRepository(setup.db);
    await expect(repository.listDeliberationTurns(setup.claimId)).resolves.toEqual([]);
    const artifact = await repository.getEvidenceArtifact(
      `deliberation-transcript:${setup.claimId}`,
    );
    if (!artifact) throw new Error("expected an empty deliberation transcript");
    expect(
      JSON.parse(
        new TextDecoder().decode(
          await setup.walrus.get(artifact.canonicalWalrusBlobId),
        ),
      ),
    ).toEqual({
      version: 1,
      kind: "deliberation-transcript",
      convergedAfterExchange: null,
      turns: [],
    });
    await expect(
      setup.engine.evidenceFreeze(setup.claimId, 2),
    ).resolves.toMatchObject({
      objectIds: { evidenceBundle: expect.any(String) },
    });
  });

  it("deduplicates overlapping and repeated deliberation ticks", async () => {
    const setup = await discussionSetup(2);
    const callsBefore = setup.gonkaComplete.mock.calls.length;

    await Promise.all([
      setup.engine.runDeliberation(setup.claimId),
      setup.engine.runDeliberation(setup.claimId),
    ]);
    await setup.engine.runDeliberation(setup.claimId);

    const repository = createRepository(setup.db);
    await expect(repository.listDeliberationTurns(setup.claimId)).resolves.toHaveLength(2);
    const events = (await repository.listResolutionEvents(setup.claimId)).filter(
      (event) => event.kind === "DELIBERATION_TURN",
    );
    expect(events).toHaveLength(2);
    expect(setup.gonkaComplete.mock.calls.slice(callsBefore)).toHaveLength(2);
    expect(
      (await repository.listResolutionEvents(setup.claimId)).filter(
        (event) => event.kind === "debate_converged",
      ),
    ).toHaveLength(1);
  });

  it("settles deliberation before a phase-two freeze", async () => {
    const setup = await discussionSetup(2);

    await setup.engine.evidenceFreeze(setup.claimId, 2);

    const repository = createRepository(setup.db);
    await expect(repository.listDeliberationTurns(setup.claimId)).resolves.toHaveLength(2);
    const manifest = await repository.getEvidenceManifest(setup.claimId, 2);
    expect(manifest?.sortedLeaves).toContain(
      `deliberation-transcript:${setup.claimId}`,
    );
  });
});

describe("agent backing status", () => {
  it("maps only explicitly known verification providers", () => {
    expect(agentBackingStatus("zklogin:enoki")).toEqual({
      kind: "ZKLOGIN",
      label: "zklogin:enoki",
    });
    expect(agentBackingStatus("demo-allowlist")).toEqual({
      kind: "ALLOWLIST",
      label: "demo-allowlist",
    });
    expect(agentBackingStatus("something-else")).toEqual({
      kind: "UNKNOWN",
      label: "something-else",
    });
  });
});

describe("zkLogin-backed agent registration", () => {
  const zkLoginAddress = `0x${"ab".repeat(32)}`;
  const signature = "c2lnbmF0dXJl";

  it("builds the exact v1 canonical backing message", () => {
    expect(
      new TextDecoder().decode(
        buildZkLoginBackingMessage(zkLoginAddress, "testnet"),
      ),
    ).toBe(
      `OpenVerdict agent backing v1\naddress: ${zkLoginAddress}\nnetwork: testnet`,
    );
  });

  it("verifies, registers, and persists a ZKLOGIN_BACKED agent", async () => {
    const setup = await registrationSetup({ verifierResult: true });

    const result = await setup.engine.registerZkBackedAgent({
      zkLoginAddress,
      signature,
      modelId: "model-b",
      role: "INVESTIGATOR",
    });

    const expectedBackingHash = toHex(blake2b256(fromHex(zkLoginAddress)));
    expect(setup.verify).toHaveBeenCalledOnce();
    expect(setup.verify).toHaveBeenCalledWith({
      zkLoginAddress,
      message: buildZkLoginBackingMessage(zkLoginAddress, "localnet"),
      signature,
    });
    expect(result).toEqual({
      agentProfileId: setup.gateway.agents[1]!.agentProfileId,
      humanBackingHash: expectedBackingHash,
      backingKind: "ZKLOGIN_BACKED",
      digest: "fake-0001-register_agent",
    });
    expect(setup.gateway.registrations).toHaveLength(1);
    expect(setup.gateway.registrations[0]).toMatchObject({
      agentIndex: 1,
      bondAmount: 1,
      manifestBlobId: expect.any(String),
    });
    expect(toHex(setup.gateway.registrations[0]!.humanBackingHash)).toBe(
      expectedBackingHash,
    );

    const saved = await createRepository(setup.db).getAgentManifest(
      result.agentProfileId,
    );
    expect(saved).toMatchObject({
      role: "INVESTIGATOR",
      agentCapId: setup.gateway.agents[1]!.agentCapId,
      active: true,
      manifest: {
        agentProfileId: result.agentProfileId,
        owner: setup.gateway.agents[1]!.owner,
        humanAttestationHash: expectedBackingHash,
        humanVerificationProvider: "zklogin:enoki",
        version: "3",
        promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V2),
        toolPolicyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V2),
        modelId: "model-b",
        providerId: "gonkarouter",
      },
    });
    if (!saved) throw new Error("expected the registered manifest");
    const document = parseAgentManifestDocument(
      await setup.walrus.get(saved.manifest.manifestBlobId),
    );
    expect(document).toMatchObject({
      version: "3",
      backingKind: "ZKLOGIN_BACKED",
      promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V2),
      toolPolicyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V2),
    });
    // The document carries the policy label; its hash is the policy id the
    // engine records at evidence freeze, and the saved manifest must agree.
    const expectedPolicyHash = toHex(
      blake2b256(new TextEncoder().encode(EVIDENCE_POLICY_V1_LABEL)),
    );
    expect(document.evidencePolicyId).toBe(EVIDENCE_POLICY_V1_LABEL);
    expect(document.evidencePolicyHash).toBe(expectedPolicyHash);
    expect(saved.manifest.evidencePolicyHash).toBe(expectedPolicyHash);
    await expect(
      setup.engine.agentManifestDocument(result.agentProfileId),
    ).resolves.toEqual(document);
    await expect(
      setup.engine.agentManifestDocument(setup.gateway.agents[0]!.agentProfileId),
    ).resolves.toBeNull();
  });

  it("fails closed when the release manifest overrides the evidence policy id", async () => {
    // A document label always hashes to the default policy id, so a manifest
    // that points at a different policy must be rejected before any upload.
    const setup = await registrationSetup({
      verifierResult: true,
      evidencePolicyId: `0x${"cd".repeat(32)}`,
    });

    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress,
        signature,
        modelId: "model-b",
        role: "INVESTIGATOR",
      }),
    ).rejects.toThrow("does not match the engine evidence policy id");
    expect(setup.gateway.registrations).toHaveLength(0);
  });

  it("rejects a bad zkLogin signature before registration", async () => {
    const setup = await registrationSetup({ verifierResult: false });

    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress,
        signature,
        modelId: "model-a",
        role: "SKEPTIC",
      }),
    ).rejects.toThrow("zkLogin signature is invalid");
    expect(setup.gateway.registrations).toHaveLength(0);
  });

  it("rejects an active duplicate human backing", async () => {
    const setup = await registrationSetup({ verifierResult: true });
    const request = {
      zkLoginAddress,
      signature,
      modelId: "model-a",
      role: "SOURCE_AUTHENTICITY",
    } as const;

    await setup.engine.registerZkBackedAgent(request);

    await expect(setup.engine.registerZkBackedAgent(request)).rejects.toThrow(
      "one social account can back only one active jury seat",
    );
    expect(setup.gateway.registrations).toHaveLength(1);
  });

  it("rejects model and role values outside the manifest policy", async () => {
    const setup = await registrationSetup({ verifierResult: true });

    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress,
        signature,
        modelId: "unknown-model",
        role: "SKEPTIC",
      }),
    ).rejects.toThrow(EngineValidationError);
    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress,
        signature,
        modelId: "model-a",
        role: "ANALYST",
      }),
    ).rejects.toThrow(EngineValidationError);
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical Sui address before verification", async () => {
    const setup = await registrationSetup({ verifierResult: true });

    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress: "0xabc",
        signature,
        modelId: "model-a",
        role: "SKEPTIC",
      }),
    ).rejects.toThrow("canonical lowercase 32-byte Sui address");
    expect(setup.verify).not.toHaveBeenCalled();
  });

  it("rejects registration after deterministic signer capacity is exhausted", async () => {
    const setup = await registrationSetup({
      verifierResult: true,
      signerCount: 1,
      initialAgentCount: 1,
    });

    await expect(
      setup.engine.registerZkBackedAgent({
        zkLoginAddress,
        signature,
        modelId: "model-a",
        role: "SKEPTIC",
      }),
    ).rejects.toThrow("operational agent signer capacity exhausted");
    expect(setup.gateway.registrations).toHaveLength(0);
  });
});

class RecordingFakeSuiGateway extends FakeSuiGateway {
  readonly registrations: Parameters<FakeSuiGateway["registerAgent"]>[0][] = [];

  override async registerAgent(
    input: Parameters<FakeSuiGateway["registerAgent"]>[0],
  ) {
    this.registrations.push(input);
    return super.registerAgent(input);
  }
}

async function registrationSetup(options: {
  verifierResult: boolean;
  signerCount?: number;
  initialAgentCount?: number;
  /** Overrides the release manifest's evidence policy id (fail-closed test). */
  evidencePolicyId?: `0x${string}`;
}) {
  const directory = await mkdtemp(join(tmpdir(), "openverdict-registration-"));
  const manifest: ReleaseManifest = options.evidencePolicyId
    ? {
        ...testManifest(),
        evidencePolicy: {
          id: options.evidencePolicyId,
          maxBytes: 1_000_000,
          maxRedirects: 3,
          timeoutMs: 10_000,
          allowedMime: ["text/html"],
        },
      }
    : testManifest();
  const manifestPath = join(directory, "release.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const db = createDb({ dataDir: "memory://" });
  if (!(db instanceof PGlite)) throw new Error("expected pglite");
  databases.push(db);

  const signers = testSignerRegistry(options.signerCount ?? 3);
  const agents = signers.listAgents().map<FakeSuiAgent>((agent, index) => ({
    agentProfileId: fakeId(`registration-profile:${index}`),
    owner: agent.address,
    agentCapId: fakeId(`registration-cap:${index}`),
    modelId: manifest.gonka.models[index % manifest.gonka.models.length]!,
    role: "SKEPTIC",
  }));
  const gateway = new RecordingFakeSuiGateway(agents);
  const verify = vi.fn(async () => options.verifierResult);
  const initialAgentCount = options.initialAgentCount ?? 1;
  const walrus = createLocalWalrusStore(join(directory, "walrus"));
  const engine = await createEngine({
    network: "localnet",
    manifestPath,
    db,
    walrus,
    gonka: createFakeGonkaAdapter([]),
    suiGateway: gateway,
    signers,
    initialAgents: agents
      .slice(0, initialAgentCount)
      .map((agent, index) => toEngineAgent(agent, index)),
    zkLoginVerifier: { verify },
    now: () => Date.parse("2026-08-27T00:00:00.000Z"),
    sleep: async () => undefined,
  });
  return { engine, db, gateway, verify, walrus };
}

function testSignerRegistry(count: number): SignerRegistry {
  const signers: BoundAgentSigner[] = Array.from({ length: count }, (_, index) => {
    const keypair = Ed25519Keypair.fromSecretKey(
      blake2b256(new TextEncoder().encode(`registration-signer:${index}`)),
    );
    return { keypair, address: keypair.toSuiAddress(), index };
  });
  return new SignerRegistry(undefined, signers);
}

async function engineSetup(
  gateway: FakeSuiGateway,
  runPlan: number | Array<Array<"YES" | "NO" | "UNSURE">>,
  options: {
    promptHash?: `0x${string}`;
    toolPolicyHash?: `0x${string}`;
    failures?: Partial<Record<number, FakeFailure>>;
    actions?: FakeAction[];
    decisiveEvidence?: string[];
    unsupportedClaims?: string[];
    deliberationResponses?: Partial<Record<number, string[]>>;
    /** Replaces the local store (for example a store with a retention clock). */
    walrus?: WalrusStore;
    /** Replaces the fake research provider (weather tests flip its probe). */
    research?: ResearchProvider;
    seal?: NonNullable<ReleaseManifest["seal"]>;
    sealEscrow?: SealEscrowService;
    /** Only relaunch tests move time beyond the shared fixed fixture clock. */
    nowMs?: number;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "openverdict-engine-"));
  const manifest: ReleaseManifest = {
    ...testManifest(),
    ...(options.seal === undefined ? {} : { seal: options.seal }),
  };
  const manifestPath = join(directory, "release.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const db = createDb({ dataDir: "memory://" });
  if (!(db instanceof PGlite)) throw new Error("expected pglite");
  databases.push(db);
  const initialAgents = gateway.agents.map((agent, index) =>
    toEngineAgent(agent, index, options),
  );
  const fixtures =
    typeof runPlan === "number"
      ? gateway.agents.map((agent, index) => ({
          agentProfileId: agent.agentProfileId as `0x${string}`,
          outcome: "YES" as const,
          confidenceBps: 8_000,
          ...(options.actions === undefined ? {} : { actions: options.actions }),
          ...(options.decisiveEvidence === undefined
            ? {}
            : { decisiveEvidence: options.decisiveEvidence }),
          ...(options.unsupportedClaims === undefined
            ? {}
            : { unsupportedClaims: options.unsupportedClaims }),
          ...(options.deliberationResponses?.[index] === undefined
            ? {}
            : { deliberationResponses: options.deliberationResponses[index] }),
          ...(options.failures?.[index] === undefined
            ? {}
            : { failure: options.failures[index] }),
          ...(index < runPlan ? {} : { failure: "provider_5xx" as const }),
        }))
      : gateway.agents.flatMap((agent, index) =>
          runPlan.map((round, roundIndex) => ({
            agentProfileId: agent.agentProfileId as `0x${string}`,
            outcome: round[index] ?? "UNSURE",
            confidenceBps: 8_000,
            ...(options.actions === undefined ? {} : { actions: options.actions }),
            ...(options.decisiveEvidence === undefined
              ? {}
              : { decisiveEvidence: options.decisiveEvidence }),
            ...(options.unsupportedClaims === undefined
              ? {}
              : { unsupportedClaims: options.unsupportedClaims }),
            ...(roundIndex !== 0 || options.deliberationResponses?.[index] === undefined
              ? {}
              : { deliberationResponses: options.deliberationResponses[index] }),
          })),
        );
  const gonka = createFakeGonkaAdapter(fixtures);
  const gonkaComplete = vi.spyOn(gonka, "complete");
  const walrus = options.walrus ?? createLocalWalrusStore(join(directory, "walrus"));
  let nowMs = options.nowMs ?? Date.parse("2026-08-27T00:00:00.000Z");
  const engine = await createEngine({
    network: "localnet",
    manifestPath,
    db,
    walrus,
    gonka,
    suiGateway: gateway,
    initialAgents,
    ...(options.sealEscrow === undefined
      ? {}
      : { sealEscrow: options.sealEscrow }),
    ...(options.research === undefined ? {} : { research: options.research }),
    now: () => nowMs,
    sleep: async () => undefined,
    eventPollIntervalMs: 5,
  });
  return {
    engine,
    db,
    gonka,
    gonkaComplete,
    walrus,
    now: () => nowMs,
    setNow: (value: number) => {
      nowMs = value;
    },
  };
}

async function roundTwoSetup(
  manifestVersion: "5" | "6",
  options: { unsupportedClaims?: string[] } = {},
) {
  const setup = await engineSetup(new FakeSuiGateway(), [
    ["YES", "YES", "YES", "NO", "NO"],
    ["NO", "NO", "NO", "NO", "YES"],
  ], options);
  const { claimId } = await setup.engine.factCheckStart({
    claim: "A split first round must end with a sealed table vote.",
    text: "Local evidence for the first round and the table.",
    urls: [],
  });
  await setup.engine.selectCommittee(claimId);
  await setup.engine.evidenceFreeze(claimId, 1);
  await setup.engine.juryRun(claimId, 1);
  await setup.engine.votesCommit(claimId, 1);
  await setup.engine.advance(claimId);
  await setup.engine.votesReveal(claimId, 1);
  await setup.engine.advance(claimId);
  await setup.engine.runDeliberation(claimId);
  await setup.engine.evidenceFreeze(claimId, 2);
  await publishAgentManifestDocuments(setup, manifestVersion);
  await setup.engine.advance(claimId);
  expect((await setup.engine.inspect(claimId)).state).toBe(CLAIM_STATE.COMMIT_2);
  return { ...setup, claimId };
}

async function publishAgentManifestDocuments(
  setup: Awaited<ReturnType<typeof engineSetup>>,
  version: "5" | "6",
): Promise<void> {
  const repository = createRepository(setup.db);
  const agents = await repository.listAgentManifests();
  for (const [index, agent] of agents.entries()) {
    const built = buildAgentManifestDocument({
      network: "localnet",
      backingKind: "TESTNET_DEMO_ALLOWLIST",
      humanBackingHash: agent.manifest.humanAttestationHash,
      humanVerificationProvider: agent.manifest.humanVerificationProvider,
      operationalOwner: agent.manifest.owner,
      role: agent.role,
      modelId: agent.manifest.modelId,
      promptSpec: DEFAULT_PROMPT_SPEC_V4,
      toolPolicy: DEFAULT_TOOL_POLICY_V4,
      ...(version === "6"
        ? { tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1 }
        : {}),
      evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
    });
    const upload = await setup.walrus.put(built.bytes, {
      identifier: `agent-${index}-manifest-v${version}.json`,
    });
    await repository.saveAgentManifest({
      ...agent,
      manifest: {
        ...agent.manifest,
        version: built.document.version,
        manifestBlobId: upload.blobId,
        manifestHash: built.manifestHash,
        promptHash: built.promptHash,
        ...(built.tableVotePromptHash === undefined
          ? {}
          : { tableVotePromptHash: built.tableVotePromptHash }),
        toolPolicyHash: built.toolPolicyHash,
        evidencePolicyHash: built.document.evidencePolicyHash,
        registeredCheckpoint: agent.manifest.registeredCheckpoint + 1,
      },
    });
  }
}

async function discussionSetup(
  revealedDebaters: number,
  deliberationResponses: Partial<Record<number, string[]>> = {},
) {
  const setup = await engineSetup(new FakeSuiGateway(), revealedDebaters, {
    deliberationResponses,
  });
  const { claimId } = await setup.engine.factCheckStart({
    claim: "A split result should enter a public deliberation.",
    text: "Local evidence supports more than one interpretation.",
    urls: [],
  });
  await setup.engine.selectCommittee(claimId);
  await setup.engine.evidenceFreeze(claimId, 1);
  await setup.engine.juryRun(claimId, 1);
  await setup.engine.votesCommit(claimId, 1);
  await setup.engine.advance(claimId);
  await setup.engine.votesReveal(claimId, 1);
  await setup.engine.advance(claimId);
  expect((await setup.engine.inspect(claimId)).state).toBe(CLAIM_STATE.DISCUSSION);
  return { ...setup, claimId };
}

function deliberationResponse(
  argument: string,
  citations: string[] = [],
  stance: TableVoteStance = "YES",
  confidenceBps = 8_000,
): string {
  return JSON.stringify({ argument, citations, stance, confidenceBps });
}

function publicDeliberationTurn(record: DeliberationTurnRecord) {
  return {
    claimId: record.claimId,
    jurySeatId: record.jurySeatId,
    agentProfileId: record.agentProfileId,
    ...(record.modelId === undefined ? {} : { modelId: record.modelId }),
    ordinal: record.ordinal,
    exchange: record.exchange,
    argument: record.argument,
    citations: record.citations,
    ...(record.stance === undefined ? {} : { stance: record.stance }),
    ...(record.confidenceBps === undefined
      ? {}
      : { confidenceBps: record.confidenceBps }),
    status: record.status,
    ...(record.failureStatus === undefined
      ? {}
      : { failureStatus: record.failureStatus }),
    atMs: record.atMs,
  };
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

function toEngineAgent(
  agent: FakeSuiAgent,
  index: number,
  options: {
    promptHash?: `0x${string}`;
    toolPolicyHash?: `0x${string}`;
  } = {},
): EngineAgentConfig {
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
    promptHash: options.promptHash ?? promptSpecHash(DEFAULT_PROMPT_SPEC_V2),
    modelId: agent.modelId,
    providerId: "gonkarouter",
    toolPolicyHash:
      options.toolPolicyHash ?? toolPolicyHash(DEFAULT_TOOL_POLICY_V2),
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

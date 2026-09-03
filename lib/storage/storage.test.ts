import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  createDb,
  createRepository,
  migrate,
  type ClaimRecord,
  type DeliberationTurnRecord,
  type FactCheckQueueRecord,
  type GonkaWeatherRecord,
  type InferenceRunRecord,
  type RunProofRecord,
  type StakeReservationRecord,
  type VerificationAttemptRecord,
} from "./index";

const openDatabases: PGlite[] = [];

async function testRepository() {
  const db = createDb({ dataDir: "memory://" });
  if (!("close" in db)) throw new Error("expected an embedded pglite database");
  openDatabases.push(db);
  await migrate(db);
  return createRepository(db);
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.close()));
});

describe("storage", () => {
  it("migrates idempotently and persists typed claims", async () => {
    const repository = await testRepository();
    await migrate(repository.db);

    const claim: ClaimRecord = {
      claimId: "0xclaim",
      network: "localnet",
      packageId: "0xpackage",
      registryObjectId: "0xregistry",
      coinType: "0x2::sui::SUI",
      mode: 1,
      state: 3,
      statement: "The test claim is true.",
      resolutionCriteria: "Use the frozen evidence.",
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
      committeeBudget: "10",
      evidenceBudget: "5",
      submittedUrls: [],
      evidencePolicyId: "0x01",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    await repository.saveClaim(claim);
    expect(await repository.getClaim(claim.claimId)).toEqual(claim);
  });

  it("round trips immutable run proofs and supports explicit replacement", async () => {
    const repository = await testRepository();
    const record: RunProofRecord = {
      runId: "run-proof-1",
      claimId: "claim-proof-1",
      phase: 1,
      proofJson: JSON.stringify({ runId: "run-proof-1", revealed: true }),
      builtAt: "2026-08-27T00:00:00.000Z",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };

    await repository.saveRunProof(record);
    await repository.saveRunProof({
      ...record,
      proofJson: JSON.stringify({ runId: "run-proof-1", replaced: true }),
    });

    await expect(repository.getRunProof(record.runId)).resolves.toEqual(record);
    await expect(
      repository.listRunProofIdsForClaim(record.claimId),
    ).resolves.toEqual([record.runId]);

    const replacement = {
      ...record,
      proofJson: JSON.stringify({ runId: "run-proof-1", repaired: true }),
      updatedAt: "2026-08-27T00:01:00.000Z",
    };
    await repository.replaceRunProof(replacement);
    await expect(repository.getRunProof(record.runId)).resolves.toEqual(replacement);
  });

  it("round trips immutable deliberation turns in ordinal order", async () => {
    const repository = await testRepository();
    const first: DeliberationTurnRecord = {
      turnId: "claim-deliberation:0",
      claimId: "claim-deliberation",
      jurySeatId: "seat-1",
      agentProfileId: "agent-1",
      modelId: "model-1",
      ordinal: 0,
      exchange: 1,
      argument: "The first juror defends the cited evidence.",
      citations: ["evidence-1"],
      status: "SPOKEN",
      atMs: 1_000,
      gonkaRequestId: "request-1",
      promptSpecHash: `0x${"11".repeat(32)}`,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const second: DeliberationTurnRecord = {
      ...first,
      turnId: "claim-deliberation:1",
      jurySeatId: "seat-2",
      agentProfileId: "agent-2",
      ordinal: 1,
      argument: "The second juror challenges the first seat.",
      citations: [],
      gonkaRequestId: "request-2",
    };

    await repository.saveDeliberationTurn(second);
    await repository.saveDeliberationTurn(first);
    await repository.saveDeliberationTurn({
      ...first,
      argument: "A conflicting retry must not replace the first turn.",
    });

    await expect(
      repository.listDeliberationTurns(first.claimId),
    ).resolves.toEqual([first, second]);
  });

  it("lists claims newest first, with and without a state filter", async () => {
    const repository = await testRepository();
    await migrate(repository.db);

    const base: ClaimRecord = {
      claimId: "0xolder",
      network: "localnet",
      packageId: "0xpackage",
      registryObjectId: "0xregistry",
      coinType: "0x2::sui::SUI",
      mode: 1,
      state: 3,
      statement: "The older claim.",
      resolutionCriteria: "Use the frozen evidence.",
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
      committeeBudget: "10",
      evidenceBudget: "5",
      submittedUrls: [],
      evidencePolicyId: "0x01",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    await repository.saveClaim(base);
    await repository.saveClaim({
      ...base,
      claimId: "0xnewer",
      statement: "The newer claim.",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    await repository.saveClaim({
      ...base,
      claimId: "0xsettled",
      state: 10,
      statement: "The settled claim.",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    });

    // The API, the landing hero and the console home all read this order as "latest".
    expect((await repository.listClaims()).map((record) => record.claimId)).toEqual([
      "0xsettled",
      "0xnewer",
      "0xolder",
    ]);
    expect((await repository.listClaims(3)).map((record) => record.claimId)).toEqual([
      "0xnewer",
      "0xolder",
    ]);
  });

  it("round trips an inference failure through its JSONB column", async () => {
    const repository = await testRepository();
    const hash = `0x${"11".repeat(32)}` as const;
    const runId = `0x${"22".repeat(32)}` as const;
    const audit: InferenceRunRecord["audit"] = {
      runId,
      claimObjectId: `0x${"33".repeat(32)}`,
      agentProfileId: `0x${"44".repeat(32)}`,
      jurySeatId: `0x${"55".repeat(32)}`,
      phase: 1,
      attempt: 1,
      providerId: "gonkarouter",
      modelId: "test-model",
      gonkaRequestId: "request-1",
      promptHash: hash,
      inputHash: hash,
      outputHash: hash,
      runWalrusBlobId: "",
      toolTranscriptHash: hash,
      toolTranscriptWalrusBlobId: "",
      toolCallCount: 1,
      evidenceRoot: hash,
      requestedAtMs: 10,
      completedAtMs: 20,
      latencyMs: 10,
      status: "CITATION_INVALID",
    };
    const failure: NonNullable<InferenceRunRecord["failure"]> = {
      version: 1,
      status: "CITATION_INVALID",
      message: "the final citation could not be verified",
      failedAtMs: 20,
      transcript: {
        version: 1,
        runId,
        provider: { name: "test", mode: "offline" },
        policyHash: hash,
        steps: [],
        opened: [],
        citations: [],
        counts: { searches: 1, opens: 0, turns: 1 },
      },
      attempts: [
        {
          type: "gonka-attempt",
          kind: "PRIMARY",
          audit,
          response: { id: "raw-reply-1", choices: [] },
          investigationFlags: [],
        },
      ],
      walrusBlobId: "failed-run-blob",
    };
    const record: InferenceRunRecord = {
      runId,
      claimId: audit.claimObjectId,
      phase: 1,
      agentProfileId: audit.agentProfileId,
      jurySeatId: audit.jurySeatId,
      attempt: 1,
      providerId: "gonkarouter",
      modelId: audit.modelId,
      gonkaRequestId: audit.gonkaRequestId,
      promptHash: hash,
      inputHash: hash,
      outputHash: hash,
      toolTranscriptHash: hash,
      evidenceRoot: hash,
      validationStatus: "CITATION_INVALID",
      latencyMs: 10,
      audit,
      failure,
      requestedAt: "1970-01-01T00:00:00.010Z",
      completedAt: "1970-01-01T00:00:00.020Z",
      createdAt: "1970-01-01T00:00:00.020Z",
      updatedAt: "1970-01-01T00:00:00.020Z",
    };

    await repository.saveInferenceRun(record);

    await expect(repository.listInferenceRuns(record.claimId, 1)).resolves.toEqual([
      record,
    ]);
    if (!(repository.db instanceof PGlite)) throw new Error("expected pglite");
    const raw = await repository.db.query<{ failure: unknown }>(
      "SELECT failure FROM inference_runs WHERE run_id = $1",
      [runId],
    );
    expect(raw.rows[0]?.failure).toEqual(failure);
  });

  it("assigns stable, monotonically increasing per-claim event sequences", async () => {
    const repository = await testRepository();
    const first = await repository.appendResolutionEvent({
      eventId: "evt-1",
      claimId: "0xclaim",
      phase: "CREATE",
      kind: "claim_created",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      occurredAt: "2026-08-27T00:00:00.000Z",
      payload: {},
    });
    const second = await repository.appendResolutionEvent({
      eventId: "evt-2",
      claimId: "0xclaim",
      phase: "EVIDENCE",
      kind: "evidence_submitted",
      source: "EVIDENCE",
      visibility: "PUBLIC_NOW",
      occurredAt: "2026-08-27T00:00:01.000Z",
      payload: {},
    });
    const otherClaim = await repository.appendResolutionEvent({
      eventId: "evt-3",
      claimId: "0xother",
      phase: "CREATE",
      kind: "claim_created",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      occurredAt: "2026-08-27T00:00:02.000Z",
      payload: {},
    });

    expect([first.sequence, second.sequence, otherClaim.sequence]).toEqual([1, 2, 1]);
    await expect(
      repository.appendResolutionEvent({
        ...first,
        sequence: undefined,
      }),
    ).resolves.toEqual(first);
    expect(await repository.listResolutionEvents("0xclaim", 1)).toEqual([
      first,
      second,
    ]);
  });

  it("persists Sui cursors as internal append-only records", async () => {
    const repository = await testRepository();
    await repository.saveSuiCursor("jury", "cursor-1");
    await repository.saveSuiCursor("jury", "cursor-2");

    expect(await repository.latestSuiCursor("jury")).toBe("cursor-2");
    const records = await repository.listResolutionEvents("__sui_cursor__:jury");
    expect(records).toHaveLength(2);
    expect(records.every((event) => event.visibility === "INTERNAL_REDACTED")).toBe(true);
  });
});

describe("verification attempts", () => {
  it("saves, updates and lists attempts of one verification", async () => {
    const repo = await testRepository();
    const first: VerificationAttemptRecord = {
      verificationId: "0xaaa",
      claimId: "0xaaa",
      attempt: 1,
      status: "ACTIVE",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    await repo.saveVerificationAttempt(first);
    await repo.saveVerificationAttempt({
      ...first,
      status: "VOIDED",
      voidReason: "TIMEOUT",
      voidedSeatId: "0xseat",
      relaunchedAs: "0xbbb",
      updatedAt: "2026-09-02T00:10:00.000Z",
    });
    await repo.saveVerificationAttempt({
      verificationId: "0xaaa",
      claimId: "0xbbb",
      attempt: 2,
      parentClaimId: "0xaaa",
      status: "ACTIVE",
      createdAt: "2026-09-02T00:10:00.000Z",
      updatedAt: "2026-09-02T00:10:00.000Z",
    });
    expect((await repo.getVerificationAttempt("0xaaa"))?.status).toBe("VOIDED");
    expect((await repo.listVerificationAttempts("0xaaa")).map((row) => row.attempt)).toEqual([1, 2]);
    expect((await repo.listVerificationAttemptsByStatus("VOIDED")).map((row) => row.claimId)).toEqual(["0xaaa"]);
    expect(await repo.getVerificationAttempt("0xnone")).toBeUndefined();
  });
});

describe("weather and submission queue", () => {
  it("round trips and updates the latest weather for each model", async () => {
    const repository = await testRepository();
    const rows: GonkaWeatherRecord[] = [
      {
        modelId: "deepseek-r1",
        ok: true,
        latencyMs: 120,
        status: "200",
        probedAt: "2026-09-03T00:00:00.000Z",
      },
      {
        modelId: "kimi-k2",
        ok: false,
        latencyMs: 60_000,
        status: "TIMEOUT",
        probedAt: "2026-09-03T00:00:00.000Z",
      },
    ];

    await repository.saveGonkaWeather(rows);
    await expect(repository.listGonkaWeather()).resolves.toEqual(rows);

    const updated = {
      ...rows[0]!,
      ok: false,
      latencyMs: 503,
      status: "503",
      probedAt: "2026-09-03T00:02:00.000Z",
    };
    await repository.saveGonkaWeather([updated]);
    await expect(repository.listGonkaWeather()).resolves.toEqual([
      updated,
      rows[1],
    ]);
  });

  it("round trips queue items, upserts state, and lists oldest first", async () => {
    const repository = await testRepository();
    const first: FactCheckQueueRecord = {
      queueId: `0x${"11".repeat(32)}`,
      status: "QUEUED",
      request: { claim: "The first queued claim.", urls: [] },
      holdReason: "WEATHER",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-09-03T06:00:00.000Z",
    };
    const second: FactCheckQueueRecord = {
      ...first,
      queueId: `0x${"22".repeat(32)}`,
      request: { claim: "The second queued claim.", urls: [] },
      createdAt: "2026-09-03T00:01:00.000Z",
      updatedAt: "2026-09-03T00:01:00.000Z",
      expiresAt: "2026-09-03T06:01:00.000Z",
    };

    await repository.saveFactCheckQueueItem(second);
    await repository.saveFactCheckQueueItem(first);
    await expect(repository.listFactCheckQueueItems("QUEUED")).resolves.toEqual([
      first,
      second,
    ]);

    const launched: FactCheckQueueRecord = {
      ...first,
      status: "LAUNCHED",
      launchedClaimId: "0xclaim",
      updatedAt: "2026-09-03T00:02:00.000Z",
    };
    await repository.saveFactCheckQueueItem(launched);
    await expect(repository.getFactCheckQueueItem(first.queueId)).resolves.toEqual(
      launched,
    );
    await expect(
      repository.listFactCheckQueueItems("QUEUED"),
    ).resolves.toEqual([second]);
  });

  it("round trips stake reservations and upserts them by reservation id", async () => {
    const repository = await testRepository();
    const reservation = stakeReservation();

    await repository.saveStakeReservation(reservation);
    await expect(
      repository.getStakeReservation(reservation.reservationId),
    ).resolves.toEqual(reservation);

    const confirmed: StakeReservationRecord = {
      ...reservation,
      status: "CONFIRMED",
      digest: "digest-1",
      agentProfileId: `0x${"33".repeat(32)}`,
      stakeMist: "100000000",
      gasFloat: "funded",
    };
    await repository.saveStakeReservation(confirmed);
    await expect(
      repository.getStakeReservation(reservation.reservationId),
    ).resolves.toEqual(confirmed);
    await expect(
      repository.getStakeReservation("missing-reservation"),
    ).resolves.toBeUndefined();
  });

  it("lists only pending reservations that have not expired, oldest first", async () => {
    const repository = await testRepository();
    const live = stakeReservation({
      reservationId: "reservation-live",
      createdAt: "2026-09-04T00:01:00.000Z",
      expiresAt: "2026-09-04T00:16:00.000Z",
    });
    const older = stakeReservation({
      reservationId: "reservation-older",
      createdAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2026-09-04T00:15:00.000Z",
    });
    const stale = stakeReservation({
      reservationId: "reservation-stale",
      createdAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-09-03T00:15:00.000Z",
    });
    const confirmed = stakeReservation({
      reservationId: "reservation-confirmed",
      status: "CONFIRMED",
      expiresAt: "2026-09-04T00:20:00.000Z",
    });

    for (const record of [live, older, stale, confirmed]) {
      await repository.saveStakeReservation(record);
    }

    await expect(
      repository.listPendingStakeReservations("2026-09-04T00:05:00.000Z"),
    ).resolves.toEqual([older, live]);
  });
});

function stakeReservation(
  overrides: Partial<StakeReservationRecord> = {},
): StakeReservationRecord {
  return {
    reservationId: "reservation-1",
    stakerAddress: `0x${"ab".repeat(32)}`,
    slotIndex: 7,
    operationalOwner: `0x${"cd".repeat(32)}`,
    modelId: "model-a",
    role: "SKEPTIC",
    manifestHash: `0x${"11".repeat(32)}`,
    manifestBlobId: "blob-1",
    documentVersion: "6",
    promptHash: `0x${"22".repeat(32)}`,
    toolPolicyHash: `0x${"44".repeat(32)}`,
    evidencePolicyHash: `0x${"55".repeat(32)}`,
    stakerHash: `0x${"66".repeat(32)}`,
    status: "PENDING",
    createdAt: "2026-09-04T00:00:00.000Z",
    expiresAt: "2026-09-04T00:15:00.000Z",
    ...overrides,
  };
}

import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  createDb,
  createRepository,
  migrate,
  type ClaimRecord,
  type InferenceRunRecord,
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

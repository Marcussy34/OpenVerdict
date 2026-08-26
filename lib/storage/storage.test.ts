import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createDb,
  createRepository,
  migrate,
  type ClaimRecord,
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

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function suiArtifact(record: JsonRecord | undefined, objectKey: string) {
  if (!record) return undefined;
  const objectId = stringField(record, objectKey);
  const transactionDigest = stringField(record, "transactionDigest");
  if (!objectId && !transactionDigest) return undefined;
  return {
    ...(objectId ? { objectId } : {}),
    ...(transactionDigest ? { transactionDigest } : {}),
  };
}

// A revealed run's proof is immutable (the bundle is content-addressed and the
// commitment is on chain), but building it costs two Walrus testnet reads of
// about ten seconds. Serve repeats from memory and let browsers cache it.
const IMMUTABLE_CACHE = new Map<string, JsonRecord>();
const IMMUTABLE_CACHE_LIMIT = 200;
const IMMUTABLE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

/** Return the public proof material for one inference run. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, runId } = await context.params;
    if (!id || !runId) {
      return NextResponse.json(
        { error: "validation_error", message: "claim id and run id are required" },
        { status: 400 },
      );
    }

    const cacheKey = `${id}:${runId}`;
    const cached = IMMUTABLE_CACHE.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200, headers: IMMUTABLE_HEADERS });
    }

    const engine = await getServerEngine();
    const proof = (await engine.runProof(id, runId)) as
      | Awaited<ReturnType<typeof engine.runProof>>
      | null;
    if (!proof) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }

    // The public report carries the Sui objects that settle this specific run.
    const report = await engine.report(id);
    const auditBundle = report.auditBundle;
    const runApproval = records(auditBundle.runApprovals).find(
      (item) => stringField(item, "runId") === runId,
    );
    const commitment = records(auditBundle.commitments).find(
      (item) =>
        stringField(item, "jurySeatId") === proof.jurySeatId &&
        item.phase === proof.phase,
    );
    const reveal = records(auditBundle.reveals).find(
      (item) => stringField(item, "runId") === runId,
    );
    const runApprovalArtifact = suiArtifact(runApproval, "runApprovalId");
    const commitmentArtifact = suiArtifact(commitment, "votePackageId");
    const revealArtifact = suiArtifact(reveal, "revealedVoteId");

    const body: JsonRecord = {
      ...proof,
      sui: {
        claimObjectId: proof.bundle?.audit.claimObjectId ?? proof.claimId,
        agentProfileId: proof.agentProfileId,
        jurySeatId: proof.jurySeatId,
        ...(runApprovalArtifact
          ? { runApproval: runApprovalArtifact }
          : {}),
        ...(commitmentArtifact
          ? { commitment: commitmentArtifact }
          : {}),
        ...(revealArtifact
          ? { reveal: revealArtifact }
          : {}),
      },
    };

    // Only a revealed proof is final; pre-reveal responses change at reveal.
    if (proof.revealed === true) {
      if (IMMUTABLE_CACHE.size >= IMMUTABLE_CACHE_LIMIT) {
        const oldest = IMMUTABLE_CACHE.keys().next().value;
        if (oldest !== undefined) IMMUTABLE_CACHE.delete(oldest);
      }
      IMMUTABLE_CACHE.set(cacheKey, body);
      return NextResponse.json(body, { status: 200, headers: IMMUTABLE_HEADERS });
    }
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    if (
      (error as Error)?.name === "EngineValidationError" &&
      (error as Error)?.message.includes("was not found")
    ) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

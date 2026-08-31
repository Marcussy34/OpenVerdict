import type { Engine } from "../engine/contract";
import type { RunProofRecord } from "../storage";

type JsonRecord = Record<string, unknown>;

interface RunProofStorage {
  getStoredRunProof(runId: string): Promise<RunProofRecord | undefined>;
  saveStoredRunProof(
    record: RunProofRecord,
    options: { replace: boolean },
  ): Promise<void>;
}

export interface PublicRunProofLoad {
  body: JsonRecord;
  immutable: boolean;
}

interface ParsedProofCacheEntry {
  proofJson: string;
  body: JsonRecord;
}

const PARSED_PROOF_CACHE = new Map<string, ParsedProofCacheEntry>();
const PENDING_PROOF_BUILDS = new Map<
  string,
  Promise<PublicRunProofLoad | null>
>();
const PARSED_PROOF_CACHE_LIMIT = 200;

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

function proofStorage(engine: Engine): RunProofStorage {
  const candidate = engine as Engine & Partial<RunProofStorage>;
  if (
    typeof candidate.getStoredRunProof !== "function" ||
    typeof candidate.saveStoredRunProof !== "function"
  ) {
    throw new Error("run proof storage is not wired");
  }
  return candidate as Engine & RunProofStorage;
}

function parseStoredProof(record: RunProofRecord): JsonRecord | undefined {
  try {
    const body: unknown = JSON.parse(record.proofJson);
    if (
      !isRecord(body) ||
      body.runId !== record.runId ||
      body.claimId !== record.claimId ||
      body.phase !== record.phase ||
      body.revealed !== true
    ) {
      return undefined;
    }
    return body;
  } catch {
    return undefined;
  }
}

function cacheProof(cacheKey: string, proofJson: string, body: JsonRecord): void {
  if (PARSED_PROOF_CACHE.size >= PARSED_PROOF_CACHE_LIMIT) {
    const oldest = PARSED_PROOF_CACHE.keys().next().value;
    if (oldest !== undefined) PARSED_PROOF_CACHE.delete(oldest);
  }
  PARSED_PROOF_CACHE.set(cacheKey, { proofJson, body });
}

function runNotFound(claimId: string, runId: string): Error {
  const error = new Error(
    `inference run ${runId} was not found for claim ${claimId}`,
  );
  error.name = "EngineValidationError";
  return error;
}

/** Build the complete public proof body used by the API and finalizer. */
async function buildPublicRunProof(
  engine: Engine,
  claimId: string,
  runId: string,
): Promise<JsonRecord | null> {
  const proof = await engine.runProof(claimId, runId);
  if (!proof) return null;

  const report = await engine.report(claimId);
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

  return {
    ...proof,
    sui: {
      claimObjectId: proof.bundle?.audit.claimObjectId ?? proof.claimId,
      agentProfileId: proof.agentProfileId,
      jurySeatId: proof.jurySeatId,
      ...(runApprovalArtifact ? { runApproval: runApprovalArtifact } : {}),
      ...(commitmentArtifact ? { commitment: commitmentArtifact } : {}),
      ...(revealArtifact ? { reveal: revealArtifact } : {}),
    },
  };
}

async function buildAndPersistPublicRunProof(
  engine: Engine,
  storage: RunProofStorage,
  claimId: string,
  runId: string,
  existing: RunProofRecord | undefined,
): Promise<PublicRunProofLoad | null> {
  const body = await buildPublicRunProof(engine, claimId, runId);
  if (!body) return null;
  const immutable = body.revealed === true;
  if (!immutable) return { body, immutable: false };

  const timestamp = new Date().toISOString();
  const proofJson = JSON.stringify(body);
  await storage.saveStoredRunProof(
    {
      runId,
      claimId,
      phase: body.phase as 1 | 2,
      proofJson,
      builtAt: timestamp,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    },
    { replace: existing !== undefined },
  );
  cacheProof(`${claimId}:${runId}`, proofJson, body);
  return { body, immutable: true };
}

/** Load an immutable proof from Postgres or build and persist it once. */
export async function getOrBuildPublicRunProof(
  engine: Engine,
  claimId: string,
  runId: string,
): Promise<PublicRunProofLoad | null> {
  const storage = proofStorage(engine);
  const cacheKey = `${claimId}:${runId}`;
  const stored = await storage.getStoredRunProof(runId);
  if (stored && stored.claimId !== claimId) throw runNotFound(claimId, runId);

  if (stored) {
    const cached = PARSED_PROOF_CACHE.get(cacheKey);
    if (cached?.proofJson === stored.proofJson) {
      return { body: cached.body, immutable: true };
    }
    const body = parseStoredProof(stored);
    if (body) {
      cacheProof(cacheKey, stored.proofJson, body);
      return { body, immutable: true };
    }
    PARSED_PROOF_CACHE.delete(cacheKey);
  }

  const pending = PENDING_PROOF_BUILDS.get(cacheKey);
  if (pending) return pending;
  const build = buildAndPersistPublicRunProof(
    engine,
    storage,
    claimId,
    runId,
    stored,
  );
  PENDING_PROOF_BUILDS.set(cacheKey, build);
  try {
    return await build;
  } finally {
    PENDING_PROOF_BUILDS.delete(cacheKey);
  }
}

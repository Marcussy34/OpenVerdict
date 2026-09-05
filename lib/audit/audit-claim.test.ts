import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { EMPTY_TOOL_TRANSCRIPT_HASH } from "../gonka/audit";
import { canonicalJsonBytes } from "../gonka/canonical";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import {
  DEFAULT_PROMPT_SPEC_V1,
  TABLE_VOTE_PROMPT_SPEC_V1,
  promptSpecHash,
  tableVotePromptSpecHash,
} from "../gonka/promptSpec";
import { buildTableVoteBundleCore, sealRunBundle } from "../engine/runBundle";
import type { AttemptChain, ClaimInspection, FactCheckReport } from "../engine/contract";
import { buildEvidenceManifest } from "../evidence/manifest";
import { computeRunHash, computeVoteCommitment } from "../protocol/commitment";
import { CLAIM_RESULT, CLAIM_STATE, OUTCOME } from "../protocol/constants";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import { sampleTableVoteInput } from "../protocol/table-vote.fixture";
import { computeTruthScoreBps } from "../protocol/truthScore";
import type {
  HexString,
  InferenceRunAudit,
  PublicRunBundleCoreV2,
  PublicRunBundleCoreV6,
  PublicRunBundleV2,
  PublicRunBundleV6,
} from "../protocol/types";
import { deriveRunId, proofFromBundle } from "../verify/run-proof";
import {
  AuditInputError,
  auditClaim,
  compareReceipt,
  parseAuditTarget,
  parseCertificateFields,
  parseCommitEvent,
  parseObjectFields,
  parseRevealInputs,
  recomputeManifestRoot,
  renderJson,
  renderMarkdown,
  renderVerdictCard,
  type AuditCheck,
  type AuditResult,
  listBoard,
  renderBoard,
} from "./audit-claim";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const BASE = "https://audit.test";
const PACKAGE = `0x${"ab".repeat(32)}`;
const utf8 = new TextEncoder();

type Json = Record<string, unknown>;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function hexId(tag: number, index: number): HexString {
  return `0x${tag.toString(16).padStart(2, "0")}${index.toString(16).padStart(2, "0")}${"00".repeat(30)}`;
}

function bytes(hex: string): number[] {
  return [...fromHex(hex)];
}

// ---------------------------------------------------------------------------
// Synthetic claim world: every hash is consistent, every source is fake
// ---------------------------------------------------------------------------

type Vote = { outcome: "YES" | "NO" | "UNSURE"; confidenceBps: number };

type SeatSpec = {
  model: string;
  role: string;
  /** Round-one vote; absent means the seat failed closed. */
  vote?: Vote;
  failure?: string;
  /** Committed and sealed, not revealed (in-progress claims). */
  committedOnly?: boolean;
  vote2?: Vote;
  failure2?: string;
};

type WorldSpec = {
  claimId: HexString;
  statement?: string;
  seats: SeatSpec[];
  state: number;
  twoRound?: boolean;
  /** Which deliberation contract the debate turns ran on. Defaults to V3. */
  debateSpec?: "3" | "4";
  result?: "YES" | "NO" | "UNRESOLVED";
  /** What the registry demanded when this committee was drawn. Three normally. */
  requiredFamilies?: number;
  attemptChain?: AttemptChain;
  tamper?: { recordCommitment?: boolean; certificateScore?: boolean };
};

type SeatWorld = {
  phase: 1 | 2;
  index: number;
  jurySeatId: HexString;
  agentProfileId: HexString;
  runId: HexString;
  spec: SeatSpec;
  vote?: Vote;
  failure?: string;
  committedOnly: boolean;
  commitment?: HexString;
  commitTx?: string;
  revealTx?: string;
  revealedVoteId?: HexString;
  runHash?: HexString;
  outputHash?: HexString;
  requestId?: string;
  proof: Json;
};

export type FakeWorld = {
  spec: WorldSpec;
  claimId: HexString;
  inspection: ClaimInspection;
  report: FactCheckReport;
  events: Json[];
  seats: SeatWorld[];
  proofs: Map<string, Json>;
  transactions: Map<string, Json>;
  objects: Map<string, Json>;
  receipts: Map<string, Json>;
  blobs: Map<string, string>;
  roots: Partial<Record<1 | 2, HexString>>;
  certificateId?: HexString;
};

const T0 = Date.parse("2026-09-03T03:17:00Z");

function outcomeCode(vote: Vote): 1 | 2 | 3 {
  return vote.outcome === "YES" ? OUTCOME.YES : vote.outcome === "NO" ? OUTCOME.NO : OUTCOME.UNSURE;
}

function manifestFor(claimId: string, phase: 1 | 2) {
  const statementHash = blake2b256(utf8.encode("statement"));
  const items = [
    {
      evidenceId: "evidence-table-1",
      contentHash: statementHash,
      canonicalHash: statementHash,
      sourceUrl: "urn:openverdict:claim-statement",
      canonicalWalrusBlobId: "blob-statement",
    },
  ];
  if (phase === 2) {
    const transcriptHash = blake2b256(utf8.encode("transcript"));
    const recordHash = blake2b256(utf8.encode("record"));
    items.push(
      {
        evidenceId: `deliberation-transcript:${claimId}`,
        contentHash: transcriptHash,
        canonicalHash: transcriptHash,
        sourceUrl: "urn:openverdict:deliberation-transcript",
        canonicalWalrusBlobId: "blob-transcript",
      },
      {
        evidenceId: `round-1-public-record:${claimId}`,
        contentHash: recordHash,
        canonicalHash: recordHash,
        sourceUrl: "urn:openverdict:round-1-public-record",
        canonicalWalrusBlobId: "blob-record",
      },
    );
  }
  const built = buildEvidenceManifest(items);
  return { root: toHex(built.root), json: built.manifestJson, items };
}

function runHashFromAudit(audit: InferenceRunAudit): HexString {
  return toHex(
    computeRunHash({
      run_id: audit.runId,
      claim_object_id: audit.claimObjectId,
      agent_profile_id: audit.agentProfileId,
      jury_seat_id: audit.jurySeatId,
      phase: audit.phase,
      attempt: audit.attempt,
      provider_id: audit.providerId,
      model_id: audit.modelId,
      gonka_request_id: audit.gonkaRequestId,
      prompt_hash: fromHex(audit.promptHash),
      input_hash: fromHex(audit.inputHash),
      output_hash: fromHex(audit.outputHash),
      tool_transcript_hash: fromHex(audit.toolTranscriptHash),
      evidence_root: fromHex(audit.evidenceRoot),
      requested_at_ms: audit.requestedAtMs,
      completed_at_ms: audit.completedAtMs,
    }),
  );
}

function makeAudit(seat: { runId: HexString; claimId: HexString; agentProfileId: HexString; jurySeatId: HexString; phase: 1 | 2; index: number; model: string }, hashes: { promptHash: HexString; inputHash: HexString; outputHash: HexString; toolTranscriptHash: HexString; evidenceRoot: HexString }): InferenceRunAudit {
  const requestedAtMs = T0 + seat.phase * 600_000 + seat.index * 20_000;
  return {
    runId: seat.runId,
    claimObjectId: seat.claimId,
    agentProfileId: seat.agentProfileId,
    jurySeatId: seat.jurySeatId,
    phase: seat.phase,
    attempt: 1,
    providerId: "gonkarouter",
    modelId: seat.model,
    responseModelId: seat.model,
    gonkaRequestId: `devshard-${7000 + seat.index}-${seat.phase}`,
    promptHash: hashes.promptHash,
    inputHash: hashes.inputHash,
    outputHash: hashes.outputHash,
    runWalrusBlobId: "",
    toolTranscriptHash: hashes.toolTranscriptHash,
    toolTranscriptWalrusBlobId: "",
    toolCallCount: 0,
    evidenceRoot: hashes.evidenceRoot,
    requestedAtMs,
    completedAtMs: requestedAtMs + 15_000,
    latencyMs: 15_000,
    gatewayRequestId: `req-${seat.phase}${seat.index}-000`,
    devshardId: `${7000 + seat.index}`,
    status: "SCHEMA_VALID",
  };
}

/** A legacy v2 research bundle (five checks) for round one. */
function makeResearchBundle(seat: SeatWorld & { claimId: HexString; model: string }, root: HexString, vote: Vote) {
  const input = makeInput({ runId: seat.runId, evidenceManifest: { ...makeInput().evidenceManifest, root } });
  const validatedOutput = makeOutput({
    outcome: vote.outcome,
    confidenceBps: vote.confidenceBps,
    citations: [{ evidenceId: "evidence-1", url: "https://example.org/source", quote: "The source says so." }],
  });
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V1);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const audit = makeAudit(seat, { promptHash, inputHash, outputHash, toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH, evidenceRoot: root });
  const runHash = runHashFromAudit(audit);
  const core: PublicRunBundleCoreV2 = {
    version: 2,
    kind: "run-bundle",
    runId: seat.runId,
    claimId: seat.claimId,
    phase: seat.phase,
    agentProfileId: seat.agentProfileId,
    jurySeatId: seat.jurySeatId,
    promptSpec: DEFAULT_PROMPT_SPEC_V1,
    promptHash,
    input,
    inputHash,
    request: {
      model: seat.model,
      temperature: 0,
      maxTokens: 4096,
      responseFormat: "json_object",
      attemptKind: "PRIMARY",
      messages: [
        { role: "system", content: DEFAULT_PROMPT_SPEC_V1.systemPrompt },
        { role: "user", content: new TextDecoder().decode(canonicalJsonBytes(input)) },
      ],
    },
    attempts: [],
    rawResponse: { id: audit.gonkaRequestId, model: seat.model },
    gateway: { gatewayRequestId: audit.gatewayRequestId, devshardId: audit.devshardId },
    validatedOutput,
    outputHash,
    audit,
    runHash,
    verify: {
      promptHash: "blake2b256(canonicalJson(promptSpec))",
      inputHash: "blake2b256(canonicalJson(input))",
      outputHash: "blake2b256(canonicalJson(validatedOutput))",
      runHash: "blake2b256(BCS(RunRecordV1))",
      commitment: "blake2b256(BCS(VotePreimageV1))",
    },
  };
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV2 = { ...core, seal: { ...seal, sealedBlobId: `sealed-${seat.phase}-${seat.index}` } };
  return { bundle, sealed, audit, runHash, outputHash };
}

/** A v6 table-vote bundle for round two. */
function makeTableVoteBundle(seat: SeatWorld & { claimId: HexString; model: string }, root: HexString, manifestItems: Array<{ evidenceId: string; contentHash: Uint8Array }>, vote: Vote) {
  const sample = sampleTableVoteInput();
  const input = {
    ...sample,
    runId: seat.runId,
    evidenceManifest: {
      root,
      items: manifestItems.map((item) => ({
        evidenceId: item.evidenceId,
        sourceClass: "PRIMARY",
        retrievedAt: "2026-09-02T00:00:00.000Z",
        walrusBlobId: `walrus-${item.evidenceId.slice(0, 8)}`,
        contentHash: toHex(item.contentHash),
        excerpt: "frozen",
      })),
    },
  };
  const validatedOutput = makeOutput({
    outcome: vote.outcome,
    confidenceBps: vote.confidenceBps,
    evidenceFor: ["evidence-table-1"],
    evidenceAgainst: [],
    decisiveEvidence: ["evidence-table-1"],
    publicReasoningTrace: [
      { check: "Weigh the table.", evidenceIds: ["evidence-table-1"], assessment: "SUPPORTS", finding: "The frozen source decides it." },
    ],
  });
  const promptHash = promptSpecHash(TABLE_VOTE_PROMPT_SPEC_V1);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const audit = makeAudit(seat, { promptHash, inputHash, outputHash, toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH, evidenceRoot: root });
  const runHash = runHashFromAudit(audit);
  const core: PublicRunBundleCoreV6 = buildTableVoteBundleCore({
    input,
    runResult: {
      type: "gonka-run-result",
      attempts: [],
      response: { id: audit.gonkaRequestId, model: seat.model },
      request: {
        model: seat.model,
        temperature: 0,
        maxTokens: TABLE_VOTE_PROMPT_SPEC_V1.maxOutputTokens,
        responseFormat: "json_object",
        attemptKind: "PRIMARY",
        messages: [
          { role: "system", content: TABLE_VOTE_PROMPT_SPEC_V1.systemPrompt },
          { role: "user", content: new TextDecoder().decode(canonicalJsonBytes(input)) },
        ],
      },
      gateway: { gatewayRequestId: audit.gatewayRequestId, devshardId: audit.devshardId },
    },
    validatedOutput,
    audit,
    runHash,
    promptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
  });
  const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
  const bundle: PublicRunBundleV6 = { ...core, seal: { ...seal, sealedBlobId: `sealed-${seat.phase}-${seat.index}` } };
  return { bundle, sealed, audit, runHash, outputHash };
}

function event(sequence: number, kind: string, phase: string, atMs: number, payload: Json, extra: Json = {}): Json {
  return {
    kind,
    phase,
    source: "SUI",
    claimId: payload.claim_id ?? "",
    eventId: `event-${sequence}`,
    payload,
    sequence,
    occurredAt: new Date(atMs).toISOString(),
    visibility: "PUBLIC_NOW",
    ...extra,
  };
}

export function buildWorld(spec: WorldSpec): FakeWorld {
  const claimId = spec.claimId;
  const twoRound = spec.twoRound === true;
  const finalPhase: 1 | 2 = twoRound ? 2 : 1;
  const roots: FakeWorld["roots"] = {};
  const manifests = { 1: manifestFor(claimId, 1), ...(twoRound ? { 2: manifestFor(claimId, 2) } : {}) } as Record<1 | 2, ReturnType<typeof manifestFor>>;
  roots[1] = manifests[1].root as HexString;
  if (twoRound) roots[2] = manifests[2].root as HexString;
  const blobs = new Map<string, string>();
  blobs.set("manifest-1", manifests[1].json);
  if (twoRound) blobs.set("manifest-2", manifests[2].json);

  const transactions = new Map<string, Json>();
  const objects = new Map<string, Json>();
  const receipts = new Map<string, Json>();
  const proofs = new Map<string, Json>();
  const events: Json[] = [];
  const seats: SeatWorld[] = [];
  let sequence = 1;
  const push = (kind: string, phase: string, atMs: number, payload: Json, extra: Json = {}) => {
    events.push(event(sequence, kind, phase, atMs, payload, extra));
    sequence += 1;
  };

  const phaseOneSeatIds = spec.seats.map((_, index) => hexId(0x51, index));
  const phaseTwoSeatIds = spec.seats.map((_, index) => hexId(0x52, index));
  const agentIds = spec.seats.map((_, index) => hexId(0xa0, index));
  const committeeId = hexId(0xc0, 0);
  push("claim_created", "CREATE", T0, { claim_id: claimId, package_id: PACKAGE, transaction_digest: "create-tx" }, { transactionDigest: "create-tx" });
  push("committee_selected", "COMMIT_1", T0 + 30_000, { claim_id: claimId, committee_id: committeeId, jury_seat_ids: phaseOneSeatIds, agent_profile_ids: agentIds, transaction_digest: "committee-tx" }, { transactionDigest: "committee-tx" });

  const runApprovals: Json[] = [];
  const commitments: Json[] = [];
  const reveals: Json[] = [];
  const bundleRuns: Json[] = [];
  const deadlineBase = T0 + 3_600_000;

  for (const phase of twoRound ? ([1, 2] as const) : ([1] as const)) {
    const root = roots[phase]!;
    push("evidence_frozen", `ROUND_${phase}`, T0 + phase * 500_000, { root, phase, claim_id: claimId, manifest_blob_id: `manifest-${phase}`, evidence_bundle_id: hexId(0xe0, phase), transaction_digest: `freeze-${phase}` }, { transactionDigest: `freeze-${phase}`, artifactHash: root });
    spec.seats.forEach((seatSpec, index) => {
      const jurySeatId = (phase === 1 ? phaseOneSeatIds : phaseTwoSeatIds)[index]!;
      const agentProfileId = agentIds[index]!;
      const vote = phase === 1 ? seatSpec.vote : seatSpec.vote2;
      const failure = phase === 1 ? seatSpec.failure : seatSpec.failure2;
      const seat: SeatWorld = {
        phase,
        index,
        jurySeatId,
        agentProfileId,
        runId: deriveRunId(claimId, jurySeatId, phase),
        spec: seatSpec,
        ...(vote ? { vote } : {}),
        ...(failure ? { failure } : {}),
        committedOnly: seatSpec.committedOnly === true && phase === 1,
        proof: {},
      };
      const sui: Json = { claimObjectId: claimId, agentProfileId, jurySeatId };
      if (!vote) {
        if (failure) {
          seat.proof = {
            runId: seat.runId,
            claimId,
            phase,
            agentProfileId,
            jurySeatId,
            promptHash: hexId(0x11, 1),
            inputHash: hexId(0x11, 2),
            outputHash: hexId(0x11, 3),
            runHash: null,
            gateway: {},
            sealedBlobId: null,
            sealed: null,
            revealedBlobId: null,
            revealed: false,
            bundle: null,
            failure: { version: 1, status: failure, message: "GonkaRouter provider request failed", failedAtMs: T0 + 100_000, transcript: null, attempts: [] },
            sui,
          };
          proofs.set(seat.runId, seat.proof);
          push("inference_failed", `INFERENCE_${phase}`, T0 + phase * 500_000 + 90_000, { run_id: seat.runId, category: failure, retry_count: 3 }, { runId: seat.runId });
        }
        seats.push(seat);
        return;
      }
      const model = seatSpec.model;
      const built =
        phase === 1
          ? makeResearchBundle({ ...seat, claimId, model }, root, vote)
          : makeTableVoteBundle({ ...seat, claimId, model }, root, manifests[2].items, vote);
      seat.runHash = built.runHash;
      seat.outputHash = built.outputHash;
      seat.requestId = built.audit.gatewayRequestId!;
      const salt = blake2b256(utf8.encode(`salt-${phase}-${index}`));
      const commitment = toHex(
        computeVoteCommitment({
          claim_id: claimId,
          agent_profile_id: agentProfileId,
          jury_seat_id: jurySeatId,
          phase,
          outcome: outcomeCode(vote),
          confidence_bps: vote.confidenceBps,
          evidence_root: fromHex(root),
          output_hash: fromHex(built.outputHash),
          run_hash: fromHex(built.runHash),
          salt,
        }),
      );
      seat.commitment = commitment;
      const approvalTx = `approve-${phase}-${index}`;
      const commitTx = `commit-${phase}-${index}`;
      const revealTx = `reveal-${phase}-${index}`;
      const revealedVoteId = hexId(0x70 + phase, index);
      const approvalId = hexId(0x60 + phase, index);
      const atMs = T0 + phase * 500_000 + 100_000 + index * 5_000;
      runApprovals.push({ runApprovalId: approvalId, runId: seat.runId, runHash: built.runHash, transactionDigest: approvalTx });
      push("run_approved", `INFERENCE_${phase}`, atMs, { run_id: seat.runId, run_hash: built.runHash, jury_seat_id: jurySeatId, run_approval_id: approvalId, agent_profile_id: agentProfileId, transaction_digest: approvalTx }, { transactionDigest: approvalTx, runId: seat.runId, artifactHash: built.runHash });
      seat.commitTx = commitTx;
      const recordedCommitment = spec.tamper?.recordCommitment && phase === 1 && index === 0 ? hexId(0xff, 0xff) : commitment;
      commitments.push({ votePackageId: hexId(0x80 + phase, index), phase, jurySeatId, agentProfileId, commitment: recordedCommitment, transactionDigest: commitTx, revealed: !seat.committedOnly });
      transactions.set(commitTx, {
        digest: commitTx,
        timestampMs: atMs + 1_000,
        checkpoint: 1,
        transaction: {
          data: {
            transaction: {
              kind: "ProgrammableTransaction",
              inputs: [
                { type: "object", objectType: "immOrOwnedObject", objectId: jurySeatId },
                { type: "object", objectType: "sharedObject", objectId: hexId(0xd0, 0) },
                { type: "object", objectType: "immOrOwnedObject", objectId: hexId(0xd1, index) },
                { type: "object", objectType: "immOrOwnedObject", objectId: approvalId },
                { type: "pure", valueType: "vector<u8>", value: bytes(commitment) },
                { type: "object", objectType: "sharedObject", objectId: "0x6" },
              ],
              transactions: [{ MoveCall: { package: PACKAGE, module: "jury", function: "commit_vote", arguments: [0, 1, 2, 3, 4, 5].map((input) => ({ Input: input })) } }],
            },
          },
        },
        events: [
          {
            type: `${PACKAGE}::jury::VoteCommitted`,
            parsedJson: { claim_id: claimId, commitment: bytes(commitment), jury_seat_id: jurySeatId, phase },
          },
        ],
      });
      push("vote_committed", `COMMIT_${phase}`, atMs + 1_000, { phase, claim_id: claimId, jury_seat_id: jurySeatId, agent_profile_id: agentProfileId, transaction_digest: commitTx }, { transactionDigest: commitTx, runId: seat.runId });
      sui.runApproval = { objectId: approvalId, transactionDigest: approvalTx };
      sui.commitment = { objectId: hexId(0x80 + phase, index), transactionDigest: commitTx };
      receipts.set(seat.requestId, {
        x_request_id: seat.requestId,
        x_devshard_id: built.audit.devshardId,
        model,
        created_at: new Date(Math.floor(built.audit.completedAtMs / 1000) * 1000).toISOString().replace(".000Z", "Z"),
        outcome: "success",
        status_code: 200,
        stream: false,
        total_tokens: 1234,
        ttft_ms: 100,
        duration_ms: 15_000,
      });
      if (seat.committedOnly) {
        seat.proof = { ...proofFromBundle(built.bundle, built.sealed), bundle: null, sealed: null, revealed: false, sui, claimDeadlines: { firstRevealDeadlineMs: deadlineBase, secondRevealDeadlineMs: deadlineBase + 1 } };
        proofs.set(seat.runId, seat.proof);
        blobs.set(built.bundle.seal.sealedBlobId, "sealed");
        seats.push(seat);
        return;
      }
      seat.revealTx = revealTx;
      seat.revealedVoteId = revealedVoteId;
      const revealedBlobId = `revealed-${phase}-${index}`;
      transactions.set(revealTx, {
        digest: revealTx,
        timestampMs: atMs + 200_000,
        checkpoint: 2,
        transaction: {
          data: {
            transaction: {
              kind: "ProgrammableTransaction",
              inputs: [
                { type: "object", objectType: "immOrOwnedObject", objectId: jurySeatId },
                { type: "object", objectType: "sharedObject", objectId: hexId(0xd0, 0) },
                { type: "object", objectType: "immOrOwnedObject", objectId: hexId(0xd1, index) },
                { type: "pure", valueType: "u8", value: outcomeCode(vote) },
                { type: "pure", valueType: "u16", value: vote.confidenceBps },
                { type: "pure", valueType: "vector<u8>", value: bytes(built.outputHash) },
                { type: "pure", valueType: "vector<u8>", value: bytes(built.runHash) },
                { type: "pure", valueType: "vector<u8>", value: [...salt] },
                { type: "pure", valueType: "vector<u8>", value: revealedBlobId },
                { type: "pure", valueType: "0x2::object::ID", value: hexId(0x90, index) },
                { type: "pure", valueType: "u64", value: "1221" },
                { type: "object", objectType: "sharedObject", objectId: "0x6" },
              ],
              transactions: [{ MoveCall: { package: PACKAGE, module: "jury", function: "reveal_vote", arguments: Array.from({ length: 12 }, (_, input) => ({ Input: input })) } }],
            },
          },
        },
        events: [
          {
            type: `${PACKAGE}::jury::VoteRevealed`,
            parsedJson: { claim_id: claimId, confidence_bps: vote.confidenceBps, jury_seat_id: jurySeatId, outcome: outcomeCode(vote), output_hash: bytes(built.outputHash), phase, revealed_vote_id: revealedVoteId, round_tally_id: hexId(0xd0, 0), run_hash: bytes(built.runHash) },
          },
        ],
      });
      objects.set(revealedVoteId, {
        data: {
          objectId: revealedVoteId,
          version: "1",
          content: {
            dataType: "moveObject",
            type: `${PACKAGE}::jury::RevealedVote`,
            fields: { agent_profile_id: agentProfileId, claim_id: claimId, committee_id: committeeId, confidence_bps: vote.confidenceBps, evidence_root: bytes(root), id: { id: revealedVoteId }, jury_seat_id: jurySeatId, outcome: outcomeCode(vote), output_hash: bytes(built.outputHash), phase, run_hash: bytes(built.runHash), revealed_at_ms: String(atMs + 200_000) },
          },
        },
      });
      push("vote_revealed", `REVEAL_${phase}`, atMs + 200_000, { phase, valid: true, outcome: vote.outcome, claim_id: claimId, jury_seat_id: jurySeatId, confidence_bps: vote.confidenceBps, agent_profile_id: agentProfileId, revealed_vote_id: revealedVoteId, transaction_digest: revealTx }, { transactionDigest: revealTx, runId: seat.runId });
      if (phase === finalPhase) {
        reveals.push({ revealedVoteId, runId: seat.runId, transactionDigest: revealTx });
        bundleRuns.push({ runId: seat.runId, agentProfileId, gonkaRequestId: built.audit.gonkaRequestId, promptHash: built.bundle.promptHash, inputHash: built.bundle.inputHash, outputHash: built.outputHash, runHash: built.runHash, runWalrusBlobId: revealedBlobId, toolTranscriptHash: built.audit.toolTranscriptHash, toolTranscriptWalrusBlobId: revealedBlobId });
        sui.reveal = { objectId: revealedVoteId, transactionDigest: revealTx };
      }
      seat.proof = { ...proofFromBundle(built.bundle, built.sealed), revealedBlobId, sui, claimDeadlines: { firstRevealDeadlineMs: deadlineBase, secondRevealDeadlineMs: deadlineBase + 1 } };
      proofs.set(seat.runId, seat.proof);
      blobs.set(revealedBlobId, "revealed");
      seats.push(seat);
    });
    if (phase === 1 && twoRound) {
      const speakers = seats.filter((seat) => seat.phase === 1 && seat.revealTx);
      speakers.forEach((seat, ordinal) => {
        // V4 turns answer a named seat and may ask one a question; a V3 turn
        // carries only the composed argument, exactly as it always did.
        const analysis = `The record still reads ${seat.vote?.outcome ?? "?"} to me.`;
        const position = `I keep my ${seat.vote?.outcome ?? "?"} vote.`;
        // V4 numbers seats from 1, so a seat number is the juror number.
        const conversation = spec.debateSpec === "4"
          ? {
              specVersion: "4",
              answering: ordinal === 0 ? null : 1,
              theirPoint: ordinal === 0 ? "" : "Seat 1 read the trial as decisive.",
              analysis,
              ...(ordinal === 0 ? { question: { seat: 2, text: "Which trial arm is it?" } } : {}),
              position,
            }
          : {};
        push("DELIBERATION_TURN", "DISCUSSION", T0 + 800_000 + ordinal * 10_000, { atMs: T0 + 800_000 + ordinal * 10_000, status: "SPOKEN", claimId, jurySeatId: seat.jurySeatId, agentProfileId: seat.agentProfileId, modelId: seat.spec.model, ordinal, exchange: 1, ...conversation, argument: spec.debateSpec === "4" ? `${analysis} ${position}` : position, citations: ["evidence-table-1"], stance: seat.vote?.outcome, confidenceBps: seat.vote?.confidenceBps }, { source: "GONKA_ROUTER" });
      });
    }
  }

  const finalSeats = seats.filter((seat) => seat.phase === finalPhase && seat.revealTx && seat.vote);
  const scoreBps = computeTruthScoreBps(finalSeats.map((seat) => ({ outcome: outcomeCode(seat.vote!), confidenceBps: seat.vote!.confidenceBps })));
  const certificateId = spec.result ? hexId(0xce, 1) : undefined;
  const certificateTx = "certificate-tx";
  if (spec.result && certificateId) {
    const resultCode = spec.result === "YES" ? CLAIM_RESULT.YES : spec.result === "NO" ? CLAIM_RESULT.NO : CLAIM_RESULT.UNRESOLVED;
    objects.set(certificateId, {
      data: {
        objectId: certificateId,
        version: "9",
        previousTransaction: certificateTx,
        content: {
          dataType: "moveObject",
          type: `${PACKAGE}::jury::ResolutionCertificate`,
          fields: {
            claim_id: claimId,
            committee_id: committeeId,
            evidence_bundle_ids: [hexId(0xe0, 1), ...(twoRound ? [hexId(0xe0, 2)] : [])],
            finalized_at_ms: String(T0 + 2_000_000),
            id: { id: certificateId },
            package_version: "1",
            result: resultCode,
            revealed_vote_ids: [...finalSeats.map((seat) => seat.revealedVoteId!)].reverse(),
            truth_score_bps: spec.tamper?.certificateScore ? { fields: { vec: [(scoreBps ?? 0) + 1] } } : scoreBps,
          },
        },
      },
    });
    push("claim_finalized", "FINALIZED", T0 + 2_000_000, { outcome: spec.result, claim_id: claimId, reviewed: true, certificate_id: certificateId, truth_score_bps: scoreBps, transaction_digest: certificateTx }, { transactionDigest: certificateTx });
  }

  const inspection: ClaimInspection = {
    claimId,
    mode: 1,
    state: spec.state as ClaimInspection["state"],
    statement: spec.statement ?? "Humans use only ten percent of their brains.",
    resolutionCriteria: "Decide whether the statement is true as written.",
    deadlines: {
      evidenceCutoffMs: T0,
      proposalDeadlineMs: T0 + 5_000,
      challengeDeadlineMs: T0 + 10_000,
      firstCommitDeadlineMs: T0 + 540_000,
      firstRevealDeadlineMs: T0 + 660_000,
      discussionDeadlineMs: T0 + 1_500_000,
      secondCommitDeadlineMs: T0 + 1_740_000,
      secondRevealDeadlineMs: T0 + 1_860_000,
    },
    committeeId,
    evidenceRoots: (twoRound ? ([1, 2] as const) : ([1] as const)).map((phase) => ({ phase, root: roots[phase]!, bundleId: hexId(0xe0, phase) })),
    commitments: seats.map((seat) => ({
      jurySeatId: seat.jurySeatId,
      agentProfileId: seat.agentProfileId,
      modelId: seat.spec.model,
      committed: seat.commitTx !== undefined,
      revealed: seat.revealTx !== undefined,
      ...(seat.revealTx && seat.vote ? { outcome: outcomeCode(seat.vote), confidenceBps: seat.vote.confidenceBps } : {}),
      ...(seat.failure ? { failureStatus: seat.failure } : {}),
    })),
    rounds: (twoRound ? ([1, 2] as const) : ([1] as const)).map((phase) => ({
      phase,
      expectedJurySeatIds: phase === 1 ? phaseOneSeatIds : phaseTwoSeatIds,
      committedJurySeatIds: seats.filter((seat) => seat.phase === phase && seat.commitTx).map((seat) => seat.jurySeatId),
      revealedJurySeatIds: seats.filter((seat) => seat.phase === phase && seat.revealTx).map((seat) => seat.jurySeatId),
    })),
    ...(twoRound
      ? {
          deliberation: events
            .filter((entry) => entry.kind === "DELIBERATION_TURN")
            .map((entry) => entry.payload as ClaimInspection["deliberation"] extends Array<infer Turn> | undefined ? Turn : never),
        }
      : {}),
    // The engine publishes the committee's family count and the pair the draw
    // ran under; the auditor recomputes the count from the seats themselves.
    jury: {
      familyCount: new Set(seats.map((seat) => seat.spec.model)).size,
      requiredFamilies: spec.requiredFamilies ?? 3,
      degraded: new Set(seats.map((seat) => seat.spec.model)).size < 3,
    },
    ...(spec.attemptChain ? { attemptChain: spec.attemptChain } : {}),
    ...(spec.result && certificateId ? { result: { claimId, result: spec.result, truthScoreBps: scoreBps, certificateId, digest: certificateTx } } : {}),
  };

  const evidenceArtifacts = (twoRound ? manifests[2] : manifests[1]).items.map((item) => ({ evidenceId: item.evidenceId, sourceUrl: item.sourceUrl, blobId: item.canonicalWalrusBlobId, contentHash: toHex(item.contentHash) as HexString }));
  const report: FactCheckReport = {
    claimId,
    statement: inspection.statement,
    submittedUrls: [],
    label: spec.result ?? "PENDING",
    truthScore: spec.result && scoreBps !== null ? scoreBps / 100 : null,
    truthScoreFormula: "mean over valid reveals",
    finalRoundVotes: spec.result ? finalSeats.map((seat) => ({ jurySeatId: seat.jurySeatId, outcome: seat.vote!.outcome, confidenceBps: seat.vote!.confidenceBps, valid: true })) : [],
    agents: finalSeats.map((seat) => ({
      agentProfileId: seat.agentProfileId,
      owner: hexId(0x0f, seat.index),
      modelId: seat.spec.model,
      role: seat.spec.role,
      outcome: seat.vote!.outcome,
      confidenceBps: seat.vote!.confidenceBps,
      gonkaRequestId: `devshard-${7000 + seat.index}-${seat.phase}`,
      evidenceIds: ["evidence-table-1"],
      reasoning: "Because the sources say so.",
      publicReasoningTrace: [],
    })),
    evidence: evidenceArtifacts,
    evidenceRoot: roots[finalPhase]!,
    sui: { claimObjectId: claimId, committeeId, ...(certificateId ? { certificateId } : {}), revealedVoteIds: finalSeats.map((seat) => seat.revealedVoteId!) },
    auditBundle: {
      version: 1,
      claim: { claimId, packageId: PACKAGE, transactionDigest: "create-tx" },
      committee: { committeeId, roundTallyId: hexId(0xd0, 0), agentProfileIds: agentIds, jurySeatIds: phaseOneSeatIds, transactionDigest: "committee-tx" },
      evidence: (twoRound ? ([1, 2] as const) : ([1] as const)).map((phase) => ({ phase, root: roots[phase], manifestBlobId: `manifest-${phase}`, evidenceBundleId: hexId(0xe0, phase) })),
      evidenceArtifacts: evidenceArtifacts.map((artifact) => ({ evidenceId: artifact.evidenceId, contentHash: artifact.contentHash, canonicalHash: artifact.contentHash, rawWalrusBlobId: artifact.blobId, canonicalWalrusBlobId: artifact.blobId })),
      runs: bundleRuns,
      runApprovals,
      commitments,
      reveals,
      certificate: spec.result && certificateId
        ? { result: spec.result, claimId, finalPhase, certificateId, truthScoreBps: scoreBps, finalRoundVoteIds: finalSeats.map((seat) => seat.revealedVoteId!), transactionDigest: certificateTx }
        : null,
    },
  };

  return { spec, claimId, inspection, report, events, seats, proofs, transactions, objects, receipts, blobs, roots, ...(certificateId ? { certificateId } : {}) };
}

// ---------------------------------------------------------------------------
// Fake fetch with failure injection
// ---------------------------------------------------------------------------

type FetchPlan = {
  /** Return a Response to override one RPC call; `attempt` counts calls per endpoint. */
  rpc?: (url: string, method: string, params: unknown[], attempt: number) => Response | undefined;
  receiptStatus?: number;
  walrusHang?: boolean;
  reportStatus?: number;
  claimStatus?: number;
  eventsStatus?: number;
  eventsNeverEnd?: boolean;
  calls?: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(events: Json[], neverEnd: boolean): Response {
  const text = events.map((entry) => `id: ${entry.sequence}\ndata: ${JSON.stringify(entry)}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(utf8.encode(text));
      if (!neverEnd) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort);
  });
}

export function createFakeFetch(world: FakeWorld, plan: FetchPlan = {}): typeof fetch {
  const rpcAttempts = new Map<string, number>();
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    plan.calls?.push(`${init?.method ?? "GET"} ${url}`);
    const api = `${BASE}/api/claims/${world.claimId}`;
    if (url === `${BASE}/api/agents`) return json({ agents: [] });
    if (url === api) {
      if (plan.claimStatus === 404) return json({ error: "internal_error", message: `claim was not found: ${world.claimId}` }, 500);
      if (plan.claimStatus) return json({ error: "boom" }, plan.claimStatus);
      return json(world.inspection);
    }
    if (url === `${api}/report`) return plan.reportStatus ? json({ error: "internal_error" }, plan.reportStatus) : json(world.report);
    if (url === `${api}/events`) {
      return plan.eventsStatus ? json({ error: "internal_error" }, plan.eventsStatus) : sse(world.events, plan.eventsNeverEnd === true);
    }
    if (url.startsWith(`${api}/runs/`)) {
      const runId = url.slice(`${api}/runs/`.length).replace("/proof", "");
      const proof = world.proofs.get(runId);
      return proof ? json(proof) : json({ error: "run_not_found" }, 404);
    }
    if (url.startsWith(`${BASE}/api/claims/`)) {
      return json({ error: "internal_error", message: "claim was not found" }, 500);
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
      const attempt = (rpcAttempts.get(url) ?? 0) + 1;
      rpcAttempts.set(url, attempt);
      const override = plan.rpc?.(url, body.method, body.params, attempt);
      if (override) return override;
      const id = String(body.params[0]);
      if (body.method === "sui_getTransactionBlock") {
        const tx = world.transactions.get(id);
        return tx ? json({ jsonrpc: "2.0", id: 1, result: tx }) : json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: `Could not find the referenced transaction [TransactionDigest(${id})].` } });
      }
      if (body.method === "sui_getObject") {
        const object = world.objects.get(id);
        return object ? json({ jsonrpc: "2.0", id: 1, result: object }) : json({ jsonrpc: "2.0", id: 1, result: { error: { code: "notExists", object_id: id } } });
      }
      return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } });
    }
    if (url.startsWith("https://api.gonkarouter.io/v1/receipts/")) {
      if (plan.receiptStatus) return json({ error: { code: "not_found" } }, plan.receiptStatus);
      const receipt = world.receipts.get(decodeURIComponent(url.split("/").pop() ?? ""));
      return receipt ? json(receipt) : json({ error: { code: "not_found" } }, 404);
    }
    if (url.startsWith("https://aggregator.walrus-testnet.walrus.space/v1/blobs/")) {
      if (plan.walrusHang) return hang(init?.signal);
      const blob = world.blobs.get(url.split("/").pop() ?? "");
      if (blob === undefined) return new Response("", { status: 404 });
      return new Response(init?.method === "HEAD" ? null : blob, { status: 200 });
    }
    return new Response("not routed", { status: 500 });
  };
  return fake as typeof fetch;
}

const FIVE_NO: SeatSpec[] = [
  { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "NO", confidenceBps: 9_500 } },
  { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "NO", confidenceBps: 9_500 } },
  { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
  { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
  { model: "moonshotai/Kimi-K2.6", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
];

/** Degraded mode: two families over five seats, three of them on one model. */
const TWO_FAMILY_NO: SeatSpec[] = [
  { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "NO", confidenceBps: 9_500 } },
  { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "NO", confidenceBps: 9_500 } },
  { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
  { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
  { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 10_000 } },
];

const RESEARCH_CLAIM: WorldSpec = {
  claimId: "0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6",
  seats: FIVE_NO,
  state: CLAIM_STATE.FINALIZED_REVIEWED,
  result: "NO",
  attemptChain: {
    verificationId: hexId(0x01, 1),
    attempt: 3,
    maxAttempts: 3,
    status: "SETTLED",
    previousAttempts: [
      { claimId: hexId(0x01, 1), attempt: 1, status: "VOIDED", voidReason: "PROVIDER_ERROR" },
      { claimId: hexId(0x01, 2), attempt: 2, status: "VOIDED", voidReason: "CITATION_INVALID" },
    ],
  },
};

const TWO_ROUND_CLAIM: WorldSpec = {
  claimId: hexId(0x02, 2),
  statement: "Intermittent fasting beats calorie restriction.",
  seats: [
    { model: "moonshotai/Kimi-K2.6", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 9_000 }, vote2: { outcome: "NO", confidenceBps: 9_000 } },
    { model: "moonshotai/Kimi-K2.6", role: "SKEPTIC", failure: "PROVIDER_ERROR", vote2: { outcome: "NO", confidenceBps: 8_500 } },
    { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "YES", confidenceBps: 7_000 }, vote2: { outcome: "NO", confidenceBps: 8_500 } },
    { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "NO", confidenceBps: 8_500 }, vote2: { outcome: "NO", confidenceBps: 9_000 } },
    { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", vote: { outcome: "YES", confidenceBps: 6_000 }, failure2: "TIMEOUT" },
  ],
  state: CLAIM_STATE.FINALIZED_REVIEWED,
  twoRound: true,
  result: "NO",
};

function target(world: FakeWorld, runId?: string) {
  return { base: BASE, claimId: world.claimId, kind: "claim" as const, ...(runId ? { runId } : {}) };
}

function runAudit(world: FakeWorld, plan: FetchPlan = {}, extra: { timeoutMs?: number; rpcUrls?: string[] } = {}) {
  return auditClaim(target(world), {
    fetch: createFakeFetch(world, plan),
    now: () => T0 + 3_000_000,
    eventsIdleMs: 40,
    timeoutMs: extra.timeoutMs ?? 5_000,
    ...(extra.rpcUrls ? { rpcUrls: extra.rpcUrls } : {}),
  });
}

function every(result: AuditResult): AuditCheck[] {
  return [...result.votes.flatMap((vote) => vote.checks), ...result.runs.flatMap((run) => run.checks), ...result.claimChecks];
}

function find(result: AuditResult, id: string, status?: string): AuditCheck[] {
  return every(result).filter((entry) => entry.id === id && (status === undefined || entry.status === status));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseAuditTarget", () => {
  const id = "0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6";
  const run = "0x75897c615937984977b4c102b7789c959b1dcbc4a2a37cd3f3f7937c4dbc4411";

  it("defaults a bare id to the public app", () => {
    expect(parseAuditTarget(id.toUpperCase().replace("0X", "0x"))).toEqual({ base: "https://app.openverdict.info", claimId: id, kind: "claim" });
  });

  it("accepts claim, report, observe, run and api links", () => {
    expect(parseAuditTarget(`https://app.openverdict.info/claims/${id}`)).toEqual({ base: "https://app.openverdict.info", claimId: id, kind: "claim" });
    expect(parseAuditTarget(`https://app.openverdict.info/claims/${id}/report?tab=jury#votes`).claimId).toBe(id);
    expect(parseAuditTarget(`https://app.openverdict.info/claims/${id}/observe`).kind).toBe("claim");
    expect(parseAuditTarget(`https://app.openverdict.info/claims/${id}/runs/${run}`)).toEqual({ base: "https://app.openverdict.info", claimId: id, runId: run, kind: "claim" });
    expect(parseAuditTarget(`https://app.openverdict.info/api/claims/${id}/report`).claimId).toBe(id);
    expect(parseAuditTarget(`http://localhost:3000/claims/${id}`).base).toBe("http://localhost:3000");
  });

  it("lets --base override the origin of a link", () => {
    expect(parseAuditTarget(`https://app.openverdict.info/claims/${id}`, { base: "localhost:3000" }).base).toBe("https://localhost:3000");
    expect(parseAuditTarget(id, { base: "http://127.0.0.1:3000/" }).base).toBe("http://127.0.0.1:3000");
  });

  it("rejects anything that is not a claim reference", () => {
    expect(() => parseAuditTarget("")).toThrow(AuditInputError);
    expect(() => parseAuditTarget("not a claim")).toThrow(AuditInputError);
    expect(() => parseAuditTarget("https://app.openverdict.info/agents/0x1")).toThrow(AuditInputError);
    expect(() => parseAuditTarget("https://app.openverdict.info/claims/zzz")).toThrow(AuditInputError);
  });

  it("says plainly that a queue link is gone", () => {
    expect(() => parseAuditTarget("https://app.openverdict.info/fact-check/queue/queue-42")).toThrow(
      AuditInputError,
    );
    expect(() => parseAuditTarget("https://app.openverdict.info/fact-check/queue/queue-42")).toThrow(
      "queue links no longer exist",
    );
  });
});

describe("chain parsers on real testnet responses", () => {
  const realCommitment = "0x4aa39c4875fec9523343ac4f6a2c12d06ce4af14282c8272337b65776cc4d642";

  it("reads the VoteCommitted event of the commit transaction", () => {
    const parsed = parseCommitEvent(fixture("sui-commit-tx.json"));
    expect(parsed).toMatchObject({ commitment: realCommitment, phase: 1, jurySeatId: "0x44525825d2e75c4ed4c15943d116244a1db53a1cc1fa9854b076d854e5664637" });
  });

  it("recomputes the spec commitment from the reveal inputs resolved through the MoveCall", () => {
    const inputs = parseRevealInputs(fixture("sui-reveal-tx.json"));
    expect(inputs).toMatchObject({ outcome: 2, confidenceBps: 9_500, resolvedBy: "move-call", argumentBlobId: "i1kpXtoM_1ARthwkXY6VOmPoVghAlK0OBWZY3WFyVxg" });
    expect(inputs?.event).toMatchObject({ outcome: 2, confidenceBps: 9_500, revealedVoteId: "0x29b1445ef6fc2be1d0a17764883a2f4b8cdbb6529ad9d7a241862fba51bb878e" });
    const recomputed = toHex(
      computeVoteCommitment({
        claim_id: "0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6",
        agent_profile_id: "0x546e1491c2c1fa1e2e857457b74a99ab137ce35d7a0eb4f1e0e29f61727d8cdd",
        jury_seat_id: "0x44525825d2e75c4ed4c15943d116244a1db53a1cc1fa9854b076d854e5664637",
        phase: 1,
        outcome: 2,
        confidence_bps: 9_500,
        evidence_root: fromHex("0x532792caa77893b49cd95d19703da9f50c7053a8cc3a67c86f9a9d0723501740"),
        output_hash: fromHex(inputs!.outputHash),
        run_hash: fromHex(inputs!.runHash),
        salt: fromHex(inputs!.salt),
      }),
    );
    expect(recomputed).toBe(realCommitment);
  });

  it("falls back to the fixed input positions without a reveal_vote MoveCall", () => {
    const tx = structuredClone(fixture("sui-reveal-tx.json")) as { transaction: { data: { transaction: { transactions: unknown[] } } } };
    tx.transaction.data.transaction.transactions = [];
    const inputs = parseRevealInputs(tx);
    const viaCall = parseRevealInputs(fixture("sui-reveal-tx.json"));
    expect(inputs?.resolvedBy).toBe("positions");
    expect(inputs?.salt).toBe(viaCall?.salt);
    expect(inputs?.runHash).toBe(viaCall?.runHash);
  });

  it("reads the certificate fields with a bare or wrapped Option", () => {
    const object = parseObjectFields(fixture("sui-certificate-object.json"));
    expect(object?.type).toMatch(/::jury::ResolutionCertificate$/);
    const fields = parseCertificateFields(object!.fields);
    expect(fields).toMatchObject({ result: CLAIM_RESULT.NO, truthScoreBps: 200, finalizedAtMs: 1788406045912 });
    expect(fields.revealedVoteIds).toHaveLength(5);
    const wrapped = parseCertificateFields({ ...object!.fields, truth_score_bps: { fields: { vec: [321] } } });
    expect(wrapped.truthScoreBps).toBe(321);
    expect(parseCertificateFields({ ...object!.fields, truth_score_bps: null }).truthScoreBps).toBeUndefined();
  });

  it("recomputes the frozen root from the Walrus manifest", () => {
    const manifest = recomputeManifestRoot(fixture("walrus-manifest-phase1.json"));
    expect(manifest.root).toBe("0x532792caa77893b49cd95d19703da9f50c7053a8cc3a67c86f9a9d0723501740");
    expect(manifest.sourceUrls).toEqual(["urn:openverdict:claim-statement"]);
    expect(recomputeManifestRoot({ items: [] }).error).toBeDefined();
  });

  it("compares the provider receipt with second precision on the window start", () => {
    const receipt = fixture("gonka-receipt.json") as Record<string, unknown>;
    const expected = { requestId: "req-1788405644080853952-322716", model: "deepseek-ai/DeepSeek-V4-Flash-0731", devshardId: "70083" };
    expect(compareReceipt(receipt, { ...expected, requestedAtMs: 1788405643903, completedAtMs: 1788405676193 }).ok).toBe(true);
    // created_at 03:21:15Z is floored to the second; a request at 03:21:15.789 still matches.
    expect(compareReceipt(receipt, { ...expected, requestedAtMs: 1788405675789, completedAtMs: 1788405676193 }).ok).toBe(true);
    const late = compareReceipt(receipt, { ...expected, requestedAtMs: 1788405676000, completedAtMs: 1788405676193 });
    expect(late.ok).toBe(false);
    expect(late.issues[0]).toMatch(/outside/);
    expect(compareReceipt(receipt, { ...expected, model: "other/model" }).issues[0]).toMatch(/model/);
    expect(compareReceipt(receipt, { ...expected, devshardId: "1" }).issues[0]).toMatch(/devshard/);
  });
});

describe("auditClaim on a finalized research claim", () => {
  it("passes every vote, run, receipt, walrus, chain and score check", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const calls: string[] = [];
    const result = await runAudit(world, { calls });

    expect(result.status).toBe("FINALIZED");
    expect(result.exitCode).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.unavailable).toBe(0);
    expect(result.summary.byGroup.votes).toMatchObject({ passed: 15, failed: 0 });
    expect(result.summary.byGroup.receipts).toMatchObject({ passed: 5 });
    expect(result.summary.byGroup.walrus).toMatchObject({ passed: 6 });
    expect(result.summary.byGroup.score).toMatchObject({ passed: 2 });
    // R16 per run, S2, S4.root and the S5 diversity row at claim level.
    expect(result.summary.byGroup.chain).toMatchObject({ passed: 8 });
    expect(result.verdict).toMatchObject({ result: "NO", truthScoreBps: 200, certificateId: world.certificateId, finalPhase: 1 });
    expect(result.jury).toHaveLength(5);
    expect(result.runs.every((run) => run.revealed && run.kind === "legacy")).toBe(true);
    expect(result.votes.every((vote) => vote.recomputedCommitment === vote.commitment && vote.onChainCommitment === vote.commitment)).toBe(true);
    expect(result.votes[0]?.preimage).toMatchObject({ phase: 1, outcome: 2, confidence_bps: 9_500, evidence_root: world.roots[1] });
    expect(result.score).toMatchObject({ sumBps: 1_000, count: 5, meanBps: 200, reportBps: 200, certificateBps: 200 });
    expect(result.timelineSource).toBe("events");
    expect(result.timeline.map((entry) => entry.event)).toContain("claim_finalized");
    expect(result.claim.attempt?.previousAttempts).toHaveLength(2);
    expect(result.sources.failures).toEqual([]);
    // Sui calls carry the browser user agent publicnode requires.
    expect(calls.filter((call) => call.startsWith("POST https://sui-testnet-rpc"))).toHaveLength(16);
  });

  it("renders the dossier with the fixed headings, short hashes in tables and no em dash", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(world);
    const markdown = renderMarkdown(result, { jsonPath: "/tmp/audit.json" });
    const headings = markdown.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## Verdict card",
      "## Timeline",
      "## Jury",
      "## Votes and commitments",
      "## Juror runs",
      "## Truth score",
      "## Certificate on Sui",
      "## What this audit proves and what it does not",
      "## Data",
    ]);
    expect(markdown.startsWith("# OpenVerdict audit: Humans use only ten percent of their brains.\n")).toBe(true);
    expect(markdown).not.toContain(String.fromCodePoint(0x2014));
    expect(markdown).toContain("- Result: NO, truth score 2.00 (200 bps), certificate ");
    expect(markdown).toContain("- Checks: passed ");
    expect(markdown).toContain("| C2 | Commitment recomputes from the reveal | 0x");
    expect(markdown).toContain("- JSON dump: /tmp/audit.json");
    expect(markdown).toContain("5 of 5 counted vote(s) recomputed here");
    // Table cells never carry a full 64-hex value; the JSON does.
    for (const line of markdown.split("\n").filter((entry) => entry.startsWith("| "))) {
      expect(line).not.toMatch(/0x[0-9a-f]{64}/);
    }
    expect(markdown).toMatch(/2026-09-03T\d{2}:\d{2}:\d{2}Z/);
    expect(markdown).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z \|/);
    const parsed = JSON.parse(renderJson(result)) as AuditResult;
    expect(parsed.votes[0]?.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsed.summary).toEqual(result.summary);
    expect(renderVerdictCard(result).split("\n").filter((line) => line.startsWith("## "))).toEqual(["## Verdict card"]);
  });

  it("puts the requested run first with the full table and lists the others briefly", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const highlighted = world.seats[3]!.runId;
    const result = await auditClaim(target(world, highlighted), { fetch: createFakeFetch(world), eventsIdleMs: 40, timeoutMs: 5_000 });
    const markdown = renderMarkdown(result);
    const runsSection = markdown.slice(markdown.indexOf("## Juror runs"), markdown.indexOf("## Truth score"));
    const titles = runsSection.split("\n").filter((line) => line.startsWith("### "));
    expect(titles[0]).toContain(highlighted.slice(0, 10));
    expect(titles).toHaveLength(5);
    expect(runsSection.match(/\| R13 \| Run hash/g)).toHaveLength(1);
    expect(runsSection).toMatch(/checks passed \d+, failed 0/);
  });

  it("flags a tampered record commitment and a certificate score that differs", async () => {
    const world = buildWorld({ ...RESEARCH_CLAIM, tamper: { recordCommitment: true, certificateScore: true } });
    const result = await runAudit(world);
    expect(find(result, "C1", "FAIL")).toHaveLength(1);
    expect(find(result, "C1", "FAIL")[0]?.detail).toMatch(/differs from the record/);
    expect(find(result, "S2", "FAIL")[0]?.detail).toMatch(/truth_score_bps 201 is not 200/);
    expect(result.exitCode).toBe(1);
    expect(renderVerdictCard(result)).toContain("2 check(s) FAILED");
  });
});

describe("auditClaim on a degraded jury", () => {
  it("records the families drawn as an informational row and never fails", async () => {
    const world = buildWorld({
      ...RESEARCH_CLAIM,
      seats: TWO_FAMILY_NO,
      requiredFamilies: 2,
    });

    const result = await runAudit(world);

    const row = result.claimChecks.find((entry) => entry.id === "S5");
    expect(row).toMatchObject({ group: "chain", status: "PASS" });
    expect(row?.actual).toBe("families drawn: 2 (registry required 2 at the draw)");
    expect(row?.detail).toContain("degraded mode");
    expect(result.summary.failed).toBe(0);
    expect(result.exitCode).toBe(0);

    // The dossier a reader actually sees carries the same line, and the
    // verdict card names it beside the result rather than only in the table.
    const markdown = renderMarkdown(result, { jsonPath: "/tmp/audit.json" });
    expect(markdown).toContain("families drawn: 2 (registry required 2 at the draw)");
    expect(renderVerdictCard(result)).toContain(
      "- Jury: 2 model families (degraded mode), registry required 2 at the draw",
    );
  });

  it("says three families sat when the draw was not degraded", async () => {
    const result = await runAudit(buildWorld(RESEARCH_CLAIM));

    const row = result.claimChecks.find((entry) => entry.id === "S5");
    expect(row?.actual).toBe("families drawn: 3 (registry required 3 at the draw)");
    expect(row?.detail).not.toContain("degraded");
    // A full jury adds nothing to the card.
    expect(renderVerdictCard(result)).not.toContain("- Jury:");
  });
});

describe("auditClaim on a two-round claim", () => {
  it("checks both rounds, the debate and the table votes", async () => {
    const world = buildWorld(TWO_ROUND_CLAIM);
    const result = await runAudit(world);

    expect(result.exitCode).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.unavailable).toBe(0);
    expect(result.claim.twoRound).toBe(true);
    expect(result.verdict).toMatchObject({ result: "NO", finalPhase: 2 });
    expect(result.jury).toHaveLength(5);
    expect(result.jury.every((juror) => juror.seats[1] && juror.seats[2])).toBe(true);
    // Round-one reveals are not in the audit bundle; the events supply them.
    const roundOne = result.votes.filter((vote) => vote.phase === 1);
    expect(roundOne.filter((vote) => vote.revealed).every((vote) => vote.checks.every((entry) => entry.status === "PASS"))).toBe(true);
    expect(roundOne.find((vote) => vote.jurorIndex === 2)?.checks.every((entry) => entry.status === "SKIPPED")).toBe(true);
    const tableVotes = result.runs.filter((run) => run.phase === 2 && run.revealed);
    expect(tableVotes).toHaveLength(4);
    expect(tableVotes.every((run) => run.kind === "table-vote")).toBe(true);
    // A table vote yields fewer research checks: the five research-only ones are skipped, not failed.
    const skipped = tableVotes[0]!.checks.filter((entry) => entry.status === "SKIPPED").map((entry) => entry.id);
    expect(skipped).toEqual(["R8", "R9", "R10", "R11", "R12"]);
    expect(tableVotes[0]!.checks.filter((entry) => entry.status === "PASS").map((entry) => entry.id)).toEqual(["R1", "R3", "R4", "R5", "R6", "R7", "R13", "R15", "R16", "R17", "R18"]);
    expect(find(result, "D1", "PASS")).toHaveLength(1);
    expect(find(result, "D2", "PASS")).toHaveLength(1);
    expect(find(result, "D3", "PASS")[0]?.expected).toBe(tableVotePromptSpecHash());
    expect(find(result, "S4.root", "PASS")).toHaveLength(2);
    expect(find(result, "S4.manifest", "PASS")).toHaveLength(2);
    expect(find(result, "S3", "PASS")[0]?.expected).toMatch(/^NO from YES 0, NO 4/);
    // Every revealed round-one juror speaks once in the synthetic debate.
    expect(result.debate?.turns).toHaveLength(4);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("## Debate and round two");
    expect(markdown).toContain("settled in round two after the cascade");
    expect(markdown).toContain("| D3 | Table votes bind the pinned prompt |");
    // A V1 to V3 transcript carries no conversation fields, and still passes.
    expect(find(result, "D1", "PASS")[0]?.actual).toContain(
      "on deliberation spec V1 to V3",
    );
    expect(result.debate?.turns.every((turn) => turn.specVersion === undefined)).toBe(true);
    expect(result.debate?.turns.every((turn) => turn.answering === undefined)).toBe(true);
    expect(renderMarkdown(result)).toContain(
      "- Seat numbers: a V1 to V3 transcript numbers seats from 0, so juror n holds seat n minus one.",
    );
  });

  it("reads the conversation fields of a V4 debate", async () => {
    const world = buildWorld({ ...TWO_ROUND_CLAIM, debateSpec: "4" });
    const result = await runAudit(world);

    expect(result.exitCode).toBe(0);
    expect(find(result, "D1", "PASS")[0]?.actual).toContain(
      "on deliberation spec V4",
    );
    expect(result.debate?.turns.map((turn) => turn.answering)).toEqual([
      undefined,
      1,
      1,
      1,
    ]);
    expect(result.debate?.turns[0]?.question).toEqual({
      seat: 2,
      text: "Which trial arm is it?",
    });
    expect(result.debate?.turns.every((turn) => turn.specVersion === "4")).toBe(true);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("| Ordinal | Exchange | Juror | Answers |");
    expect(markdown).toContain("| juror 1 |");
    expect(markdown).toContain(
      "- Seat numbers: from deliberation spec V4 on, a seat number is the juror number",
    );
    expect(markdown).toContain("Questions put to a named seat:");
    expect(markdown).toContain("Juror 1 asked juror 2: Which trial arm is it?");
  });

  it("settles UNRESOLVED when round two has no quorum", async () => {
    const world = buildWorld({
      ...TWO_ROUND_CLAIM,
      claimId: hexId(0x02, 3),
      result: "UNRESOLVED",
      state: CLAIM_STATE.UNRESOLVED,
      seats: TWO_ROUND_CLAIM.seats.map((seat, index) => (index === 0 ? { ...seat, vote2: { outcome: "UNSURE" as const, confidenceBps: 4_500 } } : seat)),
    });
    const result = await runAudit(world);
    expect(result.summary.failed).toBe(0);
    expect(result.verdict.result).toBe("UNRESOLVED");
    expect(find(result, "S3", "PASS")[0]?.expected).toMatch(/^UNRESOLVED from YES 0, NO 3, UNSURE 1/);
    expect(find(result, "S2", "PASS")[0]?.expected).toContain(`(${CLAIM_RESULT.UNRESOLVED})`);
  });
});

describe("auditClaim on claims that are not settled", () => {
  it("explains a voided attempt, follows the relaunch link and still checks the commits", async () => {
    const relaunched = hexId(0x03, 2);
    const world = buildWorld({
      claimId: hexId(0x03, 1),
      statement: "The Great Wall is visible from the Moon.",
      state: CLAIM_STATE.COMMIT_1,
      seats: [
        { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 9_000 }, committedOnly: true },
        { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", failure: "TIMEOUT" },
        { model: "moonshotai/Kimi-K2.6", role: "SKEPTIC", failure: "TIMEOUT" },
        { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "NO", confidenceBps: 9_000 }, committedOnly: true },
        { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY", failure: "TIMEOUT" },
      ],
      attemptChain: {
        verificationId: hexId(0x03, 0),
        attempt: 2,
        maxAttempts: 3,
        status: "VOIDED",
        void: { seatId: hexId(0x51, 1), modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", phase: 1, reason: "TIMEOUT", message: "GonkaRouter provider request failed", atMs: T0 + 400_000 },
        relaunchedAs: relaunched,
        previousAttempts: [{ claimId: hexId(0x03, 0), attempt: 1, status: "VOIDED", voidReason: "PROVIDER_ERROR" }],
      },
    });
    const result = await runAudit(world);
    expect(result.status).toBe("VOIDED");
    expect(result.exitCode).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.claim.attempt?.relaunchLink).toBe(`${BASE}/claims/${relaunched}`);
    expect(result.claim.pending[0]).toMatch(/attempt 2 of 3 was voided: TIMEOUT \(GonkaRouter provider request failed\)/);
    expect(result.claim.pending[1]).toContain(relaunched);
    expect(find(result, "C1", "PASS")).toHaveLength(2);
    expect(find(result, "C2", "SKIPPED")[0]?.detail).toMatch(/voided before the reveal/);
    expect(find(result, "S1", "SKIPPED")).toHaveLength(1);
    expect(find(result, "S2", "SKIPPED")).toHaveLength(1);
    const card = renderVerdictCard(result);
    expect(card).toContain("attempt 2 of 3 (VOIDED)");
    expect(card).toContain(`Relaunched as: ${BASE}/claims/${relaunched}`);
    expect(card).toContain("Earlier attempt 1: VOIDED (PROVIDER_ERROR)");
    expect(renderMarkdown(result)).toContain("Sealed blob reachable on Walrus");
  });

  it("audits an in-progress claim without hanging on the open event stream", async () => {
    const world = buildWorld({
      claimId: hexId(0x04, 1),
      state: CLAIM_STATE.COMMIT_1,
      seats: [
        { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC", vote: { outcome: "YES", confidenceBps: 8_000 }, committedOnly: true },
        { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY" },
        { model: "moonshotai/Kimi-K2.6", role: "SKEPTIC" },
        { model: "MiniMaxAI/MiniMax-M2.7", role: "SKEPTIC" },
        { model: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY" },
      ],
    });
    const startedAt = Date.now();
    const result = await runAudit(world, { eventsNeverEnd: true });
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.claim.pending[0]).toMatch(/round 1 commit: 1 of 5 seats committed/);
    expect(result.exitCode).toBe(0);
    expect(find(result, "C1", "PASS")).toHaveLength(1);
    expect(find(result, "C2", "SKIPPED")[0]?.detail).toMatch(/not revealed yet/);
    // Seats without a run answer 404 on the proof route and the sealed seat is
    // not revealed: nothing to check yet, not a broken source.
    expect(find(result, "R1-R18", "SKIPPED")).toHaveLength(5);
    expect(find(result, "R18", "PASS")[0]?.label).toBe("Sealed blob reachable on Walrus");
    expect(result.sources.failures.some((failure) => failure.source === "events" && /stream stopped early/.test(failure.reason))).toBe(true);
    expect(renderVerdictCard(result)).toContain("Result: PENDING (no certificate yet)");
  });

  it("refuses an unknown claim id with a one-line reason", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    await expect(runAudit(world, { claimStatus: 404 })).rejects.toThrow(/claim not found/);
    await expect(runAudit(world, { claimStatus: 503 })).rejects.toThrow(/could not fetch/);
  });
});

describe("auditClaim when a source is down", () => {
  it("moves to the fallback RPC after a 403 and records the failure", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const primary = "https://rpc-one.test";
    const result = await runAudit(
      world,
      { rpc: (url) => (url === primary ? new Response("forbidden", { status: 403 }) : undefined) },
      { rpcUrls: [primary, "https://rpc-two.test"] },
    );
    expect(result.summary.failed).toBe(0);
    expect(result.summary.unavailable).toBe(0);
    expect(find(result, "C2", "PASS")).toHaveLength(5);
    expect(result.sources.failures.filter((failure) => failure.url === primary).length).toBeGreaterThan(0);
    expect(result.sources.failures[0]?.reason).toMatch(/HTTP 403/);
  });

  it("treats a deprecated method on the first endpoint as an endpoint failure", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(
      world,
      { rpc: (url) => (url === "https://rpc-one.test" ? json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }) : undefined) },
      { rpcUrls: ["https://rpc-one.test", "https://rpc-two.test"] },
    );
    expect(result.summary.failed).toBe(0);
    expect(find(result, "S2", "PASS")).toHaveLength(1);
  });

  it("marks chain checks UNAVAILABLE with a manual URL when every RPC is down", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(world, { rpc: () => new Response("down", { status: 502 }) }, { rpcUrls: ["https://rpc-one.test"] });
    expect(result.summary.failed).toBe(0);
    expect(result.exitCode).toBe(0);
    const c1 = find(result, "C1", "UNAVAILABLE");
    expect(c1).toHaveLength(5);
    expect(c1[0]?.url).toMatch(/^https:\/\/suiscan\.xyz\/testnet\/tx\//);
    expect(find(result, "S2", "UNAVAILABLE")[0]?.url).toMatch(/^https:\/\/testnet\.suivision\.xyz\/object\//);
    expect(find(result, "R16", "UNAVAILABLE")).toHaveLength(5);
    expect(renderMarkdown(result)).toContain("check by hand: https://suiscan.xyz/testnet/tx/");
  });

  it("fails a commit transaction that no endpoint knows", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    world.transactions.delete(world.seats[0]!.commitTx!);
    const result = await runAudit(world);
    expect(find(result, "C1", "FAIL")[0]?.detail).toMatch(/not found on Sui/);
    expect(result.exitCode).toBe(1);
  });

  it("marks the receipt UNAVAILABLE on a 404 and keeps the direct URL", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(world, { receiptStatus: 404 });
    const receipts = find(result, "R17", "UNAVAILABLE");
    expect(receipts).toHaveLength(5);
    expect(receipts[0]?.detail).toMatch(/no receipt/);
    expect(receipts[0]?.url).toMatch(/^https:\/\/api\.gonkarouter\.io\/v1\/receipts\/req-/);
    expect(result.exitCode).toBe(0);
    expect(renderMarkdown(result)).toContain("5 receipt(s) confirmed".replace("5", "0"));
  });

  it("marks Walrus checks UNAVAILABLE when the aggregator times out", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const startedAt = Date.now();
    const result = await runAudit(world, { walrusHang: true }, { timeoutMs: 60 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(find(result, "R18", "UNAVAILABLE")).toHaveLength(5);
    expect(find(result, "R18", "UNAVAILABLE")[0]?.detail).toBe("timed out");
    expect(find(result, "S4.manifest", "UNAVAILABLE")).toHaveLength(1);
    expect(find(result, "S4.root", "PASS")).toHaveLength(1);
    expect(result.summary.failed).toBe(0);
  });

  it("prefers the events feed for digests and notes a report that names another transaction", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const bundle = world.report.auditBundle as { reveals: Array<{ transactionDigest: string }>; commitments: Array<{ transactionDigest: string }> };
    bundle.reveals[0]!.transactionDigest = "reveal-stale";
    bundle.commitments[1]!.transactionDigest = "commit-stale";
    const result = await runAudit(world);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.unavailable).toBe(0);
    const noted = every(result).filter((entry) => /differs between sources/.test(entry.detail ?? ""));
    expect(noted.map((entry) => entry.id).sort()).toEqual(["C1", "C2"]);
    expect(noted.find((entry) => entry.id === "C2")?.detail).toMatch(/events reveal-1-0, report reveal-stale/);
    expect(noted.find((entry) => entry.id === "C1")?.detail).toMatch(/events commit-1-1, report commit-stale/);
  });

  it("falls back to the report digests and a record timeline when the event history is down", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(world, { eventsStatus: 500 });
    expect(result.summary.failed).toBe(0);
    expect(find(result, "C1", "PASS")).toHaveLength(5);
    expect(find(result, "C2", "PASS")).toHaveLength(5);
    expect(result.timelineSource).toBe("record");
    expect(result.timeline.map((entry) => entry.event)).toContain("claim_finalized");
    expect(result.sources.failures.some((failure) => failure.source === "events")).toBe(true);
    expect(renderMarkdown(result)).toContain("Rebuilt from the record and the chain");
  });

  it("keeps auditing when the report is down", async () => {
    const world = buildWorld(RESEARCH_CLAIM);
    const result = await runAudit(world, { reportStatus: 500 });
    expect(result.summary.failed).toBe(0);
    // Without the record side, C1 cannot compare but C2 still recomputes against the chain.
    expect(find(result, "C1", "UNAVAILABLE")).toHaveLength(5);
    expect(find(result, "C2", "PASS")).toHaveLength(5);
    expect(find(result, "C3", "PASS")).toHaveLength(5);
    expect(find(result, "S1", "PASS")).toHaveLength(1);
  });
});

describe("listBoard", () => {
  it("lists the board newest first with state, result, score and attempt", async () => {
    const fetchBoard: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://example.test/api/claims?limit=2");
      return new Response(
        JSON.stringify({
          claims: [
            {
              claimId: "0xaaaa",
              state: 10,
              statement: "Water boils at 100 C at sea level.",
              result: { result: "YES", truthScoreBps: 9250 },
              attemptChain: { attempt: 1, maxAttempts: 3, status: "SETTLED" },
            },
            { claimId: "0xbbbb", state: 4, statement: "A | pipe", attemptChain: { attempt: 2, maxAttempts: 3, status: "VOIDED" } },
            { claimId: "0xcccc", state: 11, statement: "third" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const rows = await listBoard("https://example.test/", { fetch: fetchBoard, limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      claimId: "0xaaaa",
      stateLabel: "FINALIZED_REVIEWED",
      result: "YES",
      truthScoreBps: 9250,
      attempt: "1 of 3 SETTLED",
      link: "https://example.test/claims/0xaaaa",
    });
    expect(rows[1]).toMatchObject({ claimId: "0xbbbb", stateLabel: "COMMIT_1", attempt: "2 of 3 VOIDED" });
    expect(rows[1]).not.toHaveProperty("result");
    const table = renderBoard(rows);
    expect(table).toContain("| 1 | 0xaaaa | FINALIZED_REVIEWED | YES 92.50 | 1 of 3 SETTLED | Water boils at 100 C at sea level. |");
    // A pipe inside a statement must not break the table.
    expect(table).toContain("A \\| pipe");
    expect(table).toContain("- 1: 0xaaaa https://example.test/claims/0xaaaa");
  });

  it("fails with a plain message when the board request fails", async () => {
    const failing: typeof fetch = async () => new Response("nope", { status: 503 });
    await expect(listBoard("https://example.test", { fetch: failing })).rejects.toThrow(/board request failed: HTTP 503/);
  });
});

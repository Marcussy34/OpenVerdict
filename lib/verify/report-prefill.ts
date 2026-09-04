/**
 * Reads the public report (GET /api/claims/<id>/report) into the fields the
 * Audit page fills by hand.
 *
 * Every value here is already public: the commitments, run hashes and evidence
 * roots come from `auditBundle`, the outcomes and confidences from
 * `finalRoundVotes`. The salt is the one preimage field the record never
 * publishes (it lives in the reveal transaction on Sui), so it is not here
 * either and the reader supplies it.
 */
import { OUTCOME, type VoteOutcome } from "../protocol/constants";

export type SeatFill = {
  jurySeatId: string;
  agentProfileId: string;
  phase: 1 | 2;
  outcome: VoteOutcome;
  confidenceBps: number;
  evidenceRoot: string;
  outputHash: string;
  runHash: string;
  /** The commitment Sui holds for this seat, to compare a recomputation with. */
  commitment: string;
  runId: string;
  modelId?: string;
  /** The reveal transaction: where the salt is, for a reader who wants it. */
  revealTx?: string;
};

export type ClaimRecord = {
  claimId: string;
  statement: string;
  /** YES, NO, UNSURE, UNRESOLVED or PENDING. */
  label: string;
  /** The certificate score (basis points / 100), null before settlement. */
  truthScore: number | null;
  /** One entry per valid reveal of the deciding round, in report order. */
  seats: SeatFill[];
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const OUTCOME_CODES: Record<string, VoteOutcome> = {
  YES: OUTCOME.YES,
  NO: OUTCOME.NO,
  UNSURE: OUTCOME.UNSURE,
};

/** The public report as the by-hand tabs need it; null when it is not a report. */
export function readClaimRecord(value: unknown): ClaimRecord | null {
  if (!isRecord(value)) return null;
  const claimId = str(value.claimId);
  if (claimId === undefined) return null;

  const bundle = isRecord(value.auditBundle) ? value.auditBundle : {};
  const commitments = records(bundle.commitments);
  const runs = records(bundle.runs);
  const reveals = records(bundle.reveals);
  const evidence = records(bundle.evidence);
  const agents = records(value.agents);

  const rootByPhase = new Map<number, string>();
  for (const manifest of evidence) {
    const phase = num(manifest.phase);
    const root = str(manifest.root);
    if (phase !== undefined && root !== undefined) rootByPhase.set(phase, root);
  }
  const modelByAgent = new Map<string, string>();
  for (const agent of agents) {
    const id = str(agent.agentProfileId);
    const modelId = str(agent.modelId);
    if (id !== undefined && modelId !== undefined) modelByAgent.set(id, modelId);
  }

  const seats: SeatFill[] = [];
  for (const vote of records(value.finalRoundVotes)) {
    // Only valid reveals enter the certificate's score, so only they are worth
    // recomputing; an invalid one has no matching preimage to fill.
    if (vote.valid === false) continue;
    const jurySeatId = str(vote.jurySeatId);
    const outcome = OUTCOME_CODES[str(vote.outcome) ?? ""];
    const confidenceBps = num(vote.confidenceBps);
    if (jurySeatId === undefined || outcome === undefined || confidenceBps === undefined) continue;

    // Seats are per round, so a deciding-round seat has exactly one commitment;
    // the highest phase wins if a deployment ever reuses a seat across rounds.
    const commitment = commitments
      .filter((entry) => str(entry.jurySeatId) === jurySeatId)
      .sort((a, b) => (num(b.phase) ?? 0) - (num(a.phase) ?? 0))[0];
    if (commitment === undefined) continue;

    const phase = num(commitment.phase);
    const agentProfileId = str(commitment.agentProfileId);
    const commitmentHex = str(commitment.commitment);
    if ((phase !== 1 && phase !== 2) || agentProfileId === undefined || commitmentHex === undefined) {
      continue;
    }

    const run = runs.find((entry) => str(entry.agentProfileId) === agentProfileId);
    const runId = str(run?.runId);
    const outputHash = str(run?.outputHash);
    const runHash = str(run?.runHash);
    const evidenceRoot = rootByPhase.get(phase);
    if (
      runId === undefined ||
      outputHash === undefined ||
      runHash === undefined ||
      evidenceRoot === undefined
    ) {
      continue;
    }

    const seat: SeatFill = {
      jurySeatId,
      agentProfileId,
      phase,
      outcome,
      confidenceBps,
      evidenceRoot,
      outputHash,
      runHash,
      commitment: commitmentHex,
      runId,
    };
    const modelId = modelByAgent.get(agentProfileId);
    if (modelId !== undefined) seat.modelId = modelId;
    const revealTx = str(reveals.find((entry) => str(entry.runId) === runId)?.transactionDigest);
    if (revealTx !== undefined) seat.revealTx = revealTx;
    seats.push(seat);
  }

  return {
    claimId,
    statement: str(value.statement) ?? "",
    label: str(value.label) ?? "PENDING",
    truthScore: num(value.truthScore) ?? null,
    seats,
  };
}

/** "deepseek-ai/DeepSeek-V4-Flash-0731" reads as "DeepSeek-V4-Flash-0731". */
export function shortModel(modelId: string | undefined): string {
  if (modelId === undefined) return "Unknown model";
  const slash = modelId.lastIndexOf("/");
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

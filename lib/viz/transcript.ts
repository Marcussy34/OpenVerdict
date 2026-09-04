/**
 * The live transcript of one claim: the public event stream read as a
 * conversation, plus one card per juror whose status line advances with the
 * same events (docs/superpowers/specs/2026-09-04-fast-path-design.md).
 *
 * Pure and clock-free. Entries carry a link target the view turns into an
 * explorer URL; the wording matches `ov watch`, so the terminal and the
 * console tell the same story. Nothing here infers a vote: a seat is sealed
 * until its reveal event says otherwise.
 */
import type {
  ClaimInspection,
  DeliberationTurnPublic,
  ResolutionEvent,
} from "../engine/contract";
import {
  runCompletedAtMs,
  runTrail,
  trailTurnTimes,
  type TrailTurn,
} from "../research/trail";
import { familyOfModelId, type JurorFamily } from "./deliberation-graph";
import { feedDomain, researchFeed, type ResearchFeedStep } from "./research-feed";

export type TranscriptTone =
  | "neutral"
  | "chain"
  | "sealed"
  | "yes"
  | "no"
  | "unsure"
  | "alert";

export type TranscriptEntryKind =
  | "statement"
  | "claim"
  | "evidence"
  | "committee"
  | "run"
  | "commit"
  | "phase"
  | "reveal"
  | "debate"
  | "repair"
  | "failure"
  | "final"
  | "void";

/** Where an entry's link points; the view builds the URL. */
export type TranscriptLink = {
  label: string;
  target: "object" | "transaction" | "claim";
  id: string;
};

export type TranscriptEntry = {
  id: string;
  kind: TranscriptEntryKind;
  atMs: number;
  /** The line itself, one sentence, in the protocol lexicon. */
  text: string;
  /** A quieter second line: a hash, a count, the first words of an argument. */
  detail?: string;
  tone?: TranscriptTone;
  seatId?: string;
  link?: TranscriptLink;
  /** The juror cards render right after this entry (the draw). */
  showJurors?: boolean;
};

export type TranscriptJurorState =
  | "waiting"
  | "researching"
  | "sealed"
  | "revealed"
  | "failed";

/** One state the seat passed through, and the line that says so. */
export type TranscriptMoment = {
  atMs: number;
  state: TranscriptJurorState;
  status: string;
};

export type TranscriptJuror = {
  /** 1-based juror number, stable across both rounds. */
  index: number;
  agentProfileId: string;
  modelId?: string;
  family: JurorFamily;
  role?: string;
  /** This juror's seats, round one first. */
  seats: Array<{ seatId: string; phase: 1 | 2 }>;
  steps: ResearchFeedStep[];
  timeline: TranscriptMoment[];
  outcome?: "YES" | "NO" | "UNSURE";
  confidenceBps?: number;
  failureStatus?: string;
};

export type Transcript = {
  entries: TranscriptEntry[];
  jurors: TranscriptJuror[];
};

/** What a juror card shows at one point in time. */
export type TranscriptJurorView = {
  state: TranscriptJurorState;
  status: string;
  steps: ResearchFeedStep[];
};

const FAMILY_NAME: Record<JurorFamily, string> = {
  deepseek: "DeepSeek",
  kimi: "Kimi",
  minimax: "MiniMax",
  unknown: "",
};

/** Sites named on one status line before the rest becomes a count. */
const STATUS_DOMAINS = 3;
/** How much of a debate argument the transcript quotes. */
const ARGUMENT_PREVIEW = 180;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function stringAt(value: UnknownRecord | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function numberAt(value: UnknownRecord | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function stringsAt(value: UnknownRecord | undefined, key: string): string[] {
  const candidate = value?.[key];
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function eventTime(event: ResolutionEvent): number | undefined {
  const parsed = Date.parse(event.publishedAt ?? event.occurredAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function distinctDomains(urls: readonly string[]): string[] {
  const sites: string[] = [];
  for (const url of urls) {
    const site = feedDomain(url);
    if (site !== undefined && !sites.includes(site)) sites.push(site);
  }
  return sites;
}

/** One trail turn as a feed step, or nothing for an action with no public shape. */
function stepOfTurn(
  turn: TrailTurn,
  base: { seatId: string; atMs: number; runId?: string },
): ResearchFeedStep | undefined {
  const ordinal = turn.ordinal - 1;
  const common = {
    seatId: base.seatId,
    ordinal,
    atMs: base.atMs,
    ...(base.runId === undefined ? {} : { runId: base.runId }),
  };
  if (turn.action === "search") {
    return {
      ...common,
      kind: "search",
      ...(turn.intent === "support" || turn.intent === "challenge"
        ? { intent: turn.intent }
        : {}),
      ...(turn.query === undefined ? {} : { query: turn.query }),
      domains: distinctDomains((turn.results ?? []).map((result) => result.url)),
    };
  }
  if (turn.action === "open") {
    const urls = turn.urls ?? (turn.pages ?? []).map((page) => page.url);
    return {
      ...common,
      kind: "open",
      domains: distinctDomains(urls),
      pageCount: turn.pages?.length ?? urls.length,
    };
  }
  if (turn.action === "answer") return { ...common, kind: "answer", domains: [] };
  return undefined;
}

/**
 * One seat's steps rebuilt from its revealed run proof, for the claims that
 * ran before the live feed existed. The same trail `ov trace` prints: the
 * conversation in the bundle, or the sealed transcript for a legacy bundle.
 */
export function stepsFromRunProof(
  proof: unknown,
  context: { seatId: string },
): ResearchFeedStep[] {
  const parsed = record(proof);
  const bundle = parsed?.bundle;
  if (bundle === undefined || bundle === null) return [];
  const times = trailTurnTimes(bundle);
  const completedAtMs = runCompletedAtMs(bundle) ?? 0;
  const runId = stringAt(parsed, "runId");
  const base = (turn: TrailTurn) => ({
    seatId: context.seatId,
    atMs: times.get(turn.ordinal) ?? completedAtMs,
    ...(runId === undefined ? {} : { runId }),
  });
  const steps = runTrail(bundle).flatMap((turn) => {
    const step = stepOfTurn(turn, base(turn));
    return step === undefined ? [] : [step];
  });
  // The bundle records the conversation as it was sent, so the final answer
  // is in validatedOutput rather than in a message: `ov trace` appends that
  // turn too, and the card ends on the same step a live run ends on.
  const answered = record(bundle)?.validatedOutput !== undefined;
  const last = steps.at(-1);
  if (answered && last?.kind !== "answer") {
    steps.push({
      seatId: context.seatId,
      ordinal: steps.length,
      kind: "answer",
      domains: [],
      atMs: completedAtMs,
      ...(runId === undefined ? {} : { runId }),
    });
  }
  return steps;
}

/** "DeepSeek" for deepseek-ai/DeepSeek-V4-Flash-0731; the id when unknown. */
export function modelName(modelId: string | undefined): string {
  const family = FAMILY_NAME[familyOfModelId(modelId)];
  if (family.length > 0) return family;
  return modelId ?? "unknown model";
}

/** Confidence in whole percent, the way the skill says it out loud. */
function percent(confidenceBps: number | undefined): string {
  return confidenceBps === undefined
    ? "an unrecorded confidence"
    : `${Math.round(confidenceBps / 100)} percent`;
}

/** "2.00" for 200 bps of truth score. */
function score(bps: number | null | undefined): string {
  return bps === undefined || bps === null ? "not recorded" : (bps / 100).toFixed(2);
}

function shortId(value: string | undefined): string {
  if (value === undefined || value.length <= 12) return value ?? "";
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

const STATE_WORDS: Record<number, string> = {
  0: "jury forming",
  1: "jury forming",
  2: "jury forming",
  3: "jury forming",
  4: "round one research and sealed votes",
  5: "round one reveal",
  6: "discussion",
  7: "round two commit",
  8: "round two reveal",
  9: "finalized",
  10: "finalized",
  11: "unresolved",
  12: "cancelled",
};

function phaseWords(value: unknown): string {
  if (typeof value === "number") return STATE_WORDS[value] ?? `state ${value}`;
  if (typeof value !== "string") return "an unknown state";
  const label = value.toUpperCase();
  if (label === "COMMIT_1") return STATE_WORDS[4]!;
  if (label === "REVEAL_1") return STATE_WORDS[5]!;
  if (label === "DISCUSSION") return STATE_WORDS[6]!;
  if (label === "COMMIT_2") return STATE_WORDS[7]!;
  if (label === "REVEAL_2") return STATE_WORDS[8]!;
  if (label.startsWith("FINALIZED")) return "finalized";
  if (label === "UNRESOLVED") return "unresolved";
  if (label === "CANCELLED") return "cancelled";
  return value.toLowerCase().replace(/_/g, " ");
}

/** One sentence for a phase change, by where it lands. */
function phaseSentence(to: unknown, from: unknown): string {
  const target = typeof to === "number" ? STATE_WORDS[to] : phaseWords(to);
  switch (target) {
    case "round one reveal":
      return "The votes open together now: Sui recomputes every commitment before accepting it.";
    case "discussion":
      return "No four matching votes, so the cascade: the revealed jurors debate over the frozen record.";
    case "round two commit":
      return "Round two is the table vote: one sealed ballot per juror over the frozen record, no new research.";
    case "round two reveal":
      return "The table votes open together.";
    default:
      return `Phase: ${phaseWords(from)} to ${phaseWords(to)}.`;
  }
}

/** The status line one research step puts on a juror card. */
function stepStatus(step: ResearchFeedStep): string {
  if (step.kind === "answer") return "drafting the answer";
  if (step.kind === "search") {
    if (step.intent === "challenge") return "searching for evidence against the claim";
    if (step.intent === "support") return "searching for evidence for the claim";
    return "searching the web";
  }
  if (step.domains.length === 0) {
    const count = step.pageCount ?? 0;
    return count === 1 ? "reading a page" : `reading ${count} pages`;
  }
  const shown = step.domains.slice(0, STATUS_DOMAINS).join(", ");
  const rest = step.domains.length - STATUS_DOMAINS;
  return `reading ${shown}${rest > 0 ? `, +${rest} more` : ""}`;
}

type SeatFacts = {
  seatId: string;
  phase: 1 | 2;
  agentProfileId: string;
  modelId?: string;
  index: number;
};

/** Juror numbers by agent, in round then seat order, as `ov watch` numbers them. */
function seatFacts(claim: ClaimInspection): Map<string, SeatFacts> {
  const byId = new Map<string, SeatFacts>();
  const status = new Map(
    (claim.commitments ?? []).map((seat) => [seat.jurySeatId, seat]),
  );
  const rounds = (claim.rounds ?? []).map((round) => ({
    phase: round.phase,
    seatIds: [...round.expectedJurySeatIds],
  }));
  const listed = new Set(rounds.flatMap((round) => round.seatIds));
  const extra = (claim.commitments ?? [])
    .map((seat) => seat.jurySeatId)
    .filter((seatId) => !listed.has(seatId));
  if (extra.length > 0) {
    const phase = rounds.length === 0 ? 1 : 2;
    const existing = rounds.find((round) => round.phase === phase);
    if (existing) existing.seatIds.push(...extra);
    else rounds.push({ phase: phase as 1 | 2, seatIds: extra });
  }

  let next = 1;
  const numberByAgent = new Map<string, number>();
  for (const round of rounds.sort((left, right) => left.phase - right.phase)) {
    for (const seatId of round.seatIds) {
      const seat = status.get(seatId);
      const agentProfileId = seat?.agentProfileId ?? seatId;
      let index = numberByAgent.get(agentProfileId);
      if (index === undefined) {
        index = next;
        next += 1;
        numberByAgent.set(agentProfileId, index);
      }
      byId.set(seatId, {
        seatId,
        phase: round.phase,
        agentProfileId,
        ...(seat?.modelId === undefined ? {} : { modelId: seat.modelId }),
        index,
      });
    }
  }
  return byId;
}

/**
 * The claim's public record as a conversation plus its juror cards. `agents`
 * is the public agent directory, which carries the model and the role of a
 * seat before any run is revealed.
 */
export function buildTranscript(input: {
  claim: ClaimInspection;
  events: readonly ResolutionEvent[];
  agents?: ReadonlyMap<string, { modelId?: string; role?: string }>;
  /** Revealed run proofs the page has fetched; a seat with no live steps
   *  rebuilds its trail from the one that carries its jury seat id. */
  proofs?: readonly unknown[];
}): Transcript {
  const { claim, events } = input;
  const facts = seatFacts(claim);
  const feed = researchFeed(events);
  const entries: TranscriptEntry[] = [];
  const committed = new Map<number, number>();
  const revealed = new Map<number, number>();
  const expectedByPhase = new Map<number, number>(
    (claim.rounds ?? []).map((round) => [
      round.phase,
      round.expectedJurySeatIds.length,
    ]),
  );

  // --- jurors ------------------------------------------------------------
  const jurors = new Map<number, TranscriptJuror>();
  const jurorOf = (seatId: string | undefined): TranscriptJuror | undefined => {
    if (seatId === undefined) return undefined;
    const seat = facts.get(seatId);
    if (seat === undefined) return undefined;
    const existing = jurors.get(seat.index);
    if (existing !== undefined) return existing;
    const directory = input.agents?.get(seat.agentProfileId);
    const modelId = seat.modelId ?? directory?.modelId;
    const juror: TranscriptJuror = {
      index: seat.index,
      agentProfileId: seat.agentProfileId,
      ...(modelId === undefined ? {} : { modelId }),
      family: familyOfModelId(modelId),
      ...(directory?.role === undefined ? {} : { role: directory.role }),
      seats: [],
      steps: [],
      timeline: [],
    };
    jurors.set(seat.index, juror);
    return juror;
  };

  // Seats first, so a card exists before its first event lands.
  for (const seatId of facts.keys()) {
    const juror = jurorOf(seatId);
    const seat = facts.get(seatId)!;
    if (juror && !juror.seats.some((entry) => entry.seatId === seatId)) {
      juror.seats.push({ seatId, phase: seat.phase });
    }
  }
  const proofBySeat = new Map<string, unknown>();
  for (const proof of input.proofs ?? []) {
    const seatId = stringAt(record(proof), "jurySeatId");
    if (seatId !== undefined) proofBySeat.set(seatId, proof);
  }

  for (const juror of jurors.values()) {
    juror.seats.sort((left, right) => left.phase - right.phase);
    for (const seat of juror.seats) {
      // Live steps win; the run proof only fills a seat the feed never saw,
      // so nothing is ever counted twice.
      const live = feed.get(seat.seatId) ?? [];
      if (live.length > 0) {
        juror.steps.push(...live);
        continue;
      }
      const proof = proofBySeat.get(seat.seatId);
      if (proof !== undefined) {
        juror.steps.push(...stepsFromRunProof(proof, { seatId: seat.seatId }));
      }
    }
    for (const step of juror.steps) {
      juror.timeline.push({
        atMs: step.atMs,
        state: "researching",
        status: stepStatus(step),
      });
    }
  }

  const label = (seatId: string | undefined): string => {
    const juror = jurorOf(seatId);
    if (juror === undefined) return "A juror";
    const name = juror.modelId === undefined ? undefined : modelName(juror.modelId);
    return name === undefined
      ? `Juror ${juror.index}`
      : `Juror ${juror.index} (${name})`;
  };

  const moment = (
    seatId: string | undefined,
    atMs: number,
    state: TranscriptJurorState,
    status: string,
  ): void => {
    jurorOf(seatId)?.timeline.push({ atMs, state, status });
  };

  // --- the statement, as the person's own message -------------------------
  const firstAtMs = events.reduce<number | undefined>((earliest, event) => {
    const atMs = eventTime(event);
    if (atMs === undefined) return earliest;
    return earliest === undefined ? atMs : Math.min(earliest, atMs);
  }, undefined);
  const statementAtMs = firstAtMs ?? claim.deadlines.evidenceCutoffMs;
  entries.push({
    id: "statement",
    kind: "statement",
    atMs: statementAtMs,
    text: claim.statement,
    detail: claim.resolutionCriteria,
  });

  // --- the stream ---------------------------------------------------------
  let lastAtMs = statementAtMs;
  for (const event of events) {
    if (event.visibility !== "PUBLIC_NOW") continue;
    const payload = record(event.payload) ?? {};
    const atMs = eventTime(event) ?? lastAtMs;
    lastAtMs = Math.max(lastAtMs, atMs);
    const seatId =
      stringAt(payload, "jury_seat_id") ?? stringAt(payload, "jurySeatId");
    const phase = numberAt(payload, "phase") ?? (facts.get(seatId ?? "")?.phase ?? 1);
    const id = `${event.kind}:${event.sequence}`;
    const push = (entry: Omit<TranscriptEntry, "id" | "atMs">): void => {
      entries.push({ id, atMs, ...entry });
    };

    switch (event.kind) {
      case "claim_created": {
        const digest = stringAt(payload, "transaction_digest") ?? event.transactionDigest;
        push({
          kind: "claim",
          text: "The claim is live on Sui, and its deadlines started with it.",
          tone: "chain",
          ...(digest === undefined
            ? {}
            : { link: { label: "transaction", target: "transaction", id: digest } }),
        });
        break;
      }
      case "committee_selected": {
        const seatIds = stringsAt(payload, "jury_seat_ids");
        const models = seatIds.map((seat) => modelName(facts.get(seat)?.modelId));
        push({
          kind: "committee",
          text: `Sui's own randomness drew ${seatIds.length} seats: ${models.join(", ")}.`,
          detail: "At most two seats per model family, three families in every jury.",
          tone: "chain",
          showJurors: true,
        });
        for (const seat of seatIds) {
          moment(seat, atMs, "waiting", "seat drawn, waiting to start");
        }
        break;
      }
      case "evidence_frozen": {
        const root = stringAt(payload, "root") ?? event.artifactHash;
        push({
          kind: "evidence",
          text:
            phase === 2
              ? "The debate transcript is frozen as phase-two evidence; round two opens on it."
              : "The evidence is frozen before any juror reasons. Nothing can be slipped in or out now.",
          detail: root === undefined ? undefined : `root ${shortId(root)} on Sui, manifest on Walrus`,
          tone: "chain",
        });
        break;
      }
      case "run_approved": {
        push({
          kind: "run",
          seatId,
          text: `${label(seatId)} finished its research; its run hash is on Sui and its sealed bundle is cited on chain.`,
          tone: "sealed",
        });
        moment(seatId, atMs, "researching", "research finished, run approved on Sui");
        break;
      }
      case "vote_committed": {
        const count = (committed.get(phase) ?? 0) + 1;
        committed.set(phase, count);
        const round = phase === 2 ? ", round two" : "";
        push({
          kind: "commit",
          seatId,
          text: `${label(seatId)} sealed its vote (${count} of ${expectedByPhase.get(phase) ?? 5}${round}).`,
          detail: "Nobody, the operator included, can read it yet.",
          tone: "sealed",
        });
        moment(seatId, atMs, "sealed", phase === 2 ? "table vote sealed" : "vote sealed");
        break;
      }
      case "vote_revealed": {
        const count = (revealed.get(phase) ?? 0) + 1;
        revealed.set(phase, count);
        const outcome = stringAt(payload, "outcome");
        const confidenceBps = numberAt(payload, "confidence_bps");
        const round = phase === 2 ? ", round two" : "";
        const invalid = payload.valid === false ? ", invalid" : "";
        push({
          kind: "reveal",
          seatId,
          text: `${label(seatId)} revealed ${outcome ?? "its vote"} at ${percent(confidenceBps)} (${count} of ${expectedByPhase.get(phase) ?? 5}${round}${invalid}).`,
          tone: toneOfOutcome(outcome),
        });
        moment(
          seatId,
          atMs,
          "revealed",
          `revealed ${outcome ?? "its vote"} at ${percent(confidenceBps)}`,
        );
        const juror = jurorOf(seatId);
        if (juror !== undefined && isOutcome(outcome)) {
          juror.outcome = outcome;
          if (confidenceBps !== undefined) juror.confidenceBps = confidenceBps;
        }
        break;
      }
      case "phase_changed": {
        const to = payload.new_phase ?? payload.to;
        const from = payload.previous_phase ?? payload.from;
        push({ kind: "phase", text: phaseSentence(to, from) });
        break;
      }
      case "DELIBERATION_TURN": {
        const turn = event.payload as Partial<DeliberationTurnPublic>;
        const ordinal = numberAt(payload, "ordinal");
        const number = ordinal === undefined ? "?" : String(ordinal + 1);
        const who = label(turn.jurySeatId);
        if (turn.status === "SKIPPED") {
          push({
            kind: "debate",
            seatId: turn.jurySeatId,
            text: `Debate turn ${number}, ${who} skipped${turn.failureStatus ? ` (${turn.failureStatus})` : ""}.`,
            tone: "alert",
          });
          break;
        }
        push({
          kind: "debate",
          seatId: turn.jurySeatId,
          text: `Debate turn ${number}, ${who}${turn.stance ? ` ${turn.stance} at ${percent(turn.confidenceBps)}` : ""}.`,
          detail: turn.argument ? truncate(turn.argument, ARGUMENT_PREVIEW) : undefined,
          tone: toneOfOutcome(turn.stance),
        });
        break;
      }
      case "debate_converged": {
        const exchange =
          numberAt(payload, "exchange") ?? numberAt(payload, "convergedAfterExchange");
        push({
          kind: "debate",
          text: `The debate stopped after exchange ${exchange ?? "?"}: nobody moved.`,
        });
        break;
      }
      case "output_repaired": {
        push({
          kind: "repair",
          seatId,
          text: `${label(seatId)} had its output repaired: ${stringAt(payload, "field") ?? "a field"}. The vote and the confidence were not touched.`,
          tone: "alert",
        });
        break;
      }
      case "inference_failed": {
        const category = stringAt(payload, "category") ?? "failed";
        push({
          kind: "failure",
          seatId,
          text: `${label(seatId)} failed closed: ${category}. No vote is ever invented for a failed seat.`,
          tone: "alert",
        });
        moment(seatId, atMs, "failed", `failed: ${category}`);
        break;
      }
      case "claim_finalized": {
        const outcome = stringAt(payload, "outcome");
        const certificate = stringAt(payload, "certificate_id");
        push({
          kind: "final",
          text: `Final: ${outcome ?? "no result"}, truth score ${score(numberAt(payload, "truth_score_bps"))}.`,
          detail: certificate === undefined ? undefined : `certificate ${shortId(certificate)} on Sui`,
          tone: toneOfOutcome(outcome),
          ...(certificate === undefined
            ? {}
            : { link: { label: "certificate", target: "object", id: certificate } }),
        });
        break;
      }
      case "verification_voided": {
        const reason = stringAt(payload, "reason") ?? "a seat failed closed";
        const model = stringAt(payload, "model_id");
        const attempt = numberAt(payload, "attempt");
        push({
          kind: "void",
          text: `Attempt ${attempt ?? "?"} voided: ${reason}${model ? ` (${modelName(model)}, phase ${numberAt(payload, "phase") ?? "?"})` : ""}. Nothing partial is finalized.`,
          detail: stringAt(payload, "message"),
          tone: "alert",
        });
        break;
      }
      case "verification_relaunched": {
        const next = numberAt(payload, "next_attempt");
        const relaunchedAs = stringAt(payload, "relaunched_as");
        push({
          kind: "void",
          text: `Relaunched as attempt ${next ?? "?"} of 3.`,
          tone: "alert",
          ...(relaunchedAs === undefined
            ? {}
            : { link: { label: "follow the new attempt", target: "claim", id: relaunchedAs } }),
        });
        break;
      }
      case "verification_gave_up": {
        push({
          kind: "void",
          text: `The verification gave up: ${stringAt(payload, "reason") ?? "no reason recorded"}. There is no certificate; every attempt stays public.`,
          tone: "alert",
        });
        break;
      }
      default:
        break;
    }
  }

  // The record is the authority on where a seat ended: a dropped event never
  // leaves a card claiming a juror is still reading.
  for (const commitment of claim.commitments ?? []) {
    const juror = jurorOf(commitment.jurySeatId);
    if (juror === undefined) continue;
    const last = juror.timeline.at(-1);
    if (commitment.failureStatus !== undefined) {
      juror.failureStatus = commitment.failureStatus;
      if (last?.state !== "failed") {
        juror.timeline.push({
          atMs: lastAtMs,
          state: "failed",
          status: `failed before commit: ${commitment.failureStatus}`,
        });
      }
      continue;
    }
    if (commitment.revealed && last?.state !== "revealed") {
      const outcome = outcomeLabel(commitment.outcome);
      juror.timeline.push({
        atMs: lastAtMs,
        state: "revealed",
        status: `revealed ${outcome ?? "its vote"} at ${percent(commitment.confidenceBps)}`,
      });
      if (outcome !== undefined) juror.outcome = outcome;
      if (commitment.confidenceBps !== undefined) {
        juror.confidenceBps = commitment.confidenceBps;
      }
      continue;
    }
    if (commitment.committed && last === undefined) {
      juror.timeline.push({ atMs: lastAtMs, state: "sealed", status: "vote sealed" });
    }
  }

  for (const juror of jurors.values()) {
    juror.steps.sort((left, right) => left.atMs - right.atMs || left.ordinal - right.ordinal);
    juror.timeline.sort((left, right) => left.atMs - right.atMs);
  }

  return {
    entries,
    jurors: [...jurors.values()].sort((left, right) => left.index - right.index),
  };
}

function isOutcome(value: unknown): value is "YES" | "NO" | "UNSURE" {
  return value === "YES" || value === "NO" || value === "UNSURE";
}

/** The shared u8 vote outcome, or its label, as a label. */
function outcomeLabel(value: unknown): "YES" | "NO" | "UNSURE" | undefined {
  if (isOutcome(value)) return value;
  if (value === 1) return "YES";
  if (value === 2) return "NO";
  if (value === 3) return "UNSURE";
  return undefined;
}

function toneOfOutcome(value: unknown): TranscriptTone {
  const outcome = outcomeLabel(value);
  if (outcome === "YES") return "yes";
  if (outcome === "NO") return "no";
  if (outcome === "UNSURE") return "unsure";
  return "neutral";
}

/** The entries the viewer had seen by time `t` (replay); all of them at Infinity. */
export function visibleEntriesAt(
  entries: readonly TranscriptEntry[],
  t: number,
): TranscriptEntry[] {
  return entries.filter((entry) => entry.atMs <= t);
}

/** One juror card as it stood at time `t`. */
export function jurorAt(juror: TranscriptJuror, t: number): TranscriptJurorView {
  let current: TranscriptMoment | undefined;
  for (const point of juror.timeline) {
    if (point.atMs > t) break;
    current = point;
  }
  return {
    state: current?.state ?? "waiting",
    status: current?.status ?? "waiting for the draw",
    steps: juror.steps.filter((step) => step.atMs <= t),
  };
}

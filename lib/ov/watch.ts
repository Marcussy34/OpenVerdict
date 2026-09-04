/**
 * `ov watch`: follow one verification live and print each step as one dated
 * line (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
 *
 * A small state machine with injected fetch (through Api), clock and sleep,
 * so the tests drive it through a virtual clock and run instantly:
 *
 *   resolve target      claim link -> CLAIM, queue link -> QUEUE,
 *                       bare id -> try the claim, then the queue
 *   QUEUE               poll every 30 s, print weather changes, LAUNCHED -> CLAIM,
 *                       EXPIRED or CANCELLED -> exit 3, budget spent -> exit 4
 *   CLAIM               read the claim record (seats, chain); GAVE_UP -> exit 3;
 *                       VOIDED -> relaunched ? CLAIM(new) : VOID_WAIT; otherwise
 *                       race three tasks, first outcome wins, the rest are aborted:
 *                         stream  SSE history then live lines, reconnects with backoff
 *                         poll    the claim record every 60 s (voids, gave up, result)
 *                         budget  --for elapsed -> "still ..." and exit 4
 *   VOID_WAIT           poll every 60 s for relaunchedAs -> CLAIM(new); GAVE_UP -> 3;
 *                       budget spent -> exit 3 with the void detail
 *
 * Every request has a timeout and the SSE reader is aborted on every exit
 * path, so the process never hangs.
 */
import type { AttemptChain, ClaimInspection, FinalizeReport, QueuedFactCheck } from "../engine/contract";
import { CLAIM_STATE } from "../protocol/constants";
import { Api, OvError, asArray, asString, type Sleep, type StreamEvent } from "./api";
import {
  claimLink,
  clockTime,
  emptySeatIndex,
  formatDuration,
  formatScore,
  gaveUpWords,
  isFinalState,
  queueStatusWords,
  renderEvent,
  stateWords,
  suivisionObject,
  voidWords,
  weatherInline,
  type EventContext,
  type SeatIndex,
} from "./render";

export const DEFAULT_WATCH_BUDGET_MS = 9 * 60_000;
const QUEUE_POLL_MS = 30_000;
const CLAIM_POLL_MS = 60_000;
const RECONNECT_BASE_MS = 1_000;
const MAX_RECONNECTS = 5;
/** Refresh the claim record for an unknown seat at most this often. */
const REFRESH_MIN_GAP_MS = 10_000;

export type WatchTarget = {
  /** "id" is a bare 0x id that may be a claim or a queue item. */
  kind: "claim" | "queue" | "id";
  id: string;
};

export type WatchOptions = {
  api: Api;
  target: WatchTarget;
  /** --for: stop and exit 4 after this long. */
  budgetMs: number;
  /** --since: print only events with a larger sequence. */
  since?: number;
  verbose: boolean;
  json: boolean;
  now: () => number;
  sleep: Sleep;
  /** stdout: dated lines, or NDJSON with --json. */
  out: (line: string) => void;
  /** stderr: notes that must not pollute --json output. */
  err: (line: string) => void;
  queuePollMs?: number;
  claimPollMs?: number;
  streamIdleMs?: number;
  reconnectBaseMs?: number;
  maxReconnects?: number;
};

export type WatchResult = {
  exitCode: 0 | 2 | 3 | 4;
  claimId?: string;
  queueId?: string;
  state?: number;
  lastSequence: number;
  result?: FinalizeReport | null;
  attemptChain?: AttemptChain | null;
  /** The closing human line, also the `reason` of the JSON summary. */
  reason: string;
};

type Outcome =
  | { kind: "finalized" }
  | { kind: "budget" }
  | { kind: "dead_stream"; reason: string }
  | { kind: "voided"; chain: AttemptChain }
  | { kind: "gave_up"; chain: AttemptChain }
  | { kind: "cancelled" }
  | { kind: "aborted" };

type Context = WatchOptions & {
  deadlineMs: number;
  queuePollMs: number;
  claimPollMs: number;
  reconnectBaseMs: number;
  maxReconnects: number;
  /** The first claim or queue id the user asked for, for the "run again" hint. */
  requested: string;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function watch(options: WatchOptions): Promise<WatchResult> {
  const context: Context = {
    ...options,
    deadlineMs: options.now() + options.budgetMs,
    queuePollMs: options.queuePollMs ?? QUEUE_POLL_MS,
    claimPollMs: options.claimPollMs ?? CLAIM_POLL_MS,
    reconnectBaseMs: options.reconnectBaseMs ?? RECONNECT_BASE_MS,
    maxReconnects: options.maxReconnects ?? MAX_RECONNECTS,
    requested: options.target.id,
  };
  let result: WatchResult;
  try {
    const resolved = await resolveTarget(context);
    const since = options.since ?? 0;
    if (resolved.kind === "queue") {
      const handoff = await followQueue(context, resolved.id);
      result = handoff.kind === "launched" ? await followClaim(context, handoff.claimId, since, undefined) : handoff.result;
      result.queueId = resolved.id;
    } else {
      result = await followClaim(context, resolved.id, since, resolved.inspection);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.err(`error: ${message}`);
    const exitCode = error instanceof OvError && error.exitCode !== 5 ? error.exitCode : 2;
    result = { exitCode, lastSequence: 0, reason: message };
  }
  if (context.json) context.out(JSON.stringify(summaryOf(result)));
  return result;
}

function summaryOf(result: WatchResult): Record<string, unknown> {
  return {
    kind: "watch_summary",
    claimId: result.claimId ?? null,
    queueId: result.queueId ?? null,
    state: result.state ?? null,
    stateLabel: result.state === undefined ? null : stateWords(result.state),
    lastSequence: result.lastSequence,
    exitCode: result.exitCode,
    result: result.result ?? null,
    attemptChain: result.attemptChain ?? null,
    reason: result.reason,
  };
}

type Resolved =
  | { kind: "claim"; id: string; inspection?: ClaimInspection }
  | { kind: "queue"; id: string };

/** A bare id is tried as a claim first, then as a queue item. */
async function resolveTarget(context: Context): Promise<Resolved> {
  const { target, api } = context;
  if (target.kind === "queue") return { kind: "queue", id: target.id };
  const inspection = await api.claim(target.id);
  if (inspection) return { kind: "claim", id: target.id, inspection };
  if (target.kind === "claim") throw new OvError(`claim not found: ${target.id}`);
  const item = await api.queue(target.id);
  if (item) return { kind: "queue", id: target.id };
  throw new OvError(`not found as a claim or a queue item: ${target.id}`);
}

function remainingMs(context: Context): number {
  return context.deadlineMs - context.now();
}

/** A dated line for something the CLI observed itself (not a stream event). */
function say(context: Context, kind: string, detail: string): void {
  const line = `${clockTime(context.now())}  ${kind.padEnd(17)}  ${detail}`;
  if (context.json) context.err(line);
  else context.out(line);
}

// ---------------------------------------------------------------------------
// QUEUE
// ---------------------------------------------------------------------------

type QueueHandoff = { kind: "launched"; claimId: string } | { kind: "ended"; result: WatchResult };

async function followQueue(context: Context, queueId: string): Promise<QueueHandoff> {
  let lastLine: string | undefined;
  let lastError: string | undefined;
  for (;;) {
    const item = await context.api.queue(queueId);
    if (!item) throw new OvError(`queue item not found: ${queueId}`);
    if (context.json) context.out(JSON.stringify(queueStatusEvent(context, item)));
    if (item.status === "LAUNCHED" && item.claimId) {
      say(context, "launched", `claim ${item.claimId} ${claimLink(context.api.base, item.claimId)}`);
      return { kind: "launched", claimId: item.claimId };
    }
    if (item.status === "EXPIRED" || item.status === "CANCELLED") {
      const reason = `${queueStatusWords(item)}${item.launchError ? `: ${item.launchError}` : ""}`;
      say(context, item.status.toLowerCase(), reason);
      return { kind: "ended", result: { exitCode: 3, queueId, lastSequence: 0, reason } };
    }
    const line = `waiting for clear weather: ${weatherInline(item.weather)}`;
    if (line !== lastLine) {
      say(context, "queued", line);
      lastLine = line;
    }
    if (item.launchError && item.launchError !== lastError) {
      say(context, "launch error", item.launchError);
      lastError = item.launchError;
    }
    const remaining = remainingMs(context);
    if (remaining <= 0) {
      const reason = `still queued; run again with: ov watch ${queueId}`;
      say(context, "stopped", reason);
      return { kind: "ended", result: { exitCode: 4, queueId, lastSequence: 0, reason } };
    }
    await context.sleep(Math.min(context.queuePollMs, remaining));
  }
}

function queueStatusEvent(context: Context, item: QueuedFactCheck): Record<string, unknown> {
  return {
    kind: "queue_status",
    at: new Date(context.now()).toISOString(),
    queueId: item.queueId,
    status: item.status,
    ...(item.claimId ? { claimId: item.claimId } : {}),
    ...(item.launchError ? { launchError: item.launchError } : {}),
    weather: item.weather,
  };
}

// ---------------------------------------------------------------------------
// CLAIM
// ---------------------------------------------------------------------------

async function followClaim(
  context: Context,
  claimId: string,
  since: number,
  inspection: ClaimInspection | undefined,
): Promise<WatchResult> {
  const follower = new ClaimFollower(context, claimId, since);
  return follower.run(inspection);
}

class ClaimFollower {
  readonly #context: Context;
  readonly #claimId: string;
  readonly #since: number;
  #inspection: ClaimInspection | undefined;
  #agents: Map<string, string> = new Map();
  #seats: SeatIndex = emptySeatIndex();
  readonly #eventContext: EventContext;
  #lastSequence = 0;
  #lastRefreshMs = Number.NEGATIVE_INFINITY;
  #finalPrinted = false;
  #voidPrinted = false;

  constructor(context: Context, claimId: string, since: number) {
    this.#context = context;
    this.#claimId = claimId;
    this.#since = since;
    this.#eventContext = {
      seats: this.#seats,
      counts: { committed: new Map(), revealed: new Map() },
      verbose: context.verbose,
    };
  }

  async run(initial: ClaimInspection | undefined): Promise<WatchResult> {
    const inspection = initial ?? (await this.#context.api.claim(this.#claimId));
    if (!inspection) throw new OvError(`claim not found: ${this.#claimId}`);
    this.#agents = await this.#context.api.agents();
    this.#apply(inspection);
    const early = this.#chainOutcome(inspection);
    if (early) return this.#settle(early);
    if (inspection.state === CLAIM_STATE.CANCELLED) return this.#settle({ kind: "cancelled" });

    const stop = new AbortController();
    const tasks = [this.#streamTask(stop.signal), this.#pollTask(stop.signal), this.#budgetTask(stop.signal)];
    let outcome: Outcome;
    try {
      outcome = await Promise.race(tasks);
    } finally {
      // Whatever ended the race, the other two tasks stop here (stream aborted, timers cleared).
      stop.abort();
      await Promise.allSettled(tasks);
    }
    return this.#settle(outcome);
  }

  // -- outcomes -------------------------------------------------------------

  async #settle(outcome: Outcome): Promise<WatchResult> {
    const context = this.#context;
    switch (outcome.kind) {
      case "finalized": {
        if (!this.#finalPrinted) this.#printFinalFromRecord();
        const reason = `audit it: ov audit ${this.#claimId}`;
        this.#line(reason);
        return this.#result(0, reason);
      }
      case "budget":
        return this.#stopped();
      case "dead_stream":
        context.err(`event stream unavailable after ${context.maxReconnects} reconnects (${outcome.reason})`);
        return this.#stopped();
      case "gave_up": {
        const reason = gaveUpWords(outcome.chain);
        say(context, "gave up", reason);
        return this.#result(3, reason);
      }
      case "cancelled": {
        const reason = "claim cancelled; nothing more will happen";
        say(context, "cancelled", reason);
        return this.#result(3, reason);
      }
      case "voided":
        return this.#voided(outcome.chain);
      case "aborted":
        return this.#stopped();
      default:
        return this.#stopped();
    }
  }

  /** "still <state>; last sequence N; run again with --since N to continue", exit 4. */
  #stopped(): WatchResult {
    const state = stateWords(this.#inspection?.state);
    const reason = `still ${state}; last sequence ${this.#lastSequence}; run again with --since ${this.#lastSequence} to continue`;
    say(this.#context, "stopped", reason);
    if (this.#claimId !== this.#context.requested) {
      say(this.#context, "now following", `ov watch ${this.#claimId} --since ${this.#lastSequence}`);
    }
    return this.#result(4, reason);
  }

  /** Print the void once, then follow the relaunch or wait for it. */
  async #voided(chain: AttemptChain): Promise<WatchResult> {
    const context = this.#context;
    if (!this.#voidPrinted) {
      say(context, "attempt voided", `${voidWords(chain)}; ${chain.relaunchedAs ? "relaunched" : "relaunch pending"}`);
      this.#voidPrinted = true;
    }
    let current = chain;
    for (;;) {
      if (current.relaunchedAs) {
        say(context, "relaunched", `attempt ${Math.min(current.attempt + 1, current.maxAttempts)} ${claimLink(context.api.base, current.relaunchedAs)}`);
        return followClaim(context, current.relaunchedAs, 0, undefined);
      }
      const remaining = remainingMs(context);
      if (remaining <= 0) {
        const reason = `${voidWords(current)}; no relaunch yet, run again with: ov watch ${this.#claimId}`;
        say(context, "stopped", reason);
        return this.#result(3, reason);
      }
      await context.sleep(Math.min(context.claimPollMs, remaining));
      let inspection: ClaimInspection | undefined;
      try {
        inspection = await context.api.claim(this.#claimId);
      } catch {
        continue;
      }
      if (!inspection?.attemptChain) continue;
      this.#apply(inspection);
      current = inspection.attemptChain;
      if (current.status === "GAVE_UP") return this.#settle({ kind: "gave_up", chain: current });
    }
  }

  #result(exitCode: 0 | 3 | 4, reason: string): WatchResult {
    return {
      exitCode,
      claimId: this.#claimId,
      ...(this.#inspection?.state === undefined ? {} : { state: this.#inspection.state }),
      lastSequence: this.#lastSequence,
      result: this.#inspection?.result ?? null,
      attemptChain: this.#inspection?.attemptChain ?? null,
      reason,
    };
  }

  // -- the three racing tasks ----------------------------------------------

  async #streamTask(signal: AbortSignal): Promise<Outcome> {
    const context = this.#context;
    let reconnects = 0;
    // The first connection replays everything so the seat index and the
    // "(k of 5)" counters are complete even with --since; reconnects resume.
    let from = 1;
    while (!signal.aborted) {
      let reason: string;
      try {
        const events = context.api.events(this.#claimId, {
          from,
          signal,
          ...(context.streamIdleMs === undefined ? {} : { idleMs: context.streamIdleMs }),
        });
        for await (const event of events) {
          const outcome = await this.#handleEvent(event);
          if (outcome) return outcome;
        }
        if (signal.aborted) return { kind: "aborted" };
        // The server closes the stream once the claim is terminal.
        const closed = await this.#afterStreamClosed();
        if (closed) return closed;
        reason = "stream closed";
      } catch (error) {
        if (signal.aborted) return { kind: "aborted" };
        reason = error instanceof Error ? error.message : String(error);
      }
      reconnects += 1;
      if (reconnects > context.maxReconnects) return { kind: "dead_stream", reason };
      const delay = context.reconnectBaseMs * 2 ** (reconnects - 1);
      say(context, "reconnecting", `${reason}; retry ${reconnects} of ${context.maxReconnects} in ${formatDuration(delay)}`);
      await context.sleep(delay, signal);
      from = this.#lastSequence + 1;
    }
    return { kind: "aborted" };
  }

  async #pollTask(signal: AbortSignal): Promise<Outcome> {
    const context = this.#context;
    while (!signal.aborted) {
      await context.sleep(context.claimPollMs, signal);
      if (signal.aborted) return { kind: "aborted" };
      let inspection: ClaimInspection | undefined;
      try {
        inspection = await context.api.claim(this.#claimId);
      } catch {
        continue; // a transient failure; the next poll retries
      }
      if (signal.aborted) return { kind: "aborted" };
      if (!inspection) continue;
      this.#apply(inspection);
      const chain = this.#chainOutcome(inspection);
      if (chain) return chain;
      if (inspection.state === CLAIM_STATE.CANCELLED) return { kind: "cancelled" };
      // The record settled but the stream said nothing: end from the record.
      if (inspection.result) return { kind: "finalized" };
    }
    return { kind: "aborted" };
  }

  async #budgetTask(signal: AbortSignal): Promise<Outcome> {
    const remaining = remainingMs(this.#context);
    if (remaining > 0) await this.#context.sleep(remaining, signal);
    return signal.aborted ? { kind: "aborted" } : { kind: "budget" };
  }

  // -- events ---------------------------------------------------------------

  async #handleEvent(event: StreamEvent): Promise<Outcome | undefined> {
    const context = this.#context;
    this.#lastSequence = Math.max(this.#lastSequence, event.sequence);
    if (event.kind === "committee_selected") this.#applyCommittee(event);
    if (event.kind === "phase_changed") await this.#refresh(true);
    else if (this.#mentionsUnknownSeat(event)) await this.#refresh(false);
    // Rendering also advances the counters, so it runs for skipped history too.
    const text = renderEvent(event, this.#eventContext);
    if (event.sequence > this.#since) {
      if (context.json) context.out(JSON.stringify(event.raw));
      else if (text) context.out(text);
    }
    if (event.kind === "claim_finalized") {
      this.#finalPrinted = event.sequence > this.#since;
      return { kind: "finalized" };
    }
    if (event.kind === "attempt_voided" || event.kind === "claim_voided") {
      // The stream said so; the record has the reason, model and phase.
      await this.#refresh(true);
      const chain = this.#inspection ? this.#chainOutcome(this.#inspection) : undefined;
      if (chain) return chain;
    }
    return undefined;
  }

  /** After the server closed the stream: finalized, cancelled, or a drop to reconnect. */
  async #afterStreamClosed(): Promise<Outcome | undefined> {
    await this.#refresh(true);
    const inspection = this.#inspection;
    if (!inspection) return undefined;
    const chain = this.#chainOutcome(inspection);
    if (chain) return chain;
    if (inspection.result || isFinalState(inspection.state)) return { kind: "finalized" };
    if (inspection.state === CLAIM_STATE.CANCELLED) return { kind: "cancelled" };
    return undefined;
  }

  #mentionsUnknownSeat(event: StreamEvent): boolean {
    const payload = event.payload;
    const seat = asString(payload.jury_seat_id) ?? asString(payload.jurySeatId);
    const agent = asString(payload.agent_profile_id) ?? asString(payload.agentProfileId) ?? asString(event.raw.actorId);
    if (seat && !this.#seats.jurorBySeat.has(seat.toLowerCase())) return true;
    if (!seat && agent && !this.#seats.jurorByAgent.has(agent.toLowerCase())) return true;
    return false;
  }

  /** Re-read the claim record; unforced refreshes are rate limited. */
  async #refresh(force: boolean): Promise<void> {
    const context = this.#context;
    if (!force && context.now() - this.#lastRefreshMs < REFRESH_MIN_GAP_MS) return;
    this.#lastRefreshMs = context.now();
    try {
      const inspection = await context.api.claim(this.#claimId);
      if (inspection) this.#apply(inspection);
    } catch {
      // The stream keeps going; the next event or poll retries.
    }
  }

  #apply(inspection: ClaimInspection): void {
    this.#inspection = inspection;
    const seats = buildSeatIndex(inspection, this.#agents);
    // Keep the seat index object the renderer holds; swap its contents.
    if (seats.jurorBySeat.size > 0 || this.#seats.jurorBySeat.size === 0) {
      this.#seats.jurorBySeat = seats.jurorBySeat;
      this.#seats.jurorByAgent = seats.jurorByAgent;
      this.#seats.modelBySeat = seats.modelBySeat;
      this.#seats.modelByAgent = seats.modelByAgent;
      this.#seats.expectedByPhase = seats.expectedByPhase;
    }
  }

  /** committee_selected carries seats and agents in seat order; used before the record has rounds. */
  #applyCommittee(event: StreamEvent): void {
    if (this.#seats.jurorBySeat.size > 0) return;
    const seatIds = asArray(event.payload.jury_seat_ids).filter((id): id is string => typeof id === "string");
    const agentIds = asArray(event.payload.agent_profile_ids).filter((id): id is string => typeof id === "string");
    seatIds.forEach((seatId, index) => {
      const seat = seatId.toLowerCase();
      const agent = agentIds[index]?.toLowerCase();
      this.#seats.jurorBySeat.set(seat, index + 1);
      if (agent) {
        this.#seats.jurorByAgent.set(agent, index + 1);
        const model = this.#agents.get(agent);
        if (model) {
          this.#seats.modelBySeat.set(seat, model);
          this.#seats.modelByAgent.set(agent, model);
        }
      }
    });
    this.#seats.expectedByPhase.set(1, seatIds.length);
  }

  #chainOutcome(inspection: ClaimInspection): Outcome | undefined {
    const chain = inspection.attemptChain;
    if (!chain) return undefined;
    if (chain.status === "GAVE_UP") return { kind: "gave_up", chain };
    if (chain.status === "VOIDED") return { kind: "voided", chain };
    return undefined;
  }

  /** The final line from the record, when --since skipped the event or the poll ended first. */
  #printFinalFromRecord(): void {
    const result = this.#inspection?.result;
    if (!result) {
      this.#line(`final: ${stateWords(this.#inspection?.state)}, no certificate published`);
      return;
    }
    this.#line(
      `final: ${result.result}, score ${formatScore(result.truthScoreBps)}, certificate ${result.certificateId} ${suivisionObject(result.certificateId)}`,
    );
    this.#finalPrinted = true;
  }

  #line(text: string): void {
    if (this.#context.json) this.#context.err(text);
    else this.#context.out(text);
  }
}

// ---------------------------------------------------------------------------
// Seat index: juror numbers by agent, in seat order, the way the audit numbers them
// ---------------------------------------------------------------------------

export function buildSeatIndex(inspection: ClaimInspection, agents: Map<string, string>): SeatIndex {
  const index = emptySeatIndex();
  const commitments = inspection.commitments ?? [];
  const statusBySeat = new Map(commitments.map((seat) => [seat.jurySeatId.toLowerCase(), seat]));
  const phases: Array<{ phase: number; seatIds: string[] }> = (inspection.rounds ?? []).map((round) => ({
    phase: round.phase,
    seatIds: round.expectedJurySeatIds.map((id) => id.toLowerCase()),
  }));
  // Seats the record knows but no round lists yet (or a record without rounds).
  const listed = new Set(phases.flatMap((entry) => entry.seatIds));
  const extra = commitments.map((seat) => seat.jurySeatId.toLowerCase()).filter((id) => !listed.has(id));
  if (extra.length > 0) {
    const phase = phases.length === 0 ? 1 : 2;
    const existing = phases.find((entry) => entry.phase === phase);
    if (existing) existing.seatIds.push(...extra);
    else phases.push({ phase, seatIds: extra });
  }
  let next = 1;
  for (const entry of phases.sort((left, right) => left.phase - right.phase)) {
    index.expectedByPhase.set(entry.phase, entry.seatIds.length);
    for (const seatId of entry.seatIds) {
      const status = statusBySeat.get(seatId);
      const agent = status?.agentProfileId?.toLowerCase();
      let number = agent ? index.jurorByAgent.get(agent) : undefined;
      if (number === undefined) {
        number = next;
        next += 1;
        if (agent) index.jurorByAgent.set(agent, number);
      }
      index.jurorBySeat.set(seatId, number);
      const model = status?.modelId ?? (agent ? agents.get(agent) : undefined);
      if (model) {
        index.modelBySeat.set(seatId, model);
        if (agent) index.modelByAgent.set(agent, model);
      }
    }
  }
  return index;
}

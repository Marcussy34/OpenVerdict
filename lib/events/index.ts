import type { ResolutionEvent } from "../engine/contract";

export interface PublicEventContext {
  revealedRunIds: ReadonlySet<string>;
}

export type ResolutionEventInput = Omit<ResolutionEvent, "publishedAt"> & {
  publishedAt?: string;
};

const REVEAL_GATED_KINDS = new Set([
  "inference_started",
  "inference_completed",
  "tool_call_started",
  "tool_call_completed",
  "argument_published",
]);

const ALWAYS_REDACTED_KEYS = /(^|_)(salt|secret|private_key|privatekey|api_key|apikey|chain_of_thought|raw_prompt|full_prompt)($|_)/i;

/** A research query is public web material, but it is never a page of prose. */
const MAX_RESEARCH_QUERY_CHARS = 300;
/** One open action opens a handful of pages; the rest is not the feed's job. */
const MAX_RESEARCH_URLS = 10;

/** Build one immutable, JSON-safe resolution-event value. */
export function createResolutionEvent(
  input: ResolutionEventInput,
): ResolutionEvent {
  return {
    ...input,
    payload: cloneJsonRecord(input.payload),
  };
}

/**
 * Apply the public visibility boundary at serialization time. Reveal-gated
 * kinds remain gated even if a caller accidentally labels them PUBLIC_NOW.
 */
export function serializePublicEvent(
  event: ResolutionEvent,
  context: PublicEventContext,
): ResolutionEvent | null {
  if (event.visibility === "INTERNAL_REDACTED") return null;

  const requiresReveal =
    event.visibility === "PUBLIC_AFTER_REVEAL" ||
    REVEAL_GATED_KINDS.has(event.kind);
  if (
    requiresReveal &&
    (event.runId === undefined || !context.revealedRunIds.has(event.runId))
  ) {
    return null;
  }

  const payload =
    event.kind === "agent_activity"
      ? sanitizeAgentActivity(event.payload)
      : event.kind === "research_step"
        ? sanitizeResearchStep(event.payload)
        : redactRecord(event.payload);

  return {
    ...event,
    visibility: "PUBLIC_NOW",
    publishedAt: event.publishedAt ?? event.occurredAt,
    payload,
  };
}

function sanitizeAgentActivity(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["genericStage", "generic_stage", "status"] as const) {
    if (typeof payload[key] === "string") result[key] = payload[key];
  }
  for (const key of ["latencyMs", "latency_ms"] as const) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * The live research feed is public before the reveal, so its payload is an
 * allowlist like agent_activity: only the step's shape and the public web
 * material it names, with the query and the URL list bounded. The allowlist
 * drops every ALWAYS_REDACTED_KEYS name by construction.
 */
function sanitizeResearchStep(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    "claim_id",
    "jury_seat_id",
    "agent_profile_id",
    "run_id",
    "kind",
    "intent",
  ] as const) {
    if (typeof payload[key] === "string") result[key] = payload[key];
  }
  for (const key of ["phase", "ordinal", "page_count"] as const) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  if (typeof payload.query === "string") {
    result.query = payload.query.slice(0, MAX_RESEARCH_QUERY_CHARS);
  }
  for (const key of ["urls", "result_domains"] as const) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    result[key] = value
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, MAX_RESEARCH_URLS);
  }
  return result;
}

function redactRecord(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => !ALWAYS_REDACTED_KEYS.test(key))
      .map(([key, value]) => [key, redactValue(value)]),
  );
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) return redactRecord(value);
  return value;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

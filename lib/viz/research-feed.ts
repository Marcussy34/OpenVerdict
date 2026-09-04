/**
 * The live research feed of the console: the public `research_step` events of
 * one claim, grouped per seat and phrased for a juror lane
 * (docs/superpowers/specs/2026-09-04-fast-path-design.md §5).
 *
 * Queries, result sites and opened URLs are public web material and land as
 * they happen; the vote and the reasoning stay sealed until reveal, so a lane
 * keeps its sealed-vote state while these lines fill in underneath it.
 */
import type { ResolutionEvent } from "../engine/contract";

export type ResearchFeedKind = "search" | "open" | "answer";

export type ResearchFeedStep = {
  seatId: string;
  ordinal: number;
  kind: ResearchFeedKind;
  intent?: "support" | "challenge";
  query?: string;
  /** Result sites for a search, opened sites for an open; never a page's text. */
  domains: string[];
  pageCount?: number;
  atMs: number;
  runId?: string;
};

/** Longer than this and a lane's query line stops being readable. */
const QUERY_PREVIEW = 120;
/** Enough sites to recognise the sources without wrapping the lane. */
const DOMAIN_PREVIEW = 4;

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

/** The site a URL belongs to ("mit.edu"); a URL that will not parse is dropped. */
export function feedDomain(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function distinctDomains(urls: readonly string[]): string[] {
  const sites: string[] = [];
  for (const url of urls) {
    const site = feedDomain(url);
    if (site !== undefined && !sites.includes(site)) sites.push(site);
  }
  return sites;
}

function eventTime(event: ResolutionEvent): number | undefined {
  const parsed = Date.parse(event.publishedAt ?? event.occurredAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Every public research step of one claim, per jury seat, in the order the
 * seat took them. Replayed history is deduplicated by seat, run and ordinal.
 */
export function researchFeed(
  events: readonly ResolutionEvent[],
): Map<string, ResearchFeedStep[]> {
  const byKey = new Map<string, ResearchFeedStep>();
  for (const event of events) {
    if (event.kind !== "research_step" || event.visibility !== "PUBLIC_NOW") continue;
    const payload = record(event.payload);
    const seatId = stringAt(payload, "jury_seat_id");
    const kind = stringAt(payload, "kind");
    const ordinal = numberAt(payload, "ordinal");
    if (
      seatId === undefined ||
      (kind !== "search" && kind !== "open" && kind !== "answer") ||
      ordinal === undefined ||
      !Number.isInteger(ordinal) ||
      ordinal < 0
    ) {
      continue;
    }
    const intent = stringAt(payload, "intent");
    const query = stringAt(payload, "query");
    const pageCount = numberAt(payload, "page_count");
    const domains =
      kind === "open"
        ? distinctDomains(stringsAt(payload, "urls"))
        : stringsAt(payload, "result_domains");
    const key = `${seatId}:${event.runId ?? ""}:${ordinal}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      seatId,
      ordinal,
      kind,
      ...(intent === "support" || intent === "challenge" ? { intent } : {}),
      ...(query === undefined ? {} : { query }),
      domains,
      ...(pageCount === undefined ? {} : { pageCount }),
      atMs: eventTime(event) ?? 0,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
    });
  }

  const bySeat = new Map<string, ResearchFeedStep[]>();
  for (const step of byKey.values()) {
    const lane = bySeat.get(step.seatId) ?? [];
    lane.push(step);
    bySeat.set(step.seatId, lane);
  }
  for (const lane of bySeat.values()) {
    lane.sort((left, right) => left.ordinal - right.ordinal);
  }
  return bySeat;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * One lane line: `searched (challenge) "..."`, `opened 3 pages: mit.edu,
 * apa.org`, `drafting the answer`.
 */
export function researchStepWords(step: ResearchFeedStep): string {
  if (step.kind === "answer") return "drafting the answer";
  if (step.kind === "search") {
    const intent = step.intent === undefined ? "" : ` (${step.intent})`;
    const query = step.query === undefined ? undefined : collapse(step.query);
    return query === undefined || query.length === 0
      ? `searched${intent} the web`
      : `searched${intent} "${truncate(query, QUERY_PREVIEW)}"`;
  }
  const count = step.pageCount ?? step.domains.length;
  const pages = `opened ${count} page${count === 1 ? "" : "s"}`;
  if (step.domains.length === 0) return pages;
  const shown = step.domains.slice(0, DOMAIN_PREVIEW).join(", ");
  const rest = step.domains.length - DOMAIN_PREVIEW;
  return `${pages}: ${shown}${rest > 0 ? `, +${rest} more` : ""}`;
}

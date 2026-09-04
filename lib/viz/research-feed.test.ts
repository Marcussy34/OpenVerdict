import { describe, expect, it } from "vitest";

import type { ResolutionEvent } from "../engine/contract";
import { researchFeed, researchStepWords } from "./research-feed";

const START_MS = Date.parse("2026-09-04T00:00:00.000Z");
const SEAT = "jury-seat-1";

function stepEvent(input: {
  sequence: number;
  payload: Record<string, unknown>;
  visibility?: ResolutionEvent["visibility"];
  runId?: string;
  kind?: string;
}): ResolutionEvent {
  return {
    eventId: `event-${input.sequence}`,
    claimId: "claim-1",
    sequence: input.sequence,
    phase: "INFERENCE_1",
    kind: input.kind ?? "research_step",
    source: "ENGINE",
    visibility: input.visibility ?? "PUBLIC_NOW",
    runId: input.runId ?? "run-1",
    occurredAt: new Date(START_MS + input.sequence * 1_000).toISOString(),
    payload: input.payload,
  };
}

describe("live research feed", () => {
  it("groups a seat's steps in step order and keeps the public fields", () => {
    const feed = researchFeed([
      stepEvent({
        sequence: 2,
        payload: {
          jury_seat_id: SEAT,
          ordinal: 1,
          kind: "open",
          urls: ["https://www.MIT.edu/a", "https://mit.edu/b", "https://apa.org/c"],
          page_count: 3,
        },
      }),
      stepEvent({
        sequence: 1,
        payload: {
          jury_seat_id: SEAT,
          ordinal: 0,
          kind: "search",
          intent: "challenge",
          query: "ten percent brain myth",
          result_domains: ["mit.edu", "apa.org"],
        },
      }),
      stepEvent({
        sequence: 3,
        payload: { jury_seat_id: "jury-seat-2", ordinal: 0, kind: "answer" },
      }),
    ]);

    expect([...feed.keys()].sort()).toEqual([SEAT, "jury-seat-2"]);
    expect(feed.get(SEAT)).toEqual([
      {
        seatId: SEAT,
        ordinal: 0,
        kind: "search",
        intent: "challenge",
        query: "ten percent brain myth",
        domains: ["mit.edu", "apa.org"],
        atMs: START_MS + 1_000,
        runId: "run-1",
      },
      {
        seatId: SEAT,
        ordinal: 1,
        kind: "open",
        // Three pages, two sites: the host is lowercased and www is dropped.
        domains: ["mit.edu", "apa.org"],
        pageCount: 3,
        atMs: START_MS + 2_000,
        runId: "run-1",
      },
    ]);
  });

  it("ignores other kinds, non-public rows and malformed payloads, and replays once", () => {
    const payload = { jury_seat_id: SEAT, ordinal: 0, kind: "answer" };
    const feed = researchFeed([
      stepEvent({ sequence: 1, payload }),
      stepEvent({ sequence: 2, payload }),
      stepEvent({ sequence: 3, payload, visibility: "PUBLIC_AFTER_REVEAL" }),
      stepEvent({ sequence: 4, payload, kind: "RESEARCH_TICK" }),
      stepEvent({ sequence: 5, payload: { jury_seat_id: SEAT, ordinal: 1 } }),
      stepEvent({ sequence: 6, payload: { ordinal: 1, kind: "search" } }),
      stepEvent({
        sequence: 7,
        payload: { jury_seat_id: SEAT, ordinal: -1, kind: "search" },
      }),
    ]);

    expect(feed.get(SEAT)).toHaveLength(1);
  });

  it("says what the seat did, in the console's words", () => {
    const base = { seatId: SEAT, ordinal: 0, domains: [] as string[], atMs: START_MS };
    expect(
      researchStepWords({
        ...base,
        kind: "search",
        intent: "challenge",
        query: "  ten percent\n brain myth ",
        domains: ["mit.edu"],
      }),
    ).toBe('searched (challenge) "ten percent brain myth"');
    expect(researchStepWords({ ...base, kind: "search", query: "a query" })).toBe(
      'searched "a query"',
    );
    expect(researchStepWords({ ...base, kind: "search" })).toBe("searched the web");
    expect(
      researchStepWords({
        ...base,
        kind: "open",
        pageCount: 3,
        domains: ["mit.edu", "apa.org"],
      }),
    ).toBe("opened 3 pages: mit.edu, apa.org");
    expect(researchStepWords({ ...base, kind: "open", pageCount: 1, domains: [] })).toBe(
      "opened 1 page",
    );
    expect(
      researchStepWords({
        ...base,
        kind: "open",
        pageCount: 6,
        domains: ["a.test", "b.test", "c.test", "d.test", "e.test"],
      }),
    ).toBe("opened 6 pages: a.test, b.test, c.test, d.test, +1 more");
    expect(researchStepWords({ ...base, kind: "answer" })).toBe("drafting the answer");
    // A long query is cut, never wrapped across the lane.
    expect(
      researchStepWords({ ...base, kind: "search", query: "q".repeat(200) }),
    ).toBe(`searched "${"q".repeat(120)}…"`);
  });
});

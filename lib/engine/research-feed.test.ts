import { describe, expect, it } from "vitest";

import { createResolutionEvent, serializePublicEvent } from "../events";
import { researchStepEvent } from "./research-feed";

const CLAIM = { claimId: `0x${"51".repeat(32)}`, state: 4 };
const SEAT = {
  jurySeatId: `0x${"52".repeat(32)}`,
  agentProfileId: `0x${"53".repeat(32)}`,
  phase: 1 as const,
};
const RUN_ID = `0x${"54".repeat(32)}`;

describe("research_step events", () => {
  it("labels a search with its intent, query and result sites", () => {
    const event = researchStepEvent({
      claim: CLAIM,
      seat: SEAT,
      runId: RUN_ID,
      step: {
        kind: "search",
        ordinal: 0,
        intent: "challenge",
        query: "ten percent of the brain myth",
        resultDomains: ["mit.edu", "apa.org"],
      },
    });

    expect(event).toEqual({
      claimId: CLAIM.claimId,
      phase: "INFERENCE_1",
      kind: "research_step",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: SEAT.agentProfileId,
      runId: RUN_ID,
      payload: {
        claim_id: CLAIM.claimId,
        jury_seat_id: SEAT.jurySeatId,
        agent_profile_id: SEAT.agentProfileId,
        run_id: RUN_ID,
        phase: 1,
        ordinal: 0,
        kind: "search",
        intent: "challenge",
        query: "ten percent of the brain myth",
        result_domains: ["mit.edu", "apa.org"],
      },
    });
  });

  it("carries the opened URLs and their count, and round two says so", () => {
    const event = researchStepEvent({
      claim: CLAIM,
      seat: { ...SEAT, phase: 2 },
      runId: RUN_ID,
      step: {
        kind: "open",
        ordinal: 3,
        urls: ["https://mit.edu/a", "https://apa.org/b"],
        pageCount: 2,
      },
    });

    expect(event.phase).toBe("INFERENCE_2");
    expect(event.payload).toMatchObject({
      phase: 2,
      ordinal: 3,
      kind: "open",
      urls: ["https://mit.edu/a", "https://apa.org/b"],
      page_count: 2,
    });
  });

  it("omits every field the step did not carry", () => {
    const event = researchStepEvent({
      claim: CLAIM,
      seat: SEAT,
      runId: RUN_ID,
      step: { kind: "answer", ordinal: 7 },
    });

    expect(Object.keys(event.payload).sort()).toEqual([
      "agent_profile_id",
      "claim_id",
      "jury_seat_id",
      "kind",
      "ordinal",
      "phase",
      "run_id",
    ]);
  });

  it("is public before the reveal, unlike the sealed run records", () => {
    const input = researchStepEvent({
      claim: CLAIM,
      seat: SEAT,
      runId: RUN_ID,
      step: { kind: "search", ordinal: 0, query: "a query" },
    });
    const event = createResolutionEvent({
      ...input,
      eventId: "evt-1",
      sequence: 1,
      occurredAt: "2026-09-04T00:00:00.000Z",
    });

    const serialized = serializePublicEvent(event, {
      revealedRunIds: new Set(),
    });
    expect(serialized?.payload).toMatchObject({ kind: "search", query: "a query" });
  });
});

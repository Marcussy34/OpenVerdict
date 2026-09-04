import { describe, expect, it } from "vitest";
import {
  createResolutionEvent,
  serializePublicEvent,
} from "./index";

const base = {
  eventId: "evt-1",
  claimId: "0xclaim",
  sequence: 1,
  phase: "INDEPENDENT",
  occurredAt: "2026-08-27T00:00:00.000Z",
} as const;

describe("public resolution-event serialization", () => {
  it("never serializes internal records", () => {
    const event = createResolutionEvent({
      ...base,
      kind: "inference_started",
      source: "GONKA_ROUTER",
      visibility: "INTERNAL_REDACTED",
      payload: { outcome: "YES", salt: "secret" },
    });

    expect(serializePublicEvent(event, { revealedRunIds: new Set() })).toBeNull();
  });

  it("holds reveal-gated records until the matching reveal is confirmed", () => {
    const event = createResolutionEvent({
      ...base,
      runId: "run-1",
      kind: "inference_completed",
      source: "GONKA_ROUTER",
      visibility: "PUBLIC_AFTER_REVEAL",
      payload: { outcome: "YES", reasoning: "public after reveal" },
    });

    expect(serializePublicEvent(event, { revealedRunIds: new Set() })).toBeNull();
    expect(
      serializePublicEvent(event, { revealedRunIds: new Set(["run-1"]) }),
    ).toMatchObject({ kind: "inference_completed", runId: "run-1" });
  });

  it("publishes research_step before the reveal, with bounded public material", () => {
    const event = createResolutionEvent({
      ...base,
      runId: "run-1",
      actorId: "agent-1",
      kind: "research_step",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: {
        claim_id: "0xclaim",
        jury_seat_id: "0xseat",
        agent_profile_id: "agent-1",
        run_id: "run-1",
        phase: 1,
        ordinal: 2,
        kind: "search",
        intent: "challenge",
        query: "q".repeat(400),
        result_domains: ["mit.edu", "apa.org"],
      },
    });

    // Not reveal-gated: the query and the sites are public web material.
    const serialized = serializePublicEvent(event, { revealedRunIds: new Set() });
    expect(serialized?.payload).toEqual({
      claim_id: "0xclaim",
      jury_seat_id: "0xseat",
      agent_profile_id: "agent-1",
      run_id: "run-1",
      phase: 1,
      ordinal: 2,
      kind: "search",
      intent: "challenge",
      query: "q".repeat(300),
      result_domains: ["mit.edu", "apa.org"],
    });
  });

  it("allowlists research_step fields and caps the opened URL list", () => {
    const urls = Array.from({ length: 14 }, (_, index) => `https://site.test/${index}`);
    const event = createResolutionEvent({
      ...base,
      runId: "run-1",
      kind: "research_step",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: {
        jury_seat_id: "0xseat",
        ordinal: 3,
        kind: "open",
        urls: [...urls, 7],
        page_count: 14,
        outcome: "YES",
        reasoning: "leak",
        salt: "leak",
        nested: { outcome: "NO" },
      },
    });

    const serialized = serializePublicEvent(event, { revealedRunIds: new Set() });
    expect(serialized?.payload).toEqual({
      jury_seat_id: "0xseat",
      ordinal: 3,
      kind: "open",
      urls: urls.slice(0, 10),
      page_count: 14,
    });
    expect(JSON.stringify(serialized)).not.toContain("YES");
    expect(JSON.stringify(serialized)).not.toContain("leak");
  });

  it("allowlists agent_activity fields so payload tricks cannot leak a vote", () => {
    const event = createResolutionEvent({
      ...base,
      runId: "run-1",
      actorId: "agent-1",
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: {
        genericStage: "INFERENCE",
        status: "RUNNING",
        latencyMs: 12,
        outcome: "YES",
        confidenceBps: 9_999,
        reasoning: "leak",
        nested: { salt: "leak" },
        generic_stage: { outcome: "NO" },
      },
    });

    const serialized = serializePublicEvent(event, {
      revealedRunIds: new Set(),
    });
    expect(serialized?.payload).toEqual({
      genericStage: "INFERENCE",
      status: "RUNNING",
      latencyMs: 12,
    });
    expect(JSON.stringify(serialized)).not.toContain("YES");
    expect(JSON.stringify(serialized)).not.toContain("salt");
  });
});

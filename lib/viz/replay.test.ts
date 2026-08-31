import { describe, expect, it } from "vitest";

import type { DeliberationGraph } from "./deliberation-graph";
import { graphSpan, visibleAt } from "./replay";

const MINUTE_MS = 60_000;
const START_MS = Date.parse("2026-08-31T00:00:00.000Z");
const GRAPH: DeliberationGraph = {
  nodes: [
    { id: "claim", kind: "claim", label: "Claim", atMs: START_MS },
    {
      id: "seat:alpha",
      kind: "juror",
      label: "Alpha",
      atMs: START_MS + 2 * MINUTE_MS,
    },
    {
      id: "step:alpha:0",
      kind: "search",
      label: "Search",
      atMs: START_MS + 4 * MINUTE_MS,
    },
    {
      id: "verdict:alpha",
      kind: "verdict",
      label: "YES",
      atMs: START_MS + 7 * MINUTE_MS,
    },
    {
      id: "certificate",
      kind: "certificate",
      label: "Certificate",
      atMs: START_MS + 10 * MINUTE_MS,
    },
  ],
  edges: [
    { id: "seat", from: "claim", to: "seat:alpha", kind: "seat" },
    {
      id: "action",
      from: "seat:alpha",
      to: "step:alpha:0",
      kind: "action",
    },
    {
      id: "verdict",
      from: "seat:alpha",
      to: "verdict:alpha",
      kind: "verdict",
    },
    {
      id: "settle",
      from: "verdict:alpha",
      to: "certificate",
      kind: "settle",
    },
  ],
};

describe("replay", () => {
  it("returns an exact ten-minute graph span", () => {
    expect(graphSpan(GRAPH)).toEqual({
      startMs: START_MS,
      endMs: START_MS + 10 * MINUTE_MS,
    });
    expect(graphSpan({ nodes: [], edges: [] })).toEqual({ startMs: 0, endMs: 0 });
  });

  it("reveals nodes monotonically by timestamp", () => {
    const checkpoints = [0, 2, 4, 7, 10].map(
      (minutes) => START_MS + minutes * MINUTE_MS,
    );

    const visibleIds = checkpoints.map((time) =>
      visibleAt(GRAPH, time).nodes.map((node) => node.id),
    );

    expect(visibleIds).toEqual([
      ["claim"],
      ["claim", "seat:alpha"],
      ["claim", "seat:alpha", "step:alpha:0"],
      ["claim", "seat:alpha", "step:alpha:0", "verdict:alpha"],
      ["claim", "seat:alpha", "step:alpha:0", "verdict:alpha", "certificate"],
    ]);
  });

  it("shows an edge only after both endpoint nodes are visible", () => {
    expect(visibleAt(GRAPH, START_MS + MINUTE_MS).edges).toEqual([]);
    expect(visibleAt(GRAPH, START_MS + 2 * MINUTE_MS).edges.map((edge) => edge.id))
      .toEqual(["seat"]);
    expect(visibleAt(GRAPH, START_MS + 6 * MINUTE_MS).edges.map((edge) => edge.id))
      .toEqual(["seat", "action"]);
    expect(visibleAt(GRAPH, START_MS + 9 * MINUTE_MS).edges.map((edge) => edge.id))
      .toEqual(["seat", "action", "verdict"]);
  });

  it("returns the complete graph at the end of the span", () => {
    const { endMs } = graphSpan(GRAPH);
    expect(visibleAt(GRAPH, endMs)).toEqual(GRAPH);
  });
});

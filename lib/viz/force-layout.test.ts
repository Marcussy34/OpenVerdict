import { describe, expect, it } from "vitest";

import type { DeliberationGraph } from "./deliberation-graph";
import { createSimulation } from "./force-layout";

const GRAPH: DeliberationGraph = {
  nodes: [
    { id: "claim", kind: "claim", label: "Claim", atMs: 0 },
    {
      id: "seat:alpha",
      kind: "juror",
      label: "Alpha",
      atMs: 1,
      seatId: "alpha",
      family: "deepseek",
      state: "revealed",
    },
    {
      id: "seat:beta",
      kind: "juror",
      label: "Beta",
      atMs: 1,
      seatId: "beta",
      family: "kimi",
      state: "revealed",
    },
    {
      id: "step:alpha:0",
      kind: "search",
      label: "Supporting evidence",
      atMs: 2,
      seatId: "alpha",
      intent: "support",
    },
    {
      id: "step:beta:0",
      kind: "search",
      label: "Challenging evidence",
      atMs: 2,
      seatId: "beta",
      intent: "challenge",
    },
  ],
  edges: [
    { id: "seat-alpha", from: "claim", to: "seat:alpha", kind: "seat" },
    { id: "seat-beta", from: "claim", to: "seat:beta", kind: "seat" },
    {
      id: "action-alpha",
      from: "seat:alpha",
      to: "step:alpha:0",
      kind: "action",
    },
    {
      id: "action-beta",
      from: "seat:beta",
      to: "step:beta:0",
      kind: "action",
    },
  ],
};

describe("force layout", () => {
  it("settles finite positions around a centre-pinned claim", () => {
    const size = { width: 640, height: 480 };
    const { simulation, positions } = createSimulation(GRAPH, size);

    // Manual ticks keep this smoke test deterministic in the Node environment.
    simulation.stop();
    simulation.tick(300);

    const snapshot = positions();
    expect(snapshot.size).toBe(GRAPH.nodes.length);
    for (const node of GRAPH.nodes) {
      const position = snapshot.get(node.id);
      expect(position).toBeDefined();
      expect(Number.isFinite(position?.x)).toBe(true);
      expect(Number.isFinite(position?.y)).toBe(true);
    }

    expect(snapshot.get("claim")).toEqual({ x: 320, y: 240 });

    const alpha = snapshot.get("seat:alpha");
    const beta = snapshot.get("seat:beta");
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    if (alpha === undefined || beta === undefined) return;

    expect(Math.hypot(alpha.x - beta.x, alpha.y - beta.y)).toBeGreaterThan(80);
  });

  it("seeds seat-indexed jurors on stable pentagon slots", () => {
    const size = { width: 640, height: 480 };
    const centre = { x: 320, y: 240 };
    const radius = Math.min(size.width, size.height) / 3.2;
    const graph: DeliberationGraph = {
      nodes: [
        { id: "claim", kind: "claim", label: "Claim", atMs: 0 },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `seat:${index}`,
          kind: "juror" as const,
          label: `Juror ${index + 1}`,
          atMs: 1,
          seatId: `seat-${index}`,
          seatIndex: index,
        })),
      ],
      edges: Array.from({ length: 5 }, (_, index) => ({
        id: `seat-${index}`,
        from: "claim",
        to: `seat:${index}`,
        kind: "seat" as const,
      })),
    };

    const { simulation, positions } = createSimulation(graph, size);
    simulation.stop();
    // No ticks: assert the raw seeds, which is what a spawning juror gets.
    const seeds = positions();
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
      const seed = seeds.get(`seat:${index}`);
      expect(seed?.x).toBeCloseTo(centre.x + Math.cos(angle) * radius, 6);
      expect(seed?.y).toBeCloseTo(centre.y + Math.sin(angle) * radius, 6);
    }
  });
});

import { describe, expect, it } from "vitest";

import type { DeliberationGraph } from "./deliberation-graph";
import { createSimulation, seatRingRadius } from "./force-layout";

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

/** Five seat-indexed jurors and nothing else: the pentagon on its own. */
function pentagon(): DeliberationGraph {
  return {
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
}

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

  it("seeds seat-indexed jurors on a compact centred pentagon", () => {
    const size = { width: 640, height: 480 };
    const centre = { x: 320, y: 240 };
    // The seats sit on ONE radius, not on the cloud's ellipse: a regular
    // pentagon, centred on the hidden claim anchor, whatever shape the
    // stage is.
    const radius = seatRingRadius(size);
    const { simulation, positions } = createSimulation(pentagon(), size);
    simulation.stop();
    // No ticks: assert the raw seeds, which is what a spawning juror gets.
    const seeds = positions();
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
      const seed = seeds.get(`seat:${index}`);
      expect(seed?.x).toBeCloseTo(centre.x + Math.cos(angle) * radius, 6);
      expect(seed?.y).toBeCloseTo(centre.y + Math.sin(angle) * radius, 6);
    }
    // Every seat the same distance from the centre: that is the pentagon.
    const distances = Array.from({ length: 5 }, (_, index) => {
      const seed = seeds.get(`seat:${index}`);
      return Math.hypot((seed?.x ?? 0) - centre.x, (seed?.y ?? 0) - centre.y);
    });
    for (const distance of distances) expect(distance).toBeCloseTo(radius, 6);
  });

  it("keeps the ring compact on a wide stage", () => {
    // The stage the claim page actually gives the graph at 1440 wide, and a
    // very wide one. The ring is bounded in both: it never spends the whole
    // room the way the old ellipse did.
    const desktop = seatRingRadius({ width: 1120, height: 829 });
    expect(desktop).toBeGreaterThanOrEqual(150);
    expect(desktop).toBeLessThanOrEqual(200);
    expect(seatRingRadius({ width: 2400, height: 1400 })).toBeLessThanOrEqual(190);
    // A phone still gets a ring big enough to read.
    expect(seatRingRadius({ width: 375, height: 520 })).toBeGreaterThanOrEqual(100);
    // Ten slots need more circle than five to keep the discs apart.
    expect(seatRingRadius({ width: 375, height: 520 }, 10)).toBeGreaterThan(
      seatRingRadius({ width: 375, height: 520 }, 5),
    );
  });

  it("branches research outward from its own seat", () => {
    const size = { width: 640, height: 480 };
    const centre = { x: 320, y: 240 };
    const { simulation, positions } = createSimulation(GRAPH, size);
    simulation.stop();
    const seeds = positions();

    for (const [seatId, stepId] of [
      ["seat:alpha", "step:alpha:0"],
      ["seat:beta", "step:beta:0"],
    ] as const) {
      const seat = seeds.get(seatId);
      const step = seeds.get(stepId);
      expect(seat).toBeDefined();
      expect(step).toBeDefined();
      if (seat === undefined || step === undefined) return;
      const seatOut = Math.hypot(seat.x - centre.x, seat.y - centre.y);
      const stepOut = Math.hypot(step.x - centre.x, step.y - centre.y);
      // Further from the middle than its juror, and on its juror's side of
      // the map: trails grow away from the pentagon, never across it.
      expect(stepOut).toBeGreaterThan(seatOut);
      expect(Math.hypot(step.x - seat.x, step.y - seat.y)).toBeLessThan(80);
    }
  });

  it("keeps a dropped node exactly where it was dropped", () => {
    const size = { width: 640, height: 480 };
    const dropped = { x: 90, y: 430 };
    const pinned = new Map([["seat:2", dropped]]);
    const { simulation, positions } = createSimulation(pentagon(), size, {
      pinned,
    });

    // The seed is the drop, and 400 ticks of a hot simulation do not move it.
    expect(positions().get("seat:2")).toEqual(dropped);
    simulation.stop();
    simulation.tick(400);
    expect(positions().get("seat:2")).toEqual(dropped);
    // The other seats are still free to settle on their own slots.
    const centre = { x: 320, y: 240 };
    const free = positions().get("seat:0");
    expect(free).toBeDefined();
    expect(
      Math.hypot((free?.x ?? 0) - centre.x, (free?.y ?? 0) - centre.y),
    ).toBeGreaterThan(60);
  });

  it("lays a dropped juror's research out around its new spot", () => {
    const size = { width: 640, height: 480 };
    const dropped = { x: 120, y: 400 };
    const { simulation, positions } = createSimulation(GRAPH, size, {
      pinned: new Map([["seat:alpha", dropped]]),
    });
    simulation.stop();
    const seeds = positions();

    const step = seeds.get("step:alpha:0");
    expect(step).toBeDefined();
    // Seeded beside the seat where the reader put it, not beside the
    // pentagon slot it came from.
    expect(
      Math.hypot((step?.x ?? 0) - dropped.x, (step?.y ?? 0) - dropped.y),
    ).toBeLessThan(80);
  });
});

import { describe, expect, it } from "vitest";

import type { DeliberationGraph, GraphNode } from "./deliberation-graph";
import {
  buildCourtroomLayout,
  CHIP_HEIGHT,
  countsLabel,
  confidencePercent,
  courtroomRadii,
  miniRing,
  polar,
  searchLabel,
  seatAngle,
  SEAT_NODE_RADIUS,
} from "./courtroom-layout";

const TAU = Math.PI * 2;
const VIEWPORT = { width: 1120, height: 800 };

function seatId(index: number): string {
  return `0xseat${index}`;
}

function juror(index: number, options: { satellite?: boolean } = {}): GraphNode {
  return {
    id: `seat:${seatId(index)}`,
    kind: "juror",
    label: `Juror ${index + 1}`,
    atMs: 1_000 + index,
    seatId: seatId(index),
    seatIndex: index,
    family: "deepseek",
    state: "revealed",
    ...(options.satellite === true ? { satellite: true } : {}),
  };
}

function search(index: number, ordinal: number): GraphNode {
  return {
    id: `step:run${index}:${ordinal}`,
    kind: "search",
    label: `support: query ${ordinal}`,
    atMs: 2_000 + ordinal,
    seatId: seatId(index),
    runId: `run${index}`,
    stepIndex: ordinal,
    intent: "support",
  };
}

function page(index: number, ordinal: number, url: string): GraphNode {
  return {
    id: `step:run${index}:${ordinal}`,
    kind: "page",
    label: "Opened page",
    atMs: 2_000 + ordinal,
    seatId: seatId(index),
    runId: `run${index}`,
    stepIndex: ordinal,
    url,
  };
}

function verdict(index: number, outcome: "YES" | "NO" | "UNSURE"): GraphNode {
  return {
    id: `verdict:run${index}`,
    kind: "verdict",
    label: outcome,
    atMs: 3_000 + index,
    seatId: seatId(index),
    runId: `run${index}`,
    outcome,
    confidenceBps: 7_800,
  };
}

const CLAIM_NODE: GraphNode = {
  id: "claim",
  kind: "claim",
  label: "A claim on trial.",
  atMs: 0,
};

/** A five seat committee, each juror with one search and one page. */
function committee(options: {
  seats?: number;
  urls?: (index: number) => string;
  certificate?: boolean;
} = {}): DeliberationGraph {
  const count = options.seats ?? 5;
  const nodes: GraphNode[] = [CLAIM_NODE];
  const edges: DeliberationGraph["edges"] = [];
  for (let index = 0; index < count; index += 1) {
    nodes.push(juror(index), search(index, 0), page(index, 1, options.urls?.(index) ?? `https://site${index}.test/a`), verdict(index, "YES"));
    edges.push(
      { id: `edge:seat:${index}`, from: "claim", to: `seat:${seatId(index)}`, kind: "seat" },
      { id: `edge:action:${index}`, from: `seat:${seatId(index)}`, to: `step:run${index}:0`, kind: "action" },
      { id: `edge:result:${index}`, from: `step:run${index}:0`, to: `step:run${index}:1`, kind: "result" },
      { id: `edge:verdict:${index}`, from: `seat:${seatId(index)}`, to: `verdict:run${index}`, kind: "verdict" },
    );
  }
  if (options.certificate === true) {
    nodes.push({
      id: "certificate",
      kind: "certificate",
      label: "Certificate · YES",
      atMs: 9_000,
    });
  }
  return { nodes, edges };
}

/** Every unordered pair, for the collision checks. */
function pairs<T>(items: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const a = items[left];
      const b = items[right];
      if (a !== undefined && b !== undefined) out.push([a, b]);
    }
  }
  return out;
}

function normalize(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

describe("courtroomRadii", () => {
  it("keeps the whole plan inside the viewport at every stage size", () => {
    for (const size of [
      { width: 1360, height: 820 },
      { width: 1120, height: 800 },
      { width: 704, height: 700 },
      { width: 375, height: 640 },
      { width: 320, height: 480 },
    ]) {
      const radii = courtroomRadii(size);
      const half = Math.min(size.width, size.height) / 2;
      // The outermost chip still clears the edge of the stage.
      expect(radii.outer + CHIP_HEIGHT / 2).toBeLessThanOrEqual(half);
      expect(radii.seat).toBeLessThan(radii.research);
      expect(radii.inner).toBeLessThan(radii.seat - SEAT_NODE_RADIUS);
      expect(radii.inner).toBeGreaterThan(radii.hub);
    }
  });

  it("spends the stage on the ring", () => {
    // The jury ring, not the empty middle, is what the stage is for: it fills
    // about four fifths of the shorter side at desktop sizes.
    for (const size of [
      { width: 1260, height: 730 },
      { width: 1120, height: 832 },
    ]) {
      const radii = courtroomRadii(size);
      const share = (radii.seat * 2) / Math.min(size.width, size.height);
      expect(share).toBeGreaterThan(0.74);
      expect(share).toBeLessThan(0.9);
    }
  });

  it("grows with the stage and stops at its ceiling", () => {
    const small = courtroomRadii({ width: 700, height: 700 });
    const large = courtroomRadii({ width: 1200, height: 900 });
    const huge = courtroomRadii({ width: 4000, height: 3000 });
    expect(large.seat).toBeGreaterThan(small.seat);
    expect(huge.seat).toBe(360);
  });
});

describe("buildCourtroomLayout", () => {
  it("is deterministic for a given committee", () => {
    const graph = committee();
    const first = buildCourtroomLayout(graph, VIEWPORT);
    const second = buildCourtroomLayout(graph, VIEWPORT);
    expect(JSON.stringify(second.seats)).toBe(JSON.stringify(first.seats));
    expect(JSON.stringify(second.wires)).toBe(JSON.stringify(first.wires));
  });

  it("seats juror 1 at the top and the rest clockwise", () => {
    const layout = buildCourtroomLayout(committee(), VIEWPORT);
    expect(layout.seats).toHaveLength(5);
    expect(layout.seats.map((seat) => seat.number)).toEqual([1, 2, 3, 4, 5]);

    const [first, second, , , last] = layout.seats;
    expect(first?.angle).toBe(0);
    expect(first?.x).toBeCloseTo(layout.centre.x, 6);
    expect(first?.y).toBeCloseTo(layout.centre.y - layout.radii.seat, 6);
    // Clockwise: seat 2 is to the right, seat 5 to the left.
    expect(second?.x).toBeGreaterThan(layout.centre.x);
    expect(last?.x).toBeLessThan(layout.centre.x);
    for (const [index, seat] of layout.seats.entries()) {
      expect(seat.angle).toBeCloseTo(seatAngle(index, 5), 10);
    }
  });

  it("follows the Live view's juror numbers when they are given", () => {
    // The Live view numbers by the round's expected seat order, which is not
    // the commitment order the graph carries.
    const seatNumbers = new Map([
      [seatId(0), 3],
      [seatId(1), 1],
      [seatId(2), 5],
      [seatId(3), 2],
      [seatId(4), 4],
    ]);
    const layout = buildCourtroomLayout(committee(), VIEWPORT, { seatNumbers });
    expect(layout.seats.map((seat) => seat.number)).toEqual([1, 2, 3, 4, 5]);
    expect(layout.seats.map((seat) => seat.node.seatId)).toEqual([
      seatId(1),
      seatId(3),
      seatId(0),
      seatId(4),
      seatId(2),
    ]);
  });

  it("gives every juror an equal wedge and never overlaps two of them", () => {
    const layout = buildCourtroomLayout(committee(), VIEWPORT);
    const spans = layout.seats.map((seat) => seat.wedge.end - seat.wedge.start);
    for (const span of spans) expect(span).toBeCloseTo(TAU / 5, 10);
    for (const [index, seat] of layout.seats.entries()) {
      const next = layout.seats[(index + 1) % layout.seats.length];
      expect(next).toBeDefined();
      // One wedge ends exactly where the next begins: no gap, no overlap.
      expect(normalize(seat.wedge.end)).toBeCloseTo(
        normalize(next?.wedge.start ?? 0),
        10,
      );
    }
  });

  it("keeps every research chip inside its own juror's wedge", () => {
    // Ten steps per juror is enough to force several arc rows.
    const graph = committee();
    for (let index = 0; index < 5; index += 1) {
      for (let ordinal = 2; ordinal < 12; ordinal += 1) {
        graph.nodes.push(search(index, ordinal));
        graph.edges.push({
          id: `edge:action:${index}:${ordinal}`,
          from: `seat:${seatId(index)}`,
          to: `step:run${index}:${ordinal}`,
          kind: "action",
        });
      }
    }
    const layout = buildCourtroomLayout(graph, VIEWPORT);
    for (const seat of layout.seats) {
      expect(seat.chips.length).toBeGreaterThan(0);
      for (const chip of seat.chips) {
        expect(chip.wedgeSeatId).toBe(seat.id);
        expect(chip.angle).toBeGreaterThan(seat.wedge.start);
        expect(chip.angle).toBeLessThan(seat.wedge.end);
        // The chip's own box stays inside the wedge too.
        const halfSpan = chip.width / 2 / chip.radius;
        expect(chip.angle - halfSpan).toBeGreaterThan(seat.wedge.start);
        expect(chip.angle + halfSpan).toBeLessThan(seat.wedge.end);
        expect(chip.radius).toBeGreaterThan(layout.radii.seat);
        expect(chip.radius).toBeLessThanOrEqual(layout.radii.research);
      }
    }
  });

  it("never overlaps two chips of a wedge, at any angle or trail length", () => {
    // Boxes are axis aligned, so a wedge on a diagonal spoke is the hard case:
    // neighbours must clear each other on one axis or the other.
    for (const size of [
      { width: 1120, height: 820 },
      { width: 704, height: 700 },
      { width: 375, height: 640 },
    ]) {
      for (const steps of [2, 3, 4, 6, 8, 12, 20]) {
        const graph = committee();
        for (let index = 0; index < 5; index += 1) {
          for (let ordinal = 2; ordinal < steps; ordinal += 1) {
            graph.nodes.push(search(index, ordinal));
          }
        }
        const layout = buildCourtroomLayout(graph, size);
        for (const seat of layout.seats) {
          for (const [left, right] of pairs(seat.chips)) {
            const clearX = Math.abs(left.x - right.x) >= left.width / 2 + right.width / 2;
            const clearY = Math.abs(left.y - right.y) >= 22;
            expect(
              clearX || clearY,
              `${size.width}px, ${steps} steps: chips ${left.id} and ${right.id} overlap`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("orders a wedge's chips by ordinal, outward from the juror", () => {
    const layout = buildCourtroomLayout(committee(), VIEWPORT);
    const seat = layout.seats[0];
    expect(seat).toBeDefined();
    expect(seat?.chips.map((chip) => chip.node.stepIndex)).toEqual([0, 1]);
    expect(seat?.counts).toEqual({ searches: 1, pages: 1 });
  });

  it("draws a page two jurors share once, on the boundary between them", () => {
    // Jurors 1 and 2 (adjacent seats) both open the same url.
    const graph = committee({
      urls: (index) => (index <= 1 ? "https://mit.edu/paper" : `https://site${index}.test/a`),
    });
    const layout = buildCourtroomLayout(graph, VIEWPORT);
    expect(layout.shared).toHaveLength(1);
    const [shared] = layout.shared;
    const [first, second] = layout.seats;
    expect(shared?.seatIds).toEqual([first?.id, second?.id]);
    expect(shared?.angle).toBeCloseTo((first?.wedge.end ?? 0), 10);
    expect(shared?.angle).toBeCloseTo((second?.wedge.start ?? 0), 10);
    // It leaves both wedges: neither juror still draws its own copy.
    for (const seat of [first, second]) {
      expect(seat?.chips.some((chip) => chip.node.kind === "page")).toBe(false);
      // The count still says the juror opened a page.
      expect(seat?.counts.pages).toBe(1);
    }
    // Exactly one hairline to each juror, and nothing else crosses.
    const crossing = layout.wires.filter((wire) => wire.kind === "shared");
    expect(crossing).toHaveLength(2);
    expect(crossing.map((wire) => wire.seatId)).toEqual([first?.id, second?.id]);
  });

  it("keeps a page the whole panel opened in every wedge, with a shared mark", () => {
    const graph = committee({ urls: () => "https://mit.edu/paper" });
    const layout = buildCourtroomLayout(graph, VIEWPORT);
    expect(layout.shared).toHaveLength(0);
    expect(layout.wires.some((wire) => wire.kind === "shared")).toBe(false);
    for (const seat of layout.seats) {
      const pageChip = seat.chips.find((chip) => chip.node.kind === "page");
      expect(pageChip?.sharedBy).toBe(5);
    }
  });

  it("rides a round-two seat on its juror's own spoke", () => {
    const graph = committee();
    const satellite = juror(5, { satellite: true });
    graph.nodes.push(satellite, verdict(5, "NO"));
    graph.edges.push(
      { id: "edge:round:0", from: "seat:0xseat0", to: satellite.id, kind: "round" },
      { id: "edge:verdict:5", from: satellite.id, to: "verdict:run5", kind: "verdict" },
    );
    const layout = buildCourtroomLayout(graph, VIEWPORT);
    expect(layout.seats).toHaveLength(5);
    const [first] = layout.seats;
    expect(first?.roundTwo?.node.id).toBe(satellite.id);
    expect(first?.roundTwo?.angle).toBe(first?.angle);
    expect(first?.roundTwo?.verdict?.outcome).toBe("NO");
    const radius = Math.hypot(
      (first?.roundTwo?.x ?? 0) - layout.centre.x,
      (first?.roundTwo?.y ?? 0) - layout.centre.y,
    );
    expect(radius).toBeCloseTo(layout.radii.inner, 6);
    // The angle is the whole tie: no hairline reaches inside the ring toward
    // the pill, because on a sideways spoke it would fill the band and show on
    // some seats only.
    const inward = layout.wires.filter((wire) =>
      Math.hypot(wire.x1 - layout.centre.x, wire.y1 - layout.centre.y) < layout.radii.seat
      || Math.hypot(wire.x2 - layout.centre.x, wire.y2 - layout.centre.y) < layout.radii.seat,
    );
    expect(inward).toEqual([]);
  });

  it("closes the ring with the certificate at the bottom", () => {
    const layout = buildCourtroomLayout(committee({ certificate: true }), VIEWPORT);
    expect(layout.certificate?.angle).toBe(Math.PI);
    expect(layout.certificate?.x).toBeCloseTo(layout.centre.x, 6);
    expect(layout.certificate?.y).toBeCloseTo(layout.centre.y + layout.radii.seat, 6);
    // Five seats put it between jurors 3 and 4, touching neither.
    const third = layout.seats[2];
    const fourth = layout.seats[3];
    expect(layout.certificate?.angle).toBeGreaterThan(third?.angle ?? 0);
    expect(layout.certificate?.angle).toBeLessThan(fourth?.angle ?? 0);
  });

  it("draws every node inside the stage at 1440, 1024 and 375", () => {
    const graph = committee({ certificate: true });
    for (const size of [
      { width: 1120, height: 820 },
      { width: 704, height: 700 },
      { width: 375, height: 640 },
    ]) {
      const layout = buildCourtroomLayout(graph, size);
      const points = [
        ...layout.seats.flatMap((seat) => [
          { x: seat.x, y: seat.y },
          ...seat.chips.map((chip) => ({ x: chip.x, y: chip.y })),
        ]),
        ...layout.shared.map((shared) => ({ x: shared.x, y: shared.y })),
        ...(layout.certificate === undefined ? [] : [layout.certificate]),
      ];
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(size.width);
        expect(point.y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it("keeps the whole plan above an open debate dock", () => {
    const graph = committee({ certificate: true });
    const size = { width: 1260, height: 730 };
    const open = buildCourtroomLayout(graph, size, { insetBottom: 347 });
    const shut = buildCourtroomLayout(graph, size);
    // The room shifts up and shrinks so the dock never covers a seat.
    expect(open.centre.y).toBeLessThan(shut.centre.y);
    expect(open.radii.seat).toBeLessThan(shut.radii.seat);
    const floor = size.height - 347;
    for (const seat of open.seats) {
      expect(seat.y + SEAT_NODE_RADIUS).toBeLessThanOrEqual(floor);
      for (const chip of seat.chips) {
        expect(chip.y + CHIP_HEIGHT / 2).toBeLessThanOrEqual(floor);
      }
    }
    expect((open.certificate?.y ?? 0) + 22).toBeLessThanOrEqual(floor);
  });

  it("collapses the labels on a narrow stage", () => {
    expect(buildCourtroomLayout(committee(), { width: 375, height: 640 }).compact).toBe(true);
    expect(buildCourtroomLayout(committee(), VIEWPORT).compact).toBe(false);
  });

  it("leaves the middle empty: no claim node and no wire reaching it", () => {
    // The claim is stated on the left panel; a node at the centre would only
    // gather lines (owner, 2026-09-04).
    const layout = buildCourtroomLayout(committee({ certificate: true }), VIEWPORT);
    expect(layout.wires.length).toBeGreaterThan(0);
    for (const wire of layout.wires) {
      for (const [x, y] of [[wire.x1, wire.y1], [wire.x2, wire.y2]]) {
        const distance = Math.hypot(
          (x ?? 0) - layout.centre.x,
          (y ?? 0) - layout.centre.y,
        );
        expect(distance).toBeGreaterThanOrEqual(layout.radii.hub);
      }
    }
  });

  it("draws only a juror's own branches and the one shared cross edge", () => {
    const graph = committee();
    const satellite = juror(5, { satellite: true });
    graph.nodes.push(satellite, verdict(5, "NO"));
    graph.edges.push({
      id: "edge:round:0",
      from: "seat:0xseat0",
      to: satellite.id,
      kind: "round",
    });
    const layout = buildCourtroomLayout(graph, VIEWPORT);
    expect(layout.wires.length).toBeGreaterThan(0);
    for (const wire of layout.wires) {
      expect(["branch", "shared"]).toContain(wire.kind);
    }
  });

  it("survives an empty graph", () => {
    const layout = buildCourtroomLayout({ nodes: [], edges: [] }, VIEWPORT);
    expect(layout.seats).toEqual([]);
    expect(layout.shared).toEqual([]);
    expect(layout.wires).toEqual([]);
    expect(layout.certificate).toBeUndefined();
  });
});

describe("polar", () => {
  it("measures clockwise from the top", () => {
    const centre = { x: 100, y: 100 };
    expect(polar(centre, 10, 0)).toEqual({ x: 100, y: 90 });
    const right = polar(centre, 10, Math.PI / 2);
    expect(right.x).toBeCloseTo(110, 6);
    expect(right.y).toBeCloseTo(100, 6);
    const bottom = polar(centre, 10, Math.PI);
    expect(bottom.x).toBeCloseTo(100, 6);
    expect(bottom.y).toBeCloseTo(110, 6);
  });
});

describe("miniRing", () => {
  it("draws the same seating chart at a glanceable size", () => {
    const ring = miniRing(5, 36);
    expect(ring.size).toBe(88);
    expect(ring.seats).toHaveLength(5);
    const [first] = ring.seats;
    // Seat 1 at the top, the certificate closing the ring at the bottom.
    expect(first?.x).toBeCloseTo(ring.centre.x, 6);
    expect(first?.y).toBeCloseTo(ring.centre.y - 36, 6);
    expect(ring.certificate.x).toBeCloseTo(ring.centre.x, 6);
    expect(ring.certificate.y).toBeCloseTo(ring.centre.y + 36, 6);
    for (const seat of ring.seats) {
      expect(Math.hypot(seat.x - ring.centre.x, seat.y - ring.centre.y)).toBeCloseTo(36, 6);
    }
  });

  it("survives an empty jury", () => {
    expect(miniRing(0, 36).seats).toEqual([]);
  });
});

describe("labels", () => {
  it("shows a search's intent alone in a narrow slot", () => {
    const node = search(0, 0);
    expect(searchLabel(node, false)).toBe("support");
    // The localnet queries open with their own intent; never say it twice.
    expect(searchLabel(node, true)).toBe("support: query 0");
    expect(searchLabel({ ...node, label: "did the rate rise?", intent: "challenge" }, true))
      .toBe("challenge · did the rate rise?");
  });

  it("reads confidence as a whole percentage, never as basis points", () => {
    expect(confidencePercent(7_800)).toBe("78%");
    // Rounded the way the Live view says it, so the two views agree.
    expect(confidencePercent(8_650)).toBe("87%");
    expect(confidencePercent(undefined)).toBeUndefined();
  });

  it("counts a juror's research in words", () => {
    expect(countsLabel({ searches: 2, pages: 5 })).toBe("2 searches · 5 pages");
    expect(countsLabel({ searches: 1, pages: 0 })).toBe("1 search");
    expect(countsLabel({ searches: 0, pages: 0 })).toBeUndefined();
  });
});

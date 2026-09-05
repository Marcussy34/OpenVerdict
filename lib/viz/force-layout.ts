import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type {
  DeliberationGraph,
  GraphNode,
} from "./deliberation-graph";

type LayoutNode = SimulationNodeDatum & {
  id: string;
  kind: GraphNode["kind"];
  seatIndex?: number;
  /** Round-2 seat riding its agent's round-1 disc; takes no ring slot. */
  satellite?: boolean;
  /** Pentagon slot a juror is softly anchored to (angle AND radius). */
  homeX?: number;
  homeY?: number;
};

type LayoutLink = SimulationLinkDatum<LayoutNode>;

function coordinate(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function collisionRadius(node: LayoutNode): number {
  if (node.kind === "juror") return node.satellite === true ? 22 : 26;
  // The claim is no longer drawn (owner, 2026-09-04): it is only the pinned
  // anchor the jury sits around, so it holds the middle open for the
  // certificate instead of reserving room for a circle and a statement.
  if (node.kind === "claim") return 34;
  return 14;
}

/**
 * The COMPACT pentagon the seats start on (owner, 2026-09-05: "make them start
 * off within a pentagon, then the reasoning all branches out from there"): a
 * circle, not the cloud's ellipse, so the five discs stay together in the
 * middle of a wide stage instead of ending up in its corners.
 *
 * A fifth of the shorter side of the stage, capped so a big desktop never
 * spends all of it on the ring, and never smaller than the floor a seat's
 * labels need. A two-round decagon asks for more circle than a pentagon to
 * keep neighbouring discs apart, so the widest of the three wins.
 */
export function seatRingRadius(
  size: { width: number; height: number },
  ringSlots = 5,
): number {
  const share = Math.min(190, Math.min(size.width, size.height) * 0.2);
  // Chord between neighbouring slots, kept clear of a disc plus its badge.
  const spacing = 84 / (2 * Math.sin(Math.PI / Math.max(3, ringSlots)));
  // The floor is what a seat's vote pill and its address chip need beside
  // the next seat's: below it the labels start reading as one smudge.
  return Math.max(118, spacing, share);
}

export function createSimulation(
  graph: DeliberationGraph,
  size: { width: number; height: number },
  options: {
    /**
     * Nodes the user dragged and dropped: they are re-pinned exactly there on
     * every rebuild, and a dropped juror's research recomputes around its new
     * spot rather than around the pentagon slot it left.
     */
    pinned?: ReadonlyMap<string, { x: number; y: number }>;
  } = {},
): {
  simulation: Simulation<LayoutNode, LayoutLink>;
  positions: () => Map<string, { x: number; y: number }>;
} {
  const pinned = options.pinned ?? new Map<string, { x: number; y: number }>();
  const centre = { x: size.width / 2, y: size.height / 2 };
  // The stage is rarely square: the debate dock takes the bottom of it and
  // leaves a wide, short room. This ellipse is the room the whole CLOUD may
  // take, spending what each axis actually has. The seats themselves no
  // longer take it: they hold a compact pentagon in the middle and the
  // research fans out from there toward this rim.
  const radiusX = size.width / 2.9;
  const radiusY = size.height / 4.2;
  const jurorCount = graph.nodes.filter(
    (node) => node.kind === "juror" && node.satellite !== true,
  ).length;
  let jurorIndex = 0;
  // Ring slots first: a seat's committee index fixes its angle, so jurors
  // spawn evenly spaced even when they appear one by one. One round makes a
  // pentagon; once round-2 seats exist, round-1 keeps its five angles on the
  // even spokes of a decagon and round-2 interleaves on the odd spokes, so
  // escalation never piles two seats onto the same slot.
  const twoRounds = graph.nodes.some(
    (node) =>
      node.kind === "juror" &&
      node.satellite !== true &&
      (node.seatIndex ?? 0) >= 5,
  );
  const ringSlots = twoRounds ? 10 : Math.max(5, jurorCount);
  const ringRadius = seatRingRadius(size, ringSlots);
  const jurorHomes = new Map<string, { x: number; y: number; angle: number }>();
  for (const node of graph.nodes) {
    // Satellites ride their agent's ray; only ring jurors take slots.
    if (node.kind !== "juror" || node.satellite === true || jurorCount === 0) continue;
    const slot = node.seatIndex ?? jurorIndex;
    jurorIndex += 1;
    let angle: number;
    if (node.seatIndex === undefined) {
      angle = ((slot % jurorCount) / jurorCount) * Math.PI * 2 - Math.PI / 2;
    } else if (twoRounds) {
      const ringSlot = slot < 5 ? slot * 2 : (slot - 5) * 2 + 1;
      angle = ((ringSlot % 10) / 10) * Math.PI * 2 - Math.PI / 2;
    } else {
      angle = ((slot % 5) / 5) * Math.PI * 2 - Math.PI / 2;
    }
    jurorHomes.set(node.id, {
      // One radius on both axes: the seats keep a regular pentagon whatever
      // shape the stage is, and only the research spends the wide room.
      x: centre.x + Math.cos(angle) * ringRadius,
      y: centre.y + Math.sin(angle) * ringRadius,
      angle,
    });
  }
  // A seat the user dropped somewhere becomes its OWN home: its research is
  // laid out around where it now sits, so a dragged juror takes its trail
  // with it instead of leaving it behind on the pentagon.
  for (const id of [...jurorHomes.keys()]) {
    const pin = pinned.get(id);
    if (pin === undefined) continue;
    jurorHomes.set(id, {
      x: pin.x,
      y: pin.y,
      angle: Math.atan2(pin.y - centre.y, pin.x - centre.x),
    });
  }
  // How far each seat actually sits from the centre. Its spoke is given this
  // length, so a spoke never drags a dropped seat back onto the ring.
  const seatDistance = new Map<string, number>();
  for (const [id, home] of jurorHomes) {
    seatDistance.set(id, Math.hypot(home.x - centre.x, home.y - centre.y));
  }

  // Every research-trail node gets a home on its OWN juror's outward ray:
  // BFS over non-seat edges assigns each node to its nearest juror and a
  // depth, so trails fan away from the ring instead of wandering across the
  // canvas and crossing other jurors' work. Settle edges are skipped so the
  // shared certificate never chains one juror's trail to another's.
  const adjacency = new Map<string, string[]>();
  const addAdjacent = (from: string, to: string): void => {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [to]);
    else list.push(to);
  };
  const kindById = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  for (const edge of graph.edges) {
    if (edge.kind === "seat" || edge.kind === "settle") continue;
    addAdjacent(edge.from, edge.to);
    addAdjacent(edge.to, edge.from);
  }
  const satelliteIds = new Set(
    graph.nodes
      .filter((node) => node.kind === "juror" && node.satellite === true)
      .map((node) => node.id),
  );
  const trailHomes = new Map<string, { x: number; y: number }>();
  const trailDepth = new Map<string, number>();
  // Room a trail may take beyond its seat: from the compact pentagon out to
  // the cloud's rim, so a wide stage buys LONGER research spokes rather than
  // a wider ring of seats.
  const maxExtra = Math.max(150, (radiusX + radiusY) / 2 + 48 - ringRadius);
  // The seats keep their circle, but the CLOUD may take the ellipse: a step
  // into the wide part of the room is longer than a step into the short
  // part, so research fills a wide, short stage instead of a circle drawn
  // inside it and squeezed down to fit. A fractional power of the room's
  // aspect keeps it gentle, and the clamp stops it ever going past 1.8x.
  const stretch = Math.min(
    1.8,
    Math.max(1 / 1.8, (radiusX / Math.max(1, radiusY)) ** 0.35),
  );
  for (const [jurorId, home] of jurorHomes) {
    // Each first-hop branch off the juror gets its own fanned angle, so the
    // round-1 trail, the verdict, and a round-2 satellite chain spread out
    // instead of stacking on one ray.
    const branches = (adjacency.get(jurorId) ?? []).filter(
      (id) => kindById.get(id) !== "claim",
    );
    const fan = (branchIndex: number): number =>
      branches.length <= 1
        ? home.angle
        : home.angle +
          (branchIndex - (branches.length - 1) / 2) *
            Math.min(0.5, 1.2 / (branches.length - 1));
    const queue: Array<{ id: string; depth: number; angle: number }> =
      branches.map((id, branchIndex) => ({
        id,
        depth: 1,
        angle: fan(branchIndex),
      }));
    const seen = new Set<string>([jurorId, ...branches]);
    for (let head = 0; head < queue.length; head += 1) {
      const item = queue[head];
      if (item === undefined) continue;
      const kind = kindById.get(item.id);
      // Shared anchors never become trail nodes; ring jurors stay put, but a
      // satellite is traversed so its own research hangs beyond it.
      if (kind === "claim" || kind === "certificate") continue;
      if (kind === "juror" && !satelliteIds.has(item.id)) continue;
      const known = trailDepth.get(item.id);
      if (known === undefined || item.depth < known) {
        trailDepth.set(item.id, item.depth);
        const distance = Math.min(item.depth * 58, maxExtra);
        trailHomes.set(item.id, {
          x: home.x + Math.cos(item.angle) * distance * stretch,
          y: home.y + (Math.sin(item.angle) * distance) / stretch,
        });
      }
      for (const next of adjacency.get(item.id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push({ id: next, depth: item.depth + 1, angle: item.angle });
      }
    }
  }

  const seed = (node: GraphNode): LayoutNode => {
    if (node.kind === "claim") {
      return { id: node.id, kind: node.kind, fx: centre.x, fy: centre.y };
    }
    const jurorHome = jurorHomes.get(node.id);
    if (jurorHome !== undefined) {
      return {
        id: node.id,
        kind: node.kind,
        seatIndex: node.seatIndex,
        x: jurorHome.x,
        y: jurorHome.y,
        homeX: jurorHome.x,
        homeY: jurorHome.y,
      };
    }
    const trailHome = trailHomes.get(node.id);
    if (trailHome !== undefined) {
      // Spawn AT the ray home so new ticks appear beside their juror rather
      // than flying in from d3's default spiral at the origin.
      return {
        id: node.id,
        kind: node.kind,
        seatIndex: node.seatIndex,
        satellite: node.satellite,
        x: trailHome.x,
        y: trailHome.y,
        homeX: trailHome.x,
        homeY: trailHome.y,
      };
    }
    return { id: node.id, kind: node.kind };
  };

  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    const laid = seed(node);
    const pin = pinned.get(node.id);
    // A node the user dropped is fixed where it was dropped, through every
    // rebuild and every reheat, until a double-click releases it.
    if (pin === undefined) return laid;
    return { ...laid, x: pin.x, y: pin.y, fx: pin.x, fy: pin.y };
  });

  // Jurors hold the pentagon firmly; trail nodes are tugged toward their ray
  // homes just hard enough to stay on their own juror's side.
  const homeStrength = (node: LayoutNode): number => {
    if (node.homeX === undefined || node.homeY === undefined) return 0;
    return node.kind === "juror" ? 0.5 : 0.14;
  };
  type LinkWithKind = LayoutLink & { kind: string };
  const links: LinkWithKind[] = graph.edges.map((edge) => ({
    source: edge.from,
    target: edge.to,
    kind: edge.kind,
  }));
  // Seat spokes hold the committee ring; the research subtrees hang further
  // out from each juror instead of collapsing into the claim (a flat 40px
  // distance piled every node under the juror discs).
  const linkDistance = (link: LinkWithKind): number => {
    switch (link.kind) {
      case "seat": {
        // d3 has already resolved the endpoints to nodes by the time this is
        // asked, so the spoke can carry its own seat's radius.
        const target = link.target;
        const id = typeof target === "object" ? target.id : String(target);
        return seatDistance.get(id) ?? ringRadius;
      }
      case "round": return 96;
      case "verdict": return 84;
      case "settle": return 110;
      case "action": return 64;
      default: return 52;
    }
  };

  const simulation = forceSimulation<LayoutNode, LayoutLink>(nodes)
    .force(
      "link",
      forceLink<LayoutNode, LinkWithKind>(links)
        .id((node) => node.id)
        .distance(linkDistance)
        .strength((link) => (link.kind === "seat" ? 0.9 : link.kind === "round" ? 0.8 : 0.5)),
    )
    // A juror is pulled firmly toward its OWN pentagon slot (keeping the even
    // 72-degree spacing); every trail node is tugged toward its outward ray
    // home, so research fans out per juror instead of crossing the canvas.
    .force(
      "juror-home-x",
      forceX<LayoutNode>((node) => node.homeX ?? centre.x)
        .strength(homeStrength),
    )
    .force(
      "juror-home-y",
      forceY<LayoutNode>((node) => node.homeY ?? centre.y)
        .strength(homeStrength),
    )
    .force("charge", forceManyBody<LayoutNode>().strength(-120))
    .force("collide", forceCollide<LayoutNode>((node) => collisionRadius(node) + 4))
    .alphaDecay(0.05);

  const positions = (): Map<string, { x: number; y: number }> => {
    const snapshot = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      snapshot.set(node.id, {
        x: coordinate(node.x, centre.x),
        y: coordinate(node.y, centre.y),
      });
    }
    return snapshot;
  };

  return { simulation, positions };
}

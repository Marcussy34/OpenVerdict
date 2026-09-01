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
  /** Pentagon slot a juror is softly anchored to (angle AND radius). */
  homeX?: number;
  homeY?: number;
};

type LayoutLink = SimulationLinkDatum<LayoutNode>;

function coordinate(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function collisionRadius(node: LayoutNode): number {
  if (node.kind === "juror") return 26;
  // The genesis circle plus the statement label under it need breathing room.
  if (node.kind === "claim") return 62;
  return 14;
}

export function createSimulation(
  graph: DeliberationGraph,
  size: { width: number; height: number },
): {
  simulation: Simulation<LayoutNode, LayoutLink>;
  positions: () => Map<string, { x: number; y: number }>;
} {
  const centre = { x: size.width / 2, y: size.height / 2 };
  const radialRadius = Math.min(size.width, size.height) / 3.2;
  const jurorCount = graph.nodes.filter((node) => node.kind === "juror").length;
  let jurorIndex = 0;
  // Ring slots first: a seat's committee index fixes its angle, so jurors
  // spawn evenly spaced even when they appear one by one. One round makes a
  // pentagon; once round-2 seats exist, round-1 keeps its five angles on the
  // even spokes of a decagon and round-2 interleaves on the odd spokes, so
  // escalation never piles two seats onto the same slot.
  const twoRounds = graph.nodes.some(
    (node) => node.kind === "juror" && (node.seatIndex ?? 0) >= 5,
  );
  const jurorHomes = new Map<string, { x: number; y: number; angle: number }>();
  for (const node of graph.nodes) {
    if (node.kind !== "juror" || jurorCount === 0) continue;
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
      x: centre.x + Math.cos(angle) * radialRadius,
      y: centre.y + Math.sin(angle) * radialRadius,
      angle,
    });
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
  const trailHomes = new Map<string, { x: number; y: number }>();
  const trailDepth = new Map<string, number>();
  const maxExtra = Math.max(90, Math.min(size.width, size.height) / 2 - radialRadius - 48);
  for (const [jurorId, home] of jurorHomes) {
    const queue: Array<{ id: string; depth: number }> = [{ id: jurorId, depth: 0 }];
    const seen = new Set<string>([jurorId]);
    for (let head = 0; head < queue.length; head += 1) {
      const item = queue[head];
      if (item === undefined) continue;
      const { id, depth } = item;
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const kind = kindById.get(next);
        // The claim and certificate are shared anchors, never trail nodes.
        if (kind === "claim" || kind === "certificate" || kind === "juror") continue;
        const depthNext = depth + 1;
        const known = trailDepth.get(next);
        if (known === undefined || depthNext < known) {
          trailDepth.set(next, depthNext);
          const distance = Math.min(depthNext * 58, maxExtra);
          trailHomes.set(next, {
            x: home.x + Math.cos(home.angle) * distance,
            y: home.y + Math.sin(home.angle) * distance,
          });
        }
        queue.push({ id: next, depth: depthNext });
      }
    }
  }

  const nodes: LayoutNode[] = graph.nodes.map((node) => {
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
        x: trailHome.x,
        y: trailHome.y,
        homeX: trailHome.x,
        homeY: trailHome.y,
      };
    }
    return { id: node.id, kind: node.kind };
  });

  // Jurors hold the pentagon firmly; trail nodes are tugged toward their ray
  // homes just hard enough to stay on their own juror's side.
  const homeStrength = (node: LayoutNode): number => {
    if (node.homeX === undefined || node.homeY === undefined) return 0;
    return node.kind === "juror" ? 0.3 : 0.14;
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
      case "seat": return radialRadius;
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
        .strength((link) => link.kind === "seat" ? 0.9 : 0.5),
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

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
  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    if (node.kind === "claim") {
      return { id: node.id, kind: node.kind, fx: centre.x, fy: centre.y };
    }
    if (node.kind === "juror" && jurorCount > 0) {
      // Stable pentagon slots: a seat's committee index fixes its angle, so
      // five jurors spawn evenly spaced even when they appear one by one.
      const slot = node.seatIndex ?? jurorIndex;
      const slots = node.seatIndex === undefined ? jurorCount : 5;
      const angle = ((slot % slots) / slots) * Math.PI * 2 - Math.PI / 2;
      jurorIndex += 1;
      const homeX = centre.x + Math.cos(angle) * radialRadius;
      const homeY = centre.y + Math.sin(angle) * radialRadius;
      return {
        id: node.id,
        kind: node.kind,
        seatIndex: node.seatIndex,
        x: homeX,
        y: homeY,
        homeX,
        homeY,
      };
    }
    return { id: node.id, kind: node.kind };
  });
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
    // Zero strength keeps non-juror nodes free to form linked clusters; a
    // juror is pulled toward its OWN pentagon slot, so the full-graph
    // equilibrium keeps the even 72-degree spacing the spawn promises.
    .force(
      "juror-home-x",
      forceX<LayoutNode>((node) => node.homeX ?? centre.x)
        .strength((node) => node.kind === "juror" && node.homeX !== undefined ? 0.3 : 0),
    )
    .force(
      "juror-home-y",
      forceY<LayoutNode>((node) => node.homeY ?? centre.y)
        .strength((node) => node.kind === "juror" && node.homeY !== undefined ? 0.3 : 0),
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

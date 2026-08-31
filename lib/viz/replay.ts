import type { DeliberationGraph } from "./deliberation-graph";

export function graphSpan(
  graph: DeliberationGraph,
): { startMs: number; endMs: number } {
  if (graph.nodes.length === 0) return { startMs: 0, endMs: 0 };

  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const node of graph.nodes) {
    startMs = Math.min(startMs, node.atMs);
    endMs = Math.max(endMs, node.atMs);
  }

  return { startMs, endMs };
}

export function visibleAt(
  graph: DeliberationGraph,
  t: number,
): DeliberationGraph {
  const nodes = graph.nodes.filter((node) => node.atMs <= t);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );

  return { nodes, edges };
}

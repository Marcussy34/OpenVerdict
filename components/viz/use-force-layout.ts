"use client";

import { useEffect, useRef, useState } from "react";

import type { DeliberationGraph } from "@/lib/viz/deliberation-graph";
import { createSimulation } from "@/lib/viz/force-layout";

type Position = { x: number; y: number };

function nodeSetKey(graph: DeliberationGraph): string {
  return JSON.stringify(graph.nodes.map((node) => node.id).sort());
}

function topologyKey(graph: DeliberationGraph): string {
  return JSON.stringify({
    nodes: graph.nodes.map((node) => [node.id, node.kind]).sort(),
    edges: graph.edges.map((edge) => [edge.from, edge.to]).sort(),
  });
}

export function useForceLayout(
  graph: DeliberationGraph,
  size: { width: number; height: number },
): Map<string, Position> {
  const [positions, setPositions] = useState<Map<string, Position>>(
    () => new Map(),
  );
  const graphRef = useRef(graph);
  const positionsRef = useRef(positions);
  const previousNodeSetRef = useRef<string | null>(null);
  const nodesKey = nodeSetKey(graph);
  const graphTopologyKey = topologyKey(graph);
  const { width, height } = size;

  // Refs may not be written during render (React Compiler rule); this effect
  // runs before the layout effect below in the same commit, so the layout
  // always sees the latest graph.
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    const currentGraph = graphRef.current;
    const layout = createSimulation(currentGraph, { width, height });
    let frameId: number | null = null;

    // Keep established nodes in place while a changed topology settles.
    for (const node of layout.simulation.nodes()) {
      if (node.kind === "claim") continue;
      const previous = positionsRef.current.get(node.id);
      if (previous === undefined) continue;
      node.x = previous.x;
      node.y = previous.y;
    }

    const publish = (): void => {
      frameId = null;
      const next = layout.positions();
      positionsRef.current = next;
      setPositions(next);
    };
    const schedulePublish = (): void => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(publish);
    };

    layout.simulation.on("tick.react", schedulePublish);
    schedulePublish();

    if (
      previousNodeSetRef.current !== null
      && previousNodeSetRef.current !== nodesKey
    ) {
      layout.simulation.alpha(0.6).restart();
    }
    previousNodeSetRef.current = nodesKey;

    return () => {
      layout.simulation.on("tick.react", null);
      layout.simulation.stop();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [graphTopologyKey, height, nodesKey, width]);

  return positions;
}

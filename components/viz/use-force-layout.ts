"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DeliberationGraph } from "@/lib/viz/deliberation-graph";
import { createSimulation } from "@/lib/viz/force-layout";

type Position = { x: number; y: number };

type DragControls = {
  /** Heat the simulation and pin the node at its current spot. */
  startDrag: (id: string) => void;
  /** Move the pinned node to graph coordinates (already unscaled). */
  dragTo: (id: string, x: number, y: number) => void;
  /** Cool the simulation and REMEMBER the drop: the node stays there. */
  endDrag: (id: string) => void;
  /** Hand a dropped node back to the simulation (a double-click does this). */
  releaseNode: (id: string) => void;
};

/**
 * Where the reader dropped things, per claim, for as long as the tab lives.
 * This cannot be component state: the Graph view unmounts every time the
 * reader flips to Chat, and a seat dropped somewhere has to still be there
 * when they come back (owner, 2026-09-05: "if I move it, it is going to stay
 * there"). Only the page session: a reload starts clean.
 */
const PINNED_BY_CLAIM = new Map<string, Map<string, Position>>();
const SCOPE_LIMIT = 12;

/** The claim a graph belongs to, so one claim's pins never reach another's. */
export function claimScopeKey(graph: DeliberationGraph): string {
  const claimId = graph.nodes.find((node) => node.kind === "claim")
    ?.detail?.["claimId"];
  return typeof claimId === "string" ? claimId : "claim";
}

function pinnedFor(scope: string): Map<string, Position> {
  const known = PINNED_BY_CLAIM.get(scope);
  if (known !== undefined) return known;
  // A long session across many claims keeps only the last few; the oldest
  // entry goes first.
  const oldest = PINNED_BY_CLAIM.keys().next().value;
  if (PINNED_BY_CLAIM.size >= SCOPE_LIMIT && oldest !== undefined) {
    PINNED_BY_CLAIM.delete(oldest);
  }
  const created = new Map<string, Position>();
  PINNED_BY_CLAIM.set(scope, created);
  return created;
}

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
): {
  positions: Map<string, Position>;
  /** Nodes the reader dropped, so the canvas can offer to release them. */
  pinnedIds: ReadonlySet<string>;
} & DragControls {
  const [positions, setPositions] = useState<Map<string, Position>>(
    () => new Map(),
  );
  const graphRef = useRef(graph);
  const positionsRef = useRef(positions);
  const previousNodeSetRef = useRef<string | null>(null);
  const layoutRef = useRef<ReturnType<typeof createSimulation> | null>(null);
  const nodesKey = nodeSetKey(graph);
  const graphTopologyKey = topologyKey(graph);
  const { width, height } = size;
  const scope = claimScopeKey(graph);
  const scopeRef = useRef(scope);
  // Restored on mount, then kept in step by the drag controls alone: the
  // claim page mounts this view per claim, so the scope holds for its life.
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () => new Set(PINNED_BY_CLAIM.get(scope)?.keys() ?? []),
  );
  // Releasing a node has to rebuild the layout, not just unset fx/fy: the
  // dropped spot was also its research's home, so the trail only goes back
  // to the pentagon once the homes are recomputed.
  const [releaseCount, setReleaseCount] = useState(0);

  // Refs may not be written during render (React Compiler rule); this effect
  // runs before the layout effect below in the same commit, so the layout
  // always sees the latest graph.
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  // Pins belong to the claim, and the drag controls below are memoised once,
  // so they read the live scope through this ref.
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    const currentGraph = graphRef.current;
    const pinned = pinnedFor(scope);
    const layout = createSimulation(currentGraph, { width, height }, { pinned });
    layoutRef.current = layout;
    let frameId: number | null = null;

    // Keep established nodes in place while a changed topology settles. A
    // dropped node is already fixed at its own spot and must not be moved.
    for (const node of layout.simulation.nodes()) {
      if (node.kind === "claim" || pinned.has(node.id)) continue;
      const previous = positionsRef.current.get(node.id);
      if (previous === undefined) continue;
      node.x = previous.x;
      node.y = previous.y;
    }

    // A node arriving on an already-laid-out graph grows OUT of the node it
    // attaches to (seeded at a positioned neighbour plus a small nudge, then
    // pushed outward by the forces) instead of flying in from free space.
    if (positionsRef.current.size > 0) {
      const neighbours = new Map<string, string[]>();
      const connect = (from: string, to: string): void => {
        const list = neighbours.get(from);
        if (list === undefined) neighbours.set(from, [to]);
        else list.push(to);
      };
      for (const edge of currentGraph.edges) {
        connect(edge.from, edge.to);
        connect(edge.to, edge.from);
      }
      for (const node of layout.simulation.nodes()) {
        // Jurors keep their pentagon seeds; only research nodes branch out
        // of the node they attach to.
        if (node.kind === "claim" || node.kind === "juror") continue;
        if (positionsRef.current.has(node.id)) continue;
        const anchorId = (neighbours.get(node.id) ?? [])
          .find((id) => positionsRef.current.has(id));
        if (anchorId === undefined) continue;
        const anchor = positionsRef.current.get(anchorId);
        if (anchor === undefined) continue;
        node.x = anchor.x + (Math.random() - 0.5) * 24;
        node.y = anchor.y + (Math.random() - 0.5) * 24;
      }
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
      if (layoutRef.current === layout) layoutRef.current = null;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [graphTopologyKey, height, nodesKey, releaseCount, scope, width]);

  // Stable controls that always reach the live simulation through the ref.
  const controls = useMemo<DragControls>(() => {
    const nodeById = (id: string) =>
      layoutRef.current?.simulation.nodes().find((node) => node.id === id);
    return {
      startDrag: (id) => {
        const layout = layoutRef.current;
        const node = nodeById(id);
        if (layout === null || node === undefined) return;
        node.fx = node.x;
        node.fy = node.y;
        layout.simulation.alphaTarget(0.25).restart();
      },
      dragTo: (id, x, y) => {
        const node = nodeById(id);
        if (node === undefined) return;
        node.fx = x;
        node.fy = y;
      },
      endDrag: (id) => {
        layoutRef.current?.simulation.alphaTarget(0);
        const node = nodeById(id);
        if (typeof node?.fx !== "number" || typeof node.fy !== "number") return;
        // The drop STICKS: fx and fy stay set, and the spot is remembered, so
        // the next arriving research node cannot shake it loose.
        const pinned = pinnedFor(scopeRef.current);
        pinned.set(id, { x: node.fx, y: node.fy });
        setPinnedIds(new Set(pinned.keys()));
      },
      releaseNode: (id) => {
        const pinned = pinnedFor(scopeRef.current);
        if (!pinned.delete(id)) return;
        const node = nodeById(id);
        if (node !== undefined) {
          node.fx = null;
          node.fy = null;
        }
        setPinnedIds(new Set(pinned.keys()));
        setReleaseCount((count) => count + 1);
      },
    };
  }, []);

  return { positions, pinnedIds, ...controls };
}

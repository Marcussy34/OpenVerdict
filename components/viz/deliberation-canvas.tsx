"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  CloseCircle,
  DocumentText,
  Lock,
  SearchNormal1,
  ShieldSearch,
  ShieldTick,
  TickCircle,
} from "@/components/icons";
import { ModelLogo, type LogoFamily } from "@/components/viz/model-logo";
import { cn } from "@/lib/utils";
import type {
  DeliberationGraph,
  GraphNode,
  JurorFamily,
} from "@/lib/viz/deliberation-graph";
import { useForceLayout } from "./use-force-layout";

type Position = { x: number; y: number };
type Viewport = { x: number; y: number; scale: number };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

const FAMILY_STYLE: Record<JurorFamily, {
  disc: string;
  initial: string;
  ring: string;
}> = {
  deepseek: {
    disc: "bg-family-a text-white",
    initial: "D",
    ring: "ring-family-a",
  },
  kimi: {
    disc: "bg-family-b text-white",
    initial: "K",
    ring: "ring-family-b",
  },
  minimax: {
    disc: "bg-family-c text-white",
    initial: "M",
    ring: "ring-family-c",
  },
  unknown: {
    disc: "bg-surface text-muted-foreground",
    initial: "?",
    ring: "ring-border",
  },
};

// The same semantic chips the Live view uses: a tinted ground, a hairline and
// the signal colour, all straight from the tokens.
const OUTCOME_STYLE = {
  YES: "border border-yes/35 bg-yes/10 text-yes",
  NO: "border border-no/35 bg-no/10 text-no",
  UNSURE: "border border-unsure/35 bg-unsure/12 text-unsure",
} as const;
const NODE_ENTRY_DURATION_SECONDS = 0.24;
const NODE_ENTRY_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1];

function labelAtMost(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

/** Short public identifier shown under each juror node, e.g. 0x5fa1d2cd…6b12. */
function shortSeatId(seatId: string | undefined): string | undefined {
  if (seatId === undefined) return undefined;
  return seatId.length <= 14 ? seatId : `${seatId.slice(0, 8)}…${seatId.slice(-4)}`;
}

function clampScale(value: number): number {
  return Math.min(2.5, Math.max(0.4, value));
}

function outgoingSubtree(
  startId: string,
  graph: DeliberationGraph,
): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }

  const visited = new Set([startId]);
  const pending = [startId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) continue;
    for (const target of outgoing.get(current) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      pending.push(target);
    }
  }
  return visited;
}

// Edge palette: the wires carry meaning too, drawn as muted ink on paper.
// Citations take the verdict green, juror actions the brand blue, search
// results a quiet grey.
type EdgeStyle = { stroke: string; lo: number; hi: number; width: number };
const DEFAULT_EDGE_STYLE: EdgeStyle = { stroke: "#0b1b28", lo: 0.16, hi: 0.4, width: 1 };
const EDGE_STYLE: Record<string, EdgeStyle> = {
  round: { stroke: "#5145cd", lo: 0.3, hi: 0.65, width: 1.4 },
  citation: { stroke: "#0e7a4b", lo: 0.32, hi: 0.7, width: 1.4 },
  action: { stroke: "#0a5ccc", lo: 0.22, hi: 0.55, width: 1 },
  result: { stroke: "#5a6b7e", lo: 0.2, hi: 0.5, width: 1 },
};

function nodeClassName(node: GraphNode, selected: boolean): string {
  const selectedRing = selected ? "ring-2 ring-sea" : undefined;

  switch (node.kind) {
    case "claim":
      return cn(
        "size-[92px] rounded-full border border-sea/40 bg-card text-foreground",
        selectedRing,
      );
    case "juror": {
      const family = node.family ?? "unknown";
      return cn(
        // A satellite is the SAME agent serving round 2: a smaller disc, so
        // the agent's identity stays with its round-1 node on the ring.
        node.satellite === true ? "size-10" : "size-14",
        // The avatar sits on a white tile, so a photo keeps its own edge.
        "rounded-full bg-card ring-2",
        selected ? "ring-sea" : FAMILY_STYLE[family].ring,
        node.state === "sealed" && "opacity-80",
      );
    }
    case "sealedAction": {
      // Content stays redacted until reveal, but the KIND is public metadata:
      // tint plus dashed border say "sealed search" vs "sealed page" at a glance.
      const kind = typeof node.detail?.kind === "string" ? node.detail.kind : undefined;
      return cn(
        "size-[22px] rounded-md border border-dashed border-foreground/25 text-muted-foreground",
        kind === "search" ? "bg-sea/12" : kind === "open" ? "bg-surface-2" : "bg-surface",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    }
    case "search":
      return cn(
        "size-[26px] rounded-full border border-chain/30 bg-sea/12 text-chain",
        "after:absolute after:-inset-2.5 after:content-['']",
        node.intent === "challenge" && "border-unsure/35 bg-unsure/15 text-unsure",
        selectedRing,
      );
    case "page":
      return cn(
        "size-6 rounded-md border border-border bg-surface text-muted-foreground",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "verdict": {
      const outcome = node.outcome ?? "UNSURE";
      return cn(
        "size-11 rounded-xl",
        OUTCOME_STYLE[outcome],
        selectedRing,
      );
    }
    case "failure":
      return cn(
        "size-[30px] rounded-md border border-no/35 bg-no/10 text-no",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "certificate":
      return cn(
        "size-16 rounded-2xl border border-yes/40 bg-yes/10 text-yes",
        selectedRing,
      );
  }
}

/** The graph speaks JurorFamily; the logo speaks its own key. */
function logoFamilyOf(family: JurorFamily | undefined): LogoFamily {
  return family === undefined || family === "unknown" ? "other" : family;
}

/**
 * Tint index per juror node: its position among the nodes of the same model
 * family, in seat order, so two seats of one model never wear the same tone.
 */
function variantsByNode(graph: DeliberationGraph): Map<string, number> {
  const jurors = graph.nodes
    .filter((node) => node.kind === "juror")
    .sort((left, right) => (left.seatIndex ?? 0) - (right.seatIndex ?? 0));
  const seen = new Map<string, number>();
  const variants = new Map<string, number>();
  for (const node of jurors) {
    const key = logoFamilyOf(node.family);
    const next = seen.get(key) ?? 0;
    variants.set(node.id, next);
    seen.set(key, next + 1);
  }
  return variants;
}

function JurorContent({
  node,
  variant,
  verdict,
  reduceMotion,
}: {
  node: GraphNode;
  variant: number;
  verdict?: GraphNode;
  reduceMotion: boolean;
}) {
  const outcome = node.outcome ?? verdict?.outcome;
  const confidenceBps = node.confidenceBps ?? verdict?.confidenceBps;
  const seatTag = shortSeatId(node.seatId);

  return (
    <>
      {node.state === "failed" ? (
        <span
          aria-hidden
          className={cn(
            "absolute -inset-1 rounded-full border border-no/70",
            !reduceMotion && "animate-ping",
          )}
        />
      ) : null}
      <ModelLogo
        family={logoFamilyOf(node.family)}
        variant={variant}
        size={node.satellite === true ? 40 : 56}
        round
        className="size-full border-0"
      />
      {(node.seatIndex ?? 0) >= 5 ? (
        // Round-2 seats joined at escalation; the tag separates them from
        // the round-1 panel at a glance.
        <span className="absolute -top-1 -left-1 rounded-full bg-card px-1 py-px text-[8px] font-extrabold tracking-wide text-sealed ring-1 ring-sealed/40">
          R2
        </span>
      ) : null}
      {node.state === "sealed" ? (
        <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-card text-sealed ring-1 ring-border">
          <Lock size="11" variant="Bold" />
        </span>
      ) : null}
      {node.state === "failed" ? (
        <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-card text-no ring-1 ring-border">
          <CloseCircle size="13" variant="Bold" />
        </span>
      ) : null}
      <span className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 flex w-36 -translate-x-1/2 flex-col items-center gap-1">
        {node.state === "revealed" && outcome !== undefined ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums",
              OUTCOME_STYLE[outcome],
            )}
          >
            {outcome}
            {confidenceBps === undefined ? null : ` · ${confidenceBps} bps`}
          </span>
        ) : null}
        {seatTag === undefined ? null : (
          <span className="rounded-full bg-card/85 px-2 py-0.5 font-mono text-[9px] font-medium tracking-tight text-muted-foreground ring-1 ring-border">
            {seatTag}
          </span>
        )}
      </span>
    </>
  );
}

function nodeContent(
  node: GraphNode,
  options: {
    variant: number;
    cited: boolean;
    jurorVerdict?: GraphNode;
    reduceMotion: boolean;
  },
): ReactNode {
  switch (node.kind) {
    case "claim":
      return (
        <>
          <span className="grid size-12 place-items-center rounded-full bg-[#0e76ff] text-white">
            <ShieldSearch size="26" variant="Bold" />
          </span>
          <span className="pointer-events-none absolute top-[calc(100%+10px)] left-1/2 w-64 -translate-x-1/2 text-center">
            <span className="ov-micro ov-micro-sm text-muted-foreground">
              Claim on trial
            </span>
            <span className="mt-1 block text-[13px] leading-snug font-medium break-words text-foreground">
              {labelAtMost(node.label, 300)}
            </span>
          </span>
        </>
      );
    case "juror":
      return (
        <JurorContent
          node={node}
          variant={options.variant}
          verdict={options.jurorVerdict}
          reduceMotion={options.reduceMotion}
        />
      );
    case "sealedAction": {
      // Kind glyph instead of an anonymous padlock; the inspector still
      // explains why the content itself stays sealed until reveal.
      const kind = typeof node.detail?.kind === "string" ? node.detail.kind : undefined;
      if (kind === "search") return <SearchNormal1 size="12" variant="Bold" />;
      if (kind === "open") return <DocumentText size="12" variant="Bold" />;
      return <Lock size="12" variant="Bold" />;
    }
    case "search":
      return (
        <>
          <SearchNormal1 size="13" variant="Bold" />
          <span className="pointer-events-none absolute top-[calc(100%+5px)] left-1/2 w-28 -translate-x-1/2 truncate text-center text-[10px] font-medium text-muted-foreground">
            {node.label}
          </span>
        </>
      );
    case "page":
      return (
        <>
          <DocumentText size="13" variant="Bold" />
          {options.cited ? (
            <span className="absolute -right-1 -bottom-1 text-yes">
              <TickCircle size="10" variant="Bold" />
            </span>
          ) : null}
        </>
      );
    case "verdict": {
      const outcome = node.outcome ?? "UNSURE";
      return (
        <span className="flex flex-col items-center leading-none">
          <span className="text-[9px] font-bold">{outcome}</span>
          <span className="mt-1 text-[8px] font-semibold tabular-nums opacity-90">
            {node.confidenceBps === undefined
              ? "N/A"
              : `${node.confidenceBps} bps`}
          </span>
        </span>
      );
    }
    case "failure":
      return (
        <>
          <CloseCircle size="16" variant="Bold" />
          <span className="pointer-events-none absolute top-[calc(100%+5px)] left-1/2 w-28 -translate-x-1/2 truncate text-center text-[9px] font-semibold text-no">
            {node.label}
          </span>
        </>
      );
    case "certificate":
      return (
        <span className="flex flex-col items-center gap-1">
          <ShieldTick size="24" variant="Bold" />
          <span className="text-[9px] font-semibold">Certificate</span>
        </span>
      );
  }
}

function CanvasNode({
  node,
  position,
  selected,
  highlighted,
  highlightActive,
  variant,
  cited,
  jurorVerdict,
  reduceMotion,
  viewScale,
  onSelect,
  onJurorHover,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  node: GraphNode;
  position: Position;
  selected: boolean;
  highlighted: boolean;
  highlightActive: boolean;
  variant: number;
  cited: boolean;
  jurorVerdict?: GraphNode;
  reduceMotion: boolean;
  viewScale: number;
  onSelect: (node: GraphNode) => void;
  onJurorHover: (id: string | null) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
}) {
  // A short press selects; moving past 4px hands the node to the simulation.
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  return (
    <div
      className="absolute top-0 left-0"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="-translate-x-1/2 -translate-y-1/2">
        <div
          className={cn(
            "relative",
            !reduceMotion && "transition-[opacity,transform] duration-100 ease-out",
            highlightActive && !highlighted && "opacity-60",
            highlightActive && highlighted && !reduceMotion && "scale-105",
          )}
        >
          <motion.button
            type="button"
            aria-label={`Select ${node.kind}: ${node.label}`}
            className={cn(
              "relative grid cursor-grab place-items-center focus-visible:outline-none active:cursor-grabbing",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "focus-visible:ring-offset-background",
              nodeClassName(node, selected),
            )}
            initial={reduceMotion ? false : { scale: 0 }}
            animate={reduceMotion ? undefined : { scale: 1 }}
            transition={reduceMotion ? undefined : {
              duration: NODE_ENTRY_DURATION_SECONDS,
              ease: NODE_ENTRY_EASE,
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onSelect(node);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                originX: position.x,
                originY: position.y,
                moved: false,
              };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) return;
              const clientDeltaX = event.clientX - drag.startClientX;
              const clientDeltaY = event.clientY - drag.startClientY;
              if (!drag.moved && Math.hypot(clientDeltaX, clientDeltaY) > 4) {
                drag.moved = true;
                onDragStart(node.id);
              }
              if (drag.moved) {
                onDrag(
                  node.id,
                  drag.originX + clientDeltaX / viewScale,
                  drag.originY + clientDeltaY / viewScale,
                );
              }
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) return;
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (drag.moved) {
                suppressClickRef.current = true;
                onDragEnd(node.id);
              }
            }}
            onPointerCancel={(event) => {
              const drag = dragRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) return;
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (drag.moved) onDragEnd(node.id);
            }}
            onMouseEnter={() => {
              if (node.kind === "juror") onJurorHover(node.id);
            }}
            onMouseLeave={() => {
              if (node.kind === "juror") onJurorHover(null);
            }}
          >
            {nodeContent(node, {
              variant,
              cited,
              jurorVerdict,
              reduceMotion,
            })}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

export function DeliberationCanvas({
  graph,
  selectedId,
  onSelect,
  externalHighlightId,
  reducedMotion,
}: {
  graph: DeliberationGraph;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  /** A node id lit from outside the canvas (the inspector's research trail). */
  externalHighlightId?: string | null;
  reducedMotion?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const systemReducedMotion = useReducedMotion();
  const shouldReduceMotion = reducedMotion === true || systemReducedMotion === true;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [manualView, setManualView] = useState<Viewport | null>(null);
  const [hoveredJurorId, setHoveredJurorId] = useState<string | null>(null);
  const { positions, startDrag, dragTo, endDrag } = useForceLayout(graph, size);

  // Frame the whole graph with padding until the user takes the view over
  // (pan or zoom); until then the bloom keeps itself in frame automatically.
  const fittedView = useMemo<Viewport>(() => {
    if (size.width === 0 || size.height === 0 || positions.size === 0) {
      return { x: 0, y: 0, scale: 1 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of positions.values()) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    const pad = 140;
    const spanX = Math.max(1, maxX - minX + pad * 2);
    const spanY = Math.max(1, maxY - minY + pad * 2);
    const scale = clampScale(Math.min(size.width / spanX, size.height / spanY, 1));
    return {
      scale,
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [positions, size.height, size.width]);
  const view = manualView ?? fittedView;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    // Force coordinates track the canvas content box in whole CSS pixels.
    const updateSize = (width: number, height: number): void => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const rect = container.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const nodesById = useMemo(
    () => new Map(
      graph.nodes.map((node): [string, GraphNode] => [node.id, node]),
    ),
    [graph.nodes],
  );
  // Tints are stable per claim: the same seat keeps its tone across renders.
  const nodeVariants = useMemo(() => variantsByNode(graph), [graph]);

  const verdictBySeat = useMemo(() => {
    const verdicts = new Map<string, GraphNode>();
    for (const node of graph.nodes) {
      if (node.kind === "verdict" && node.seatId !== undefined) {
        verdicts.set(node.seatId, node);
      }
    }
    return verdicts;
  }, [graph.nodes]);
  const citedPageIds = useMemo(
    () => new Set(
      graph.edges
        .filter((edge) => edge.kind === "citation")
        .map((edge) => edge.from),
    ),
    [graph.edges],
  );
  const highlightedIds = useMemo(() => {
    // A local juror hover wins; otherwise an external source (the research
    // trail in the inspector) can light a branch from outside the canvas.
    const root = hoveredJurorId ?? externalHighlightId ?? null;
    if (root === null || !nodesById.has(root)) return null;
    return outgoingSubtree(root, graph);
  }, [externalHighlightId, graph, hoveredJurorId, nodesById]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || dragRef.current !== null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
        moved: false,
      };
    },
    [view.x, view.y],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.hypot(deltaX, deltaY) > 3) drag.moved = true;
      setManualView({
        x: drag.originX + deltaX,
        y: drag.originY + deltaY,
        scale: view.scale,
      });
    },
    [view.scale],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!drag.moved) onSelect(null);
    },
    [onSelect],
  );

  const cancelPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  // Dragging a node freezes the auto-fit at its current framing, otherwise
  // the view would keep re-centring against the user's hand.
  const handleNodeDragStart = useCallback((id: string): void => {
    setManualView((current) => current ?? view);
    startDrag(id);
  }, [startDrag, view]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const nextScale = clampScale(view.scale * Math.exp(-event.deltaY * 0.001));
    // Keep the graph coordinate under the pointer fixed while zooming.
    const graphX = (pointerX - view.x) / view.scale;
    const graphY = (pointerY - view.y) / view.scale;
    setManualView({
      scale: nextScale,
      x: pointerX - graphX * nextScale,
      y: pointerY - graphY * nextScale,
    });
  }, [view]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Deliberation graph canvas"
      className="relative h-full w-full touch-none cursor-grab overflow-hidden bg-background select-none active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onWheel={handleWheel}
    >
      {/* Ground texture: a barely-there hairline dot lattice on the same paper
          the rest of the page is printed on. No washes, no vignette. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgb(0 0 0 / 7%) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          // A plain 2D transform: promoted 3d layers rasterize once and then
          // rescale as textures, which is what made the canvas look blurry.
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {/* Edges and nodes share one viewport transform. */}
        {/* overflow-visible is load-bearing: an svg clips to its own box by
            default, and graph coordinates routinely extend past the viewport
            rectangle once the view is fitted, which silently erased every
            edge whose endpoints sat outside it. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          {graph.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (from === undefined || to === undefined) return null;
            const highlighted = highlightedIds !== null
              && (highlightedIds.has(edge.from) || highlightedIds.has(edge.to));
            const style = EDGE_STYLE[edge.kind] ?? DEFAULT_EDGE_STYLE;
            return (
              <line
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={style.stroke}
                strokeOpacity={highlighted ? style.hi : style.lo}
                strokeWidth={style.width}
              />
            );
          })}
        </svg>

        {graph.nodes.map((node) => {
          const position = positions.get(node.id);
          if (position === undefined) return null;
          const nodeHighlighted = highlightedIds?.has(node.id) ?? false;
          const cited = node.detail?.cited === true || citedPageIds.has(node.id);
          return (
            <CanvasNode
              key={node.id}
              node={node}
              position={position}
              selected={selectedId === node.id}
              highlighted={nodeHighlighted}
              highlightActive={highlightedIds !== null}
              variant={nodeVariants.get(node.id) ?? 0}
              cited={cited}
              jurorVerdict={
                node.seatId === undefined ? undefined : verdictBySeat.get(node.seatId)
              }
              reduceMotion={shouldReduceMotion}
              viewScale={view.scale}
              onSelect={onSelect}
              onJurorHover={setHoveredJurorId}
              onDragStart={handleNodeDragStart}
              onDrag={dragTo}
              onDragEnd={endDrag}
            />
          );
        })}
      </div>
    </div>
  );
}

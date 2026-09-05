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

/** The one ink every wire and hairline on the paper ground is drawn in. */
const HAIRLINE = "#0b1b28";
// The same semantic chips the Live view uses: a tinted ground, a hairline and
// the signal colour, all straight from the tokens. These three are the only
// hues on the map, and they only ever say what the protocol decided.
// Opaque grounds (the tint mixed into white, not laid over the paper), so
// the wires never show through a vote or the certificate (owner, 2026-09-05).
const OUTCOME_STYLE = {
  YES: "border border-yes/35 bg-[color-mix(in_srgb,var(--color-yes)_10%,white)] text-yes",
  NO: "border border-no/35 bg-[color-mix(in_srgb,var(--color-no)_10%,white)] text-no",
  UNSURE: "border border-unsure/35 bg-[color-mix(in_srgb,var(--color-unsure)_12%,white)] text-unsure",
} as const;
const NODE_ENTRY_DURATION_SECONDS = 0.24;
const NODE_ENTRY_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1];

/** Confidence in whole percent, the way the dock and the Live view say it. */
function confidencePercent(confidenceBps: number | undefined): string | undefined {
  return confidenceBps === undefined || !Number.isFinite(confidenceBps)
    ? undefined
    : `${Math.round(confidenceBps / 100)}%`;
}

/** The outcome a settled certificate carries; UNSURE reads as the neutral. */
function outcomeOf(node: GraphNode | undefined): keyof typeof OUTCOME_STYLE {
  const result = node?.detail?.["result"];
  return result === "YES" || result === "NO" ? result : "UNSURE";
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

// The wires carry meaning by WEIGHT and DASH, never by hue: one ink for the
// whole map, so the only colours on it stay the protocol's own.
// A citation is the heaviest line (this page is why that vote reads as it
// does), the structural links come next, a search's own result is dashed, and
// the rest of a juror's trail is the quietest.
type EdgeStyle = { lo: number; hi: number; width: number; dash?: string };
const DEFAULT_EDGE_STYLE: EdgeStyle = { lo: 0.16, hi: 0.42, width: 1 };
const EDGE_STYLE: Record<string, EdgeStyle> = {
  citation: { lo: 0.3, hi: 0.62, width: 1.4 },
  round: { lo: 0.26, hi: 0.58, width: 1.2, dash: "4 3" },
  verdict: { lo: 0.24, hi: 0.55, width: 1 },
  settle: { lo: 0.24, hi: 0.55, width: 1.2 },
  result: { lo: 0.14, hi: 0.4, width: 1, dash: "2 3" },
  action: { lo: 0.16, hi: 0.42, width: 1 },
};

function nodeClassName(node: GraphNode, selected: boolean): string {
  const selectedRing = selected ? "ring-2 ring-sea" : undefined;

  switch (node.kind) {
    case "claim":
      // The claim is never drawn: it stays in the simulation as the pinned
      // anchor the jury sits around, and nothing on the map points at it.
      return "";
    case "juror": {
      return cn(
        // A satellite is the SAME agent serving round 2: a smaller disc, so
        // the agent's identity stays with its round-1 node on the ring.
        node.satellite === true ? "size-10" : "size-14",
        // The avatar sits on a white tile, so a photo keeps its own edge.
        // The provider's tint lives inside the logo and nowhere else.
        "rounded-full bg-card ring-1 ring-border",
        node.state === "failed" && "ring-1 ring-no/50",
        node.state === "sealed" && "opacity-80",
        // Selection wins the ring over every other state.
        selected && "ring-2 ring-sea",
      );
    }
    case "sealedAction":
      // Content stays redacted until reveal, but the KIND is public metadata:
      // the dashed hairline says sealed, the glyph says search or page.
      return cn(
        "size-[22px] border border-dashed border-foreground/25 bg-card text-muted-foreground",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "search":
      return cn(
        "size-[26px] rounded-full border border-border bg-card text-muted-foreground",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "page":
      return cn(
        "size-6 border border-border bg-surface text-muted-foreground",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "verdict": {
      const outcome = node.outcome ?? "UNSURE";
      return cn("size-11", OUTCOME_STYLE[outcome], selectedRing);
    }
    case "failure":
      return cn(
        "size-[30px] border border-no/35 bg-[color-mix(in_srgb,var(--color-no)_10%,white)] text-no",
        "after:absolute after:-inset-2.5 after:content-['']",
        selectedRing,
      );
    case "certificate":
      // The certificate wears the claim's own outcome, the one place a
      // settled result is a colour.
      return cn("size-16", OUTCOME_STYLE[outcomeOf(node)], selectedRing);
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
  number,
  variant,
  verdict,
  reduceMotion,
}: {
  node: GraphNode;
  /** 1-based juror number, the same one the Live view and the dock print. */
  number: number;
  variant: number;
  verdict?: GraphNode;
  reduceMotion: boolean;
}) {
  const outcome = node.outcome ?? verdict?.outcome;
  const percent = confidencePercent(node.confidenceBps ?? verdict?.confidenceBps);
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
      {/* The juror number the Live view and the deliberation dock use, so a
          turn that names juror 3 finds juror 3 on the map. Both of an
          agent's seats carry the same number. */}
      <span className="absolute -top-0.5 -left-0.5 grid size-[15px] place-items-center rounded-full border border-border bg-card font-mono text-[9px] font-semibold text-muted-foreground tabular-nums">
        {number}
      </span>
      {(node.seatIndex ?? 0) >= 5 ? (
        // Round-2 seats joined at escalation; the tag separates them from
        // the round-1 panel at a glance.
        <span className="absolute -bottom-1 -left-1 rounded-full border border-border bg-card px-1 py-px font-mono text-[8px] font-bold text-muted-foreground">
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
              "px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums",
              OUTCOME_STYLE[outcome],
            )}
          >
            {outcome}
            {percent === undefined ? null : ` · ${percent}`}
          </span>
        ) : null}
        {seatTag === undefined ? null : (
          <span className="bg-card/85 px-2 py-0.5 font-mono text-[9px] font-medium tracking-tight text-muted-foreground ring-1 ring-border">
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
    number: number;
    variant: number;
    cited: boolean;
    jurorVerdict?: GraphNode;
    reduceMotion: boolean;
  },
): ReactNode {
  switch (node.kind) {
    case "claim":
      // Never rendered: the claim is the invisible anchor, not a place.
      return null;
    case "juror":
      return (
        <JurorContent
          node={node}
          number={options.number}
          variant={options.variant}
          {...(options.jurorVerdict === undefined
            ? {}
            : { verdict: options.jurorVerdict })}
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
            // A cited page: the tick is ink, and the heavier wire to the
            // vote is what says this page carried it.
            <span className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-card text-foreground/70 ring-1 ring-border">
              <TickCircle size="10" variant="Bold" />
            </span>
          ) : null}
        </>
      );
    case "verdict": {
      const outcome = node.outcome ?? "UNSURE";
      const percent = confidencePercent(node.confidenceBps);
      return (
        <span className="flex flex-col items-center leading-none">
          <span className="text-[9px] font-bold">{outcome}</span>
          <span className="mt-1 text-[8px] font-semibold tabular-nums opacity-90">
            {percent ?? "N/A"}
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
  number,
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
  number: number;
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
              number,
              variant,
              cited,
              ...(jurorVerdict === undefined ? {} : { jurorVerdict }),
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
  seatNumbers,
}: {
  graph: DeliberationGraph;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  /** A node id lit from outside the canvas (the inspector's research trail). */
  externalHighlightId?: string | null;
  reducedMotion?: boolean;
  /** Juror numbers from the Live view, keyed by jury seat id. */
  seatNumbers?: ReadonlyMap<string, number>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const systemReducedMotion = useReducedMotion();
  const shouldReduceMotion = reducedMotion === true || systemReducedMotion === true;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dockInset, setDockInset] = useState(0);
  const [manualView, setManualView] = useState<Viewport | null>(null);
  const [hoveredJurorId, setHoveredJurorId] = useState<string | null>(null);

  // The room the picture is FRAMED into: the stage minus the strip the debate
  // dock covers, so the cloud always sits above the conversation.
  const stage = useMemo(
    () => ({ width: size.width, height: Math.max(200, size.height - dockInset) }),
    [dockInset, size.height, size.width],
  );
  // The whole graph goes to the simulation, claim included: the claim is what
  // holds the jury in a ring around an empty middle. Only the drawing skips it.
  // It is laid out in the framed room, so the ring is shaped for the space it
  // will be read in rather than fitted down into it afterwards.
  const { positions, startDrag, dragTo, endDrag } = useForceLayout(graph, stage);

  // The claim itself is not a place on the map (owner, 2026-09-04): it is not
  // drawn, not labelled, not selectable, and its seat spokes are not drawn.
  // It stays in the layout as an invisible anchor pinned at the centre, so the
  // jurors keep their even ring and the cloud stays one connected piece.
  const hiddenIds = useMemo(
    () => new Set(
      graph.nodes.filter((node) => node.kind === "claim").map((node) => node.id),
    ),
    [graph.nodes],
  );
  const drawnNodes = useMemo(
    () => graph.nodes.filter((node) => !hiddenIds.has(node.id)),
    [graph.nodes, hiddenIds],
  );
  const drawnEdges = useMemo(
    () => graph.edges.filter(
      (edge) => !hiddenIds.has(edge.from) && !hiddenIds.has(edge.to),
    ),
    [graph.edges, hiddenIds],
  );

  // The debate dock floats over the bottom of the same stage, so the graph
  // frames itself into the room above whatever the dock currently covers.
  // Any following sibling that spans the stage counts: the dock does, the
  // mobile corner buttons do not, and a hidden node measures zero.
  useEffect(() => {
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (container === null || parent === null || parent === undefined) return;

    const measure = (): void => {
      const box = container.getBoundingClientRect();
      if (box.height === 0) return;
      let covered = 0;
      for (let node = container.nextElementSibling; node !== null; node = node.nextElementSibling) {
        const panel = node.getBoundingClientRect();
        if (panel.height === 0 || panel.width < box.width * 0.6) continue;
        covered = Math.max(covered, box.bottom - panel.top);
      }
      // Rounded UP to a coarse step: the strip is never smaller than the dock
      // really is, and a dock that grows by a line does not re-run the whole
      // simulation. Only opening, closing or a real jump in the conversation
      // moves the graph's box.
      const step = 48;
      const reserved = Math.ceil(Math.max(0, covered) / step) * step;
      const next = Math.min(reserved, Math.round(box.height * 0.7));
      setDockInset((current) => (current === next ? current : next));
    };

    const sizes = new ResizeObserver(measure);
    const watch = (): void => {
      sizes.disconnect();
      sizes.observe(container);
      for (let node = container.nextElementSibling; node !== null; node = node.nextElementSibling) {
        sizes.observe(node);
      }
      measure();
    };
    watch();
    // The dock mounts with the first debate turn and unmounts with the view.
    const children = new MutationObserver(watch);
    children.observe(parent, { childList: true });
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, []);

  // Frame the whole graph with padding until the user takes the view over
  // (pan or zoom); until then the cloud keeps itself in frame automatically,
  // and above the dock.
  const fittedView = useMemo<Viewport>(() => {
    if (stage.width === 0 || stage.height === 0) return { x: 0, y: 0, scale: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of drawnNodes) {
      const point = positions.get(node.id);
      if (point === undefined) continue;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    if (minX === Infinity) return { x: 0, y: 0, scale: 1 };
    // Room for what hangs off a node: a juror's vote pill and seat tag, a
    // search's query. Wider than tall, because that is how the labels hang.
    // A phone cannot spare a desktop's margin, so the room itself sets the
    // ceiling: better to clip the end of one truncated label at the edge than
    // to shrink the whole map to half size.
    const padX = Math.min(88, Math.max(28, stage.width * 0.08));
    const padY = Math.min(56, Math.max(20, stage.height * 0.08));
    const spanX = Math.max(1, maxX - minX + padX * 2);
    const spanY = Math.max(1, maxY - minY + padY * 2);
    const scale = clampScale(Math.min(stage.width / spanX, stage.height / spanY, 1));
    return {
      scale,
      x: stage.width / 2 - ((minX + maxX) / 2) * scale,
      y: stage.height / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [drawnNodes, positions, stage.height, stage.width]);
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
      drawnNodes.map((node): [string, GraphNode] => [node.id, node]),
    ),
    [drawnNodes],
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

  // The juror number the Live view prints, with the seat's own position as
  // the fallback for a record the transcript has not numbered.
  const numberOf = useCallback((node: GraphNode): number => {
    const fromLive = node.seatId === undefined
      ? undefined
      : seatNumbers?.get(node.seatId);
    return fromLive ?? (node.seatIndex ?? 0) + 1;
  }, [seatNumbers]);

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

  // Escape drops the selection and hands the stage back.
  useEffect(() => {
    if (selectedId === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect, selectedId]);

  const empty = drawnNodes.length === 0;

  return (
    // z-0 keeps the whole map in its own stacking context UNDER the debate
    // dock: a research node must never float over the conversation.
    <div
      ref={containerRef}
      role="application"
      aria-label="Deliberation graph canvas"
      className="relative z-0 h-full w-full touch-none cursor-grab overflow-hidden bg-background select-none active:cursor-grabbing"
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
          {drawnEdges.map((edge) => {
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
                stroke={HAIRLINE}
                strokeOpacity={highlighted ? style.hi : style.lo}
                strokeWidth={style.width}
                {...(style.dash === undefined ? {} : { strokeDasharray: style.dash })}
              />
            );
          })}
        </svg>

        {drawnNodes.map((node) => {
          const position = positions.get(node.id);
          if (position === undefined) return null;
          const nodeHighlighted = highlightedIds?.has(node.id) ?? false;
          const cited = node.detail?.cited === true || citedPageIds.has(node.id);
          const jurorVerdict = node.seatId === undefined
            ? undefined
            : verdictBySeat.get(node.seatId);
          return (
            <CanvasNode
              key={node.id}
              node={node}
              position={position}
              selected={selectedId === node.id}
              highlighted={nodeHighlighted}
              highlightActive={highlightedIds !== null}
              number={numberOf(node)}
              variant={nodeVariants.get(node.id) ?? 0}
              cited={cited}
              {...(jurorVerdict === undefined ? {} : { jurorVerdict })}
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

      {/* With no claim on the map, an undrawn jury would leave the stage
          blank; this is the only thing the empty stage says. */}
      {empty ? (
        <p
          className="pointer-events-none absolute left-1/2 w-64 -translate-x-1/2 text-center text-[13px] leading-snug text-muted-foreground"
          style={{ top: stage.height / 2 }}
        >
          The jury appears here the moment Sui&apos;s randomness draws it.
        </p>
      ) : null}
    </div>
  );
}

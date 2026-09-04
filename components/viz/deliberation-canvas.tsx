"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  CloseCircle,
  DocumentText,
  Link21,
  Lock,
  SearchNormal1,
  ShieldTick,
} from "@/components/icons";
import { ModelLogo, type LogoFamily } from "@/components/viz/model-logo";
import { cn } from "@/lib/utils";
import {
  buildCourtroomLayout,
  confidencePercent,
  countsLabel,
  pageDomain,
  polar,
  searchLabel,
  CERTIFICATE_ANGLE,
  type CourtroomChip,
  type CourtroomLayout,
  type CourtroomSeat,
  type CourtroomShared,
  type Point,
} from "@/lib/viz/courtroom-layout";
import type {
  DeliberationGraph,
  GraphNode,
  JurorFamily,
} from "@/lib/viz/deliberation-graph";

/** The ink every hairline on the paper ground is drawn in. */
const HAIRLINE = "#0b1b28";
/** The same semantic chips the Live view uses, straight from the tokens. */
const OUTCOME_STYLE = {
  YES: "border-yes/35 bg-yes/10 text-yes",
  NO: "border-no/35 bg-no/10 text-no",
  UNSURE: "border-unsure/35 bg-unsure/12 text-unsure",
} as const;

const ENTRY_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1];
/** How far out of the seat disc its vote stack is anchored. */
const LABEL_OFFSET = 22;

/** The outcome a settled certificate carries; UNSURE reads as the neutral. */
function outcomeOf(node: GraphNode | undefined): keyof typeof OUTCOME_STYLE {
  const result = node?.detail?.["result"];
  return result === "YES" || result === "NO" ? result : "UNSURE";
}

/** The graph speaks JurorFamily; the logo speaks its own key. */
function logoFamilyOf(family: JurorFamily | undefined): LogoFamily {
  return family === undefined || family === "unknown" ? "other" : family;
}

/**
 * Tint index per juror: its position among the seats of the same model family,
 * in ring order, so two seats holding one model never wear the same tone.
 */
function variantsBySeat(seats: readonly CourtroomSeat[]): Map<string, number> {
  const seen = new Map<string, number>();
  const variants = new Map<string, number>();
  for (const seat of seats) {
    const key = logoFamilyOf(seat.node.family);
    const next = seen.get(key) ?? 0;
    variants.set(seat.id, next);
    seen.set(key, next + 1);
  }
  return variants;
}

/** Absolute placement around a point, centred on it. */
function atPoint(point: Point): { left: number; top: number } {
  return { left: point.x, top: point.y };
}

function Positioned({
  point,
  className,
  children,
}: {
  point: Point;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("absolute -translate-x-1/2 -translate-y-1/2", className)}
      style={atPoint(point)}
    >
      {children}
    </div>
  );
}

/**
 * A label pinned to one side of the ring: it grows away from the seat along the
 * spoke, so a wide pill beside a seat at 3 o'clock never lands on the disc the
 * way a plain centred box would.
 */
function RadialLabel({
  point,
  angle,
  direction,
  className,
  children,
}: {
  point: Point;
  angle: number;
  /** "out" grows away from the claim, "in" grows toward it. */
  direction: "in" | "out";
  className?: string;
  children: React.ReactNode;
}) {
  const sign = direction === "out" ? 50 : -50;
  const shiftX = Math.sin(angle) * sign;
  const shiftY = -Math.cos(angle) * sign;
  return (
    <div
      className={cn("absolute", className)}
      style={{
        ...atPoint(point),
        transform: `translate(calc(-50% + ${shiftX.toFixed(2)}%), calc(-50% + ${shiftY.toFixed(2)}%))`,
      }}
    >
      {children}
    </div>
  );
}

/** The vote a seat carries: revealed outcome, sealed lock, or a failure. */
function VotePill({
  verdict,
  state,
  round,
  percent: showPercent,
}: {
  verdict?: GraphNode;
  state: GraphNode["state"];
  round: 1 | 2;
  /** False where the pill has no room for the confidence. */
  percent: boolean;
}) {
  const outcome = verdict?.outcome;
  const percent = confidencePercent(verdict?.confidenceBps);
  const tag = round === 2 ? (
    <span className="bg-surface-2 px-1 font-mono text-[8px] font-bold text-muted-foreground">
      R2
    </span>
  ) : null;

  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 border border-no/35 bg-no/10 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-no">
        <CloseCircle size="10" variant="Bold" />
        Failed
      </span>
    );
  }
  if (outcome === undefined) {
    // No vote to show yet: the seat is still working, or its commitment is
    // sealed and unreadable until the reveal lands.
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 border border-border bg-card px-1.5 py-0.5",
          "text-[10px] font-semibold whitespace-nowrap text-muted-foreground",
        )}
      >
        {tag}
        <Lock size="10" variant="Bold" />
        {state === "researching" || state === undefined ? "Working" : "Sealed"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums",
        OUTCOME_STYLE[outcome],
      )}
    >
      {tag}
      {outcome}
      {percent === undefined || !showPercent ? null : (
        <span className="opacity-80">{percent}</span>
      )}
    </span>
  );
}

function SeatNode({
  seat,
  layout,
  variant,
  selected,
  dimmed,
  open,
  reduceMotion,
  onSelect,
  onOpen,
  onHover,
}: {
  seat: CourtroomSeat;
  layout: CourtroomLayout;
  variant: number;
  selected: boolean;
  dimmed: boolean;
  open: boolean;
  reduceMotion: boolean;
  onSelect: (node: GraphNode) => void;
  onOpen: (seatId: string) => void;
  onHover: (seatId: string | null) => void;
}) {
  const { centre, radii, compact } = layout;
  const state = seat.node.state;
  // The slot under the vote counts what is behind the seat while the wedge is
  // shut. Once it is open the chips say it themselves, so the slot only
  // reports what the arc could not hold.
  const overflow = open && seat.hiddenChips > 0 ? `+${seat.hiddenChips} more` : undefined;
  const counts = countsLabel(seat.counts);
  const showCounts = !open && !compact && counts !== undefined;
  // Beside the seats at 3 and 9 o'clock the words run toward the edge of the
  // stage, so they only appear where the stage is wide enough to hold them.
  const spelled = layout.size.width / 2 - radii.seat >= 170;
  const labelPoint = polar(centre, radii.seat + LABEL_OFFSET, seat.angle);
  // On the upper half of the ring the stack grows upward, so the vote still
  // reads as the line nearest its seat.
  const upward = Math.cos(seat.angle) > 0;

  return (
    <div
      className={cn(
        "contents",
        !reduceMotion && "transition-opacity duration-200",
      )}
    >
      <Positioned point={seat} className={cn("z-20", dimmed && "opacity-40")}>
        <motion.button
          type="button"
          aria-label={`Juror ${seat.number}${state === undefined ? "" : `, ${state}`}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(seat.id);
            onSelect(seat.node);
          }}
          onMouseEnter={() => onHover(seat.id)}
          onMouseLeave={() => onHover(null)}
          initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.26, ease: ENTRY_EASE }}
          className={cn(
            "relative grid size-10 place-items-center rounded-full bg-card",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "focus-visible:ring-offset-background focus-visible:outline-none",
            // A generous hit area around a 40px disc, for touch.
            "after:absolute after:-inset-1 after:content-['']",
            selected && "ring-2 ring-sea ring-offset-2 ring-offset-background",
            state === "failed" && "ring-1 ring-no/50",
          )}
        >
          <ModelLogo
            family={logoFamilyOf(seat.node.family)}
            variant={variant}
            size={40}
            round
            className="size-full border"
          />
          {/* The juror number the Live view uses, on the disc itself: the
              band between the ring and the claim stays clear. */}
          <span className="absolute -top-0.5 -left-0.5 grid size-[15px] place-items-center rounded-full border border-border bg-card font-mono text-[9px] font-semibold text-muted-foreground tabular-nums">
            {seat.number}
          </span>
        </motion.button>
      </Positioned>

      {/* The vote, and under it what is behind the seat while it is shut. */}
      <RadialLabel
        point={labelPoint}
        angle={seat.angle}
        direction="out"
        className={cn(
          "pointer-events-none z-10 flex items-center gap-1",
          upward ? "flex-col-reverse" : "flex-col",
          dimmed && "opacity-40",
          // A narrow band puts the chips where the pill sits, so it stands
          // down for as long as the wedge is open.
          layout.tightBand && open && "opacity-0",
        )}
      >
        <VotePill
          {...(seat.verdict === undefined ? {} : { verdict: seat.verdict })}
          state={state}
          round={1}
          percent={!compact}
        />
        {overflow === undefined ? null : (
          <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground tabular-nums">
            {overflow}
          </span>
        )}
        {showCounts ? (
          <span
            title={counts}
            className={cn(
              "flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-muted-foreground tabular-nums",
              !reduceMotion && "transition-opacity duration-200",
            )}
          >
            {spelled ? counts : (
              <>
                <SearchNormal1 size="10" variant="Bold" />
                {seat.counts.searches}
                <DocumentText size="10" variant="Bold" className="ml-1" />
                {seat.counts.pages}
              </>
            )}
          </span>
        ) : null}
      </RadialLabel>
    </div>
  );
}

/** The round-two vote, on the same spoke between the juror and the claim. */
function RoundTwoNode({
  seat,
  room,
  selected,
  dimmed,
  reduceMotion,
  onSelect,
}: {
  seat: CourtroomSeat;
  /** Widest the inner band can hold; below a pill's worth it is a dot. */
  room: number;
  selected: boolean;
  dimmed: boolean;
  reduceMotion: boolean;
  onSelect: (node: GraphNode) => void;
}) {
  const roundTwo = seat.roundTwo;
  if (roundTwo === undefined) return null;
  const outcome = roundTwo.verdict?.outcome;
  return (
    <Positioned point={roundTwo} className={cn("z-20", dimmed && "opacity-40")}>
      <motion.button
        type="button"
        aria-label={`Juror ${seat.number}, round two${outcome === undefined ? "" : `: ${outcome}`}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(roundTwo.node);
        }}
        initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: ENTRY_EASE }}
        className={cn(
          "relative grid place-items-center focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
          "after:absolute after:-inset-3 after:content-['']",
          selected && "ring-2 ring-sea ring-offset-2 ring-offset-background",
        )}
      >
        {room < 44 ? (
          // Too little room for words: the second vote keeps its colour only.
          <span
            className={cn(
              "block size-3 rounded-full border",
              outcome === undefined
                ? "border-border bg-card"
                : OUTCOME_STYLE[outcome],
            )}
          />
        ) : (
          <VotePill
            {...(roundTwo.verdict === undefined ? {} : { verdict: roundTwo.verdict })}
            state={roundTwo.node.state}
            round={2}
            percent={room >= 76}
          />
        )}
      </motion.button>
    </Positioned>
  );
}

function ChipGlyph({ node }: { node: GraphNode }) {
  if (node.kind === "search") return <SearchNormal1 size="11" variant="Bold" />;
  if (node.kind === "page") return <DocumentText size="11" variant="Bold" />;
  const kind = typeof node.detail?.kind === "string" ? node.detail.kind : undefined;
  if (kind === "search") return <SearchNormal1 size="11" variant="Bold" />;
  if (kind === "open") return <DocumentText size="11" variant="Bold" />;
  return <Lock size="11" variant="Bold" />;
}

/** Slot width at which a search chip can carry its query as well. */
const CHIP_QUERY_WIDTH = 104;

function chipText(node: GraphNode, width = CHIP_QUERY_WIDTH): string {
  if (node.kind === "page") return pageDomain(node);
  if (node.kind === "search") return searchLabel(node, width >= CHIP_QUERY_WIDTH);
  return typeof node.detail?.kind === "string" && node.detail.kind === "search"
    ? "Sealed search"
    : "Sealed page";
}

/** One research step in a juror's wedge: a search, a page, or a sealed tick. */
function ChipNode({
  chip,
  selected,
  highlighted,
  reduceMotion,
  onSelect,
}: {
  chip: CourtroomChip;
  selected: boolean;
  highlighted: boolean;
  reduceMotion: boolean;
  onSelect: (node: GraphNode) => void;
}) {
  const sealed = chip.node.kind === "sealedAction";
  return (
    <Positioned point={chip} className="z-30">
      <motion.button
        type="button"
        aria-label={`${chipText(chip.node)}, step ${(chip.node.stepIndex ?? chip.ordinal) + 1}`}
        // A long trail drops its words for room; the pointer still gets them.
        {...(chip.labelled ? {} : { title: chipText(chip.node) })}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(chip.node);
        }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.2, delay: Math.min(chip.ordinal * 0.03, 0.3), ease: ENTRY_EASE }
        }
        style={{ width: chip.width, height: 22 }}
        className={cn(
          "relative flex items-center gap-1 border bg-card px-1",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:ring-offset-background focus-visible:outline-none",
          "after:absolute after:-inset-1.5 after:content-['']",
          sealed
            ? "border-dashed border-foreground/25 text-muted-foreground"
            : "border-border text-muted-foreground",
          (selected || highlighted) && "ring-2 ring-sea",
        )}
      >
        <span className="grid shrink-0 place-items-center">
          <ChipGlyph node={chip.node} />
        </span>
        {chip.labelled ? (
          <span className="min-w-0 flex-1 truncate text-left text-[10px] leading-none font-medium text-foreground/80">
            {chipText(chip.node, chip.width)}
          </span>
        ) : null}
        {chip.sharedBy === undefined ? null : (
          <span
            className="absolute -top-1 -right-1 grid size-3 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border"
            title={`${chip.sharedBy} jurors opened this page`}
          >
            <Link21 size="8" variant="Bold" />
          </span>
        )}
      </motion.button>
    </Positioned>
  );
}

/** A page two jurors both opened, drawn once between their wedges. */
function SharedNode({
  shared,
  selected,
  dimmed,
  reduceMotion,
  onSelect,
}: {
  shared: CourtroomShared;
  selected: boolean;
  dimmed: boolean;
  reduceMotion: boolean;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <Positioned point={shared} className={cn("z-20", dimmed && "opacity-40")}>
      <motion.button
        type="button"
        aria-label={`Shared evidence: ${pageDomain(shared.node)}, opened by two jurors`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(shared.node);
        }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: ENTRY_EASE }}
        className={cn(
          "relative flex h-[22px] max-w-[132px] items-center gap-1 border border-foreground/25 bg-surface px-1.5",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:ring-offset-background focus-visible:outline-none",
          selected && "ring-2 ring-sea",
        )}
      >
        <Link21 size="11" variant="Bold" className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[10px] leading-none font-medium text-foreground/80">
          {pageDomain(shared.node)}
        </span>
      </motion.button>
    </Positioned>
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
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = reducedMotion === true || systemReducedMotion === true;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dockInset, setDockInset] = useState(0);
  const [pinnedSeatId, setPinnedSeatId] = useState<string | null>(null);
  const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const updateSize = (width: number, height: number): void => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
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

  // The debate dock floats over the bottom of the same stage, so the room
  // keeps itself above whatever the dock currently covers. Any following
  // sibling that spans the stage counts: the dock does, the mobile corner
  // buttons do not, and a hidden node measures zero.
  useEffect(() => {
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (container === null || parent === null || parent === undefined) return;

    const measure = (): void => {
      const stage = container.getBoundingClientRect();
      if (stage.height === 0) return;
      let covered = 0;
      for (let node = container.nextElementSibling; node !== null; node = node.nextElementSibling) {
        const panel = node.getBoundingClientRect();
        if (panel.height === 0 || panel.width < stage.width * 0.6) continue;
        covered = Math.max(covered, stage.bottom - panel.top);
      }
      const next = Math.round(Math.max(0, Math.min(covered, stage.height)));
      setDockInset((current) => (Math.abs(current - next) < 2 ? current : next));
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

  const layout = useMemo(
    () => buildCourtroomLayout(graph, size, {
      insetBottom: dockInset,
      ...(seatNumbers === undefined ? {} : { seatNumbers }),
    }),
    [dockInset, graph, seatNumbers, size],
  );
  const variants = useMemo(() => variantsBySeat(layout.seats), [layout.seats]);

  // Which wedge a node belongs to, so a selection or an outside highlight
  // opens the right one.
  const wedgeByNodeId = useMemo(() => {
    const wedges = new Map<string, string>();
    for (const seat of layout.seats) {
      wedges.set(seat.id, seat.id);
      if (seat.roundTwo !== undefined) wedges.set(seat.roundTwo.node.id, seat.id);
      for (const chip of seat.chips) wedges.set(chip.id, seat.id);
    }
    return wedges;
  }, [layout.seats]);

  const openSeatId = hoveredSeatId
    ?? (externalHighlightId === undefined || externalHighlightId === null
      ? undefined
      : wedgeByNodeId.get(externalHighlightId))
    ?? pinnedSeatId
    ?? (selectedId === null ? undefined : wedgeByNodeId.get(selectedId))
    ?? null;

  const handleOpen = useCallback((seatId: string) => {
    setPinnedSeatId((current) => (current === seatId ? null : seatId));
  }, []);

  // Escape shuts an open wedge and the inspector with it, and stays out of
  // the way when the canvas has nothing open.
  useEffect(() => {
    if (pinnedSeatId === null && selectedId === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setPinnedSeatId(null);
      setHoveredSeatId(null);
      onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect, pinnedSeatId, selectedId]);

  const closeGround = useCallback(() => {
    setPinnedSeatId(null);
    setHoveredSeatId(null);
    onSelect(null);
  }, [onSelect]);

  const roundTwo = layout.seats.some((seat) => seat.roundTwo !== undefined);
  const ready = size.width > 0 && size.height > 0;
  const certificateOutcome = outcomeOf(layout.certificate?.node);

  return (
    // z-0 keeps the whole plan in its own stacking context UNDER the debate
    // dock: a research chip must never float over the conversation.
    <div
      ref={containerRef}
      role="application"
      aria-label="Deliberation graph canvas"
      className="relative z-0 h-full w-full overflow-hidden bg-background select-none"
      onClick={closeGround}
    >
      {ready ? (
        <>
          {/* The table: two hairline circles and the spokes between them. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0"
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
          >
            <circle
              cx={layout.centre.x}
              cy={layout.centre.y}
              r={layout.radii.seat}
              fill="none"
              stroke={HAIRLINE}
              strokeOpacity={0.1}
            />
            {roundTwo ? (
              <circle
                cx={layout.centre.x}
                cy={layout.centre.y}
                r={layout.radii.inner}
                fill="none"
                stroke={HAIRLINE}
                strokeOpacity={0.08}
                strokeDasharray="3 4"
              />
            ) : null}
            {layout.wires.map((wire) => {
              const belongsToOpen = wire.seatId !== undefined && wire.seatId === openSeatId;
              const otherOpen = openSeatId !== null && !belongsToOpen;
              if (wire.kind === "branch" && !belongsToOpen) return null;
              return (
                <line
                  key={wire.id}
                  x1={wire.x1}
                  y1={wire.y1}
                  x2={wire.x2}
                  y2={wire.y2}
                  stroke={HAIRLINE}
                  strokeOpacity={
                    otherOpen ? 0.07 : belongsToOpen ? 0.32 : wire.kind === "shared" ? 0.28 : 0.16
                  }
                  strokeWidth={1}
                  {...(wire.kind === "shared" ? { strokeDasharray: "2 3" } : {})}
                />
              );
            })}
          </svg>

          {layout.seats.map((seat) => {
            const open = openSeatId === seat.id;
            const dimmed = openSeatId !== null && !open;
            return (
              <div key={seat.id} className="contents">
                <SeatNode
                  seat={seat}
                  layout={layout}
                  variant={variants.get(seat.id) ?? 0}
                  selected={selectedId === seat.id}
                  dimmed={dimmed}
                  open={open}
                  reduceMotion={reduceMotion}
                  onSelect={onSelect}
                  onOpen={handleOpen}
                  onHover={setHoveredSeatId}
                />
                <RoundTwoNode
                  seat={seat}
                  room={layout.roundTwoRoom}
                  selected={selectedId === seat.roundTwo?.node.id}
                  dimmed={dimmed}
                  reduceMotion={reduceMotion}
                  onSelect={onSelect}
                />
                {/* The fan blooms along the arc as the wedge opens, and
                    fades back out when it closes. */}
                <AnimatePresence initial={false}>
                  {open
                    ? seat.chips.map((chip) => (
                        <ChipNode
                          key={chip.id}
                          chip={chip}
                          selected={selectedId === chip.id}
                          highlighted={externalHighlightId === chip.id}
                          reduceMotion={reduceMotion}
                          onSelect={onSelect}
                        />
                      ))
                    : null}
                </AnimatePresence>
              </div>
            );
          })}

          {layout.shared.map((shared) => (
            <SharedNode
              key={shared.id}
              shared={shared}
              selected={selectedId === shared.id}
              dimmed={openSeatId !== null && !shared.seatIds.includes(openSeatId)}
              reduceMotion={reduceMotion}
              onSelect={onSelect}
            />
          ))}

          {layout.certificate === undefined ? null : (
            <Positioned point={layout.certificate} className="z-20">
              <motion.button
                type="button"
                aria-label={`Select the certificate: ${layout.certificate.node.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (layout.certificate !== undefined) onSelect(layout.certificate.node);
                }}
                initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: ENTRY_EASE }}
                className={cn(
                  // The certificate wears the claim's own outcome, the one
                  // place a settled result is a colour.
                  "relative grid size-11 place-items-center border",
                  OUTCOME_STYLE[certificateOutcome],
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "focus-visible:ring-offset-background focus-visible:outline-none",
                  selectedId === layout.certificate.node.id && "ring-2 ring-sea",
                )}
              >
                <ShieldTick size="22" variant="Bold" />
              </motion.button>
            </Positioned>
          )}
          {/* On a narrow stage the label would land on the round-two pills
              inside the ring, so the shield carries the meaning alone. */}
          {layout.certificate === undefined || layout.compact ? null : (
            <RadialLabel
              point={polar(layout.centre, layout.radii.seat - 26, CERTIFICATE_ANGLE)}
              angle={CERTIFICATE_ANGLE}
              direction="in"
              className="ov-micro ov-micro-sm pointer-events-none z-10 whitespace-nowrap text-muted-foreground"
            >
              Certificate
            </RadialLabel>
          )}

          {layout.seats.length === 0 ? (
            <Positioned
              point={{ x: layout.centre.x, y: layout.centre.y + layout.radii.seat }}
              className="pointer-events-none w-64 text-center"
            >
              <p className="text-[13px] leading-snug text-muted-foreground">
                The jury appears here the moment Sui&apos;s randomness draws it.
              </p>
            </Positioned>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

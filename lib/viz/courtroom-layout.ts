/**
 * The courtroom layout: one deterministic seating chart for a claim.
 *
 * The deliberation graph is a record, not a cloud. This module turns it into a
 * fixed radial plan: the jury on one ring, each juror's research on an outer
 * arc inside its own wedge, and an empty middle. The claim itself is NOT drawn
 * (owner, 2026-09-04: the left panel already states it, and a node at the
 * centre only gathers lines). Nothing simulates, nothing settles, nothing
 * crosses: the same committee always lands in the same seats, so a reader can
 * come back and find juror 3 where they left it.
 *
 * Angles are measured CLOCKWISE FROM THE TOP, so juror 1 sits at 12 o'clock,
 * juror 2 next clockwise, and the certificate at 180 degrees closes the ring
 * at the bottom. `polar` turns an angle into a screen point.
 */
import type { DeliberationGraph, GraphNode } from "./deliberation-graph";

export type Point = { x: number; y: number };
export type CourtroomViewport = { width: number; height: number };

const TAU = Math.PI * 2;

/** The widest the clear middle ever gets; a small ring keeps less. */
export const HUB_RADIUS = 28;
/** Node half-sizes in CSS pixels: juror 40, research chip 22 tall. */
export const SEAT_NODE_RADIUS = 20;
export const CHIP_HEIGHT = 22;
/** The certificate always closes the ring at the bottom. */
export const CERTIFICATE_ANGLE = Math.PI;

/**
 * The band outside the jury ring where an open wedge lays its research: a
 * quarter of the ring, between the room a vote pill needs and the room a
 * chip's words need. The ring itself takes everything else the stage has.
 */
const CHIP_BAND_FRACTION = 0.26;
const CHIP_BAND_MIN = 26;
const CHIP_BAND_MAX = 56;
/** A vote pill clears the chips only once the band is this wide. */
const CHIP_BAND_ROOMY = 48;
/** Smallest and largest jury ring, whatever the stage. */
const SEAT_RING_MIN = 44;
const SEAT_RING_MAX = 360;
/**
 * Sideways room a seat's vote stack needs outside the ring. A wide stage has
 * it to spare; a phone does not, which is what keeps the ring off the edge.
 */
const VOTE_STACK_ROOM = 100;
/** A chip keeps its label while its slot is at least this wide. */
const CHIP_LABEL_PITCH = 62;
const CHIP_MAX_PITCH = 136;
/** Angular breathing room between a wedge's chips and its boundary. */
const WEDGE_EDGE_PAD = 0.1;
/**
 * A bare glyph plus the room it needs to clear a neighbour on a diagonal
 * spoke, where two boxes separate along neither axis alone.
 */
const CHIP_MIN_PITCH = 32;

/** A ring smaller than this cannot carry its labels, so they collapse. */
const COMPACT_SEAT_RADIUS = 120;

export type CourtroomRadii = {
  /** The clear middle; the plan draws nothing inside it. */
  hub: number;
  /** The round-two vote pills, between the middle and the jury. */
  inner: number;
  /** The jury ring itself, and the certificate. */
  seat: number;
  /** The research arc of an open wedge, just outside the ring. */
  research: number;
  /** Shared evidence rides the same arc, set apart by its angle. */
  outer: number;
};

export type CourtroomChip = Point & {
  id: string;
  node: GraphNode;
  /** The seat that ran this step; a round-two seat keeps its own id. */
  seatId: string;
  /** The ring seat whose wedge holds the chip. */
  wedgeSeatId: string;
  angle: number;
  radius: number;
  /** Slot width in pixels; the label truncates to it. */
  width: number;
  /** False once the slots are too narrow for text: a bare glyph. */
  labelled: boolean;
  /** Reading order inside the wedge. */
  ordinal: number;
  /** How many jurors opened this page, when three or more share it. */
  sharedBy?: number;
};

export type CourtroomCounts = { searches: number; pages: number };

export type CourtroomRoundTwo = Point & {
  node: GraphNode;
  verdict?: GraphNode;
  angle: number;
};

export type CourtroomSeat = Point & {
  id: string;
  node: GraphNode;
  /** 1-based juror number, the same one the Live view prints. */
  number: number;
  angle: number;
  /** The wedge this juror owns, clockwise from `start` to `end`. */
  wedge: { start: number; end: number };
  chips: CourtroomChip[];
  /** Research steps the wedge had no room for. */
  hiddenChips: number;
  counts: CourtroomCounts;
  verdict?: GraphNode;
  failure?: GraphNode;
  roundTwo?: CourtroomRoundTwo;
};

/** One page two jurors both opened, drawn once on the wedge boundary. */
export type CourtroomShared = Point & {
  id: string;
  node: GraphNode;
  seatIds: [string, string];
  angle: number;
};

/**
 * The only two hairlines left on the plan: a juror to one of its own research
 * chips, and the one cross edge between two jurors who read the same page.
 */
export type CourtroomWireKind = "branch" | "shared";

export type CourtroomWire = {
  id: string;
  kind: CourtroomWireKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The ring seat this wire belongs to, for the open-wedge dimming. */
  seatId?: string;
};

export type CourtroomLayout = {
  size: CourtroomViewport;
  centre: Point;
  radii: CourtroomRadii;
  /** True on a small ring: labels collapse to marks. */
  compact: boolean;
  /**
   * True when the research band is too narrow for a vote pill to sit beside
   * an open wedge's chips, so the pill stands down while the wedge is open.
   */
  tightBand: boolean;
  /**
   * Widest a round-two pill can be without touching the middle or its juror:
   * the band is narrowest on the spokes that run sideways, so this is what
   * decides whether the second vote reads as a pill, a word, or a dot.
   */
  roundTwoRoom: number;
  seats: CourtroomSeat[];
  shared: CourtroomShared[];
  certificate?: Point & { node: GraphNode; angle: number };
  wires: CourtroomWire[];
};

export type CourtroomOptions = {
  /**
   * Juror numbers from the Live view, keyed by jury seat id. Both of a
   * juror's seats carry its number, so round two lands on the same spoke.
   */
  seatNumbers?: ReadonlyMap<string, number>;
  /**
   * Height at the bottom of the stage that the debate dock covers. The plan
   * centres itself in what is left and shrinks to fit.
   */
  insetBottom?: number;
};

/** Screen point for an angle measured clockwise from the top. */
export function polar(centre: Point, radius: number, angle: number): Point {
  return {
    x: centre.x + Math.sin(angle) * radius,
    y: centre.y - Math.cos(angle) * radius,
  };
}

/** Seat `index` of a `count`-seat ring: seat 0 at the top, then clockwise. */
export function seatAngle(index: number, count: number): number {
  return count <= 0 ? 0 : (index * TAU) / count;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Signed shortest way from `from` to `to`, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  const delta = normalizeAngle(to - from);
  return delta > Math.PI ? delta - TAU : delta;
}

/** Midpoint of the short arc; a half-turn apart resolves clockwise. */
function midAngle(from: number, to: number): number {
  return normalizeAngle(from + angleDelta(from, to) / 2);
}

/** A hairline from a seat's rim to a point out in its wedge. */
function rimWire(seat: Point, target: Point): { x1: number; y1: number; x2: number; y2: number } {
  const dx = target.x - seat.x;
  const dy = target.y - seat.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x1: seat.x + (dx / length) * SEAT_NODE_RADIUS,
    y1: seat.y + (dy / length) * SEAT_NODE_RADIUS,
    x2: target.x,
    y2: target.y,
  };
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/** A page node's identity for the shared rule: its url, else its evidence. */
function evidenceKey(node: GraphNode): string | undefined {
  const url = node.url?.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  if (url !== undefined && url.length > 0) return `url:${url}`;
  const opened = node.detail?.["opened"];
  const hash = readString(opened, "contentHash")
    ?? readString(opened, "evidenceId")
    ?? readString(opened, "ref");
  return hash === undefined ? undefined : `evidence:${hash}`;
}

/** Sealed ticks carry the kind of step they hide; revealed nodes carry it. */
function stepKind(node: GraphNode): "search" | "page" {
  if (node.kind === "search") return "search";
  if (node.kind === "page") return "page";
  return readString(node.detail, "kind") === "search" ? "search" : "page";
}

function chipOrder(node: GraphNode): number {
  return node.stepIndex ?? Number.MAX_SAFE_INTEGER;
}

type ChipArcs = {
  /** The arc the wedge's chips sit on. */
  radius: number;
  /** How many chips the arc holds. */
  count: number;
  /** Angular pitch in pixels, the same on every row of the wedge. */
  pitch: number;
  /** Slot width shared by every chip in the wedge. */
  width: number;
  labelled: boolean;
  /** Steps the wedge had no room for. */
  hidden: number;
};

/**
 * Lay `count` research chips along the one arc a wedge owns, just outside the
 * ring. A single arc can never collide with itself, whatever angle the wedge
 * sits at, because neighbours are a full slot apart along it. A trail longer
 * than the arc reports what it could not draw instead of stacking rows that
 * would overlap on a sideways spoke.
 */
function chipArcs(radii: CourtroomRadii, span: number, count: number): ChipArcs {
  if (count <= 0) {
    return { radius: radii.research, count: 0, pitch: CHIP_MIN_PITCH, width: CHIP_HEIGHT, labelled: false, hidden: 0 };
  }
  const arc = span * radii.research;
  const capacity = Math.max(1, Math.floor(arc / CHIP_MIN_PITCH));
  const drawn = Math.min(count, capacity);
  const pitch = Math.min(CHIP_MAX_PITCH, arc / drawn);
  const labelled = pitch >= CHIP_LABEL_PITCH;
  return {
    radius: radii.research,
    count: drawn,
    pitch,
    width: labelled ? pitch - 8 : CHIP_HEIGHT,
    labelled,
    hidden: count - drawn,
  };
}

/**
 * Radii for one stage. The jury ring is the primary quantity: it takes the
 * room the stage actually has, and the research band, the round-two ring and
 * the clear middle all follow from it.
 */
export function courtroomRadii(size: CourtroomViewport): CourtroomRadii {
  // Half the shorter side, less the half-chip and the air an open wedge needs
  // beyond its arc. Everything else goes to the ring.
  const room = Math.max(40, Math.min(size.width, size.height) / 2 - CHIP_HEIGHT);
  const band = clamp(
    (room / (1 + CHIP_BAND_FRACTION)) * CHIP_BAND_FRACTION,
    CHIP_BAND_MIN,
    CHIP_BAND_MAX,
  );
  const seat = clamp(
    Math.min(room - band, size.width / 2 - VOTE_STACK_ROOM),
    SEAT_RING_MIN,
    SEAT_RING_MAX,
  );
  const research = seat + band;
  const hub = clamp(seat * 0.22, 12, HUB_RADIUS);
  // The round-two pills ride the middle of the band the ring leaves clear.
  const inner = (hub + seat - SEAT_NODE_RADIUS) / 2;
  return { hub, inner, seat, research, outer: research };
}

/** A ring too small to carry its own labels: they collapse to marks. */
export function isCompact(size: CourtroomViewport): boolean {
  return courtroomRadii(size).seat < COMPACT_SEAT_RADIUS;
}

/**
 * The seating chart for one graph at one viewport. Pure: the same graph and
 * size always produce the same numbers, so replay and live agree.
 */
export function buildCourtroomLayout(
  graph: DeliberationGraph,
  size: CourtroomViewport,
  options: CourtroomOptions = {},
): CourtroomLayout {
  // The debate dock floats over the bottom of the stage; the plan takes only
  // the room above it, so the room stays whole while someone reads the debate.
  const inset = clamp(options.insetBottom ?? 0, 0, size.height * 0.7);
  const stage = { width: size.width, height: Math.max(120, size.height - inset) };
  const centre = { x: stage.width / 2, y: stage.height / 2 };
  const radii = courtroomRadii(stage);
  const compact = radii.seat < COMPACT_SEAT_RADIUS;

  const jurors = graph.nodes.filter((node) => node.kind === "juror");
  const ringNodes = jurors.filter((node) => node.satellite !== true);
  const satellites = jurors.filter((node) => node.satellite === true);

  // A round-two seat rides the spoke of the juror that already holds a seat:
  // the graph's round edge says which, and a shared juror number is the
  // fallback for a record that carries no such edge.
  const parentByNode = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === "round") parentByNode.set(edge.to, edge.from);
  }

  const numberOf = (node: GraphNode): number => {
    const fromLive = node.seatId === undefined
      ? undefined
      : options.seatNumbers?.get(node.seatId);
    return fromLive ?? (node.seatIndex ?? 0) + 1;
  };

  const ordered = [...ringNodes].sort((left, right) =>
    numberOf(left) - numberOf(right)
    || (left.seatIndex ?? 0) - (right.seatIndex ?? 0)
    || left.id.localeCompare(right.id),
  );
  const seatCount = ordered.length;
  const wedgeHalf = seatCount === 0 ? Math.PI : Math.PI / seatCount;

  const verdictBySeat = new Map<string, GraphNode>();
  const failureBySeat = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (node.seatId === undefined) continue;
    if (node.kind === "verdict") verdictBySeat.set(node.seatId, node);
    if (node.kind === "failure") failureBySeat.set(node.seatId, node);
  }

  // Every seat id, both rounds, maps to the ring seat whose wedge holds it.
  const wedgeSeatIdBySeat = new Map<string, string>();
  for (const node of ordered) {
    if (node.seatId !== undefined) wedgeSeatIdBySeat.set(node.seatId, node.id);
  }
  const roundTwoByRingId = new Map<string, GraphNode>();
  for (const satellite of satellites) {
    const parentId = parentByNode.get(satellite.id)
      ?? ordered.find((node) => numberOf(node) === numberOf(satellite))?.id;
    if (parentId === undefined) continue;
    roundTwoByRingId.set(parentId, satellite);
    if (satellite.seatId !== undefined) {
      wedgeSeatIdBySeat.set(satellite.seatId, parentId);
    }
  }

  // --- research, per wedge ------------------------------------------------
  const research = graph.nodes.filter(
    (node) =>
      (node.kind === "search" || node.kind === "page" || node.kind === "sealedAction")
      && node.seatId !== undefined,
  );

  // A page two jurors both opened is drawn once, on the boundary between their
  // wedges. Three or more jurors is common ground for the whole panel, not a
  // pair: it keeps its chip in every wedge with a shared mark, because five
  // wires out of one node is exactly the mesh this layout replaces.
  const byEvidence = new Map<string, GraphNode[]>();
  for (const node of research) {
    if (node.kind !== "page") continue;
    const key = evidenceKey(node);
    if (key === undefined) continue;
    const bucket = byEvidence.get(key);
    if (bucket === undefined) byEvidence.set(key, [node]);
    else bucket.push(node);
  }

  const sharedNodeIds = new Set<string>();
  const sharedCountByNodeId = new Map<string, number>();
  const pendingShared: Array<{ node: GraphNode; wedges: [string, string] }> = [];
  const evidenceKeys = [...byEvidence.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const key of evidenceKeys) {
    const bucket = byEvidence.get(key) ?? [];
    const wedges = [
      ...new Set(
        bucket.flatMap((node) => {
          const wedgeId = node.seatId === undefined
            ? undefined
            : wedgeSeatIdBySeat.get(node.seatId);
          return wedgeId === undefined ? [] : [wedgeId];
        }),
      ),
    ];
    if (wedges.length < 2) continue;
    if (wedges.length > 2) {
      for (const node of bucket) sharedCountByNodeId.set(node.id, wedges.length);
      continue;
    }
    const [first, second] = wedges;
    if (first === undefined || second === undefined) continue;
    // The node keeps its own id: the inspector still finds it in the graph.
    const representative = [...bucket].sort((left, right) =>
      left.id.localeCompare(right.id),
    )[0];
    if (representative === undefined) continue;
    for (const node of bucket) sharedNodeIds.add(node.id);
    pendingShared.push({ node: representative, wedges: [first, second] });
  }

  const chipsByWedge = new Map<string, GraphNode[]>();
  const countsByRing = new Map<string, CourtroomCounts>();
  for (const node of research) {
    const seatId = node.seatId;
    if (seatId === undefined) continue;
    const wedgeId = wedgeSeatIdBySeat.get(seatId);
    if (wedgeId === undefined) continue;
    // The count is what the juror DID, so a shared page still counts here.
    const counts = countsByRing.get(wedgeId) ?? { searches: 0, pages: 0 };
    if (stepKind(node) === "search") counts.searches += 1;
    else counts.pages += 1;
    countsByRing.set(wedgeId, counts);
    if (sharedNodeIds.has(node.id)) continue;
    const bucket = chipsByWedge.get(wedgeId);
    if (bucket === undefined) chipsByWedge.set(wedgeId, [node]);
    else bucket.push(node);
  }

  // --- the ring ------------------------------------------------------------
  const wires: CourtroomWire[] = [];
  const seats: CourtroomSeat[] = ordered.map((node, index) => {
    const angle = seatAngle(index, seatCount);
    const position = polar(centre, radii.seat, angle);
    const roundTwoNode = roundTwoByRingId.get(node.id);
    const seatChips = [...(chipsByWedge.get(node.id) ?? [])].sort(
      (left, right) => chipOrder(left) - chipOrder(right)
        || left.atMs - right.atMs
        || left.id.localeCompare(right.id),
    );

    // The chips of one wedge never leave it: each row shares out only the
    // wedge's own arc, minus a pad, so a slot can never reach the boundary.
    const span = Math.max(0.08, wedgeHalf * 2 - WEDGE_EDGE_PAD * 2);
    const arcs = chipArcs(radii, span, seatChips.length);
    const chips: CourtroomChip[] = [];
    for (let ordinal = 0; ordinal < arcs.count; ordinal += 1) {
      const chipNode = seatChips[ordinal];
      if (chipNode === undefined) break;
      const offset = ((ordinal - (arcs.count - 1) / 2) * arcs.pitch) / arcs.radius;
      const chipAngle = angle + offset;
      const point = polar(centre, arcs.radius, chipAngle);
      const sharedBy = sharedCountByNodeId.get(chipNode.id);
      chips.push({
        id: chipNode.id,
        node: chipNode,
        seatId: chipNode.seatId ?? "",
        wedgeSeatId: node.id,
        angle: chipAngle,
        radius: arcs.radius,
        width: arcs.width,
        labelled: arcs.labelled,
        ordinal,
        ...(sharedBy === undefined ? {} : { sharedBy }),
        x: point.x,
        y: point.y,
      });
      wires.push({
        id: `wire:branch:${node.id}:${chipNode.id}`,
        kind: "branch",
        seatId: node.id,
        ...rimWire(position, point),
      });
    }
    const hiddenChips = arcs.hidden;

    // No hairline to the round-two pill: on a sideways spoke the pill fills
    // the whole band, so the line would show on some seats and not others.
    // The dashed inner ring and the shared angle carry that relationship.

    const roundTwoPoint = roundTwoNode === undefined
      ? undefined
      : polar(centre, radii.inner, angle);
    const verdict = node.seatId === undefined
      ? undefined
      : verdictBySeat.get(node.seatId);
    const failure = node.seatId === undefined
      ? undefined
      : failureBySeat.get(node.seatId);
    const roundTwoVerdict = roundTwoNode?.seatId === undefined
      ? undefined
      : verdictBySeat.get(roundTwoNode.seatId);

    return {
      id: node.id,
      node,
      number: numberOf(node),
      angle,
      wedge: { start: angle - wedgeHalf, end: angle + wedgeHalf },
      chips,
      hiddenChips,
      counts: countsByRing.get(node.id) ?? { searches: 0, pages: 0 },
      ...(verdict === undefined ? {} : { verdict }),
      ...(failure === undefined ? {} : { failure }),
      ...(roundTwoNode === undefined || roundTwoPoint === undefined
        ? {}
        : {
            roundTwo: {
              node: roundTwoNode,
              angle,
              ...(roundTwoVerdict === undefined ? {} : { verdict: roundTwoVerdict }),
              x: roundTwoPoint.x,
              y: roundTwoPoint.y,
            },
          }),
      x: position.x,
      y: position.y,
    };
  });

  // --- shared evidence on the wedge boundaries -----------------------------
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const shared: CourtroomShared[] = [];
  for (const pending of pendingShared) {
    const left = seatById.get(pending.wedges[0]);
    const right = seatById.get(pending.wedges[1]);
    if (left === undefined || right === undefined) continue;
    const angle = midAngle(left.angle, right.angle);
    const point = polar(centre, radii.outer, angle);
    shared.push({
      id: pending.node.id,
      node: pending.node,
      seatIds: [left.id, right.id],
      angle,
      x: point.x,
      y: point.y,
    });
    for (const seat of [left, right]) {
      wires.push({
        id: `wire:shared:${pending.node.id}:${seat.id}`,
        kind: "shared",
        seatId: seat.id,
        ...rimWire(seat, point),
      });
    }
  }

  // --- the certificate closes the ring at the bottom -----------------------
  // The certificate reads as the seat that closes the ring, with no wire of
  // its own: the middle is empty.
  const certificateNode = graph.nodes.find((node) => node.kind === "certificate");
  const certificate = certificateNode === undefined
    ? undefined
    : {
        node: certificateNode,
        angle: CERTIFICATE_ANGLE,
        ...polar(centre, radii.seat, CERTIFICATE_ANGLE),
      };

  const roundTwoRoom = Math.max(
    0,
    2 * Math.min(
      radii.inner - radii.hub,
      radii.seat - SEAT_NODE_RADIUS - radii.inner,
    ) - 8,
  );

  return {
    size,
    centre,
    radii,
    compact,
    tightBand: radii.research - radii.seat < CHIP_BAND_ROOMY,
    roundTwoRoom,
    seats,
    shared,
    ...(certificate === undefined ? {} : { certificate }),
    wires,
  };
}

/** Room around a small ring for the seat marks that sit on it. */
const MINI_RING_PADDING = 16;

/**
 * The same seating chart at a glanceable size. The Live view's preview card
 * draws its ring from here, so the small picture and the stage agree: seat 1
 * at the top, the rest clockwise, the certificate closing it at the bottom.
 */
export function miniRing(
  seats: number,
  radius: number,
): {
  size: number;
  centre: Point;
  seats: Array<Point & { index: number; angle: number }>;
  certificate: Point;
} {
  const size = radius * 2 + MINI_RING_PADDING;
  const centre = { x: size / 2, y: size / 2 };
  const count = Math.max(0, Math.floor(seats));
  return {
    size,
    centre,
    seats: Array.from({ length: count }, (_, index) => {
      const angle = seatAngle(index, count);
      return { index, angle, ...polar(centre, radius, angle) };
    }),
    certificate: polar(centre, radius, CERTIFICATE_ANGLE),
  };
}

/**
 * Confidence in whole percent, never basis points, and rounded the same way
 * the Live view says it out loud: 7800 reads "78%", 8650 reads "87%".
 */
export function confidencePercent(confidenceBps: number | undefined): string | undefined {
  if (confidenceBps === undefined || !Number.isFinite(confidenceBps)) return undefined;
  return `${Math.round(confidenceBps / 100)}%`;
}

/** "2 searches · 5 pages", with an empty half dropped. */
export function countsLabel(counts: CourtroomCounts): string | undefined {
  const parts: string[] = [];
  if (counts.searches > 0) {
    parts.push(`${counts.searches} search${counts.searches === 1 ? "" : "es"}`);
  }
  if (counts.pages > 0) {
    parts.push(`${counts.pages} page${counts.pages === 1 ? "" : "s"}`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The host of a page node, for the chip label: "mit.edu". */
export function pageDomain(node: GraphNode): string {
  const url = node.url;
  if (url === undefined) return node.label;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return node.label;
  }
}

/**
 * A search chip's words: the intent alone in a narrow slot, and the intent
 * with the first 40 characters of the query where there is room for both.
 */
export function searchLabel(node: GraphNode, wide: boolean): string {
  const query = node.label.trim();
  const intent = node.intent;
  if (!wide) return intent ?? (query.length <= 12 ? query : "search");
  const words = query.length <= 40 ? query : `${query.slice(0, 39)}…`;
  // The localnet queries already open with their intent; never say it twice.
  if (intent === undefined || words.toLowerCase().startsWith(intent)) return words;
  return `${intent} · ${words}`;
}

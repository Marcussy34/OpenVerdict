/**
 * The swarm network model behind the hero globe.
 *
 * The globe is an honest SCHEMATIC of the protocol, not a live map: node
 * placement illustrates a globally distributed jury, while the identities
 * (role + model family) and the claim/Truth Score shown in the HUD come from
 * the real read-only API when it is reachable. Nothing here talks to a
 * network — it is pure geometry + a deterministic choreography clock.
 */

import { latLngToVec3 } from "./land-dots";

/* -------------------------------------------------------------------------- */
/* Nodes                                                                       */
/* -------------------------------------------------------------------------- */

export type NodeKind = "agent" | "source" | "origin";

export type SwarmNode = {
  kind: NodeKind;
  lat: number;
  lng: number;
  /** Model-family colour index (0 DeepSeek · 1 Kimi · 2 MiniMax). */
  family: 0 | 1 | 2;
};

/** Seven juror nodes spread across six landmasses — the deliberating swarm. */
export const AGENT_NODES: SwarmNode[] = [
  { kind: "agent", lat: 37.77, lng: -122.42, family: 0 },
  { kind: "agent", lat: 47.37, lng: 8.54, family: 1 },
  { kind: "agent", lat: 1.35, lng: 103.82, family: 2 },
  { kind: "agent", lat: -23.55, lng: -46.63, family: 0 },
  { kind: "agent", lat: 6.52, lng: 3.38, family: 1 },
  { kind: "agent", lat: 35.68, lng: 139.69, family: 2 },
  { kind: "agent", lat: -33.87, lng: 151.21, family: 0 },
];

/** Evidence-source nodes: the wider, dimmer ring the swarm pulls from. */
export const SOURCE_NODES: SwarmNode[] = [
  { kind: "source", lat: 51.51, lng: -0.13, family: 1 },
  { kind: "source", lat: 40.71, lng: -74.01, family: 0 },
  { kind: "source", lat: 28.61, lng: 77.21, family: 2 },
  { kind: "source", lat: -1.29, lng: 36.82, family: 1 },
  { kind: "source", lat: 43.65, lng: -79.38, family: 0 },
  { kind: "source", lat: 25.2, lng: 55.27, family: 2 },
  { kind: "source", lat: 37.57, lng: 126.98, family: 1 },
  { kind: "source", lat: 19.43, lng: -99.13, family: 0 },
  { kind: "source", lat: -33.92, lng: 18.42, family: 2 },
  { kind: "source", lat: 59.33, lng: 18.07, family: 1 },
  { kind: "source", lat: -34.6, lng: -58.38, family: 0 },
  { kind: "source", lat: 52.52, lng: 13.4, family: 2 },
  { kind: "source", lat: 13.76, lng: 100.5, family: 1 },
  { kind: "source", lat: 55.75, lng: 37.62, family: 0 },
];

/** Ingest points a claim can arrive at — one per cycle, in rotation. */
export const ORIGIN_NODES: SwarmNode[] = [
  { kind: "origin", lat: 48.86, lng: 2.35, family: 0 },
  { kind: "origin", lat: -12.05, lng: -77.04, family: 0 },
  { kind: "origin", lat: 22.32, lng: 114.17, family: 0 },
  { kind: "origin", lat: 30.04, lng: 31.24, family: 0 },
  { kind: "origin", lat: 41.88, lng: -87.63, family: 0 },
];

/** Flat node table the renderer draws as one point cloud. */
export const NODES: SwarmNode[] = [...AGENT_NODES, ...SOURCE_NODES, ...ORIGIN_NODES];

export const AGENT_OFFSET = 0;
export const SOURCE_OFFSET = AGENT_NODES.length;
export const ORIGIN_OFFSET = SOURCE_OFFSET + SOURCE_NODES.length;
export const ORIGIN_COUNT = ORIGIN_NODES.length;

/* -------------------------------------------------------------------------- */
/* Arcs                                                                        */
/* -------------------------------------------------------------------------- */

export type ArcGroup = "gather" | "debate" | "seal";

export type SwarmArc = {
  group: ArcGroup;
  /** Node indices into NODES. */
  from: number;
  to: number;
  /** For seal arcs, which origin (cycle) the arc belongs to. */
  origin: number;
  /** Stagger seed so sibling arcs never fire in lockstep. */
  seed: number;
  family: 0 | 1 | 2;
};

function buildArcs(): SwarmArc[] {
  const arcs: SwarmArc[] = [];

  // Evidence retrieval: every source feeds the juror that adopted it.
  SOURCE_NODES.forEach((source, i) => {
    arcs.push({
      group: "gather",
      from: SOURCE_OFFSET + i,
      to: AGENT_OFFSET + (i % AGENT_NODES.length),
      origin: -1,
      seed: i * 0.0713,
      family: source.family,
    });
  });

  // Cross-examination: the full juror mesh — everyone can challenge everyone.
  AGENT_NODES.forEach((agent, a) => {
    for (let b = a + 1; b < AGENT_NODES.length; b++) {
      arcs.push({
        group: "debate",
        from: AGENT_OFFSET + a,
        to: AGENT_OFFSET + b,
        origin: -1,
        seed: (a * 7 + b) * 0.0431,
        family: agent.family,
      });
    }
  });

  // Settlement: sealed votes converge back on the claim's ingest point.
  ORIGIN_NODES.forEach((_, o) => {
    AGENT_NODES.forEach((agent, a) => {
      arcs.push({
        group: "seal",
        from: AGENT_OFFSET + a,
        to: ORIGIN_OFFSET + o,
        origin: o,
        seed: a * 0.097,
        family: agent.family,
      });
    });
  });

  return arcs;
}

export const ARCS: SwarmArc[] = buildArcs();

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

export const GLOBE_RADIUS = 1;

/** Unit-sphere position of a node, lifted just clear of the land dots. */
export function nodePosition(node: SwarmNode, lift = 1.015): [number, number, number] {
  return latLngToVec3(node.lat, node.lng, lift);
}

/**
 * Samples a great-circle-ish arc between two surface points. The apex rises
 * with angular distance so short hops stay tight to the surface and
 * hemisphere-crossing links bow out into space.
 */
export function sampleArc(
  a: [number, number, number],
  b: [number, number, number],
  segments: number,
): Float32Array {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot / (1.015 * 1.015));
  const lift = 1.02 + angle * 0.22;

  // Control point: the midpoint direction pushed outward to `lift`.
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const mz = (a[2] + b[2]) / 2;
  const ml = Math.hypot(mx, my, mz) || 1;
  const c: [number, number, number] = [(mx / ml) * lift, (my / ml) * lift, (mz / ml) * lift];

  const out = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out[i * 3] = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    out[i * 3 + 1] = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    out[i * 3 + 2] = u * u * a[2] + 2 * u * t * c[2] + t * t * b[2];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Choreography                                                                */
/* -------------------------------------------------------------------------- */

export type SwarmPhaseId = "claim" | "gather" | "debate" | "seal" | "verdict";

export type SwarmPhase = {
  id: SwarmPhaseId;
  /** Short rail label. */
  label: string;
  /** One-line description of what the protocol is doing. */
  detail: string;
  ms: number;
};

/** One full resolution cycle: claim → swarm → debate → seal → verdict. */
export const PHASES: SwarmPhase[] = [
  {
    id: "claim",
    label: "Ingest",
    detail: "Claim bounded, evidence cutoff frozen",
    ms: 2600,
  },
  {
    id: "gather",
    label: "Gather",
    detail: "Jurors pull primary sources, hash them to Walrus",
    ms: 4400,
  },
  {
    id: "debate",
    label: "Cross-check",
    detail: "Jurors challenge each other's citations",
    ms: 4400,
  },
  {
    id: "seal",
    label: "Seal",
    detail: "Votes committed under Blake2b-256 — none readable",
    ms: 2600,
  },
  {
    id: "verdict",
    label: "Settle",
    detail: "Supermajority reveals, certificate mints on Sui",
    ms: 3400,
  },
];

export const CYCLE_MS = PHASES.reduce((total, phase) => total + phase.ms, 0);

/** Cumulative start offset of each phase inside a cycle. */
export const PHASE_STARTS: number[] = (() => {
  const starts: number[] = [];
  let running = 0;
  for (const phase of PHASES) {
    starts.push(running);
    running += phase.ms;
  }
  return starts;
})();

export function phaseIndexAt(cycleMs: number): number {
  for (let i = PHASE_STARTS.length - 1; i >= 0; i--) {
    if (cycleMs >= (PHASE_STARTS[i] ?? 0)) return i;
  }
  return 0;
}

/** Arc-group activity windows, in ms from cycle start. Deliberately overlapped
 *  so the network never goes fully dark between phases. */
export const ARC_WINDOWS: Record<ArcGroup, [number, number]> = {
  gather: [2200, 7800],
  debate: [6600, 12000],
  seal: [11000, 15400],
};

/* -------------------------------------------------------------------------- */
/* Swarm transcript                                                            */
/* -------------------------------------------------------------------------- */

export type SwarmLine = {
  /** ms from cycle start when the line lands in the log. */
  at: number;
  role: string;
  text: string;
  tone: "neutral" | "sealed" | "yes" | "warn";
};

/**
 * The debate transcript. Roles mirror the real registry taxonomy
 * (ANALYST / SKEPTIC / SOURCE_AUTHENTICITY); the text is illustrative of what
 * each role does, which is why the panel is labelled a schematic.
 */
export const TRANSCRIPT: SwarmLine[] = [
  { at: 400, role: "INGEST", text: "claim bounded · evidence cutoff pinned", tone: "neutral" },
  { at: 1500, role: "COMMITTEE", text: "5 seats drawn by on-chain randomness", tone: "neutral" },
  { at: 2900, role: "ANALYST", text: "3 primary sources · SSRF-safe crawl", tone: "neutral" },
  { at: 4200, role: "SOURCE_AUTH", text: "2 of 3 archives match the hash", tone: "neutral" },
  { at: 5600, role: "ANALYST", text: "evidence bundle → Walrus Merkle root", tone: "neutral" },
  { at: 7200, role: "SKEPTIC", text: "challenges citation #3 — after cutoff", tone: "warn" },
  { at: 8600, role: "SOURCE_AUTH", text: "citation #3 dropped from bundle", tone: "warn" },
  { at: 10000, role: "ANALYST", text: "restates position on the reduced bundle", tone: "neutral" },
  { at: 11600, role: "COMMITTEE", text: "5 votes sealed · no vote readable", tone: "sealed" },
  { at: 13200, role: "REVEAL", text: "5 of 5 opened against their preimages", tone: "sealed" },
  { at: 14400, role: "SETTLE", text: "supermajority reached · certificate minted", tone: "yes" },
];

/** Fallback claims for the HUD when the read-only API is unreachable. */
export const FALLBACK_CLAIMS = [
  "Evidence for this claim was frozen before any juror model was invoked.",
  "A four-of-five supermajority is required before a certificate can mint.",
  "Every Truth Score is integer arithmetic anyone can recompute offline.",
];

/** Short model label for a GonkaRouter model id, e.g. `DeepSeek-V4-Flash`. */
export function shortModel(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail.replace(/-\d{4}$/, "");
}

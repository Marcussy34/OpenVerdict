"use client";

/**
 * The hero's WebGL scene: an Earth of land dots, a swarm of juror nodes and
 * the arcs they argue across.
 *
 * Everything animates from ONE clock — the `clock.current.start` timestamp the
 * DOM heads-up display owns — so the narration and the 3D can never drift
 * apart. Per-arc and per-node state is uploaded as a small float DataTexture
 * each frame and read back in the vertex shader, which keeps the entire
 * network to six draw calls no matter how many links light up.
 *
 * Geometry and materials are built ONCE at module scope, not per mount: they
 * depend on nothing but the static network model, this module is only ever
 * loaded in the browser (via `next/dynamic` with `ssr: false`), and sharing
 * them means remounting the hero costs no allocations and leaks nothing.
 *
 * Cost control: no lights, no shadows, no post-processing, DPR capped by the
 * caller, and `frameloop="demand"` whenever the hero is offscreen or the
 * visitor prefers reduced motion.
 */

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { landDotPositions } from "./land-dots";
import {
  ARCS,
  ARC_WINDOWS,
  AGENT_NODES,
  AGENT_OFFSET,
  CYCLE_MS,
  NODES,
  ORIGIN_OFFSET,
  SOURCE_OFFSET,
  nodePosition,
  sampleArc,
} from "./network";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const ARC_SEGMENTS = 40;
const ARC_TEX_W = 128;
const NODE_TEX_W = 32;
const LIGHT_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();

/** Family palette, lifted for a dark canvas (DeepSeek · Kimi · MiniMax). */
const FAMILY_HEX = ["#6f93ff", "#c07bff", "#3fd3e4"] as const;
const GATHER_HEX = "#8fdcff";
const SEAL_HEX = "#4da2ff";

/** Where the HUD can pin a chip on the globe. */
export type AnchorId = "origin" | "agent";

/**
 * Hand-spin state. The stage owns it — pointer handlers and its own rAF write
 * it, the scene only reads. `yaw` accumulates every radian the hand has asked
 * for (coasting included), `vx` is the velocity it is carrying, `pitch` the
 * tilt it has been dragged to.
 */
export type GlobeDrag = { active: boolean; yaw: number; vx: number; pitch: number };

export type SwarmSceneProps = {
  /** Mutable start timestamp of the current cycle, owned by the HUD. */
  clock: React.RefObject<{ start: number }>;
  /** Pointer-driven spin, owned by the stage. */
  drag?: React.RefObject<GlobeDrag>;
  /** Which ingest point this cycle's claim arrived at. */
  originIndex: number;
  /** Which juror the HUD is currently spotlighting. */
  spotlightIndex: number;
  /** Hero is offscreen — hold the last frame instead of burning GPU. */
  paused?: boolean;
  /** Visitor prefers reduced motion — one still frame, no spin. */
  reduced?: boolean;
  /** Called each frame with the screen position of each anchored chip. */
  onAnchor?: (id: AnchorId, x: number, y: number, opacity: number) => void;
};

/* -------------------------------------------------------------------------- */
/* Maths helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Trapezoid envelope: 0 outside [start,end], 1 in the middle, smooth edges. */
function envelope(t: number, start: number, end: number, fadeIn: number, fadeOut: number) {
  if (t <= start || t >= end) return 0;
  const rise = Math.min(1, (t - start) / fadeIn);
  const fall = Math.min(1, (end - t) / fadeOut);
  const v = Math.min(rise, fall);
  return v * v * (3 - 2 * v);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
/** Symmetric 0→1→0 sweep, for challenges that travel out and answers back. */
const pingPong = (v: number) => {
  const f = v - Math.floor(v);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/* -------------------------------------------------------------------------- */
/* Earth + atmosphere                                                          */
/* -------------------------------------------------------------------------- */

const earthMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uLightDir: { value: LIGHT_DIR },
    uDeep: { value: new THREE.Color("#06192b") },
    uLit: { value: new THREE.Color("#10496f") },
    uRim: { value: new THREE.Color("#2f7fd0") },
  },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vP;
    void main() {
      vN = normalize(mat3(modelMatrix) * normal);
      vP = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uLightDir;
    uniform vec3 uDeep;
    uniform vec3 uLit;
    uniform vec3 uRim;
    varying vec3 vN;
    varying vec3 vP;
    void main() {
      vec3 n = normalize(vN);
      vec3 v = normalize(cameraPosition - vP);
      float lambert = max(dot(n, normalize(uLightDir)), 0.0);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 col = mix(uDeep, uLit, pow(lambert, 1.35));
      col += uRim * fres * 0.8;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }
  `,
});


/* -------------------------------------------------------------------------- */
/* Land dots                                                                   */
/* -------------------------------------------------------------------------- */

const land = (() => {
  const positions = landDotPositions();
  const count = positions.length / 3;
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uSize: { value: 2.25 },
    uPixelRatio: { value: 1 },
    uLightDir: { value: LIGHT_DIR },
    uDim: { value: new THREE.Color("#2e83c4") },
    uLitColor: { value: new THREE.Color("#b6e2ff") },
    uWaveColor: { value: new THREE.Color("#ffffff") },
    uClaim: { value: new THREE.Vector3(0, 1, 0) },
    uWaveR: { value: -1 },
    uWaveAmp: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uSize;
      uniform float uPixelRatio;
      uniform vec3 uLightDir;
      uniform vec3 uClaim;
      uniform float uWaveR;
      uniform float uWaveAmp;
      attribute float aSeed;
      varying float vLight;
      varying float vWave;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 nWorld = normalize(mat3(modelMatrix) * position);
        vLight = max(dot(nWorld, normalize(uLightDir)), 0.0);
        // A ring of activation spreading out of the ingest point.
        float d = distance(normalize(position), uClaim);
        vWave = uWaveAmp * exp(-pow((d - uWaveR) / 0.17, 2.0));
        gl_PointSize = (uSize + vWave * 2.6 + aSeed * 0.35) * uPixelRatio * (2.7 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDim;
      uniform vec3 uLitColor;
      uniform vec3 uWaveColor;
      varying float vLight;
      varying float vWave;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float mask = smoothstep(0.5, 0.26, r);
        vec3 col = mix(uDim, uLitColor, smoothstep(0.0, 0.8, vLight));
        col = mix(col, uWaveColor, clamp(vWave, 0.0, 1.0));
        float alpha = mask * (0.42 + vLight * 0.55 + clamp(vWave, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
  });

  return { geometry, material, uniforms };
})();

/* -------------------------------------------------------------------------- */
/* Land web                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The land dots wired to their nearest neighbours, so the Earth reads as one
 * connected network rather than a scatter of points. Neighbours are found
 * through a spatial hash — ~2.9k dots would be 8.5M distance checks brute
 * force — capped per dot so the web stays a web, and lit by the same day/night
 * term as the dots themselves.
 */
const web = (() => {
  const dots = landDotPositions();
  const count = dots.length / 3;
  const REACH = 0.075; // a little past the dot grid's own spacing
  const LINKS = 3; // neighbours each dot reaches for

  const buckets = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / REACH);
  for (let i = 0; i < count; i++) {
    const k = `${cellOf(dots[i * 3] ?? 0)},${cellOf(dots[i * 3 + 1] ?? 0)},${cellOf(dots[i * 3 + 2] ?? 0)}`;
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  }

  // One entry per unordered pair, encoded as a single number.
  const pairs = new Set<number>();
  const near: Array<{ j: number; d: number }> = [];
  for (let i = 0; i < count; i++) {
    const x = dots[i * 3] ?? 0;
    const y = dots[i * 3 + 1] ?? 0;
    const z = dots[i * 3 + 2] ?? 0;
    near.length = 0;
    const cx = cellOf(x);
    const cy = cellOf(y);
    const cz = cellOf(z);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = buckets.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!list) continue;
          for (const j of list) {
            if (j === i) continue;
            const dx = (dots[j * 3] ?? 0) - x;
            const dy = (dots[j * 3 + 1] ?? 0) - y;
            const dz = (dots[j * 3 + 2] ?? 0) - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d <= REACH * REACH) near.push({ j, d });
          }
        }
      }
    }
    near.sort((a, b) => a.d - b.d);
    for (let n = 0; n < Math.min(LINKS, near.length); n++) {
      const j = near[n]?.j ?? i;
      if (j === i) continue;
      pairs.add(i < j ? i * count + j : j * count + i);
    }
  }

  const positions = new Float32Array(pairs.size * 6);
  let w = 0;
  for (const encoded of pairs) {
    const i = Math.floor(encoded / count);
    const j = encoded % count;
    for (const k of [i, j]) {
      positions[w++] = dots[k * 3] ?? 0;
      positions[w++] = dots[k * 3 + 1] ?? 0;
      positions[w++] = dots[k * 3 + 2] ?? 0;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: LIGHT_DIR },
      uDim: { value: new THREE.Color("#1d5f96") },
      uLitColor: { value: new THREE.Color("#8ecbff") },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec3 uLightDir;
      varying float vLight;
      void main() {
        vec3 nWorld = normalize(mat3(modelMatrix) * position);
        vLight = max(dot(nWorld, normalize(uLightDir)), 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDim;
      uniform vec3 uLitColor;
      varying float vLight;
      void main() {
        vec3 col = mix(uDim, uLitColor, smoothstep(0.0, 0.8, vLight));
        gl_FragColor = vec4(col, 0.09 + vLight * 0.26);
        #include <colorspace_fragment>
      }
    `,
  });

  return { geometry, material };
})();

/* -------------------------------------------------------------------------- */
/* Arc ribbons                                                                 */
/* -------------------------------------------------------------------------- */

const arcs = (() => {
  const perArc = (ARC_SEGMENTS + 1) * 2;
  const total = ARCS.length * perArc;

  const positions = new Float32Array(total * 3);
  const tangents = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const aT = new Float32Array(total);
  const aSide = new Float32Array(total);
  const aArc = new Float32Array(total);
  const indices = new Uint16Array(ARCS.length * ARC_SEGMENTS * 6);

  const colour = new THREE.Color();
  let v = 0;
  let f = 0;

  ARCS.forEach((arc, arcIndex) => {
    const fromNode = NODES[arc.from];
    const toNode = NODES[arc.to];
    if (!fromNode || !toNode) return;
    const pts = sampleArc(nodePosition(fromNode), nodePosition(toNode), ARC_SEGMENTS);
    const at = (index: number) => pts[index] ?? 0;

    colour.set(
      arc.group === "gather"
        ? GATHER_HEX
        : arc.group === "seal"
          ? SEAL_HEX
          : FAMILY_HEX[arc.family],
    );

    const base = v;
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = i / ARC_SEGMENTS;
      const p = i * 3;
      const n = Math.min(ARC_SEGMENTS, i + 1) * 3;
      const q = Math.max(0, i - 1) * 3;
      const tx = at(n) - at(q);
      const ty = at(n + 1) - at(q + 1);
      const tz = at(n + 2) - at(q + 2);
      const tl = Math.hypot(tx, ty, tz) || 1;

      // Two vertices per sample; the shader pushes them apart camera-facing.
      for (let s = 0; s < 2; s++) {
        positions[v * 3] = at(p);
        positions[v * 3 + 1] = at(p + 1);
        positions[v * 3 + 2] = at(p + 2);
        tangents[v * 3] = tx / tl;
        tangents[v * 3 + 1] = ty / tl;
        tangents[v * 3 + 2] = tz / tl;
        colors[v * 3] = colour.r;
        colors[v * 3 + 1] = colour.g;
        colors[v * 3 + 2] = colour.b;
        aT[v] = t;
        aSide[v] = s === 0 ? -1 : 1;
        aArc[v] = arcIndex;
        v++;
      }
    }

    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const a = base + i * 2;
      indices[f++] = a;
      indices[f++] = a + 1;
      indices[f++] = a + 2;
      indices[f++] = a + 1;
      indices[f++] = a + 3;
      indices[f++] = a + 2;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aTangent", new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
  geometry.setAttribute("aArc", new THREE.BufferAttribute(aArc, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  // RGBA per arc: head · intensity · pulse position · spare.
  const stateData = new Float32Array(ARC_TEX_W * 4);
  const stateTex = new THREE.DataTexture(
    stateData,
    ARC_TEX_W,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  stateTex.minFilter = THREE.NearestFilter;
  stateTex.magFilter = THREE.NearestFilter;
  stateTex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uState: { value: stateTex },
      uTexW: { value: ARC_TEX_W },
      uWidth: { value: 0.0115 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform sampler2D uState;
      uniform float uTexW;
      uniform float uWidth;
      attribute vec3 aTangent;
      attribute vec3 aColor;
      attribute float aT;
      attribute float aSide;
      attribute float aArc;
      varying float vT;
      varying float vHead;
      varying float vI;
      varying float vPulse;
      varying vec3 vColor;
      void main() {
        vec4 st = texture2D(uState, vec2((aArc + 0.5) / uTexW, 0.5));
        vHead = st.r;
        vI = st.g;
        vPulse = st.b;
        vT = aT;
        vColor = aColor;

        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 tangent = normalize(mat3(modelMatrix) * aTangent);
        vec3 toCam = normalize(cameraPosition - world.xyz);
        vec3 side = normalize(cross(tangent, toCam));
        // Taper so arcs grow out of their nodes instead of butting into them.
        float taper = pow(sin(aT * 3.14159265), 0.4);
        world.xyz += side * aSide * uWidth * taper * (0.55 + vI * 0.75);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vT;
      varying float vHead;
      varying float vI;
      varying float vPulse;
      varying vec3 vColor;
      void main() {
        if (vI < 0.002) discard;
        float body = 1.0 - smoothstep(vHead - 0.14, vHead, vT);
        float head = exp(-pow((vT - vHead) / 0.05, 2.0));
        float drawn = step(vT, vHead + 0.02);
        float p1 = exp(-pow((vT - vPulse) / 0.035, 2.0));
        float p2 = exp(-pow((vT - fract(vPulse + 0.5)) / 0.035, 2.0)) * 0.6;
        float pulse = (p1 + p2) * drawn;
        float ends = smoothstep(0.0, 0.05, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
        float alpha = vI * ends * (body * 0.40 + head * 0.85 + pulse * 1.25);
        if (alpha < 0.004) discard;
        vec3 col = mix(vColor, vec3(1.0), min(1.0, pulse * 0.85 + head * 0.6));
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
  });

  return { geometry, material, stateData, stateTex };
})();

/* -------------------------------------------------------------------------- */
/* Node sprites                                                                */
/* -------------------------------------------------------------------------- */

const nodes = (() => {
  const count = NODES.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const kinds = new Float32Array(count);
  const ids = new Float32Array(count);
  const colour = new THREE.Color();

  NODES.forEach((node, i) => {
    const [x, y, z] = nodePosition(node, node.kind === "agent" ? 1.024 : 1.016);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colour.set(
      node.kind === "agent"
        ? FAMILY_HEX[node.family]
        : node.kind === "origin"
          ? "#ffd479"
          : GATHER_HEX,
    );
    colors[i * 3] = colour.r;
    colors[i * 3 + 1] = colour.g;
    colors[i * 3 + 2] = colour.b;
    kinds[i] = node.kind === "agent" ? 1 : node.kind === "origin" ? 2 : 0;
    ids[i] = i;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("aId", new THREE.BufferAttribute(ids, 1));
  geometry.computeBoundingSphere();

  // RGBA per node: intensity · size boost · flash · spare.
  const stateData = new Float32Array(NODE_TEX_W * 4);
  const stateTex = new THREE.DataTexture(
    stateData,
    NODE_TEX_W,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  stateTex.minFilter = THREE.NearestFilter;
  stateTex.magFilter = THREE.NearestFilter;
  stateTex.needsUpdate = true;

  const uniforms = {
    uState: { value: stateTex },
    uTexW: { value: NODE_TEX_W },
    uPixelRatio: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform sampler2D uState;
      uniform float uTexW;
      uniform float uPixelRatio;
      attribute vec3 aColor;
      attribute float aKind;
      attribute float aId;
      varying vec3 vColor;
      varying float vI;
      varying float vFlash;
      void main() {
        vec4 st = texture2D(uState, vec2((aId + 0.5) / uTexW, 0.5));
        vI = st.r;
        vFlash = st.b;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float base = aKind > 1.5 ? 13.0 : aKind > 0.5 ? 11.0 : 6.0;
        gl_PointSize = (base + st.g * 9.0) * uPixelRatio * (2.7 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vI;
      varying float vFlash;
      void main() {
        if (vI < 0.01) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = smoothstep(0.45, 0.0, r);
        float halo = smoothstep(1.0, 0.12, r) * 0.42;
        vec3 col = mix(vColor, vec3(1.0), core * 0.7 + vFlash * 0.5);
        gl_FragColor = vec4(col, (core + halo) * vI);
        #include <colorspace_fragment>
      }
    `,
  });

  return { geometry, material, uniforms, stateData, stateTex };
})();

/* -------------------------------------------------------------------------- */
/* Surface ripple at the ingest point                                          */
/* -------------------------------------------------------------------------- */

const ripple = (() => {
  // A disc with real radial subdivision, not a 64-vertex fan: every vertex is
  // pushed onto the sphere, so the patch curves with the surface instead of
  // chording flat across it.
  // Wide enough that the ring itself is what the eye reads as the wave. The
  // land dots pulse along with it, but they can only light where there is
  // land, so leaving them to carry the shape gave a ragged, coastline-shaped
  // blob rather than a circle.
  const geometry = new THREE.RingGeometry(0, 0.95, 128, 22);
  const uniforms = {
    uT: { value: 0 },
    uAmp: { value: 0 },
    uColor: { value: new THREE.Color("#ffd479") },
    uRadius: { value: 1.004 },
    /** Angular radius of the patch: atan(R) for a disc sitting at radius 1. */
    uMaxAngle: { value: Math.atan(0.95) },
    uLightDir: { value: LIGHT_DIR },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uRadius;
      varying float vAngle;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 n = normalize(world);
        // Distance measured ALONG the sphere from the ingest point, so the
        // rings are true circles on the surface and foreshorten toward the
        // limb the way the land dots do.
        vec3 centre = normalize((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
        vAngle = acos(clamp(dot(n, centre), -1.0, 1.0));
        vNormal = n;
        vWorld = n * uRadius;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT;
      uniform float uAmp;
      uniform float uMaxAngle;
      uniform vec3 uColor;
      uniform vec3 uLightDir;
      varying float vAngle;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        if (uAmp < 0.01) discard;
        float r = vAngle / uMaxAngle;
        float a = 0.0;
        for (int i = 0; i < 2; i++) {
          float p = fract(uT + float(i) * 0.5);
          a += exp(-pow((r - p) / 0.07, 2.0)) * (1.0 - p * 0.75);
        }
        a *= smoothstep(1.0, 0.86, r);
        // Sit in the globe's own light, but only just: a strong day/night term
        // across a patch straddling the terminator lights one flank and drops
        // the other out of sight, which reads as a crescent, not a ring.
        float light = max(dot(vNormal, normalize(uLightDir)), 0.0);
        a *= 0.78 + 0.22 * smoothstep(0.0, 0.7, light);
        // Fade only what is genuinely at the horizon, so the ring stays whole
        // until the globe's own curve takes it.
        float facing = dot(vNormal, normalize(cameraPosition - vWorld));
        a *= smoothstep(-0.02, 0.16, facing);
        gl_FragColor = vec4(uColor, a * uAmp * 0.85);
        #include <colorspace_fragment>
      }
    `,
  });
  return { geometry, material, uniforms };
})();

/* -------------------------------------------------------------------------- */
/* Scene body                                                                  */
/* -------------------------------------------------------------------------- */

const TMP = new THREE.Vector3();
const CAM_DIR = new THREE.Vector3();
/** The ripple disc faces +Z; these turn it to face its point on the globe. */
const DISC_FORWARD = new THREE.Vector3(0, 0, 1);
const DISC_DIR = new THREE.Vector3();
/** Reduced motion parks the cycle here — mid-deliberation, network at its busiest. */
const STILL_FRAME_MS = 9200;

function SceneBody({
  clock,
  drag,
  originIndex,
  spotlightIndex,
  reduced,
  onAnchor,
}: Omit<SwarmSceneProps, "paused" | "reduced"> & { reduced: boolean }) {
  const tiltRef = React.useRef<THREE.Group>(null);
  const spinRef = React.useRef<THREE.Group>(null);
  const rippleRef = React.useRef<THREE.Mesh>(null);
  /** How much of the hand's yaw this scene has already applied. */
  const appliedYaw = React.useRef(0);

  const { gl, camera, size, invalidate } = useThree();

  // Keep point sizes stable across DPR changes and window resizes.
  React.useEffect(() => {
    const dpr = gl.getPixelRatio();
    land.uniforms.uPixelRatio.value = dpr;
    nodes.uniforms.uPixelRatio.value = dpr;
    invalidate();
  }, [gl, invalidate, size]);

  // Park the ripple disc on this cycle's ingest point, facing outward.
  React.useEffect(() => {
    const node = NODES[ORIGIN_OFFSET + originIndex];
    const mesh = rippleRef.current;
    if (!node || !mesh) return;
    const [x, y, z] = nodePosition(node, 1);
    mesh.position.set(x, y, z);
    // Orient in the PARENT's space. `lookAt` aims in WORLD space, so with the
    // globe tilted and spinning it pointed the patch somewhere off the node
    // entirely — the projected ring came out lopsided and clipped, and drifted
    // further out of true as the globe turned.
    mesh.quaternion.setFromUnitVectors(DISC_FORWARD, DISC_DIR.set(x, y, z).normalize());
    land.uniforms.uClaim.value.set(x, y, z).normalize();
    invalidate();
  }, [originIndex, invalidate]);

  useFrame((state, delta) => {
    const cycleT = reduced
      ? STILL_FRAME_MS
      : Math.min(CYCLE_MS, Math.max(0, performance.now() - clock.current.start));
    const seconds = cycleT / 1000;

    const spin = spinRef.current;
    const tilt = tiltRef.current;
    // Hand-spin: apply however much yaw the hand has asked for since the last
    // frame (its coast after release included) and pause the idle drift while
    // the pointer is down. The stage owns that state; this only reads it.
    const hand = drag?.current;
    const dragging = hand?.active === true;
    if (spin) {
      const yaw = hand?.yaw ?? 0;
      spin.rotation.y += yaw - appliedYaw.current;
      appliedYaw.current = yaw;
      if (!dragging && !reduced) spin.rotation.y += delta * 0.055;
    }
    if (tilt) {
      const pitch = hand?.pitch ?? 0;
      // The parallax lean freezes while dragging, so the two cannot fight over
      // the same axis; the dragged pitch persists after release. Under the hand
      // the tilt tracks about five times harder than the idle lean, so pulling
      // up or down answers as directly as pulling sideways does.
      const k = Math.min(1, delta * (dragging ? 12 : 2.4));
      if (!dragging) {
        const px = reduced ? 0 : state.pointer.x;
        const py = reduced ? 0 : state.pointer.y;
        tilt.rotation.y += (px * 0.22 - tilt.rotation.y) * k;
        tilt.rotation.x += (0.2 - py * 0.16 + pitch - tilt.rotation.x) * k;
      } else {
        tilt.rotation.x += (0.2 + pitch - tilt.rotation.x) * k;
      }
    }

    /* ---- arcs ---------------------------------------------------------- */
    const arcState = arcs.stateData;
    for (let i = 0; i < ARCS.length; i++) {
      const arc = ARCS[i];
      if (!arc) continue;
      const win = ARC_WINDOWS[arc.group];
      let intensity = envelope(cycleT, win[0], win[1], 620, 760);
      if (arc.group === "seal" && arc.origin !== originIndex) intensity = 0;

      let head = 0;
      let pulse = 0;
      if (intensity > 0.002) {
        if (arc.group === "gather") {
          // Evidence flows source → juror, staggered so it reads as a crawl.
          head = easeOut((cycleT - (win[0] + arc.seed * 9000)) / 1100);
          pulse = (seconds * 0.62 + arc.seed * 6.1) % 1;
          intensity *= 0.85;
        } else if (arc.group === "debate") {
          head = easeOut((cycleT - (win[0] + arc.seed * 6000)) / 800);
          // Challenges travel out and answers come straight back.
          pulse = pingPong(seconds * 0.5 + arc.seed * 7.3);
          intensity *= 0.62;
        } else {
          // Sealed votes converge on the claim.
          head = easeOut((cycleT - (win[0] + arc.seed * 3200)) / 900);
          pulse = (seconds * 0.78 + arc.seed * 4.7) % 1;
          intensity *= 0.92;
        }
      }

      arcState[i * 4] = head;
      arcState[i * 4 + 1] = intensity;
      arcState[i * 4 + 2] = pulse;
    }
    arcs.stateTex.needsUpdate = true;

    /* ---- nodes --------------------------------------------------------- */
    const nodeState = nodes.stateData;
    const gatherOn = envelope(cycleT, 2000, 8000, 700, 900);
    const juryOn = envelope(cycleT, 1400, CYCLE_MS, 900, 1400);
    const verdictOn = envelope(cycleT, 13800, CYCLE_MS, 500, 900);

    for (let i = 0; i < NODES.length; i++) {
      const node = NODES[i];
      if (!node) continue;
      let intensity: number;
      let boost = 0;
      let flash = 0;

      if (node.kind === "agent") {
        const a = i - AGENT_OFFSET;
        const breathe = 0.5 + 0.5 * Math.sin(seconds * 2.1 + a * 1.7);
        intensity = 0.34 + juryOn * (0.5 + breathe * 0.3);
        boost = juryOn * (0.9 + breathe * 1.4) + verdictOn * 1.6;
        flash = verdictOn * 0.8;
        if (a === spotlightIndex) {
          intensity += 0.35;
          boost += 2.6;
        }
      } else if (node.kind === "origin") {
        const active = i - ORIGIN_OFFSET === originIndex;
        const appear = envelope(cycleT, 200, CYCLE_MS, 700, 900);
        intensity = active ? appear * (0.85 + 0.15 * Math.sin(seconds * 3.4)) : 0;
        boost = active ? appear * 1.8 + verdictOn * 3.4 : 0;
        flash = active ? verdictOn : 0;
      } else {
        const s = i - SOURCE_OFFSET;
        const breathe = 0.5 + 0.5 * Math.sin(seconds * 1.6 + s * 0.9);
        intensity = 0.16 + gatherOn * (0.44 + breathe * 0.3);
        boost = gatherOn * (0.5 + breathe * 0.6);
      }

      nodeState[i * 4] = intensity;
      nodeState[i * 4 + 1] = boost;
      nodeState[i * 4 + 2] = flash;
    }
    nodes.stateTex.needsUpdate = true;

    /* ---- surface waves -------------------------------------------------- */
    const claimWave = envelope(cycleT, 250, 3400, 250, 1200);
    const settleWave = envelope(cycleT, 13900, CYCLE_MS, 220, 1400);
    const lu = land.uniforms;
    // The dots pulse WITH the ring rather than instead of it: they can only
    // light where there is land, so at full strength they were the loudest
    // thing on screen and the wave took the shape of the coastline.
    if (settleWave > claimWave) {
      lu.uWaveR.value = 0.12 + ((cycleT - 13900) / 2600) * 2.1;
      lu.uWaveAmp.value = settleWave * 0.62;
      lu.uWaveColor.value.set("#8dffc4");
    } else {
      lu.uWaveR.value = 0.12 + ((cycleT - 250) / 2900) * 2.1;
      lu.uWaveAmp.value = claimWave * 0.62;
      lu.uWaveColor.value.set("#ffe9b0");
    }

    const ru = ripple.uniforms;
    ru.uT.value = (seconds * 0.55) % 1;
    ru.uAmp.value = Math.max(
      envelope(cycleT, 150, 8200, 500, 1600) * 0.9,
      envelope(cycleT, 13600, CYCLE_MS, 300, 1200),
    );
    ru.uColor.value.set(settleWave > 0.05 ? "#9dffd0" : "#ffd479");

    /* ---- HUD anchors ---------------------------------------------------- */
    if (onAnchor && spin) {
      CAM_DIR.copy(camera.position).normalize();
      const project = (id: AnchorId, local: [number, number, number]) => {
        TMP.set(local[0], local[1], local[2]).applyMatrix4(spin.matrixWorld);
        const facing = TMP.dot(CAM_DIR) / (TMP.length() || 1);
        TMP.project(camera);
        onAnchor(
          id,
          (TMP.x * 0.5 + 0.5) * size.width,
          (-TMP.y * 0.5 + 0.5) * size.height,
          clamp01((facing - 0.08) * 5),
        );
      };
      const originNode = NODES[ORIGIN_OFFSET + originIndex];
      const agentNode = AGENT_NODES[spotlightIndex % AGENT_NODES.length];
      if (originNode) project("origin", nodePosition(originNode, 1.05));
      if (agentNode) project("agent", nodePosition(agentNode, 1.06));
    }
  });

  return (
    <group ref={tiltRef} rotation={[0.2, 0, -0.26]}>
      <group ref={spinRef} rotation={[0, -1.22, 0]}>
        <mesh material={earthMaterial}>
          <sphereGeometry args={[0.995, 64, 48]} />
        </mesh>
        {/* Under the dots, so a dot always paints over the links it holds. */}
        <lineSegments geometry={web.geometry} material={web.material} />
        <points geometry={land.geometry} material={land.material} />
        <mesh ref={rippleRef} geometry={ripple.geometry} material={ripple.material} />
        <mesh geometry={arcs.geometry} material={arcs.material} />
        <points geometry={nodes.geometry} material={nodes.material} />
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Canvas shell                                                                */
/* -------------------------------------------------------------------------- */

export default function SwarmScene({
  clock,
  drag,
  originIndex,
  spotlightIndex,
  paused = false,
  reduced = false,
  onAnchor,
}: SwarmSceneProps) {
  return (
    <Canvas
      // DPR is capped: the hero must not melt an integrated GPU.
      dpr={[1, 1.75]}
      frameloop={paused || reduced ? "demand" : "always"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      // Framed so the globe plus its atmosphere clears the HUD gutters.
      camera={{ position: [0, 0, 4.35], fov: 32, near: 0.1, far: 20 }}
    >
      <SceneBody
        clock={clock}
        drag={drag}
        originIndex={originIndex}
        spotlightIndex={spotlightIndex}
        reduced={reduced}
        onAnchor={onAnchor}
      />
    </Canvas>
  );
}

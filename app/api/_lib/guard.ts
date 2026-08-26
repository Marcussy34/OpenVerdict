import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Write-endpoint guards. The engine signs with the OPERATOR key, so write
 * routes must never be callable by anonymous traffic unless explicitly opened:
 * - Operator routes (claim create, evidence admin): Bearer OPENVERDICT_OPERATOR_TOKEN.
 * - Public routes (fact-check, evidence submit): OPENVERDICT_PUBLIC_WRITES=enabled
 *   plus best-effort rate limiting. Production must add an edge limiter.
 *
 * Security notes (from review):
 * - x-forwarded-for is attacker-controlled unless a trusted proxy sets it, so
 *   per-IP keying only applies when OPENVERDICT_TRUST_PROXY=1; otherwise all
 *   traffic shares one global bucket that header spoofing cannot bypass.
 * - The hit map is bounded and swept; keys are hashed so raw client IPs are
 *   never retained in process memory.
 * - Operator-auth failures return one uniform 403 so responses do not reveal
 *   whether a token is configured.
 */

function uniformForbidden(): NextResponse {
  return NextResponse.json(
    { error: "forbidden", message: "not authorized for this action" },
    { status: 403 },
  );
}

export function requireOperatorToken(req: Request): NextResponse | null {
  const expected = process.env.OPENVERDICT_OPERATOR_TOKEN ?? "";
  // Missing/weak token keeps operator writes closed — same response shape.
  if (expected.length < 16) return uniformForbidden();

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Compare fixed-length digests: constant-time and length-independent.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return uniformForbidden();
  return null;
}

export function requirePublicWritesEnabled(): NextResponse | null {
  if (process.env.OPENVERDICT_PUBLIC_WRITES !== "enabled") {
    return NextResponse.json(
      { error: "writes_disabled", message: "public submissions are disabled" },
      { status: 403 },
    );
  }
  return null;
}

// Fixed-window in-memory limiter: fine for one dev/demo process only.
const WINDOW_MS = 60_000;
const MAX_PER_KEY = 5;
const MAX_GLOBAL = 60;
const MAX_TRACKED_KEYS = 10_000;

type Window = { windowStart: number; count: number };
const perKeyHits = new Map<string, Window>();
const globalHits: Window = { windowStart: 0, count: 0 };

function bump(window: Window, now: number): number {
  if (now - window.windowStart > WINDOW_MS) {
    window.windowStart = now;
    window.count = 0;
  }
  window.count += 1;
  return window.count;
}

function sweep(now: number): void {
  if (perKeyHits.size <= MAX_TRACKED_KEYS) return;
  for (const [key, window] of perKeyHits) {
    if (now - window.windowStart > WINDOW_MS) perKeyHits.delete(key);
  }
  // Under sustained key-churn attack, drop the table rather than grow it.
  if (perKeyHits.size > MAX_TRACKED_KEYS) perKeyHits.clear();
}

export function rateLimitPublic(req: Request): NextResponse | null {
  const now = Date.now();

  // Global ceiling first — spoofed headers cannot route around it.
  if (bump(globalHits, now) > MAX_GLOBAL) {
    return NextResponse.json(
      { error: "rate_limited", message: "too many submissions, retry later" },
      { status: 429 },
    );
  }

  // Per-client bucket only when a trusted proxy provides the client IP.
  if (process.env.OPENVERDICT_TRUST_PROXY === "1") {
    const rawIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = createHash("sha256").update(rawIp).digest("base64url");
    sweep(now);
    let window = perKeyHits.get(key);
    if (!window) {
      window = { windowStart: now, count: 0 };
      perKeyHits.set(key, window);
    }
    if (bump(window, now) > MAX_PER_KEY) {
      return NextResponse.json(
        { error: "rate_limited", message: "too many submissions, retry later" },
        { status: 429 },
      );
    }
  }
  return null;
}

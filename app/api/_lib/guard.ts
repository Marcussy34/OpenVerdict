import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Write-endpoint guards. The engine signs with the OPERATOR key, so write
 * routes must never be callable by anonymous traffic unless explicitly opened:
 * - Operator routes (claim create, evidence admin): Bearer OPENVERDICT_OPERATOR_TOKEN.
 * - Public routes (fact-check, evidence submit): OPENVERDICT_PUBLIC_WRITES=enabled
 *   plus a best-effort per-IP rate limit. Production must add an edge limiter.
 */

export function requireOperatorToken(req: Request): NextResponse | null {
  const expected = process.env.OPENVERDICT_OPERATOR_TOKEN ?? "";
  if (expected.length < 16) {
    // No (or too-weak) token configured — operator writes stay closed.
    return NextResponse.json(
      { error: "writes_disabled", message: "operator writes are not enabled" },
      { status: 403 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: "unauthorized", message: "invalid operator token" },
      { status: 401 },
    );
  }
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
const MAX_PER_WINDOW = 5;
const hits = new Map<string, { windowStart: number; count: number }>();

export function rateLimitPublic(req: Request): NextResponse | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { windowStart: now, count: 1 });
    return null;
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) {
    return NextResponse.json(
      { error: "rate_limited", message: "too many submissions, retry later" },
      { status: 429 },
    );
  }
  return null;
}

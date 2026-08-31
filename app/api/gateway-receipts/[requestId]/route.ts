import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

// GonkaRouter's public lookup: metadata only, no auth, no content. The browser
// cannot call it directly yet (no CORS upstream), so this thin proxy relays
// the receipt and the UI also prints the direct URL for independent checks.
const UPSTREAM = "https://api.gonkarouter.io/v1/receipts/";
const REQUEST_ID_PATTERN = /^req-[0-9-]{8,80}$/;

// A receipt for a finished request never changes; cache it like the proofs.
const RECEIPT_CACHE = new Map<string, unknown>();
const RECEIPT_CACHE_LIMIT = 500;
const IMMUTABLE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

export async function GET(_request: Request, context: RouteContext) {
  const { requestId } = await context.params;
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    return NextResponse.json(
      { error: "validation_error", message: "requestId must look like req-..." },
      { status: 400 },
    );
  }

  const cached = RECEIPT_CACHE.get(requestId);
  if (cached !== undefined) {
    return NextResponse.json(cached, { status: 200, headers: IMMUTABLE_HEADERS });
  }

  try {
    const upstream = await fetch(`${UPSTREAM}${encodeURIComponent(requestId)}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (upstream.status === 404) {
      return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });
    }
    if (upstream.status === 429) {
      return NextResponse.json({ error: "gateway_rate_limited" }, { status: 429 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "gateway_error", status: upstream.status },
        { status: 502 },
      );
    }
    const receipt: unknown = await upstream.json();
    if (RECEIPT_CACHE.size >= RECEIPT_CACHE_LIMIT) {
      const oldest = RECEIPT_CACHE.keys().next().value;
      if (oldest !== undefined) RECEIPT_CACHE.delete(oldest);
    }
    RECEIPT_CACHE.set(requestId, receipt);
    return NextResponse.json(receipt, { status: 200, headers: IMMUTABLE_HEADERS });
  } catch {
    return NextResponse.json({ error: "gateway_unreachable" }, { status: 502 });
  }
}

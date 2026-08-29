import { NextResponse, type NextRequest } from "next/server";

import { rewritePathForHost } from "./lib/web/host-routing";

/**
 * Next.js 16 proxy (formerly middleware): app.openverdict.info opens the
 * dashboard directly while openverdict.info keeps the landing page. Behind
 * Railway's edge the original host arrives in x-forwarded-host.
 */
export function proxy(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const target = rewritePathForHost(host, request.nextUrl.pathname);
  if (target === null) return NextResponse.next();
  return NextResponse.rewrite(new URL(target, request.url));
}

export const config = {
  // Only the root path can be rewritten; nothing else pays the proxy cost.
  matcher: "/",
};

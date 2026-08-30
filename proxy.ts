import { NextResponse, type NextRequest } from "next/server";

import {
  redirectForHost,
  rewritePathForHost,
} from "./lib/web/host-routing";

/**
 * Next.js 16 proxy: redirects www to the apex, sends apex console paths to the
 * app host, and rewrites the app-host root to /app. Two-host redirects are
 * no-ops when NEXT_PUBLIC_APP_URL is unset. Railway supplies the original host
 * through x-forwarded-host.
 */
export function proxy(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const redirectTarget = redirectForHost(
    host,
    request.nextUrl.pathname,
    request.nextUrl.search,
    process.env.NEXT_PUBLIC_APP_URL,
  );
  if (redirectTarget !== null) {
    return NextResponse.redirect(redirectTarget, 308);
  }

  const target = rewritePathForHost(host, request.nextUrl.pathname);
  if (target === null) return NextResponse.next();
  return NextResponse.rewrite(new URL(target, request.url));
}

export const config = {
  // Cover pages while skipping API routes, Next assets, and file requests.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};

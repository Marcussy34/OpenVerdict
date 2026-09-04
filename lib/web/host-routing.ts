/**
 * Host-based routing: openverdict.info is the landing page,
 * app.openverdict.info opens the dashboard directly and docs.openverdict.info
 * serves the technical documentation. Only the root path of an `app.` host is
 * rewritten; every other path is served as requested, so the same deployment
 * serves all three hostnames.
 */
export const APP_HOST_PREFIX = "app.";
export const DOCS_HOST_PREFIX = "docs.";
export const DASHBOARD_PATH = "/app";
export const DOCS_PATH = "/docs";
export const CONSOLE_PATHS: readonly string[] = [
  "/app",
  "/claims",
  "/agents",
  "/verify",
  "/status",
  "/fact-check",
  "/evidence",
  "/learn",
];

/**
 * Documentation slugs that also name a console route. On the docs host these
 * stay local, because docs.openverdict.info/agents is the "Agents" page of the
 * documentation, not the console directory. `host-routing.test.ts` reads
 * docs/site and fails when a new page adds a collision this list misses.
 */
export const DOCS_PAGE_CONSOLE_PATHS: readonly string[] = ["/agents"];

/** Returns the path to rewrite to, or null when the request passes through. */
export function rewritePathForHost(
  host: string | null | undefined,
  pathname: string,
): string | null {
  if (!host) return null;
  // Hosts may arrive with a port (local runs, some proxies); compare the name.
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  // The docs host serves nothing but the documentation, so every path it is
  // asked for is one of its pages: "/" is the index and "/trust-model" is
  // "/docs/trust-model". A path that already names /docs passes straight
  // through, so a link copied from another host never doubles the prefix.
  if (hostname.startsWith(DOCS_HOST_PREFIX)) return docsPathForRequest(pathname);
  if (!hostname.startsWith(APP_HOST_PREFIX)) return null;
  return pathname === "/" ? DASHBOARD_PATH : null;
}

/** True when this request arrived on the documentation host. */
export function isDocsHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  return hostname.startsWith(DOCS_HOST_PREFIX);
}

/** The /docs path a docs-host request maps to, or null when it already is one. */
function docsPathForRequest(pathname: string): string | null {
  if (pathname === DOCS_PATH || pathname.startsWith(`${DOCS_PATH}/`)) return null;
  return pathname === "/" ? DOCS_PATH : `${DOCS_PATH}${pathname}`;
}

/** Matches a console route itself or one of its nested paths. */
export function isConsolePath(pathname: string): boolean {
  return CONSOLE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** Returns the canonical redirect target, or null when routing stays local. */
export function redirectForHost(
  host: string | null | undefined,
  pathname: string,
  search: string,
  appUrl: string | undefined,
): string | null {
  if (!appUrl) return null;

  let configuredAppUrl: URL;
  try {
    configuredAppUrl = new URL(appUrl);
  } catch {
    return null;
  }

  if (
    configuredAppUrl.protocol !== "http:" &&
    configuredAppUrl.protocol !== "https:"
  ) {
    return null;
  }

  const appHost = configuredAppUrl.hostname.toLowerCase();
  if (!appHost.startsWith(APP_HOST_PREFIX)) return null;

  const apex = appHost.slice(APP_HOST_PREFIX.length);
  const wwwHost = `www.${apex}`;
  const appOrigin = configuredAppUrl.origin;
  if (!host) return null;
  // Hosts may arrive with a port; canonical decisions only use the name.
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return null;

  if (hostname === wwwHost) {
    return `https://${apex}${pathname}${search}`;
  }
  // The apex and the docs host both hand console paths to the app host: the
  // footer's links are relative, so "Claims" clicked on docs.openverdict.info
  // would otherwise be rewritten to /docs/claims and 404 (owner report). The
  // header builds absolute links there instead, so it needs no hop.
  const onDocsHost = hostname === `${DOCS_HOST_PREFIX}${apex}`;
  // One exception: a path that names a documentation page stays where it is.
  const isDocsPage = onDocsHost && DOCS_PAGE_CONSOLE_PATHS.includes(pathname);
  if (
    (hostname === apex || onDocsHost) &&
    isConsolePath(pathname) &&
    !isDocsPage
  ) {
    return `${appOrigin}${pathname === "/app" ? "/" : pathname}${search}`;
  }
  return null;
}

/**
 * Host-based routing: openverdict.info is the landing page and
 * app.openverdict.info opens the dashboard directly. Only the root path of an
 * `app.` host is rewritten; every other path is served as requested, so the
 * same deployment serves both hostnames.
 */
export const APP_HOST_PREFIX = "app.";
export const DASHBOARD_PATH = "/app";
export const CONSOLE_PATHS: readonly string[] = [
  "/app",
  "/claims",
  "/agents",
  "/verify",
  "/status",
  "/fact-check",
  "/evidence",
];

/** Returns the path to rewrite to, or null when the request passes through. */
export function rewritePathForHost(
  host: string | null | undefined,
  pathname: string,
): string | null {
  if (!host) return null;
  // Hosts may arrive with a port (local runs, some proxies); compare the name.
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname.startsWith(APP_HOST_PREFIX)) return null;
  return pathname === "/" ? DASHBOARD_PATH : null;
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
  if (hostname === apex && isConsolePath(pathname)) {
    return `${appOrigin}${pathname === "/app" ? "/" : pathname}${search}`;
  }
  return null;
}

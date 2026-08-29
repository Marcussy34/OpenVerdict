/**
 * Host-based routing: openverdict.info is the landing page and
 * app.openverdict.info opens the dashboard directly. Only the root path of an
 * `app.` host is rewritten; every other path is served as requested, so the
 * same deployment serves both hostnames.
 */
export const APP_HOST_PREFIX = "app.";
export const DASHBOARD_PATH = "/app";

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

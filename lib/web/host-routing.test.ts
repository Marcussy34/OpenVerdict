import { describe, expect, it } from "vitest";

import {
  CONSOLE_PATHS,
  isConsolePath,
  isDocsHost,
  redirectForHost,
  rewritePathForHost,
} from "./host-routing";

describe("host-based routing", () => {
  it("sends the root of the app host to the dashboard", () => {
    expect(rewritePathForHost("app.openverdict.info", "/")).toBe("/app");
    expect(rewritePathForHost("APP.openverdict.info:3000", "/")).toBe("/app");
  });

  it("leaves every other path on the app host untouched", () => {
    expect(rewritePathForHost("app.openverdict.info", "/claims")).toBeNull();
    expect(rewritePathForHost("app.openverdict.info", "/app")).toBeNull();
  });

  it("never rewrites the landing host or an unknown host", () => {
    expect(rewritePathForHost("openverdict.info", "/")).toBeNull();
    expect(rewritePathForHost("www.openverdict.info", "/")).toBeNull();
    expect(rewritePathForHost("app-production-b800.up.railway.app", "/")).toBeNull();
    expect(rewritePathForHost(null, "/")).toBeNull();
  });
});

describe("the documentation host", () => {
  it("sends the root to the docs index", () => {
    expect(rewritePathForHost("docs.openverdict.info", "/")).toBe("/docs");
    expect(rewritePathForHost("DOCS.openverdict.info:3000", "/")).toBe("/docs");
  });

  it("prefixes every other path with /docs", () => {
    expect(rewritePathForHost("docs.openverdict.info", "/trust-model")).toBe(
      "/docs/trust-model",
    );
    expect(rewritePathForHost("docs.openverdict.info", "/api")).toBe(
      "/docs/api",
    );
  });

  it("passes a path that already names /docs straight through", () => {
    expect(rewritePathForHost("docs.openverdict.info", "/docs")).toBeNull();
    expect(
      rewritePathForHost("docs.openverdict.info", "/docs/contracts"),
    ).toBeNull();
  });

  it("never rewrites the docs paths of the other hosts", () => {
    expect(rewritePathForHost("openverdict.info", "/docs")).toBeNull();
    expect(rewritePathForHost("openverdict.info", "/docs/api")).toBeNull();
    expect(rewritePathForHost("app.openverdict.info", "/docs")).toBeNull();
    expect(rewritePathForHost("app.openverdict.info", "/docs/api")).toBeNull();
    expect(rewritePathForHost("localhost:3000", "/docs")).toBeNull();
  });

  it("never redirects the docs host away", () => {
    const appUrl = "https://app.openverdict.info";
    for (const path of ["/", "/docs", "/trust-model", "/claims"]) {
      expect(redirectForHost("docs.openverdict.info", path, "", appUrl)).toBeNull();
    }
  });

  it("leaves apex and app /docs paths in place", () => {
    const appUrl = "https://app.openverdict.info";
    expect(redirectForHost("openverdict.info", "/docs", "", appUrl)).toBeNull();
    expect(
      redirectForHost("openverdict.info", "/docs/staking", "", appUrl),
    ).toBeNull();
    expect(
      redirectForHost("app.openverdict.info", "/docs", "", appUrl),
    ).toBeNull();
  });

  it("recognises the docs host by name only", () => {
    expect(isDocsHost("docs.openverdict.info")).toBe(true);
    expect(isDocsHost("DOCS.openverdict.info:3000")).toBe(true);
    expect(isDocsHost("openverdict.info")).toBe(false);
    expect(isDocsHost("app.openverdict.info")).toBe(false);
    expect(isDocsHost("localhost:3000")).toBe(false);
    expect(isDocsHost(null)).toBe(false);
  });
});

describe("console paths", () => {
  it("matches each console route and its subpaths", () => {
    for (const path of CONSOLE_PATHS) {
      expect(isConsolePath(path)).toBe(true);
      expect(isConsolePath(`${path}/child`)).toBe(true);
    }
  });

  it("does not match paths that only share a prefix", () => {
    expect(isConsolePath("/claimsx")).toBe(false);
    expect(isConsolePath("/privacy")).toBe(false);
    expect(isConsolePath("/")).toBe(false);
  });
});

describe("host redirects", () => {
  const appUrl = "https://app.openverdict.info";

  it("redirects www to the apex with the path and query preserved", () => {
    expect(
      redirectForHost(
        "www.openverdict.info",
        "/learn",
        "?x=1",
        appUrl,
      ),
    ).toBe("https://openverdict.info/learn?x=1");
  });

  it("normalizes a www host with a port", () => {
    expect(
      redirectForHost("www.openverdict.info:443", "/learn", "", appUrl),
    ).toBe("https://openverdict.info/learn");
  });

  it("redirects apex console paths to the app origin", () => {
    for (const path of CONSOLE_PATHS) {
      const targetPath = path === "/app" ? "/" : path;
      expect(redirectForHost("openverdict.info", path, "", appUrl)).toBe(
        `${appUrl}${targetPath}`,
      );
    }
    expect(
      redirectForHost(
        "openverdict.info",
        "/claims/0xabc",
        "?view=full",
        appUrl,
      ),
    ).toBe("https://app.openverdict.info/claims/0xabc?view=full");
  });

  it("leaves apex non-console paths on the landing host", () => {
    for (const path of [
      "/",
      "/privacy",
      "/api/claims",
      "/claimsx",
    ]) {
      expect(
        redirectForHost("openverdict.info", path, "", appUrl),
      ).toBeNull();
    }
  });

  it("never redirects the app host", () => {
    expect(
      redirectForHost("app.openverdict.info", "/", "", appUrl),
    ).toBeNull();
    expect(
      redirectForHost("app.openverdict.info", "/claims", "", appUrl),
    ).toBeNull();
  });

  it("never redirects Railway or local hosts", () => {
    expect(
      redirectForHost(
        "app-production-b800.up.railway.app",
        "/claims",
        "",
        appUrl,
      ),
    ).toBeNull();
    expect(
      redirectForHost("localhost:3000", "/claims", "", appUrl),
    ).toBeNull();
  });

  it("returns null when the request host is empty", () => {
    for (const host of [null, undefined, "", "   "]) {
      expect(redirectForHost(host, "/claims", "", appUrl)).toBeNull();
    }
  });

  it("returns null when the app URL is missing or invalid", () => {
    for (const invalidAppUrl of [
      undefined,
      "",
      "not a url",
      "/relative",
      "ftp://app.openverdict.info",
    ]) {
      expect(
        redirectForHost(
          "openverdict.info",
          "/claims",
          "",
          invalidAppUrl,
        ),
      ).toBeNull();
    }
  });

  it("returns null when the configured host is not an app host", () => {
    expect(
      redirectForHost(
        "www.openverdict.info",
        "/learn",
        "",
        "https://openverdict.info",
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { rewritePathForHost } from "./host-routing";

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

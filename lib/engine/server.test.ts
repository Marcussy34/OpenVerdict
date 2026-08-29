import { describe, expect, it } from "vitest";
import { readEnv } from "./server";

/**
 * Regression: Vercel (and most dashboards) persist a variable created without
 * a value as an EMPTY STRING, not as absent. `??` only falls back on
 * null/undefined, so a blank OPENVERDICT_RELEASE_MANIFEST used to survive as
 * "" and reach existsSync(""), which fails with the useless message
 * "release manifest is missing: ". Blank must mean unset.
 */
describe("readEnv", () => {
  it("falls back when the variable is absent", () => {
    expect(readEnv(undefined, "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("falls back when the variable is an empty string", () => {
    expect(readEnv("", "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("falls back when the variable is only whitespace", () => {
    expect(readEnv("   ", "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("uses a real value, trimmed of stray whitespace", () => {
    expect(readEnv(" config/release.testnet.json ", "fallback")).toBe(
      "config/release.testnet.json",
    );
  });
});

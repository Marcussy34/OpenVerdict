import { describe, expect, it } from "vitest";

import { BANNER_WIDTH, TAGLINE, TAGLINE_DETAIL, renderBanner, stripAnsi, wantsColor } from "./banner";

const LONG_COMMAND =
  "ov watch 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --for 9m --since 45 --json";

describe("banner", () => {
  it("is ASCII only, has no em dash, and fits 80 columns even with a long command", () => {
    for (const color of [false, true]) {
      const lines = renderBanner({ base: "https://app.openverdict.info", command: LONG_COMMAND, color });
      expect(lines.length).toBe(8);
      for (const line of lines) {
        const plain = stripAnsi(line);
        expect(plain.length).toBeLessThanOrEqual(BANNER_WIDTH);
        expect(plain).not.toContain("\u2014");
        // Printable ASCII only: space to tilde.
        expect([...plain].every((char) => char >= " " && char <= "~")).toBe(true);
      }
    }
  });

  it("shows the wordmark, the shield, the tagline, the host and the command", () => {
    const text = renderBanner({ base: "https://app.openverdict.info", command: "ov weather", color: false }).join("\n");
    expect(text).toContain("| (_) || '_ \\/ -_)| ' \\\\ V // -_)| '_|/ _` || |/ _||  _|");
    expect(text).toContain(" | \\  /  | ");
    expect(text).toContain(TAGLINE);
    expect(text).toContain(TAGLINE_DETAIL);
    expect(text).toContain("app.openverdict.info  |  ov weather");
    expect(text).not.toContain("swarm");
  });

  it("shortens a long command with three dots and keeps the host", () => {
    const last = renderBanner({ base: "ov.test", command: LONG_COMMAND, color: false }).at(-1)!;
    expect(last).toContain("ov.test  |  ov watch 0x273220b5");
    expect(last.endsWith("...")).toBe(true);
    expect(last.length).toBeLessThanOrEqual(BANNER_WIDTH);
  });

  it("colours only when asked and strips cleanly", () => {
    const plain = renderBanner({ base: "https://app.openverdict.info", command: "ov board", color: false });
    const coloured = renderBanner({ base: "https://app.openverdict.info", command: "ov board", color: true });
    expect(plain.some((line) => line.includes("["))).toBe(false);
    expect(coloured.some((line) => line.includes("[32m"))).toBe(true);
    expect(coloured.map(stripAnsi)).toEqual(plain);
  });

  it("decides colour from the TTY, FORCE_COLOR, NO_COLOR and --no-color", () => {
    expect(wantsColor({}, true, false)).toBe(true);
    expect(wantsColor({}, false, false)).toBe(false);
    expect(wantsColor({ FORCE_COLOR: "1" }, false, false)).toBe(true);
    expect(wantsColor({ FORCE_COLOR: "0" }, true, false)).toBe(true);
    expect(wantsColor({ NO_COLOR: "1" }, true, false)).toBe(false);
    expect(wantsColor({ FORCE_COLOR: "1" }, true, true)).toBe(false);
  });
});

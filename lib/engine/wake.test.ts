import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { touchWake, wakeFilePath, wakeStamp } from "./wake";

describe("worker wake file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openverdict-wake-"));
    process.env.OPENVERDICT_WAKE_FILE = join(dir, "wake");
  });
  afterEach(() => {
    delete process.env.OPENVERDICT_WAKE_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports 0 before the first touch and a newer stamp after each touch", async () => {
    expect(wakeFilePath()).toBe(join(dir, "wake"));
    expect(wakeStamp()).toBe(0);
    touchWake();
    const first = wakeStamp();
    expect(first).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 15));
    touchWake();
    expect(wakeStamp()).toBeGreaterThan(first);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  getServerEngine: vi.fn(),
}));

vi.mock("@/lib/engine/server", () => {
  class EngineNotWiredError extends Error {}
  return {
    EngineNotWiredError,
    getServerEngine: serverMocks.getServerEngine,
  };
});

vi.mock("@/lib/engine/wake", () => ({ touchWake: vi.fn() }));

import { POST } from "../../app/api/fact-checks/route";
import type { WeatherReport } from "./contract";

const CLAIM = "The first Bitcoin halving took place in November 2012.";

/** DeepSeek and Kimi down, MiniMax and web search up: a fresh, unclear report. */
function badWeather(): WeatherReport {
  return {
    probedAtMs: 1_757_000_000_000,
    stale: false,
    clear: false,
    families: [
      {
        modelId: "provider/DeepSeek-R1",
        family: "deepseek",
        ok: false,
        latencyMs: 60_000,
        status: "TIMEOUT",
      },
      {
        modelId: "MiniMax-M2",
        family: "minimax",
        ok: true,
        latencyMs: 210,
        status: "200",
      },
      {
        modelId: "kimi-k2",
        family: "kimi",
        ok: false,
        latencyMs: 0,
        status: "503",
      },
      {
        modelId: "research:firecrawl",
        family: "research",
        ok: true,
        latencyMs: 180,
        status: "200",
      },
    ],
  };
}

async function submit(body: unknown) {
  return POST(
    new Request("http://localhost/api/fact-checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  serverMocks.getServerEngine.mockReset();
  vi.stubEnv("OPENVERDICT_PUBLIC_WRITES", "enabled");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/fact-checks", () => {
  it("refuses bad weather with 503, the report and a Retry-After header", async () => {
    const factCheckSubmit = vi.fn().mockResolvedValue({
      kind: "refused",
      reason: "WEATHER_NOT_CLEAR",
      weather: badWeather(),
    });
    serverMocks.getServerEngine.mockResolvedValue({ factCheckSubmit });

    const response = await submit({ claim: CLAIM });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("120");
    await expect(response.json()).resolves.toEqual({
      error: "WEATHER_NOT_CLEAR",
      message: "The jury cannot sit right now: DeepSeek and Kimi are down.",
      weather: badWeather(),
    });
  });

  it("returns the claim id unchanged on clear weather", async () => {
    const claimId = `0x${"7a".repeat(32)}`;
    const factCheckSubmit = vi.fn().mockResolvedValue({ kind: "claim", claimId });
    serverMocks.getServerEngine.mockResolvedValue({ factCheckSubmit });

    const response = await submit({ claim: CLAIM });

    expect(response.status).toBe(200);
    expect(response.headers.get("Retry-After")).toBeNull();
    await expect(response.json()).resolves.toEqual({ claimId });
  });
});

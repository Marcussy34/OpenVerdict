import { describe, expect, it } from "vitest";

import type { WeatherFamily, WeatherReport } from "../engine/contract";
import { weatherFamilyLabel, weatherRefusalMessage } from "./weather-copy";

function family(
  name: string,
  ok: boolean,
  modelId = `${name}-model`,
): WeatherFamily {
  return { modelId, family: name, ok, latencyMs: 12, status: ok ? "200" : "TIMEOUT" };
}

function report(families: WeatherFamily[]): WeatherReport {
  return {
    probedAtMs: 1,
    stale: false,
    clear: families.every((entry) => entry.ok),
    families,
  };
}

describe("weatherFamilyLabel", () => {
  it("names the three model families and the web search provider", () => {
    expect(weatherFamilyLabel("deepseek", "provider/DeepSeek-R1")).toBe("DeepSeek");
    expect(weatherFamilyLabel("minimax", "MiniMax-M2")).toBe("MiniMax");
    expect(weatherFamilyLabel("kimi", "kimi-k2")).toBe("Kimi");
    expect(weatherFamilyLabel("research", "research:firecrawl")).toBe("Web search");
  });

  it("keeps the model id for anything unknown", () => {
    expect(weatherFamilyLabel("model-z", "vendor/model-z")).toBe("vendor/model-z");
  });
});

describe("weatherRefusalMessage", () => {
  it("names one down family", () => {
    expect(
      weatherRefusalMessage(report([family("deepseek", true), family("kimi", false)])),
    ).toBe("The jury cannot sit right now: Kimi is down.");
  });

  it("joins two down families with and", () => {
    expect(
      weatherRefusalMessage(
        report([family("deepseek", false), family("minimax", true), family("kimi", false)]),
      ),
    ).toBe("The jury cannot sit right now: DeepSeek and Kimi are down.");
  });

  it("comma separates three or more, web search included", () => {
    expect(
      weatherRefusalMessage(
        report([family("deepseek", false), family("kimi", false), family("research", false)]),
      ),
    ).toBe("The jury cannot sit right now: DeepSeek, Kimi and Web search are down.");
  });

  it("still reads as a sentence when no family is marked down", () => {
    expect(weatherRefusalMessage(report([]))).toBe(
      "The jury cannot sit right now: the model families are not all healthy.",
    );
  });
});

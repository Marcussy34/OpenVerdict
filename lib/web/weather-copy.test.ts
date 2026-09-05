import { describe, expect, it } from "vitest";

import type { WeatherFamily, WeatherReport } from "../engine/contract";
import {
  juryDrawRuleSentence,
  juryFamiliesLabel,
  juryRequirementSentence,
  weatherFamilyLabel,
  weatherRefusalMessage,
} from "./weather-copy";

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
    requiredFamilies: 3,
    activeFamilies: families
      .filter((entry) => entry.family !== "research")
      .map((entry) => entry.family),
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

describe("juryRequirementSentence", () => {
  it("counts the families that still hold an active seat", () => {
    const weather = report([family("deepseek", true), family("minimax", true)]);
    expect(juryRequirementSentence(weather)).toBe(
      "A jury needs every active model family (2 today) and web search.",
    );
  });

  it("drops the count when no report has arrived yet", () => {
    expect(juryRequirementSentence(null)).toBe(
      "A jury needs every active model family and web search.",
    );
  });
});

describe("juryFamiliesLabel", () => {
  it("names degraded mode when fewer than three families sat", () => {
    expect(
      juryFamiliesLabel({ familyCount: 2, requiredFamilies: 2, degraded: true }),
    ).toBe("2 model families (degraded mode)");
  });

  it("adds nothing when three families sat", () => {
    expect(
      juryFamiliesLabel({ familyCount: 3, requiredFamilies: 3, degraded: false }),
    ).toBe("3 model families");
  });

  it("says nothing at all when the committee is unknown", () => {
    expect(juryFamiliesLabel(undefined)).toBe("");
  });
});

describe("juryDrawRuleSentence", () => {
  it("names degraded mode, its numbers and who set them", () => {
    expect(
      juryDrawRuleSentence({ familyCount: 2, requiredFamilies: 2, degraded: true }),
    ).toBe(
      "Two model families, at most three seats per model: degraded mode, set on chain by the operator while a family is down.",
    );
  });

  it("keeps the full rule when three families sat", () => {
    expect(
      juryDrawRuleSentence({ familyCount: 3, requiredFamilies: 3, degraded: false }),
    ).toBe("At most two seats per model family, three families in every jury.");
  });

  it("reads as the full rule before the draw is known", () => {
    expect(juryDrawRuleSentence(undefined)).toBe(
      "At most two seats per model family, three families in every jury.",
    );
  });
});

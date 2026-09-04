/**
 * One place for the public names of the model families and for the sentence a
 * refused submission carries. The API route, the weather strip and the
 * fact-check form all read from here so a family is never called two things.
 */

import type { WeatherReport } from "../engine/contract";

/** Canonical display name for a family; anything unknown keeps its model id. */
export function weatherFamilyLabel(family: string, modelId: string): string {
  const normalized = family.toLowerCase();
  if (normalized === "deepseek") return "DeepSeek";
  if (normalized === "minimax") return "MiniMax";
  if (normalized === "kimi") return "Kimi";
  if (normalized === "research") return "Web search";
  return modelId || family;
}

/** "DeepSeek", "DeepSeek and Kimi", "DeepSeek, Kimi and Web search". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The one sentence a refusal says, naming the families that are down. The
 * report is never clear when this is called, so at least one family failed;
 * an empty list still reads as a sentence rather than a dangling colon.
 */
export function weatherRefusalMessage(weather: WeatherReport): string {
  const down = weather.families
    .filter((family) => !family.ok)
    .map((family) => weatherFamilyLabel(family.family, family.modelId));
  if (down.length === 0) {
    return "The jury cannot sit right now: the model families are not all healthy.";
  }
  return `The jury cannot sit right now: ${joinNames(down)} ${
    down.length === 1 ? "is" : "are"
  } down.`;
}

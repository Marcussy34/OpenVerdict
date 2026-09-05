/**
 * One place for the public names of the model families and for the sentence a
 * refused submission carries. The API route, the weather strip and the
 * fact-check form all read from here so a family is never called two things.
 */

import type { JuryDiversitySummary, WeatherReport } from "../engine/contract";

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

/**
 * What a jury needs today, in one sentence. The count is the families that
 * still hold an active seat, so it says two while the operator runs degraded
 * mode and three the rest of the time.
 */
export function juryRequirementSentence(weather: WeatherReport | null | undefined): string {
  const active = weather?.activeFamilies.length ?? 0;
  if (active === 0) return "A jury needs every active model family and web search.";
  return `A jury needs every active model family (${active} today) and web search.`;
}

/**
 * How many model families judged a claim, and whether that was degraded mode.
 * Empty when the committee is unknown, so a caller can print nothing at all.
 */
export function juryFamiliesLabel(
  jury: JuryDiversitySummary | undefined,
): string {
  if (jury === undefined || jury.familyCount === 0) return "";
  const families = `${jury.familyCount} model ${jury.familyCount === 1 ? "family" : "families"}`;
  return jury.degraded ? `${families} (degraded mode)` : families;
}

/**
 * The draw rule a committee actually sat under, for the line under the seat
 * draw. Degraded mode names itself and says who lowered it. A five-seat jury
 * spread over two families must let one family hold three seats, so the pair
 * the operator sets on chain is two families and three seats per model.
 */
export function juryDrawRuleSentence(
  jury: JuryDiversitySummary | undefined,
): string {
  if (jury?.degraded !== true) {
    return "At most two seats per model family, three families in every jury.";
  }
  return "Two model families, at most three seats per model: degraded mode, set on chain by the operator while a family is down.";
}

/**
 * Probe latency in the unit a reader can feel: whole milliseconds under a
 * second, one decimal of a second above it.
 */
export function weatherLatencyLabel(latencyMs: number): string {
  const ms = Math.max(0, Math.round(latencyMs));
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

/**
 * How old the newest probe is. Without a probe time the page has to say so
 * rather than print an age it cannot know.
 */
export function weatherProbedAgoLabel(
  probedAtMs: number | null | undefined,
  nowMs: number,
): string {
  if (probedAtMs === null || probedAtMs === undefined) return "no recent probe";
  const seconds = Math.max(0, Math.round((nowMs - probedAtMs) / 1_000));
  if (seconds < 60) return `probed ${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `probed ${minutes} min ago`;
  return `probed ${Math.floor(minutes / 60)} h ago`;
}

/**
 * The families that failed their probe, as a sentence. Empty when every probe
 * answered, so the caller falls back to the reason the draw rule gives.
 */
export function weatherDownSentence(weather: WeatherReport): string {
  const down = weather.families
    .filter((family) => !family.ok)
    .map((family) => weatherFamilyLabel(family.family, family.modelId));
  if (down.length === 0) return "";
  return `${joinNames(down)} ${down.length === 1 ? "is" : "are"} down.`;
}

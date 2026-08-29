import { describe, expect, it, vi } from "vitest";

import type { ResearchTranscriptV1 } from "../protocol/types";
import type { SearchResult } from "./provider";
import {
  createSearchCache,
  discoveredEvidenceId,
  resultsHash,
  transcriptHash,
} from "./transcript";

const RUN_ID = `0x${"41".repeat(32)}` as const;
const POLICY_HASH = `0x${"42".repeat(32)}` as const;

function emptyTranscript(): ResearchTranscriptV1 {
  return {
    version: 1,
    runId: RUN_ID,
    provider: { name: "fake", mode: "fake" },
    policyHash: POLICY_HASH,
    steps: [],
    opened: [],
    citations: [],
    counts: { searches: 0, opens: 0, turns: 0 },
  };
}

const results: SearchResult[] = [
  {
    rank: 1,
    url: "https://source.test/1",
    title: "Source",
    snippet: "Source snippet",
  },
];

describe("research transcript hashing", () => {
  it("derives a stable phase-scoped discovered evidence ID", () => {
    const first = discoveredEvidenceId(
      "claim-1",
      1,
      "https://source.test/report",
    );

    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      discoveredEvidenceId("claim-1", 1, "https://source.test/report"),
    ).toBe(first);
    expect(
      discoveredEvidenceId("claim-1", 2, "https://source.test/report"),
    ).not.toBe(first);
  });

  it("changes the transcript hash when a step is appended", () => {
    const transcript = emptyTranscript();
    const changed: ResearchTranscriptV1 = {
      ...transcript,
      steps: [
        {
          index: 0,
          turn: 1,
          startedAtMs: 1,
          completedAtMs: 2,
          modelRequestId: "request-1",
          action: { action: "invalid", content: "not json" },
          result: {
            tool: "error",
            code: "INVALID_ACTION",
            message: "invalid action",
          },
        },
      ],
      counts: { ...transcript.counts, turns: 1 },
    };

    expect(transcriptHash(transcript)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(transcriptHash(changed)).not.toBe(transcriptHash(transcript));
  });

  it("hashes search results canonically", () => {
    expect(resultsHash(results)).toBe(resultsHash([{ ...results[0]! }]));
    expect(resultsHash([{ ...results[0]!, rank: 2 }])).not.toBe(
      resultsHash(results),
    );
  });
});

describe("search cache", () => {
  it("shares an in-flight loader and marks later resolutions cached", async () => {
    const cache = createSearchCache();
    let release: ((value: SearchResult[]) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          release = resolve;
        }),
    );

    const first = cache.resolve("1:query", loader);
    const second = cache.resolve("1:query", loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    release?.(results);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { results, cached: false },
      { results, cached: true },
    ]);
    await expect(cache.resolve("1:query", loader)).resolves.toEqual({
      results,
      cached: true,
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("deletes a rejected promise so a later call retries", async () => {
    const cache = createSearchCache();
    const loader = vi
      .fn<() => Promise<SearchResult[]>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(results);

    await expect(cache.resolve("1:query", loader)).rejects.toThrow(
      "temporary failure",
    );
    await expect(cache.resolve("1:query", loader)).resolves.toEqual({
      results,
      cached: false,
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

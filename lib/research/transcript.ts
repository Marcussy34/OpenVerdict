import { canonicalJsonBytes } from "../gonka/canonical";
import { blake2b256, toHex } from "../protocol/hash";
import type { HexString, ResearchTranscriptV1 } from "../protocol/types";
import type { SearchResult } from "./provider";

const utf8 = new TextEncoder();

export function discoveredEvidenceId(
  claimId: string,
  phase: 1 | 2,
  normalizedUrl: string,
): HexString {
  return toHex(
    blake2b256(
      utf8.encode(`discovered:${claimId}:${phase}:${normalizedUrl}`),
    ),
  );
}

export function transcriptHash(transcript: ResearchTranscriptV1): HexString {
  return toHex(blake2b256(canonicalJsonBytes(transcript)));
}

export function resultsHash(results: SearchResult[]): HexString {
  return toHex(blake2b256(canonicalJsonBytes(results)));
}

export interface SearchCache {
  resolve(
    key: string,
    loader: () => Promise<SearchResult[]>,
  ): Promise<{ results: SearchResult[]; cached: boolean }>;
}

export function createSearchCache(): SearchCache {
  const entries = new Map<string, Promise<SearchResult[]>>();

  return {
    async resolve(key, loader) {
      const existing = entries.get(key);
      if (existing) return { results: await existing, cached: true };

      // Install before awaiting so parallel seats share the same request.
      const pending = Promise.resolve().then(loader);
      entries.set(key, pending);
      try {
        return { results: await pending, cached: false };
      } catch (error) {
        if (entries.get(key) === pending) entries.delete(key);
        throw error;
      }
    },
  };
}

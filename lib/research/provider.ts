import type { ResearchSearchResult } from "../protocol/types";

export type SearchResult = ResearchSearchResult;

export type OpenedPage = {
  url: string;
  finalUrl: string;
  title?: string;
  markdown: string;
  fetchedAtMs: number;
  statusCode?: number;
};

export type ResearchProviderErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "empty"
  | "invalid";

export class ResearchProviderError extends Error {
  readonly kind: ResearchProviderErrorKind;
  readonly status?: number;

  constructor(
    kind: ResearchProviderErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ResearchProviderError";
    this.kind = kind;
    this.status = options?.status;
  }
}

export interface ResearchProvider {
  readonly name: "firecrawl" | "fake";
  readonly mode: "cloud" | "selfhost" | "fake";
  search(
    query: string,
    options: { limit: number; timeoutMs: number },
  ): Promise<SearchResult[]>;
  open(url: string, options: { timeoutMs: number }): Promise<OpenedPage>;
}

import { z } from "zod";

import { extractJsonObject } from "../gonka/adapter";
import { canonicalJsonString } from "../gonka/canonical";
import type {
  ResearchAction,
  ResearchToolErrorCode,
  ResearchToolResult,
} from "../protocol/types";
import type { SearchResult } from "./provider";

const searchActionSchema = z
  .object({
    action: z.literal("search"),
    query: z.string().min(3).max(200),
  })
  .strict();

const openActionSchema = z
  .object({
    action: z.literal("open"),
    url: z.string().url(),
    from: z.number().int().min(0).optional(),
  })
  .strict();

const answerActionSchema = z
  .object({
    action: z.literal("answer"),
    output: z.unknown(),
  })
  .strict();

const researchActionSchema = z.discriminatedUnion("action", [
  searchActionSchema,
  openActionSchema,
  answerActionSchema,
]);

export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("research URL must be an absolute HTTP URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("research URL must use HTTP or HTTPS");
  }

  parsed.hash = "";
  const search = parsed.search;
  parsed.search = "";
  const withoutQuery = parsed.toString().replace(/\/$/, "");
  return `${withoutQuery}${search}`;
}

export function parseResearchAction(
  content: string,
): { ok: true; action: ResearchAction } | { ok: false; error: string } {
  let decoded: unknown;
  try {
    decoded = extractJsonObject(content);
  } catch {
    return { ok: false, error: "no parseable JSON object" };
  }

  const parsed = researchActionSchema.safeParse(decoded);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  // Answer output remains opaque until the citation-aware validator runs.
  return { ok: true, action: parsed.data as ResearchAction };
}

export function toolResultContent(result: ResearchToolResult): string {
  return canonicalJsonString(result);
}

export function searchToolResult(
  query: string,
  results: SearchResult[],
): ResearchToolResult {
  return {
    tool: "search",
    query,
    results: results.map((result) => ({
      n: result.rank,
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      ...(result.publishedAt === undefined
        ? {}
        : { publishedAt: result.publishedAt }),
    })),
  };
}

export function openToolResult(
  page: {
    url: string;
    evidenceId: string;
    ref: string;
    text: string;
    totalChars: number;
    truncated: boolean;
  },
  from: number,
  sliceChars: number,
): ResearchToolResult {
  const text = page.text.slice(from, from + sliceChars);
  return {
    tool: "open",
    url: page.url,
    evidenceId: page.evidenceId,
    ref: page.ref,
    from,
    chars: text.length,
    totalChars: page.totalChars,
    truncated: page.truncated,
    text,
  };
}

export function errorToolResult(
  code: ResearchToolErrorCode,
  message: string,
  errors?: string[],
): ResearchToolResult {
  return {
    tool: "error",
    code,
    message,
    ...(errors === undefined ? {} : { errors }),
  };
}

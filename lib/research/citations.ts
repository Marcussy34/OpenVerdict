import { z } from "zod";

import {
  citationSchema,
  oracleInferenceOutputSchema,
  validateOutputAgainstManifest,
} from "../gonka/schemas";
import type {
  Citation,
  OracleInferenceInput,
  OracleInferenceOutput,
  ResearchPageOrigin,
} from "../protocol/types";
import { normalizeUrl } from "./actions";
import type { StoredPage } from "./loop";

type ResearchCitation = Omit<Citation, "evidenceId"> & {
  evidenceId?: string;
};

type ResearchAnswer = Omit<OracleInferenceOutput, "citations"> & {
  citations?: ResearchCitation[];
};

const researchCitationSchema = citationSchema
  .extend({ evidenceId: citationSchema.shape.evidenceId.optional() })
  .strict();

const oracleObjectSchema = oracleInferenceOutputSchema as unknown as z.ZodObject<
  z.ZodRawShape
>;

export const researchAnswerSchema = oracleObjectSchema
  .extend({ citations: z.array(researchCitationSchema).max(16).optional() })
  .strict() as unknown as z.ZodType<ResearchAnswer>;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeQuoteText(text: string): string {
  const normalized = text
    .normalize("NFKC")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*])[ \t]+/gm, "")
    .replace(/[*_`]/g, "");
  return collapseWhitespace(normalized).toLowerCase();
}

export function quoteFound(text: string, quote: string): boolean {
  const haystack = normalizeQuoteText(text);
  const needle = normalizeQuoteText(quote);
  return needle.length > 0 && haystack.includes(needle);
}

function normalizedHttpUrl(url: string): string | undefined {
  try {
    return normalizeUrl(url);
  } catch {
    return undefined;
  }
}

export type CitationContext = {
  frozenEvidenceIds: readonly string[];
  opened: readonly StoredPage[];
  origins: ReadonlyMap<string, ResearchPageOrigin>;
  maximumReasonLength: number;
  evidenceManifest: OracleInferenceInput["evidenceManifest"];
};

export function validateResearchAnswer(
  output: unknown,
  ctx: CitationContext,
):
  | {
      ok: true;
      output: OracleInferenceOutput;
      citations: Array<Citation & { found: boolean }>;
    }
  | { ok: false; errors: string[] } {
  const schemaResult = researchAnswerSchema.safeParse(output);
  if (!schemaResult.success) {
    return {
      ok: false,
      errors: [`schema: ${z.prettifyError(schemaResult.error)}`],
    };
  }

  const lenient = schemaResult.data;
  const errors: string[] = [];
  const openedByRef = new Map(
    ctx.opened.map((page) => [page.ref, page] as const),
  );
  const knownEvidenceIds = new Set([
    ...ctx.frozenEvidenceIds,
    ...ctx.opened.map((page) => page.evidenceId),
  ]);
  const openedByUrl = new Map<string, StoredPage>();
  for (const page of ctx.opened) {
    for (const url of [page.url, page.finalUrl]) {
      const normalized = normalizedHttpUrl(url);
      if (normalized !== undefined) openedByUrl.set(normalized, page);
    }
  }

  const resolveEvidenceId = (value: string): string | undefined => {
    const page = openedByRef.get(value);
    if (page !== undefined) return page.evidenceId;
    if (knownEvidenceIds.has(value)) return value;
    errors.push(`unknown page ref or evidence id: ${value}`);
    return undefined;
  };
  const resolveEvidenceIds = (values: string[]): string[] =>
    values.flatMap((value) => {
      const resolved = resolveEvidenceId(value);
      return resolved === undefined ? [] : [resolved];
    });

  const resolvedCitations = lenient.citations?.map((citation, index) => {
    let evidenceId: string | undefined;
    if (citation.evidenceId !== undefined) {
      evidenceId = resolveEvidenceId(citation.evidenceId);
    } else {
      const normalized = normalizedHttpUrl(citation.url);
      const page = normalized === undefined
        ? undefined
        : openedByUrl.get(normalized);
      if (page === undefined) {
        errors.push(`citation ${index}: url is not an opened page`);
      } else {
        evidenceId = page.evidenceId;
      }
    }
    return { ...citation, evidenceId: evidenceId ?? "" };
  });
  const resolvedOutput = {
    ...lenient,
    evidenceFor: resolveEvidenceIds(lenient.evidenceFor),
    evidenceAgainst: resolveEvidenceIds(lenient.evidenceAgainst),
    unsupportedClaims: resolveEvidenceIds(lenient.unsupportedClaims),
    decisiveEvidence: resolveEvidenceIds(lenient.decisiveEvidence),
    publicReasoningTrace: lenient.publicReasoningTrace.map((entry) => ({
      ...entry,
      evidenceIds: resolveEvidenceIds(entry.evidenceIds),
    })),
    ...(resolvedCitations === undefined
      ? {}
      : { citations: resolvedCitations }),
  };

  if (errors.length > 0) return { ok: false, errors };

  const strictResult = oracleInferenceOutputSchema.safeParse(resolvedOutput);
  if (!strictResult.success) {
    return {
      ok: false,
      errors: [`schema: ${z.prettifyError(strictResult.error)}`],
    };
  }

  const parsed = strictResult.data;
  if (parsed.citations === undefined) {
    errors.push("schema: citations is required for a research answer");
  }
  if (
    new TextEncoder().encode(parsed.reasoning).byteLength >
    ctx.maximumReasonLength
  ) {
    errors.push("reasoning exceeds maximumReasonLength");
  }

  try {
    validateOutputAgainstManifest(
      parsed,
      ctx.evidenceManifest,
      new Set(ctx.opened.map((page) => page.evidenceId)),
    );
  } catch (error) {
    errors.push(
      `manifest: ${error instanceof Error ? error.message : "invalid evidence ID"}`,
    );
  }

  const citations = parsed.citations ?? [];
  for (const [index, citation] of citations.entries()) {
    const page = ctx.opened.find(
      (candidate) => candidate.evidenceId === citation.evidenceId,
    );
    if (!page) {
      errors.push(`citation ${index}: evidenceId not opened in this run`);
      continue;
    }
    const citationUrl = normalizedHttpUrl(citation.url);
    const pageUrls = [page.url, page.finalUrl]
      .map(normalizedHttpUrl)
      .filter((url): url is string => url !== undefined);
    if (citationUrl === undefined || !pageUrls.includes(citationUrl)) {
      errors.push(`citation ${index}: url does not match the opened page`);
    }
    if (!quoteFound(page.text, citation.quote)) {
      errors.push(`citation ${index}: quote not found in the opened page`);
    }
  }

  if (parsed.outcome === "YES" || parsed.outcome === "NO") {
    const citesIndependentPage = citations.some(
      (citation) => ctx.origins.get(citation.evidenceId) === "SEARCH",
    );
    if (!citesIndependentPage) {
      errors.push(
        "independence: YES or NO needs a citation of a page found by your own search",
      );
    }
  }

  if (parsed.decisiveEvidence.length > 0) {
    const citedIds = new Set(citations.map((citation) => citation.evidenceId));
    if (!parsed.decisiveEvidence.some((evidenceId) => citedIds.has(evidenceId))) {
      errors.push("decisiveEvidence must include a cited page");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    output: parsed,
    citations: citations.map((citation) => ({ ...citation, found: true })),
  };
}

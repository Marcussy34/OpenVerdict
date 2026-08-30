import { z } from "zod";
import type {
  OracleInferenceInput,
  OracleInferenceOutput,
} from "../protocol/types";

export const MAX_OUTPUT_ARRAY_ITEMS = 32;
export const MAX_REASONING_BYTES = 4_000;
export const MAX_TRACE_ENTRIES = 8;

const byteLengthAtMost = (limit: number) => (value: string): boolean =>
  new TextEncoder().encode(value).byteLength <= limit;

const boundedEvidenceId = z.string().min(1).max(256);
const boundedEvidenceIds = z.array(boundedEvidenceId).max(MAX_OUTPUT_ARRAY_ITEMS);

const evidenceItemSchema = z
  .object({
    evidenceId: boundedEvidenceId,
    sourceClass: z.string().min(1).max(128),
    retrievedAt: z.string().min(1).max(128),
    walrusBlobId: z.string().min(1).max(512),
    contentHash: z.string().min(1).max(256),
    excerpt: z.string().max(16_000),
  })
  .strict();

export const oracleInferenceInputSchema: z.ZodType<OracleInferenceInput> = z
  .object({
    protocolVersion: z.literal("1.0"),
    runId: z.string().min(1).max(256),
    agentRole: z.string().min(1).max(256),
    promptVersion: z.enum(["1", "2", "3", "4"]),
    submission: z
      .object({
        kind: z.enum(["TEXT", "URL", "TEXT_AND_URL"]),
        submittedTextHash: z.string().min(1).max(256).optional(),
        submittedUrls: z.array(z.string().url().max(2_048)).max(16),
      })
      .strict(),
    claim: z
      .object({
        statement: z.string().min(1).max(32_000),
        resolutionCriteria: z.string().min(1).max(32_000),
        outcomes: z.tuple([z.literal("YES"), z.literal("NO"), z.literal("UNSURE")]),
        relevantDeadline: z.string().min(1).max(128),
      })
      .strict(),
    evidenceManifest: z
      .object({
        root: z.string().min(1).max(256),
        items: z.array(evidenceItemSchema).max(256),
      })
      .strict(),
    outputContract: z
      .object({
        requiredOutcome: z.literal(true),
        requiredEvidenceIds: z.literal(true),
        maximumReasonLength: z.number().int().min(1).max(MAX_REASONING_BYTES),
      })
      .strict(),
  })
  .strict();

const reasoningTraceSchema = z
  .object({
    check: z
      .string()
      .min(1)
      .refine(byteLengthAtMost(512), "check exceeds 512 UTF-8 bytes"),
    evidenceIds: boundedEvidenceIds,
    assessment: z.enum(["SUPPORTS", "CONTRADICTS", "MIXED", "INSUFFICIENT"]),
    finding: z
      .string()
      .min(1)
      .refine(byteLengthAtMost(2_000), "finding exceeds 2000 UTF-8 bytes"),
  })
  .strict();

export const citationSchema = z
  .object({
    evidenceId: z.string().min(1),
    url: z.string().url(),
    // The prompt asks for an excerpt; an excerpt the engine cannot find in
    // the opened page is blanked (the citation stays as a verified URL), so
    // validated outputs may carry an empty quote.
    quote: z.string().max(300),
  })
  .strict();

const researchSearchActionSchema = z
  .object({
    action: z.literal("search"),
    query: z.string().min(3).max(200),
    intent: z.enum(["support", "challenge"]).optional(),
  })
  .strict();

const researchOpenActionV3Schema = z
  .object({
    action: z.literal("open"),
    url: z.string().url(),
    from: z.number().int().min(0).optional(),
  })
  .strict();

const researchOpenActionSchema = z
  .object({
    action: z.literal("open"),
    url: z.string().url().optional(),
    urls: z.array(z.string().url()).min(1).max(3).optional(),
    from: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.url === undefined) === (value.urls === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "open action needs exactly one of url or urls",
      });
    }
    const seen = new Set<string>();
    for (const [index, url] of (value.urls ?? []).entries()) {
      if (seen.has(url)) {
        ctx.addIssue({
          code: "custom",
          path: ["urls", index],
          message: `duplicate open URL: ${url}`,
        });
      }
      seen.add(url);
    }
  });

const researchAnswerActionSchema = z
  .object({
    action: z.literal("answer"),
    output: z.unknown(),
  })
  .strict();

/** Keep v3 parsing byte-compatible with its single-url open envelope. */
export const researchActionV3Schema = z.discriminatedUnion("action", [
  researchSearchActionSchema,
  researchOpenActionV3Schema,
  researchAnswerActionSchema,
]);

/** V4 accepts either one URL or one bounded URL batch. */
export const researchActionSchema = z.union([
  researchSearchActionSchema,
  researchOpenActionSchema,
  researchAnswerActionSchema,
]);

export const oracleInferenceOutputSchema: z.ZodType<OracleInferenceOutput> = z
  .object({
    outcome: z.enum(["YES", "NO", "UNSURE"]),
    confidenceBps: z.number().int().min(0).max(10_000),
    evidenceFor: boundedEvidenceIds,
    evidenceAgainst: boundedEvidenceIds,
    unsupportedClaims: boundedEvidenceIds,
    decisiveEvidence: boundedEvidenceIds,
    reasoning: z
      .string()
      .refine(byteLengthAtMost(MAX_REASONING_BYTES), "reasoning exceeds 4000 UTF-8 bytes"),
    publicReasoningTrace: z
      .array(reasoningTraceSchema)
      .min(1)
      .max(MAX_TRACE_ENTRIES),
    citations: z.array(citationSchema).max(16).optional(),
    counterEvidenceSummary: z.string().max(600).optional(),
  })
  .strict();

/** Reject citations outside the frozen manifest and opened-page allowance. */
export function validateOutputAgainstManifest(
  output: OracleInferenceOutput,
  evidenceManifest: OracleInferenceInput["evidenceManifest"],
  extraAllowedIds: ReadonlySet<string> = new Set(),
): void {
  const parsed = oracleInferenceOutputSchema.parse(output);
  const allowedIds = new Set([
    ...evidenceManifest.items.map((item) => item.evidenceId),
    ...extraAllowedIds,
  ]);
  const citedIds = [
    ...parsed.evidenceFor,
    ...parsed.evidenceAgainst,
    ...parsed.unsupportedClaims,
    ...parsed.decisiveEvidence,
    ...parsed.publicReasoningTrace.flatMap((entry) => entry.evidenceIds),
    ...(parsed.citations?.map((citation) => citation.evidenceId) ?? []),
  ];

  for (const evidenceId of citedIds) {
    if (!allowedIds.has(evidenceId)) {
      throw new Error(`output cites evidence ID absent from the frozen manifest: ${evidenceId}`);
    }
  }
}

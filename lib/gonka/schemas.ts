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
    promptVersion: z.string().min(1).max(256),
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
  })
  .strict();

/** Reject citations that were not present in the frozen evidence manifest. */
export function validateOutputAgainstManifest(
  output: OracleInferenceOutput,
  evidenceManifest: OracleInferenceInput["evidenceManifest"],
): void {
  const parsed = oracleInferenceOutputSchema.parse(output);
  const allowedIds = new Set(evidenceManifest.items.map((item) => item.evidenceId));
  const citedIds = [
    ...parsed.evidenceFor,
    ...parsed.evidenceAgainst,
    ...parsed.unsupportedClaims,
    ...parsed.decisiveEvidence,
    ...parsed.publicReasoningTrace.flatMap((entry) => entry.evidenceIds),
  ];

  for (const evidenceId of citedIds) {
    if (!allowedIds.has(evidenceId)) {
      throw new Error(`output cites evidence ID absent from the frozen manifest: ${evidenceId}`);
    }
  }
}

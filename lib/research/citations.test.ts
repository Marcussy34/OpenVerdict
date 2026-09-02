import { describe, expect, it } from "vitest";

import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import type { ResearchPageOrigin } from "../protocol/types";
import {
  collapseWhitespace,
  citationSites,
  normalizeQuoteText,
  quoteFound,
  type CitationContext,
  validateResearchAnswer,
} from "./citations";
import type { StoredPage } from "./loop";

const SEARCH_ID = "opened-search";
const SUBMITTED_ID = "opened-submitted";
const SEARCH_QUOTE = "independent source confirms the central claim";
const SUBMITTED_QUOTE = "submitter page repeats the central claim";

const searchPage: StoredPage = {
  evidenceId: SEARCH_ID,
  ref: "p1",
  url: "https://source.test/report",
  finalUrl: "https://source.test/report-final",
  title: "Independent report",
  text: "Heading\n\nIndependent   source confirms the central claim with supporting details.",
  totalChars: 84,
  truncated: false,
  contentHash: `0x${"31".repeat(32)}`,
  canonicalHash: `0x${"31".repeat(32)}`,
  canonicalWalrusBlobId: "blob-search",
};

const submittedPage: StoredPage = {
  evidenceId: SUBMITTED_ID,
  ref: "p2",
  url: "https://submitted.test/page",
  finalUrl: "https://submitted.test/page",
  title: "Submitted page",
  text: "The submitter page repeats the central claim without independent review.",
  totalChars: 70,
  truncated: false,
  contentHash: `0x${"32".repeat(32)}`,
  canonicalHash: `0x${"32".repeat(32)}`,
  canonicalWalrusBlobId: "blob-submitted",
};

const input = makeInput({ promptVersion: "2" });

function context(overrides: Partial<CitationContext> = {}): CitationContext {
  const origins = new Map<string, ResearchPageOrigin>([
    [SEARCH_ID, "SEARCH"],
    [SUBMITTED_ID, "SUBMITTED"],
  ]);
  return {
    frozenEvidenceIds: input.evidenceManifest.items.map((item) => item.evidenceId),
    opened: [searchPage, submittedPage],
    origins,
    maximumReasonLength: input.outputContract.maximumReasonLength,
    evidenceManifest: input.evidenceManifest,
    ...overrides,
  };
}

function validSearchAnswer() {
  return makeOutput({
    outcome: "YES",
    evidenceFor: [SEARCH_ID],
    evidenceAgainst: [],
    unsupportedClaims: [],
    decisiveEvidence: [SEARCH_ID],
    publicReasoningTrace: [
      {
        check: "Check the independent report.",
        evidenceIds: [SEARCH_ID],
        assessment: "SUPPORTS",
        finding: "The report supports the claim.",
      },
    ],
    citations: [
      {
        evidenceId: SEARCH_ID,
        url: searchPage.finalUrl,
        quote: SEARCH_QUOTE,
      },
    ],
  });
}

describe("citation text matching", () => {
  it("collapses whitespace and matches quotes case-insensitively", () => {
    expect(collapseWhitespace("  One\n\t two  ")).toBe("One two");
    expect(quoteFound(searchPage.text, SEARCH_QUOTE.toUpperCase())).toBe(true);
    expect(quoteFound(searchPage.text, "not present in this page")).toBe(false);
    expect(quoteFound(searchPage.text, "")).toBe(false);
  });

  it("normalizes markdown and punctuation without accepting paraphrases", () => {
    const pageText = [
      "## Finding",
      "> **The [review board](https://source.test) said \u201cit\u2019s verified\u201d \u2013 after review.**",
    ].join("\n");
    const quote = 'The review board said "it\'s verified" - after review.';

    expect(normalizeQuoteText(pageText)).toContain(normalizeQuoteText(quote));
    expect(quoteFound(pageText, quote)).toBe(true);
    expect(
      quoteFound(pageText, "The reviewers confirmed it after checking."),
    ).toBe(false);
  });
});

describe("citationSites", () => {
  it("returns distinct registrable sites for found SEARCH citations", () => {
    const secondSearchPage: StoredPage = {
      ...searchPage,
      evidenceId: "opened-search-uk",
      ref: "p3",
      url: "https://news.example.co.uk/report",
      finalUrl: "https://news.example.co.uk/report",
    };
    const origins = new Map<string, ResearchPageOrigin>([
      [SEARCH_ID, "SEARCH"],
      [SUBMITTED_ID, "SUBMITTED"],
      [secondSearchPage.evidenceId, "SEARCH"],
    ]);

    expect(
      citationSites(
        [
          {
            evidenceId: SEARCH_ID,
            url: "https://www.source.test/report",
            quote: SEARCH_QUOTE,
            found: true,
          },
          {
            evidenceId: secondSearchPage.evidenceId,
            url: secondSearchPage.url,
            quote: SEARCH_QUOTE,
            found: true,
          },
          {
            evidenceId: SUBMITTED_ID,
            url: submittedPage.url,
            quote: SUBMITTED_QUOTE,
            found: true,
          },
          {
            evidenceId: SEARCH_ID,
            url: "https://ignored.test/report",
            quote: SEARCH_QUOTE,
            found: false,
          },
          {
            evidenceId: SEARCH_ID,
            url: "https://empty.test/report",
            quote: "",
            found: true,
          },
        ],
        {
          opened: [searchPage, submittedPage, secondSearchPage],
          origins,
        },
      ),
    ).toEqual(new Set(["source.test", "example.co.uk"]));
  });
});

describe("research answer validation", () => {
  it("accepts a valid answer and marks each citation found", () => {
    const answer = validSearchAnswer();

    expect(validateResearchAnswer(answer, context())).toEqual({
      ok: true,
      output: answer,
      citations: answer.citations?.map((citation) => ({
        ...citation,
        found: true,
      })),
      repairs: [],
    });
  });

  it("drops prose from unsupportedClaims and records the repair", () => {
    const prose = "The claim is stated as an absolute but research is divided.";
    const result = validateResearchAnswer(
      { ...validSearchAnswer(), unsupportedClaims: [prose] },
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.unsupportedClaims).toEqual([]);
    expect(result.repairs).toEqual([
      `unsupportedClaims: dropped entry that is not an evidence id: "${prose}"`,
    ]);
  });

  it("keeps and resolves a valid unsupportedClaims ref beside prose", () => {
    const prose = "Research is divided on the absolute wording.";
    const result = validateResearchAnswer(
      { ...validSearchAnswer(), unsupportedClaims: ["p2", prose] },
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.unsupportedClaims).toEqual([SUBMITTED_ID]);
    expect(result.repairs).toEqual([
      `unsupportedClaims: dropped entry that is not an evidence id: "${prose}"`,
    ]);
  });

  it("still rejects prose in evidenceFor", () => {
    const prose = "This sentence is not an evidence id.";
    const result = validateResearchAnswer(
      { ...validSearchAnswer(), evidenceFor: [prose] },
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      `unknown page ref or evidence id: ${prose}`,
    );
  });

  it("resolves page refs in every evidence ID position", () => {
    const result = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        evidenceFor: ["p1"],
        evidenceAgainst: ["p2"],
        unsupportedClaims: ["p2"],
        decisiveEvidence: ["p1"],
        publicReasoningTrace: [
          {
            check: "Compare both opened pages.",
            evidenceIds: ["p1", "p2"],
            assessment: "MIXED",
            finding: "The independent report is decisive.",
          },
        ],
        citations: [
          {
            evidenceId: "p1",
            url: searchPage.finalUrl,
            quote: SEARCH_QUOTE,
          },
        ],
      },
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.evidenceFor).toEqual([SEARCH_ID]);
    expect(result.output.evidenceAgainst).toEqual([SUBMITTED_ID]);
    expect(result.output.unsupportedClaims).toEqual([SUBMITTED_ID]);
    expect(result.output.decisiveEvidence).toEqual([SEARCH_ID]);
    expect(result.output.publicReasoningTrace[0]?.evidenceIds).toEqual([
      SEARCH_ID,
      SUBMITTED_ID,
    ]);
    expect(result.output.citations?.[0]?.evidenceId).toBe(SEARCH_ID);
  });

  it("resolves a URL-only citation against an opened final URL", () => {
    const result = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        citations: [
          {
            url: `${searchPage.finalUrl}#finding`,
            quote: SEARCH_QUOTE,
          },
        ],
      },
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.citations?.[0]?.evidenceId).toBe(SEARCH_ID);
  });

  it("reports unknown refs and citation URLs with stable messages", () => {
    const unknownRef = validateResearchAnswer(
      { ...validSearchAnswer(), evidenceFor: ["p99"] },
      context(),
    );
    expect(unknownRef.ok).toBe(false);
    if (!unknownRef.ok) {
      expect(unknownRef.errors).toContain(
        "unknown page ref or evidence id: p99",
      );
    }

    const unknownUrl = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        citations: [
          {
            url: "https://unopened.test/page",
            quote: SEARCH_QUOTE,
          },
        ],
      },
      context(),
    );
    expect(unknownUrl.ok).toBe(false);
    if (!unknownUrl.ok) {
      expect(unknownUrl.errors).toContain(
        "citation 0: url is not an opened page",
      );
    }
  });

  it("collects schema failures and requires citations on loop answers", () => {
    const malformed = validateResearchAnswer({}, context());
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors[0]).toContain("schema:");

    const missing = validateResearchAnswer(
      makeOutput({ outcome: "UNSURE", decisiveEvidence: [] }),
      context(),
    );
    expect(missing).toEqual({
      ok: false,
      errors: ["schema: citations is required for a research answer"],
    });
  });

  it("enforces the input reasoning byte limit", () => {
    const result = validateResearchAnswer(
      { ...validSearchAnswer(), reasoning: "longer than ten bytes" },
      context({ maximumReasonLength: 10 }),
    );

    expect(result).toEqual({
      ok: false,
      errors: ["reasoning exceeds maximumReasonLength"],
    });
  });

  it("rejects evidence IDs outside the frozen and opened sets", () => {
    const result = validateResearchAnswer(
      makeOutput({
        outcome: "UNSURE",
        evidenceFor: ["unknown-evidence"],
        decisiveEvidence: [],
        citations: [],
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("unknown-evidence");
  });

  it("requires every citation evidence ID to be opened in this run", () => {
    const result = validateResearchAnswer(
      makeOutput({
        outcome: "UNSURE",
        decisiveEvidence: ["evidence-1"],
        citations: [
          {
            evidenceId: "evidence-1",
            url: "https://frozen.test/page",
            quote: "A frozen quote that is long enough to validate.",
          },
        ],
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "citation 0: evidenceId not opened in this run",
      );
    }
  });

  it("requires a citation URL to match the opened page", () => {
    const result = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        outcome: "UNSURE" as const,
        citations: [
          {
            evidenceId: SEARCH_ID,
            url: "https://wrong.test/page",
            quote: SEARCH_QUOTE,
          },
        ],
      },
      context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "citation 0: url does not match the opened page",
      );
    }
  });

  it("keeps a citation whose quote is not in the page as a URL citation with an empty quote", () => {
    const quote = "This sufficiently long quote does not occur in the page.";
    const result = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        outcome: "UNSURE" as const,
        citations: [{ evidenceId: SEARCH_ID, url: searchPage.url, quote }],
      },
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The vote carries only the verified part; the transcript keeps the claim.
    expect(result.output.citations).toEqual([
      { evidenceId: SEARCH_ID, url: searchPage.url, quote: "" },
    ]);
    expect(result.citations).toEqual([
      { evidenceId: SEARCH_ID, url: searchPage.url, quote, found: false },
    ]);
  });

  it("requires YES or NO to cite independently searched evidence", () => {
    const result = validateResearchAnswer(
      makeOutput({
        outcome: "NO",
        evidenceFor: [],
        evidenceAgainst: [SUBMITTED_ID],
        unsupportedClaims: [],
        decisiveEvidence: [SUBMITTED_ID],
        citations: [
          {
            evidenceId: SUBMITTED_ID,
            url: submittedPage.url,
            quote: SUBMITTED_QUOTE,
          },
        ],
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "independence: YES or NO needs a citation of a page found by your own search",
      );
    }
  });

  it("requires decisive evidence to include a cited page", () => {
    const result = validateResearchAnswer(
      {
        ...validSearchAnswer(),
        decisiveEvidence: ["evidence-1"],
      },
      context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "decisiveEvidence must include a cited page",
      );
    }
  });
});

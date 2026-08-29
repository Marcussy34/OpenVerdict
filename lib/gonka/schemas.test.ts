import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_ARRAY_ITEMS,
  oracleInferenceInputSchema,
  oracleInferenceOutputSchema,
  validateOutputAgainstManifest,
} from "./schemas";
import { makeInput, makeOutput } from "./fixtures.test-utils";

function traceWithEvidenceIds(evidenceIds: string[]) {
  const trace = makeOutput().publicReasoningTrace[0];
  if (!trace) throw new Error("output fixture must include a reasoning trace");
  return { ...trace, evidenceIds };
}

describe("oracleInferenceInputSchema", () => {
  it("accepts the canonical strict input", () => {
    const input = makeInput({ promptVersion: "1" });
    expect(oracleInferenceInputSchema.parse(input)).toEqual(input);
  });

  it("rejects unknown keys at the top level and in nested records", () => {
    expect(() =>
      oracleInferenceInputSchema.parse({ ...makeInput(), walletKey: "nope" }),
    ).toThrow();
    expect(() =>
      oracleInferenceInputSchema.parse({
        ...makeInput(),
        claim: { ...makeInput().claim, transactionCommand: "commitVote" },
      }),
    ).toThrow();
  });
});

describe("oracleInferenceOutputSchema", () => {
  it("accepts valid bounded output", () => {
    expect(oracleInferenceOutputSchema.parse(makeOutput())).toEqual(makeOutput());
  });

  it.each(["MAYBE", "UNKNOWN", "yes"])("rejects unknown outcome %s", (outcome) => {
    expect(() => oracleInferenceOutputSchema.parse({ ...makeOutput(), outcome })).toThrow();
  });

  it.each([-1, 10_001, 1.5])("rejects invalid confidence %s", (confidenceBps) => {
    expect(() =>
      oracleInferenceOutputSchema.parse({ ...makeOutput(), confidenceBps }),
    ).toThrow();
  });

  it("rejects extra fields", () => {
    expect(() =>
      oracleInferenceOutputSchema.parse({ ...makeOutput(), recipient: "0x1" }),
    ).toThrow();
  });

  it("requires one through eight public trace entries", () => {
    expect(() =>
      oracleInferenceOutputSchema.parse({ ...makeOutput(), publicReasoningTrace: [] }),
    ).toThrow();
    expect(() =>
      oracleInferenceOutputSchema.parse({
        ...makeOutput(),
        publicReasoningTrace: Array.from(
          { length: 9 },
          () => makeOutput().publicReasoningTrace[0],
        ),
      }),
    ).toThrow();
  });

  it("enforces the 4000-byte reasoning cap, not a character cap", () => {
    const exactlyFourThousandBytes = "é".repeat(2_000);
    const tooManyBytes = `${exactlyFourThousandBytes}a`;

    expect(() =>
      oracleInferenceOutputSchema.parse({
        ...makeOutput(),
        reasoning: exactlyFourThousandBytes,
      }),
    ).not.toThrow();
    expect(() =>
      oracleInferenceOutputSchema.parse({ ...makeOutput(), reasoning: tooManyBytes }),
    ).toThrow();
  });

  it("caps every top-level output array", () => {
    const oversized = Array.from(
      { length: MAX_OUTPUT_ARRAY_ITEMS + 1 },
      (_, index) => `evidence-${index}`,
    );

    for (const field of [
      "evidenceFor",
      "evidenceAgainst",
      "unsupportedClaims",
      "decisiveEvidence",
    ] as const) {
      expect(() =>
        oracleInferenceOutputSchema.parse({ ...makeOutput(), [field]: oversized }),
      ).toThrow();
    }
  });
});

describe("validateOutputAgainstManifest", () => {
  it("accepts citations from the frozen manifest", () => {
    expect(() =>
      validateOutputAgainstManifest(makeOutput(), makeInput().evidenceManifest),
    ).not.toThrow();
  });

  it.each([
    ["evidenceFor", { evidenceFor: ["invented"] }],
    ["evidenceAgainst", { evidenceAgainst: ["invented"] }],
    ["unsupportedClaims", { unsupportedClaims: ["invented"] }],
    ["decisiveEvidence", { decisiveEvidence: ["invented"] }],
    [
      "trace evidenceIds",
      {
        publicReasoningTrace: [traceWithEvidenceIds(["invented"])],
      },
    ],
  ])("rejects an invented evidence ID in %s", (_name, override) => {
    expect(() =>
      validateOutputAgainstManifest(makeOutput(override), makeInput().evidenceManifest),
    ).toThrow(/invented/);
  });
});

describe("oracle schemas with research fields", () => {
  it("accepts promptVersion 2 and optional citations", () => {
    expect(() =>
      oracleInferenceInputSchema.parse({ ...makeInput(), promptVersion: "2" }),
    ).not.toThrow();
    const output = {
      ...makeOutput(),
      citations: [
        {
          evidenceId: "e1",
          url: "https://example.com/a",
          quote: "a".repeat(20),
        },
      ],
    };
    expect(() => oracleInferenceOutputSchema.parse(output)).not.toThrow();
    expect(() =>
      oracleInferenceOutputSchema.parse({
        ...output,
        citations: [{ evidenceId: "e1", url: "nope", quote: "short" }],
      }),
    ).toThrow();
  });

  it("allows ids from the extra allowed set (pages opened in the run)", () => {
    const input = makeInput();
    const output = {
      ...makeOutput(),
      evidenceFor: ["opened-1"],
      decisiveEvidence: ["opened-1"],
    };
    expect(() =>
      validateOutputAgainstManifest(output, input.evidenceManifest),
    ).toThrow(/absent/);
    expect(() =>
      validateOutputAgainstManifest(
        output,
        input.evidenceManifest,
        new Set(["opened-1"]),
      ),
    ).not.toThrow();
  });
});

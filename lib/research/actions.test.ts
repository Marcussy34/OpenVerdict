import { describe, expect, it } from "vitest";

import {
  errorToolResult,
  normalizeUrl,
  openToolResult,
  parseResearchAction,
  searchToolResult,
  toolResultContent,
} from "./actions";

describe("research actions", () => {
  it("parses each strict action including fenced JSON", () => {
    expect(
      parseResearchAction('{"action":"search","query":"sui walrus"}'),
    ).toEqual({
      ok: true,
      action: { action: "search", query: "sui walrus" },
    });
    expect(
      parseResearchAction(
        '```json\n{"action":"open","url":"https://sui.io","from":20}\n```',
      ),
    ).toEqual({
      ok: true,
      action: { action: "open", url: "https://sui.io", from: 20 },
    });
    expect(
      parseResearchAction(
        'preface {"action":"answer","output":{"outcome":"UNSURE"}}',
      ),
    ).toEqual({
      ok: true,
      action: { action: "answer", output: { outcome: "UNSURE" } },
    });
  });

  it("rejects extra keys and content without a JSON object", () => {
    const extra = parseResearchAction(
      '{"action":"search","query":"valid query","extra":true}',
    );
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error).toContain("Unrecognized key");

    expect(parseResearchAction("plain prose")).toEqual({
      ok: false,
      error: "no parseable JSON object",
    });
  });

  it("enforces action field bounds", () => {
    expect(parseResearchAction('{"action":"search","query":"x"}').ok).toBe(
      false,
    );
    expect(
      parseResearchAction(
        '{"action":"open","url":"https://sui.io","from":-1}',
      ).ok,
    ).toBe(false);
    expect(
      parseResearchAction('{"action":"unknown","query":"valid query"}').ok,
    ).toBe(false);
  });
});

describe("research URLs and tool results", () => {
  it("normalizes HTTP URLs and rejects other schemes", () => {
    expect(normalizeUrl("HTTPS://Example.com/A/#x")).toBe(
      "https://example.com/A",
    );
    expect(normalizeUrl("https://Example.com/path/?a=1#fragment")).toBe(
      "https://example.com/path?a=1",
    );
    expect(() => normalizeUrl("ftp://x")).toThrow(/HTTP/);
  });

  it("builds search results with provider ranks as result numbers", () => {
    const result = searchToolResult("sui", [
      {
        rank: 3,
        url: "https://sui.io",
        title: "Sui",
        snippet: "Layer 1",
        publishedAt: "2026-08-20",
      },
    ]);

    expect(result).toEqual({
      tool: "search",
      query: "sui",
      results: [
        {
          n: 3,
          title: "Sui",
          url: "https://sui.io",
          snippet: "Layer 1",
          publishedAt: "2026-08-20",
        },
      ],
    });
    expect(toolResultContent(result)).toBe(
      '{"query":"sui","results":[{"n":3,"publishedAt":"2026-08-20","snippet":"Layer 1","title":"Sui","url":"https://sui.io"}],"tool":"search"}',
    );
  });

  it("slices opened text and handles an offset beyond the end", () => {
    const page = {
      url: "https://sui.io",
      evidenceId: "page-1",
      ref: "p1",
      text: "abcdef",
      totalChars: 6,
      truncated: false,
    };

    expect(openToolResult(page, 2, 3)).toEqual({
      tool: "open",
      url: "https://sui.io",
      evidenceId: "page-1",
      ref: "p1",
      from: 2,
      chars: 3,
      totalChars: 6,
      truncated: false,
      text: "cde",
    });
    expect(openToolResult(page, 20, 3)).toMatchObject({
      from: 20,
      chars: 0,
      text: "",
    });
  });

  it("includes repair errors only when supplied", () => {
    expect(errorToolResult("INVALID_ACTION", "Repair it")).toEqual({
      tool: "error",
      code: "INVALID_ACTION",
      message: "Repair it",
    });
    expect(
      errorToolResult("INVALID_ANSWER", "Repair it", ["citation 0 failed"]),
    ).toEqual({
      tool: "error",
      code: "INVALID_ANSWER",
      message: "Repair it",
      errors: ["citation 0 failed"],
    });
  });
});

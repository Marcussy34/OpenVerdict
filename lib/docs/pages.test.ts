import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  loadDocPage,
  loadDocPages,
  parseFrontMatter,
} from "./pages";

describe("front matter", () => {
  it("reads flat key and value pairs", () => {
    const { data, content } = parseFrontMatter(
      '---\ntitle: A page\ndescription: "One line."\norder: 3\n---\nBody text.\n',
    );
    expect(data).toEqual({
      title: "A page",
      description: "One line.",
      order: "3",
    });
    expect(content).toBe("Body text.\n");
  });

  it("leaves a file with no front matter alone", () => {
    const { data, content } = parseFrontMatter("# Title\n\nBody.\n");
    expect(data).toEqual({});
    expect(content).toBe("# Title\n\nBody.\n");
  });
});

describe("headings", () => {
  it("collects h2 and h3 with the slugs rehype-slug produces", () => {
    expect(
      extractHeadings("# Page\n\n## The `ov` CLI\n\n### One\n\n#### Deep\n"),
    ).toEqual([
      { depth: 2, text: "The ov CLI", id: "the-ov-cli" },
      { depth: 3, text: "One", id: "one" },
    ]);
  });

  it("de-duplicates repeated headings the way the slugger does", () => {
    expect(extractHeadings("## Notes\n\n## Notes\n").map((h) => h.id)).toEqual([
      "notes",
      "notes-1",
    ]);
  });

  it("ignores comment lines inside a fenced block", () => {
    expect(extractHeadings("```\n## not a heading\n```\n\n## Real\n")).toEqual([
      { depth: 2, text: "Real", id: "real" },
    ]);
  });
});

describe("the documentation site", () => {
  it("loads every page with a title, a description and a body", async () => {
    const pages = await loadDocPages();
    expect(pages.length).toBeGreaterThanOrEqual(10);
    for (const page of pages) {
      expect(page.title, page.slug).not.toBe("");
      expect(page.description, page.slug).not.toBe("");
      expect(page.body.length, page.slug).toBeGreaterThan(200);
      expect(page.order, page.slug).toBeGreaterThan(0);
    }
  });

  it("orders the pages and puts the index first", async () => {
    const pages = await loadDocPages();
    expect(pages[0]?.slug).toBe("");
    const orders = pages.map((page) => page.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("keeps every slug unique", async () => {
    const slugs = (await loadDocPages()).map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("renders the repository files rather than copying them", async () => {
    const api = await loadDocPage("api");
    expect(api?.source).toBe("docs/API.md");
    // Content only present in docs/API.md, so the file really was read.
    expect(api?.body).toContain("app.openverdict.info/api");
    expect(api?.headings.length).toBeGreaterThan(5);

    const agents = await loadDocPage("agents");
    expect(agents?.source).toBe("AGENTS.md");
    expect(agents?.body).toContain("pnpm ov help");
  });

  it("rewrites the relative links of a rendered file to the repository", async () => {
    const agents = await loadDocPage("agents");
    expect(agents?.body).toContain(
      "https://github.com/Marcussy34/OpenVerdict/blob/main/docs/API.md",
    );
    expect(agents?.body).not.toContain("](./README.md)");
  });

  it("substitutes the release ids into the contracts page", async () => {
    const contracts = await loadDocPage("contracts");
    expect(contracts?.body).not.toMatch(/\{\{[A-Za-z]/);
    expect(contracts?.body).toMatch(/0x[0-9a-f]{64}/);
    expect(contracts?.body).toContain("testnet");
  });

  it("leaves no token unresolved on any page", async () => {
    for (const page of await loadDocPages()) {
      expect(page.body, page.slug).not.toMatch(/\{\{[A-Za-z]\w*\}\}/);
    }
  });

  it("returns null for a route that does not exist", async () => {
    expect(await loadDocPage("no-such-page")).toBeNull();
  });

  it("uses no em dash anywhere in the pages it authors", async () => {
    for (const page of await loadDocPages()) {
      if (page.source) continue; // rendered repository files are not ours
      expect(page.body, page.slug).not.toContain("—");
    }
  });
});

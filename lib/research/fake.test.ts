import { describe, expect, it } from "vitest";

import { createFakeResearchProvider } from "./fake";

describe("fake research provider", () => {
  it("returns deterministic ranked results for the requested limit", async () => {
    const provider = createFakeResearchProvider();

    const first = await provider.search("sui walrus", {
      limit: 2,
      timeoutMs: 1_000,
    });
    const second = await provider.search("sui walrus", {
      limit: 2,
      timeoutMs: 1_000,
    });

    expect(second).toEqual(first);
    expect(first).toEqual([
      {
        rank: 1,
        url: "https://fake.evidence.test/sui-walrus/1",
        title: "Result 1 for sui walrus",
        snippet: "Fake snippet 1 about sui walrus.",
      },
      {
        rank: 2,
        url: "https://fake.evidence.test/sui-walrus/2",
        title: "Result 2 for sui walrus",
        snippet: "Fake snippet 2 about sui walrus.",
      },
    ]);
  });

  it("opens a deterministic page close to the configured size", async () => {
    const provider = createFakeResearchProvider({ pageChars: 240 });
    const url = "https://fake.evidence.test/sui-walrus/1";

    const page = await provider.open(url, { timeoutMs: 1_000 });

    expect(page).toMatchObject({
      url,
      finalUrl: url,
      title: "Result 1 for sui walrus",
      fetchedAtMs: 0,
      statusCode: 200,
    });
    expect(page.markdown).toHaveLength(240);
    expect(page.markdown).toContain(`Fake page for ${url}.`);
    expect(page.markdown).toContain("This page discusses sui-walrus in detail.");
  });

  it("rejects configured and unknown hosts as network failures", async () => {
    const provider = createFakeResearchProvider({
      failHosts: ["blocked.evidence.test"],
    });

    await expect(
      provider.open("https://blocked.evidence.test/page", { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "network" });
    await expect(
      provider.open("https://unknown.evidence.test/page", { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

import { describe, expect, it } from "vitest";

import { claimHref, parseClaimLink } from "./claim-link";

const ID = "0x5cd74bcad03de77d8243b7a8933b6f0d03f4eca26daf8c8370616457eca93cb8";
const RUN = "0x2e3c5753a8b0fb470669650ddb4c7dc5b0712d14027b898bf1e633a893d62acb";

function link(input: string) {
  const result = parseClaimLink(input);
  if (!result.ok) throw new Error(`expected a claim link: ${result.reason}`);
  return result.link;
}

describe("parseClaimLink", () => {
  it("accepts a bare id, in either case", () => {
    expect(link(ID)).toEqual({ claimId: ID });
    expect(link(ID.toUpperCase().replace("0X", "0x")).claimId).toBe(ID);
    expect(link(`  ${ID}  `).claimId).toBe(ID);
  });

  it("accepts the claim, report, observe and run link shapes", () => {
    expect(link(`https://app.openverdict.info/claims/${ID}`)).toEqual({
      claimId: ID,
      origin: "https://app.openverdict.info",
    });
    expect(link(`https://app.openverdict.info/claims/${ID}/report?tab=jury#votes`).claimId).toBe(ID);
    expect(link(`https://app.openverdict.info/claims/${ID}/observe`).runId).toBeUndefined();
    expect(link(`https://app.openverdict.info/claims/${ID}/runs/${RUN}`)).toEqual({
      claimId: ID,
      origin: "https://app.openverdict.info",
      runId: RUN,
    });
    expect(link(`https://app.openverdict.info/api/claims/${ID}/report`).claimId).toBe(ID);
  });

  it("keeps the origin of the pasted link", () => {
    expect(link(`http://localhost:3000/claims/${ID}`).origin).toBe("http://localhost:3000");
    expect(link(`app.openverdict.info/claims/${ID}`).origin).toBe("https://app.openverdict.info");
  });

  it("names why an input is not a claim", () => {
    expect(parseClaimLink("")).toEqual({ ok: false, reason: expect.stringContaining("Paste") });
    expect(parseClaimLink("0xzz")).toEqual({ ok: false, reason: expect.stringContaining("64 hex") });
    expect(parseClaimLink("not a claim")).toEqual({
      ok: false,
      reason: expect.stringContaining("not a claim link or id"),
    });
    expect(parseClaimLink("https://app.openverdict.info/agents/0x1")).toEqual({
      ok: false,
      reason: expect.stringContaining("not a claim link or id"),
    });
    expect(parseClaimLink(`https://app.openverdict.info/claims/zzz`)).toEqual({
      ok: false,
      reason: expect.stringContaining("not a claim id"),
    });
  });

  it("rejects a queue link by name", () => {
    expect(parseClaimLink("https://app.openverdict.info/fact-check/queue/queue-42")).toEqual({
      ok: false,
      reason: expect.stringContaining("Queue links no longer exist"),
    });
  });
});

describe("claimHref", () => {
  it("keeps the pasted origin and falls back for a bare id", () => {
    expect(claimHref(link(`http://localhost:3000/claims/${ID}`), "https://app.openverdict.info")).toBe(
      `http://localhost:3000/claims/${ID}`,
    );
    expect(claimHref(link(ID), "https://app.openverdict.info")).toBe(
      `https://app.openverdict.info/claims/${ID}`,
    );
  });
});

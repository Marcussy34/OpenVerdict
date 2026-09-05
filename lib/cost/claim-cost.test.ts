import { describe, expect, it } from "vitest";

import proofFixture from "./__fixtures__/run-proof-minimax.json";
import walrusTxFixture from "./__fixtures__/sui-walrus-write-txs.json";
import {
  FIRECRAWL_CREDITS_PER_OPEN,
  FIRECRAWL_CREDITS_PER_SEARCH,
  attemptsFromProofs,
  blobsFromAudit,
  gasGroupForEvent,
  modelUsd,
  netGasMist,
  parseModelPrices,
  priceMeasurement,
  stepsFromProofs,
  summariseBlobs,
  summariseGas,
  summariseModels,
  summariseResearch,
  totalTokens,
  walFromRegisterInputs,
  type AuditResultLike,
  type ClaimCostMeasurement,
  type GasEntry,
} from "./claim-cost";

/** The fixture is one seat's proof, keyed by run id the way the auditor keys it. */
const proofs: Record<string, unknown> = { [proofFixture.runId]: proofFixture };

function gasEntry(overrides: Partial<GasEntry>): GasEntry {
  return {
    digest: "digest",
    group: "other",
    event: "",
    computationCost: 0,
    storageCost: 0,
    storageRebate: 0,
    nonRefundableStorageFee: 0,
    netMist: 0,
    walFrost: 0,
    ...overrides,
  };
}

describe("gasGroupForEvent", () => {
  it("puts every lifecycle event in its own group", () => {
    expect(gasGroupForEvent("claim_created")).toBe("creation");
    expect(gasGroupForEvent("committee_selected")).toBe("committee");
    expect(gasGroupForEvent("evidence_frozen")).toBe("evidence");
    expect(gasGroupForEvent("run_approved")).toBe("run-approval");
    expect(gasGroupForEvent("vote_committed")).toBe("vote-commit");
    expect(gasGroupForEvent("phase_changed")).toBe("phase");
    expect(gasGroupForEvent("vote_revealed")).toBe("reveal");
    expect(gasGroupForEvent("claim_finalized")).toBe("finalize");
    expect(gasGroupForEvent("claim_voided")).toBe("finalize");
  });

  it("keeps an unknown event rather than dropping its gas", () => {
    expect(gasGroupForEvent("something_new")).toBe("other");
  });
});

describe("netGasMist", () => {
  it("reproduces what the register and certify transactions charged", () => {
    const [register, certify] = walrusTxFixture.transactions;
    expect(netGasMist(register!.effects.gasUsed)).toBe(5_631_480);
    expect(netGasMist(certify!.effects.gasUsed)).toBe(1_490_040);
  });

  it("subtracts the storage rebate, which is most of the storage cost", () => {
    expect(
      netGasMist({ computationCost: "1000", storageCost: "500", storageRebate: "400" }),
    ).toBe(1_100);
  });
});

describe("walFromRegisterInputs", () => {
  it("reads the WAL a register split, even with no balance changes", () => {
    const [register] = walrusTxFixture.transactions;
    // The node returned this one without balance changes, which is the case
    // the reader exists for.
    expect("balanceChanges" in register!).toBe(false);
    // 2,518,740 FROST of storage plus 503,685 FROST of write cost.
    expect(walFromRegisterInputs(register as never)).toBe(3_022_425);
  });

  it("says nothing about a transaction that is not a Walrus write", () => {
    const [, certify] = walrusTxFixture.transactions;
    expect(walFromRegisterInputs(certify as never)).toBeUndefined();
    expect(walFromRegisterInputs({ digest: "x" } as never)).toBeUndefined();
  });
});

describe("summariseGas", () => {
  it("sums by lifecycle group and keeps the page's order", () => {
    const grouped = summariseGas([
      gasEntry({ group: "reveal", netMist: 3 }),
      gasEntry({ group: "creation", netMist: 10 }),
      gasEntry({ group: "reveal", netMist: 4 }),
      gasEntry({ group: "walrus-register", netMist: 5, walFrost: 100 }),
    ]);
    expect(grouped.map((row) => row.group)).toEqual([
      "creation",
      "reveal",
      "walrus-register",
    ]);
    expect(grouped[1]).toMatchObject({ transactions: 2, netMist: 7 });
    expect(grouped[2]).toMatchObject({ netMist: 5, walFrost: 100 });
  });

  it("returns nothing for no transactions", () => {
    expect(summariseGas([])).toEqual([]);
  });
});

describe("summariseModels", () => {
  it("counts every attempt of the seat, including the repair turns", () => {
    const attempts = attemptsFromProofs(proofs);
    expect(attempts).toHaveLength(7);
    const models = summariseModels(attempts);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      modelId: "MiniMaxAI/MiniMax-M2.7",
      calls: 7,
      // One hedge hit a provider error and reported no usage.
      billedCalls: 6,
      inputTokens: 12_900,
      outputTokens: 736,
    });
    expect(totalTokens(models)).toBe(13_636);
  });

  it("keeps model families apart", () => {
    const models = summariseModels([
      { modelId: "a", inputTokens: 10, outputTokens: 1 },
      { modelId: "b", inputTokens: 20, outputTokens: 2 },
      { modelId: "a", inputTokens: 5, outputTokens: 0 },
    ]);
    expect(models.map((model) => model.modelId)).toEqual(["a", "b"]);
    expect(models[0]).toMatchObject({ calls: 2, inputTokens: 15, outputTokens: 1 });
  });

  it("labels an attempt with no model rather than dropping it", () => {
    expect(summariseModels([{}])[0]).toMatchObject({ modelId: "unknown", calls: 1, billedCalls: 0 });
  });
});

describe("summariseResearch", () => {
  it("bills neither a cached step nor a failed open", () => {
    const usage = summariseResearch(stepsFromProofs(proofs));
    expect(usage).toMatchObject({
      searches: 1,
      cachedSearches: 1,
      opens: 2,
      cachedOpens: 1,
      failedOpens: 1,
      billedSearches: 0,
      billedOpens: 0,
      credits: 0,
    });
  });

  it("charges Firecrawl's published rate for the calls that left the engine", () => {
    const usage = summariseResearch([
      { action: "search" },
      { action: "search", cached: true },
      { action: "open" },
      { action: "open" },
      { action: "open", cached: true },
      { action: "open", failed: true },
      { action: "answer" },
    ]);
    expect(usage.billedSearches).toBe(1);
    expect(usage.billedOpens).toBe(2);
    expect(usage.credits).toBe(
      FIRECRAWL_CREDITS_PER_SEARCH + 2 * FIRECRAWL_CREDITS_PER_OPEN,
    );
  });
});

describe("blobsFromAudit", () => {
  const audit = {
    runs: [
      { sealedBlobId: "sealed-1", revealedBlobId: "revealed-1" },
      { sealedBlobId: "sealed-2" },
    ],
    sources: {
      manifests: {
        "phase-1": {
          items: [
            {
              rawWalrusBlobId: "artifact",
              rawWalrusObjectId: "0xraw",
              canonicalWalrusBlobId: "artifact",
              canonicalWalrusObjectId: "0xcanonical",
            },
          ],
        },
      },
      report: { auditBundle: { evidence: [{ manifestBlobId: "manifest-1" }] } },
      proofs: {
        run: {
          bundle: {
            transcript: {
              opened: [
                { canonicalWalrusBlobId: "page-a" },
                // The same page opened by a second seat is one blob.
                { canonicalWalrusBlobId: "page-a" },
                { canonicalWalrusBlobId: "page-b" },
              ],
            },
          },
        },
      },
    },
  } as unknown as AuditResultLike;

  it("lists one entry per write, so a blob written twice is counted twice", () => {
    const blobs = blobsFromAudit(audit, {
      statementBlobId: "statement",
      criteriaBlobId: "criteria",
    });
    expect(blobs.map((blob) => `${blob.kind}:${blob.blobId}`)).toEqual([
      "claim-statement:statement",
      "resolution-criteria:criteria",
      "evidence-artifact:artifact",
      "evidence-artifact:artifact",
      "evidence-manifest:manifest-1",
      "sealed-run-bundle:sealed-1",
      "revealed-run-bundle:revealed-1",
      "sealed-run-bundle:sealed-2",
      "opened-page:page-a",
      "opened-page:page-b",
    ]);
    // The raw and canonical writes are two distinct Sui objects.
    expect(blobs[2]?.objectId).toBe("0xraw");
    expect(blobs[3]?.objectId).toBe("0xcanonical");
  });

  it("skips the creation blobs when the claim object could not be read", () => {
    const blobs = blobsFromAudit(audit, {});
    expect(blobs.some((blob) => blob.kind === "claim-statement")).toBe(false);
  });
});

describe("summariseBlobs", () => {
  it("groups by kind and adds the storage and the write gas", () => {
    const rows = summariseBlobs([
      {
        kind: "sealed-run-bundle",
        blobId: "a",
        size: 100,
        paidFrost: 10,
        quotedStorageFrost: 8,
        quotedWriteFrost: 1,
        registerNetMist: 5,
        certifyNetMist: 2,
      },
      { kind: "sealed-run-bundle", blobId: "b", size: 50, paidFrost: 10 },
      { kind: "evidence-manifest", blobId: "c", size: 20, paidFrost: 3 },
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["evidence-manifest", "sealed-run-bundle"]);
    expect(rows[1]).toMatchObject({
      count: 2,
      bytes: 150,
      paidFrost: 20,
      quotedFrost: 9,
      gasMist: 7,
    });
  });
});

describe("priceMeasurement", () => {
  const measurement = {
    totalGasMist: 100_000_000,
    walPaidFrost: 50_000_000,
    models: [
      { modelId: "m", calls: 1, billedCalls: 1, inputTokens: 600_000, outputTokens: 400_000 },
    ],
    research: {
      searches: 1,
      cachedSearches: 0,
      opens: 0,
      cachedOpens: 0,
      failedOpens: 0,
      billedSearches: 1,
      billedOpens: 0,
      credits: 2,
    },
  } as unknown as ClaimCostMeasurement;

  it("converts each component with the rate it was given", () => {
    const usd = priceMeasurement(measurement, {
      suiUsd: 1,
      walUsd: 2,
      gonkaUsdPerMillionTokens: { "*": 10 },
      firecrawlUsdPerCredit: 0.5,
    });
    expect(usd.gas).toBeCloseTo(0.1, 10);
    expect(usd.walrus).toBeCloseTo(0.1, 10);
    expect(usd.inference).toBeCloseTo(10, 10);
    expect(usd.research).toBeCloseTo(1, 10);
    expect(usd.total).toBeCloseTo(11.2, 10);
  });

  it("reports no total when a rate is missing", () => {
    const usd = priceMeasurement(measurement, { suiUsd: 1 });
    expect(usd.gas).toBeCloseTo(0.1, 10);
    expect(usd.walrus).toBeUndefined();
    expect(usd.total).toBeUndefined();
  });

  it("prefers an exact model price over the fallback", () => {
    const model = { modelId: "m", calls: 1, billedCalls: 1, inputTokens: 1_000_000, outputTokens: 0 };
    expect(modelUsd(model, { gonkaUsdPerMillionTokens: { m: 3, "*": 7 } })).toBe(3);
    expect(modelUsd(model, { gonkaUsdPerMillionTokens: { "*": 7 } })).toBe(7);
    expect(modelUsd(model, {})).toBeUndefined();
  });
});

describe("parseModelPrices", () => {
  it("reads one price for every model", () => {
    expect(parseModelPrices("0.0012")).toEqual({ "*": 0.0012 });
  });

  it("reads a price per model, model ids with slashes included", () => {
    expect(parseModelPrices("moonshotai/Kimi-K2.6=0.5, deepseek-ai/DeepSeek-V4-Flash-0731=0.25")).toEqual({
      "moonshotai/Kimi-K2.6": 0.5,
      "deepseek-ai/DeepSeek-V4-Flash-0731": 0.25,
    });
  });

  it("rejects a value that is not a price", () => {
    expect(() => parseModelPrices("free")).toThrow(/expects a price/);
    expect(() => parseModelPrices("")).toThrow(/at least one price/);
  });
});

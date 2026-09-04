import { describe, expect, it } from "vitest";

import { computeTruthScoreBps } from "../protocol/truthScore";
import { OUTCOME } from "../protocol/constants";
import { readClaimRecord, shortModel } from "./report-prefill";

const CLAIM = "0x5cd74bcad03de77d8243b7a8933b6f0d03f4eca26daf8c8370616457eca93cb8";
const SEAT_A = "0x22fc0844be874f931a887cad354d194d60faa916a3d4cbcdc002ab1d358f7924";
const SEAT_B = "0xad7cdb4e24bb2ec084531caa6e9b9e65bdf6a11bb40edada87055c9e54a7a246";
const SEAT_C = "0xe1563d0361944be62a049cb45b765928dcdfa9bcfecd4ed0872c36ab0094412a";
const AGENT_A = "0x28734d2a9222088907dcbf24a7b22e0f71d7848e2798a9b42ae6d3960cf20de2";
const AGENT_B = "0x4ee991ed45555cecef84741021cfc61d92dd8d30bf289321eff744177cba35f2";
const AGENT_C = "0xd5e9022fe5b0f720529451ffe8ed1a794661180007c09758fe96785731150e82";
const RUN_A = "0x2e3c5753a8b0fb470669650ddb4c7dc5b0712d14027b898bf1e633a893d62acb";
const RUN_B = "0x6f86ed586d1687eff1c3d2a6e13fad59804ac945eded078ea609ed91c51d1f7c";
const ROOT_1 = "0x1f069055d19f0b5d811572fd5cb371be7880883162c125efec1ec644b90ec464";
const ROOT_2 = "0xfe59285de8aa6b892899480fdfd28aef5f1f631ad066ff9d1c53ad02ee724d50";

/** The shape of GET /api/claims/<id>/report, trimmed to what the page reads. */
const REPORT = {
  claimId: CLAIM,
  statement: "OpenVerdict localnet split-vote proof reaches discussion.",
  label: "YES",
  truthScore: 68.4,
  finalRoundVotes: [
    { jurySeatId: SEAT_A, outcome: "YES", confidenceBps: 8150, valid: true },
    { jurySeatId: SEAT_B, outcome: "NO", confidenceBps: 8900, valid: true },
    { jurySeatId: SEAT_C, outcome: "YES", confidenceBps: 8650, valid: false },
  ],
  agents: [
    { agentProfileId: AGENT_A, modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
    { agentProfileId: AGENT_B, modelId: "MiniMaxAI/MiniMax-M2.7" },
  ],
  auditBundle: {
    evidence: [
      { phase: 1, root: ROOT_1 },
      { phase: 2, root: ROOT_2 },
    ],
    runs: [
      { runId: RUN_A, agentProfileId: AGENT_A, outputHash: "0xa9f3", runHash: "0xbc82" },
      { runId: RUN_B, agentProfileId: AGENT_B, outputHash: "0x28a5", runHash: "0xf51d" },
    ],
    commitments: [
      { phase: 2, jurySeatId: SEAT_A, agentProfileId: AGENT_A, commitment: "0xd61a", revealed: true },
      { phase: 2, jurySeatId: SEAT_B, agentProfileId: AGENT_B, commitment: "0x621b", revealed: true },
      { phase: 2, jurySeatId: SEAT_C, agentProfileId: AGENT_C, commitment: "0xdc9d", revealed: true },
    ],
    reveals: [
      { runId: RUN_A, transactionDigest: "B2FZD42YCXtJ6bGdrJxTBfMn6FRAVB9TwceTUrdwKkVi" },
      { runId: RUN_B, transactionDigest: "AJzk45jhqYh1ZLfM5wUmk8pQdF3RbnT9xVzC6sKpWq2v" },
    ],
  },
};

describe("readClaimRecord", () => {
  it("joins each valid reveal to its commitment, run and evidence root", () => {
    const record = readClaimRecord(REPORT);
    expect(record?.claimId).toBe(CLAIM);
    expect(record?.label).toBe("YES");
    expect(record?.truthScore).toBe(68.4);
    expect(record?.seats).toHaveLength(2);
    expect(record?.seats[0]).toEqual({
      jurySeatId: SEAT_A,
      agentProfileId: AGENT_A,
      phase: 2,
      outcome: OUTCOME.YES,
      confidenceBps: 8150,
      evidenceRoot: ROOT_2,
      outputHash: "0xa9f3",
      runHash: "0xbc82",
      commitment: "0xd61a",
      runId: RUN_A,
      modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
      revealTx: "B2FZD42YCXtJ6bGdrJxTBfMn6FRAVB9TwceTUrdwKkVi",
    });
    // The evidence root follows the seat's phase, not the first manifest.
    expect(record?.seats.every((seat) => seat.evidenceRoot === ROOT_2)).toBe(true);
  });

  it("drops an invalid reveal and a seat whose run is missing", () => {
    const record = readClaimRecord(REPORT);
    expect(record?.seats.map((seat) => seat.jurySeatId)).toEqual([SEAT_A, SEAT_B]);
  });

  it("reproduces the certificate score from the prefilled votes", () => {
    const record = readClaimRecord({
      ...REPORT,
      finalRoundVotes: [
        { jurySeatId: SEAT_A, outcome: "YES", confidenceBps: 8150, valid: true },
        { jurySeatId: SEAT_B, outcome: "NO", confidenceBps: 8900, valid: true },
      ],
    });
    const bps = computeTruthScoreBps(record?.seats ?? []);
    expect(bps).toBe(Math.round(((8150 + (10_000 - 8900)) / 2)));
  });

  it("keeps a claim with no reveals yet, and refuses a non-report", () => {
    const pending = readClaimRecord({ claimId: CLAIM, statement: "x", label: "PENDING" });
    expect(pending?.seats).toEqual([]);
    expect(pending?.truthScore).toBeNull();
    expect(readClaimRecord({ error: "claim_not_found" })).toBeNull();
    expect(readClaimRecord(null)).toBeNull();
  });
});

describe("shortModel", () => {
  it("keeps the model name and drops the vendor prefix", () => {
    expect(shortModel("deepseek-ai/DeepSeek-V4-Flash-0731")).toBe("DeepSeek-V4-Flash-0731");
    expect(shortModel("moonshotai/Kimi-K2.6")).toBe("Kimi-K2.6");
    expect(shortModel(undefined)).toBe("Unknown model");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ClaimInspection } from "../engine/contract";
import { deriveRunId } from "../verify/run-proof";
import { Api, OvError } from "./api";
import { auditCommand, traceCommand, type CommandEnv } from "./commands";
import { captured, clone, createClock, fakeFetch, fixture, json, type FakeFetch } from "./fixtures.test-utils";

const BASE = "https://ov.test";
const NOW = Date.parse("2026-09-03T10:00:00Z");
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const DEBATE = fixture<ClaimInspection>("claim-debate.json");
const RESEARCH_PROOF = fixture<Record<string, unknown>>("trace-proof-research.json");
const TABLE_VOTE_PROOF = fixture<Record<string, unknown>>("trace-proof-table-vote.json");

const ROLES: Record<string, string> = {
  "deepseek-ai/DeepSeek-V4-Flash-0731": "SOURCE_AUTHENTICITY",
  "MiniMaxAI/MiniMax-M2.7": "SKEPTIC",
  "moonshotai/Kimi-K2.6": "SKEPTIC",
};

/** The report the auditor reads for roles and owners; the rest is not needed here. */
function reportFor(inspection: ClaimInspection): Record<string, unknown> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const seat of inspection.commitments) {
    if (seen.has(seat.agentProfileId)) continue;
    seen.set(seat.agentProfileId, {
      agentProfileId: seat.agentProfileId,
      modelId: seat.modelId,
      role: ROLES[seat.modelId ?? ""] ?? "SKEPTIC",
      owner: `0x${"11".repeat(32)}`,
    });
  }
  return {
    claimId: inspection.claimId,
    statement: inspection.statement,
    submittedUrls: [],
    label: inspection.result?.result ?? "PENDING",
    truthScore: inspection.result?.truthScoreBps ?? null,
    truthScoreFormula: "mean of the valid final-round beliefs",
    finalRoundVotes: [],
    agents: [...seen.values()],
    evidence: [],
    sui: { claimObjectId: inspection.claimId, revealedVoteIds: [] },
    auditBundle: {},
  };
}

/** One proof fixture, retargeted at the seat it stands for. */
function proofFor(
  source: Record<string, unknown>,
  seat: { claimId: string; jurySeatId: string; agentProfileId: string; phase: 1 | 2; modelId?: string },
): Record<string, unknown> {
  const runId = deriveRunId(seat.claimId, seat.jurySeatId, seat.phase);
  const proof = clone(source) as Record<string, unknown>;
  const bundle = proof.bundle as Record<string, unknown>;
  const audit = bundle.audit as Record<string, unknown>;
  const fields = { runId, claimId: seat.claimId, jurySeatId: seat.jurySeatId, agentProfileId: seat.agentProfileId, phase: seat.phase };
  Object.assign(proof, fields);
  Object.assign(bundle, fields);
  Object.assign(audit, { ...fields, claimObjectId: seat.claimId, ...(seat.modelId ? { modelId: seat.modelId, responseModelId: seat.modelId } : {}) });
  return proof;
}

type Setup = { env: CommandEnv; net: FakeFetch; out: string[]; err: string[] };

/**
 * The public endpoints the trace needs. Sui, Walrus and the receipts stay
 * unrouted (404), which the auditor reports as unavailable and the trail
 * never reads.
 */
function setup(
  inspection: ClaimInspection,
  proofs: Record<string, Record<string, unknown>>,
  options: { json?: boolean } = {},
): Setup {
  const clock = createClock(NOW);
  const routes: Record<string, () => Response> = {
    [`GET /api/claims/${inspection.claimId}`]: () => json(inspection),
    [`GET /api/claims/${inspection.claimId}/report`]: () => json(reportFor(inspection)),
    [`GET /api/claims/${inspection.claimId}/events`]: () => json({ error: "not_found" }, 404),
    "GET /api/agents": () => json({ agents: [] }),
  };
  for (const [runId, proof] of Object.entries(proofs)) {
    routes[`GET /api/claims/${inspection.claimId}/runs/${runId}/proof`] = () => json(proof);
  }
  const net = fakeFetch(routes);
  const output = captured();
  const env: CommandEnv = {
    api: new Api({ base: BASE, fetch: net.fetch, sleep: clock.sleep }),
    io: output.io,
    json: options.json ?? false,
    now: clock.now,
    sleep: clock.sleep,
    width: 100,
  };
  return { env, net, out: output.out, err: output.err };
}

/** Every seat of a round with the same proof fixture behind it. */
function proofsForRound(
  inspection: ClaimInspection,
  phase: 1 | 2,
  source: Record<string, unknown>,
  options: { skip?: string[] } = {},
): Record<string, Record<string, unknown>> {
  const round = (inspection.rounds ?? []).find((entry) => entry.phase === phase);
  const proofs: Record<string, Record<string, unknown>> = {};
  for (const jurySeatId of round?.expectedJurySeatIds ?? []) {
    if (options.skip?.includes(jurySeatId)) continue;
    const seat = inspection.commitments.find((entry) => entry.jurySeatId === jurySeatId);
    if (!seat) continue;
    const runId = deriveRunId(inspection.claimId, jurySeatId, phase);
    proofs[runId] = proofFor(source, {
      claimId: inspection.claimId,
      jurySeatId,
      agentProfileId: seat.agentProfileId,
      phase,
      ...(seat.modelId ? { modelId: seat.modelId } : {}),
    });
  }
  return proofs;
}

async function failure(promise: Promise<unknown>): Promise<OvError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OvError) return error;
    throw error;
  }
  throw new Error("expected an OvError");
}

describe("ov trace on a settled one-round claim", () => {
  it("prints one numbered trail per juror, in seat order, with the answer and the receipt", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, full: false })).toBe(0);
    const text = s.out.join("\n");
    expect(s.out[0]).toBe(`claim      ${FINALIZED.claimId}`);
    expect(s.out[1]).toBe("statement  Humans use only ten percent of their brains.");

    // Seat order comes from the round's expected seats, models from the record.
    const headers = s.out.filter((line) => line.startsWith("juror "));
    expect(headers).toHaveLength(5);
    expect(headers[0]).toMatch(/^juror 1 {2}DeepSeek V4 Flash {2}SOURCE_AUTHENTICITY {2}round 1 {2}NO 9500 bps {2}run 0x/);
    expect(headers[2]).toContain("juror 3  MiniMax M2.7  SKEPTIC  round 1");
    expect(headers[4]).toContain("juror 5  Kimi K2.6  SKEPTIC  round 1");

    // The turns follow request.messages: search, open, search, open, answer.
    expect(text).toContain('  1. search (challenge) "humans use only ten percent of their brains myth false"');
    expect(text).toContain("       3 results: mcgovern.mit.edu, psychologicalscience.org, en.wikipedia.org");
    expect(text).toContain("  2. open 3 pages");
    expect(text).toContain("       mcgovern.mit.edu/2024/01/26/do-we-use-only-10-percent-of-our-brain  evidence 0xd6672357…  4000 of 6575 chars");
    expect(text).toContain("       en.wikipedia.org/wiki/Ten-percent-of-the-brain_myth  evidence 0x8966af5f…  4000 of 60000 chars, truncated");
    expect(text).toContain('  3. search (support) "brain imaging shows all parts of brain active evidence"');
    expect(text).toContain("  5. answer NO 9500 bps");
    expect(text).toContain("       reasoning: The claim that humans use only ten percent of their brains is a well-documented");
    expect(text).toContain("       [CONTRADICTS] Challenge search for myth debunking: Multiple authoritative sources explicitly");
    expect(text).toContain('       cites mcgovern.mit.edu: "But the idea that we use 10 percent of our brain is 100 percent a');
    expect(text).toContain("       counter-evidence: The strongest evidence against my verdict is the widespread popular belief");
    expect(text).toContain("       gonka req-1788405572969008592-322552  devshard 70083  9029 tokens  19.1 s");

    // Prose wraps at the width; no line of the trail runs past it except urls.
    const prose = s.out.filter((line) => line.startsWith("       reasoning") || line.startsWith("         "));
    for (const line of prose) expect(line.length).toBeLessThanOrEqual(100);
  });

  it("--juror keeps one seat, --full adds the pinned prompt once and the verbatim messages", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 3, full: true })).toBe(0);
    const text = s.out.join("\n");
    const headers = s.out.filter((line) => line.startsWith("juror "));
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain("juror 3  MiniMax M2.7");
    // The prompt is identical for every juror of a round, so it prints once.
    expect(s.out.filter((line) => line.startsWith("pinned prompt"))).toHaveLength(1);
    expect(s.out[3]).toBe("pinned prompt (hash 0x7257117d…)");
    expect(text).toContain("Research independently and weigh both sides.");
    expect(text).toContain("  verbatim (run 0x");
    expect(text).toContain("       turn 1 assistant:");
    expect(text).toContain("       turn 1 result:");
    expect(text).toContain("       raw answer:");
    // Page texts are only in the verbatim block, never in the turn list.
    expect(text).toContain('"text": "Press Ctrl + M shortcut to');
  });

  it("reads an action a reasoning model wrapped in a think block", async () => {
    const wrapped = clone(RESEARCH_PROOF) as { bundle: { request: { messages: Array<{ role: string; content: string }> } } };
    const first = wrapped.bundle.request.messages[2]!;
    first.content = `<think>The claim is a well-known myth, so I search against it first.</think>${first.content}`;
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, wrapped as unknown as Record<string, unknown>));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    expect(s.out.join("\n")).toContain('  1. search (challenge) "humans use only ten percent of their brains myth false"');
    expect(s.out.join("\n")).not.toContain("1. unknown");
  });

  it("falls back to the transcript when a legacy bundle carries no messages", async () => {
    const legacy = clone(RESEARCH_PROOF) as { bundle: { request: Record<string, unknown> } };
    delete legacy.bundle.request.messages;
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, legacy as unknown as Record<string, unknown>));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    const text = s.out.join("\n");
    // The transcript expands one open into a step per page; the turns rejoin them.
    expect(text).toContain('  1. search (challenge) "humans use only ten percent of their brains myth false"');
    expect(text).toContain("  2. open 3 pages");
    expect(text).toContain("  5. answer NO 9500 bps");
    expect(text).not.toContain("  6. ");
  });

  it("refuses a juror number the claim does not have", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    const error = await failure(traceCommand(s.env, { target: FINALIZED.claimId, juror: 9, full: false }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe("this claim has 5 jurors; there is no juror 9");
  });

  it("says so when --round 2 is asked of a one-round claim", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, round: 2, full: false })).toBe(0);
    expect(s.out).toContain("this claim settled in one round; there is no round two");
    expect(s.out.filter((line) => line.startsWith("juror "))).toHaveLength(0);
  });

  it("--json prints the documented shape on stdout", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF), { json: true });
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    const document = JSON.parse(s.out.join("\n")) as {
      claimId: string;
      statement: string;
      jurors: Array<{
        jurorIndex: number;
        modelId: string;
        role: string;
        rounds: Array<{
          phase: number;
          runId: string;
          kind: string;
          vote: { outcome: string; confidenceBps: number };
          gateway: { requestId: string; devshardId: string; tokens: number; latencyMs: number };
          turns: Array<{
            ordinal: number;
            action: string;
            intent?: string;
            query?: string;
            results?: Array<{ url: string; title: string }>;
            urls?: string[];
            pages?: Array<{ url: string; evidenceId: string; chars: number; totalChars: number }>;
            answer?: { outcome: string; citations: unknown[] };
          }>;
        }>;
      }>;
    };
    expect(document.claimId).toBe(FINALIZED.claimId);
    expect(document.statement).toBe("Humans use only ten percent of their brains.");
    expect(document.jurors).toHaveLength(1);
    const juror = document.jurors[0]!;
    expect(juror).toMatchObject({ jurorIndex: 1, modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", role: "SOURCE_AUTHENTICITY" });
    const round = juror.rounds[0]!;
    expect(round).toMatchObject({ phase: 1, kind: "research", vote: { outcome: "NO", confidenceBps: 9_500 } });
    expect(round.gateway).toMatchObject({ requestId: "req-1788405572969008592-322552", devshardId: "70083", tokens: 9_029, latencyMs: 19_110 });
    expect(round.turns.map((turn) => turn.action)).toEqual(["search", "open", "search", "open", "answer"]);
    expect(round.turns[0]).toMatchObject({ ordinal: 1, intent: "challenge", query: "humans use only ten percent of their brains myth false" });
    expect(round.turns[0]!.results?.[0]).toEqual({
      url: "https://mcgovern.mit.edu/2024/01/26/do-we-use-only-10-percent-of-our-brain/",
      title: "Do we only use 10 percent of our brain? - MIT McGovern Institute",
    });
    expect(round.turns[1]!.pages?.[0]).toEqual({
      url: "https://mcgovern.mit.edu/2024/01/26/do-we-use-only-10-percent-of-our-brain",
      evidenceId: "0xd6672357c46e220b267a647bee11c03351cc1164cdcb0a30ea9587bb9d0015bb",
      chars: 4_000,
      totalChars: 6_575,
    });
    expect(round.turns[4]!.answer).toMatchObject({ outcome: "NO" });
    expect(round.turns[4]!.answer!.citations).toHaveLength(3);
  });
});

describe("ov trace on a two-round claim", () => {
  const proofs = {
    ...proofsForRound(DEBATE, 1, RESEARCH_PROOF, {
      skip: ["0x470d104b984be82bbdba850cbad66887ac1b33d45508f07060efc7d07a3fed78", "0x8cd8ad47506bc36044888364200b727e81cccbe51a4abb96c57d161800a8d295"],
    }),
    ...proofsForRound(DEBATE, 2, TABLE_VOTE_PROOF, {
      skip: ["0x1d183bf149f16964dc4b0cc632a651f642ca1928edfe292690d774503c22ae50"],
    }),
  };

  it("prints round one, then the debate, then every table vote", async () => {
    const s = setup(DEBATE, proofs);
    expect(await traceCommand(s.env, { target: DEBATE.claimId, full: false })).toBe(0);
    const text = s.out.join("\n");
    const order = s.out.filter((line) => line.startsWith("juror ") || line.startsWith("debate "));
    expect(order[0]).toContain("round 1");
    expect(order[5]).toBe("debate  6 turns");
    expect(order.slice(6).every((line) => line.includes("round 2"))).toBe(true);
    expect(order[7]).toContain("round 2 (table vote)");

    // A seat that failed closed says so instead of showing a trail.
    expect(text).toContain("round 1  no revealed run (the seat failed: PROVIDER_ERROR)");
    expect(text).toContain("round 1  no revealed run (the seat failed: INVALID_SCHEMA)");
    expect(text).toContain("round 2  no revealed run (the seat failed: TIMEOUT)");

    // The debate turns keep their order, their juror and their citation ids.
    expect(text).toContain("  turn 1, exchange 1, juror 2 (Kimi K2.6): I maintain my NO vote.");
    expect(text).toContain("       cites 0xfe437130…, 0x63871c23…, 0x5b1d2d09…");
    expect(text).toContain("  turn 6, exchange 2, juror 5 (DeepSeek V4 Flash):");

    // The table vote is one answer turn with the reasoning and no searches.
    expect(text).toContain("  1. answer NO 9000 bps");
    expect(text).toContain("       reasoning: The debate did not move me:");
    expect(text).toContain("       [CONTRADICTS] Weigh the randomized trial against the claim:");
    expect(text).toContain("       gonka req-1788321632642429990-17577  devshard 69429  3610 tokens  16.0 s");
    expect(text).not.toContain("  2. search");
  });

  it("--round 2 leads with the debate and keeps only the table votes", async () => {
    const s = setup(DEBATE, proofs);
    expect(await traceCommand(s.env, { target: DEBATE.claimId, round: 2, full: false })).toBe(0);
    const order = s.out.filter((line) => line.startsWith("juror ") || line.startsWith("debate "));
    expect(order[0]).toBe("debate  6 turns");
    expect(order.slice(1).every((line) => line.includes("round 2"))).toBe(true);
    expect(s.out.join("\n")).not.toContain("round 1");
  });

  it("--round 1 keeps the research and drops the debate", async () => {
    const s = setup(DEBATE, proofs);
    expect(await traceCommand(s.env, { target: DEBATE.claimId, round: 1, full: false })).toBe(0);
    expect(s.out.filter((line) => line.startsWith("debate"))).toHaveLength(0);
    expect(s.out.filter((line) => line.startsWith("juror "))).toHaveLength(5);
    expect(s.out.join("\n")).not.toContain("round 2");
  });

  it("names the older round-two research format instead of pretending it is a table vote", async () => {
    const legacy = clone(DEBATE);
    const s = setup(legacy, {
      ...proofsForRound(legacy, 1, RESEARCH_PROOF),
      ...proofsForRound(legacy, 2, RESEARCH_PROOF),
    });
    expect(await traceCommand(s.env, { target: legacy.claimId, round: 2, full: false })).toBe(0);
    expect(s.out).toContain(
      "round two here is the older research format (bundle version 5): these jurors researched again instead of casting the pinned table vote",
    );
    expect(s.out.join("\n")).not.toContain("(table vote)");
  });
});

describe("ov audit hands the reader on to the trail", () => {
  it("closes the verdict card with the trace command, and --trace prints the trail after it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-"));
    try {
      const plain = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
      await auditCommand(plain.env, { target: FINALIZED.claimId, quiet: true, outPath: join(directory, "plain.md") });
      expect(plain.out.at(-1)).toBe(`research trail: ov trace ${FINALIZED.claimId}`);
      expect(plain.out.some((line) => line.startsWith("juror 1  DeepSeek"))).toBe(false);

      const traced = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
      await auditCommand(traced.env, {
        target: FINALIZED.claimId,
        quiet: true,
        outPath: join(directory, "traced.md"),
        trace: { juror: 1, full: false },
      });
      const handoff = traced.out.indexOf(`research trail: ov trace ${FINALIZED.claimId}`);
      expect(handoff).toBeGreaterThan(0);
      expect(traced.out[handoff + 1]).toBe("");
      expect(traced.out[handoff + 2]).toBe(`claim      ${FINALIZED.claimId}`);
      expect(traced.out.filter((line) => line.startsWith("juror "))).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("ov trace inputs", () => {
  it("exits 2 on an unknown claim", async () => {
    const s = setup(FINALIZED, {});
    const unknown = `0x${"ab".repeat(32)}`;
    const error = await failure(traceCommand(s.env, { target: unknown, full: false }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("claim not found");
  });

  it("resolves a short id through the board, like status and audit", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    s.net.route("GET /api/claims", () => json({ claims: [FINALIZED] }));
    expect(await traceCommand(s.env, { target: "0x273220b5", full: false })).toBe(0);
    expect(s.err[0]).toContain("resolved 0x273220b5 to 0x2732…4ac6");
    expect(s.out[0]).toBe(`claim      ${FINALIZED.claimId}`);
  });

  it("sends a queue link back to ov queue", async () => {
    const s = setup(FINALIZED, {});
    const queueId = `0x${"9f".repeat(32)}`;
    const error = await failure(traceCommand(s.env, { target: `${BASE}/fact-check/queue/${queueId}`, full: false }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(`${queueId} is a queued submission: there is no jury yet, try ov queue ${queueId}`);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ClaimInspection } from "../engine/contract";
import { deriveRunId } from "../verify/run-proof";
import { Api, OvError } from "./api";
import { auditCommand, traceCommand, type CommandEnv } from "./commands";
import { captured, clone, createClock, fakeFetch, fixture, json, sseResponse, type FakeFetch } from "./fixtures.test-utils";

const BASE = "https://ov.test";
const NOW = Date.parse("2026-09-03T10:00:00Z");
const FINALIZED = fixture<ClaimInspection>("claim-finalized.json");
const DEBATE = fixture<ClaimInspection>("claim-debate.json");
const RESEARCH_PROOF = fixture<Record<string, unknown>>("trace-proof-research.json");
const TABLE_VOTE_PROOF = fixture<Record<string, unknown>>("trace-proof-table-vote.json");
const FAILED_PROOF = fixture<Record<string, unknown>>("trace-proof-failed.json");

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

/** A failure fixture, retargeted at the seat that failed closed. */
function failedProofFor(
  source: Record<string, unknown>,
  seat: { claimId: string; jurySeatId: string; agentProfileId: string; phase: 1 | 2 },
): Record<string, unknown> {
  const runId = deriveRunId(seat.claimId, seat.jurySeatId, seat.phase);
  const proof = clone(source) as Record<string, unknown>;
  const failure = proof.failure as Record<string, unknown>;
  const transcript = failure.transcript as Record<string, unknown>;
  Object.assign(proof, { runId, claimId: seat.claimId, jurySeatId: seat.jurySeatId, agentProfileId: seat.agentProfileId, phase: seat.phase });
  transcript.runId = runId;
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

  it("says a degraded jury sat before the trail, and nothing when three families did", async () => {
    const degraded: ClaimInspection = {
      ...FINALIZED,
      jury: { familyCount: 2, requiredFamilies: 2, degraded: true },
    };
    const s = setup(degraded, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    expect(await traceCommand(s.env, { target: degraded.claimId, full: false })).toBe(0);
    expect(s.out.join("\n")).toContain(
      "this jury sat on 2 model families (degraded mode): the operator lowered the requirement to 2 on chain while a provider was down",
    );

    const full = setup(
      { ...FINALIZED, jury: { familyCount: 3, requiredFamilies: 3, degraded: false } },
      proofsForRound(FINALIZED, 1, RESEARCH_PROOF),
    );
    expect(await traceCommand(full.env, { target: FINALIZED.claimId, full: false })).toBe(0);
    expect(full.out.join("\n")).not.toContain("degraded mode");
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

  it("appends the run's step timings to the receipt when the approval carried them", async () => {
    const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
    const seat = FINALIZED.rounds![0]!.expectedJurySeatIds[0]!;
    const runId = deriveRunId(FINALIZED.claimId, seat, 1);
    const clock = createClock(NOW);
    s.net.route(`GET /api/claims/${FINALIZED.claimId}/events`, (init) =>
      sseResponse(
        clock,
        [
          {
            event: {
              kind: "run_approved",
              sequence: 1,
              claimId: FINALIZED.claimId,
              runId,
              phase: "INFERENCE_1",
              source: "SUI",
              visibility: "PUBLIC_NOW",
              occurredAt: "2026-09-03T03:21:06.093Z",
              payload: { run_id: runId, timing_ms: { model: 19_100, upload: 8_000, approve: 3_000 } },
            },
          },
          { close: true },
        ],
        init?.signal,
      ),
    );

    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    expect(s.out.join("\n")).toContain(
      "       gonka req-1788405572969008592-322552  devshard 70083  9029 tokens  19.1 s  (model 19.1 s, upload 8.0 s, approve 3.0 s)",
    );
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

  it("says plainly that queue links are gone", async () => {
    const s = setup(FINALIZED, {});
    const queueId = `0x${"9f".repeat(32)}`;
    const error = await failure(traceCommand(s.env, { target: `${BASE}/fact-check/queue/${queueId}`, full: false }));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("queue links no longer exist");
  });
});

describe("ov trace on a seat that failed closed", () => {
  /** Round one with juror 1 failed closed and the other four seats revealed. */
  function withFailedSeat(source: Record<string, unknown> = FAILED_PROOF): Record<string, Record<string, unknown>> {
    const proofs = proofsForRound(FINALIZED, 1, RESEARCH_PROOF);
    const jurySeatId = FINALIZED.rounds![0]!.expectedJurySeatIds[0]!;
    const seat = FINALIZED.commitments.find((entry) => entry.jurySeatId === jurySeatId)!;
    proofs[deriveRunId(FINALIZED.claimId, jurySeatId, 1)] = failedProofFor(source, {
      claimId: FINALIZED.claimId,
      jurySeatId,
      agentProfileId: seat.agentProfileId,
      phase: 1,
    });
    return proofs;
  }

  it("rebuilds the turns, the attempt log and the failure line from the public record", async () => {
    const s = setup(FINALIZED, withFailedSeat());
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    const text = s.out.join("\n");

    // The header names the failure, its message and how many calls it took.
    const header = s.out.find((line) => line.startsWith("juror 1"))!;
    expect(header).toContain(
      "round 1  failed closed PROVIDER_ERROR (GonkaRouter provider request failed)  4 provider calls  run 0x",
    );
    expect(text).not.toContain("no revealed run");

    // The turns come from the recorded transcript, the two open steps rejoined.
    expect(text).toContain('  1. search (challenge) "humans use only ten percent of their brains myth false"');
    expect(text).toContain("       2 results: mcgovern.mit.edu, en.wikipedia.org");
    expect(text).toContain("  2. open 2 pages");
    expect(text).toContain("       mcgovern.mit.edu/2024/01/26/do-we-use-only-10-percent-of-our-brain/  evidence 0xd6672357…  4000 of 6575 chars");
    expect(text).toContain("       en.wikipedia.org/wiki/Ten-percent-of-the-brain_myth  evidence 0x8966af5f…  4000 of 60000 chars, truncated");
    expect(text).not.toContain("  3. ");

    // One line per provider call, in order, then the failure line.
    expect(s.out).toContain("  attempt 1 HEDGE · PROVIDER_ERROR · HEDGE_ABANDONED · 22.3 s");
    expect(s.out).toContain("  attempt 2 PRIMARY · SCHEMA_VALID · devshard 69430 · 47.4 s · 1,899 tokens");
    // The third call reports no total, so the two halves are added instead.
    expect(s.out).toContain("  attempt 3 PRIMARY · SCHEMA_VALID · devshard 69430 · 17.1 s · 2,078 tokens");
    expect(s.out).toContain("  attempt 4 PRIMARY · PROVIDER_ERROR · HTTP 524 · 125.0 s");
    expect(s.out).toContain(
      "  failed at 2026-09-02T03:43:35Z  failure record on Walrus  https://aggregator.walrus-testnet.walrus.space/v1/blobs/a9wOjCKZDkAgG8j_gtJxZcsfqupB_vp8QRUuOMOJX6I",
    );
    // The raw model text belongs to --full, never to the plain trail.
    expect(text).not.toContain("raw:");
  });

  it("--full adds each turn's raw action, every call's payload, the hash-matched prompt and the input hash", async () => {
    const s = setup(FINALIZED, withFailedSeat());
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: true })).toBe(0);
    const text = s.out.join("\n");

    // The failure record keeps no prompt text, so it comes from a revealed
    // seat of the same round whose bundle hashes to the same value.
    expect(s.out.filter((line) => line.startsWith("pinned prompt"))).toHaveLength(1);
    expect(s.out[3]).toBe("pinned prompt (hash 0x7257117d…)");
    expect(text).toContain("Research independently and weigh both sides.");
    expect(text).toContain(
      "       the system prompt above is a revealed seat's text for hash 0x7257117d5b4d02b8c8de5e70d62f6856143d7f20225084a111645f3557a40b14, proven identical by that hash",
    );
    expect(text).toContain(
      "       the failure record keeps only the input hash, 0xb835c2c2d8b0780ec781b841329ab00d3a538e8a4a9c039f92d141f0f8a55230, never the claim JSON",
    );
    expect(text).not.toContain("input:");

    // Each turn carries the raw action of the call that produced it.
    expect(text).toContain("       raw:");
    expect(text).toContain('           "query": "humans use only ten percent of their brains myth false",');
    expect(text).toContain('           "intent": "challenge"');
    // A failed call prints its error object under its attempt line.
    expect(text).toContain('         "httpStatus": 524');
    expect(text).toContain('         "message": "abandoned: the hedged request answered first"');
  });

  it("says the seat failed before any step when the record has none, and still logs the calls", async () => {
    const empty = clone(FAILED_PROOF) as { failure: { transcript: { steps: unknown[] } } };
    empty.failure.transcript.steps = [];
    const s = setup(FINALIZED, withFailedSeat(empty as unknown as Record<string, unknown>));
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    const header = s.out.find((line) => line.startsWith("juror 1"))!;
    expect(header).toContain(
      "round 1  the seat failed before taking any step (PROVIDER_ERROR, GonkaRouter provider request failed)",
    );
    expect(s.out).toContain("  attempt 4 PRIMARY · PROVIDER_ERROR · HTTP 524 · 125.0 s");
    expect(s.out.join("\n")).toContain("  failed at 2026-09-02T03:43:35Z  failure record on Walrus  ");
    expect(s.out.some((line) => line.startsWith("  1. "))).toBe(false);
  });

  it("--json carries the attempts, the failure record and each turn's raw text", async () => {
    const s = setup(FINALIZED, withFailedSeat(), { json: true });
    expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
    const document = JSON.parse(s.out.join("\n")) as {
      jurors: Array<{
        rounds: Array<{
          missing?: string;
          turns: Array<{ action: string; raw?: string }>;
          gateway?: { tokens?: number; attempts?: number };
          attempts?: Array<{ attempt: number; kind: string; status: string; requestId?: string; error?: { category: string; httpStatus?: number } }>;
          failure?: { status: string; message?: string; failedAtMs?: number; walrusBlobId?: string };
        }>;
      }>;
    };
    const round = document.jurors[0]!.rounds[0]!;
    expect(round.missing).toBeUndefined();
    expect(round.failure).toEqual({
      status: "PROVIDER_ERROR",
      message: "GonkaRouter provider request failed",
      failedAtMs: 1_788_320_615_910,
      walrusBlobId: "a9wOjCKZDkAgG8j_gtJxZcsfqupB_vp8QRUuOMOJX6I",
    });
    expect(round.attempts).toHaveLength(4);
    expect(round.attempts![1]).toMatchObject({ attempt: 2, kind: "PRIMARY", status: "SCHEMA_VALID", requestId: "devshard-69430-111", tokens: 1_899 });
    expect(round.attempts![3]!.error).toEqual({ category: "HTTP_ERROR", httpStatus: 524 });
    // The turns join the calls by id, so each one carries the model's own text.
    expect(round.turns.map((turn) => turn.action)).toEqual(["search", "open"]);
    expect(round.turns[0]!.raw).toContain('"action":"search"');
    expect(round.turns[1]!.raw).toContain('"action":"open"');
    expect(round.gateway).toMatchObject({ tokens: 3_977, attempts: 4 });
  });
});

describe("ov trace --from a saved audit", () => {
  it("prints the same trail from the file, without one request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-from-"));
    try {
      const proofs = proofsForRound(FINALIZED, 1, RESEARCH_PROOF);
      const audited = setup(FINALIZED, proofs);
      const file = join(directory, "audit.json");
      await auditCommand(audited.env, {
        target: FINALIZED.claimId,
        quiet: true,
        outPath: join(directory, "audit.md"),
        jsonPath: file,
      });

      const fetched = setup(FINALIZED, proofs);
      expect(await traceCommand(fetched.env, { target: FINALIZED.claimId, juror: 1, full: true })).toBe(0);

      const saved = setup(FINALIZED, {});
      expect(await traceCommand(saved.env, { from: file, juror: 1, full: true })).toBe(0);
      expect(saved.out).toEqual(fetched.out);
      expect(saved.net.calls).toEqual([]);

      // The claim id may still be typed, and then the file must hold it.
      const named = setup(FINALIZED, {});
      expect(await traceCommand(named.env, { from: file, target: FINALIZED.claimId, juror: 1, full: false })).toBe(0);
      expect(named.net.calls).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exits 2 on a claim the file does not hold, and on a file that is not an audit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-from-"));
    try {
      const audited = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
      const file = join(directory, "audit.json");
      await auditCommand(audited.env, {
        target: FINALIZED.claimId,
        quiet: true,
        outPath: join(directory, "audit.md"),
        jsonPath: file,
      });

      const s = setup(FINALIZED, {});
      const other = `0x${"ab".repeat(32)}`;
      const mismatch = await failure(traceCommand(s.env, { from: file, target: other, full: false }));
      expect(mismatch.exitCode).toBe(2);
      expect(mismatch.message).toBe(`the audit file holds claim ${FINALIZED.claimId}, not ${other}`);
      expect(s.net.calls).toEqual([]);

      const notAnAudit = join(directory, "board.json");
      writeFileSync(notAnAudit, JSON.stringify({ claims: [] }));
      const wrong = await failure(traceCommand(s.env, { from: notAnAudit, full: false }));
      expect(wrong.exitCode).toBe(2);
      expect(wrong.message).toBe(`${notAnAudit} is not an audit document; --from expects the file ov audit --json writes`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("ov trace --out a file", () => {
  it("writes the trail to the file, creating the folder, and prints one line", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-out-"));
    try {
      const proofs = proofsForRound(FINALIZED, 1, RESEARCH_PROOF);
      const printed = setup(FINALIZED, proofs);
      expect(await traceCommand(printed.env, { target: FINALIZED.claimId, juror: 1, full: true })).toBe(0);

      // A folder that does not exist yet, the way the audit writes its dossier.
      const file = join(directory, "trails", "juror-1.md");
      const written = setup(FINALIZED, proofs);
      expect(await traceCommand(written.env, { target: FINALIZED.claimId, juror: 1, full: true, outPath: file })).toBe(0);

      // The file holds exactly what stdout would have carried, and stdout only says so.
      expect(readFileSync(file, "utf8")).toBe(`${printed.out.join("\n")}\n`);
      expect(written.out).toEqual([`trace: written to ${file} (${printed.out.length} lines)`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes the JSON document when --json is on", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-out-"));
    try {
      const file = join(directory, "trail.json");
      const s = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF), { json: true });
      expect(await traceCommand(s.env, { target: FINALIZED.claimId, juror: 1, full: false, outPath: file })).toBe(0);
      const text = readFileSync(file, "utf8");
      const document = JSON.parse(text) as { claimId: string; jurors: Array<{ jurorIndex: number }> };
      expect(document.claimId).toBe(FINALIZED.claimId);
      expect(document.jurors.map((juror) => juror.jurorIndex)).toEqual([1]);
      // The count is the file's own, so the JSON block counts as its many lines.
      expect(s.out).toEqual([`trace: written to ${file} (${text.trimEnd().split("\n").length} lines)`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes the trail a saved audit holds, without one request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ov-trace-out-"));
    try {
      const audited = setup(FINALIZED, proofsForRound(FINALIZED, 1, RESEARCH_PROOF));
      const auditJson = join(directory, "audit.json");
      await auditCommand(audited.env, {
        target: FINALIZED.claimId,
        quiet: true,
        outPath: join(directory, "audit.md"),
        jsonPath: auditJson,
      });

      const printed = setup(FINALIZED, {});
      expect(await traceCommand(printed.env, { from: auditJson, juror: 1, full: true })).toBe(0);

      const file = join(directory, "trail.md");
      const saved = setup(FINALIZED, {});
      expect(await traceCommand(saved.env, { from: auditJson, juror: 1, full: true, outPath: file })).toBe(0);
      expect(readFileSync(file, "utf8")).toBe(`${printed.out.join("\n")}\n`);
      expect(saved.out).toEqual([`trace: written to ${file} (${printed.out.length} lines)`]);
      expect(saved.net.calls).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeVoteCommitment,
} from "@/lib/protocol/commitment";
import { computeTruthScoreBps, agentProbabilityBps } from "@/lib/protocol/truthScore";
import { toHex, fromHex } from "@/lib/protocol/hash";
import { OUTCOME, type VoteOutcome } from "@/lib/protocol/constants";
import type { VotePreimageV1 } from "@/lib/protocol/types";
import {
  ShieldTick,
  Award,
  Lock,
  TickCircle,
  CloseCircle,
  Add,
  Trash,
} from "iconsax-react";

export default function VerifyPage() {
  // --- Tab 1: Commitment Verification State ---
  const [claimId, setClaimId] = useState("0x0000000000000000000000000000000000000000000000000000000000000001");
  const [agentProfileId, setAgentProfileId] = useState("0x0000000000000000000000000000000000000000000000000000000000000002");
  const [jurySeatId, setJurySeatId] = useState("0x0000000000000000000000000000000000000000000000000000000000000003");
  const [phase, setPhase] = useState<1 | 2>(1);
  const [outcome, setOutcome] = useState<VoteOutcome>(OUTCOME.YES);
  const [confidenceBps, setConfidenceBps] = useState(8500);
  const [evidenceRootHex, setEvidenceRootHex] = useState("0x1111111111111111111111111111111111111111111111111111111111111111");
  const [outputHashHex, setOutputHashHex] = useState("0x2222222222222222222222222222222222222222222222222222222222222222");
  const [runHashHex, setRunHashHex] = useState("0x3333333333333333333333333333333333333333333333333333333333333333");
  const [saltHex, setSaltHex] = useState("0x4444444444444444444444444444444444444444444444444444444444444444");
  const [expectedCommitmentHex, setExpectedCommitmentHex] = useState("");

  const [computedCommitmentHex, setComputedCommitmentHex] = useState<string | null>(null);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);

  const handleComputeCommitment = () => {
    setCommitmentError(null);
    try {
      const preimage: VotePreimageV1 = {
        claim_id: claimId.trim(),
        agent_profile_id: agentProfileId.trim(),
        jury_seat_id: jurySeatId.trim(),
        phase,
        outcome,
        confidence_bps: Number(confidenceBps),
        evidence_root: fromHex(evidenceRootHex.trim()),
        output_hash: fromHex(outputHashHex.trim()),
        run_hash: fromHex(runHashHex.trim()),
        salt: fromHex(saltHex.trim()),
      };

      const commitmentBytes = computeVoteCommitment(preimage);
      const hex = toHex(commitmentBytes);
      setComputedCommitmentHex(hex);
    } catch (err) {
      setCommitmentError(err instanceof Error ? err.message : "Failed to compute commitment");
      setComputedCommitmentHex(null);
    }
  };

  // --- Tab 2: Truth Score Recomputation State ---
  interface JurorVoteInput {
    id: number;
    outcome: VoteOutcome;
    confidenceBps: number;
  }

  const [jurorVotes, setJurorVotes] = useState<JurorVoteInput[]>([
    { id: 1, outcome: OUTCOME.YES, confidenceBps: 9000 },
    { id: 2, outcome: OUTCOME.YES, confidenceBps: 8500 },
    { id: 3, outcome: OUTCOME.YES, confidenceBps: 9500 },
    { id: 4, outcome: OUTCOME.YES, confidenceBps: 8000 },
    { id: 5, outcome: OUTCOME.UNSURE, confidenceBps: 5000 },
  ]);

  const addVoteRow = () => {
    setJurorVotes([
      ...jurorVotes,
      { id: Date.now(), outcome: OUTCOME.YES, confidenceBps: 8000 },
    ]);
  };

  const removeVoteRow = (id: number) => {
    if (jurorVotes.length <= 1) return;
    setJurorVotes(jurorVotes.filter((v) => v.id !== id));
  };

  const updateVote = (id: number, field: "outcome" | "confidenceBps", value: number) => {
    setJurorVotes(
      jurorVotes.map((v) => {
        if (v.id !== id) return v;
        return { ...v, [field]: value };
      }),
    );
  };

  // Derived Truth Score calculations
  const computedTruthScoreBps = computeTruthScoreBps(
    jurorVotes.map((v) => ({ outcome: v.outcome, confidenceBps: v.confidenceBps })),
  );

  const totalProbabilities = jurorVotes.map((v) => {
    try {
      return agentProbabilityBps(v.outcome, v.confidenceBps);
    } catch {
      return 0;
    }
  });
  const sumProbabilities = totalProbabilities.reduce((a, b) => a + b, 0);
  const n = jurorVotes.length;

  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="space-y-2 border-b border-border/80 pb-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldTick size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Client-Side Independent Verifier
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Recompute cryptographic vote commitments (BCS + Blake2b-256) and consensus Truth Scores entirely within your local browser. Zero server trust required.
        </p>
      </div>

      <Tabs defaultValue="commitment" className="space-y-6">
        <TabsList className="grid grid-cols-2 max-w-md">
          <TabsTrigger value="commitment" className="text-xs font-semibold">
            <Lock size="14" variant="Bold" className="mr-1.5" />
            Vote Commitment
          </TabsTrigger>
          <TabsTrigger value="truthscore" className="text-xs font-semibold">
            <Award size="14" variant="Bold" className="mr-1.5" />
            Truth Score
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Commitment Recomputation */}
        <TabsContent value="commitment" className="space-y-6">
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Preimage Field Inputs (Move VotePreimageV1)
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClaimId("0x0000000000000000000000000000000000000000000000000000000000000001");
                  setAgentProfileId("0x0000000000000000000000000000000000000000000000000000000000000002");
                  setJurySeatId("0x0000000000000000000000000000000000000000000000000000000000000003");
                  setPhase(1);
                  setOutcome(OUTCOME.YES);
                  setConfidenceBps(8500);
                  setEvidenceRootHex("0x1111111111111111111111111111111111111111111111111111111111111111");
                  setOutputHashHex("0x2222222222222222222222222222222222222222222222222222222222222222");
                  setRunHashHex("0x3333333333333333333333333333333333333333333333333333333333333333");
                  setSaltHex("0x4444444444444444444444444444444444444444444444444444444444444444");
                }}
                className="h-7 text-xs text-primary font-semibold"
              >
                Reset to Sample
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-foreground">Claim ID (Hex Address):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={claimId}
                  onChange={(e) => setClaimId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Agent Profile ID (Hex Address):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={agentProfileId}
                  onChange={(e) => setAgentProfileId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Jury Seat ID (Hex Address):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={jurySeatId}
                  onChange={(e) => setJurySeatId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Phase:</label>
                <select
                  value={phase}
                  onChange={(e) => setPhase(Number(e.target.value) as 1 | 2)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs font-semibold"
                >
                  <option value={1}>Phase 1 (Initial Deliberation)</option>
                  <option value={2}>Phase 2 (Discussion / Debate)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Outcome:</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(Number(e.target.value) as VoteOutcome)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs font-semibold"
                >
                  <option value={OUTCOME.YES}>YES (1)</option>
                  <option value={OUTCOME.NO}>NO (2)</option>
                  <option value={OUTCOME.UNSURE}>UNSURE (3)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Confidence (0..10000 Bps):</label>
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  className="font-mono text-xs h-9"
                  value={confidenceBps}
                  onChange={(e) => setConfidenceBps(Number(e.target.value))}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Salt (32-byte Hex):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={saltHex}
                  onChange={(e) => setSaltHex(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-foreground">Evidence Root (32-byte Hex):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={evidenceRootHex}
                  onChange={(e) => setEvidenceRootHex(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-foreground">Output Hash (32-byte Hex):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={outputHashHex}
                  onChange={(e) => setOutputHashHex(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-foreground">Run Hash (32-byte Hex):</label>
                <Input
                  className="font-mono text-xs h-9"
                  value={runHashHex}
                  onChange={(e) => setRunHashHex(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-foreground">
                  Expected On-Chain Commitment (Optional, for auto-compare):
                </label>
                <Input
                  placeholder="Paste on-chain commitment hex to compare..."
                  className="font-mono text-xs h-9"
                  value={expectedCommitmentHex}
                  onChange={(e) => setExpectedCommitmentHex(e.target.value)}
                />
              </div>
            </div>

            <Button
              onClick={handleComputeCommitment}
              className="w-full min-h-[44px] font-semibold text-xs shadow-xs"
            >
              <Lock size="16" variant="Bold" className="mr-2" />
              Recompute Blake2b-256 Commitment
            </Button>

            {commitmentError && (
              <div className="p-3 bg-destructive/10 text-destructive text-xs rounded-lg border border-destructive/30">
                {commitmentError}
              </div>
            )}

            {computedCommitmentHex && (
              <div className="p-4 rounded-xl bg-muted/60 border border-border/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Computed Commitment:
                  </span>

                  {expectedCommitmentHex.trim() && (
                    <Badge
                      variant="outline"
                      className={`text-xs font-semibold px-2.5 py-0.5 flex items-center gap-1 ${
                        computedCommitmentHex.toLowerCase() ===
                        expectedCommitmentHex.trim().toLowerCase()
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                      }`}
                    >
                      {computedCommitmentHex.toLowerCase() ===
                      expectedCommitmentHex.trim().toLowerCase() ? (
                        <>
                          <TickCircle size="13" variant="Bold" />
                          Exact Byte Match
                        </>
                      ) : (
                        <>
                          <CloseCircle size="13" variant="Bold" />
                          Commitment Mismatch
                        </>
                      )}
                    </Badge>
                  )}
                </div>

                <div className="font-mono text-xs font-bold text-foreground break-all bg-background p-3 rounded-lg border border-border/60">
                  {computedCommitmentHex}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab 2: Truth Score Recomputation */}
        <TabsContent value="truthscore" className="space-y-6">
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Terminal Valid Round Votes ({jurorVotes.length} Jurors)
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addVoteRow}
                className="h-8 text-xs font-semibold"
              >
                <Add size="14" variant="Bold" className="mr-1" />
                Add Juror Vote
              </Button>
            </div>

            {/* Juror Votes List */}
            <div className="space-y-2.5">
              {jurorVotes.map((v, idx) => {
                const prob = agentProbabilityBps(v.outcome, v.confidenceBps);
                return (
                  <div
                    key={v.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-border/60 bg-muted/30 text-xs"
                  >
                    <div className="flex items-center gap-2 font-mono font-bold">
                      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">
                        #{idx + 1}
                      </span>
                      <span>Juror #{idx + 1}</span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                      <div className="flex items-center gap-1.5">
                        <label className="text-muted-foreground text-[11px]">Outcome:</label>
                        <select
                          value={v.outcome}
                          onChange={(e) =>
                            updateVote(v.id, "outcome", Number(e.target.value) as VoteOutcome)
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs font-semibold"
                        >
                          <option value={OUTCOME.YES}>YES</option>
                          <option value={OUTCOME.NO}>NO</option>
                          <option value={OUTCOME.UNSURE}>UNSURE</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <label className="text-muted-foreground text-[11px]">Confidence:</label>
                        <Input
                          type="number"
                          min={0}
                          max={10000}
                          className="w-20 h-8 text-xs font-mono"
                          value={v.confidenceBps}
                          onChange={(e) => updateVote(v.id, "confidenceBps", Number(e.target.value))}
                        />
                        <span className="text-[11px] text-muted-foreground font-mono">bps</span>
                      </div>

                      <div className="text-[11px] font-mono text-muted-foreground hidden md:inline">
                        Mapped Prob: <span className="font-semibold text-foreground">{prob} bps</span>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVoteRow(v.id)}
                        disabled={jurorVotes.length <= 1}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash size="15" variant="Bold" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Calculated Result Card */}
            <div className="p-5 rounded-xl bg-card border-2 border-primary/30 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Award size="16" variant="Bold" className="text-primary" />
                  Recomputed Truth Score
                </span>
                <span className="text-2xl font-extrabold font-mono text-primary">
                  {computedTruthScoreBps !== null
                    ? `${Math.round(computedTruthScoreBps / 100)} / 100`
                    : "N/A"}
                </span>
              </div>

              {/* Math breakdown */}
              <div className="bg-muted/60 p-3 rounded-lg font-mono text-xs space-y-1 text-muted-foreground">
                <div>• Sum of agent probabilities: {sumProbabilities} bps</div>
                <div>• Total valid jurors (N): {n}</div>
                <div>• Formula: ({sumProbabilities} + ⌊{n}/2⌋) / {n}</div>
                <div className="font-bold text-foreground pt-1 border-t border-border/50">
                  • Computed Score Bps: {computedTruthScoreBps} bps (
                  {computedTruthScoreBps !== null ? (computedTruthScoreBps / 100).toFixed(2) : 0}%)
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

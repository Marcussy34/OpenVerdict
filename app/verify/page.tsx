"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { cn } from "@/lib/utils";
import { computeVoteCommitment } from "@/lib/protocol/commitment";
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
  Code1,
  Warning2,
} from "@/components/icons";

const SAMPLE = {
  claimId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  agentProfileId: "0x0000000000000000000000000000000000000000000000000000000000000002",
  jurySeatId: "0x0000000000000000000000000000000000000000000000000000000000000003",
  evidenceRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
  outputHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
  runHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
  salt: "0x4444444444444444444444444444444444444444444444444444444444444444",
};

/** Labelled hex/text field used across both verifier tabs. */
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function VerifyPage() {
  // --- Tab 1: commitment recomputation -----------------------------------
  const [claimId, setClaimId] = useState(SAMPLE.claimId);
  const [agentProfileId, setAgentProfileId] = useState(SAMPLE.agentProfileId);
  const [jurySeatId, setJurySeatId] = useState(SAMPLE.jurySeatId);
  const [phase, setPhase] = useState<1 | 2>(1);
  const [outcome, setOutcome] = useState<VoteOutcome>(OUTCOME.YES);
  const [confidenceBps, setConfidenceBps] = useState(8500);
  const [evidenceRootHex, setEvidenceRootHex] = useState(SAMPLE.evidenceRoot);
  const [outputHashHex, setOutputHashHex] = useState(SAMPLE.outputHash);
  const [runHashHex, setRunHashHex] = useState(SAMPLE.runHash);
  const [saltHex, setSaltHex] = useState(SAMPLE.salt);
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
      setComputedCommitmentHex(toHex(computeVoteCommitment(preimage)));
    } catch (err) {
      setCommitmentError(err instanceof Error ? err.message : "Failed to compute commitment");
      setComputedCommitmentHex(null);
    }
  };

  const resetSample = () => {
    setClaimId(SAMPLE.claimId);
    setAgentProfileId(SAMPLE.agentProfileId);
    setJurySeatId(SAMPLE.jurySeatId);
    setPhase(1);
    setOutcome(OUTCOME.YES);
    setConfidenceBps(8500);
    setEvidenceRootHex(SAMPLE.evidenceRoot);
    setOutputHashHex(SAMPLE.outputHash);
    setRunHashHex(SAMPLE.runHash);
    setSaltHex(SAMPLE.salt);
  };

  const commitmentMatch =
    computedCommitmentHex && expectedCommitmentHex.trim()
      ? computedCommitmentHex.toLowerCase() === expectedCommitmentHex.trim().toLowerCase()
      : null;

  // --- Tab 2: truth score recomputation ----------------------------------
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

  const addVoteRow = () =>
    setJurorVotes([...jurorVotes, { id: Date.now(), outcome: OUTCOME.YES, confidenceBps: 8000 }]);

  const removeVoteRow = (id: number) => {
    if (jurorVotes.length <= 1) return;
    setJurorVotes(jurorVotes.filter((v) => v.id !== id));
  };

  const updateVote = (id: number, field: "outcome" | "confidenceBps", value: number) =>
    setJurorVotes(jurorVotes.map((v) => (v.id === id ? { ...v, [field]: value } : v)));

  const computedTruthScoreBps = useMemo(
    () =>
      computeTruthScoreBps(
        jurorVotes.map((v) => ({ outcome: v.outcome, confidenceBps: v.confidenceBps })),
      ),
    [jurorVotes],
  );

  const probabilities = jurorVotes.map((v) => {
    try {
      return agentProbabilityBps(v.outcome, v.confidenceBps);
    } catch {
      return 0;
    }
  });
  const sumProbabilities = probabilities.reduce((a, b) => a + b, 0);
  const n = jurorVotes.length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Zero server trust"
        title="Independent verifier"
        description="Recompute cryptographic vote commitments (BCS + Blake2b-256) and consensus Truth Scores entirely inside your own browser. Nothing here calls the engine."
        icon={ShieldTick}
        badges={<ExperimentalTag />}
        actions={<MetaTag tone="chain">Runs client-side</MetaTag>}
      />

      <Tabs defaultValue="commitment" className="space-y-5">
        <TabsList className="grid max-w-md grid-cols-2">
          <TabsTrigger value="commitment" className="gap-1.5 text-xs font-semibold">
            <Lock size="14" variant="Bold" />
            Vote commitment
          </TabsTrigger>
          <TabsTrigger value="truthscore" className="gap-1.5 text-xs font-semibold">
            <Award size="14" variant="Bold" />
            Truth Score
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ Commitment tab */}
        <TabsContent value="commitment" className="space-y-5">
          <Panel
            label="Preimage fields (Move VotePreimageV1)"
            icon={Code1}
            tone="sealed"
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetSample}
                className="h-7 text-xs font-semibold text-primary"
              >
                Reset to sample
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Claim id" className="sm:col-span-2">
                <Input
                  className="h-9 font-mono text-xs"
                  value={claimId}
                  onChange={(e) => setClaimId(e.target.value)}
                />
              </Field>

              <Field label="Agent profile id">
                <Input
                  className="h-9 font-mono text-xs"
                  value={agentProfileId}
                  onChange={(e) => setAgentProfileId(e.target.value)}
                />
              </Field>

              <Field label="Jury seat id">
                <Input
                  className="h-9 font-mono text-xs"
                  value={jurySeatId}
                  onChange={(e) => setJurySeatId(e.target.value)}
                />
              </Field>

              <Field label="Phase">
                <select
                  value={phase}
                  onChange={(e) => setPhase(Number(e.target.value) as 1 | 2)}
                  className="h-9 w-full rounded-lg border border-input bg-card px-3 text-xs font-semibold text-ocean outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Phase"
                >
                  <option value={1}>Phase 1 — initial deliberation</option>
                  <option value={2}>Phase 2 — discussion round</option>
                </select>
              </Field>

              <Field label="Outcome">
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(Number(e.target.value) as VoteOutcome)}
                  className="h-9 w-full rounded-lg border border-input bg-card px-3 text-xs font-semibold text-ocean outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Outcome"
                >
                  <option value={OUTCOME.YES}>YES (1)</option>
                  <option value={OUTCOME.NO}>NO (2)</option>
                  <option value={OUTCOME.UNSURE}>UNSURE (3)</option>
                </select>
              </Field>

              <Field label="Confidence (0…10000 bps)">
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  className="h-9 font-mono text-xs"
                  value={confidenceBps}
                  onChange={(e) => setConfidenceBps(Number(e.target.value))}
                />
              </Field>

              <Field label="Salt (32-byte hex)">
                <Input
                  className="h-9 font-mono text-xs"
                  value={saltHex}
                  onChange={(e) => setSaltHex(e.target.value)}
                />
              </Field>

              <Field label="Evidence root (32-byte hex)" className="sm:col-span-2">
                <Input
                  className="h-9 font-mono text-xs"
                  value={evidenceRootHex}
                  onChange={(e) => setEvidenceRootHex(e.target.value)}
                />
              </Field>

              <Field label="Output hash (32-byte hex)" className="sm:col-span-2">
                <Input
                  className="h-9 font-mono text-xs"
                  value={outputHashHex}
                  onChange={(e) => setOutputHashHex(e.target.value)}
                />
              </Field>

              <Field label="Run hash (32-byte hex)" className="sm:col-span-2">
                <Input
                  className="h-9 font-mono text-xs"
                  value={runHashHex}
                  onChange={(e) => setRunHashHex(e.target.value)}
                />
              </Field>

              <Field
                label="Expected on-chain commitment (optional)"
                hint="Paste the commitment stored on Sui to compare byte-for-byte."
                className="sm:col-span-2"
              >
                <Input
                  placeholder="0x…"
                  className="h-9 font-mono text-xs"
                  value={expectedCommitmentHex}
                  onChange={(e) => setExpectedCommitmentHex(e.target.value)}
                />
              </Field>
            </div>

            <Button
              onClick={handleComputeCommitment}
              className="mt-5 min-h-[44px] w-full font-semibold shadow-xs"
            >
              <Lock size="16" variant="Bold" />
              Recompute Blake2b-256 commitment
            </Button>

            {commitmentError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
                {commitmentError}
              </div>
            )}

            {computedCommitmentHex && (
              <div className="mt-4 space-y-2.5 rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel>Computed commitment</FieldLabel>
                  {commitmentMatch !== null && (
                    <span
                      className={cn(
                        "ov-micro ov-micro-sm inline-flex items-center gap-1.5 border px-2.5 py-0.5",
                        commitmentMatch
                          ? "border-yes/30 bg-yes/8 text-yes"
                          : "border-no/30 bg-no/8 text-no",
                      )}
                    >
                      {commitmentMatch ? (
                        <>
                          <TickCircle size="12" variant="Bold" />
                          Exact byte match
                        </>
                      ) : (
                        <>
                          <CloseCircle size="12" variant="Bold" />
                          Commitment mismatch
                        </>
                      )}
                    </span>
                  )}
                </div>
                <p className="rounded-lg border border-border bg-card p-3 font-mono text-xs font-semibold break-all text-ocean">
                  {computedCommitmentHex}
                </p>
              </div>
            )}
          </Panel>

          <Well className="text-[11px] leading-relaxed text-muted-foreground">
            The TypeScript <code className="font-mono text-ocean">computeVoteCommitment</code>{" "}
            and the Move <code className="font-mono text-ocean">jury::compute_commitment</code>{" "}
            are byte-identical by construction, and parity vectors in the test suite enforce it.
            Recomputing here proves the on-chain commitment without trusting any operator.
          </Well>
        </TabsContent>

        {/* ------------------------------------------------ Truth Score tab */}
        <TabsContent value="truthscore" className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel
              label={`Terminal round votes (${jurorVotes.length})`}
              icon={Award}
              tone="primary"
              className="lg:col-span-2"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addVoteRow}
                  className="min-h-[32px] text-xs font-semibold"
                >
                  <Add size="13" variant="Bold" />
                  Add juror
                </Button>
              }
            >
              <ul className="space-y-2">
                {jurorVotes.map((v, idx) => {
                  const prob = probabilities[idx];
                  return (
                    <li
                      key={v.id}
                      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span className="ov-micro ov-micro-sm grid size-7 place-items-center rounded-lg bg-sea/12 text-primary">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-ocean">Juror {idx + 1}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                        <select
                          value={v.outcome}
                          onChange={(e) =>
                            updateVote(v.id, "outcome", Number(e.target.value) as VoteOutcome)
                          }
                          className="h-8 rounded-lg border border-input bg-card px-2 text-xs font-semibold text-ocean outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          aria-label={`Juror ${idx + 1} outcome`}
                        >
                          <option value={OUTCOME.YES}>YES</option>
                          <option value={OUTCOME.NO}>NO</option>
                          <option value={OUTCOME.UNSURE}>UNSURE</option>
                        </select>

                        <Input
                          type="number"
                          min={0}
                          max={10000}
                          className="h-8 w-24 font-mono text-xs"
                          value={v.confidenceBps}
                          onChange={(e) =>
                            updateVote(v.id, "confidenceBps", Number(e.target.value))
                          }
                          aria-label={`Juror ${idx + 1} confidence in basis points`}
                        />

                        <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
                          → <span className="font-semibold text-ocean">{prob} bps</span>
                        </span>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeVoteRow(v.id)}
                          disabled={jurorVotes.length <= 1}
                          className="size-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove juror ${idx + 1}`}
                        >
                          <Trash size="15" variant="Bold" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <Well className="mt-4 space-y-1 font-mono text-[11px] text-muted-foreground">
                <div>• Σ agent probabilities: {sumProbabilities} bps</div>
                <div>• Valid jurors (N): {n}</div>
                <div>
                  • Formula: ({sumProbabilities} + ⌊{n}/2⌋) / {n}
                </div>
                <div className="border-t border-border pt-1 font-bold text-ocean">
                  • truthScoreBps = {computedTruthScoreBps} (
                  {computedTruthScoreBps !== null
                    ? (computedTruthScoreBps / 100).toFixed(2)
                    : "0"}
                  %)
                </div>
              </Well>
            </Panel>

            <Panel label="Recomputed score" icon={Award} tone="yes">
              <div className="flex flex-col items-center gap-3">
                <VerdictGauge scoreBps={computedTruthScoreBps} size={196} />
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  Every value is derived locally from the votes above using the same integer
                  half-up arithmetic the Move settlement module runs on-chain.
                </p>
              </div>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

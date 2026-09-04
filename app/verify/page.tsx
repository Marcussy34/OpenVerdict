"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RunProofDetails } from "@/components/claim/run-proof";
import { AgentHandoff } from "@/components/verify/agent-handoff";
import { MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { cn } from "@/lib/utils";
import { computeVoteCommitment } from "@/lib/protocol/commitment";
import { computeTruthScoreBps, agentProbabilityBps } from "@/lib/protocol/truthScore";
import { toHex, fromHex } from "@/lib/protocol/hash";
import { OUTCOME, type VoteOutcome } from "@/lib/protocol/constants";
import type { VotePreimageV1 } from "@/lib/protocol/types";
import { claimHref, parseClaimLink } from "@/lib/verify/claim-link";
import {
  readClaimRecord,
  shortModel,
  type ClaimRecord,
  type SeatFill,
} from "@/lib/verify/report-prefill";
import { suiTransactionUrl } from "@/lib/web/explorer";
import {
  isTransparentBundle,
  proofFromTransparentBundle,
  type TransparentRunProof,
} from "@/components/claim/run-proof-types";
import {
  ShieldTick,
  Award,
  Lock,
  TickCircle,
  CloseCircle,
  Add,
  Trash,
  Code1,
  Judge,
  MessageProgramming,
  Refresh,
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

/** The public console, for a bare id pasted before the browser reports its origin. */
const FALLBACK_ORIGIN = "https://app.openverdict.info";

/** The origin never changes while the page is open, so nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};
const readOrigin = () => window.location.origin;
const readFallbackOrigin = () => FALLBACK_ORIGIN;

/** The claim page's segment skin, so both switches read as one control. */
const SEGMENT_SKIN =
  "text-muted-foreground hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-white";

type Path = "agent" | "manual";

const OUTCOME_NAME: Record<number, string> = {
  [OUTCOME.YES]: "YES",
  [OUTCOME.NO]: "NO",
  [OUTCOME.UNSURE]: "UNSURE",
};

/** Protocol outcomes are the one place this page spends a colour. */
function outcomeTone(label: string): string {
  if (label === "YES") return "text-yes";
  if (label === "NO") return "text-no";
  if (label === "UNSURE" || label === "UNRESOLVED") return "text-unsure";
  return "text-muted-foreground";
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRunProofJson(value: string): TransparentRunProof {
  const parsed = JSON.parse(value) as unknown;
  if (isTransparentBundle(parsed)) return proofFromTransparentBundle(parsed);
  if (
    isRecord(parsed) &&
    typeof parsed.runId === "string" &&
    isTransparentBundle(parsed.bundle)
  ) {
    return parsed as unknown as TransparentRunProof;
  }
  throw new Error("Paste a public run bundle or a run proof JSON object");
}

/** Labelled hex/text field used across both verifier tabs. */
function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  /** Id of the control below, so the caption is a real <label> for it. */
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor}>
          <FieldLabel>{label}</FieldLabel>
        </label>
      ) : (
        <FieldLabel>{label}</FieldLabel>
      )}
      {children}
      {hint && <p className="text-[11px] leading-[1.5] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function VerifyPage() {
  // --- The front door: one claim link, two ways to audit it ---------------
  const [linkInput, setLinkInput] = useState("");
  const [path, setPath] = useState<Path>("agent");
  // The browser's own origin, so a bare id links to the deployment being read.
  // Read as an external value: the server renders the public console instead.
  const origin = useSyncExternalStore(NEVER_CHANGES, readOrigin, readFallbackOrigin);

  const parsedLink = useMemo(() => parseClaimLink(linkInput), [linkInput]);
  const link = parsedLink.ok ? parsedLink.link : null;
  const href = link ? claimHref(link, origin) : null;
  const linkOrigin = link?.origin ?? origin;

  const [record, setRecord] = useState<ClaimRecord | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);

  /** Editing the field drops a record that is no longer the one on screen. */
  const handleLinkChange = (value: string) => {
    setLinkInput(value);
    const next = parseClaimLink(value);
    const nextClaimId = next.ok ? next.link.claimId : null;
    if (nextClaimId !== record?.claimId) {
      setRecord(null);
      setRecordError(null);
      setSelectedSeatId(null);
      setLoadingRecord(nextClaimId !== null);
    }
  };

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
    if (saltHex.trim().length === 0) {
      // The one preimage field the public record never publishes.
      setCommitmentError(
        "Add the salt. It is the only preimage field the public record does not publish.",
      );
      setComputedCommitmentHex(null);
      return;
    }
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
    setSelectedSeatId(null);
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

  // The certificate's own score, when a claim link brought one in.
  const certificateScore = record?.truthScore ?? null;
  const scoreMatchesCertificate =
    certificateScore !== null && computedTruthScoreBps !== null
      ? Math.abs(computedTruthScoreBps / 100 - certificateScore) < 0.005
      : null;

  const [proofClaimId, setProofClaimId] = useState("");
  const [proofRunId, setProofRunId] = useState("");
  const [bundleJson, setBundleJson] = useState("");
  const [runProof, setRunProof] = useState<TransparentRunProof | null>(null);
  const [runProofError, setRunProofError] = useState<string | null>(null);
  const [fetchingRunProof, setFetchingRunProof] = useState(false);

  const fetchRunProof = async () => {
    const nextClaimId = proofClaimId.trim();
    const nextRunId = proofRunId.trim();
    if (!nextClaimId || !nextRunId) {
      setRunProofError("Enter both the claim id and run id");
      return;
    }

    setFetchingRunProof(true);
    setRunProofError(null);
    try {
      const response = await fetch(
        `/api/claims/${encodeURIComponent(nextClaimId)}/runs/${encodeURIComponent(nextRunId)}/proof`,
        { cache: "no-store" },
      );
      if (response.status === 404) throw new Error("Run proof not found");
      if (response.status === 503) throw new Error("The verification engine is not available");
      if (!response.ok) throw new Error("The run proof could not be loaded");
      setRunProof((await response.json()) as TransparentRunProof);
    } catch (error) {
      setRunProof(null);
      setRunProofError(error instanceof Error ? error.message : "The run proof could not be loaded");
    } finally {
      setFetchingRunProof(false);
    }
  };

  const loadBundleJson = () => {
    setRunProofError(null);
    try {
      setRunProof(parseRunProofJson(bundleJson));
    } catch (error) {
      setRunProof(null);
      setRunProofError(error instanceof Error ? error.message : "The bundle JSON is invalid");
    }
  };

  // --- Filling the three tabs from the public record ----------------------

  /** One seat of the deciding round fills all three tabs; only the salt is left. */
  const applySeat = useCallback((seat: SeatFill, from: ClaimRecord) => {
    setSelectedSeatId(seat.jurySeatId);
    setClaimId(from.claimId);
    setAgentProfileId(seat.agentProfileId);
    setJurySeatId(seat.jurySeatId);
    setPhase(seat.phase);
    setOutcome(seat.outcome);
    setConfidenceBps(seat.confidenceBps);
    setEvidenceRootHex(seat.evidenceRoot);
    setOutputHashHex(seat.outputHash);
    setRunHashHex(seat.runHash);
    setExpectedCommitmentHex(seat.commitment);
    setSaltHex("");
    setComputedCommitmentHex(null);
    setCommitmentError(null);
    setJurorVotes(
      from.seats.map((entry, index) => ({
        id: index + 1,
        outcome: entry.outcome,
        confidenceBps: entry.confidenceBps,
      })),
    );
    setProofClaimId(from.claimId);
    setProofRunId(seat.runId);
    setRunProof(null);
    setRunProofError(null);
  }, []);

  const loadRecord = useCallback(
    async (id: string, runId: string | undefined, signal: AbortSignal) => {
      setLoadingRecord(true);
      setRecordError(null);
      try {
        const response = await fetch(`/api/claims/${encodeURIComponent(id)}/report`, {
          cache: "no-store",
          signal,
        });
        if (response.status === 404) {
          // A board id is often pasted short; the CLI resolves a prefix, this page does not.
          throw new Error(
            id.length < 66
              ? "Ids are 66 characters: paste the whole id, or the claim link."
              : "No claim with that id on this deployment.",
          );
        }
        if (!response.ok) throw new Error("The public report could not be loaded.");
        const next = readClaimRecord(await response.json());
        if (next === null) throw new Error("The public report could not be read.");
        setRecord(next);
        // A /runs/<id> link points at one seat; otherwise start at the first.
        const seat = next.seats.find((entry) => entry.runId === runId) ?? next.seats[0];
        if (seat) applySeat(seat, next);
      } catch (error) {
        if (signal.aborted) return;
        setRecord(null);
        setSelectedSeatId(null);
        setRecordError(
          error instanceof Error ? error.message : "The public report could not be loaded.",
        );
      } finally {
        if (!signal.aborted) setLoadingRecord(false);
      }
    },
    [applySeat],
  );

  const linkClaimId = link?.claimId ?? null;
  const linkRunId = link?.runId;

  useEffect(() => {
    if (linkClaimId === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadRecord(linkClaimId, linkRunId, controller.signal);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [linkClaimId, linkRunId, loadRecord]);

  const selectedSeat = record?.seats.find((seat) => seat.jurySeatId === selectedSeatId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: the console's centred title block, so Audit reads as a sibling
          of Verify, Claims and Agents. No icon tile and no eyebrow: those
          pages carry neither. */}
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <h1 className="ov-display text-5xl text-ocean md:text-6xl">Audit a verdict</h1>
        <p className="text-base text-muted-foreground">
          Recompute what Sui holds, in your browser or with your agent.
        </p>
      </div>

      {/* ---------------------------------------------- The one input ---- */}
      <div className="space-y-3">
        {/* Two paths, one switch: the claim page's segmented control, centred
            on the page at every width (owner). */}
        <div className="mx-auto flex w-fit items-center gap-1 border border-border bg-card p-1 text-foreground">
          <ToggleGroup
            type="single"
            value={path}
            onValueChange={(next) => {
              if (next === "agent" || next === "manual") setPath(next);
            }}
            aria-label="How to audit"
          >
            <ToggleGroupItem value="agent" className={SEGMENT_SKIN}>
              <MessageProgramming size="13" variant="Bold" />
              With an agent
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className={SEGMENT_SKIN}>
              <Code1 size="13" variant="Bold" />
              By hand
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {/* The link field belongs to the by-hand path only: the agent prompt
            carries a placeholder the reader replaces (owner). */}
        {path === "manual" && (
          <>
        <div className="space-y-1.5">
          <label htmlFor="claim-link" className="ov-micro ov-micro-sm block text-muted-foreground">
            Paste a claim link or id
          </label>
          <div className="relative">
            <Input
              id="claim-link"
              value={linkInput}
              onChange={(event) => handleLinkChange(event.target.value)}
              placeholder="https://app.openverdict.info/claims/0x…"
              className="h-11 pr-11 font-mono text-[13px]"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
            {loadingRecord && (
              <Refresh
                size="16"
                variant="Bold"
                aria-hidden
                className="absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
              />
            )}
          </div>
        </div>

        {/* One line, always: what to paste, why it did not parse, or what loaded. */}
        <p className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          {linkInput.trim().length === 0 ? (
            <>A claim page, its report or one run, or a bare 0x id.</>
          ) : !parsedLink.ok ? (
            <>
              <Warning2 size="14" variant="Bold" aria-hidden className="shrink-0" />
              {parsedLink.reason}
            </>
          ) : recordError ? (
            <>
              <Warning2 size="14" variant="Bold" aria-hidden className="shrink-0" />
              {recordError}
            </>
          ) : record ? (
            <>
              <span className="min-w-0 truncate text-foreground">{record.statement}</span>
              <span className={cn("shrink-0 font-semibold", outcomeTone(record.label))}>
                {record.label}
                {record.truthScore !== null && ` ${record.truthScore.toFixed(2)}`}
              </span>
            </>
          ) : (
            <>Reading the public record…</>
          )}
        </p>
          </>
        )}
      </div>

      {path === "agent" ? (
        <AgentHandoff href={href} origin={linkOrigin} />
      ) : (
        <div className="space-y-5">
          {/* -------------------------------------- Fill from the record -- */}
          <Panel
            label="Fill from the record"
            icon={Judge}
            tone="primary"
            action={
              selectedSeat && (
                <MetaTag tone="chain">Round {selectedSeat.phase}</MetaTag>
              )
            }
          >
            {link === null ? (
              <p className="text-[13px] text-muted-foreground">
                Paste a claim link above and every field below fills from the public report. The
                fields are a sample until then.
              </p>
            ) : loadingRecord ? (
              <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-[58px] border border-border bg-surface" />
                ))}
              </div>
            ) : recordError ? (
              <p className="text-[13px] text-muted-foreground">
                {recordError} The fields below are unchanged.
              </p>
            ) : record && record.seats.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No votes have been revealed on this claim yet, so there is nothing to fill.
              </p>
            ) : (
              <>
                <p className="mb-3 text-[13px] text-muted-foreground">
                  The deciding round, one seat per revealed vote. Pick one to fill all three tabs.
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {record?.seats.map((seat) => {
                    const selected = seat.jurySeatId === selectedSeatId;
                    const label = OUTCOME_NAME[seat.outcome] ?? "";
                    return (
                      <li key={seat.jurySeatId}>
                        <button
                          type="button"
                          onClick={() => applySeat(seat, record)}
                          aria-pressed={selected}
                          className={cn(
                            "flex min-h-[58px] w-full items-center justify-between gap-3 border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            selected
                              ? "border-primary bg-primary/6"
                              : "border-border bg-card hover:border-primary/45",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-foreground">
                              {shortModel(seat.modelId)}
                            </span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {shortId(seat.jurySeatId)}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-right text-[13px] font-semibold tabular-nums",
                              outcomeTone(label),
                            )}
                          >
                            {label}
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              {(seat.confidenceBps / 100).toFixed(2)}%
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Tabs defaultValue="commitment" className="space-y-5">
            <TabsList className="grid max-w-2xl grid-cols-3">
              <TabsTrigger value="commitment" className="gap-1.5 text-xs font-semibold">
                <Lock size="14" variant="Bold" />
                Vote commitment
              </TabsTrigger>
              <TabsTrigger value="truthscore" className="gap-1.5 text-xs font-semibold">
                <Award size="14" variant="Bold" />
                Truth Score
              </TabsTrigger>
              <TabsTrigger value="runproof" className="gap-1.5 text-xs font-semibold">
                <ShieldTick size="14" variant="Bold" />
                Run proof
              </TabsTrigger>
            </TabsList>

            {/* ------------------------------------------ Commitment tab */}
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
                  <Field label="Claim id" htmlFor="pre-claim-id" className="sm:col-span-2">
                    <Input
                      id="pre-claim-id"
                      className="h-9 font-mono text-xs"
                      value={claimId}
                      onChange={(e) => setClaimId(e.target.value)}
                    />
                  </Field>

                  <Field label="Agent profile id" htmlFor="pre-agent-profile-id">
                    <Input
                      id="pre-agent-profile-id"
                      className="h-9 font-mono text-xs"
                      value={agentProfileId}
                      onChange={(e) => setAgentProfileId(e.target.value)}
                    />
                  </Field>

                  <Field label="Jury seat id" htmlFor="pre-jury-seat-id">
                    <Input
                      id="pre-jury-seat-id"
                      className="h-9 font-mono text-xs"
                      value={jurySeatId}
                      onChange={(e) => setJurySeatId(e.target.value)}
                    />
                  </Field>

                  <Field label="Phase" htmlFor="pre-phase">
                    <select
                      id="pre-phase"
                      value={phase}
                      onChange={(e) => setPhase(Number(e.target.value) as 1 | 2)}
                      className="h-9 w-full rounded-lg border border-input bg-card px-3 text-xs font-semibold text-ocean outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label="Phase"
                    >
                      <option value={1}>Phase 1: initial deliberation</option>
                      <option value={2}>Phase 2: discussion round</option>
                    </select>
                  </Field>

                  <Field label="Outcome" htmlFor="pre-outcome">
                    <select
                      id="pre-outcome"
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

                  <Field label="Confidence (0…10000 bps)" htmlFor="pre-confidence">
                    <Input
                      id="pre-confidence"
                      type="number"
                      min={0}
                      max={10000}
                      className="h-9 font-mono text-xs"
                      value={confidenceBps}
                      onChange={(e) => setConfidenceBps(Number(e.target.value))}
                    />
                  </Field>

                  <Field
                    label="Salt (32-byte hex)"
                    htmlFor="pre-salt"
                    hint={
                      selectedSeat ? (
                        <>
                          The one field the record does not publish. It is the fifth argument of
                          the reveal transaction, and{" "}
                          <code className="font-mono">pnpm ov audit</code> reads it for you.
                          {selectedSeat.revealTx && (
                            <>
                              {" "}
                              <a
                                href={suiTransactionUrl(selectedSeat.revealTx)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline underline-offset-2"
                              >
                                Open the reveal transaction
                              </a>
                              .
                            </>
                          )}
                        </>
                      ) : undefined
                    }
                  >
                    <Input
                      id="pre-salt"
                      className="h-9 font-mono text-xs"
                      placeholder="0x…"
                      value={saltHex}
                      onChange={(e) => setSaltHex(e.target.value)}
                    />
                  </Field>

                  <Field label="Evidence root (32-byte hex)" htmlFor="pre-evidence-root" className="sm:col-span-2">
                    <Input
                      id="pre-evidence-root"
                      className="h-9 font-mono text-xs"
                      value={evidenceRootHex}
                      onChange={(e) => setEvidenceRootHex(e.target.value)}
                    />
                  </Field>

                  <Field label="Output hash (32-byte hex)" htmlFor="pre-output-hash" className="sm:col-span-2">
                    <Input
                      id="pre-output-hash"
                      className="h-9 font-mono text-xs"
                      value={outputHashHex}
                      onChange={(e) => setOutputHashHex(e.target.value)}
                    />
                  </Field>

                  <Field label="Run hash (32-byte hex)" htmlFor="pre-run-hash" className="sm:col-span-2">
                    <Input
                      id="pre-run-hash"
                      className="h-9 font-mono text-xs"
                      value={runHashHex}
                      onChange={(e) => setRunHashHex(e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Expected on-chain commitment (optional)"
                    hint="Paste the commitment stored on Sui to compare byte-for-byte."
                    htmlFor="pre-expected-commitment"
                    className="sm:col-span-2"
                  >
                    <Input
                      id="pre-expected-commitment"
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

            {/* ------------------------------------------ Truth Score tab */}
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
                    {/* The one comparison that closes the loop: the certificate's own score. */}
                    {scoreMatchesCertificate !== null && (
                      <span
                        className={cn(
                          "ov-micro ov-micro-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-center",
                          scoreMatchesCertificate
                            ? "border-yes/30 bg-yes/8 text-yes"
                            : "border-no/30 bg-no/8 text-no",
                        )}
                      >
                        {scoreMatchesCertificate ? (
                          <>
                            <TickCircle size="12" variant="Bold" />
                            Matches the certificate
                          </>
                        ) : (
                          <>
                            <CloseCircle size="12" variant="Bold" />
                            The certificate holds {certificateScore?.toFixed(2)}
                          </>
                        )}
                      </span>
                    )}
                    <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                      Every value is derived locally from the votes above using the same integer
                      half-up arithmetic the Move settlement module runs on-chain.
                    </p>
                  </div>
                </Panel>
              </div>
            </TabsContent>

            <TabsContent value="runproof" className="space-y-5">
              <Panel label="Load a run proof" icon={ShieldTick} tone="chain">
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Claim id" htmlFor="proof-claim-id">
                      <Input
                        id="proof-claim-id"
                        className="h-9 font-mono text-xs"
                        placeholder="0x..."
                        value={proofClaimId}
                        onChange={(event) => setProofClaimId(event.target.value)}
                        aria-label="Claim id for run proof"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Run id" htmlFor="proof-run-id">
                      <Input
                        id="proof-run-id"
                        className="h-9 font-mono text-xs"
                        placeholder="0x..."
                        value={proofRunId}
                        onChange={(event) => setProofRunId(event.target.value)}
                        aria-label="Run id for proof"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </Field>
                    <Button
                      type="button"
                      onClick={() => void fetchRunProof()}
                      disabled={fetchingRunProof}
                      aria-busy={fetchingRunProof}
                      className="min-h-[40px] font-semibold sm:col-span-2"
                    >
                      {fetchingRunProof ? (
                        <Refresh size="15" variant="Bold" className="motion-safe:animate-spin" />
                      ) : (
                        <ShieldTick size="15" variant="Bold" />
                      )}
                      {fetchingRunProof ? "Fetching proof" : "Fetch proof"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Or paste JSON
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <Field
                    label="Public run bundle JSON"
                    hint="A full proof JSON object is also accepted. Include its sealed field to verify decryption."
                    htmlFor="proof-bundle-json"
                  >
                    <Textarea
                      id="proof-bundle-json"
                      value={bundleJson}
                      onChange={(event) => setBundleJson(event.target.value)}
                      placeholder='{"version":5,"kind":"run-bundle"}'
                      className="min-h-56 resize-y font-mono text-xs"
                      aria-label="Public run bundle JSON"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadBundleJson}
                    className="min-h-[40px] w-full font-semibold"
                  >
                    <Code1 size="15" variant="Bold" />
                    Load pasted JSON
                  </Button>
                </div>
              </Panel>

              {runProofError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                >
                  <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
                  {runProofError}
                </div>
              )}

              {runProof && (
                <Panel
                  label="Browser run verification"
                  icon={ShieldTick}
                  tone={runProof.bundle ? "yes" : "sealed"}
                  action={
                    <MetaTag tone={runProof.bundle ? "yes" : "sealed"}>
                      {runProof.bundle ? "Bundle revealed" : "Bundle sealed"}
                    </MetaTag>
                  }
                >
                  <RunProofDetails key={runProof.runId} proof={runProof} />
                </Panel>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

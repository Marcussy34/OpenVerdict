"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HashChip } from "@/components/viz/hash-chip";
import { FieldLabel } from "@/components/viz/panel";
import {
  ArrowDown2,
  CloseCircle,
  Lock,
  Refresh,
  ShieldTick,
  TickCircle,
  Warning2,
} from "@/components/icons";
import {
  recomputeRunProof,
  type BrowserRunProof,
  type RunProofCheck,
} from "@/lib/verify/run-proof";
import type { ReexecuteRunResult } from "@/lib/verify/reexecute";
import { cn } from "@/lib/utils";
import { ResearchTrail } from "@/components/claim/run-proof-research";
import {
  failureDisplayBundle,
  RunProofFailure,
} from "@/components/claim/run-proof-failure";
import { RunProofSeal } from "@/components/claim/run-proof-seal";
import { GatewayReceiptCheck } from "@/components/claim/run-proof-receipt";
import {
  TableVotePanel,
  TableVoteSystemPrompt,
} from "@/components/claim/run-proof-table-vote";
import {
  EverythingElse,
  EvidenceSidesPanel,
  ProvenanceStrip,
  SystemPromptAndBudgets,
} from "@/components/claim/run-proof-transparency";
import type {
  TransparentBundle,
  TransparentRunProof,
} from "@/components/claim/run-proof-types";

function ProofValue({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "chain" | "sealed" | "yes" | "muted";
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-2.5">
      <FieldLabel>{label}</FieldLabel>
      <HashChip
        value={value ?? "Not recorded"}
        tone={tone}
        head={12}
        tail={10}
      />
    </div>
  );
}

function CheckRow({ check }: { check: RunProofCheck }) {
  return (
    <li className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-2">
        {check.ok ? (
          <TickCircle size="16" variant="Bold" className="shrink-0 text-yes" />
        ) : (
          <CloseCircle size="16" variant="Bold" className="shrink-0 text-no" />
        )}
        <span className={cn("text-xs font-semibold", check.ok ? "text-yes" : "text-no")}>
          {check.label}
        </span>
        <span className="ml-auto text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {check.ok ? "Match" : "Mismatch"}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 @xs:grid-cols-2">
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Expected</span>
          <HashChip value={check.expected} tone="muted" head={10} tail={8} />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Computed</span>
          <HashChip
            value={check.actual ?? "Not available"}
            tone={check.ok ? "yes" : "muted"}
            head={10}
            tail={8}
          />
        </div>
      </div>
      {check.detail && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {check.detail}
        </p>
      )}
    </li>
  );
}

function walrusAggregatorUrl(blobId: string): string | null {
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK;
  if (network === "testnet") {
    return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${encodeURIComponent(blobId)}`;
  }
  if (network === "mainnet") {
    return `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${encodeURIComponent(blobId)}`;
  }
  return null;
}

async function reexecutionErrorMessage(response: Response): Promise<string> {
  let message: string | undefined;
  try {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) {
      message = payload.message;
    }
  } catch {
    // Stable status-specific copy below is enough when the body is unavailable.
  }

  if (response.status === 409) return "This run has not been revealed yet";
  if (response.status === 502) {
    return message ?? "The model provider could not complete the re-run";
  }
  if (response.status === 403) {
    return "Independent re-execution is disabled on this deployment";
  }
  if (response.status === 429) {
    return "Too many re-execution requests. Try again shortly";
  }
  if (response.status === 404) return "This run proof is no longer available";
  if (response.status === 503) return "The verification engine is not available";
  return message ?? "The juror could not be re-run";
}

function verdictLabel(outcome: string | undefined, confidenceBps?: number) {
  if (!outcome) return "Not recorded";
  if (confidenceBps === undefined) return outcome;
  return `${outcome} (${(confidenceBps / 100).toFixed(2)}%)`;
}

function ReexecuteRunBlock({
  proof,
  bundle,
}: {
  proof: TransparentRunProof;
  bundle: TransparentBundle;
}) {
  const [result, setResult] = useState<ReexecuteRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reexecute = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(
        `/api/claims/${encodeURIComponent(proof.claimId)}/runs/${encodeURIComponent(proof.runId)}/reexecute`,
        { method: "POST", cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await reexecutionErrorMessage(response));
      }
      setResult((await response.json()) as ReexecuteRunResult);
    } catch (reexecuteError) {
      setError(
        reexecuteError instanceof Error
          ? reexecuteError.message
          : "The juror could not be re-run",
      );
    } finally {
      setRunning(false);
    }
  }, [proof.claimId, proof.runId]);

  const canReexecute = Boolean(proof.claimId && proof.runId);

  return (
    <section
      aria-labelledby={`reexecute-${proof.runId}`}
      className="space-y-3 rounded-xl border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3
            id={`reexecute-${proof.runId}`}
            className="text-sm font-semibold text-ocean"
          >
            Re-run this juror
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Send the revealed messages to the recorded model again at the same
            recorded settings.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void reexecute()}
          disabled={running || !canReexecute}
          aria-busy={running}
          className="min-h-[40px] font-semibold"
        >
          <Refresh
            size="15"
            variant="Bold"
            className={cn(running && "motion-safe:animate-spin")}
          />
          {running ? "Re-running juror" : "Re-run this juror"}
        </Button>
      </div>

      {!canReexecute && (
        <p className="text-xs text-muted-foreground">
          Claim and run ids are required for independent re-execution.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no"
        >
          <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <Card
          size="sm"
          className={cn(
            result.matches.outcome
              ? "ring-yes/30"
              : "ring-destructive/35",
          )}
        >
          <CardHeader>
            <CardTitle
              className={cn(
                "flex items-center gap-2",
                result.matches.outcome ? "text-yes" : "text-destructive",
              )}
            >
              {result.matches.outcome ? (
                <TickCircle size="16" variant="Bold" />
              ) : (
                <Warning2 size="16" variant="Bold" />
              )}
              {result.matches.outcome
                ? "Matches the recorded verdict"
                : "Differs from the recorded verdict"}
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              A matching verdict is strong corroboration. A differing verdict is
              a reason to look closer, not proof of tampering.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 @xs:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-2.5">
                <FieldLabel>Recorded verdict</FieldLabel>
                <p className="mt-1 text-sm font-semibold text-ocean">
                  {verdictLabel(
                    bundle.validatedOutput?.outcome,
                    bundle.validatedOutput?.confidenceBps,
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-2.5">
                <FieldLabel>Fresh verdict</FieldLabel>
                <p className="mt-1 text-sm font-semibold text-ocean">
                  {verdictLabel(result.outcome, result.confidenceBps)}
                </p>
              </div>
              <ProofValue
                label="Recorded output hash"
                value={proof.outputHash}
                tone="chain"
              />
              <ProofValue
                label="Fresh output hash"
                value={result.outputHash}
                tone={result.matches.outputHash ? "yes" : "muted"}
              />
              <ProofValue
                label="Fresh served model"
                value={result.servedModel}
                tone={result.matches.servedModel ? "yes" : "muted"}
              />
              <ProofValue
                label="Fresh gateway request id"
                value={result.gatewayRequestId}
              />
              <ProofValue label="Fresh devshard id" value={result.devshardId} />
              <ProofValue
                label="Fresh system fingerprint"
                value={result.systemFingerprint}
              />
              <div className="rounded-lg border border-border bg-card p-2.5 sm:col-span-2">
                <FieldLabel>Fresh latency</FieldLabel>
                <p className="mt-1 font-mono text-xs font-semibold text-ocean">
                  {new Intl.NumberFormat("en-US").format(result.latencyMs)} ms
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export function RunProofDetails({ proof }: { proof: TransparentRunProof }) {
  const [checks, setChecks] = useState<RunProofCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const bundle = proof.bundle;
  const failureBundle = proof.failure ? failureDisplayBundle(proof) : null;

  const recompute = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setChecks(
        await recomputeRunProof(proof as unknown as BrowserRunProof),
      );
    } catch (error) {
      setChecks(null);
      setCheckError(error instanceof Error ? error.message : "The run proof could not be checked");
    } finally {
      setChecking(false);
    }
  }, [proof]);

  return (
    <div className="@container space-y-4">
      <ProvenanceStrip
        proof={proof}
        bundle={bundle ?? failureBundle}
        walrusUrl={walrusAggregatorUrl}
      />

      {proof.failure && failureBundle ? (
        <RunProofFailure
          proof={proof}
          bundle={failureBundle}
          walrusUrl={walrusAggregatorUrl}
        />
      ) : (
        <>
          <div className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-4">
            <ProofValue label="Prompt hash" value={proof.promptHash} tone="sealed" />
            <ProofValue label="Input hash" value={proof.inputHash} tone="chain" />
            <ProofValue label="Output hash" value={proof.outputHash} tone="chain" />
            <ProofValue label="Run hash" value={proof.runHash} tone="sealed" />
            <ProofValue label="Gateway request id" value={proof.gateway?.gatewayRequestId} />
            <ProofValue label="Devshard id" value={proof.gateway?.devshardId} />
            <ProofValue label="Sealed blob id" value={proof.sealedBlobId} tone="sealed" />
            <ProofValue label="Revealed blob id" value={proof.revealedBlobId} />
          </div>

          {bundle !== null && proof.gateway?.gatewayRequestId ? (
            <GatewayReceiptCheck
              requestId={proof.gateway.gatewayRequestId}
              devshardId={proof.gateway.devshardId}
              expectedModel={bundle.audit?.responseModelId ?? bundle.audit?.modelId}
            />
          ) : null}

          {!bundle ? (
            <div className="flex items-center gap-2 rounded-lg border border-sealed/25 bg-sealed/8 p-3 text-xs font-semibold text-sealed">
              <Lock size="15" variant="Bold" />
              <span>sealed until reveal</span>
            </div>
          ) : (
            <>
              {bundle.version === 6 ? (
                <>
                  <TableVotePanel bundle={bundle} />
                  <EvidenceSidesPanel bundle={bundle} />
                  <TableVoteSystemPrompt
                    systemPrompt={bundle.promptSpec?.systemPrompt}
                  />
                </>
              ) : (
                <>
                  <ResearchTrail
                    bundle={bundle}
                    walrusUrl={walrusAggregatorUrl}
                    runId={proof.runId}
                  />

                  <SystemPromptAndBudgets bundle={bundle} />

                  <EvidenceSidesPanel bundle={bundle} />
                </>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => void recompute()}
                disabled={checking}
                aria-busy={checking}
                className="min-h-[40px] w-full font-semibold"
              >
                {checking ? (
                  <Refresh size="15" variant="Bold" className="motion-safe:animate-spin" />
                ) : (
                  <ShieldTick size="15" variant="Bold" />
                )}
                {checking ? "Recomputing" : "Recompute in this browser"}
              </Button>

              {checkError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no"
                >
                  <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
                  {checkError}
                </div>
              )}

              {checks && (
                <ul className="grid gap-2 @lg:grid-cols-2">
                  {checks.map((check) => (
                    <CheckRow key={check.key} check={check} />
                  ))}
                </ul>
              )}

              <ReexecuteRunBlock
                key={proof.runId}
                proof={proof}
                bundle={bundle}
              />
            </>
          )}

          <RunProofSeal proof={proof} />

          {bundle && <EverythingElse bundle={bundle} />}
        </>
      )}
    </div>
  );
}

export function RunProof({
  claimId,
  runId,
  seatLabel,
}: {
  claimId: string;
  runId: string;
  seatLabel: string;
}) {
  const [proof, setProof] = useState<TransparentRunProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const loadProof = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequested(true);
    try {
      const response = await fetch(
        `/api/claims/${encodeURIComponent(claimId)}/runs/${encodeURIComponent(runId)}/proof`,
        { cache: "no-store" },
      );
      if (response.status === 404) {
        throw new Error("Run proof not found for this seat");
      }
      if (response.status === 503) {
        throw new Error("The verification engine is not available");
      }
      if (!response.ok) {
        throw new Error("The run proof could not be loaded");
      }
      setProof((await response.json()) as TransparentRunProof);
    } catch (loadError) {
      setProof(null);
      setError(loadError instanceof Error ? loadError.message : "The run proof could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [claimId, runId]);

  return (
    <details
      className="group @container rounded-xl border border-border bg-card open:bg-surface"
      onToggle={(event) => {
        if (event.currentTarget.open && !requested) void loadProof();
      }}
    >
      <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="13"
          variant="Bold"
          className="shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        <ShieldTick size="14" variant="Bold" className="shrink-0 text-primary" />
        <span className="font-semibold text-ocean">{seatLabel}</span>
        <span className="ml-auto text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Open proof
        </span>
      </summary>
      <div className="border-t border-border p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FieldLabel>Run id</FieldLabel>
          <HashChip value={runId} label="run" tone="muted" head={10} tail={8} />
        </div>
        {loading && (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Refresh size="14" variant="Bold" className="motion-safe:animate-spin" />
            Loading run proof
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no"
          >
            <Warning2 size="15" variant="Bold" />
            <span className="min-w-0 flex-1">{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadProof()}
              className="min-h-[40px]"
            >
              Retry
            </Button>
          </div>
        )}
        {proof && <RunProofDetails proof={proof} />}
      </div>
    </details>
  );
}

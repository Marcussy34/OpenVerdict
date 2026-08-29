"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HashChip } from "@/components/viz/hash-chip";
import { FieldLabel } from "@/components/viz/panel";
import {
  ArrowDown2,
  CloseCircle,
  Code1,
  ExportSquare,
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
import type { PublicRunBundleV3 } from "@/lib/protocol/types";
import { cn } from "@/lib/utils";

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
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
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

type ResearchStep = PublicRunBundleV3["transcript"]["steps"][number];
type OpenedPage = PublicRunBundleV3["transcript"]["opened"][number];

function ResearchStepCard({
  step,
  openedById,
}: {
  step: ResearchStep;
  openedById: Map<string, OpenedPage>;
}) {
  const result = step.result;

  return (
    <Card size="sm" className="gap-0 py-0 ring-border">
      <CardHeader className="border-b py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {step.index + 1}
          </Badge>
          <CardTitle className="truncate text-xs capitalize">
            {result.tool === "error" ? step.action.action : result.tool}
          </CardTitle>
        </div>
        <CardDescription className="font-mono text-[11px]">
          Turn {step.turn}, request {step.modelRequestId}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 py-3">
        {result.tool === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no">
            <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-mono font-semibold">{result.code}</p>
              <p className="leading-relaxed">{result.message}</p>
            </div>
          </div>
        )}

        {result.tool === "search" && (
          <>
            <div className="space-y-1.5">
              <FieldLabel>Query</FieldLabel>
              <p className="rounded-lg border border-border bg-surface p-3 text-xs font-semibold text-ocean">
                {step.action.action === "search"
                  ? step.action.query
                  : "Search query not recorded"}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Results</FieldLabel>
                {result.cached && <Badge variant="secondary">Cached</Badge>}
              </div>
              {result.results.length > 0 ? (
                <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
                  {result.results.map((searchResult) => (
                    <li key={`${searchResult.rank}-${searchResult.url}`} className="p-3">
                      <a
                        href={searchResult.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold break-words text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span>{searchResult.rank}. {searchResult.title}</span>
                        <ExportSquare size="13" className="shrink-0" />
                      </a>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {searchResult.snippet}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                  No search results were recorded.
                </p>
              )}
            </div>
          </>
        )}

        {result.tool === "open" && (() => {
          const openedPage = openedById.get(result.evidenceId);
          const url =
            openedPage?.finalUrl ??
            openedPage?.url ??
            (step.action.action === "open" ? step.action.url : "");
          const walrusUrl = walrusAggregatorUrl(result.canonicalWalrusBlobId);
          return (
            <>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <FieldLabel>Opened page</FieldLabel>
                  <Badge variant="outline">{result.origin}</Badge>
                  {result.cached && <Badge variant="secondary">Cached</Badge>}
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold break-words text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span>{openedPage?.title ?? result.evidenceId}</span>
                  <ExportSquare size="13" className="shrink-0" />
                </a>
                <p className="font-mono text-[11px] break-all text-muted-foreground">
                  {url}
                </p>
              </div>
              <dl className="grid gap-2 sm:grid-cols-3">
                {[
                  ["from", result.from],
                  ["chars", result.chars],
                  ["totalChars", result.totalChars],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-surface p-2.5">
                    <dt className="font-mono text-[10px] text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-mono text-xs font-semibold text-ocean">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <HashChip
                  value={result.contentHash}
                  label="content"
                  tone="chain"
                  head={12}
                  tail={10}
                  className="min-h-10"
                />
                {walrusUrl && (
                  <Button asChild variant="outline" size="sm" className="min-h-10">
                    <a href={walrusUrl} target="_blank" rel="noreferrer">
                      <ExportSquare size="14" />
                      Walrus blob
                    </a>
                  </Button>
                )}
              </div>
            </>
          );
        })()}

        {result.tool === "answer" && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-xs",
              result.valid
                ? "border-yes/25 bg-yes/8 text-yes"
                : "border-no/25 bg-no/6 text-no",
            )}
          >
            {result.valid ? (
              <TickCircle size="15" variant="Bold" className="mt-px shrink-0" />
            ) : (
              <CloseCircle size="15" variant="Bold" className="mt-px shrink-0" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {result.valid ? "Answer valid" : "Answer invalid"}
              </p>
              {result.errors.map((error) => (
                <p key={error} className="leading-relaxed">{error}</p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchTrail({ bundle }: { bundle: PublicRunBundleV3 }) {
  const transcript = bundle.transcript;
  const openedById = new Map(
    transcript.opened.map((page) => [page.evidenceId, page]),
  );

  return (
    <section aria-label="Research trail" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ocean">Research trail</h3>
          <p className="text-[11px] text-muted-foreground">
            Recorded searches, opened pages, and the final answer action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{transcript.provider.name}</Badge>
          <Badge variant="secondary">{transcript.provider.mode}</Badge>
        </div>
      </div>

      {transcript.steps.length > 0 ? (
        <ol className="space-y-2">
          {transcript.steps.map((step) => (
            <li key={`${step.index}-${step.modelRequestId}`}>
              <ResearchStepCard step={step} openedById={openedById} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
          No research steps were recorded.
        </p>
      )}

      <div className="space-y-2 pt-1">
        <h4 className="text-sm font-semibold text-ocean">Citations</h4>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evidence</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead className="text-center">Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transcript.citations.length > 0 ? (
                transcript.citations.map((citation, index) => (
                  <TableRow key={`${citation.evidenceId}-${index}`}>
                    <TableCell>
                      <HashChip
                        value={citation.evidenceId}
                        head={8}
                        tail={6}
                        tone="muted"
                        className="min-h-10"
                      />
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center text-[11px] break-all text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {citation.url}
                      </a>
                    </TableCell>
                    <TableCell className="min-w-64 max-w-lg whitespace-normal">
                      <q className="text-xs leading-relaxed text-foreground/85">
                        {citation.quote}
                      </q>
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center",
                          citation.found ? "text-yes" : "text-no",
                        )}
                      >
                        {citation.found ? (
                          <TickCircle size="17" variant="Bold" />
                        ) : (
                          <CloseCircle size="17" variant="Bold" />
                        )}
                        <span className="sr-only">
                          {citation.found ? "Quote found" : "Quote not found"}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                    No citations were recorded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}

export function RunProofDetails({ proof }: { proof: BrowserRunProof }) {
  const [checks, setChecks] = useState<RunProofCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const bundle = proof.bundle;

  const recompute = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setChecks(await recomputeRunProof(proof));
    } catch (error) {
      setChecks(null);
      setCheckError(error instanceof Error ? error.message : "The run proof could not be checked");
    } finally {
      setChecking(false);
    }
  }, [proof]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ProofValue label="Prompt hash" value={proof.promptHash} tone="sealed" />
        <ProofValue label="Input hash" value={proof.inputHash} tone="chain" />
        <ProofValue label="Output hash" value={proof.outputHash} tone="chain" />
        <ProofValue label="Run hash" value={proof.runHash} tone="yes" />
        <ProofValue label="Gateway request id" value={proof.gateway?.gatewayRequestId} />
        <ProofValue label="Devshard id" value={proof.gateway?.devshardId} />
        <ProofValue label="Sealed blob id" value={proof.sealedBlobId} tone="sealed" />
        <ProofValue label="Revealed blob id" value={proof.revealedBlobId} tone="yes" />
      </div>

      {!bundle ? (
        <div className="flex items-center gap-2 rounded-lg border border-sealed/25 bg-sealed/8 p-3 text-xs font-semibold text-sealed">
          <Lock size="15" variant="Bold" />
          <span>sealed until reveal</span>
        </div>
      ) : (
        <>
          <details className="group rounded-lg border border-border bg-card">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
              <ArrowDown2
                size="13"
                variant="Bold"
                className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
              />
              <Code1 size="14" variant="Bold" className="text-primary" />
              Exact prompt
            </summary>
            <div className="space-y-3 border-t border-border p-3">
              {bundle.request.messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className="space-y-1.5">
                  <FieldLabel>{message.role} message</FieldLabel>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
                    {message.content}
                  </pre>
                </div>
              ))}
            </div>
          </details>

          <div className="space-y-1.5">
            <FieldLabel>Model output</FieldLabel>
            <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
              {JSON.stringify(bundle.validatedOutput, null, 2)}
            </pre>
          </div>

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
            <ul className="grid gap-2 lg:grid-cols-2">
              {checks.map((check) => (
                <CheckRow key={check.key} check={check} />
              ))}
            </ul>
          )}

          {bundle.version === 3 && <ResearchTrail bundle={bundle} />}
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
  const [proof, setProof] = useState<BrowserRunProof | null>(null);
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
      setProof((await response.json()) as BrowserRunProof);
    } catch (loadError) {
      setProof(null);
      setError(loadError instanceof Error ? loadError.message : "The run proof could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [claimId, runId]);

  return (
    <details
      className="group rounded-xl border border-border bg-card open:bg-surface"
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

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Code1,
  Copy,
  CopySuccess,
  ExportSquare,
  TickCircle,
  CloseCircle,
} from "@/components/icons";
import { cn } from "@/lib/utils";
// The one home for explorer URLs, so this panel follows the configured network.
import { suiObjectUrl, suiTransactionUrl } from "@/lib/web/explorer";
import {
  displayValue,
  isProofRecord,
  type ProofRecord,
  type TransparentBundle,
  type TransparentCitation,
  type TransparentOpenedPage,
  type TransparentRunProof,
} from "@/components/claim/run-proof-types";

type WalrusUrl = (blobId: string) => string | null;

const DISPLAYED_AUDIT_FIELDS = new Set([
  "attempt",
  "providerId",
  "modelId",
  "responseModelId",
  "gonkaRequestId",
  "gatewayRequestId",
  "devshardId",
  "systemFingerprint",
  "inputTokens",
  "outputTokens",
  "latencyMs",
  "requestedAtMs",
  "completedAtMs",
  "status",
]);

const DISPLAYED_GATEWAY_FIELDS = new Set([
  "gatewayRequestId",
  "devshardId",
  "systemFingerprint",
]);

function recordValue(record: ProofRecord | undefined, key: string): unknown {
  return record?.[key];
}

function stringValue(record: ProofRecord | undefined, key: string): string | undefined {
  const value = recordValue(record, key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(record: ProofRecord | undefined, key: string): number | undefined {
  const value = recordValue(record, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formattedNumber(value: number | undefined): string {
  return value === undefined
    ? "Not recorded"
    : new Intl.NumberFormat("en-US").format(value);
}

function utcTime(value: number | undefined): string {
  if (value === undefined) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toISOString();
}

function ProvenanceValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
      <dt className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[11px] font-semibold break-words text-ocean">
        {value}
      </dd>
    </div>
  );
}

function ExternalProofLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string | null;
}) {
  if (!href) {
    return (
      <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
        <FieldLabel>{label}</FieldLabel>
        <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
          {value}
        </p>
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-card p-2.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <FieldLabel>{label}</FieldLabel>
        <p className="mt-1 truncate font-mono text-[11px] font-semibold text-ocean">
          {value}
        </p>
      </div>
      <ExportSquare size="14" className="shrink-0 text-primary" />
    </a>
  );
}

export function ProvenanceStrip({
  proof,
  bundle,
  walrusUrl,
}: {
  proof: TransparentRunProof;
  bundle: TransparentBundle | null;
  walrusUrl: WalrusUrl;
}) {
  const audit = isProofRecord(bundle?.audit) ? bundle.audit : undefined;
  const bundleGateway = isProofRecord(bundle?.gateway) ? bundle.gateway : undefined;
  const proofGateway = isProofRecord(proof.gateway) ? proof.gateway : undefined;
  const attempts = bundle?.attempts ?? [];
  const requestedModel = stringValue(audit, "modelId");
  const servedModel = stringValue(audit, "responseModelId");
  const modelMismatch = Boolean(
    requestedModel && servedModel && requestedModel !== servedModel,
  );
  const attemptKinds = attempts
    .map((attempt) => attempt.kind)
    .filter((kind): kind is string => typeof kind === "string");
  if (attemptKinds.length === 0 && bundle?.request?.attemptKind) {
    attemptKinds.push(bundle.request.attemptKind);
  }
  const attemptCount =
    attempts.length || numberValue(audit, "attempt") || attemptKinds.length;
  const gatewayRequestId =
    stringValue(audit, "gatewayRequestId") ??
    stringValue(bundleGateway, "gatewayRequestId") ??
    stringValue(proofGateway, "gatewayRequestId");
  const devshardId =
    stringValue(audit, "devshardId") ??
    stringValue(bundleGateway, "devshardId") ??
    stringValue(proofGateway, "devshardId");
  const fingerprint =
    stringValue(audit, "systemFingerprint") ??
    stringValue(bundleGateway, "systemFingerprint") ??
    stringValue(proofGateway, "systemFingerprint");
  const status = stringValue(audit, "status");
  const sealedUrl = proof.sealedBlobId
    ? walrusUrl(proof.sealedBlobId)
    : null;
  const revealedUrl = proof.revealedBlobId
    ? walrusUrl(proof.revealedBlobId)
    : null;

  const objectLinks = [
    {
      label: "Claim object",
      value:
        proof.sui?.claimObjectId ??
        stringValue(audit, "claimObjectId") ??
        proof.claimId,
    },
    {
      label: "Agent profile object",
      value: proof.sui?.agentProfileId ?? proof.agentProfileId,
    },
    {
      label: "Jury seat object",
      value: proof.sui?.jurySeatId ?? proof.jurySeatId,
    },
    {
      label: "Run approval object",
      value: proof.sui?.runApproval?.objectId,
    },
    {
      label: "Commitment object",
      value: proof.sui?.commitment?.objectId,
    },
    {
      label: "Reveal object",
      value: proof.sui?.reveal?.objectId,
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  const transactionLinks = [
    {
      label: "Run approval transaction",
      value: proof.sui?.runApproval?.transactionDigest,
    },
    {
      label: "Commitment transaction",
      value: proof.sui?.commitment?.transactionDigest,
    },
    {
      label: "Reveal transaction",
      value: proof.sui?.reveal?.transactionDigest,
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  return (
    <section
      aria-labelledby={`provenance-${proof.runId}`}
      className="space-y-3 rounded-xl border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`provenance-${proof.runId}`} className="text-sm font-semibold text-ocean">
          Run provenance
        </h3>
        {status && (
          <Badge
            variant="outline"
            className={cn(
              "ml-auto",
              status === "SCHEMA_VALID"
                ? "border-yes/30 bg-yes/8 text-yes"
                : "border-no/30 bg-no/8 text-no",
            )}
          >
            {status}
          </Badge>
        )}
        {modelMismatch && (
          <Badge variant="destructive">
            served by a different model, failed closed
          </Badge>
        )}
      </div>

      <dl className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-4">
        <ProvenanceValue label="Requested model" value={requestedModel ?? "Not recorded"} />
        <ProvenanceValue label="Served model" value={servedModel ?? "Not recorded"} />
        <ProvenanceValue
          label="Provider"
          value={stringValue(audit, "providerId") ?? "Not recorded"}
        />
        <ProvenanceValue label="Devshard" value={devshardId ?? "Not recorded"} />
        <ProvenanceValue
          label="System fingerprint"
          value={fingerprint ?? "Not recorded"}
        />
        <ProvenanceValue
          label="Gateway request id"
          value={gatewayRequestId ?? "Not recorded"}
        />
        <ProvenanceValue
          label="Gonka request id"
          value={stringValue(audit, "gonkaRequestId") ?? "Not recorded"}
        />
        <ProvenanceValue
          label="Attempt count"
          value={attemptCount ? String(attemptCount) : "Not recorded"}
        />
        <ProvenanceValue
          label="Input tokens"
          value={formattedNumber(numberValue(audit, "inputTokens"))}
        />
        <ProvenanceValue
          label="Output tokens"
          value={formattedNumber(numberValue(audit, "outputTokens"))}
        />
        <ProvenanceValue
          label="Latency"
          value={
            numberValue(audit, "latencyMs") === undefined
              ? "Not recorded"
              : `${formattedNumber(numberValue(audit, "latencyMs"))} ms`
          }
        />
        <ProvenanceValue
          label="Run status"
          value={status ?? (proof.revealed ? "REVEALED" : "SEALED")}
        />
        <ProvenanceValue
          label="Requested at UTC"
          value={utcTime(numberValue(audit, "requestedAtMs"))}
        />
        <ProvenanceValue
          label="Completed at UTC"
          value={utcTime(numberValue(audit, "completedAtMs"))}
        />
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        <FieldLabel>Attempt kinds</FieldLabel>
        {attemptKinds.length > 0 ? (
          attemptKinds.map((kind, index) => (
            <Badge key={`${kind}-${index}`} variant="secondary">
              {index + 1}. {kind}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Not recorded</span>
        )}
      </div>

      {(proof.sealedBlobId || proof.revealedBlobId) && (
        <div className="grid gap-2 @xs:grid-cols-2">
          {proof.sealedBlobId && (
            <ExternalProofLink
              label="Sealed Walrus blob"
              value={proof.sealedBlobId}
              href={sealedUrl}
            />
          )}
          {proof.revealedBlobId && (
            <ExternalProofLink
              label="Revealed Walrus blob"
              value={proof.revealedBlobId}
              href={revealedUrl}
            />
          )}
        </div>
      )}

      {(objectLinks.length > 0 || transactionLinks.length > 0) && (
        <div className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-3">
          {objectLinks.map((item) => (
            <ExternalProofLink
              key={item.label}
              label={item.label}
              value={item.value}
              href={suiObjectUrl(item.value)}
            />
          ))}
          {transactionLinks.map((item) => (
            <ExternalProofLink
              key={item.label}
              label={item.label}
              value={item.value}
              href={suiTransactionUrl(item.value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KeyValueGrid({
  values,
  emptyMessage,
}: {
  values: Array<[string, unknown]>;
  emptyMessage: string;
}) {
  if (values.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <dl className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-3">
      {values.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-lg border border-border bg-surface p-2.5">
          <dt className="font-mono text-[10px] break-all text-muted-foreground">{key}</dt>
          <dd>
            <pre className="ov-scroll mt-1 max-h-36 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ocean">
              {displayValue(value)}
            </pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SystemPromptAndBudgets({ bundle }: { bundle: TransparentBundle }) {
  const promptSpec = isProofRecord(bundle.promptSpec) ? bundle.promptSpec : {};
  const toolPolicy = isProofRecord(bundle.toolPolicy) ? bundle.toolPolicy : {};
  const systemPrompt = stringValue(promptSpec, "systemPrompt") ?? "Not recorded";

  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="13"
          variant="Bold"
          className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        <Code1 size="14" variant="Bold" className="text-primary" />
        System prompt and budgets
      </summary>
      <div className="space-y-4 border-t border-border p-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel>System prompt</FieldLabel>
            <HashChip
              value={bundle.promptHash ?? "Not recorded"}
              label="prompt hash"
              tone="sealed"
              head={10}
              tail={8}
            />
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            {systemPrompt}
          </pre>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel>Tool policy and research budgets</FieldLabel>
            <HashChip
              value={bundle.toolPolicyHash ?? "Not recorded"}
              label="policy hash"
              tone="chain"
              head={10}
              tail={8}
            />
          </div>
          <KeyValueGrid
            values={Object.entries(toolPolicy)}
            emptyMessage="No tool policy was recorded in this bundle version."
          />
        </div>
      </div>
    </details>
  );
}

function pageMaps(opened: TransparentOpenedPage[]) {
  const byId = new Map<string, TransparentOpenedPage>();
  for (const page of opened) {
    if (page.evidenceId) byId.set(page.evidenceId, page);
    if (page.ref) byId.set(page.ref, page);
  }
  return byId;
}

function EvidenceReference({
  evidenceId,
  openedById,
}: {
  evidenceId: string;
  openedById: Map<string, TransparentOpenedPage>;
}) {
  const page = openedById.get(evidenceId);
  const url = page?.finalUrl ?? page?.url;
  if (!page || !url) {
    // A bare content hash with no opened page behind it: short chip, full
    // value on hover and click-to-copy, instead of a 64-char wall.
    return (
      <HashChip value={evidenceId} label="evidence" tone="muted" head={12} tail={8} />
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-start gap-1.5 text-xs leading-snug font-semibold break-words text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0">{page.title ?? evidenceId}</span>
        <ExportSquare size="13" className="mt-0.5 shrink-0" />
      </a>
      <HashChip value={evidenceId} label="evidence" tone="muted" head={12} tail={8} />
    </div>
  );
}

function EvidenceList({
  items,
  openedById,
  emptyMessage,
}: {
  items: string[];
  openedById: Map<string, TransparentOpenedPage>;
  emptyMessage: string;
}) {
  return items.length > 0 ? (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="px-3 py-2">
          <EvidenceReference evidenceId={item} openedById={openedById} />
        </li>
      ))}
    </ul>
  ) : (
    <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
      {emptyMessage}
    </p>
  );
}

function AssessmentBadge({ assessment }: { assessment: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        assessment === "SUPPORTS" && "border-yes/30 bg-yes/8 text-yes",
        assessment === "CONTRADICTS" && "border-no/30 bg-no/8 text-no",
        assessment === "MIXED" && "border-unsure/30 bg-unsure/8 text-unsure",
        assessment === "INSUFFICIENT" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {assessment}
    </Badge>
  );
}

function citationKey(citation: TransparentCitation, index: number): string {
  return `${citation.evidenceId ?? "citation"}-${citation.url ?? "url"}-${index}`;
}

export function EvidenceSidesPanel({ bundle }: { bundle: TransparentBundle }) {
  const [open, setOpen] = useState(true);
  const output = bundle.validatedOutput;
  const opened = bundle.transcript?.opened ?? [];
  const openedById = pageMaps(opened);
  const supports = output?.evidenceFor ?? [];
  const against = output?.evidenceAgainst ?? [];
  const unsupportedClaims = output?.unsupportedClaims ?? [];
  const decisiveEvidence = output?.decisiveEvidence ?? [];
  const reasoningTrace = output?.publicReasoningTrace ?? [];
  const transcriptCitations = bundle.transcript?.citations ?? [];
  const citations = transcriptCitations.length > 0
    ? transcriptCitations
    : output?.citations ?? [];

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group rounded-lg border border-border bg-card"
    >
      <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="13"
          variant="Bold"
          className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        Evidence sides and public reasoning
        {output?.outcome && (
          <Badge variant="outline" className="ml-auto">{output.outcome}</Badge>
        )}
        {output?.confidenceBps !== undefined && (
          <Badge variant="secondary">
            {(output.confidenceBps / 100).toFixed(2)}% confidence
          </Badge>
        )}
      </summary>
      <div className="space-y-5 border-t border-border p-3">
        <div className="grid gap-3 @lg:grid-cols-2">
          <section className="space-y-2" aria-labelledby="supports-claim-heading">
            <h4 id="supports-claim-heading" className="text-sm font-semibold text-yes">
              Supports the claim
            </h4>
            <EvidenceList
              items={supports}
              openedById={openedById}
              emptyMessage="No supporting evidence was recorded."
            />
          </section>
          <section className="space-y-2" aria-labelledby="against-claim-heading">
            <h4 id="against-claim-heading" className="text-sm font-semibold text-no">
              Against the claim
            </h4>
            <EvidenceList
              items={against}
              openedById={openedById}
              emptyMessage="No opposing evidence was recorded."
            />
          </section>
        </div>

        <div className="grid gap-3 @lg:grid-cols-2">
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-ocean">Unsupported claims</h4>
            {unsupportedClaims.length > 0 ? (
              <ul className="list-disc space-y-1 rounded-lg border border-border bg-surface p-3 pl-7 text-xs leading-relaxed text-foreground/85">
                {unsupportedClaims.map((claim, index) => (
                  <li key={`${claim}-${index}`}>{claim}</li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                No unsupported claims were recorded.
              </p>
            )}
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-ocean">Decisive evidence</h4>
            <EvidenceList
              items={decisiveEvidence}
              openedById={openedById}
              emptyMessage="No decisive evidence was recorded."
            />
          </section>
        </div>

        {output?.reasoning && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-ocean">Final reasoning</h4>
            <p className="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">
              {output.reasoning}
            </p>
          </section>
        )}

        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-ocean">Public reasoning trace</h4>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Finding</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reasoningTrace.length > 0 ? (
                  reasoningTrace.map((item, index) => (
                    <TableRow key={`${item.check ?? "check"}-${index}`}>
                      <TableCell className="min-w-40 whitespace-normal font-semibold text-ocean">
                        {item.check ?? "Not recorded"}
                      </TableCell>
                      <TableCell>
                        <AssessmentBadge assessment={item.assessment ?? "INSUFFICIENT"} />
                      </TableCell>
                      <TableCell className="min-w-64 max-w-xl whitespace-normal text-xs leading-relaxed">
                        {item.finding ?? "Not recorded"}
                      </TableCell>
                      <TableCell className="min-w-48 whitespace-normal">
                        <div className="flex flex-col items-start">
                          {(item.evidenceIds ?? []).length > 0 ? (
                            (item.evidenceIds ?? []).map((evidenceId) => (
                              <EvidenceReference
                                key={evidenceId}
                                evidenceId={evidenceId}
                                openedById={openedById}
                              />
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">None recorded</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                      No public reasoning trace was recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {output?.counterEvidenceSummary !== undefined && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-ocean">Counter evidence summary</h4>
            <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
              {displayValue(output.counterEvidenceSummary)}
            </pre>
          </section>
        )}

        <section className="space-y-2">
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
                {citations.length > 0 ? (
                  citations.map((citation, index) => (
                    <TableRow key={citationKey(citation, index)}>
                      <TableCell className="whitespace-normal">
                        <EvidenceReference
                          evidenceId={citation.evidenceId ?? "Not recorded"}
                          openedById={openedById}
                        />
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        {citation.url ? (
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-10 items-center text-[11px] break-all text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {citation.url}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not recorded</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-64 max-w-lg whitespace-normal">
                        <q className="text-xs leading-relaxed text-foreground/85">
                          {citation.quote ?? "Quote not recorded"}
                        </q>
                      </TableCell>
                      <TableCell className="text-center">
                        {citation.found === undefined ? (
                          <Badge variant="secondary">Not recorded</Badge>
                        ) : (
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
                        )}
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
        </section>
      </div>
    </details>
  );
}

function remainingEntries(
  record: ProofRecord | undefined,
  displayed: ReadonlySet<string>,
): Array<[string, unknown]> {
  return Object.entries(record ?? {}).filter(([key]) => !displayed.has(key));
}

export function EverythingElse({ bundle }: { bundle: TransparentBundle }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const audit = isProofRecord(bundle.audit) ? bundle.audit : undefined;
  const gateway = isProofRecord(bundle.gateway) ? bundle.gateway : undefined;
  const verify = isProofRecord(bundle.verify) ? bundle.verify : {};
  const bundleJson = JSON.stringify(bundle, null, 2);

  const copyBundle = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(bundleJson);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("The bundle could not be copied. Select the JSON and copy it manually.");
    }
  };

  return (
    <section aria-labelledby="everything-else-heading" className="space-y-3">
      <div className="space-y-1">
        <h3 id="everything-else-heading" className="text-sm font-semibold text-ocean">
          Everything else
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Remaining provider metadata, verification formulas, and the complete public bundle.
        </p>
      </div>

      <div className="space-y-2">
        <FieldLabel>Remaining audit fields</FieldLabel>
        <KeyValueGrid
          values={remainingEntries(audit, DISPLAYED_AUDIT_FIELDS)}
          emptyMessage="No additional audit fields were recorded."
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Remaining gateway fields</FieldLabel>
        <KeyValueGrid
          values={remainingEntries(gateway, DISPLAYED_GATEWAY_FIELDS)}
          emptyMessage="No additional gateway fields were recorded."
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Verification formulas</FieldLabel>
        <KeyValueGrid
          values={Object.entries(verify)}
          emptyMessage="No verification formulas were recorded in this bundle version."
        />
      </div>

      <details className="group rounded-lg border border-border bg-card">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
          <ArrowDown2
            size="13"
            variant="Bold"
            className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
          />
          <Code1 size="14" variant="Bold" className="text-primary" />
          Full public bundle (JSON)
        </summary>
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel>Exact bundle bytes as formatted JSON</FieldLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyBundle()}
              className="min-h-10"
            >
              {copied ? (
                <CopySuccess size="14" variant="Bold" />
              ) : (
                <Copy size="14" variant="Bold" />
              )}
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          </div>
          {copyError && (
            <p role="alert" className="rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no">
              {copyError}
            </p>
          )}
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground/85">
            {bundleJson}
          </pre>
        </div>
      </details>
    </section>
  );
}

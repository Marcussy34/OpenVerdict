"use client";

import { Badge } from "@/components/ui/badge";
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
  Code1,
  ExportSquare,
  TickCircle,
  Warning2,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  displayValue,
  isProofRecord,
  stringArray,
  type TransparentAttempt,
  type TransparentBundle,
  type TransparentMessage,
  type TransparentOpenedPage,
  type TransparentResearchStep,
} from "@/components/claim/run-proof-types";

type WalrusUrl = (blobId: string) => string | null;

const EARLY_REFUSAL_CODES = new Set([
  "RESEARCH_REQUIRED",
  "CHALLENGE_REQUIRED",
  "CORROBORATION_REQUIRED",
]);

function formatNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? "Not recorded"
    : new Intl.NumberFormat("en-US").format(value);
}

function responseContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isProofRecord(value)) return null;

  if (typeof value.content === "string") return value.content;
  if (typeof value.output_text === "string") return value.output_text;

  if (isProofRecord(value.message) && typeof value.message.content === "string") {
    return value.message.content;
  }

  if (Array.isArray(value.choices)) {
    const first = value.choices[0];
    if (isProofRecord(first)) {
      if (typeof first.text === "string") return first.text;
      if (isProofRecord(first.message) && typeof first.message.content === "string") {
        return first.message.content;
      }
    }
  }

  return displayValue(value);
}

function matchingAttempt(
  attempts: TransparentAttempt[],
  step: TransparentResearchStep,
  index: number,
): TransparentAttempt | undefined {
  const requestId = step.modelRequestId?.trim();
  const matched = requestId
    ? attempts.find((attempt) => attempt.audit?.gonkaRequestId === requestId)
    : undefined;
  return matched ?? attempts[index];
}

function ConversationExpander({
  label,
  content,
}: {
  label: string;
  content: string | null | undefined;
}) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="13"
          variant="Bold"
          className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        <Code1 size="14" variant="Bold" className="text-primary" />
        {label}
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
        {content?.trim() || "Not recorded"}
      </pre>
    </details>
  );
}

function TurnMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5">
      <dt className="font-mono text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-[11px] font-semibold break-words text-ocean">
        {value}
      </dd>
    </div>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const normalized = intent.toLowerCase();
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        normalized === "support" && "border-yes/30 bg-yes/8 text-yes",
        normalized === "challenge" && "border-no/30 bg-no/8 text-no",
      )}
    >
      {normalized}
    </Badge>
  );
}

function ResearchStepCard({
  step,
  stepIndex,
  stepCount,
  openedById,
  attempts,
  messages,
  finalRawResponse,
  walrusUrl,
}: {
  step: TransparentResearchStep;
  stepIndex: number;
  stepCount: number;
  openedById: Map<string, TransparentOpenedPage>;
  attempts: TransparentAttempt[];
  messages: TransparentMessage[];
  finalRawResponse: unknown;
  walrusUrl: WalrusUrl;
}) {
  const action = step.action ?? {};
  const result = step.result ?? {};
  const tool = result.tool ?? "unknown";
  const actionName = action.action ?? "turn";
  const attempt = matchingAttempt(attempts, step, stepIndex);
  const audit = attempt?.audit;
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );
  // A batch open (bundle v5) records one step per page, so the conversation
  // is addressed by the recorded turn, not the step position.
  const batch =
    typeof step.batch?.size === "number" && typeof step.batch?.position === "number"
      ? { size: step.batch.size, position: step.batch.position }
      : null;
  const turnIndex =
    typeof step.turn === "number" && step.turn > 0 ? step.turn - 1 : stepIndex;
  const modelInput = userMessages[turnIndex]?.content;
  const attemptResponse = attempt?.response ?? attempt?.rawResponse;
  const rawResponse =
    attemptResponse ?? (stepIndex === stepCount - 1 ? finalRawResponse : undefined);
  const modelOutput =
    assistantMessages[turnIndex]?.content ?? responseContent(rawResponse);
  const intent =
    typeof action.intent === "string"
      ? action.intent
      : typeof result.intent === "string"
        ? result.intent
        : null;
  const code = result.code ?? "UNKNOWN_ERROR";
  const isEarlyRefusal = EARLY_REFUSAL_CODES.has(code);
  const servedModel = audit?.responseModelId ?? audit?.modelId;
  const tokenSummary = `${formatNumber(audit?.inputTokens)} in, ${formatNumber(audit?.outputTokens)} out`;
  const flags = attempt?.investigationFlags ?? [];

  return (
    <Card size="sm" className="gap-0 py-0 ring-border">
      <CardHeader className="border-b py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {(step.index ?? stepIndex) + 1}
          </Badge>
          <CardTitle className="truncate text-xs capitalize">
            {tool === "error" ? actionName : tool}
          </CardTitle>
          {intent && <IntentBadge intent={intent} />}
          {audit?.status && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto",
                audit.status === "SCHEMA_VALID"
                  ? "border-yes/30 bg-yes/8 text-yes"
                  : "border-no/30 bg-no/8 text-no",
              )}
            >
              {audit.status}
            </Badge>
          )}
        </div>
        <CardDescription className="font-mono text-[11px] break-all">
          Turn {step.turn ?? stepIndex + 1}, request {step.modelRequestId || "not recorded"}
          {batch && `, page ${batch.position} of ${batch.size} opened together`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 py-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel>Gonka node for this turn</FieldLabel>
            {attempt?.kind && <Badge variant="secondary">{attempt.kind}</Badge>}
          </div>
          <dl className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-3">
            <TurnMetric label="served model" value={servedModel ?? "Not recorded"} />
            <TurnMetric label="devshard" value={audit?.devshardId ?? "Not recorded"} />
            <TurnMetric
              label="system fingerprint"
              value={audit?.systemFingerprint ?? "Not recorded"}
            />
            <TurnMetric
              label="latency"
              value={
                audit?.latencyMs === undefined
                  ? "Not recorded"
                  : `${formatNumber(audit.latencyMs)} ms`
              }
            />
            <TurnMetric label="tokens" value={tokenSummary} />
            <TurnMetric
              label="gateway request"
              value={audit?.gatewayRequestId ?? "Not recorded"}
            />
          </dl>
          {flags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sealed/25 bg-sealed/8 p-2.5">
              <span className="text-[10px] font-semibold tracking-wide text-sealed uppercase">
                Investigation flags
              </span>
              {flags.map((flag) => (
                <Badge key={flag} variant="outline" className="border-sealed/30 text-sealed">
                  {flag}
                </Badge>
              ))}
            </div>
          )}
          {attempt?.error !== undefined && (
            <div className="rounded-lg border border-no/25 bg-no/6 p-2.5 text-xs text-no">
              <p className="font-semibold">Attempt error</p>
              <pre className="mt-1 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
                {displayValue(attempt.error)}
              </pre>
            </div>
          )}
        </div>

        <div className="grid gap-2 @lg:grid-cols-2">
          <ConversationExpander
            label="What the model was sent"
            content={modelInput}
          />
          <ConversationExpander
            label="What the model said"
            content={modelOutput}
          />
        </div>

        {tool === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-no/30 bg-no/8 p-3 text-xs text-no">
            <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {isEarlyRefusal
                  ? "The engine refused an early answer"
                  : "Research tool error"}
              </p>
              <p className="font-mono font-semibold">{code}</p>
              <p className="leading-relaxed">
                {result.message ?? "No error message was recorded."}
              </p>
            </div>
          </div>
        )}

        {tool === "search" && (
          <>
            <div className="space-y-1.5">
              <FieldLabel>Query</FieldLabel>
              <p className="rounded-lg border border-border bg-surface p-3 text-xs font-semibold text-ocean">
                {action.query ?? result.query ?? "Search query not recorded"}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Results</FieldLabel>
                {result.cached && <Badge variant="secondary">Cached</Badge>}
              </div>
              {(result.results ?? []).length > 0 ? (
                <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
                  {(result.results ?? []).map((searchResult, index) => {
                    const rank = searchResult.rank ?? searchResult.n ?? index + 1;
                    const url = searchResult.url ?? "";
                    return (
                      <li key={`${rank}-${url || index}`} className="p-3">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold break-words text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <span>{rank}. {searchResult.title ?? url}</span>
                            <ExportSquare size="13" className="shrink-0" />
                          </a>
                        ) : (
                          <p className="text-xs font-semibold text-ocean">
                            {rank}. {searchResult.title ?? "Untitled result"}
                          </p>
                        )}
                        {searchResult.snippet && (
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {searchResult.snippet}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                  No search results were recorded.
                </p>
              )}
            </div>
          </>
        )}

        {tool === "open" && (() => {
          const evidenceId = result.evidenceId ?? result.ref ?? "";
          const openedPage = openedById.get(evidenceId);
          const url =
            openedPage?.finalUrl ??
            openedPage?.url ??
            result.url ??
            action.url ??
            "";
          const blobId =
            result.canonicalWalrusBlobId ?? openedPage?.canonicalWalrusBlobId;
          const blobUrl = blobId ? walrusUrl(blobId) : null;
          const sides = stringArray(
            openedPage?.sides ??
              openedPage?.side ??
              result.sides ??
              result.side ??
              action.sides ??
              action.side,
          );
          return (
            <>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <FieldLabel>Opened page</FieldLabel>
                  {(result.origin ?? openedPage?.origin) && (
                    <Badge variant="outline">{result.origin ?? openedPage?.origin}</Badge>
                  )}
                  {sides.map((side) => (
                    <IntentBadge key={side} intent={side} />
                  ))}
                  {result.cached && <Badge variant="secondary">Cached</Badge>}
                </div>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold break-words text-ocean underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span>{openedPage?.title ?? (evidenceId || url)}</span>
                    <ExportSquare size="13" className="shrink-0" />
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">Page URL not recorded</p>
                )}
                {url && (
                  <p className="font-mono text-[11px] break-all text-muted-foreground">
                    {url}
                  </p>
                )}
              </div>
              <dl className="grid gap-2 @sm:grid-cols-3">
                <TurnMetric label="from" value={displayValue(result.from)} />
                <TurnMetric label="chars" value={displayValue(result.chars)} />
                <TurnMetric
                  label="totalChars"
                  value={displayValue(result.totalChars ?? openedPage?.totalChars)}
                />
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                {result.contentHash && (
                  <HashChip
                    value={result.contentHash}
                    label="content"
                    tone="chain"
                    head={12}
                    tail={10}
                    className="min-h-10"
                  />
                )}
                {blobUrl && blobId && (
                  <Button asChild variant="outline" size="sm" className="min-h-10">
                    <a href={blobUrl} target="_blank" rel="noreferrer">
                      <ExportSquare size="14" />
                      Walrus blob
                    </a>
                  </Button>
                )}
              </div>
            </>
          );
        })()}

        {tool === "answer" && (
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
              {(result.errors ?? []).map((error) => (
                <p key={error} className="leading-relaxed">{error}</p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ResearchTrail({
  bundle,
  walrusUrl,
}: {
  bundle: TransparentBundle;
  walrusUrl: WalrusUrl;
}) {
  const transcript = bundle.transcript;
  const steps = transcript?.steps ?? [];
  const opened = transcript?.opened ?? [];
  const attempts = bundle.attempts ?? [];
  const messages = bundle.request?.messages ?? [];
  const openedById = new Map<string, TransparentOpenedPage>();
  for (const page of opened) {
    if (page.evidenceId) openedById.set(page.evidenceId, page);
    if (page.ref) openedById.set(page.ref, page);
  }

  return (
    <section aria-label="Research trail" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ocean">Research trail</h3>
          <p className="text-[11px] text-muted-foreground">
            Every model turn, node response, tool action, and engine decision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {transcript?.provider?.name && (
            <Badge variant="outline">{transcript.provider.name}</Badge>
          )}
          {transcript?.provider?.mode && (
            <Badge variant="secondary">{transcript.provider.mode}</Badge>
          )}
        </div>
      </div>

      {steps.length > 0 ? (
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={`${step.index ?? index}-${step.modelRequestId ?? index}`}>
              <ResearchStepCard
                step={step}
                stepIndex={index}
                stepCount={steps.length}
                openedById={openedById}
                attempts={attempts}
                messages={messages}
                finalRawResponse={bundle.rawResponse}
                walrusUrl={walrusUrl}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
          No research steps were recorded in this bundle version.
        </p>
      )}
    </section>
  );
}

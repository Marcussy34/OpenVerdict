"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { PIPELINE_STAGES } from "@/components/viz/pipeline";
import {
  useClaimSubmission,
  MAX_CLAIM,
  MAX_TEXT,
  MAX_URLS,
} from "@/components/claim/use-claim-submission";
import { cn } from "@/lib/utils";
import {
  ShieldSearch,
  InfoCircle,
  DocumentText,
  Add,
  Trash,
  Link21,
  Warning2,
  Judge,
  ArrowRight,
  Refresh,
} from "@/components/icons";

function FactCheckContent() {
  const searchParams = useSearchParams();

  // Initialize state directly from URL query parameters (home hand-off).
  const [claim, setClaim] = useState(() => searchParams.get("claim") || "");
  const [text, setText] = useState("");
  const [urls, setUrls] = useState<string[]>(() => {
    const urlParam = searchParams.get("url");
    return urlParam ? [urlParam] : [""];
  });
  const [resolutionCriteria, setResolutionCriteria] = useState("");

  // Validation, the POST and the redirect all live in the shared hook, so this
  // page and the landing footer's one-line form behave identically.
  const { submit, submitting, errorMessage, isEngineOffline } = useClaimSubmission();

  const addUrlField = () => {
    if (urls.length < MAX_URLS) setUrls([...urls, ""]);
  };

  const updateUrl = (index: number, value: string) => {
    const updated = [...urls];
    updated[index] = value;
    setUrls(updated);
  };

  const removeUrl = (index: number) => {
    setUrls(urls.length === 1 ? [""] : urls.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit({ claim, text, urls, resolutionCriteria });
  };

  const claimTooLong = claim.length > MAX_CLAIM * 0.9;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <PageHeader
        eyebrow="Direct review"
        title="Submit a fact-check"
        description="Submit a bounded factual claim and its evidence URLs for decentralized multi-model AI deliberation. Five distinct models deliberate under cryptographic commit-reveal."
        icon={ShieldSearch}
        badges={<ExperimentalTag />}
      />

      {isEngineOffline && (
        <Alert className="border-unsure/35 bg-unsure/8">
          <Warning2 size="18" variant="Bold" className="text-unsure" />
          <AlertTitle className="text-sm font-semibold text-ocean">
            Engine backend offline / not wired
          </AlertTitle>
          <AlertDescription className="mt-1 space-y-2 text-xs text-muted-foreground">
            <p>
              The verification engine returned 503. In full deployment this submission triggers
              an on-chain Move claim creation and schedules the five-agent jury.
            </p>
            <p>
              You can still exercise the client-side commit-reveal and Truth Score recomputation
              on the{" "}
              <Link href="/verify" className="font-semibold text-primary hover:underline">
                verifier page
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <Warning2 size="18" variant="Bold" />
          <AlertTitle className="text-sm font-semibold">Validation error</AlertTitle>
          <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 lg:col-span-2">
          <Panel label="Claim statement" icon={DocumentText} tone="primary">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="claim-text" className="text-sm font-semibold text-ocean">
                  What should the jury verify? <span className="text-no">*</span>
                </label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    claimTooLong ? "text-unsure" : "text-muted-foreground",
                  )}
                >
                  {claim.length}/{MAX_CLAIM}
                </span>
              </div>
              <Textarea
                id="claim-text"
                required
                placeholder="State the exact factual assertion to be verified — e.g. “DeepSeek released the V4 model weights on August 15, 2026”…"
                className="min-h-[110px] text-sm"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                maxLength={MAX_CLAIM}
              />
              <p className="text-[11px] text-muted-foreground">
                Clear, falsifiable, bounded assertions resolve fastest and reach higher
                consensus.
              </p>
            </div>
          </Panel>

          <Panel
            label="Evidence source URLs"
            icon={Link21}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUrlField}
                disabled={urls.length >= MAX_URLS}
                className="min-h-[32px] text-xs font-semibold"
              >
                <Add size="13" variant="Bold" />
                Add URL
              </Button>
            }
          >
            <div className="space-y-2">
              {urls.map((urlVal, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="ov-micro ov-micro-sm grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
                    {index + 1}
                  </span>
                  <Input
                    type="url"
                    placeholder="https://example.com/press-release-or-doc"
                    className="h-10 font-mono text-xs"
                    value={urlVal}
                    onChange={(e) => updateUrl(index, e.target.value)}
                    aria-label={`Evidence source URL ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeUrl(index)}
                    className="size-10 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove URL ${index + 1}`}
                  >
                    <Trash size="16" variant="Bold" />
                  </Button>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Up to {MAX_URLS} sources. Each is crawled through an SSRF-safe proxy, sanitized
                to plain text, and Merkle-frozen to Walrus before any model sees it.
              </p>
            </div>
          </Panel>

          <Panel label="Supporting context (optional)" icon={DocumentText}>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="context-text" className="text-sm font-semibold text-ocean">
                    Pasted context
                  </label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {text.length}/{MAX_TEXT.toLocaleString()}
                  </span>
                </div>
                <Textarea
                  id="context-text"
                  placeholder="Paste excerpts, article text or background context to accompany the claim…"
                  className="min-h-[90px] text-sm"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={MAX_TEXT}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="criteria-text" className="text-sm font-semibold text-ocean">
                  Resolution criteria
                </label>
                <Input
                  id="criteria-text"
                  placeholder="e.g. “Resolves YES if primary source documentation confirms the release before 23:59 UTC”…"
                  className="h-10 text-xs"
                  value={resolutionCriteria}
                  onChange={(e) => setResolutionCriteria(e.target.value)}
                  maxLength={2000}
                />
                <p className="text-[11px] text-muted-foreground">
                  Left blank, deterministic default criteria are derived from the statement.
                </p>
              </div>
            </div>
          </Panel>

          <div className="ov-edge flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoCircle size="14" variant="Bold" className="mt-px shrink-0" />
              No gas fees and no wallet are required for direct-review submissions.
            </p>
            <Button
              type="submit"
              disabled={submitting || !claim.trim()}
              aria-busy={submitting}
              className="min-h-[44px] w-full px-7 font-semibold shadow-xs sm:w-auto"
            >
              {submitting ? (
                <>
                  <Refresh size="16" variant="Linear" className="motion-safe:animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  Start fact-check
                  <ArrowRight size="16" variant="Bold" />
                </>
              )}
            </Button>
          </div>
        </form>

        {/* What happens next */}
        <aside className="space-y-4">
          <Panel label="What happens next" icon={Judge} tone="sealed" className="lg:sticky lg:top-24">
            <ol className="space-y-3">
              {PIPELINE_STAGES.map((stage) => (
                <li key={stage.index} className="flex gap-3">
                  <span className="ov-micro ov-micro-sm mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
                    {stage.index}
                  </span>
                  <div className="min-w-0">
                    <FieldLabel>{stage.kicker}</FieldLabel>
                    <p className="text-xs font-semibold text-ocean">{stage.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {stage.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Direct review bypasses the optimistic disputation window: the engine locks the
              evidence manifest immediately, draws five jurors across ≥3 model families with Sui
              native randomness, and executes the sealed commit-reveal round.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

export default function FactCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-16">
          <div className="h-72 animate-pulse rounded-2xl bg-surface" />
        </div>
      }
    >
      <FactCheckContent />
    </Suspense>
  );
}

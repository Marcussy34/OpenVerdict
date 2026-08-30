"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { PIPELINE_STAGES } from "@/components/viz/pipeline";
import {
  useClaimSubmission,
  MAX_CLAIM,
} from "@/components/claim/use-claim-submission";
import { cn } from "@/lib/utils";
import {
  ShieldSearch,
  InfoCircle,
  DocumentText,
  Warning2,
  Judge,
  ArrowRight,
  Refresh,
} from "@/components/icons";

function FactCheckContent() {
  const searchParams = useSearchParams();

  // Initialize state directly from URL query parameters (home hand-off).
  const [claim, setClaim] = useState(() => searchParams.get("claim") || "");

  // Validation, the POST and the redirect all live in the shared hook, so this
  // page and the landing footer's one-line form behave identically.
  const { submit, submitting, errorMessage, isEngineOffline } = useClaimSubmission();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit({ claim });
  };

  const claimTooLong = claim.length > MAX_CLAIM * 0.9;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Direct review"
        title="Submit a fact-check"
        description="State one bounded factual claim. Five jurors from three model families research it on the open web, for and against, and vote under commit-reveal. Nothing else is needed."
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
                placeholder="State the exact factual assertion to be verified, e.g. “DeepSeek released the V4 model weights on August 15, 2026”…"
                className="min-h-[110px] text-sm"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                maxLength={MAX_CLAIM}
              />
              <p className="text-[11px] text-muted-foreground">
                Write one falsifiable sentence with the who, what and when, for example: The first Bitcoin halving took place in November 2012. Avoid opinions, predictions and compound claims.
              </p>
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
        <div className="mx-auto max-w-5xl px-5 py-16 md:px-7">
          <div className="h-72 animate-pulse rounded-2xl bg-surface" />
        </div>
      }
    >
      <FactCheckContent />
    </Suspense>
  );
}

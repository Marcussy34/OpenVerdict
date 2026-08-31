"use client";

import { useEffect, useState, Suspense } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldLabel } from "@/components/viz/panel";
import { PIPELINE_STAGES } from "@/components/viz/pipeline";
import { StateBadge } from "@/components/claim/state-badge";
import {
  useClaimSubmission,
  MAX_CLAIM,
} from "@/components/claim/use-claim-submission";
import { useNow } from "@/components/use-now";
import { cn } from "@/lib/utils";
import {
  ArrowDown2,
  ArrowRight,
  ArrowRight2,
  Global,
  Refresh,
  SearchNormal1,
  ShieldSearch,
  Warning2,
} from "@/components/icons";

/** The slice of a claim inspection the explorer rows need. */
type ExplorerRow = {
  claimId: string;
  statement: string;
  state: number;
  deadlines?: { evidenceCutoffMs?: number };
  result?: {
    result: "YES" | "NO" | "UNSURE" | "UNRESOLVED";
    truthScoreBps: number | null;
  };
};

const OUTCOME_CHIP: Record<string, string> = {
  YES: "bg-yes/10 text-yes",
  NO: "bg-no/10 text-no",
  UNSURE: "bg-unsure/10 text-unsure",
  UNRESOLVED: "bg-muted text-muted-foreground",
};

/** Friendly copy for the extraction endpoint's error codes. */
const EXTRACT_ERRORS: Record<string, string> = {
  INVALID_URL: "That does not look like a reachable page URL.",
  NO_CLAIM_FOUND: "No checkable factual claim found on that page; state it as text instead.",
  FETCH_FAILED: "Could not read that page safely; paste the claim as text instead.",
  ENGINE_NOT_WIRED: "The engine is offline; extraction is unavailable right now.",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function shortClaimId(claimId: string): string {
  return claimId.length <= 14
    ? claimId
    : `${claimId.slice(0, 8)}…${claimId.slice(-4)}`;
}

function truthScoreChip(row: ExplorerRow): string | null {
  const bps = row.result?.truthScoreBps;
  if (bps === null || bps === undefined) return null;
  const score = bps / 100;
  return Number.isInteger(score) ? score.toFixed(0) : score.toFixed(2);
}

/** Coarse relative time; empty during SSR so hydration stays stable. */
function timeAgo(now: number | null, atMs: number | undefined): string {
  if (now === null || atMs === undefined) return "";
  const delta = Math.max(0, now - atMs);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Latest fact-checks, explorer style: quiet rows straight into the canvas. */
function RecentFactChecks() {
  const now = useNow();
  const [rows, setRows] = useState<ExplorerRow[] | null>(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const response = await fetch("/api/claims");
        if (!response.ok) return;
        // The endpoint wraps the list: { claims: [...] }.
        const payload = (await response.json()) as
          | ExplorerRow[]
          | { claims?: ExplorerRow[] };
        const list = Array.isArray(payload) ? payload : payload.claims;
        if (!ignore && Array.isArray(list)) setRows(list.slice(0, 8));
      } catch {
        // The explorer list is a convenience; the form works without it.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="mx-auto w-full max-w-3xl space-y-2">
      <p className="ov-micro ov-micro-sm text-muted-foreground">
        Recent verifications
      </p>

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-muted-foreground">
          No verifications yet. Yours can be the first.
        </p>
      ) : (
        <ul className="ov-edge divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((row) => {
            const score = truthScoreChip(row);
            const ago = timeAgo(now, row.deadlines?.evidenceCutoffMs);
            return (
              <li key={row.claimId}>
                <Link
                  href={`/claims/${row.claimId}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ocean">
                      {row.statement}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {shortClaimId(row.claimId)}
                      {ago ? ` · ${ago}` : ""}
                    </p>
                  </div>
                  {row.result && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                        OUTCOME_CHIP[row.result.result] ?? OUTCOME_CHIP.UNRESOLVED,
                      )}
                    >
                      {row.result.result}
                      {score ? ` ${score}` : ""}
                    </span>
                  )}
                  <StateBadge state={row.state} size="sm" className="shrink-0" />
                  <ArrowRight2 size="14" className="shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** All the explanation, folded away until asked for. */
function HowItRuns() {
  return (
    <details className="group mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="14"
          variant="Bold"
          className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        <ShieldSearch size="15" variant="Bold" className="text-primary" />
        How verification runs
      </summary>
      <div className="space-y-4 border-t border-border p-4">
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
        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Direct review skips the dispute window: evidence locks at once, five
          jurors are drawn with Sui randomness, and the sealed round runs.
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          One falsifiable sentence with the who, what and when. No opinions,
          predictions or compound claims.
        </p>
      </div>
    </details>
  );
}

function FactCheckContent() {
  const searchParams = useSearchParams();

  // Initialize state directly from URL query parameters (home hand-off).
  const [claim, setClaim] = useState(() => searchParams.get("claim") || "");

  // Validation, the POST and the redirect all live in the shared hook, so this
  // page and the landing footer's one-line form behave identically.
  const { submit, submitting, errorMessage, isEngineOffline } = useClaimSubmission();

  // URL-shaped input flips the bar into extraction mode: the engine reads
  // the page on Gonka and proposes the checkable claim (track requirement:
  // "input a URL, tweet, or text snippet").
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{
    sourceUrl: string;
    modelId: string;
    requestId?: string;
  } | null>(null);
  const isUrlInput = /^https?:\/\/\S+$/i.test(claim.trim());

  const extract = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const response = await fetch("/api/extract-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: claim.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        claim?: string;
        sourceUrl?: string;
        modelId?: string;
        gonkaRequestId?: string;
        gatewayRequestId?: string;
        error?: string;
      };
      if (response.ok && data.claim) {
        setClaim(data.claim);
        setExtraction({
          sourceUrl: data.sourceUrl ?? claim.trim(),
          modelId: data.modelId ?? "GonkaRouter",
          requestId: data.gonkaRequestId ?? data.gatewayRequestId,
        });
        return;
      }
      setExtractError(
        EXTRACT_ERRORS[data.error ?? ""]
          ?? (response.status === 429
            ? "Too many extractions right now; try again in a moment."
            : "Could not extract a claim from that page; state it as text instead."),
      );
    } catch {
      setExtractError("Could not reach the extraction service; state the claim as text instead.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUrlInput) {
      await extract();
      return;
    }
    await submit({ claim });
  };

  const claimTooLong = claim.length > MAX_CLAIM * 0.9;

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: explorer style, almost no words on screen. */}
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <h1 className="ov-display text-5xl text-ocean md:text-6xl">
          Verify any{" "}
          <span aria-label="claim" className="ov-wave-word">
            {"claim".split("").map((letter, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="ov-wave-letter"
                style={{ "--i": index } as CSSProperties}
              >
                {letter}
              </span>
            ))}
          </span>
        </h1>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-3">
        {isEngineOffline && (
          <Alert className="border-unsure/35 bg-unsure/8">
            <Warning2 size="18" variant="Bold" className="text-unsure" />
            <AlertTitle className="text-sm font-semibold text-ocean">
              Engine backend offline / not wired
            </AlertTitle>
            <AlertDescription className="mt-1 space-y-2 text-xs text-muted-foreground">
              <p>
                The verification engine returned 503. In full deployment this
                submission triggers an on-chain Move claim creation and
                schedules the five-agent jury.
              </p>
              <p>
                You can still exercise the client-side commit-reveal and Truth
                Score recomputation on the{" "}
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

        {/* The bar: one input, the button inside it, nothing else. */}
        {/* One flat row: icon, input and button are siblings under
            items-center, and the input's padding makes it exactly the
            button's 48px, so all three sit on one line at every width. */}
        <form
          onSubmit={handleSubmit}
          className="ov-edge flex items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-xs focus-within:ring-2 focus-within:ring-ring"
        >
          <SearchNormal1 size="18" className="shrink-0 text-muted-foreground" />
          <Textarea
            id="claim-text"
            required
            rows={1}
            placeholder="e.g. The first Bitcoin halving took place in November 2012"
            className="field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 py-3 text-base leading-6 shadow-none placeholder:text-muted-foreground/45 focus-visible:ring-0 dark:bg-transparent"
            value={claim}
            onChange={(e) => {
              setClaim(e.target.value);
              setExtractError(null);
            }}
            onKeyDown={(e) => {
              // Enter submits like a search bar; Shift+Enter makes a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={MAX_CLAIM}
            aria-label="Claim statement to verify"
          />
          <Button
            type="submit"
            disabled={submitting || extracting || !claim.trim()}
            aria-busy={submitting || extracting}
            className="min-h-12 shrink-0 px-6 font-semibold shadow-xs"
          >
            {submitting ? (
              <>
                <Refresh size="16" variant="Linear" className="motion-safe:animate-spin" />
                Freezing to Walrus (about 20 s)…
              </>
            ) : extracting ? (
              <>
                <Refresh size="16" variant="Linear" className="motion-safe:animate-spin" />
                Reading the page on Gonka…
              </>
            ) : isUrlInput ? (
              <>
                Extract claim
                <ArrowRight size="16" variant="Bold" />
              </>
            ) : (
              <>
                Verify claim
                <ArrowRight size="16" variant="Bold" />
              </>
            )}
          </Button>
        </form>

        {extractError && (
          <p className="rounded-xl border border-unsure/30 bg-unsure/8 px-3 py-2 text-xs font-medium text-unsure">
            {extractError}
          </p>
        )}
        {extraction && !extractError && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
            <Global size="12" variant="Bold" className="shrink-0 text-primary" />
            <span className="min-w-0">
              Claim extracted from{" "}
              <span className="font-medium text-ocean">{hostOf(extraction.sourceUrl)}</span>
              {" "}by {extraction.modelId} on Gonka
              {extraction.requestId ? (
                <span className="font-mono"> · {extraction.requestId}</span>
              ) : null}
              . Edit freely, then Verify.
            </span>
          </div>
        )}

        {/* Helper details only surface once the user starts typing. */}
        {claim.length > 0 && (
          <div className="flex items-start justify-between gap-3 px-1">
            <p className="text-[11px] text-muted-foreground">
              {isUrlInput
                ? "A page URL: the engine reads it on Gonka and proposes the checkable claim."
                : "One falsifiable sentence with the who, what and when. Avoid opinions, predictions and compound claims. Or paste a page URL."}
            </p>
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                claimTooLong ? "text-unsure" : "text-muted-foreground",
              )}
            >
              {claim.length}/{MAX_CLAIM}
            </span>
          </div>
        )}

      </div>

      <RecentFactChecks />

      <HowItRuns />
    </div>
  );
}

export default function FactCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-5 py-24 md:px-7">
          <div className="h-40 animate-pulse rounded-2xl bg-surface" />
        </div>
      }
    >
      <FactCheckContent />
    </Suspense>
  );
}

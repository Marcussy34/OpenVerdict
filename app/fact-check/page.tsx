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
import { WeatherStrip } from "@/components/weather/weather-strip";
import {
  useClaimSubmission,
  MAX_CLAIM,
} from "@/components/claim/use-claim-submission";
import {
  ClaimPicker,
  type ExtractedClaimCandidate,
} from "@/components/claim/claim-picker";
import { useNow } from "@/components/use-now";
import { cn } from "@/lib/utils";
import type { ClaimInspection } from "@/lib/engine/contract";
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
  attemptChain?: ClaimInspection["attemptChain"];
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
  NO_CLAIM_FOUND: "No checkable claim found; state it as text instead.",
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
        /* Five placeholder rows matching the list container to reserve height and prevent layout shift */
        <ul
          aria-hidden="true"
          className="ov-edge divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card animate-pulse"
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <li key={index} className="flex min-h-[58px] items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-surface-2" />
                <div className="h-3 w-1/3 rounded bg-surface-2" />
              </div>
              <div className="h-5 w-16 shrink-0 rounded-full bg-surface-2" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        /* Maintain stable container height with single-row height for empty state */
        <div className="ov-edge flex min-h-[58px] items-center rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
          No verifications yet. Yours can be the first.
        </div>
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
                  <StateBadge
                    state={row.state}
                    attemptStatus={row.attemptChain?.status}
                    size="sm"
                    className="shrink-0"
                  />
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
      {/* Fixed min-height reserves summary row height to prevent layout shift */}
      <summary className="flex min-h-[46px] cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
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

/** Extraction reads up to this much pasted text; a claim itself stays at MAX_CLAIM. */
const MAX_PASTE = 20_000;

function FactCheckContent() {
  const searchParams = useSearchParams();

  // Initialize state directly from URL query parameters (home hand-off).
  const [claim, setClaim] = useState(() => searchParams.get("claim") || "");

  // Candidate claims returned from extraction, plus selection and language state.
  const [candidates, setCandidates] = useState<ExtractedClaimCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [language, setLanguage] = useState("");

  // Validation, the POST and the redirect all live in the shared hook, so this
  // page and the landing footer's one-line form behave identically.
  const { submit, submitting, errorMessage, isEngineOffline } = useClaimSubmission();

  // Extraction state and provenance for URL or long text inputs.
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{
    sourceUrl?: string;
    modelId: string;
    requestId?: string;
  } | null>(null);

  // Input classification:
  // 1. URL input: standard HTTP/HTTPS link.
  // 2. Long text input: trimmed text longer than 240 chars or with 2+ sentence ends.
  const trimmedClaim = claim.trim();
  const isUrlInput = /^https?:\/\/\S+$/i.test(trimmedClaim);
  const sentenceEndMatches = (trimmedClaim.match(/[.!?](\s|$)/g) || []).length;
  const isLongText = !isUrlInput && (trimmedClaim.length > 240 || sentenceEndMatches >= 2);

  const extract = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const payload = isUrlInput
        ? { url: trimmedClaim }
        : { text: trimmedClaim };
      const response = await fetch("/api/extract-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        claims?: ExtractedClaimCandidate[];
        language?: string;
        claim?: string;
        sourceUrl?: string;
        modelId?: string;
        gonkaRequestId?: string;
        gatewayRequestId?: string;
        error?: string;
      };
      if (response.ok && data.claims && data.claims.length > 0) {
        setCandidates(data.claims);
        setSelectedIndex(0);
        setLanguage(data.language ?? "");
        setExtraction({
          sourceUrl: data.sourceUrl,
          modelId: data.modelId ?? "GonkaRouter",
          requestId: data.gonkaRequestId ?? data.gatewayRequestId,
        });
        return;
      }
      setExtractError(
        EXTRACT_ERRORS[data.error ?? ""]
          ?? (response.status === 429
            ? "Too many extractions right now; try again in a moment."
            : response.status === 404
              ? "No checkable claim found; state it as text instead."
              : "Could not extract a claim; state it as text instead."),
      );
    } catch {
      setExtractError("Could not reach the extraction service; state the claim as text instead.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUrlInput || isLongText) {
      await extract();
      return;
    }
    await submit({ claim });
  };

  const handleVerifySelected = async () => {
    const selected = candidates[selectedIndex];
    if (selected) {
      await submit({ claim: selected.claim });
    }
  };

  const handleEdit = () => {
    const selected = candidates[selectedIndex];
    if (selected) {
      setClaim(selected.claim);
    }
    // Clear candidate list so the form reappears for editing, while preserving provenance.
    setCandidates([]);
  };

  const handleStartOver = () => {
    setClaim("");
    setCandidates([]);
    setExtraction(null);
    setExtractError(null);
    setLanguage("");
  };

  // The counter warns near the limit that applies to the current mode.
  const claimTooLong = claim.length > (isLongText ? MAX_PASTE : MAX_CLAIM) * 0.9;

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-5 py-16 md:px-7 md:py-24">
      {/* Hero: explorer style, almost no words on screen. */}
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <h1 className="ov-display text-5xl text-ocean md:text-6xl">
          Verify any{" "}
          <span className="ov-wave-word">
            {/* Screen reader text replaces prohibited aria-label on plain span */}
            <span className="sr-only">claim</span>
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

        {/* Candidate list when extracted, or single input bar otherwise */}
        {candidates.length > 0 ? (
          <ClaimPicker
            candidates={candidates}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            language={language}
            onVerify={() => void handleVerifySelected()}
            onEdit={handleEdit}
            onStartOver={handleStartOver}
            submitting={submitting}
          />
        ) : (
          <>
            {/* The bar: one input, the button inside it, nothing else. */}
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
                // A long paste may run to the extraction limit; a single claim stays bounded.
                maxLength={isLongText ? MAX_PASTE : MAX_CLAIM}
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
                    {isUrlInput ? "Reading the page on Gonka…" : "Finding claims on Gonka…"}
                  </>
                ) : isUrlInput || isLongText ? (
                  <>
                    Find claims
                    <ArrowRight size="16" variant="Bold" />
                  </>
                ) : (
                  <>
                    Verify
                    <ArrowRight size="16" variant="Bold" />
                  </>
                )}
              </Button>
            </form>

            {/* Helper details only surface once the user starts typing. */}
            {claim.length > 0 && (
              <div className="flex items-start justify-between gap-3 px-1">
                <p className="text-[11px] text-muted-foreground">
                  {isUrlInput
                    ? "A page URL: the engine reads it on Gonka and proposes the checkable claim."
                    : isLongText
                      ? "A longer passage: extract distinct checkable claims or verify the text as written."
                      : "One falsifiable sentence with the who, what and when. Avoid opinions, predictions and compound claims. Or paste a page URL."}
                </p>
                <div className="flex shrink-0 items-center gap-2.5">
                  {isLongText && (
                    <button
                      type="button"
                      // Verification takes one bounded statement; longer pastes must be extracted.
                      disabled={submitting || extracting || claim.length > MAX_CLAIM}
                      title={claim.length > MAX_CLAIM ? `Longer than ${MAX_CLAIM} characters: find claims instead` : undefined}
                      onClick={() => void submit({ claim })}
                      className="text-[11px] font-medium text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    >
                      Verify as written
                    </button>
                  )}
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                      claimTooLong ? "text-unsure" : "text-muted-foreground",
                    )}
                  >
                    {claim.length}/{isLongText ? MAX_PASTE : MAX_CLAIM}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

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
              {extraction.sourceUrl ? (
                <span className="font-medium text-ocean">{hostOf(extraction.sourceUrl)}</span>
              ) : (
                <span className="font-medium text-ocean">Pasted text</span>
              )}{" "}
              by {extraction.modelId} on Gonka
              {extraction.requestId ? (
                <span className="font-mono"> · {extraction.requestId}</span>
              ) : null}
              . Edit freely, then Verify.
            </span>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <WeatherStrip />
          <p className="text-center text-[11px] text-muted-foreground">
            If one family is down, your claim queues and starts on the first clear probe.
          </p>
        </div>
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

"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
} from "iconsax-react";

function FactCheckContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state directly from URL query parameters
  const [claim, setClaim] = useState(() => searchParams.get("claim") || "");
  const [text, setText] = useState("");
  const [urls, setUrls] = useState<string[]>(() => {
    const urlParam = searchParams.get("url");
    return urlParam ? [urlParam] : [""];
  });
  const [resolutionCriteria, setResolutionCriteria] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEngineOffline, setIsEngineOffline] = useState(false);

  const addUrlField = () => {
    if (urls.length < 5) {
      setUrls([...urls, ""]);
    }
  };

  const updateUrl = (index: number, value: string) => {
    const updated = [...urls];
    updated[index] = value;
    setUrls(updated);
  };

  const removeUrl = (index: number) => {
    if (urls.length === 1) {
      setUrls([""]);
    } else {
      setUrls(urls.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsEngineOffline(false);

    const trimmedClaim = claim.trim();
    if (trimmedClaim.length < 5) {
      setErrorMessage("Claim statement must be at least 5 characters long.");
      return;
    }
    if (trimmedClaim.length > 1000) {
      setErrorMessage("Claim statement cannot exceed 1000 characters.");
      return;
    }

    const filteredUrls = urls
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    for (const u of filteredUrls) {
      if (!u.startsWith("https://") && !u.startsWith("http://")) {
        setErrorMessage(`Invalid URL '${u}': must start with https:// or http://`);
        return;
      }
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/fact-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: trimmedClaim,
          text: text.trim() || undefined,
          urls: filteredUrls,
          resolutionCriteria: resolutionCriteria.trim() || undefined,
        }),
      });

      if (res.status === 503) {
        setIsEngineOffline(true);
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.message || data.error || "Failed to submit fact-check");
        return;
      }

      if (data.claimId) {
        router.push(`/claims/${encodeURIComponent(data.claimId)}`);
      }
    } catch {
      setIsEngineOffline(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldSearch size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Direct Fact-Check Review
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Submit bounded factual claims and evidence URLs for decentralized multi-model AI deliberation. The protocol coordinates 5 distinct AI models (DeepSeek, Kimi, MiniMax) through cryptographic commit-reveal.
        </p>
      </div>

      {/* Engine Offline Warning (503 state) */}
      {isEngineOffline && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100">
          <Warning2 size="20" variant="Bold" className="text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold text-sm">
            Engine Backend Offline / Not Wired
          </AlertTitle>
          <AlertDescription className="text-xs space-y-2 mt-1">
            <p>
              The OpenVerdict verification engine backend is not currently connected (returned 503). In full deployment, this triggers an on-chain Move claim creation and schedules the 5-agent jury.
            </p>
            <p>
              You can test the client-side cryptographic commit-reveal and Truth Score recomputation on the{" "}
              <Link href="/verify" className="underline font-bold text-primary">
                Verify page
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Validation Error Alert */}
      {errorMessage && (
        <Alert variant="destructive">
          <Warning2 size="18" variant="Bold" />
          <AlertTitle className="text-sm font-semibold">Validation Error</AlertTitle>
          <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Main Submission Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6"
      >
        {/* Field 1: Factual Claim Statement */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="claim-text" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <span>Claim Statement</span>
              <span className="text-red-500">*</span>
            </label>
            <span className="text-xs font-mono text-muted-foreground">
              {claim.length}/1000 chars
            </span>
          </div>
          <Textarea
            id="claim-text"
            required
            placeholder="State the exact factual assertion to be verified (e.g. 'DeepSeek released the V4 model weights on August 15, 2026')..."
            className="min-h-[100px] text-sm focus-visible:ring-2 focus-visible:ring-primary"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            maxLength={1000}
          />
          <p className="text-[11px] text-muted-foreground">
            Clear, falsifiable, bounded assertions resolve fastest and achieve higher consensus.
          </p>
        </div>

        {/* Field 2: Admitted Source URLs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Link21 size="16" variant="Bold" className="text-muted-foreground" />
              <span>Evidence Source URLs (Up to 5)</span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addUrlField}
              disabled={urls.length >= 5}
              className="h-8 text-xs font-semibold"
            >
              <Add size="14" variant="Bold" className="mr-1" />
              Add URL
            </Button>
          </div>

          <div className="space-y-2">
            {urls.map((urlVal, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="url"
                  placeholder="https://example.com/press-release-or-doc"
                  className="text-xs h-10 font-mono"
                  value={urlVal}
                  onChange={(e) => updateUrl(index, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeUrl(index)}
                  className="h-10 w-10 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove URL"
                >
                  <Trash size="16" variant="Bold" />
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sources are crawled via SSRF-safe proxies, sanitized to plain text, and Merkle-frozen to Walrus decentralized storage.
          </p>
        </div>

        {/* Field 3: Optional Pasted Context / Text */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="context-text" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <DocumentText size="16" variant="Bold" className="text-muted-foreground" />
              <span>Pasted Context / Supporting Text (Optional)</span>
            </label>
            <span className="text-xs font-mono text-muted-foreground">
              {text.length}/20,000 chars
            </span>
          </div>
          <Textarea
            id="context-text"
            placeholder="Paste excerpts, article text, or background context to accompany the claim..."
            className="min-h-[90px] text-xs font-mono focus-visible:ring-2 focus-visible:ring-primary"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20000}
          />
        </div>

        {/* Field 4: Optional Resolution Criteria */}
        <div className="space-y-2">
          <label htmlFor="criteria-text" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Judge size="16" variant="Bold" className="text-muted-foreground" />
            <span>Resolution Criteria (Optional)</span>
          </label>
          <Input
            id="criteria-text"
            placeholder="e.g. 'Resolves YES if primary source documentation confirms the release before 23:59 UTC'..."
            className="text-xs h-10"
            value={resolutionCriteria}
            onChange={(e) => setResolutionCriteria(e.target.value)}
            maxLength={2000}
          />
          <p className="text-[11px] text-muted-foreground">
            If left blank, deterministic default criteria will be derived based on the claim statement.
          </p>
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <InfoCircle size="15" variant="Bold" className="shrink-0" />
            <span>No gas fees required for Direct Review submissions.</span>
          </div>

          <Button
            type="submit"
            disabled={submitting || !claim.trim()}
            className="w-full sm:w-auto min-h-[44px] px-8 font-semibold shadow-xs"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                Submitting Fact-Check...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span>Start Fact-Check</span>
                <ArrowRight size="16" variant="Bold" />
              </span>
            )}
          </Button>
        </div>
      </form>

      {/* Protocol Explanation Footer */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-5 space-y-3 text-xs text-muted-foreground">
        <h3 className="font-semibold text-foreground flex items-center gap-1.5">
          <Judge size="16" variant="Bold" className="text-primary" />
          How Direct Review Works
        </h3>
        <p className="leading-relaxed">
          Direct review bypasses optimistic disputation windows. The engine immediately locks the evidence manifest, selects 5 AI jurors across ≥3 distinct model families with native Sui randomness, and executes sealed commit-reveal deliberations.
        </p>
      </div>
    </div>
  );
}

export default function FactCheckPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-muted-foreground">Loading form...</div>}>
      <FactCheckContent />
    </Suspense>
  );
}

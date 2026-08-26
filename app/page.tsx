"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ClaimCard } from "@/components/claim/claim-card";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  ShieldSearch,
  Judge,
  DocumentText,
  Cpu,
  Lock,
  Unlock,
  ShieldTick,
  ArrowRight,
  InfoCircle,
  Activity,
  Award,
  Link21,
} from "iconsax-react";

export default function HomePage() {
  const router = useRouter();
  const [claimInput, setClaimInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [recentClaims, setRecentClaims] = useState<ClaimInspection[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function loadRecentClaims() {
      try {
        const res = await fetch("/api/claims");
        if (ignore) return;
        if (res.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!ignore) setRecentClaims(data.claims || []);
        }
      } catch {
        if (!ignore) setEngineOffline(true);
      } finally {
        if (!ignore) setLoadingClaims(false);
      }
    }
    loadRecentClaims();
    return () => {
      ignore = true;
    };
  }, []);

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimInput.trim()) return;

    const params = new URLSearchParams();
    params.set("claim", claimInput.trim());
    if (urlInput.trim()) {
      params.set("url", urlInput.trim());
    }
    router.push(`/fact-check?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-16 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* 1. Hero Section */}
      <section className="text-center space-y-6 max-w-4xl mx-auto pt-4 sm:pt-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3.5 py-1 text-xs font-semibold text-primary">
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] py-0 px-1.5"
          >
            Experimental
          </Badge>
          <span>Decentralized Intelligence Verification Engine</span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-[1.1]">
          Trustless Fact-Checking &amp; AI Jury Consensus on{" "}
          <span className="text-primary underline decoration-primary/30 underline-offset-8">
            Sui
          </span>
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          OpenVerdict coordinates diverse GonkaRouter AI models under cryptographic commit-reveal, preserving raw evidence on Walrus and settling deterministic Truth Scores on-chain.
        </p>

        {/* 2. Fast Fact-Check Entry Box */}
        <div className="max-w-2xl mx-auto pt-4 text-left">
          <form
            onSubmit={handleQuickSubmit}
            className="rounded-2xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-md hover:border-primary/40 transition-all space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ShieldSearch size="16" variant="Bold" className="text-primary" />
                Submit Claim for Direct Review
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">No Wallet Required</span>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="claim-statement" className="sr-only">
                  Claim statement
                </label>
                <Textarea
                  id="claim-statement"
                  placeholder="Enter a factual claim to verify (e.g., 'Sui network processed over 100M transactions during epoch 350')..."
                  className="min-h-[90px] resize-none text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary"
                  value={claimInput}
                  onChange={(e) => setClaimInput(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="source-url" className="sr-only">
                  Public source URL
                </label>
                <Input
                  id="source-url"
                  placeholder="Optional primary evidence source URL (https://...)"
                  className="text-sm h-11"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <InfoCircle size="13" variant="Bold" />
                <span>Submitted text &amp; URLs are permanently hashed to Walrus.</span>
              </div>

              <Button
                type="submit"
                disabled={!claimInput.trim()}
                className="w-full sm:w-auto min-h-[44px] px-6 font-semibold shadow-sm"
              >
                <ShieldSearch size="18" variant="Bold" className="mr-2" />
                Start Fact-Check
              </Button>
            </div>
          </form>
        </div>
      </section>

      {/* 3. How It Works Strip (5 Steps) */}
      <section className="space-y-6 pt-4">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            How OpenVerdict Works
          </h2>
          <p className="text-sm text-muted-foreground">
            A 5-phase deterministic pipeline ensuring tamper-proof AI deliberations.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Step 1 */}
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 relative flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <DocumentText size="20" variant="Bold" />
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">01. Retrieval</span>
              <h3 className="text-sm font-bold text-foreground">Evidence Freeze</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Public URLs and text are retrieved via SSRF-safe crawlers and frozen into an immutable Walrus Merkle root.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 relative flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Cpu size="20" variant="Bold" />
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">02. Inference</span>
              <h3 className="text-sm font-bold text-foreground">5-Model Jury</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                5 distinct AI models (DeepSeek, Kimi, MiniMax) independently review frozen evidence through GonkaRouter.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 relative flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Lock size="20" variant="Bold" />
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">03. Sealing</span>
              <h3 className="text-sm font-bold text-foreground">Blake2b-256 Commit</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Each juror submits an on-chain cryptographic commitment, preventing frontrunning and collusion.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 relative flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                <Unlock size="20" variant="Bold" />
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">04. Transparency</span>
              <h3 className="text-sm font-bold text-foreground">Cryptographic Reveal</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Votes and structured reasoning traces are revealed on Sui and verified against preimages.
              </p>
            </div>
          </div>

          {/* Step 5 */}
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 relative flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <ShieldTick size="20" variant="Bold" />
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground">05. Finality</span>
              <h3 className="text-sm font-bold text-foreground">On-Chain Settle</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                4-of-5 consensus mints a ResolutionCertificate with a deterministic Truth Score and releases payouts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Recent Claims Directory */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Activity size="22" variant="Bold" className="text-primary" />
              Recent Claims &amp; Fact-Checks
            </h2>
            <p className="text-xs text-muted-foreground">
              Live oracle claims and verified judgments.
            </p>
          </div>

          <Link href="/claims">
            <Button variant="outline" size="sm" className="min-h-[40px] text-xs font-semibold">
              <span>View All Claims</span>
              <ArrowRight size="14" variant="Bold" className="ml-1.5" />
            </Button>
          </Link>
        </div>

        {/* Claims Grid or Empty/Offline State */}
        {loadingClaims ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-xl border border-border/60 bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : engineOffline ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-3 bg-muted/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 mx-auto">
              <InfoCircle size="24" variant="Bold" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Engine Offline / Standalone Mode</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              The OpenVerdict verification engine backend is currently initializing. You can still test client-side cryptographic tools on the{" "}
              <Link href="/verify" className="text-primary underline font-medium">
                Verify Page
              </Link>{" "}
              or browse architectural documentation.
            </p>
          </div>
        ) : recentClaims.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-3 bg-muted/20">
            <h3 className="text-base font-semibold text-foreground">No Claims Created Yet</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Submit your first factual claim above to trigger an autonomous 5-model AI jury deliberation.
            </p>
            <Link href="/fact-check">
              <Button size="sm" className="min-h-[40px] font-semibold mt-2">
                Submit First Fact-Check
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recentClaims.slice(0, 6).map((claim) => (
              <ClaimCard key={claim.claimId} claim={claim} />
            ))}
          </div>
        )}
      </section>

      {/* 5. Key Architecture Guarantees Strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-border/60">
        <div className="p-5 rounded-xl border border-border/70 bg-card space-y-2">
          <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
            <Judge size="18" variant="Bold" className="text-primary" />
            <span>Collusion-Resistant Diversity</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Committees strictly enforce ≥3 distinct model families (DeepSeek, Kimi, MiniMax) and max 1 seat per human identity to prevent model bias.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-border/70 bg-card space-y-2">
          <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
            <Award size="18" variant="Bold" className="text-primary" />
            <span>Deterministic Truth Scores</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Consensus scores use pure integer half-up arithmetic over opened confidence ratings, treating UNSURE as an honest uncertainty metric.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-border/70 bg-card space-y-2">
          <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
            <Link21 size="18" variant="Bold" className="text-primary" />
            <span>Client-Side Verifiable</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every commitment, Merkle root, and Truth Score can be recomputed directly in your browser without trusting any server or oracle operator.
          </p>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClaimCard } from "@/components/claim/claim-card";
import {
  VerdictSpotlight,
  VerdictSpotlightSkeleton,
} from "@/components/claim/verdict-spotlight";
import { Pipeline } from "@/components/viz/pipeline";
import { StatTile } from "@/components/viz/stat-tile";
import { Reveal, Stagger } from "@/components/viz/reveal";
import { LiveDot } from "@/components/viz/live-dot";
import { JuryMarquee, type JuryMember } from "@/components/viz/jury-marquee";
import { SwarmGlobe, type SwarmClaim, type SwarmAgent } from "@/components/globe/swarm-globe";
import type { ClaimInspection } from "@/lib/engine/contract";
import {
  ShieldSearch,
  Judge,
  Cpu,
  ArrowRight,
  InfoCircle,
  Activity,
  Award,
  Link21,
  Lock,
  DocumentText,
  Warning2,
  type IconComponent,
} from "@/components/icons";

const GUARANTEES = [
  {
    icon: Judge,
    title: "Collusion-resistant diversity",
    body: "≥3 model families and one seat per human identity — no single vendor or operator steers a verdict.",
  },
  {
    icon: Award,
    title: "Deterministic Truth Scores",
    body: "Integer arithmetic over opened confidences; UNSURE is an honest signal, not a forced binary.",
  },
  {
    icon: Link21,
    title: "Client-side verifiable",
    body: "Recompute every commitment, Merkle root and Truth Score in your browser — no trusted server.",
  },
];

const TRUST_ROW = [
  { icon: DocumentText, label: "Evidence frozen on Walrus" },
  { icon: Lock, label: "Blake2b-256 commit-reveal" },
  { icon: Link21, label: "Settled on Sui" },
];

/** Shape of the read-only agent registry rows the hero narrates. */
type RegistryAgent = {
  agentProfileId: string;
  modelId: string;
  role: string;
  active: boolean;
};

export default function HomePage() {
  const router = useRouter();
  const reduce = useReducedMotion();

  const [claimInput, setClaimInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [recentClaims, setRecentClaims] = useState<ClaimInspection[]>([]);
  const [registry, setRegistry] = useState<RegistryAgent[]>([]);
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

  // The hero swarm names real registered jurors when the registry is reachable.
  useEffect(() => {
    let ignore = false;
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.agents) setRegistry(data.agents as RegistryAgent[]);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  /** Prefer a settled verdict for the hero exhibit; fall back to any live claim. */
  const spotlight = useMemo(
    () => recentClaims.find((c) => c.state >= 9 && c.result) ?? recentClaims[0] ?? null,
    [recentClaims],
  );

  /** Protocol-wide counters derived from the same read-only claim feed. */
  const stats = useMemo(() => {
    const seats = recentClaims.reduce((n, c) => n + (c.commitments?.length ?? 0), 0);
    const revealed = recentClaims.reduce(
      (n, c) => n + (c.commitments?.filter((s) => s.revealed).length ?? 0),
      0,
    );
    const scored = recentClaims
      .map((c) => c.result?.truthScoreBps)
      .filter((s): s is number => typeof s === "number");
    const avg = scored.length
      ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length / 100)
      : null;
    return { claims: recentClaims.length, seats, revealed, avg };
  }, [recentClaims]);

  /** Real claims, narrated by the globe HUD one per resolution cycle. */
  const swarmClaims = useMemo<SwarmClaim[]>(
    () =>
      recentClaims
        .filter((c) => c.statement)
        .slice(0, 6)
        .map((c) => ({
          id: c.claimId,
          statement: c.statement,
          score:
            typeof c.result?.truthScoreBps === "number"
              ? Math.round(c.result.truthScoreBps / 100)
              : null,
          label: c.result?.result ?? null,
        })),
    [recentClaims],
  );

  const swarmAgents = useMemo<SwarmAgent[]>(
    () => registry.map((a) => ({ role: a.role, model: a.modelId })),
    [registry],
  );

  const juryPool = useMemo<JuryMember[]>(
    () =>
      registry.map((a) => ({
        id: a.agentProfileId,
        role: a.role,
        model: a.modelId,
        active: a.active,
      })),
    [registry],
  );

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimInput.trim()) return;

    const params = new URLSearchParams();
    params.set("claim", claimInput.trim());
    if (urlInput.trim()) params.set("url", urlInput.trim());
    router.push(`/fact-check?${params.toString()}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* ---------------------------------------------------------------- Hero */}
      {/* One contained night slab. The rest of the product stays light. */}
      <section className="ov-slab relative isolate mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 sm:rounded-[2.25rem]">
        <div aria-hidden className="ov-slab-grid absolute inset-0" />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
        />

        <div className="relative grid gap-9 px-5 py-9 sm:px-8 sm:py-11 lg:grid-cols-12 lg:gap-x-10 lg:px-12 lg:py-14">
          {/* Headline */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0 space-y-5 lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:self-end"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 backdrop-blur-sm">
              <LiveDot tone="chain" />
              <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-sea uppercase">
                Gonka × Sui
              </span>
              <span className="hidden h-3 w-px bg-white/20 sm:block" aria-hidden />
              <span className="hidden text-[11px] font-medium text-night-muted sm:inline">
                Decentralized intelligence verification engine
              </span>
            </span>

            <h1 className="text-4xl leading-[1.06] font-semibold tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
              Fact-checking you can{" "}
              <span className="relative whitespace-nowrap text-sea">
                verify
                <svg
                  aria-hidden
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1.5 left-0 h-2.5 w-full text-sea/70"
                >
                  <path
                    d="M2 8 C 50 2, 150 2, 198 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              , not trust.
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-night-muted sm:text-lg">
              Five AI jurors from distinct model families review frozen evidence under
              commit-reveal. Verdicts settle on Sui with a deterministic Truth Score and an
              immutable certificate — every step reproducible.
            </p>
          </motion.div>

          {/* The swarm, live. min-w-0 keeps the canvas's intrinsic buffer width
              from inflating the grid column on narrow screens. */}
          <div className="min-w-0 lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:self-center">
            <SwarmGlobe
              claims={swarmClaims}
              agents={swarmAgents}
              className="mx-auto lg:-my-4 lg:max-w-none"
            />
          </div>

          {/* Fast fact-check entry */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduce ? 0 : 0.6,
              delay: reduce ? 0 : 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="min-w-0 space-y-5 lg:col-span-6 lg:col-start-1 lg:row-start-2"
          >
            <form
              onSubmit={handleQuickSubmit}
              className="space-y-4 rounded-2xl border border-white/12 bg-white/[0.045] p-5 backdrop-blur-md transition-colors focus-within:border-sea/45 sm:p-6"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-white uppercase">
                  <ShieldSearch size="14" variant="Bold" className="text-sea" />
                  Submit a claim for direct review
                </span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10px] text-night-muted">
                  No wallet required
                </span>
              </div>

              <div className="space-y-2.5">
                <label htmlFor="claim-statement" className="sr-only">
                  Claim statement
                </label>
                <Textarea
                  id="claim-statement"
                  placeholder="Enter a factual claim to verify — e.g. “Sui processed over 100M transactions during epoch 350”…"
                  className="ov-night-field min-h-[92px] resize-none text-sm"
                  value={claimInput}
                  onChange={(e) => setClaimInput(e.target.value)}
                />

                <label htmlFor="source-url" className="sr-only">
                  Public source URL
                </label>
                <Input
                  id="source-url"
                  placeholder="Optional primary evidence source URL (https://…)"
                  className="ov-night-field h-11 font-mono text-xs"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>

              <div className="flex flex-col items-stretch justify-between gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
                <p className="flex items-start gap-1.5 text-[11px] leading-snug text-night-muted">
                  <InfoCircle size="13" variant="Bold" className="mt-px shrink-0" />
                  Submitted text and URLs are permanently hashed to Walrus.
                </p>
                <Button
                  type="submit"
                  disabled={!claimInput.trim()}
                  className="min-h-[44px] w-full px-6 font-semibold shadow-lg shadow-sea/20 sm:w-auto"
                >
                  <ShieldSearch size="17" variant="Bold" />
                  Start fact-check
                </Button>
              </div>
            </form>

            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-night-muted">
              {TRUST_ROW.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5">
                  <item.icon size="13" variant="Bold" className="text-sea" />
                  {item.label}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------- Jury pool */}
      <JuryMarquee members={juryPool} className="mt-4" />

      {/* -------------------------------------------------- Live from chain */}
      <section className="pt-16">
        <Reveal className="mb-6 max-w-2xl">
          <span className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            <LiveDot tone="live" />
            Live from the engine
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ocean sm:text-3xl">
            Read straight off Sui, Walrus and the event log
          </h2>
        </Reveal>

        <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4" step={0.07}>
          <StatTile
            label="Claims indexed"
            value={stats.claims}
            icon={DocumentText}
            tone="primary"
            hint="Read from on-chain objects."
          />
          <StatTile
            label="Jury seats drawn"
            value={stats.seats}
            icon={Judge}
            tone="sealed"
            hint="Selected by Sui native randomness."
          />
          <StatTile
            label="Votes revealed"
            value={stats.revealed}
            icon={Activity}
            tone="yes"
            hint="Each opened against its sealed preimage."
          />
          <StatTile
            label="Mean Truth Score"
            value={stats.avg ?? "——"}
            unit={stats.avg === null ? undefined : "/100"}
            icon={Award}
            tone="chain"
            hint="Across settled certificates."
          />
        </Stagger>
      </section>

      {/* --------------------------------------- Verdict exhibit + guarantees */}
      {/* The finished output on the left, the rules that produced it on the
          right — the two halves are sized to read as one spread. */}
      <section className="grid gap-5 pt-16 lg:grid-cols-12">
        <div className="lg:col-span-4">
          {loadingClaims ? (
            <VerdictSpotlightSkeleton />
          ) : spotlight ? (
            <VerdictSpotlight claim={spotlight} />
          ) : (
            <div className="ov-edge flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card p-8 text-center">
              <span className="grid size-11 place-items-center rounded-xl bg-unsure/10 text-unsure">
                <Warning2 size="22" variant="Bold" />
              </span>
              <h3 className="text-sm font-semibold text-ocean">
                {engineOffline ? "Engine offline" : "No verdicts yet"}
              </h3>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                {engineOffline
                  ? "The verification engine is initializing. Client-side proof tools stay available on the verifier."
                  : "Submit the first claim to trigger an autonomous five-model jury deliberation."}
              </p>
              <Button asChild variant="outline" size="sm" className="min-h-[38px]">
                <Link href="/verify">Open independent verifier</Link>
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col lg:col-span-8">
          <Reveal className="mb-5">
            <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              Architecture guarantees
            </span>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ocean sm:text-3xl">
              What the protocol enforces for you
            </h2>
          </Reveal>

          <Stagger className="flex flex-1 flex-col gap-4" itemClassName="flex flex-1">
            {GUARANTEES.map((item, i) => (
              <div
                key={item.title}
                className="ov-edge ov-lift relative flex w-full items-center gap-5 overflow-hidden rounded-2xl border border-border bg-card p-6"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-sea/12 text-primary ring-1 ring-sea/20">
                  <item.icon size="24" variant="Bold" />
                </span>
                <div className="min-w-0 space-y-1.5">
                  <h3 className="text-base font-semibold text-ocean">{item.title}</h3>
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-5 hidden font-mono text-5xl font-semibold text-ocean/6 tabular-nums sm:block"
                >
                  0{i + 1}
                </span>
              </div>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---------------------------------------------------------- Pipeline */}
      <section className="pt-20">
        <Reveal className="mb-8 max-w-2xl">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            The pipeline
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ocean sm:text-3xl">
            Five deterministic phases, each one auditable
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            No step trusts the operator: evidence freezes before any model sees it, votes
            seal before any can copy another, and the score is arithmetic anyone can rerun.
          </p>
        </Reveal>

        <Pipeline />
      </section>

      {/* ----------------------------------------------------- Recent claims */}
      <section className="pt-20">
        <div className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-end">
          <div>
            <span className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              <LiveDot tone="live" />
              Live directory
            </span>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ocean">
              Recent claims &amp; fact-checks
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every indexed claim, with jury state and verdict.
            </p>
          </div>

          <Button asChild variant="outline" size="sm" className="min-h-[40px] font-semibold">
            <Link href="/claims">
              View all claims
              <ArrowRight size="14" variant="Bold" />
            </Link>
          </Button>
        </div>

        {loadingClaims ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="ov-edge h-[420px] animate-pulse rounded-2xl border border-border bg-card"
              />
            ))}
          </div>
        ) : engineOffline ? (
          <EmptyState
            icon={Warning2}
            title="Engine offline / standalone mode"
            body={
              <>
                The OpenVerdict verification engine backend is currently initializing. You can
                still test client-side cryptographic tools on the{" "}
                <Link href="/verify" className="font-medium text-primary hover:underline">
                  verifier page
                </Link>{" "}
                or browse the architecture documentation.
              </>
            }
          />
        ) : recentClaims.length === 0 ? (
          <EmptyState
            icon={InfoCircle}
            title="No claims created yet"
            body="Submit your first factual claim above to trigger an autonomous five-model AI jury deliberation."
            action={
              <Button asChild size="sm" className="min-h-[40px] font-semibold">
                <Link href="/fact-check">Submit first fact-check</Link>
              </Button>
            }
          />
        ) : (
          <Stagger
            className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
            itemClassName="h-full"
          >
            {recentClaims.slice(0, 6).map((claim) => (
              <ClaimCard key={claim.claimId} claim={claim} />
            ))}
          </Stagger>
        )}
      </section>

      {/* ------------------------------------------------------------- CTA */}
      {/* Bookends the page with the same night slab the hero opens on. */}
      <Reveal className="pt-16">
        <div className="ov-slab relative isolate overflow-hidden rounded-[1.75rem] border border-white/10 px-6 py-12 text-center sm:rounded-[2.25rem] sm:px-12">
          <div aria-hidden className="ov-slab-grid absolute inset-0" />
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
          />
          <div className="relative">
            <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-sea/15 text-sea ring-1 ring-sea/30">
              <Cpu size="22" variant="Bold" />
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Put a claim in front of the jury
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-night-muted">
              Evidence freezes, five jurors are drawn by on-chain randomness, and
              commit-reveal starts immediately.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="min-h-[44px] px-6 font-semibold shadow-lg shadow-sea/20">
                <Link href="/fact-check">
                  <ShieldSearch size="17" variant="Bold" />
                  Start a fact-check
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="min-h-[44px] border-white/20 bg-white/5 px-6 font-semibold text-white hover:bg-white/12 hover:text-white"
              >
                <Link href="/learn">How it works</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: IconComponent;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-unsure/10 text-unsure">
        <Icon size="22" variant="Bold" />
      </span>
      <h3 className="text-base font-semibold text-ocean">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

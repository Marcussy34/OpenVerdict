"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/viz/panel";
import { StatTile } from "@/components/viz/stat-tile";
import { StateBadge } from "@/components/claim/state-badge";
import { FeaturedVerifications } from "@/components/claim/featured-verifications";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { useNow } from "@/components/use-now";
import { Arrow } from "@/components/landing/primitives";
import { SuiMark, GonkaMark } from "@/components/brand/logos";
import {
  DocumentText,
  People,
  ShieldSearch,
  ShieldTick,
  Activity,
  Judge,
} from "@/components/icons";
import type { ClaimInspection } from "@/lib/engine/contract";

/** The console's own front door: what to do, and what the engine is doing. */
const DESKS = [
  {
    href: "/fact-check",
    icon: DocumentText,
    title: "Put a claim on trial",
    body: "Submit one bounded statement. Five jurors research it on the open web before the vote is sealed.",
  },
  {
    href: "/claims",
    icon: Judge,
    title: "Claims directory",
    body: "Every assertion the engine has indexed, from proposed through sealed deliberation to a settled certificate.",
  },
  {
    href: "/agents",
    icon: People,
    title: "Agent registry",
    body: "The registered jurors, their model families, and the stake behind each seat.",
  },
  {
    href: "/verify",
    icon: ShieldSearch,
    title: "Independent audit",
    body: "Recompute commitments and Truth Scores in your own browser. Nothing here calls the engine.",
  },
  {
    href: "/status",
    icon: Activity,
    title: "System status",
    body: "Sui deployment, GonkaRouter inference, Walrus storage and the indexing pipeline, live.",
  },
];

type RegistryAgent = { role: string; modelId: string; active: boolean };

export default function AppHomePage() {
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [network, setNetwork] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/claims")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.claims) setClaims(data.claims as ClaimInspection[]);
      })
      .catch(() => {});
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.agents) setAgents(data.agents as RegistryAgent[]);
      })
      .catch(() => {});
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && typeof data?.network === "string") setNetwork(data.network);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  // Every number here is counted off the read-only feed; nothing is synthesised.
  // Stranded discussion claims (window closed, no second round) are not "in
  // deliberation"; the clock comes from a hydration-safe store.
  const now = useNow();
  const stats = useMemo(() => {
    const settled = claims.filter((c) => c.state >= 9 && c.state !== 12).length;
    const running = claims.filter(
      (c) => c.state >= 3
        && c.state < 9
        && c.attemptChain?.status !== "VOIDED"
        && c.attemptChain?.status !== "GAVE_UP"
        && (now === null || !isStrandedDiscussion(c, now)),
    ).length;
    const seats = claims.reduce((n, c) => n + (c.commitments?.length ?? 0), 0);
    return { settled, running, seats, jurors: agents.filter((a) => a.active).length };
  }, [claims, agents, now]);

  const recent = claims.slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-5 py-10 md:px-7 lg:py-12">
      {/* Centered hero: the console reads as a dashboard, not a document. */}
      <div className="mx-auto max-w-2xl space-y-4 pt-4 text-center">
        <p className="ov-micro ov-micro-sm text-muted-foreground">
          Console · read-only
        </p>
        <h1 className="ov-display text-4xl text-ocean md:text-5xl">OpenVerdict</h1>
        <p className="text-base text-muted-foreground">
          An adversarial AI jury protocol on Sui. Every verdict public, auditable, replayable.
        </p>
        <div className="flex justify-center pt-1">
          <Link href="/fact-check" className="ov-btn">
            <span className="ov-btn__label ov-micro">Verify a claim</span>
            <span className="ov-btn__chip" aria-hidden>
              <Arrow />
            </span>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Claims settled" value={stats.settled} icon={ShieldTick} tone="yes" />
        <StatTile label="In deliberation" value={stats.running} icon={Judge} tone="sealed" />
        <StatTile label="Jury seats drawn" value={stats.seats} icon={People} tone="primary" />
        <StatTile label="Active jurors" value={stats.jurors} icon={Activity} tone="chain" />
      </div>

      {/* The desks. One card per thing a visitor can actually do. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DESKS.map((desk) => (
          <Link
            key={desk.href}
            href={desk.href}
            className="ov-lift group relative flex flex-col items-center border border-border bg-card p-6 text-center transition-colors hover:bg-surface"
          >
            <span
              aria-hidden
              className="absolute top-0 left-0 size-1.5 bg-[var(--ov-accent)]"
            />
            <span className="grid size-10 place-items-center bg-sea/12 text-primary">
              <desk.icon size="20" variant="Bold" />
            </span>
            <h2 className="mt-4 text-[19px] leading-snug font-medium tracking-[-0.01em]">
              {desk.title}
            </h2>
            <p className="mt-2 text-sm leading-[1.5] text-black/65">{desk.body}</p>
          </Link>
        ))}
      </div>

      <FeaturedVerifications claims={claims} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel label="Latest claims" icon={DocumentText} className="lg:col-span-2" flush>
          {recent.length === 0 ? (
            <p className="px-5 py-8 text-[15px] text-muted-foreground">
              No claims indexed yet. The first one submitted opens the docket.
            </p>
          ) : (
            <ul>
              {recent.map((claim) => (
                <li key={claim.claimId} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/claims/${encodeURIComponent(claim.claimId)}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] leading-snug">{claim.statement}</p>
                      <p className="ov-micro ov-micro-sm mt-1.5 truncate text-muted-foreground">
                        {claim.claimId}
                      </p>
                    </div>
                    <StateBadge
                      state={claim.state}
                      stranded={now !== null && isStrandedDiscussion(claim, now)}
                      attemptStatus={claim.attemptChain?.status}
                      size="sm"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel label="Running on" icon={ShieldTick}>
          <div className="space-y-5">
            <div>
              <span className="ov-micro ov-micro-sm block text-muted-foreground">
                Settled on
              </span>
              <p className="mt-1.5 flex items-center gap-2.5 text-[19px] leading-none font-medium tracking-[-0.01em]">
                <SuiMark brand className="size-[20px]" />
                Sui
                <span className="ov-micro ov-micro-sm text-muted-foreground">
                  {(network ?? "testnet").toUpperCase()}
                </span>
              </p>
            </div>
            <div>
              <span className="ov-micro ov-micro-sm block text-muted-foreground">
                Juries by
              </span>
              <p className="mt-1.5 flex items-center gap-2.5 text-[19px] leading-none font-medium tracking-[-0.01em]">
                <GonkaMark className="size-[19px]" />
                GonkaRouter
              </p>
            </div>
            <p className="text-[15px] leading-[1.5] text-black/65">
              Five jurors across at least three model families, drawn by Sui native
              randomness, deliberating under commit–reveal.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

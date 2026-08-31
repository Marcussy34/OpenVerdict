"use client";

import * as React from "react";
import Link from "next/link";
import { SplitButton, Eyebrow, CornerPin, Arrow } from "./primitives";
import { HeroVideo } from "./hero-video";
import { SuiMark, GonkaMark } from "@/components/brand/logos";
import type { ClaimInspection } from "@/lib/engine/contract";

/** Terminal states carry a settled outcome; anything lower is still running. */
function outcomeOf(claim: ClaimInspection) {
  return claim.result?.result ?? (claim.state >= 9 ? "UNRESOLVED" : "IN DELIBERATION");
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Section 1 — the night stage.
 *
 * The generated network instrument sits behind the copy and travels with the
 * existing hero-to-card dock choreography.
 */
export function Hero({
  latest,
}: {
  latest: ClaimInspection | null;
}) {
  return (
    <section
      id="top"
      className="ov-navy-ground ov-on-dark relative min-h-[100svh] overflow-hidden text-[#F3F3F3]"
    >
      {/* No column guides over the hero: the footage is the composition here,
          and a dashed vertical cutting through it reads as a stray line. The
          guides start with the section below. */}
      <HeroVideo />

      <div className="relative z-30 flex min-h-[100svh] flex-col px-5 pt-[86px] pb-7 md:px-7 md:pb-8 lg:justify-between lg:pt-[104px]">
        {/* Headline — exits left as the shrink begins (data-hero-exit). */}
        <div data-hero-exit="left" className="max-w-[520px]">
          <h1 className="ov-display text-[clamp(2.75rem,9vw,5.5rem)]">
            Agentic
            <br />
            Resolution
          </h1>
          {/* Stacked and flush: a fit-content grid column sizes to the wider
              button (the one carrying the arrow chip) and the other stretches
              to meet it, so both rows end on the same edge. */}
          <div className="mt-6 grid w-fit gap-[2px] lg:mt-7">
            <SplitButton href="/fact-check" stretch>
              Submit a claim
            </SplitButton>
            <SplitButton href="/claims" tone="dark" chip={false} stretch>
              Watch live claims
            </SplitButton>
          </div>
        </div>

        {/* Ground row: provenance · blurb · latest claim — fades down and out. */}
        <div
          data-hero-exit="ground"
          className="mt-10 grid gap-7 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-5"
        >
          {/* Provenance, both halves of it. The exact network is stated in the
              footer and on /status; here it is just the two names. */}
          <div className="grid gap-4 lg:col-span-3">
            <div>
              <Eyebrow className="text-[#F3F3F3]/50">Settled on</Eyebrow>
              <p className="mt-1.5 flex items-center gap-2 text-[19px] leading-none font-medium tracking-[-0.01em]">
                {/* The official Sui mark, in Sui's own blue against the night stage. */}
                <SuiMark brand className="size-[20px]" />
                Sui
              </p>
            </div>
            <div>
              <Eyebrow className="text-[#F3F3F3]/50">Powered by</Eyebrow>
              <p className="mt-1.5 flex items-center gap-2 text-[19px] leading-none font-medium tracking-[-0.01em]">
                <GonkaMark className="size-[19px]" />
                GonkaRouter
              </p>
            </div>
          </div>

          {/* The reference's hero blurb (Archivo 19px / 500 / lh 25.65px /
              #F3F3F3); widened from the measured 409px to 480px so the Gonka
              line fits in four rows (owner request, 2026-08-31). */}
          <p className="max-w-[480px] text-[19px] leading-[25.65px] font-medium text-[#F3F3F3] lg:col-span-5">
            Five AI jurors from distinct model families research and cite each
            claim on Gonka&apos;s decentralized inference network, then vote
            under commit-reveal. Sui settles a recomputable Truth Score and an
            immutable certificate.
          </p>

          <div className="lg:col-span-4">
            <LatestVerdictCard latest={latest} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The hero's live exhibit — the newest claim the read-only feed knows about. */
function LatestVerdictCard({ latest }: { latest: ClaimInspection | null }) {
  if (!latest) {
    return (
      <div className="ov-glass relative w-full p-5">
        <CornerPin className="top-0 left-0" />
        <Eyebrow className="text-[#F3F3F3]/50">Latest verdict</Eyebrow>
        <p className="mt-2 text-[15px] leading-snug text-[#F3F3F3]/75">
          No verdicts yet. The first claim submitted opens the docket.
        </p>
      </div>
    );
  }

  const settledAt = latest.deadlines?.secondRevealDeadlineMs;

  return (
    <Link
      href={`/claims/${encodeURIComponent(latest.claimId)}`}
      className="ov-glass group relative flex w-full items-center gap-4 p-5 transition-colors hover:bg-[rgba(38,38,41,0.62)]"
    >
      <CornerPin className="top-0 left-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow className="text-[#F3F3F3]/50">Latest verdict</Eyebrow>
          <span className="ov-micro ov-micro-sm text-[#F3F3F3]/40">
            {settledAt
              ? new Date(settledAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : ""}
          </span>
        </div>
        <p className="mt-2 text-[15px] leading-snug text-[#F3F3F3]/85">
          {truncate(latest.statement, 84)}
        </p>
        <p className="ov-micro ov-micro-sm mt-2 text-[var(--ov-accent)]">
          {outcomeOf(latest)}
          {typeof latest.result?.truthScoreBps === "number" &&
            ` · ${Math.round(latest.result.truthScoreBps / 100)}/100`}
        </p>
      </div>
      <span className="grid size-[34px] shrink-0 place-items-center bg-[rgba(238,238,240,0.12)] text-[#F3F3F3] transition-colors group-hover:bg-[var(--ov-accent)]">
        <Arrow />
      </span>
    </Link>
  );
}

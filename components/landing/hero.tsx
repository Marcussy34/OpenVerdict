"use client";

import * as React from "react";
import Link from "next/link";
import { SplitButton, Eyebrow, CornerPin, GridGuides, Arrow } from "./primitives";
import { SuiMark } from "@/components/brand/logos";
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
 * The globe renders inline and scrolls away with the page like any other
 * content — no scroll choreography.
 */
export function Hero({
  latest,
  network,
  children,
}: {
  latest: ClaimInspection | null;
  network: string | null;
  /** The globe. */
  children?: React.ReactNode;
}) {
  return (
    <section
      id="top"
      className="ov-navy-ground ov-on-dark relative min-h-[100svh] overflow-hidden text-[#F3F3F3]"
    >
      <GridGuides columns={3} dark className="hidden md:block" />

      <div className="relative z-30 flex min-h-[100svh] flex-col px-5 pt-[86px] pb-7 md:px-7 md:pb-8 lg:justify-between lg:pt-[104px]">
        {/* The globe's footprint. It stacks above the type on small screens and
            floats behind it, centre-right, from lg up. */}
        <div className="pointer-events-none relative mx-auto aspect-square w-full max-w-[300px] shrink-0 sm:max-w-[380px] lg:absolute lg:top-1/2 lg:left-[63%] lg:mx-0 lg:w-[40vw] lg:max-w-[540px] lg:-translate-x-1/2 lg:-translate-y-1/2">
          {children}
        </div>

        {/* Headline — exits left as the shrink begins (data-hero-exit). */}
        <div data-hero-exit="left" className="mt-6 max-w-[520px] lg:mt-0">
          <h1 className="ov-display text-[clamp(2.75rem,9vw,5.5rem)]">
            Agentic
            <br />
            Resolution
          </h1>
          {/* Stacked, not side by side — the second CTA sits under the first. */}
          <div className="mt-6 flex flex-col items-start gap-[2px] lg:mt-7">
            <SplitButton href="#submit">Submit a claim</SplitButton>
            <SplitButton href="/claims" tone="dark" chip={false}>
              Watch live claims
            </SplitButton>
          </div>
        </div>

        {/* Ground row: provenance · blurb · latest claim — fades down and out. */}
        <div
          data-hero-exit="ground"
          className="mt-10 grid gap-7 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-5"
        >
          <div className="lg:col-span-3">
            <Eyebrow className="text-[#F3F3F3]/50">Settled on</Eyebrow>
            <p className="mt-1.5 flex items-center gap-2 text-[19px] leading-none font-medium tracking-[-0.01em]">
              {/* The official Sui mark, in Sui's own blue against the night stage. */}
              <SuiMark brand className="size-[20px]" />
              <span>
                Sui{" "}
                <span className="text-[#F3F3F3]/55">
                  {(network ?? "testnet").toUpperCase()}
                </span>
              </span>
            </p>
          </div>

          {/* The reference's hero blurb, measured off the live site:
              Archivo 19px / 500 / lh 25.65px / #F3F3F3 / max-width 409px. */}
          <p className="max-w-[409px] text-[19px] leading-[25.65px] font-medium text-[#F3F3F3] lg:col-span-5">
            Five AI jurors from distinct model families review frozen evidence under
            commit-reveal. Verdicts settle on Sui with a deterministic Truth Score and
            an immutable certificate — every step reproducible.
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
          No verdicts yet — the first claim submitted below opens the docket.
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

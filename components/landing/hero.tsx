"use client";

import * as React from "react";
import Link from "next/link";
import { SplitButton, Eyebrow, CornerPin, GridGuides, Arrow } from "./primitives";
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
 * The globe itself is NOT rendered here: the page owns one instance and either
 * parks it over `heroSlotRef` or docks it into the stat card below. This
 * section only reserves the space and prints the type over it.
 */
export function Hero({
  heroSlotRef,
  plateVisible,
  latest,
  network,
  children,
}: {
  heroSlotRef: React.RefObject<HTMLDivElement | null>;
  /** The poster plate stands in while the globe lives in the docking layer. */
  plateVisible: boolean;
  latest: ClaimInspection | null;
  network: string | null;
  /** The globe itself, when it is NOT riding the docking layer. */
  children?: React.ReactNode;
}) {
  return (
    // No `isolate` on the section: the docking layer (z-20) has to paint above
    // this ground but below the z-30 type printed over it.
    <section
      data-header-theme="dark"
      id="top"
      className="ov-navy-ground ov-on-dark relative min-h-[100svh] overflow-hidden text-[#F3F3F3]"
    >
      <GridGuides columns={3} dark className="hidden md:block" />

      {/* Thin wireframe frames echoing the reference's overlay geometry. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <span className="absolute top-[18%] left-[46%] size-[17vw] max-h-[240px] max-w-[240px] border border-[#F3F3F3]/20" />
        <span className="absolute top-[40%] left-[58%] size-[13vw] max-h-[190px] max-w-[190px] border border-[#F3F3F3]/12" />
        <span className="absolute top-[56%] left-[44%] size-[15vw] max-h-[210px] max-w-[210px] border border-[#F3F3F3]/10" />
      </div>

      <div className="relative z-30 flex min-h-[100svh] flex-col px-5 pt-[86px] pb-7 md:px-7 md:pb-8 lg:justify-between lg:pt-[104px]">
        {/* The globe's footprint. It stacks above the type on small screens and
            floats behind it, centre-right, from lg up. */}
        <div
          ref={heroSlotRef}
          className="pointer-events-none relative mx-auto aspect-square w-full max-w-[300px] shrink-0 sm:max-w-[380px] lg:absolute lg:top-1/2 lg:left-[63%] lg:mx-0 lg:w-[40vw] lg:max-w-[540px] lg:-translate-x-1/2 lg:-translate-y-1/2"
        >
          {plateVisible && (
            <div aria-hidden className="absolute inset-0 grid place-items-center">
              <div className="ov-globe-plate size-[74%] rounded-full" />
            </div>
          )}
          {children}
        </div>

        {/* Headline */}
        <div className="mt-6 max-w-[520px] lg:mt-0">
          <h1 className="ov-display text-[clamp(2.75rem,9vw,5.5rem)]">
            Agentic
            <br />
            Resolution
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-[2px] gap-y-2 lg:mt-7">
            <SplitButton href="#submit">Submit a claim</SplitButton>
            <SplitButton href="/claims" tone="dark" chip={false}>
              Watch live claims
            </SplitButton>
          </div>
        </div>

        {/* Ground row: provenance · blurb · the most recent settled claim */}
        <div className="mt-10 grid gap-7 lg:mt-16 lg:grid-cols-12 lg:items-end lg:gap-5">
          <div className="lg:col-span-3">
            <Eyebrow className="text-[#F3F3F3]/50">Settled on</Eyebrow>
            <p className="mt-1.5 text-[19px] leading-none font-medium tracking-[-0.01em]">
              Sui{" "}
              <span className="text-[#F3F3F3]/55">
                {(network ?? "testnet").toUpperCase()}
              </span>
            </p>
          </div>

          <p className="max-w-[430px] text-[15px] leading-[1.45] text-[#F3F3F3]/80 lg:col-span-5">
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

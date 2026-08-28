"use client";

import * as React from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { CornerPin, GridGuides, Hairline, ArrowUp, Eyebrow } from "./primitives";
import { ClaimForm } from "./claim-form";
import { SuiMark, GonkaMark } from "@/components/brand/logos";
import { useScrollFrame, clamp01, ease } from "./scroll-driver";

const NAVIGATION = [
  { href: "/", label: "Home" },
  { href: "/claims", label: "Claims" },
  { href: "/agents", label: "Agents" },
  { href: "/verify", label: "Verify" },
  { href: "/status", label: "Status" },
];

const REPO = "https://github.com/Marcussy34/OpenVerdict";

const LEGAL = [
  { href: "/terms", label: "Terms of use" },
  { href: "/privacy", label: "Privacy notice" },
  { href: "/risk", label: "Risk disclosure" },
];

/**
 * Section 9 — the deep-blue close.
 *
 * Carries the real claim form, the site's own links, and the giant wordmark
 * that rises into place as the footer scrolls in (static under reduced motion,
 * since the ride is driven from the shared scroll loop).
 */
export function LandingFooter({
  network,
  packageId,
}: {
  network: string | null;
  packageId: string | null;
}) {
  const markRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useScrollFrame(
    ({ scrollY, vh }) => {
      const mark = markRef.current;
      if (!mark) return;
      // The wordmark is the last thing on the page, so its ride is measured
      // against the remaining scroll: it lands exactly as the page bottoms out.
      const remaining = document.documentElement.scrollHeight - vh - scrollY;
      const p = ease(clamp01(1 - remaining / Math.max(1, vh * 0.8)));
      mark.style.transform = `translate3d(0, ${(1 - p) * 35}%, 0)`;
    },
    !reduce,
  );

  // Testnet and mainnet ids are browsable; a local chain's are not.
  const explorer =
    packageId && (network === "testnet" || network === "mainnet")
      ? `https://suiscan.xyz/${network}/object/${packageId}`
      : null;

  const resources = [
    { href: REPO, label: "GitHub repository" },
    { href: `${REPO}/blob/main/docs/demo/runbook.md`, label: "Demo runbook" },
    ...(explorer ? [{ href: explorer, label: "Sui explorer · package" }] : []),
    { href: "https://gonkarouter.io", label: "GonkaRouter" },
  ];

  return (
    <footer
      id="submit"
      data-header-theme="dark"
      className="ov-footer-ground ov-on-dark relative z-30 isolate overflow-hidden text-[#F3F3F3]"
    >
      <GridGuides columns={3} dark className="hidden md:block" />

      <div className="relative z-10 px-5 pt-24 md:px-7 md:pt-28">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-7">
          {/* The claim form */}
          <div className="relative lg:col-span-5">
            <CornerPin className="-top-6 left-0" />
            <h2 className="text-[19px] leading-snug font-medium tracking-[-0.01em]">
              Put a claim on trial:
            </h2>
            <div className="mt-5">
              <ClaimForm />
            </div>

            <div className="mt-12">
              {/* Both marks in the page's own ink — the provenance line reads as
                  one sentence, not as two pasted logos. */}
              <Eyebrow className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[#F3F3F3]/60">
                <SuiMark className="size-[15px]" />
                Settled on Sui {(network ?? "testnet").toUpperCase()}
                <span aria-hidden className="text-[#F3F3F3]/30">·</span>
                <GonkaMark className="size-[14px]" />
                Juries by GonkaRouter
              </Eyebrow>
              <p className="ov-micro ov-micro-sm mt-2 text-[#F3F3F3]/45">
                MIT License · experimental software · unaudited Move contracts
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="grid gap-10 sm:grid-cols-2 lg:col-span-6 lg:col-start-7 lg:grid-cols-3">
            <FooterColumn heading="Navigation">
              {NAVIGATION.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-opacity hover:opacity-70">
                    {item.label}
                  </Link>
                </li>
              ))}
            </FooterColumn>

            <FooterColumn heading="Resources">
              {resources.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-opacity hover:opacity-70"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </FooterColumn>

            <div className="flex items-start justify-start lg:justify-end">
              <a
                href="#top"
                className="group flex items-center gap-3"
                aria-label="Back to top"
              >
                <span className="ov-micro text-[#F3F3F3]/70">Back to top</span>
                <span className="grid size-[34px] place-items-center bg-[rgba(238,238,240,0.12)] transition-colors group-hover:bg-[var(--ov-accent)]">
                  <ArrowUp />
                </span>
              </a>
            </div>
          </div>
        </div>

        <Hairline dark className="mt-16" />

        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="ov-micro ov-micro-sm text-[#F3F3F3]/60 underline-offset-4 hover:underline"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="ov-micro ov-micro-sm text-[#F3F3F3]/45">
            © 2026 OpenVerdict contributors
          </p>
        </div>
      </div>

      {/* The wordmark: sized to the full gutter width, cropped by the section's
          bottom edge, and riding up into place with the footer's scroll. */}
      <div className="relative mt-2 h-[8.6vw] min-h-[46px] overflow-hidden">
        <div ref={markRef} className="will-change-transform">
          <p
            aria-hidden
            className="ov-wordmark ov-display -mt-[0.05em] text-center text-[17.6vw] leading-[0.78] font-medium whitespace-nowrap"
          >
            OpenVerdict
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="ov-micro text-[#F3F3F3]/60">{heading}</h3>
      <ul className="mt-4 space-y-2.5 text-[17px] leading-snug">{children}</ul>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { CornerPin, GridGuides, Hairline, ArrowUp, Eyebrow } from "./primitives";
import { SuiMark, GonkaMark } from "@/components/brand/logos";
import { DOCS_URL } from "@/lib/web/site-urls";
import { useScrollFrame, clamp01 } from "./scroll-driver";

// Same labels as the site header, in the same order: "Verify" is claim
// submission at /fact-check, and the independent run auditor at /verify is
// "Audit". The footer used to call /verify "Verify" and omit /fact-check, so
// the two nav lists disagreed about what the word meant.
const NAVIGATION = [
  { href: "/", label: "Home" },
  { href: "/fact-check", label: "Verify" },
  { href: "/claims", label: "Claims" },
  { href: "/agents", label: "Agents" },
  { href: "/verify", label: "Audit" },
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
 * Carries the provenance statement, the site's own links, and the giant wordmark
 * that rises into place as the footer scrolls in (static under reduced motion,
 * since the ride is driven from the shared scroll loop).
 */
export function LandingFooter() {
  const markRef = React.useRef<HTMLDivElement>(null);
  const bandRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // It closes every page now, so it reads its own deployment rather than being
  // handed one.
  const [network, setNetwork] = React.useState<string | null>(null);
  const [packageId, setPackageId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let ignore = false;
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (ignore || !data) return;
        if (typeof data.network === "string") setNetwork(data.network);
        if (typeof data.packageId === "string") setPackageId(data.packageId);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  useScrollFrame(
    ({ scrollY, vh }) => {
      const band = bandRef.current;
      const mark = markRef.current;
      if (!band || !mark) return;
      // The band is the crop the wordmark shows through, and it is pinned to
      // the page's bottom edge, so its lower half is always off screen while
      // there is scroll left. Left alone, the scroll would just uncover the
      // type from the top down, which is why it read as already landed rather
      // than arriving.
      // So the type climbs the band FASTER than the page scrolls: LIFT 2 puts
      // it at 1.5x, which is what makes it rise out of the bottom edge. The
      // reveal takes the last (LIFT / (1 + LIFT)) of a band height of scroll,
      // and it costs the footer no extra height at all.
      // Linear, like every other scrub on this page: stop means stop. The last
      // of the travel lands on the last of the scroll.
      const LIFT = 2;
      const remaining = document.documentElement.scrollHeight - vh - scrollY;
      const p = clamp01(1 - remaining / Math.max(1, band.clientHeight * LIFT));
      mark.style.transform = `translate3d(0, ${((1 - p) * band.clientHeight).toFixed(1)}px, 0)`;
    },
    !reduce,
  );

  // SuiVision keeps the network in the host, so mainnet is the bare domain.
  const explorerHost =
    network === "mainnet" ? "https://suivision.xyz" : "https://testnet.suivision.xyz";
  // Testnet and mainnet ids are browsable; a local chain's are not.
  const explorer =
    packageId && (network === "testnet" || network === "mainnet")
      ? `${explorerHost}/object/${packageId}`
      : null;

  const resources = [
    // Its own host when NEXT_PUBLIC_DOCS_URL names one, otherwise /docs here.
    { href: DOCS_URL, label: "Docs" },
    { href: REPO, label: "GitHub repository" },
    { href: `${REPO}/blob/main/docs/demo/runbook.md`, label: "Demo runbook" },
    // Always one row: the link fills in when /api/status answers, so the
    // footer never grows after first paint (that growth was a 0.35 layout shift).
    { href: explorer ?? "https://testnet.suivision.xyz", label: "Sui explorer · package" },
    { href: "https://gonkarouter.io", label: "GonkaRouter" },
  ];

  return (
    <footer
      data-header-theme="dark"
      className="ov-footer-ground ov-on-dark relative z-30 isolate overflow-hidden text-[#F3F3F3]"
    >
      <GridGuides columns={3} dark className="hidden md:block" />

      <div className="relative z-10 px-5 pt-24 md:px-7 md:pt-28">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-7">
          {/* Provenance, at the size it deserves — this column is the whole
              statement of what the verdicts run on and settle to. */}
          <div className="relative lg:col-span-5">
            <CornerPin className="-top-6 left-0" />
            <div className="grid gap-9">
              <div>
                <Eyebrow className="text-[#F3F3F3]/50">Settled on</Eyebrow>
                <p className="ov-display mt-3 flex items-center gap-3.5 text-[clamp(1.9rem,3.4vw,2.75rem)]">
                  <SuiMark brand className="size-[0.85em]" />
                  Sui
                </p>
              </div>
              <div>
                <Eyebrow className="text-[#F3F3F3]/50">Powered by</Eyebrow>
                <p className="ov-display mt-3 flex items-center gap-3.5 text-[clamp(1.9rem,3.4vw,2.75rem)]">
                  <GonkaMark className="size-[0.8em]" />
                  GonkaRouter
                </p>
              </div>
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
                    // Docs stay in the tab when they are served from this
                    // deployment; every other resource is another site.
                    {...(item.href.startsWith("http")
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
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

      {/* The wordmark: sized to the full gutter width, cropped by the page's
          bottom edge, and climbing into place with the footer's scroll.
          13.4vw shows 75% of the word's ink: the type's ink runs 15.8vw and
          starts 1.6vw down from the band's top edge. The min-height is a
          legibility floor, not a crop, and only binds under ~440px wide. */}
      <div ref={bandRef} className="relative mt-2 h-[13.4vw] min-h-[59px] overflow-hidden">
        <div ref={markRef} className="will-change-transform">
          <p
            aria-hidden
            className="ov-wordmark ov-display -mt-[0.05em] text-center text-[17.6vw] leading-[0.78] font-medium whitespace-nowrap"
          >
            OpenVerdict
          </p>
        </div>
      </div>

      {/* The wordmark ramps out of focus as it meets the page's bottom edge,
          the mirror of the header's .ov-top-blur. Anchored to the footer
          rather than the viewport, so nothing blurs until the page bottoms
          out. Last child so it sits over the band it softens. */}
      <div aria-hidden className="ov-bottom-blur">
        <span />
        <span />
        <span />
        <span />
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
      {/* Use h2 to avoid skipping heading levels under the page h1 */}
      <h2 className="ov-micro text-[#F3F3F3]/60">{heading}</h2>
      <ul className="mt-4 space-y-2.5 text-[17px] leading-snug font-medium">{children}</ul>
    </div>
  );
}

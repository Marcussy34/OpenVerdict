"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InfoCircle } from "@/components/icons";
import { BrandMark } from "@/components/site-header";
import { Hairline } from "@/components/landing/primitives";

const COLUMNS = [
  {
    heading: "Protocol",
    links: [
      { href: "/fact-check", label: "Direct fact-check" },
      { href: "/claims", label: "Claims directory" },
      { href: "/agents", label: "Agent registry" },
      { href: "/verify", label: "Independent verifier" },
      { href: "/status", label: "System status" },
    ],
  },
  {
    heading: "Transparency",
    links: [
      { href: "/learn", label: "How it works" },
      { href: "/risk", label: "Risk disclosure" },
      { href: "/terms", label: "Terms of use" },
      { href: "/privacy", label: "Privacy notice" },
    ],
  },
];

export function SiteFooter() {
  // The landing page ends in its own deep-blue footer (claim form + wordmark),
  // so the shared product footer stands down there.
  if (usePathname() === "/") return null;

  return (
    <footer className="mt-auto w-full border-t border-[var(--ov-line)] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 pb-10 md:grid-cols-4">
          {/* Brand & security boundary */}
          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center gap-2.5 text-black">
              <BrandMark size={26} />
              <span className="text-[19px] leading-none font-medium tracking-[-0.01em]">
                OpenVerdict
              </span>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              GonkaRouter AI juries, settled on Sui under commit-reveal, evidence
              preserved on Walrus.
            </p>
            <div className="flex max-w-md items-start gap-2.5 border border-[var(--ov-line)] bg-[var(--ov-surface)] p-3">
              <InfoCircle
                size="16"
                variant="Bold"
                className="mt-0.5 shrink-0 text-primary"
                aria-hidden
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                <strong className="font-semibold text-ocean">Engine-first architecture.</strong>{" "}
                This dashboard is a read-only projection of on-chain objects, Walrus
                blobs and public events.
              </p>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading} className="space-y-3">
              <h2 className="ov-micro ov-micro-sm text-black">{column.heading}</h2>
              <ul className="space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Hairline />

        <div className="flex flex-col items-start justify-between gap-3 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>
            © 2026 Marcussy34 and OpenVerdict contributors. Released under the{" "}
            <span className="font-medium text-ocean">MIT License</span>.
          </p>
          <p className="ov-micro ov-micro-sm inline-flex items-center gap-2 border border-unsure/25 bg-unsure/8 px-2.5 py-1 text-unsure">
            <span className="size-1.5 bg-unsure" aria-hidden />
            Experimental software — capped demo funds — unaudited Move contracts
          </p>
        </div>
      </div>
    </footer>
  );
}

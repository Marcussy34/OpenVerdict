"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Judge,
  ShieldSearch,
  DocumentText,
  Profile2User,
  ShieldTick,
  Activity,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/fact-check", label: "Fact-Check", icon: ShieldSearch },
  { href: "/claims", label: "Claims", icon: DocumentText },
  { href: "/agents", label: "Agents", icon: Profile2User },
  { href: "/verify", label: "Verify", icon: ShieldTick },
  { href: "/status", label: "Status", icon: Activity },
];

/** The OpenVerdict mark: a Sui-blue plate carrying the jury glyph. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl text-white shadow-[0_2px_8px_-2px_rgba(15,111,214,0.55)] ring-1 ring-inset ring-white/25"
      style={{
        width: size,
        height: size,
        backgroundImage: "linear-gradient(140deg, var(--brand-sea), var(--brand-sea-strong))",
      }}
    >
      <Judge size={String(Math.round(size * 0.55))} variant="Bold" />
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  // The sheet is keyed to the route it was opened on, so navigating away closes
  // it without an effect that would fight React's render pass.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const mobileMenuOpen = openedOnPath === pathname;
  const toggleMobileMenu = () =>
    setOpenedOnPath((prev) => (prev === pathname ? null : pathname));

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Brand & wordmark */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="OpenVerdict home"
        >
          <BrandMark />
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-tight text-ocean">
              OpenVerdict
            </span>
            <span className="mt-0.5 font-mono text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Verification engine
            </span>
          </span>
        </Link>

        {/* Desktop navigation — one pill rail, active item filled with brand tint. */}
        <nav className="hidden items-center gap-0.5 rounded-full border border-border bg-card/70 p-1 lg:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "bg-sea/12 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-surface hover:text-ocean",
                )}
              >
                <Icon size="15" variant={active ? "Bold" : "Linear"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right CTA & mobile hamburger */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            size="sm"
            className="hidden min-h-[38px] px-4 font-semibold shadow-xs xl:inline-flex"
          >
            <Link href="/fact-check">
              <ShieldSearch size="15" variant="Bold" />
              Start fact-check
            </Link>
          </Button>

          <WalletConnectButton />

          <Button
            variant="outline"
            size="sm"
            className="min-h-[40px] min-w-[40px] p-2 lg:hidden"
            onClick={toggleMobileMenu}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            <span className="sr-only">Toggle menu</span>
            <span className="flex w-4 flex-col gap-1">
              <span
                className={cn(
                  "block h-0.5 w-full rounded-full bg-ocean transition-transform duration-200",
                  mobileMenuOpen && "translate-y-1.5 rotate-45",
                )}
              />
              <span
                className={cn(
                  "block h-0.5 w-full rounded-full bg-ocean transition-opacity duration-200",
                  mobileMenuOpen && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "block h-0.5 w-full rounded-full bg-ocean transition-transform duration-200",
                  mobileMenuOpen && "-translate-y-1.5 -rotate-45",
                )}
              />
            </span>
          </Button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="space-y-1 border-b border-border bg-card px-4 pt-2 pb-4 lg:hidden">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-[15px] font-medium",
                  active
                    ? "bg-sea/12 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-surface hover:text-ocean",
                )}
              >
                <Icon size="18" variant={active ? "Bold" : "Linear"} />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/learn"
            className="flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-[15px] font-medium text-muted-foreground hover:bg-surface hover:text-ocean"
          >
            <Judge size="18" variant="Linear" />
            How it works
          </Link>
          <div className="pt-2">
            <Button asChild className="min-h-[44px] w-full justify-center font-semibold">
              <Link href="/fact-check">
                <ShieldSearch size="18" variant="Bold" />
                Start fact-check
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

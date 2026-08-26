"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Judge, ShieldSearch, DocumentText, Profile2User, ShieldTick, Activity } from "iconsax-react";
import { useState } from "react";
import { WalletConnectButton } from "@/components/wallet/connect-button";

const NAV_ITEMS = [
  { href: "/fact-check", label: "Fact-Check", icon: ShieldSearch },
  { href: "/claims", label: "Claims", icon: DocumentText },
  { href: "/agents", label: "Agents", icon: Profile2User },
  { href: "/verify", label: "Verify", icon: ShieldTick },
  { href: "/status", label: "Status", icon: Activity },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="container mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand & Wordmark */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1 py-1"
            aria-label="OpenVerdict Home"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <Judge size="20" variant="Bold" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-foreground">
                OpenVerdict
              </span>
              <span className="text-[10px] tracking-wider font-semibold uppercase text-muted-foreground -mt-1">
                AI Oracle Engine
              </span>
            </div>
          </Link>

          {/* Experimental Notice Badge (Global requirement) */}
          <Badge
            variant="outline"
            className="hidden sm:inline-flex items-center gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-medium px-2 py-0.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Experimental
          </Badge>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1 lg:gap-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <Icon size="16" variant={isActive ? "Bold" : "Linear"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right CTA & Mobile Hamburger */}
        <div className="flex items-center gap-2">
          <Link href="/fact-check" className="hidden xl:inline-block">
            <Button size="sm" className="min-h-[40px] px-4 font-semibold shadow-xs">
              <ShieldSearch size="16" variant="Bold" className="mr-1.5" />
              Start Fact-Check
            </Button>
          </Link>

          <WalletConnectButton />

          {/* Mobile menu button */}
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden min-h-[44px] min-w-[44px] p-2"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            <span className="sr-only">Toggle Menu</span>
            <div className="flex flex-col gap-1 w-5">
              <span className={`block h-0.5 w-full bg-foreground transition-all duration-200 ${mobileMenuOpen ? "rotate-45 translate-y-1.5" : ""}`} />
              <span className={`block h-0.5 w-full bg-foreground transition-all duration-200 ${mobileMenuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-full bg-foreground transition-all duration-200 ${mobileMenuOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
            </div>
          </Button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-border bg-background px-4 pt-2 pb-4 space-y-1">
          <div className="pb-2">
            <Badge
              variant="outline"
              className="inline-flex items-center gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-medium px-2 py-0.5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Experimental Protocol
            </Badge>
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-base font-medium min-h-[44px] ${
                  isActive
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <Icon size="18" variant={isActive ? "Bold" : "Linear"} />
                {item.label}
              </Link>
            );
          })}
          <div className="pt-2">
            <Link href="/fact-check" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full min-h-[44px] justify-center font-semibold">
                <ShieldSearch size="18" variant="Bold" className="mr-2" />
                Start Fact-Check
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

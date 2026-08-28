"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { Arrow } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/fact-check", label: "Fact-check" },
  { href: "/claims", label: "Claims" },
  { href: "/agents", label: "Agents" },
  { href: "/verify", label: "Verify" },
  { href: "/status", label: "Status" },
];

/**
 * The OpenVerdict mark: a sharp sealed-record glyph — the certificate frame,
 * the rotated seal inside it, and the accent square at its centre.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className="shrink-0"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 6.5 25.5 16 16 25.5 6.5 16 16 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="12.5" y="12.5" width="7" height="7" fill="var(--ov-accent)" />
    </svg>
  );
}

/**
 * Where the app lives. The two are meant to be separate hosts —
 * openverdict.info for the story, app.openverdict.info for the console — so
 * set NEXT_PUBLIC_APP_URL in the marketing deployment and the header will hand
 * visitors across. Unset (one host, and in development) it stays in-app at
 * /app, and the same link works either way.
 */
const APP_HOME = process.env.NEXT_PUBLIC_APP_URL || "/app";

/** The one control that crosses to the console, wherever the console lives. */
export function AppLink({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const label = "Open the OpenVerdict app";
  return APP_HOME.startsWith("http") ? (
    <a href={APP_HOME} aria-label={label} className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link href={APP_HOME} aria-label={label} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

/** Theme the header paints in — driven by the section under it. */
type HeaderTheme = "dark" | "light";

const THEME_VARS: Record<HeaderTheme, React.CSSProperties> = {
  light: {
    ["--chip-bg" as string]: "#F3F3F3",
    ["--chip-fg" as string]: "#000000",
    ["--chip-bg-hover" as string]: "#E4E4E4",
    ["--chip-border" as string]: "transparent",
  },
  dark: {
    // A light film, as the reference has it — it holds because the chip
    // frosts what is behind it (blur(20px) in .ov-nav-chip) and the page
    // itself ramps out of focus under the chrome (.ov-top-blur).
    ["--chip-bg" as string]: "rgba(238,238,240,0.14)",
    ["--chip-fg" as string]: "#F3F3F3",
    ["--chip-bg-hover" as string]: "rgba(238,238,240,0.24)",
    ["--chip-border" as string]: "transparent",
  },
};

export function SiteHeader() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  // The landing opens on the dark hero and flips with its sections; every
  // product page is simply light. Both sides render the same first pass, so
  // there is no hydration mismatch.
  const [observed, setObserved] = useState<HeaderTheme | null>(null);
  const theme: HeaderTheme = isLanding ? (observed ?? "dark") : "light";

  // The sheet is keyed to the route it was opened on, so navigating away
  // closes it without an effect fighting React's render pass.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const menuOpen = openedOnPath === pathname;
  const toggleMenu = () =>
    setOpenedOnPath((prev) => (prev === pathname ? null : pathname));

  // Sections declare data-header-theme; the one crossing the header's centre
  // line wins. Collapsing the root to that line means exactly one can match.
  useEffect(() => {
    if (!isLanding || typeof IntersectionObserver === "undefined") return;
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-header-theme]"),
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const next = entry.target.getAttribute("data-header-theme");
          if (next === "dark" || next === "light") setObserved(next);
        }
      },
      { rootMargin: "-34px 0px -100% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [isLanding, pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  const dark = theme === "dark";

  return (
    <>
      {/* The page ramps out of focus as it passes under the chrome. Only on the
          landing, where the header itself is transparent — the product pages
          already carry their own frosted bar. */}
      {isLanding && (
        <div aria-hidden className="ov-top-blur">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <header
        style={THEME_VARS[theme]}
        className={cn(
          "top-0 z-[999] w-full",
          isLanding
            ? "fixed"
            : "sticky border-b border-[var(--ov-line)] bg-[var(--ov-paper)]/85 backdrop-blur-xl",
        )}
      >
        <div className="flex h-[74px] items-center justify-between gap-4 px-5 md:px-7">
          {/* Brand */}
          <Link
            href="/"
            aria-label="OpenVerdict home"
            className={cn(
              "flex shrink-0 items-center gap-2.5 transition-colors",
              dark ? "text-[#F3F3F3]" : "text-black",
            )}
          >
            <BrandMark size={26} />
            <span className="text-[19px] leading-none font-medium tracking-[-0.01em]">
              OpenVerdict
            </span>
          </Link>

          {/* Chip rail */}
          <div className="hidden items-center gap-[2px] lg:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-active={isActive(item.href) ? "true" : undefined}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="ov-nav-chip"
              >
                {item.label}
              </Link>
            ))}
            <WalletConnectButton />
            <AppLink className="ov-nav-chip ov-nav-chip--accent w-[34px] px-0">
              <Arrow size={16} />
            </AppLink>
          </div>

          {/* Compact rail */}
          <div className="flex items-center gap-[2px] lg:hidden">
            <WalletConnectButton />
            <button
              type="button"
              className="ov-nav-chip w-[34px] px-0"
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
              onClick={toggleMenu}
            >
              <span className="flex w-4 flex-col gap-[3px]" aria-hidden>
                <span
                  className={cn(
                    "block h-[1.5px] w-full bg-current transition-transform duration-200",
                    menuOpen && "translate-y-[4.5px] rotate-45",
                  )}
                />
                <span
                  className={cn(
                    "block h-[1.5px] w-full bg-current transition-opacity duration-200",
                    menuOpen && "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "block h-[1.5px] w-full bg-current transition-transform duration-200",
                    menuOpen && "-translate-y-[4.5px] -rotate-45",
                  )}
                />
              </span>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            className={cn(
              "flex flex-col gap-[2px] px-5 pb-5 lg:hidden",
              dark ? "bg-[#04122b]/95" : "bg-[var(--ov-paper)]/97",
            )}
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-active={isActive(item.href) ? "true" : undefined}
                className="ov-nav-chip !h-11 !justify-start"
              >
                {item.label}
              </Link>
            ))}
            <AppLink
              className="ov-nav-chip ov-nav-chip--accent !h-11 !justify-start"
              onClick={toggleMenu}
            >
              Open the app
            </AppLink>
          </nav>
        )}
      </header>
    </>
  );
}

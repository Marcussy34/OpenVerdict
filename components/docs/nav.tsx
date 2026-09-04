"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type DocsNavItem = { slug: string; navTitle: string };

/**
 * The documentation index: a left rail on desktop, a horizontal chip rail on
 * a phone. Active state is read from the last path segment rather than the
 * whole path, so it agrees on both hosts: the docs host shows "/contracts"
 * while the deployment serves "/docs/contracts".
 */
export function DocsNav({
  items,
  base,
}: {
  items: DocsNavItem[];
  /** "" on the docs host, "/docs" everywhere else. */
  base: string;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const activeSlug = last === "docs" ? "" : last;
  const href = (slug: string) => (slug ? `${base}/${slug}` : base || "/");

  return (
    <>
      {/* Phone: one scrolling row of chips, no menu to open. */}
      <nav
        aria-label="Documentation pages"
        className="ov-scroll ov-fade-x sticky top-[74px] z-20 -mx-5 flex gap-[2px] overflow-x-auto border-b border-[var(--ov-line)] bg-[var(--ov-paper)]/95 px-5 py-2.5 backdrop-blur-xl lg:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.slug}
            href={href(item.slug)}
            data-active={item.slug === activeSlug ? "true" : undefined}
            aria-current={item.slug === activeSlug ? "page" : undefined}
            className="ov-nav-chip shrink-0 whitespace-nowrap"
          >
            {item.navTitle}
          </Link>
        ))}
      </nav>

      {/* Desktop: the ordered rail. */}
      <aside className="hidden shrink-0 border-r border-[var(--ov-line)] lg:block lg:w-[248px]">
        <nav
          aria-label="Documentation pages"
          className="ov-scroll sticky top-[74px] max-h-[calc(100vh-74px)] overflow-y-auto py-9 pr-5 pl-5 xl:pl-8"
        >
          <p className="ov-micro ov-micro-sm text-muted-foreground">
            Documentation
          </p>
          <ul className="mt-4 space-y-px">
            {items.map((item) => {
              const active = item.slug === activeSlug;
              return (
                <li key={item.slug}>
                  <Link
                    href={href(item.slug)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block border-l-2 py-[7px] pl-3 text-[14.5px] leading-snug transition-colors",
                      active
                        ? "border-accent-blue font-medium text-sea-ink"
                        : "border-transparent text-muted-foreground hover:border-[var(--ov-line-strong)] hover:text-ocean",
                    )}
                  >
                    {item.navTitle}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}

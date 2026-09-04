import { headers } from "next/headers";

import { DocsNav } from "@/components/docs/nav";
import { loadDocNav } from "@/lib/docs/pages";
import { DOCS_PATH, isDocsHost } from "@/lib/web/host-routing";

/**
 * The documentation shell: the site header stays above it, so the docs read as
 * part of the product, and the page list sits in a left rail beside the prose.
 *
 * `base` exists because one deployment serves the docs on two paths:
 * docs.openverdict.info shows "/contracts" while every other host shows
 * "/docs/contracts". Links are built from it so both stay clean.
 */
export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const base = isDocsHost(host) ? "" : DOCS_PATH;
  const nav = await loadDocNav();

  return (
    // A column on a phone (the chip rail sits above the prose) and a row from
    // lg up (the page list becomes the left rail).
    <div className="mx-auto flex w-full max-w-[1440px] flex-col px-5 md:px-7 lg:flex-row lg:items-start lg:px-0">
      <DocsNav
        base={base}
        items={nav.map(({ slug, navTitle }) => ({ slug, navTitle }))}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsMarkdown } from "@/components/docs/markdown";
import { loadDocPage, loadDocPages, type DocPage } from "@/lib/docs/pages";
import { DOCS_PATH, isDocsHost } from "@/lib/web/host-routing";

const REPO_BLOB_BASE = "https://github.com/Marcussy34/OpenVerdict/blob/main/";

type PageProps = { params: Promise<{ slug?: string[] }> };

/** A catch-all with no slug is the index; one segment names a page. */
function slugFrom(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return "";
  if (segments.length > 1) return null;
  return segments[0] ?? null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const slug = slugFrom((await params).slug);
  const page = slug === null ? null : await loadDocPage(slug);
  if (!page) return { title: "Not found" };
  return {
    title: page.title,
    description: page.description || undefined,
    openGraph: { title: page.title, description: page.description || undefined },
  };
}

export default async function DocsPage({ params }: PageProps) {
  const slug = slugFrom((await params).slug);
  const page = slug === null ? null : await loadDocPage(slug);
  if (!page) notFound();

  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const base = isDocsHost(host) ? "" : DOCS_PATH;

  const pages = await loadDocPages();
  const index = pages.findIndex((entry) => entry.slug === page.slug);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index >= 0 ? pages[index + 1] : undefined;
  const href = (target: DocPage) =>
    target.slug ? `${base}/${target.slug}` : base || "/";

  return (
    // Prose and rail travel together and centre in what the sidebar leaves,
    // so the reading column never drifts to one edge of a wide window.
    <div className="mx-auto flex w-full max-w-[1080px] items-start gap-12 py-10 lg:px-9 lg:py-12">
      <article className="min-w-0 w-full max-w-[72ch] flex-1">
        <header className="border-b border-[var(--ov-line)] pb-7">
          <h1 className="ov-display text-[clamp(1.9rem,4vw,2.5rem)] text-ocean">
            {page.title}
          </h1>
          {page.description ? (
            <p className="mt-3 text-[16.5px] leading-relaxed text-muted-foreground">
              {page.description}
            </p>
          ) : null}
          {page.source ? (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Source of truth:{" "}
              <a
                href={`${REPO_BLOB_BASE}${page.source}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sea-ink underline decoration-sea-ink/30 underline-offset-[3px] hover:decoration-sea-ink"
              >
                {page.source}
              </a>
            </p>
          ) : null}
        </header>

        <div className="mt-9">
          <DocsMarkdown markdown={page.body} base={base} />
        </div>

        {/* Sequential reading: the docs are ordered, so give the order. */}
        {previous || next ? (
          <nav
            aria-label="Nearby pages"
            className="mt-16 grid gap-px border-t border-[var(--ov-line)] pt-6 sm:grid-cols-2"
          >
            {previous ? (
              <Link
                href={href(previous)}
                className="group border border-[var(--ov-line)] p-4 transition-colors hover:border-[var(--ov-line-strong)]"
              >
                <span className="ov-micro ov-micro-sm text-muted-foreground">
                  Previous
                </span>
                <span className="mt-1.5 block text-[15px] font-medium text-ocean">
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span aria-hidden />
            )}
            {next ? (
              <Link
                href={href(next)}
                className="group border border-[var(--ov-line)] p-4 text-right transition-colors hover:border-[var(--ov-line-strong)] sm:border-l-0"
              >
                <span className="ov-micro ov-micro-sm text-muted-foreground">
                  Next
                </span>
                <span className="mt-1.5 block text-[15px] font-medium text-ocean">
                  {next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>

      {/* On this page. Cheap: the headings were extracted with the same
          slugger rehype-slug uses, so every anchor lands. */}
      {page.headings.length > 1 ? (
        <aside className="hidden w-[220px] shrink-0 xl:block">
          <div className="ov-scroll sticky top-[106px] max-h-[calc(100vh-140px)] overflow-y-auto">
            <p className="ov-micro ov-micro-sm text-muted-foreground">
              On this page
            </p>
            <ul className="mt-3.5 space-y-1.5 border-l border-[var(--ov-line)]">
              {page.headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={
                      heading.depth === 3
                        ? "block py-[2px] pl-6 text-[13px] leading-snug text-muted-foreground transition-colors hover:text-sea-ink"
                        : "block py-[2px] pl-3 text-[13.5px] leading-snug text-muted-foreground transition-colors hover:text-sea-ink"
                    }
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

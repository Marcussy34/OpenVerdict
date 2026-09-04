import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { MermaidDiagram } from "@/components/docs/mermaid";
import { cn } from "@/lib/utils";

/** The text of a fence, whatever nesting react-markdown hands the component. */
function fenceText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(fenceText).join("");
  return "";
}

/**
 * The documentation prose renderer.
 *
 * The app carries no typography plugin and writes no CSS files, so every
 * element is mapped to Tailwind utilities here. One palette throughout: paper
 * ground, white surfaces with hairline borders, ink for text and the blue
 * accent for links and nothing else.
 */
export function DocsMarkdown({
  markdown,
  base,
}: {
  markdown: string;
  /** Route prefix for links between pages: "" on the docs host, else "/docs". */
  base: string;
}) {
  return (
    <div className="text-[15.5px] leading-[1.72] break-words text-[var(--foreground)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={componentsFor(base)}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Headings carry the id rehype-slug computed, so the rail's anchors land. */
function heading(level: 2 | 3 | 4) {
  const classes = {
    2: "mt-14 scroll-mt-28 text-[26px] leading-[1.2] font-medium tracking-[-0.015em] text-ocean first:mt-0",
    3: "mt-10 scroll-mt-28 text-[19px] leading-[1.3] font-medium tracking-[-0.01em] text-ocean",
    4: "mt-8 scroll-mt-28 text-[16px] leading-[1.4] font-semibold text-ocean",
  }[level];
  const Tag = `h${level}` as const;
  return function Heading({
    id,
    children,
  }: {
    id?: string;
    children?: React.ReactNode;
  }) {
    return (
      <Tag id={id} className={classes}>
        {children}
      </Tag>
    );
  };
}

function componentsFor(base: string): Components {
  return {
    h1: ({ id, children }) => (
      // A page already renders its title as the h1, so a stray one in the
      // body becomes an h2 rather than a second document heading.
      <h2
        id={id}
        className="mt-14 scroll-mt-28 text-[26px] leading-[1.2] font-medium tracking-[-0.015em] text-ocean first:mt-0"
      >
        {children}
      </h2>
    ),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(4),
    h6: heading(4),

    // A paragraph holding nothing but an image is a figure, so it must not be
    // wrapped in a <p>: figure is flow content and p only permits phrasing,
    // which the browser would silently re-nest and React would then fail to
    // hydrate.
    p: ({ node, children }) =>
      isLoneImage(node) ? (
        <>{children}</>
      ) : (
        <p className="mt-4 first:mt-0">{children}</p>
      ),

    a: ({ href, children }) => {
      const target = resolveHref(href, base);
      const external = target.startsWith("http");
      return (
        <a
          href={target}
          // A linked id or path is usually set in code, so the inline chip
          // takes the link's colour rather than staying ink and reading dead.
          className="text-sea-ink underline decoration-sea-ink/30 underline-offset-[3px] transition-colors hover:decoration-sea-ink [&>code]:text-sea-ink break-words [overflow-wrap:anywhere]"
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {children}
        </a>
      );
    },

    strong: ({ children }) => (
      <strong className="font-semibold text-ocean">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,

    ul: ({ children }) => (
      <ul className="mt-4 space-y-2 pl-5 [&_ul]:mt-2 [&_ul]:mb-1 list-disc marker:text-muted-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-4 space-y-2 pl-5 [&_ol]:mt-2 [&_ol]:mb-1 list-decimal marker:text-muted-foreground">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,

    // Fenced blocks: mono on the recessed surface, scrolling inside their own
    // box so the page body never scrolls sideways. A ```mermaid fence is a
    // diagram instead, drawn in the browser from the same source.
    pre: ({ children }) => {
      const diagram = mermaidSource(children);
      if (diagram !== null) return <MermaidDiagram chart={diagram} />;
      return (
        <pre className="ov-scroll mt-5 overflow-x-auto border border-[var(--ov-line)] bg-surface-2 p-4 font-mono text-[13px] leading-[1.6] text-ocean [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px] [&_code]:break-normal [&_code]:[overflow-wrap:normal]">
          {children}
        </pre>
      );
    },
    // Inline code carries hashes, ids and URLs, so it must break mid-token
    // rather than push the page sideways on a narrow screen.
    code: ({ className, children }) => (
      <code
        className={cn(
          "border border-[var(--ov-line)] bg-surface px-[0.35em] py-[0.1em] font-mono text-[0.87em] break-words text-ocean [overflow-wrap:anywhere]",
          className,
        )}
      >
        {children}
      </code>
    ),

    // Tables scroll in their own container, never the page.
    table: ({ children }) => (
      <div className="ov-scroll mt-6 overflow-x-auto border border-[var(--ov-line)] bg-card">
        <table className="w-full border-collapse text-[14px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-[var(--ov-line)] bg-surface/70">
        {children}
      </thead>
    ),
    tr: ({ children }) => (
      <tr className="border-b border-[var(--ov-line)] last:border-b-0">
        {children}
      </tr>
    ),
    th: ({ children, style }) => (
      <th
        style={style}
        className="px-3.5 py-2.5 text-left align-top text-[12px] font-semibold tracking-[0.02em] text-ocean uppercase"
      >
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="px-3.5 py-2.5 align-top leading-[1.55]">
        {children}
      </td>
    ),

    blockquote: ({ children }) => (
      <blockquote className="mt-5 border-l-2 border-[var(--ov-line-strong)] pl-4 text-muted-foreground [&>p]:mt-3 [&>p:first-child]:mt-0">
        {children}
      </blockquote>
    ),

    hr: () => <hr className="my-10 h-px border-0 bg-[var(--ov-line)]" />,

    // An image is a figure: the alt text doubles as the caption, so a diagram
    // always says in one line what it shows.
    img: ({ src, alt, title }) =>
      typeof src === "string" ? (
        <figure className="mt-6">
          <div className="ov-scroll overflow-x-auto border border-[var(--ov-line)] bg-card p-3">
            {/* Documentation images are repository assets, not user uploads. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt ?? ""} className="mx-auto block max-w-full" />
          </div>
          {alt ? (
            <figcaption className="mt-2 text-[13px] leading-snug text-muted-foreground">
              {title ?? alt}
            </figcaption>
          ) : null}
        </figure>
      ) : null,
  };
}

/** The shape of a hast node this file needs, without a direct hast dependency. */
type SourceNode = { type?: string; tagName?: string; value?: string; children?: SourceNode[] };

/**
 * True when a paragraph's only content is one image. Read from the source
 * tree rather than the rendered children, which are already this file's own
 * components by the time the paragraph sees them.
 */
function isLoneImage(node: unknown): boolean {
  const children = (node as SourceNode | undefined)?.children;
  if (!Array.isArray(children)) return false;
  const content = children.filter(
    (child) => child.type !== "text" || (child.value ?? "").trim() !== "",
  );
  const only = content[0];
  return (
    content.length === 1 && only?.type === "element" && only.tagName === "img"
  );
}

/** The chart source when this fence is ```mermaid, otherwise null. */
function mermaidSource(children: React.ReactNode): string | null {
  const only = Array.isArray(children) ? children[0] : children;
  if (!only || typeof only !== "object" || !("props" in only)) return null;
  const props = (only as { props?: { className?: unknown; children?: React.ReactNode } })
    .props;
  const className = typeof props?.className === "string" ? props.className : "";
  if (!className.split(/\s+/).includes("language-mermaid")) return null;
  return fenceText(props?.children).replace(/\n$/, "");
}

/**
 * A bare relative target in a docs page names another docs page, so it is
 * resolved against the site root rather than the current URL. Absolute,
 * root-relative and anchor targets pass through untouched.
 */
function resolveHref(href: string | undefined, base: string): string {
  if (!href) return "#";
  if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) {
    return href;
  }
  return `${base}/${href}`;
}

"use client";

import * as React from "react";
import { Copy, ExportSquare, TickCircle } from "@/components/icons";
import { chipHref, chipTitle, type ChipKind } from "@/lib/web/chip-link";
import { cn } from "@/lib/utils";

const TONE = {
  default: "border-border bg-surface text-foreground/85 hover:border-sea/50 hover:bg-aqua/25",
  chain: "border-chain/25 bg-chain/8 text-chain hover:border-chain/45",
  sealed: "border-sealed/25 bg-sealed/8 text-sealed hover:border-sealed/45",
  yes: "border-yes/25 bg-yes/8 text-yes hover:border-yes/45",
  muted:
    "border-transparent bg-surface text-muted-foreground hover:border-border hover:text-foreground",
} as const;

/**
 * Every hash, object id, blob id and tx digest in the app renders through this
 * chip: truncated mono head/tail, full value on hover (title) and click-to-copy.
 * `kind` says what the value is, and the chip derives its own explorer link
 * from it: a Sui object or account opens on SuiVision, a transaction on
 * Suiscan, a Walrus blob on the aggregator, and a hash says it is a hash
 * instead of pretending to be a link. An explicit `href` still wins, for
 * internal pages. Nothing is dropped: long values are rehoused, not removed.
 */
export function HashChip({
  value,
  label,
  kind,
  head = 6,
  tail = 4,
  tone = "default",
  className,
  full = false,
  href,
  title,
}: {
  value: string | null | undefined;
  label?: string;
  /** What the value is; the chip derives its explorer link from it. */
  kind?: ChipKind;
  /** Overrides the composed hover title, for a chip that cannot show a label. */
  title?: string;
  head?: number;
  tail?: number;
  tone?: keyof typeof TONE;
  className?: string;
  /** Render the entire value (wrapping) instead of the truncated form. */
  full?: boolean;
  /** Explorer or internal URL; overrides whatever `kind` would derive. */
  href?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);

  if (!value) {
    return (
      <span className={cn("font-mono text-[11px] text-muted-foreground", className)}>—</span>
    );
  }

  const shown =
    full || value.length <= head + tail + 3
      ? value
      : `${value.slice(0, head)}…${value.slice(-tail)}`;

  // The kind carries the link; an explicit href (internal pages) still wins.
  const link = href === undefined ? chipHref(kind, value) : href;
  // A hash never links, so it says so: the label slot when that is free, a
  // leading "#" when the label already names the field.
  const marker = kind === "hash" && !label ? "hash" : label;
  const hashGlyph = kind === "hash" && Boolean(label);
  const hoverTitle = title ?? chipTitle({ value, label, kind, linked: Boolean(link) });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — the title attribute still exposes the value */
    }
  };

  const chipClass = cn(
    "group/hash inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-5 transition-colors",
    full && "break-all whitespace-normal text-left",
    TONE[tone],
    className,
  );

  const body = (
    <>
      {marker && (
        <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
          {marker}
        </span>
      )}
      {hashGlyph && (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          #
        </span>
      )}
      <span className={cn(!full && "truncate")}>{shown}</span>
      {copied ? (
        <TickCircle size="11" variant="Bold" className="shrink-0 text-yes" />
      ) : link ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Copy value"
          onClick={(event) => {
            // The chip itself navigates to the explorer; this icon copies.
            event.preventDefault();
            event.stopPropagation();
            void copy();
          }}
          className="shrink-0 opacity-0 transition-opacity group-hover/hash:opacity-60 hover:opacity-100"
        >
          <Copy size="11" />
        </span>
      ) : (
        <Copy
          size="11"
          className="shrink-0 opacity-0 transition-opacity group-hover/hash:opacity-60"
        />
      )}
      {link ? <ExportSquare size="11" className="shrink-0 opacity-70" /> : null}
    </>
  );

  // The kind stays in the DOM so a page audit can check that every explorable
  // chip links and no hash does.
  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        title={hoverTitle}
        data-chip-kind={kind}
        className={chipClass}
      >
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // A chip can sit inside a card that is itself a link: copying must
        // never follow it.
        event.preventDefault();
        event.stopPropagation();
        void copy();
      }}
      title={hoverTitle}
      data-chip-kind={kind}
      className={chipClass}
    >
      {body}
    </button>
  );
}

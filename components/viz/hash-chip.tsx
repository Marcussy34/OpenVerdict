"use client";

import * as React from "react";
import { Copy, ExportSquare, TickCircle } from "@/components/icons";
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
 * With `href` the chip opens the value on its public explorer instead, and the
 * copy affordance moves onto the small copy icon. Nothing is dropped — long
 * values are rehoused, not removed.
 */
export function HashChip({
  value,
  label,
  head = 6,
  tail = 4,
  tone = "default",
  className,
  full = false,
  href,
}: {
  value: string | null | undefined;
  label?: string;
  head?: number;
  tail?: number;
  tone?: keyof typeof TONE;
  className?: string;
  /** Render the entire value (wrapping) instead of the truncated form. */
  full?: boolean;
  /** Public explorer URL; the chip becomes a link that opens it. */
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
      {label && (
        <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </span>
      )}
      <span className={cn(!full && "truncate")}>{shown}</span>
      {copied ? (
        <TickCircle size="11" variant="Bold" className="shrink-0 text-yes" />
      ) : href ? (
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
      {href ? <ExportSquare size="11" className="shrink-0 opacity-70" /> : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={`${label ? `${label}: ` : ""}${value} (opens explorer; copy icon copies)`}
        className={chipClass}
      >
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`${label ? `${label}: ` : ""}${value} (click to copy)`}
      className={chipClass}
    >
      {body}
    </button>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/components/icons";

type ToneKey = "default" | "primary" | "sealed" | "chain" | "warn" | "yes";

const TONE_RAIL: Record<ToneKey, string> = {
  default: "from-border via-border/40",
  primary: "from-sea via-sea/25",
  sealed: "from-sealed/70 via-sealed/15",
  chain: "from-chain/70 via-chain/15",
  warn: "from-unsure/70 via-unsure/15",
  yes: "from-yes/70 via-yes/15",
};

const TONE_ICON: Record<ToneKey, string> = {
  default: "text-muted-foreground",
  primary: "text-primary",
  sealed: "text-sealed",
  chain: "text-chain",
  warn: "text-unsure",
  yes: "text-yes",
};

/**
 * The single framed surface used across every page: white paper, hairline
 * border, soft elevation, an uppercase mono eyebrow and an optional right-hand
 * slot. One panel everywhere keeps the whole app visually cohesive.
 */
export function Panel({
  label,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
  headerClassName,
  tone = "default",
  live = false,
  flush = false,
}: {
  label?: React.ReactNode;
  icon?: IconComponent;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  tone?: ToneKey;
  /** Adds the slow scanline sweep used to mark actively-updating surfaces. */
  live?: boolean;
  /** Drops the body padding for panels that host their own full-bleed content. */
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "ov-edge relative isolate overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      {/* Top accent rail — a one-pixel tell of what kind of panel this is. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent",
          TONE_RAIL[tone],
        )}
      />
      {live && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="ov-scanline h-20 w-full bg-gradient-to-b from-transparent via-sea/6 to-transparent" />
        </div>
      )}

      {(label || action) && (
        <header
          className={cn(
            "relative flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5",
            headerClassName,
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon size="15" className={cn("shrink-0", TONE_ICON[tone])} />}
            <h2 className="ov-micro ov-micro-sm truncate text-muted-foreground">
              {label}
            </h2>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}

      <div
        className={cn("relative", !flush && "px-4 py-4 sm:px-5 sm:py-5", bodyClassName)}
      >
        {children}
      </div>
    </section>
  );
}

/** Small uppercase mono label used for field captions inside panels. */
export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ov-micro ov-micro-sm block text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Recessed well for code, hashes and read-only key/value blocks. */
export function Well({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-surface px-3.5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

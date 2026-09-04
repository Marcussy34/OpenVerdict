import * as React from "react";
import Link from "next/link";
import { ArrowLeft2,
  type IconComponent,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { GlobeMotif } from "./globe-motif";

/**
 * One page header for every route: optional breadcrumb, an icon plate, an
 * Ocean-ink title, a one-line description and a right-hand action slot.
 * Keeping a single header component is what stops the app looking half-migrated.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  badges,
  backHref,
  backLabel,
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconComponent;
  actions?: React.ReactNode;
  badges?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    // The landing's register: a blue corner pin, an uppercase eyebrow, display
    // type at 400 weight, and a dashed hairline closing the block.
    <div className={cn("ov-hr-b relative isolate pb-7", className)}>
      {/* Faint globe echo, right-aligned behind the title block. */}
      <GlobeMotif className="top-1/2 right-2 -z-10 hidden size-[260px] -translate-y-1/2 opacity-[0.16] xl:block" />
      <span aria-hidden className="absolute -top-3 left-0 size-1.5 bg-[var(--ov-accent)]" />

      {backHref && (
        <Link
          href={backHref}
          className="ov-micro ov-micro-sm mb-3 inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft2 size="13" variant="Bold" />
          {backLabel ?? "Back"}
        </Link>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <span className="ov-micro ov-micro-sm block text-primary">
              {eyebrow}
            </span>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center bg-sea/12 text-primary">
                <Icon size="19" variant="Bold" />
              </span>
            )}
            <h1 className="ov-display text-[clamp(1.9rem,3.4vw,2.75rem)] text-black">
              {title}
            </h1>
            {badges}
          </div>

          {description && (
            <p className="mt-3 max-w-2xl text-[15px] leading-[1.5] text-black/65">
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </div>
  );
}

/** Neutral outline marker for factual labels ("Read-only", "Direct review"). */
export function MetaTag({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "chain" | "sealed" | "yes";
  className?: string;
}) {
  const tones = {
    default: "border-border bg-surface text-muted-foreground",
    chain: "border-chain/30 bg-chain/8 text-chain",
    sealed: "border-sealed/30 bg-sealed/8 text-sealed",
    yes: "border-yes/30 bg-yes/8 text-yes",
  } as const;

  return (
    <span
      className={cn(
        "ov-micro ov-micro-sm inline-flex items-center gap-1.5 border px-2 py-0.5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

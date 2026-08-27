import * as React from "react";
import Link from "next/link";
import { ArrowLeft2,
  type IconComponent,
} from "@/components/icons";
import { cn } from "@/lib/utils";

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
    <div className={cn("border-b border-border pb-6", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft2 size="13" variant="Bold" />
          {backLabel ?? "Back"}
        </Link>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          {eyebrow && (
            <span className="block font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              {eyebrow}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sea/12 text-primary ring-1 ring-sea/20">
                <Icon size="19" variant="Bold" />
              </span>
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-ocean sm:text-3xl">
              {title}
            </h1>
            {badges}
          </div>

          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
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

/** The site-wide "Experimental" marker, used beside every page title. */
export function ExperimentalTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-unsure/30 bg-unsure/8 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-unsure uppercase",
        className,
      )}
    >
      <span className="ov-breathe size-1.5 rounded-full bg-unsure" aria-hidden />
      Experimental
    </span>
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
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

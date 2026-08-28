import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The landing's shared furniture: split buttons, eyebrows, number chips,
 * corner pins and the dashed grid guides. Everything here is sharp-cornered by
 * construction — the landing has zero border-radius anywhere.
 */

/** Thin line arrow — the mark inside every blue chip. */
export function Arrow({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2.5 8h10.5M9 3.75 13.25 8 9 12.25" />
    </svg>
  );
}

/** The same arrow, pointing up — used by BACK TO TOP. */
export function ArrowUp({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 13.5V3M3.75 7 8 2.75 12.25 7" />
    </svg>
  );
}

type ButtonTone = "primary" | "dark" | "muted";

const TONE_CLASS: Record<ButtonTone, string> = {
  primary: "",
  dark: "ov-btn--dark",
  muted: "ov-btn--muted",
};

type SplitButtonProps = {
  children: React.ReactNode;
  /** Renders a Next link when set, a plain button otherwise. */
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: ButtonTone;
  /** Drops the arrow chip entirely (label-only chips). */
  chip?: boolean;
  /** Fills the row: the label stretches and centres, the chip stays 32px. */
  stretch?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/**
 * The signature split button: a 34px-high label block and, beside it, a
 * separate 32×34 accent chip carrying the arrow. Two blocks, 2px apart.
 */
export function SplitButton({
  children,
  href,
  onClick,
  type = "button",
  tone = "primary",
  chip = true,
  stretch = false,
  disabled,
  className,
  ariaLabel,
}: SplitButtonProps) {
  const inner = (
    <>
      <span className={cn("ov-btn__label ov-micro", stretch && "flex-1 justify-center")}>
        {children}
      </span>
      {chip && (
        <span className="ov-btn__chip" aria-hidden>
          <Arrow />
        </span>
      )}
    </>
  );
  const classes = cn(
    "ov-btn",
    TONE_CLASS[tone],
    stretch && "flex w-full",
    disabled && "opacity-45",
    className,
  );

  // External and hash targets stay plain anchors; internal routes prefetch.
  if (href) {
    const external = href.startsWith("http") || href.startsWith("#");
    return external ? (
      <a href={href} className={classes} aria-label={ariaLabel} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={classes} aria-label={ariaLabel}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(classes, "disabled:cursor-not-allowed")}
    >
      {inner}
    </button>
  );
}

/** Uppercase section label, optionally pinned by the 6px blue square. */
export function Eyebrow({
  children,
  pin = false,
  className,
}: {
  children: React.ReactNode;
  pin?: boolean;
  className?: string;
}) {
  return (
    <p className={cn("ov-micro relative", className)}>
      {pin && <CornerPin className="-top-4 left-0" />}
      {children}
    </p>
  );
}

/** The signature detail: a 6×6 accent square marking a section or card corner. */
export function CornerPin({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("absolute block size-1.5 bg-[var(--ov-accent)]", className)}
    />
  );
}

/** `■ 01` — a 30×22 chip numbering a row. Dark on light, light on dark. */
export function NumberChip({
  n,
  tone = "dark",
  className,
}: {
  n: number;
  tone?: "dark" | "light" | "faint";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ov-micro ov-micro-sm inline-flex h-[22px] w-[30px] shrink-0 items-center justify-center gap-[3px]",
        tone === "dark" && "bg-black text-white",
        tone === "light" && "bg-[var(--ov-surface)] text-black",
        tone === "faint" && "bg-black/6 text-black",
        className,
      )}
    >
      <span aria-hidden className="inline-block size-[3px] bg-current" />
      {String(n).padStart(2, "0")}
    </span>
  );
}

/**
 * Dashed vertical column guides — the faint 12-col scaffolding the reference
 * prints behind every section. Purely decorative.
 */
export function GridGuides({
  columns = 3,
  at,
  dark = false,
  className,
}: {
  columns?: number;
  /** Explicit guide positions (percentages), for sections that want only some
   *  of the column lines — a guide that cuts through ruled rows reads as a
   *  stray line, while the one beside them is furniture. */
  at?: number[];
  dark?: boolean;
  className?: string;
}) {
  const positions =
    at ?? Array.from({ length: columns - 1 }, (_, i) => ((i + 1) / columns) * 100);
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {positions.map((left, i) => (
        <span
          key={i}
          className={cn("absolute top-0 bottom-0", dark ? "ov-vr--dark" : "ov-vr")}
          style={{ left: `${left}%`, width: 1 }}
        />
      ))}
    </div>
  );
}

/** Horizontal dashed separator. */
export function Hairline({ dark = false, className }: { dark?: boolean; className?: string }) {
  return <div aria-hidden className={cn(dark ? "ov-hr ov-hr--dark" : "ov-hr", className)} />;
}

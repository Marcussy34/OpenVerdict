"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useCountUp } from "./use-count-up";
import type { IconComponent } from "@/components/icons";

const TONE_TEXT: Record<string, string> = {
  default: "text-ocean",
  primary: "text-primary",
  yes: "text-yes",
  sealed: "text-sealed",
  chain: "text-chain",
  unsure: "text-unsure",
  no: "text-no",
};

const TONE_ICON: Record<string, string> = {
  default: "bg-surface text-muted-foreground",
  primary: "bg-sea/12 text-primary",
  yes: "bg-yes/10 text-yes",
  sealed: "bg-sealed/10 text-sealed",
  chain: "bg-chain/10 text-chain",
  unsure: "bg-unsure/10 text-unsure",
  no: "bg-no/10 text-no",
};

/**
 * Dense metric tile: mono label, large numeric value (count-up when numeric),
 * optional unit and footnote. Used for the home stats rail and /status.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "default",
  className,
  animate = true,
}: {
  label: React.ReactNode;
  value: number | string;
  unit?: string;
  hint?: React.ReactNode;
  icon?: IconComponent;
  tone?: keyof typeof TONE_TEXT;
  className?: string;
  animate?: boolean;
}) {
  const numeric = typeof value === "number" ? value : null;
  const counted = useCountUp(animate ? numeric : null);
  const shown = numeric === null ? value : animate ? Math.round(counted) : numeric;

  return (
    <div
      className={cn(
        "ov-edge ov-lift group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              TONE_ICON[tone],
            )}
          >
            <Icon size="14" />
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            "font-mono text-[1.65rem] leading-none font-semibold tracking-tight tabular-nums",
            TONE_TEXT[tone],
          )}
        >
          {shown}
        </span>
        {unit && <span className="font-mono text-xs text-muted-foreground">{unit}</span>}
      </div>

      {hint && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

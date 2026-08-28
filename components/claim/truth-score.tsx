"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VerdictGauge, tierForScore } from "@/components/viz/verdict-gauge";
import { FieldLabel } from "@/components/viz/panel";
import { cn } from "@/lib/utils";
import { ShieldTick, ShieldCross, Warning2, InfoCircle, Award } from "@/components/icons";

interface TruthScoreProps {
  /** Score in basis points 0..10000. Null/undefined renders "Not independently reviewed". */
  scoreBps?: number | null;
  /** Pre-normalized 0..100 score, when the caller already divided. */
  scoreNormalized?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  showFormulaButton?: boolean;
}

const TIER_META = {
  yes: {
    label: "High confidence: true",
    icon: ShieldTick,
    chip: "border-yes/30 bg-yes/8 text-yes",
  },
  no: {
    label: "High confidence: false",
    icon: ShieldCross,
    chip: "border-no/30 bg-no/8 text-no",
  },
  unsure: {
    label: "Uncertain / mixed",
    icon: Warning2,
    chip: "border-unsure/30 bg-unsure/8 text-unsure",
  },
} as const;

export function TruthScore({
  scoreBps,
  scoreNormalized,
  size = "md",
  className = "",
  showFormulaButton = true,
}: TruthScoreProps) {
  // Normalize score to the 0..100 display range.
  let finalScore: number | null = null;
  if (scoreNormalized !== null && scoreNormalized !== undefined) {
    finalScore = Math.max(0, Math.min(100, scoreNormalized));
  } else if (scoreBps !== null && scoreBps !== undefined) {
    finalScore = Math.max(0, Math.min(100, Math.round(scoreBps / 100)));
  }

  // PRD rule: claims without a jury round never receive a fabricated score.
  if (finalScore === null) {
    if (size === "lg") {
      return (
        <div
          className={cn(
            "ov-edge flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6",
            className,
          )}
        >
          <VerdictGauge scoreBps={null} size={190} />
          <p className="max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
            This claim has not been through a jury round, so no Truth Score exists. The
            protocol never invents a synthetic confidence value.
          </p>
          {showFormulaButton && <FormulaPopover triggerText="How scoring works" />}
        </div>
      );
    }

    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <InfoCircle size="13" variant="Bold" className="shrink-0" />
          Not independently reviewed
        </span>
        {showFormulaButton && <FormulaPopover triggerText="Why?" />}
      </div>
    );
  }

  const tier = TIER_META[tierForScore(finalScore)];
  const TierIcon = tier.icon;

  if (size === "sm") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums",
          tier.chip,
          className,
        )}
      >
        <TierIcon size="12" variant="Bold" />
        {finalScore}/100
      </span>
    );
  }

  if (size === "lg") {
    return (
      <div
        className={cn(
          "ov-edge relative overflow-hidden rounded-2xl border border-border bg-card",
          className,
        )}
      >
        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <VerdictGauge scoreBps={scoreBps ?? finalScore * 100} size={196} compact />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel>Consensus verdict</FieldLabel>
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
                  tier.chip,
                )}
              >
                <TierIcon size="16" variant="Bold" />
                {tier.label}
              </div>
            </div>

            {/* Scale strip: the 0/35/65/100 bands the tiers are cut on. */}
            <div className="space-y-1.5">
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="absolute inset-y-0 left-0 w-[35%] bg-no/25" />
                <div className="absolute inset-y-0 left-[35%] w-[30%] bg-unsure/25" />
                <div className="absolute inset-y-0 left-[65%] right-0 bg-yes/25" />
                <div
                  className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 rounded-full bg-ocean"
                  style={{ left: `${finalScore}%` }}
                  role="progressbar"
                  aria-valuenow={finalScore}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Truth score position"
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>0 contradicted</span>
                <span>50 uncertain</span>
                <span>100 verified</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>Computed across 5 independent AI jurors.</span>
              {showFormulaButton && <FormulaPopover triggerText="View deterministic formula" />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Medium / default
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-bold tabular-nums",
          tier.chip,
        )}
      >
        <TierIcon size="14" variant="Bold" />
        Truth Score {finalScore}/100
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">({tier.label})</span>
      {showFormulaButton && <FormulaPopover triggerText="Formula" />}
    </div>
  );
}

function FormulaPopover({ triggerText }: { triggerText: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
        >
          <InfoCircle size="14" variant="Bold" />
          {triggerText}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-84 space-y-3 p-4 text-xs sm:w-96" align="start">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ocean">
          <Award size="16" variant="Bold" className="text-primary" />
          Deterministic Truth Score formula
        </h3>
        <p className="leading-relaxed text-muted-foreground">
          The Truth Score is pure integer arithmetic over the{" "}
          <strong className="text-ocean">terminal valid jury round</strong> — no model is asked
          to rate the result:
        </p>
        <div className="space-y-1 rounded-lg border border-border bg-surface p-2.5 font-mono text-[11px]">
          <div>• YES vote → probability = confidenceBps</div>
          <div>• NO vote → probability = 10,000 − confidenceBps</div>
          <div>• UNSURE vote → probability = 5,000 bps</div>
          <div className="border-t border-border pt-1 font-bold text-ocean">
            truthScoreBps = (Σ probability + ⌊N / 2⌋) / N
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Claims settled optimistically without a challenged jury round return{" "}
          <em>&quot;Not independently reviewed&quot;</em> rather than a fabricated score.
        </p>
      </PopoverContent>
    </Popover>
  );
}

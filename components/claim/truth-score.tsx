"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShieldTick, ShieldCross, Warning2, InfoCircle, Award } from "iconsax-react";

interface TruthScoreProps {
  /** Score in 0..100 or basis points 0..10000. If null or undefined, renders "Not independently reviewed". */
  scoreBps?: number | null;
  scoreNormalized?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  showFormulaButton?: boolean;
}

export function TruthScore({
  scoreBps,
  scoreNormalized,
  size = "md",
  className = "",
  showFormulaButton = true,
}: TruthScoreProps) {
  // Normalize score to 0..100 range
  let finalScore: number | null = null;
  if (scoreNormalized !== null && scoreNormalized !== undefined) {
    finalScore = Math.max(0, Math.min(100, scoreNormalized));
  } else if (scoreBps !== null && scoreBps !== undefined) {
    finalScore = Math.max(0, Math.min(100, Math.round(scoreBps / 100)));
  }

  // PRD Rule: Claims without a jury round show "Not independently reviewed" instead of a Truth Score
  if (finalScore === null) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <Badge
          variant="outline"
          className="border-muted-foreground/30 bg-muted text-muted-foreground text-xs py-1 px-2.5 font-medium flex items-center gap-1.5"
        >
          <InfoCircle size="14" variant="Bold" className="shrink-0" />
          <span>Not independently reviewed</span>
        </Badge>
        {showFormulaButton && (
          <FormulaPopover triggerText="Why?" />
        )}
      </div>
    );
  }

  // Categorize score for paired visual label + icon
  let tierLabel = "Uncertain / Mixed";
  let tierIcon = Warning2;
  let tierColor = "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10";
  let barColor = "bg-amber-500";

  if (finalScore >= 65) {
    tierLabel = "High Confidence: True";
    tierIcon = ShieldTick;
    tierColor = "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
    barColor = "bg-emerald-500";
  } else if (finalScore <= 35) {
    tierLabel = "High Confidence: False";
    tierIcon = ShieldCross;
    tierColor = "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10";
    barColor = "bg-red-500";
  }

  const TierIcon = tierIcon;

  if (size === "sm") {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <Badge variant="outline" className={`font-mono font-bold text-xs py-0.5 px-2 flex items-center gap-1 ${tierColor}`}>
          <TierIcon size="12" variant="Bold" />
          <span>{finalScore}/100</span>
        </Badge>
      </div>
    );
  }

  if (size === "lg") {
    return (
      <div className={`rounded-xl border p-5 bg-card text-card-foreground shadow-xs space-y-4 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Award size="16" variant="Bold" className="text-primary" />
              Consensus Truth Score
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold tracking-tight font-mono text-foreground">
                {finalScore}
              </span>
              <span className="text-muted-foreground text-sm font-semibold">/ 100</span>
            </div>
          </div>
          <Badge variant="outline" className={`px-3 py-1 text-xs font-semibold flex items-center gap-1.5 ${tierColor}`}>
            <TierIcon size="16" variant="Bold" />
            <span>{tierLabel}</span>
          </Badge>
        </div>

        {/* Progress meter bar */}
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${finalScore}%` }}
              role="progressbar"
              aria-valuenow={finalScore}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Truth score percentage"
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>0 (Contradicted)</span>
            <span>50 (Uncertain)</span>
            <span>100 (Verified True)</span>
          </div>
        </div>

        {showFormulaButton && (
          <div className="pt-1 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
            <span>Computed across 5 independent AI jurors</span>
            <FormulaPopover triggerText="View Deterministic Formula" />
          </div>
        )}
      </div>
    );
  }

  // Medium / default size
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Badge variant="outline" className={`font-mono text-sm py-1 px-3 flex items-center gap-1.5 font-bold ${tierColor}`}>
        <TierIcon size="14" variant="Bold" />
        <span>Truth Score: {finalScore}/100</span>
      </Badge>
      <span className="text-xs text-muted-foreground hidden sm:inline">({tierLabel})</span>
      {showFormulaButton && <FormulaPopover triggerText="Formula" />}
    </div>
  );
}

function FormulaPopover({ triggerText }: { triggerText: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
          <InfoCircle size="14" variant="Bold" className="mr-1" />
          {triggerText}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-84 sm:w-96 text-xs p-4 space-y-3" align="start">
        <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
          <Award size="16" variant="Bold" className="text-primary" />
          Deterministic Truth Score Formula
        </h4>
        <p className="text-muted-foreground leading-relaxed">
          The Truth Score is computed purely through deterministic arithmetic over the <strong>terminal valid jury round</strong>:
        </p>
        <div className="bg-muted p-2.5 rounded-md font-mono text-[11px] space-y-1">
          <div>• YES vote: Probability = ConfidenceBps</div>
          <div>• NO vote: Probability = 10,000 - ConfidenceBps</div>
          <div>• UNSURE vote: Probability = 5,000 Bps</div>
          <div className="pt-1 border-t border-border font-bold">
            TruthScoreBps = (Σ Probability + ⌊N / 2⌋) / N
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Claims settled optimistically without a challenged jury round return <em>&quot;Not independently reviewed&quot;</em> to avoid fabricating synthetic scores.
        </p>
      </PopoverContent>
    </Popover>
  );
}

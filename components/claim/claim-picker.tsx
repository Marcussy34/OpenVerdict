"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown2, ArrowRight, Refresh } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface ExtractedClaimCandidate {
  claim: string;
  reason: string;
  quote: string;
}

export interface ClaimPickerProps {
  candidates: ExtractedClaimCandidate[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  language?: string;
  onVerify: () => void;
  onEdit: () => void;
  onStartOver: () => void;
  submitting?: boolean;
}

/**
 * Claim picker: renders extracted candidates as an accessible radio group.
 * Allows selecting a candidate, toggling rationale, editing, or verifying.
 */
export function ClaimPicker({
  candidates,
  selectedIndex,
  onSelectIndex,
  language,
  onVerify,
  onEdit,
  onStartOver,
  submitting = false,
}: ClaimPickerProps) {
  // Track open state for per-candidate rationale accordions.
  const [expandedReasons, setExpandedReasons] = useState<Record<number, boolean>>({});

  const toggleWhy = (index: number) => {
    setExpandedReasons((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const count = candidates.length;
  const countLabel = count === 1 ? "Found 1 claim" : `Found ${count} claims`;
  const isNonEnglish = Boolean(
    language &&
      language !== "und" &&
      language !== "en" &&
      !language.startsWith("en-"),
  );

  const selected = candidates[selectedIndex];

  return (
    <div className="space-y-4">
      {/* Header showing candidate count and detected non-English language tag */}
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold text-ocean">{countLabel}</p>
        {isNonEnglish && (
          <p className="text-xs text-muted-foreground">
            Detected language: {language}
          </p>
        )}
      </div>

      {/* Accessible radio group of candidates */}
      <div
        role="radiogroup"
        aria-label="Extracted claim candidates"
        className="space-y-2.5"
      >
        {candidates.map((candidate, index) => {
          const isSelected = selectedIndex === index;
          const isExpanded = Boolean(expandedReasons[index]);
          const hasQuote = candidate.quote.trim().length > 0;
          const hasReason = candidate.reason.trim().length > 0;

          return (
            <label
              key={index}
              className={cn(
                "ov-edge group relative flex cursor-pointer items-start gap-3.5 rounded-2xl border bg-card p-4 transition-all focus-within:ring-2 focus-within:ring-ring focus-within:outline-none",
                isSelected
                  ? "border-ocean ring-1 ring-ocean shadow-xs"
                  : "border-border hover:border-ocean/40",
              )}
            >
              <input
                type="radio"
                name="claim-candidate"
                value={index}
                checked={isSelected}
                onChange={() => onSelectIndex(index)}
                className="sr-only"
              />

              {/* Custom radio button marker */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
                  isSelected
                    ? "border-ocean bg-ocean text-primary-foreground"
                    : "border-muted-foreground/40 bg-transparent group-hover:border-ocean/60",
                )}
              >
                {isSelected && <span className="size-1.5 rounded-full bg-white" />}
              </span>

              <div className="min-w-0 flex-1 space-y-1.5">
                {/* The candidate claim sentence in medium weight */}
                <p className="text-sm font-medium leading-snug text-ocean">
                  {candidate.claim}
                </p>

                {/* Source quote in muted text, prefixed with a quotation mark */}
                {hasQuote && (
                  <p className="text-xs leading-relaxed text-muted-foreground italic">
                    “{candidate.quote}”
                  </p>
                )}

                {/* Small why toggle that reveals the model's reason */}
                {hasReason && (
                  <div className="pt-0.5">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleWhy(index);
                      }}
                      className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-muted-foreground transition-colors hover:text-ocean focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span>Why?</span>
                      <ArrowDown2
                        size="12"
                        className={cn(
                          "transition-transform motion-safe:duration-150",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>

                    {isExpanded && (
                      <div className="mt-2 rounded-xl border border-border bg-surface/60 p-3 text-xs leading-relaxed text-muted-foreground">
                        {candidate.reason}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* Actions under the candidate list */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onVerify}
            disabled={submitting || !selected}
            aria-busy={submitting}
            className="min-h-12 px-6 font-semibold shadow-xs"
          >
            {submitting ? (
              <>
                <Refresh size="16" variant="Linear" className="motion-safe:animate-spin" />
                Freezing to Walrus (about 20 s)…
              </>
            ) : (
              <>
                Verify this claim
                <ArrowRight size="16" variant="Bold" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            disabled={submitting}
            className="min-h-12 px-5 font-semibold"
          >
            Edit
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onStartOver}
          disabled={submitting}
          className="min-h-12 text-xs text-muted-foreground hover:text-foreground"
        >
          Start over
        </Button>
      </div>
    </div>
  );
}

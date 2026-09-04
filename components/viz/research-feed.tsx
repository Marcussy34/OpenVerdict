"use client";

import { DocumentText, Global, SearchNormal1 } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  researchStepWords,
  type ResearchFeedKind,
  type ResearchFeedStep,
} from "@/lib/viz/research-feed";

const STEP_ICON: Record<ResearchFeedKind, typeof SearchNormal1> = {
  search: SearchNormal1,
  open: Global,
  answer: DocumentText,
};

/**
 * One juror's live research feed: the searches and pages of this seat, in the
 * order it took them, as the public `research_step` events land. Queries and
 * URLs are public web material; the vote and the reasoning stay sealed until
 * reveal, so the lane keeps its sealed state around this list.
 */
export function ResearchFeed({
  steps,
  className,
}: {
  steps: readonly ResearchFeedStep[];
  className?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol className={cn("space-y-1.5", className)}>
      {steps.map((step) => {
        const Icon = STEP_ICON[step.kind];
        return (
          <li
            key={`${step.runId ?? ""}:${step.ordinal}`}
            className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"
          >
            <Icon size="13" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{researchStepWords(step)}</span>
          </li>
        );
      })}
    </ol>
  );
}

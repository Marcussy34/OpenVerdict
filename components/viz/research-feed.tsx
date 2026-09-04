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
 *
 * Drawn as a mini timeline: one hairline connector down the icon column, one
 * line per step, wrapping freely inside a narrow juror card.
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
    <ol className={cn("relative space-y-2", className)}>
      {/* The connector runs behind the icons; each icon sits on the card
          ground, so the line reads as one stroke broken by the steps. */}
      <span
        aria-hidden
        className="absolute inset-y-2 left-[7px] w-px bg-border"
      />
      {steps.map((step) => {
        const Icon = STEP_ICON[step.kind];
        return (
          <li
            key={`${step.runId ?? ""}:${step.ordinal}`}
            className="relative flex items-start gap-2.5"
          >
            <span className="mt-px grid size-[15px] shrink-0 place-items-center bg-card text-foreground/55">
              <Icon size="11" variant="Bold" />
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-snug break-words text-muted-foreground">
              {researchStepWords(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

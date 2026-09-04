"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { ModelLogo, modelVariantFor } from "@/components/viz/model-logo";
import { OUTCOME_CHIP } from "@/components/claim/claim-format";
import { Judge } from "@/components/icons";
import type {
  ClaimInspection,
  DeliberationTurnPublic,
} from "@/lib/engine/contract";
import { familyOfModelId, type JurorFamily } from "@/lib/viz/deliberation-graph";
import { cn } from "@/lib/utils";

type SeatMeta = {
  seatTag: string;
  family: JurorFamily;
  modelId?: string;
  /** Tint index among the seats holding the same model. */
  variant: number;
};

/** Human labels for the reasons a debater's turn was skipped. */
const SKIP_LABEL: Record<string, string> = {
  PROVIDER_ERROR: "provider error",
  TIMEOUT: "timed out",
  INVALID_OUTPUT: "invalid output",
  INVALID_CITATIONS: "invalid citations",
  WINDOW_EXHAUSTED: "window closed",
};

function seatMetaByJurySeat(
  commitments: ClaimInspection["commitments"],
): Map<string, SeatMeta> {
  const meta = new Map<string, SeatMeta>();
  const seats = commitments.map((commitment) => ({
    id: commitment.jurySeatId,
    modelId: commitment.modelId,
  }));
  for (const [index, commitment] of commitments.entries()) {
    meta.set(commitment.jurySeatId, {
      seatTag: `Seat ${index + 1}`,
      family: familyOfModelId(commitment.modelId),
      ...(commitment.modelId === undefined ? {} : { modelId: commitment.modelId }),
      variant: modelVariantFor(seats, commitment.jurySeatId),
    });
  }
  return meta;
}

/** One citation chip: URLs open in a new tab, evidence ids stay inert. */
function CitationChip({ value }: { value: string }) {
  const isUrl = value.startsWith("http://") || value.startsWith("https://");
  const label = value.length > 34 ? `${value.slice(0, 31)}…` : value;
  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="max-w-56 truncate rounded-full border border-chain/25 bg-sea/8 px-2 py-0.5 font-mono text-[10px] font-medium text-chain hover:bg-sea/15"
      >
        {label}
      </a>
    );
  }
  return (
    <span className="max-w-56 truncate rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * Live deliberation chat, docked bottom-centre of the canvas. Revealed
 * round-1 jurors argue their case here between the rounds; every turn is
 * public the moment it happens and replayable afterwards. Renders nothing
 * unless the claim has turns or the deliberation window is live.
 */
export function DeliberationChat({
  turns,
  commitments,
  live,
  convergedAfterExchange,
}: {
  turns: DeliberationTurnPublic[];
  commitments: ClaimInspection["commitments"];
  live: boolean;
  convergedAfterExchange?: 1 | 2 | 3 | null;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Follow the conversation: newest turn scrolls into view as it lands.
  const turnCount = turns.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [turnCount, open, reduceMotion]);

  if (turnCount === 0 && !live) return null;
  const meta = seatMetaByJurySeat(commitments);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      {open ? (
        <div className="pointer-events-auto flex w-[min(620px,100%)] flex-col overflow-hidden border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Judge size="14" variant="Bold" className="text-unsure" />
            <span className="ov-micro ov-micro-sm text-unsure">Deliberation</span>
            {live ? (
              <span aria-hidden className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-unsure opacity-70 motion-reduce:hidden" />
                <span className="relative inline-flex size-1.5 rounded-full bg-unsure" />
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {turnCount} {turnCount === 1 ? "turn" : "turns"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto min-h-8 px-2 text-[13px] font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
            >
              Hide
            </button>
          </div>
          <div ref={scrollRef} className="ov-scroll flex max-h-[36vh] flex-col gap-3 overflow-y-auto px-4 py-3">
            {turnCount === 0 ? (
              <p className="py-2 text-center text-[13px] text-muted-foreground">
                Jurors are preparing their arguments…
              </p>
            ) : (
              turns.map((turn, index) => {
                const seat = meta.get(turn.jurySeatId);
                const skipped = turn.status === "SKIPPED";
                const lastInExchange = turns[index + 1]?.exchange !== turn.exchange;
                const convergenceCopy = lastInExchange
                  && turn.exchange === convergedAfterExchange
                  ? `Debate converged after exchange ${turn.exchange}: nobody moved`
                  : !live
                    && convergedAfterExchange == null
                    && turn.exchange === 3
                    && index === turns.length - 1
                    ? "Three exchanges, no convergence: to the vote"
                    : null;
                return (
                  <Fragment key={turn.ordinal}>
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className={cn("flex gap-2.5", skipped && "opacity-60")}
                    >
                      <ModelLogo
                        modelId={seat?.modelId}
                        variant={seat?.variant ?? 0}
                        size={26}
                        round
                        className={cn("mt-0.5", skipped && "opacity-60")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[13px] font-semibold text-foreground">
                            {seat?.seatTag ?? "Seat ?"}
                          </span>
                          <span className="ov-micro ov-micro-sm border border-border px-1.5 text-muted-foreground">
                            R1 · E{turn.exchange}
                          </span>
                        </div>
                        {skipped ? (
                          <p className="mt-1 text-[13px] text-muted-foreground italic">
                            did not speak
                            {turn.failureStatus === undefined
                              ? ""
                              : ` · ${SKIP_LABEL[turn.failureStatus] ?? turn.failureStatus.toLowerCase()}`}
                          </p>
                        ) : (
                          <>
                            <p className="mt-1 text-[13px] leading-relaxed break-words text-foreground/85">
                              {turn.argument}
                            </p>
                            {turn.stance !== undefined || turn.confidenceBps !== undefined ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {turn.stance !== undefined ? (
                                  <span className={cn(
                                    "ov-micro ov-micro-sm rounded-full px-2",
                                    OUTCOME_CHIP[turn.stance],
                                  )}>
                                    {turn.stance}
                                  </span>
                                ) : null}
                                {turn.confidenceBps !== undefined ? (
                                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                    confidence {turn.confidenceBps / 100}%
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {turn.citations.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {turn.citations.map((citation) => (
                                  <CitationChip key={citation} value={citation} />
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </motion.div>
                    {convergenceCopy !== null ? (
                      <div className="ov-micro ov-micro-sm flex items-center gap-2 py-1 text-center text-unsure">
                        <span className="h-px flex-1 bg-border" />
                        <span>{convergenceCopy}</span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ov-micro ov-micro-sm pointer-events-auto inline-flex min-h-10 items-center gap-2 border border-border bg-card px-4 text-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
        >
          <Judge size="14" variant="Bold" className="text-unsure" />
          Deliberation · {turnCount} {turnCount === 1 ? "turn" : "turns"}
          {live ? (
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-unsure opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-1.5 rounded-full bg-unsure" />
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}

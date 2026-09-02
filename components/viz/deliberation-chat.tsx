"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { JurorAvatar } from "@/components/agents/avatar";
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
  avatarKey?: string;
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
  for (const [index, commitment] of commitments.entries()) {
    meta.set(commitment.jurySeatId, {
      seatTag: `Seat ${index + 1}`,
      family: familyOfModelId(commitment.modelId),
      avatarKey: commitment.agentProfileId,
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
        className="max-w-56 truncate rounded-full bg-[#0e76ff]/20 px-2 py-0.5 font-mono text-[9px] font-medium text-[#9ecbff] hover:bg-[#0e76ff]/35"
      >
        {label}
      </a>
    );
  }
  return (
    <span className="max-w-56 truncate rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] font-medium text-white/70">
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
        <div className="pointer-events-auto flex w-[min(620px,100%)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#07162f]/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2">
            <Judge size="14" variant="Bold" />
            <span className="text-[10px] font-bold tracking-[0.18em] text-[#ffd98c] uppercase">
              Deliberation
            </span>
            {live ? (
              <span aria-hidden className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ffc65c] opacity-70 motion-reduce:hidden" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[#ffc65c]" />
              </span>
            ) : null}
            <span className="text-[10px] font-medium text-white/50 tabular-nums">
              {turnCount} {turnCount === 1 ? "turn" : "turns"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-white/10 hover:text-white"
            >
              Hide
            </button>
          </div>
          <div ref={scrollRef} className="flex max-h-[36vh] flex-col gap-2.5 overflow-y-auto px-3.5 py-2.5">
            {turnCount === 0 ? (
              <p className="py-2 text-center text-[11px] text-white/45">
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
                      <JurorAvatar
                        family={seat?.family ?? "unknown"}
                        ordinal={turn.ordinal}
                        avatarKey={seat?.avatarKey}
                        size={26}
                        className={cn("mt-0.5", skipped && "grayscale")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[11px] font-bold text-white/90">
                            {seat?.seatTag ?? "Seat ?"}
                          </span>
                          <span className="rounded-full bg-white/10 px-1.5 py-px text-[8px] font-bold tracking-wide text-white/55">
                            R1 · E{turn.exchange}
                          </span>
                        </div>
                        {skipped ? (
                          <p className="mt-0.5 text-[11px] text-white/45 italic">
                            did not speak
                            {turn.failureStatus === undefined
                              ? ""
                              : ` · ${SKIP_LABEL[turn.failureStatus] ?? turn.failureStatus.toLowerCase()}`}
                          </p>
                        ) : (
                          <>
                            <p className="mt-0.5 text-[12px] leading-relaxed break-words text-white/90">
                              {turn.argument}
                            </p>
                            {turn.stance !== undefined || turn.confidenceBps !== undefined ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {turn.stance !== undefined ? (
                                  <span className={cn(
                                    "rounded-full px-2 py-0.5 text-[9px] font-bold",
                                    OUTCOME_CHIP[turn.stance],
                                  )}>
                                    {turn.stance}
                                  </span>
                                ) : null}
                                {turn.confidenceBps !== undefined ? (
                                  <span className="text-[10px] font-medium text-white/55 tabular-nums">
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
                      <div className="flex items-center gap-2 py-1 text-center text-[10px] font-semibold text-[#ffd98c]">
                        <span className="h-px flex-1 bg-white/10" />
                        <span>{convergenceCopy}</span>
                        <span className="h-px flex-1 bg-white/10" />
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
          className="pointer-events-auto inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-[#07162f]/90 px-4 text-xs font-semibold text-white shadow-xl backdrop-blur"
        >
          <Judge size="14" variant="Bold" />
          Deliberation · {turnCount} {turnCount === 1 ? "turn" : "turns"}
          {live ? (
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ffc65c] opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#ffc65c]" />
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}

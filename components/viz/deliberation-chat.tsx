"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  DebateExchangeRule,
  DebateTurnBubble,
  TableStandingCard,
  debateTurnViews,
  type DebateSeatMeta,
} from "@/components/viz/debate-turn";
import { Judge } from "@/components/icons";
import type { DeliberationTurnPublic } from "@/lib/engine/contract";
import { debateStanding } from "@/lib/viz/debate-standing";

/**
 * Live deliberation chat, docked bottom-centre of the canvas. Revealed
 * round-1 jurors argue their case here between the rounds; every turn is
 * public the moment it happens and replayable afterwards. Renders nothing
 * unless the claim has turns or the deliberation window is live.
 */
export function DeliberationChat({
  turns,
  seats,
  live,
  convergedAfterExchange,
}: {
  turns: DeliberationTurnPublic[];
  /** The debaters, numbered as the record numbers them. */
  seats: DebateSeatMeta[];
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
  const standing = debateStanding({
    seats,
    turns,
    running: live,
    convergedAfterExchange: convergedAfterExchange ?? null,
  });
  const views = debateTurnViews({ turns, seats, standing });

  return (
    // The wrapper spans the whole stage so the panel's cap can be read as a
    // share of it, and the dock still sits at the bottom. On a phone the claim
    // and inspect buttons own the bottom strip, so it lifts above them.
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-5 max-lg:pb-20">
      {open ? (
        // Never more than 45 percent of the stage, and never under 280px, so
        // the courtroom ring above keeps about two thirds of its size while
        // the debate is read. The turns and the closing card scroll inside.
        <div className="pointer-events-auto flex max-h-[max(280px,45%)] w-[min(680px,100%)] flex-col overflow-hidden border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Judge size="14" variant="Bold" className="text-muted-foreground" />
            <span className="ov-micro ov-micro-sm text-muted-foreground">Deliberation</span>
            {live ? <LiveTell /> : null}
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
          <div
            ref={scrollRef}
            className="ov-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5"
          >
            {turnCount === 0 ? (
              <p className="py-2 text-center text-[13px] text-muted-foreground">
                Jurors are preparing their arguments…
              </p>
            ) : (
              <>
                {views.map((view, index) => (
                  <Fragment key={view.turn.ordinal}>
                    {views[index - 1]?.turn.exchange !== view.turn.exchange && (
                      <DebateExchangeRule
                        exchange={view.turn.exchange}
                        first={index === 0}
                      />
                    )}
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                    >
                      <DebateTurnBubble {...view} density="compact" />
                    </motion.div>
                  </Fragment>
                ))}
                <TableStandingCard standing={standing} className="mt-0.5 border-border/80" />
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ov-micro ov-micro-sm pointer-events-auto inline-flex min-h-10 items-center gap-2 border border-border bg-card px-4 text-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
        >
          <Judge size="14" variant="Bold" className="text-muted-foreground" />
          Deliberation · {turnCount} {turnCount === 1 ? "turn" : "turns"}
          {live ? <LiveTell /> : null}
        </button>
      )}
    </div>
  );
}

/** The app's one live tell: the accent dot, never a second hue. */
function LiveTell() {
  return (
    <span aria-hidden className="relative flex size-1.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-sea opacity-70 motion-reduce:hidden" />
      <span className="relative inline-flex size-1.5 rounded-full bg-sea" />
    </span>
  );
}

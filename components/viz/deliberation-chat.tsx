"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
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
  insetRight = 0,
}: {
  turns: DeliberationTurnPublic[];
  /** The debaters, numbered as the record numbers them. */
  seats: DebateSeatMeta[];
  live: boolean;
  convergedAfterExchange?: 1 | 2 | 3 | null;
  /**
   * Width of the desktop inspector overlaying the stage's right edge, zero
   * while it is closed. The dock centres on the canvas left of it.
   */
  insetRight?: number;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [maxPanel, setMaxPanel] = useState<number | null>(null);

  // Follow the conversation: newest turn scrolls into view as it lands.
  const turnCount = turns.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    // maxPanel lands after the first paint and shortens the panel, so the
    // follow has to run again or the dock opens stranded at the top.
  }, [turnCount, open, reduceMotion, maxPanel]);

  // The dock takes at most 45 percent of the stage, and never less than
  // 280px, so the courtroom ring above it keeps most of its size while the
  // debate is read; everything past the cap scrolls, the closing card
  // included. Measured off the stage rather than the viewport, because the
  // stage is what the ring has to share.
  useEffect(() => {
    const stage = wrapRef.current?.parentElement ?? null;
    if (stage === null) return;
    const measure = (): void => {
      const height = stage.getBoundingClientRect().height;
      if (height === 0) return;
      setMaxPanel(Math.round(Math.max(280, height * 0.45)));
    };
    const sizes = new ResizeObserver(measure);
    sizes.observe(stage);
    measure();
    return () => sizes.disconnect();
  }, [open, live, turnCount]);

  if (turnCount === 0 && !live) return null;

  const standing = debateStanding({
    seats,
    turns,
    running: live,
    convergedAfterExchange: convergedAfterExchange ?? null,
  });
  const views = debateTurnViews({ turns, seats, standing });

  return (
    // The wrapper hugs the panel: the canvas measures this box to keep the
    // courtroom above the dock. On a phone the claim and inspect buttons own
    // the bottom strip, so the dock lifts above them.
    <div
      ref={wrapRef}
      // The desktop inspector overlays the right edge of the stage, so the
      // dock centres on the canvas still visible left of it. The wrapper
      // keeps spanning the whole stage (the canvas measures it to keep the
      // courtroom clear of the dock); only its right padding grows by the
      // inspector's rendered width, mirroring the inspector's own max-width.
      style={
        {
          "--dock-inset":
            insetRight > 0 ? `calc(1rem + min(${insetRight}px, 100vw - 28rem))` : "1rem",
        } as CSSProperties
      }
      className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4 transition-[padding-right] duration-300 ease-out max-lg:bottom-20 lg:pr-(--dock-inset)"
    >
      {open ? (
        <div
          // The cap is measured, not guessed: see maxPanelHeight below.
          style={maxPanel === null ? undefined : { maxHeight: maxPanel }}
          className="pointer-events-auto flex w-[min(680px,100%)] flex-col overflow-hidden border border-border bg-card shadow-lg"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
            <Judge size="14" variant="Bold" className="text-muted-foreground" />
            <span className="ov-micro ov-micro-sm text-muted-foreground">Debate</span>
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
            className="ov-scroll flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-3.5"
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
          Debate · {turnCount} {turnCount === 1 ? "turn" : "turns"}
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

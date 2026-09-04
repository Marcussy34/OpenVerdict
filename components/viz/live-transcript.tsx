"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { CornerPin, Hairline, SplitButton } from "@/components/landing/primitives";
import { JurorCard, JurorTrailPanel } from "@/components/viz/juror-card";
import { modelVariantFor } from "@/components/viz/model-logo";
import { ExportSquare, Judge } from "@/components/icons";
import { cn } from "@/lib/utils";
import { suiObjectUrl, suiTransactionUrl } from "@/lib/web/explorer";
import { deriveRunId, type BrowserRunProof } from "@/lib/verify/run-proof";
import {
  jurorAt,
  visibleEntriesAt,
  type TranscriptEntry,
  type TranscriptJuror,
  type TranscriptLink,
} from "@/lib/viz/transcript";

/**
 * The mark on the timeline rail, in the entry's own semantic colour. A 6px
 * square, the same mark the landing pins its sections with.
 */
const TONE_MARK: Record<string, string> = {
  neutral: "bg-muted-foreground/60",
  chain: "bg-chain",
  sealed: "bg-sealed",
  yes: "bg-yes",
  no: "bg-no",
  unsure: "bg-unsure",
  alert: "bg-no",
};

/** UTC, the same clock the CLI's watch lines print. */
function clockTime(atMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return "--:--:--Z";
  return `${new Date(atMs).toISOString().slice(11, 19)}Z`;
}

function linkHref(link: TranscriptLink): string {
  if (link.target === "transaction") return suiTransactionUrl(link.id);
  if (link.target === "claim") return `/claims/${encodeURIComponent(link.id)}?view=live`;
  return suiObjectUrl(link.id);
}

function EntryRow({
  entry,
  animate,
  reduceMotion,
}: {
  entry: TranscriptEntry;
  animate: boolean;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: reduceMotion ? 0 : 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex items-start gap-4"
    >
      <span
        aria-hidden
        className={cn(
          "mt-[9px] size-1.5 shrink-0",
          TONE_MARK[entry.tone ?? "neutral"] ?? TONE_MARK.neutral,
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[1.55] text-foreground">{entry.text}</p>
        {entry.detail && (
          <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">{entry.detail}</p>
        )}
        {entry.link && (
          <a
            href={linkHref(entry.link)}
            target={entry.link.target === "claim" ? undefined : "_blank"}
            rel={entry.link.target === "claim" ? undefined : "noreferrer"}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-chain hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
          >
            {entry.link.label}
            <ExportSquare size="11" variant="Bold" />
          </a>
        )}
      </div>
      {/* Every timestamp lands in the same gutter, so the column reads down.
          On a phone the gutter would cost a quarter of the line, so it goes. */}
      <span className="mt-1 w-18 shrink-0 text-right font-mono text-[11px] text-muted-foreground/80 tabular-nums max-sm:hidden">
        {clockTime(entry.atMs)}
      </span>
    </motion.div>
  );
}

/** One run of transcript entries on a single dashed rail. */
function EntryList({
  entries,
  shouldAnimate,
  reduceMotion,
}: {
  entries: readonly TranscriptEntry[];
  shouldAnimate: (entry: TranscriptEntry) => boolean;
  reduceMotion: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <ol className="relative space-y-4">
      {/* The landing's dashed guide, run vertically between the marks. */}
      <span aria-hidden className="ov-vr absolute inset-y-3 left-[2px] w-px" />
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <EntryRow entry={entry} animate={shouldAnimate(entry)} reduceMotion={reduceMotion} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The claim as a conversation: the statement, then every public event in the
 * words `ov watch` uses, with the juror cards where the jury is drawn and the
 * way through to the deliberation graph.
 */
export function LiveTranscript({
  claimId,
  statementFallback,
  entries,
  jurors,
  t,
  onOpenGraph,
  replay,
  proofsByRunId,
  onRequestProof,
  loadingRunIds,
}: {
  claimId: string;
  statementFallback: string;
  entries: TranscriptEntry[];
  jurors: TranscriptJuror[];
  /** Replay cursor; Infinity for the live view. */
  t: number;
  onOpenGraph: () => void;
  /** A replay re-streams every entry, so all of them animate again. */
  replay: { active: boolean };
  proofsByRunId: Record<string, BrowserRunProof>;
  onRequestProof: (runIds: string[]) => void;
  loadingRunIds: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  // Entries present on the first render are already history: only the ones
  // that land while the page is open animate in.
  const [seen] = useState(() => new Set(entries.map((entry) => entry.id)));
  const visible = visibleEntriesAt(entries, t);

  // Follow the stream only when the viewer is already at the bottom, so
  // reading an earlier entry is never interrupted.
  const count = visible.length;
  const settledRef = useRef(false);
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    // The first paint keeps the top of the transcript: only later arrivals pull
    // the view down, and only when the viewer is already reading the newest.
    if (!settledRef.current) {
      settledRef.current = true;
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance > 240) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [count]);

  const toggle = useCallback((index: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const statement = visible.find((entry) => entry.kind === "statement");
  const stream = visible.filter((entry) => entry.kind !== "statement");
  const drawIndex = stream.findIndex((entry) => entry.showJurors === true);
  const drawn = drawIndex !== -1;
  // The jury is a shelf across the whole column, not a list item, so the
  // stream splits around it: everything up to the draw, then everything after.
  const beforeJury = drawn ? stream.slice(0, drawIndex + 1) : stream;
  const afterJury = drawn ? stream.slice(drawIndex + 1) : [];
  const shouldAnimate = (entry: TranscriptEntry) => replay.active || !seen.has(entry.id);

  // Seats of the same model wear different tints, keyed on committee order.
  const seatTints = jurors.map((juror) => ({
    id: String(juror.index),
    modelId: juror.modelId,
  }));

  const jurySection = (
    <section className="@container/jury">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="ov-micro ov-micro-sm text-muted-foreground">The jury</h2>
        <p className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">
          {jurors.length} juror{jurors.length === 1 ? "" : "s"}
        </p>
      </div>
      <Hairline className="mt-3" />

      {/* One row of five once the column is wide enough; three, then one,
          below that. An opened trail is a full-width panel: on a wide row the
          tiles are ordered ahead of every panel, so the row stays five across
          and the panels stack under it; in a single column the panel keeps its
          place directly under the tile it belongs to. */}
      <div className="mt-4 grid grid-cols-1 gap-3 @xl/jury:grid-cols-3 @4xl/jury:grid-cols-5">
        {jurors.map((juror) => {
          const runIds = juror.seats.map((seat) =>
            deriveRunId(claimId, seat.seatId, seat.phase),
          );
          const proof = runIds
            .map((runId) => proofsByRunId[runId])
            .filter((entry): entry is BrowserRunProof => entry !== undefined)
            .at(-1);
          const view = jurorAt(juror, t);
          const variant = modelVariantFor(seatTints, String(juror.index));
          const isOpen = expanded.has(juror.index);
          const panelId = `juror-trail-${juror.index}`;
          const onToggle = () => {
            if (!isOpen) onRequestProof(runIds);
            toggle(juror.index);
          };
          return (
            <Fragment key={juror.index}>
              <JurorCard
                juror={juror}
                view={view}
                expanded={isOpen}
                onToggle={onToggle}
                panelId={panelId}
                variant={variant}
                className="@xl/jury:order-1"
              />
              {isOpen && (
                <JurorTrailPanel
                  juror={juror}
                  view={view}
                  onToggle={onToggle}
                  panelId={panelId}
                  variant={variant}
                  {...(proof === undefined ? {} : { proof })}
                  loadingProof={runIds.some((runId) => loadingRunIds.has(runId))}
                  className="@xl/jury:order-2 @xl/jury:col-span-full"
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );

  return (
    <div
      ref={scrollRef}
      className="ov-scroll h-full overflow-y-auto bg-background px-5 pt-8 pb-24 md:px-7"
    >
      <div className="mx-auto w-full max-w-4xl space-y-8">
        {/* The claim itself, stated once and quietly, above its record. */}
        <div className="relative border border-border bg-card px-4 py-5 sm:px-6">
          <CornerPin className="-top-px -left-px" />
          <p className="ov-micro ov-micro-sm text-muted-foreground">The claim</p>
          <p className="mt-2 text-[19px] leading-snug font-medium tracking-[-0.01em] text-foreground">
            {statement?.text ?? statementFallback}
          </p>
          {statement?.detail && (
            <p className="mt-3 max-w-[70ch] text-[15px] leading-[1.55] text-muted-foreground">
              {statement.detail}
            </p>
          )}
        </div>

        <EntryList
          entries={beforeJury}
          shouldAnimate={shouldAnimate}
          reduceMotion={reduceMotion}
        />

        {drawn ? (
          jurySection
        ) : (
          <p className="flex items-start gap-2.5 text-[15px] leading-[1.55] text-muted-foreground">
            <Judge size="16" variant="Bold" className="mt-0.5 shrink-0 text-muted-foreground/70" />
            The jury appears here the moment Sui&apos;s randomness draws it.
          </p>
        )}

        <EntryList
          entries={afterJury}
          shouldAnimate={shouldAnimate}
          reduceMotion={reduceMotion}
        />

        {/* The graph is the same record drawn as a map; this opens it. */}
        {drawn && (
          <div className="flex flex-wrap items-center justify-between gap-4 border border-border bg-card px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="ov-micro ov-micro-sm text-muted-foreground">The deliberation graph</p>
              <p className="mt-1.5 max-w-[52ch] text-[15px] leading-[1.55] text-muted-foreground">
                The same record drawn as a map: every seat, every search and page it opened,
                every vote, and the certificate at the end.
              </p>
            </div>
            <SplitButton onClick={onOpenGraph} tone="muted">
              Open graph
            </SplitButton>
          </div>
        )}
      </div>
    </div>
  );
}

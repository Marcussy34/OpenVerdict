"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { CornerPin, Hairline, SplitButton } from "@/components/landing/primitives";
import {
  DebateExchangeRule,
  DebateTurnBubble,
  TableStandingCard,
  debateTurnViews,
  type DebateSeatMeta,
} from "@/components/viz/debate-turn";
import { JurorCard, JurorTrailPanel } from "@/components/viz/juror-card";
import { modelVariantFor } from "@/components/viz/model-logo";
import { ExportSquare, Judge, Lock, ShieldTick } from "@/components/icons";
import { cn } from "@/lib/utils";
import { debateStanding } from "@/lib/viz/debate-standing";
import { miniRing } from "@/lib/viz/courtroom-layout";
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
 * The mark on the timeline rail: a 6px square, the same mark the landing pins
 * its sections with. Ink and muted ink carry the rail; only an outcome or a
 * failure earns a colour (owner's palette rule, 2026-09-04).
 */
const TONE_MARK: Record<string, string> = {
  neutral: "bg-muted-foreground/60",
  chain: "bg-foreground",
  sealed: "bg-muted-foreground",
  yes: "bg-yes",
  no: "bg-no",
  unsure: "bg-unsure",
  alert: "bg-no",
};

/** The seat mark on the preview ring, one per juror state. */
const PREVIEW_MARK: Record<string, string> = {
  YES: "border-yes/50 bg-yes",
  NO: "border-no/50 bg-no",
  UNSURE: "border-unsure/50 bg-unsure",
};

/**
 * The courtroom at a glance: one mark per seat in its vote colour or under a
 * lock, and the certificate closing the ring once the claim settles. Same
 * seating chart as the graph, drawn at a small radius, and with the same
 * empty middle.
 */
function CourtroomPreview({
  jurors,
  t,
  settled,
}: {
  jurors: readonly TranscriptJuror[];
  /** Replay cursor, so the ring fills as the record does. */
  t: number;
  /** The settled outcome's tone, or null while the claim is still open. */
  settled: string | null;
}) {
  const ordered = [...jurors].sort((left, right) => left.index - right.index);
  const ring = miniRing(ordered.length, 36);
  return (
    <div
      aria-hidden
      className="relative shrink-0"
      style={{ width: ring.size, height: ring.size }}
    >
      {/* The table: one hairline circle, no dotted ground. */}
      <span
        className="absolute rounded-full border border-border"
        style={{
          left: ring.centre.x - 36,
          top: ring.centre.y - 36,
          width: 72,
          height: 72,
        }}
      />
      {ordered.map((juror, index) => {
        const point = ring.seats[index];
        if (point === undefined) return null;
        const view = jurorAt(juror, t);
        const outcome = view.state === "revealed" ? juror.outcome : undefined;
        return (
          <span
            key={juror.index}
            className={cn(
              "absolute grid size-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border",
              view.state === "failed" && "border-no/60 bg-no/20 text-no",
              outcome === undefined
                ? "border-border bg-card text-muted-foreground"
                : PREVIEW_MARK[outcome],
            )}
            style={{ left: point.x, top: point.y }}
          >
            {view.state === "sealed" ? <Lock size="8" variant="Bold" /> : null}
          </span>
        );
      })}
      {settled === null ? null : (
        <span
          className={cn(
            "absolute grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center border bg-card",
            settled === "no"
              ? "border-no/50 text-no"
              : settled === "unsure"
                ? "border-unsure/50 text-unsure"
                : "border-yes/50 text-yes",
          )}
          style={{ left: ring.certificate.x, top: ring.certificate.y }}
        >
          <ShieldTick size="10" variant="Bold" />
        </span>
      )}
    </div>
  );
}

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
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
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
  debate,
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
  /** What the debate section needs beyond the turns the entries carry. */
  debate: {
    /** The debaters, numbered as the record numbers them. */
    seats: DebateSeatMeta[];
    /** True while the deliberation window is open. */
    live: boolean;
    convergedAfterExchange?: 1 | 2 | 3 | null;
  };
  /** Replay cursor; Infinity for the live view. */
  t: number;
  onOpenGraph: () => void;
  /** A replay re-streams every entry, so all of them animate again. */
  replay: { active: boolean };
  proofsByRunId: Record<string, BrowserRunProof>;
  onRequestProof: (runIds: string[]) => void;
  loadingRunIds: ReadonlySet<string>;
}) {
  // One trail open at a time: opening a juror closes the one that was open
  // (owner: "if you open another one, the previous one will be closed").
  const [expanded, setExpanded] = useState<number | null>(null);
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
    setExpanded((current) => (current === index ? null : index));
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
  // The preview's certificate appears with the line that announces it.
  const settledTone = visible.find((entry) => entry.kind === "final")?.tone ?? null;

  // The debate is a section of its own, where the record put it: every turn
  // in full rather than a preview (owner: "is it possible to show all
  // conversations rather than just a summary?").
  const debateStart = afterJury.findIndex((entry) => entry.kind === "debate");
  let debateEnd = -1;
  for (let index = afterJury.length - 1; index >= 0; index -= 1) {
    if (afterJury[index]?.kind === "debate") {
      debateEnd = index;
      break;
    }
  }
  const debating = debateStart !== -1;
  const beforeDebate = debating ? afterJury.slice(0, debateStart) : afterJury;
  const debateEntries = debating ? afterJury.slice(debateStart, debateEnd + 1) : [];
  const afterDebate = debating ? afterJury.slice(debateEnd + 1) : [];
  // A replay standing before the last turn is a debate still running, so the
  // closing card shows running counts rather than an ending it cannot know.
  const allTurns = entries.flatMap((entry) => (entry.turn === undefined ? [] : [entry.turn]));
  const shownTurns = debateEntries.flatMap((entry) =>
    entry.turn === undefined ? [] : [entry.turn],
  );
  const standing = debateStanding({
    seats: debate.seats,
    turns: shownTurns,
    running: debate.live || shownTurns.length < allTurns.length,
    convergedAfterExchange: debate.convergedAfterExchange ?? null,
  });
  const turnViews = debateTurnViews({
    turns: shownTurns,
    seats: debate.seats,
    standing,
  });
  const viewByOrdinal = new Map(turnViews.map((view) => [view.turn.ordinal, view]));
  const exchangeStarts = new Set(
    shownTurns
      .filter((turn, index) => shownTurns[index - 1]?.exchange !== turn.exchange)
      .map((turn) => turn.ordinal),
  );

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
          const isOpen = expanded === juror.index;
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

  // The debate, in the flow of the record: one card per turn, in full, and
  // the closing card saying where the table stands.
  const tableSection = (
    <section aria-label="The table">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="ov-micro ov-micro-sm text-muted-foreground">The table</h2>
        <p className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">
          {shownTurns.length} turn{shownTurns.length === 1 ? "" : "s"}
        </p>
      </div>
      <Hairline className="mt-3" />
      <p className="mt-3 max-w-[70ch] text-[15px] leading-[1.55] text-muted-foreground">
        The revealed jurors argue over the frozen record. Each one answers a named seat
        before it states its own position, and no new evidence may enter.
      </p>

      <div className="mt-4 space-y-3">
        {debateEntries.map((entry) => {
          const view = entry.turn === undefined ? undefined : viewByOrdinal.get(entry.turn.ordinal);
          if (view === undefined) {
            // The convergence line is said once, by the closing card below.
            if (entry.kind === "debate") return null;
            return (
              <EntryRow
                key={entry.id}
                entry={entry}
                animate={shouldAnimate(entry)}
                reduceMotion={reduceMotion}
              />
            );
          }
          return (
            <Fragment key={entry.id}>
              {exchangeStarts.has(view.turn.ordinal) && (
                <DebateExchangeRule
                  exchange={view.turn.exchange}
                  first={view.turn.ordinal === shownTurns[0]?.ordinal}
                />
              )}
              <motion.div
                initial={
                  shouldAnimate(entry) ? { opacity: 0, y: reduceMotion ? 0 : 6 } : false
                }
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <DebateTurnBubble
                  {...view}
                  className="border border-border bg-card px-4 py-4 sm:px-5"
                />
              </motion.div>
            </Fragment>
          );
        })}
        <TableStandingCard standing={standing} />
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
          entries={beforeDebate}
          shouldAnimate={shouldAnimate}
          reduceMotion={reduceMotion}
        />

        {debating && tableSection}

        <EntryList
          entries={afterDebate}
          shouldAnimate={shouldAnimate}
          reduceMotion={reduceMotion}
        />

        {/* The graph is the same record drawn as a map; this opens it. */}
        {drawn && (
          <div className="flex flex-wrap items-center justify-between gap-4 border border-border bg-card px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-4">
              <CourtroomPreview jurors={jurors} t={t} settled={settledTone} />
              <div className="min-w-0">
                <p className="ov-micro ov-micro-sm text-muted-foreground">The deliberation graph</p>
                <p className="mt-1.5 max-w-[52ch] text-[15px] leading-[1.55] text-muted-foreground">
                  The same record drawn as a map: every seat, every search and page it opened,
                  every vote, and the certificate at the end.
                </p>
              </div>
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

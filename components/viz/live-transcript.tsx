"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import { DeliberationCanvas } from "@/components/viz/deliberation-canvas";
import { JurorCard } from "@/components/viz/juror-card";
import {
  ExportSquare,
  Hierarchy,
  Judge,
  Play,
  Refresh,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { suiObjectUrl, suiTransactionUrl } from "@/lib/web/explorer";
import type { DeliberationGraph, JurorFamily } from "@/lib/viz/deliberation-graph";
import { deriveRunId, type BrowserRunProof } from "@/lib/verify/run-proof";
import {
  jurorAt,
  visibleEntriesAt,
  type TranscriptEntry,
  type TranscriptJuror,
  type TranscriptLink,
} from "@/lib/viz/transcript";

const TONE_ACCENT: Record<string, string> = {
  neutral: "bg-white/20",
  chain: "bg-[#0e76ff]",
  sealed: "bg-sealed",
  yes: "bg-yes",
  no: "bg-no",
  unsure: "bg-unsure",
  alert: "bg-[#ff8d84]",
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

function EntryRow({ entry, animate }: { entry: TranscriptEntry; animate: boolean }) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="flex gap-3"
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          TONE_ACCENT[entry.tone ?? "neutral"],
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-relaxed text-white/85">{entry.text}</p>
        {entry.detail && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">{entry.detail}</p>
        )}
        {entry.link && (
          <a
            href={linkHref(entry.link)}
            target={entry.link.target === "claim" ? undefined : "_blank"}
            rel={entry.link.target === "claim" ? undefined : "noreferrer"}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#72b6ff] hover:text-white"
          >
            {entry.link.label}
            <ExportSquare size="11" variant="Bold" />
          </a>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-white/30 tabular-nums">
        {clockTime(entry.atMs)}
      </span>
    </motion.div>
  );
}

/**
 * The claim as a conversation: the statement, then every public event in the
 * words `ov watch` uses, with the five juror cards where the jury is drawn and
 * a small graph preview that opens the full canvas.
 */
export function LiveTranscript({
  claimId,
  statementFallback,
  entries,
  jurors,
  t,
  graph,
  avatars,
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
  graph: DeliberationGraph;
  avatars: Partial<Record<JurorFamily, string[]>>;
  onOpenGraph: () => void;
  replay: {
    available: boolean;
    active: boolean;
    onReplay: () => void;
    onSkipToEnd: () => void;
  };
  proofsByRunId: Record<string, BrowserRunProof>;
  onRequestProof: (runIds: string[]) => void;
  loadingRunIds: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const drawn = visible.some((entry) => entry.showJurors === true);
  const drawIndex = stream.findIndex((entry) => entry.showJurors === true);

  const jurorBlock = (
    <div className="space-y-3">
      <div className="grid gap-3 @2xl:grid-cols-2">
        {jurors.map((juror) => {
          const runIds = juror.seats.map((seat) =>
            deriveRunId(claimId, seat.seatId, seat.phase),
          );
          const proof = runIds
            .map((runId) => proofsByRunId[runId])
            .filter((entry): entry is BrowserRunProof => entry !== undefined)
            .at(-1);
          return (
            <JurorCard
              key={juror.index}
              juror={juror}
              view={jurorAt(juror, t)}
              expanded={expanded.has(juror.index)}
              onToggle={() => {
                if (!expanded.has(juror.index)) onRequestProof(runIds);
                toggle(juror.index);
              }}
              {...(proof === undefined ? {} : { proof })}
              loadingProof={runIds.some((runId) => loadingRunIds.has(runId))}
            />
          );
        })}
      </div>

      {/* The graph is the same record drawn as a map; the switcher opens it. */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#04122b]">
        <div className="pointer-events-none h-44">
          <DeliberationCanvas
            graph={graph}
            selectedId={null}
            onSelect={() => undefined}
            avatars={avatars}
            reducedMotion
          />
        </div>
        <button
          type="button"
          onClick={onOpenGraph}
          className="flex min-h-10 w-full items-center justify-center gap-2 border-t border-white/10 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          <Hierarchy size="14" variant="Bold" />
          Open graph
        </button>
      </div>
    </div>
  );

  return (
    <div ref={scrollRef} className="ov-scroll @container h-full overflow-y-auto px-4 pt-24 pb-24">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {replay.available && (
          <div className="flex justify-end">
            {replay.active ? (
              <button
                type="button"
                onClick={replay.onSkipToEnd}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                <Refresh size="13" variant="Bold" />
                Skip to end
              </button>
            ) : (
              <button
                type="button"
                onClick={replay.onReplay}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                <Play size="13" variant="Bold" />
                Replay
              </button>
            )}
          </div>
        )}

        {/* The claim as the person's own message. */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[#0e76ff]/30 bg-[#0e76ff]/12 px-4 py-3">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-white/45 uppercase">
              The claim
            </p>
            <p className="mt-1 text-[15px] leading-relaxed font-medium text-white">
              {statement?.text ?? statementFallback}
            </p>
            {statement?.detail && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">
                {statement.detail}
              </p>
            )}
          </div>
        </div>

        <ol className="space-y-3">
          {stream.map((entry, index) => (
            <li key={entry.id}>
              <EntryRow
                entry={entry}
                // A replay re-streams every entry; live, only new ones move.
                animate={replay.active || !seen.has(entry.id)}
              />
              {index === drawIndex && <div className="mt-4">{jurorBlock}</div>}
            </li>
          ))}
        </ol>

        {!drawn && (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-white/12 bg-white/[0.03] p-4 text-xs text-white/50">
            <Judge size="15" variant="Bold" className="shrink-0 text-white/35" />
            The jury appears here the moment Sui&apos;s randomness draws it.
          </p>
        )}
      </div>
    </div>
  );
}

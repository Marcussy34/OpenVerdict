"use client";

import { ModelLogo, modelVariantFor } from "@/components/viz/model-logo";
import { OUTCOME_CHIP } from "@/components/claim/claim-format";
import { ArrowRight, ShieldCross } from "@/components/icons";
import { OUTCOME } from "@/lib/protocol/constants";
import type { ClaimInspection, DeliberationTurnPublic } from "@/lib/engine/contract";
import {
  endingSentence,
  moveSentence,
  standingCountsText,
  type DebateMove,
  type DebateStanding,
} from "@/lib/viz/debate-standing";
import { modelName } from "@/lib/viz/transcript";
import { cn } from "@/lib/utils";

/** One debater: who it is, the tint it wears, and where round one left it. */
export type DebateSeatMeta = {
  /** The seat number the record itself uses: its place in the phase-1 order,
   *  counted from 1, which is also the juror number the jury tiles show. */
  seatIndex: number;
  jurySeatId: string;
  modelId?: string;
  /** Tint index among the seats holding the same model. */
  variant: number;
  outcome?: "YES" | "NO" | "UNSURE";
};

/**
 * The debaters, numbered the way the debate numbers them: a V4 turn's
 * `answering` and `question.seat` hold the seat's place in the phase-1
 * expected order counted from 1 (lib/engine/engine.ts), which is the same
 * number the jury tiles and `ov trace` show, and the jurors repeat those
 * numbers inside their own sentences. Every number this file prints comes
 * straight off the record, so a bubble can never contradict the sentence it
 * quotes. Claims from before the debate spec counted from 1 keep their own
 * numbers, one lower than the seat they name.
 */
export function debateSeatsOf(
  claim: Pick<ClaimInspection, "commitments" | "rounds">,
): DebateSeatMeta[] {
  const byId = new Map(claim.commitments.map((seat) => [seat.jurySeatId, seat]));
  const phaseOne = claim.rounds?.find((round) => round.phase === 1)?.expectedJurySeatIds;
  // Before the rounds are recorded, the commitments are the only seat order.
  const seatIds =
    phaseOne !== undefined && phaseOne.length > 0
      ? phaseOne
      : claim.commitments.map((seat) => seat.jurySeatId);
  const tints = seatIds.map((jurySeatId) => ({
    id: jurySeatId,
    modelId: byId.get(jurySeatId)?.modelId,
  }));
  return seatIds.map((jurySeatId, position) => {
    const seat = byId.get(jurySeatId);
    const outcome = outcomeLabel(seat?.outcome);
    return {
      seatIndex: position + 1,
      jurySeatId,
      ...(seat?.modelId === undefined ? {} : { modelId: seat.modelId }),
      variant: modelVariantFor(tints, jurySeatId),
      ...(outcome === undefined ? {} : { outcome }),
    };
  });
}

/** The shared u8 vote outcome as its label. */
function outcomeLabel(value: number | undefined): "YES" | "NO" | "UNSURE" | undefined {
  if (value === OUTCOME.YES) return "YES";
  if (value === OUTCOME.NO) return "NO";
  if (value === OUTCOME.UNSURE) return "UNSURE";
  return undefined;
}

/** How a seat is named on screen, in the debate's own numbering. */
export function debateSeatLabel(seatIndex: number): string {
  return `Seat ${seatIndex}`;
}

/** One turn with everything its bubble needs resolved against the record. */
export type DebateTurnView = {
  turn: DeliberationTurnPublic;
  seat?: DebateSeatMeta;
  answering?: DebateSeatMeta;
  answeringQuestion: boolean;
  question?: DebateSeatMeta;
  move?: DebateMove;
};

/**
 * The turns as a thread: who each one answers, whether it is answering a
 * question put to it, who it asks next, and the move it made. Pure, so the
 * dock and the Live view show the same conversation.
 */
export function debateTurnViews(input: {
  turns: readonly DeliberationTurnPublic[];
  seats: readonly DebateSeatMeta[];
  standing: DebateStanding;
}): DebateTurnView[] {
  const byIndex = new Map(input.seats.map((seat) => [seat.seatIndex, seat]));
  const byId = new Map(input.seats.map((seat) => [seat.jurySeatId, seat]));
  const turns = [...input.turns].sort((left, right) => left.ordinal - right.ordinal);
  let previousSpoken: DeliberationTurnPublic | undefined;

  return turns.map((turn) => {
    const seat = byId.get(turn.jurySeatId);
    const answering =
      typeof turn.answering === "number" ? byIndex.get(turn.answering) : undefined;
    // The hand-off the spec describes: the seat that just spoke asked this
    // one a question, so this turn opens by answering it.
    const previousSeat =
      previousSpoken === undefined ? undefined : byId.get(previousSpoken.jurySeatId);
    const answeringQuestion =
      seat !== undefined
      && answering !== undefined
      && previousSpoken?.question?.seat === seat.seatIndex
      && previousSeat?.seatIndex === answering.seatIndex;
    const asked =
      turn.question === undefined ? undefined : byIndex.get(turn.question.seat);
    const move = input.standing.moveByOrdinal.get(turn.ordinal);
    const view: DebateTurnView = {
      turn,
      answeringQuestion,
      ...(seat === undefined ? {} : { seat }),
      ...(answering === undefined ? {} : { answering }),
      ...(asked === undefined ? {} : { question: asked }),
      ...(move === undefined ? {} : { move }),
    };
    if (turn.status === "SPOKEN") previousSpoken = turn;
    return view;
  });
}

/** Human labels for the reasons a debater's turn was skipped. */
const SKIP_LABEL: Record<string, string> = {
  PROVIDER_ERROR: "provider error",
  TIMEOUT: "timed out",
  INVALID_OUTPUT: "invalid output",
  INVALID_LENGTH: "over length",
  INVALID_ANSWERING: "answered nobody",
  INVALID_QUESTION: "invalid question",
  INVALID_CITATIONS: "invalid citations",
  WINDOW_EXHAUSTED: "window closed",
};

/** UTC, the same clock the CLI's watch lines print. */
function clockTime(atMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return "--:--:--Z";
  return `${new Date(atMs).toISOString().slice(11, 19)}Z`;
}

/** One citation chip: URLs open in a new tab, evidence ids stay inert. */
export function CitationChip({ value }: { value: string }) {
  const isUrl = value.startsWith("http://") || value.startsWith("https://");
  const label = value.length > 34 ? `${value.slice(0, 31)}…` : value;
  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        title={value}
        className="max-w-56 truncate rounded-full border border-chain/25 bg-sea/8 px-2 py-0.5 font-mono text-[10px] font-medium text-chain hover:bg-sea/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]"
      >
        {label}
      </a>
    );
  }
  return (
    <span
      title={value}
      className="max-w-56 truncate rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
    >
      {label}
    </span>
  );
}

/** The stance and its confidence, with the move that got there. */
function StanceChip({
  stance,
  confidenceBps,
  move,
}: {
  stance: "YES" | "NO" | "UNSURE";
  confidenceBps?: number;
  move?: DebateMove;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
      {move !== undefined && (
        <span className="text-[11px] text-muted-foreground">moved from {move.from}</span>
      )}
      <span className={cn("ov-micro ov-micro-sm rounded-full px-2", OUTCOME_CHIP[stance])}>
        {stance}
      </span>
      {confidenceBps !== undefined && (
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {Math.round(confidenceBps / 100)}%
        </span>
      )}
    </span>
  );
}

/**
 * One debate turn, the same bubble in the graph dock and in the Live view.
 *
 * A V4 turn reads in the order it was thought: the point being answered, the
 * juror's own analysis of it, the question it hands on, then the position,
 * and only then the stance. A V1 to V3 turn has nothing but its argument, so
 * it takes the same frame with the body it has.
 */
export function DebateTurnBubble({
  turn,
  seat,
  answering,
  answeringQuestion = false,
  question,
  move,
  density = "comfortable",
  className,
}: {
  turn: DeliberationTurnPublic;
  /** The speaking seat; absent for a seat the record does not name. */
  seat?: DebateSeatMeta;
  /** The seat whose point this turn answers. */
  answering?: DebateSeatMeta;
  /** True when the point being answered is a question put to this seat. */
  answeringQuestion?: boolean;
  /** The seat this turn puts its question to. */
  question?: DebateSeatMeta;
  /** Set when this turn changed the seat's stance. */
  move?: DebateMove;
  /** "compact" is the dock; "comfortable" is the Live view's own type scale. */
  density?: "compact" | "comfortable";
  className?: string;
}) {
  const compact = density === "compact";
  const body = compact ? "text-[13px]" : "text-[15px]";
  const quiet = compact ? "text-[12px]" : "text-[13px]";
  const skipped = turn.status === "SKIPPED";
  const seatName = seat === undefined ? "Seat ?" : debateSeatLabel(seat.seatIndex);
  const modelId = seat?.modelId ?? turn.modelId;
  // The Live view builds turns from the event payload, so a field the engine
  // omitted must never take the whole transcript down with it.
  const citations = turn.citations ?? [];

  return (
    <article className={cn("flex gap-3", skipped && "opacity-70", className)}>
      <ModelLogo
        modelId={modelId}
        variant={seat?.variant ?? 0}
        size={24}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        {/* Who is speaking, on which exchange, and when. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-foreground">{seatName}</span>
          <span className="min-w-0 truncate text-[13px] text-muted-foreground" title={modelId}>
            {modelId === undefined ? "model pending" : modelName(modelId)}
          </span>
          <span className="ov-micro ov-micro-sm border border-border px-1.5 text-muted-foreground">
            R1 · E{turn.exchange}
          </span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/80 tabular-nums">
            {clockTime(turn.atMs)}
          </span>
        </div>

        {skipped ? (
          <p className={cn("mt-1.5 flex items-start gap-1.5 leading-[1.55] text-no", quiet)}>
            <ShieldCross size="13" variant="Bold" className="mt-0.5 shrink-0" />
            <span>
              {seatName} skipped
              {turn.failureStatus === undefined
                ? ""
                : ` (${SKIP_LABEL[turn.failureStatus] ?? turn.failureStatus.toLowerCase()})`}
              . No stance is ever invented for a seat that failed closed.
            </span>
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {/* 1. The point on the table, quoted before it is weighed. */}
            {turn.theirPoint !== undefined && turn.theirPoint.length > 0 && (
              <div>
                <p className={cn("text-muted-foreground/80", quiet)}>
                  answering {answeringLabel(turn, answering)}
                  {answeringQuestion ? "'s question" : ""}
                </p>
                <p
                  className={cn(
                    "mt-1 border-l border-border pl-3 leading-[1.55] break-words text-muted-foreground",
                    quiet,
                  )}
                >
                  {turn.theirPoint}
                </p>
              </div>
            )}

            {/* 2. The juror's own reading of it, in full. */}
            <p className={cn("leading-[1.55] break-words text-foreground/85", body)}>
              {turn.analysis ?? turn.argument}
            </p>

            {/* 3. The hand-off, so the next turn has a reason to exist. */}
            {turn.question !== undefined && (
              <p className={cn("flex items-start gap-1.5 leading-[1.55] text-foreground/85", quiet)}>
                <ArrowRight size="12" variant="Bold" className="mt-[3px] shrink-0 text-chain" />
                <span className="min-w-0 break-words">
                  <span className="font-medium text-chain">
                    asks{" "}
                    {question === undefined
                      ? debateSeatLabel(turn.question.seat)
                      : debateSeatLabel(question.seatIndex)}
                  </span>
                  : {turn.question.text}
                </span>
              </p>
            )}

            {/* 4. The conclusion, stated after the reasoning that earned it. */}
            {turn.position !== undefined && turn.position.length > 0 && (
              <p className={cn("leading-[1.55] break-words font-medium text-foreground", body)}>
                {turn.position}
              </p>
            )}

            {/* 5. Citations, then the stance: the vote follows the argument. */}
            {(citations.length > 0 || turn.stance !== undefined) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5">
                {citations.map((citation) => (
                  <CitationChip key={citation} value={citation} />
                ))}
                {turn.stance !== undefined && (
                  <StanceChip
                    stance={turn.stance}
                    {...(turn.confidenceBps === undefined
                      ? {}
                      : { confidenceBps: turn.confidenceBps })}
                    {...(move === undefined ? {} : { move })}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Where one exchange ends and the next begins. */
export function DebateExchangeRule({
  exchange,
  first,
  className,
}: {
  exchange: 1 | 2 | 3;
  first: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "ov-micro ov-micro-sm flex items-center gap-2 text-muted-foreground/80",
        first ? "pb-0.5" : "pt-1.5",
        className,
      )}
    >
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span>Exchange {exchange}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The seat being answered: the meta when the record names it, else its number. */
function answeringLabel(
  turn: DeliberationTurnPublic,
  answering: DebateSeatMeta | undefined,
): string {
  if (answering !== undefined) return debateSeatLabel(answering.seatIndex);
  return typeof turn.answering === "number"
    ? debateSeatLabel(turn.answering)
    : "another seat";
}

/**
 * Where the table stands: the counts, who moved and how the debate ended.
 * A description of the discussion, never a verdict, so it says out loud that
 * the sealed table vote is what decides.
 */
export function TableStandingCard({
  standing,
  className,
}: {
  standing: DebateStanding;
  className?: string;
}) {
  const running = standing.ending.kind === "running";
  if (standing.counts.length === 0 && standing.moves.length === 0) return null;

  return (
    <section
      // The recessed surface, so the closing card reads as a summary of the
      // turns above it rather than as another seat speaking.
      className={cn("border border-border bg-surface px-4 py-3.5 sm:px-5", className)}
      aria-label="Where the table stands"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="ov-micro ov-micro-sm text-muted-foreground">Where the table stands</h3>
        {running && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sea opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-1.5 rounded-full bg-sea" />
            </span>
            <span className="font-mono text-[11px] text-chain tabular-nums">
              exchange {standing.ending.kind === "running" ? standing.ending.exchange : 1} of 3
            </span>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {standing.counts.map((entry) => (
            <span
              key={entry.stance}
              className={cn(
                "ov-micro ov-micro-sm rounded-full px-2 tabular-nums",
                OUTCOME_CHIP[entry.stance],
              )}
            >
              {entry.count} {entry.stance}
            </span>
          ))}
        </span>
      </div>

      <div className="mt-2.5 space-y-1">
        {standing.moves.map((move) => (
          <p key={move.ordinal} className="text-[13px] leading-[1.55] text-foreground/85">
            {moveSentence(move, debateSeatLabel)}
          </p>
        ))}
        {!running && standing.moves.length === 0 && (
          <p className="text-[13px] leading-[1.55] text-muted-foreground">
            {standing.spokenTurns === 0
              ? "No seat spoke: every turn failed closed, so the round-one votes stand."
              : `Nobody changed their vote: ${standingCountsText(standing.counts)} from the first exchange to the last.`}
          </p>
        )}
        {/* The header already carries the exchange, so a live card says what
            the counts are, not where the debate has got to. */}
        <p className="text-[13px] leading-[1.55] text-muted-foreground">
          {running ? "The counts move as the seats speak." : endingSentence(standing.ending)}{" "}
          The sealed table vote of round two is what decides the claim.
        </p>
      </div>
    </section>
  );
}

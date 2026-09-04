"use client";

import {
  Fragment,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FullReport } from "@/components/claim/full-report";
import { CommandRow } from "@/components/verify/agent-handoff";
import { useClaimEvents } from "@/components/use-claim-events";
import { useNow } from "@/components/use-now";
import { Hairline } from "@/components/landing/primitives";
import {
  DebateTurnBubble,
  debateSeatsOf,
  debateTurnViews,
  type DebateTurnView,
} from "@/components/viz/debate-turn";
import { HashChip } from "@/components/viz/hash-chip";
import { JurorTrailPanel } from "@/components/viz/juror-card";
import { ModelLogo, modelVariantFor } from "@/components/viz/model-logo";
import { VerdictGauge } from "@/components/viz/verdict-gauge";
import { isStrandedDiscussion } from "@/lib/engine/claim-lifecycle";
import { OUTCOME } from "@/lib/protocol/constants";
import { cn } from "@/lib/utils";
import { deriveRunId, type BrowserRunProof } from "@/lib/verify/run-proof";
import { debateStanding } from "@/lib/viz/debate-standing";
import { buildTranscript, jurorAt, type TranscriptJuror } from "@/lib/viz/transcript";
import type {
  ClaimInspection,
  DeliberationTurnPublic,
  FactCheckReport,
  ResolutionEvent,
} from "@/lib/engine/contract";
import { ArrowDown2, ArrowLeft2, ExportSquare, Refresh, Warning2 } from "@/components/icons";

interface ClaimReportPageProps {
  params: Promise<{ id: string }>;
}

/** The public console, for a page rendered before the browser reports its origin. */
const FALLBACK_ORIGIN = "https://app.openverdict.info";

/** The origin never changes while the page is open, so nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};
const readOrigin = () => window.location.origin;
const readFallbackOrigin = () => FALLBACK_ORIGIN;

/** The only hues on this page: a verdict, a vote, a failure. */
const OUTCOME_TEXT: Record<string, string> = {
  YES: "text-yes",
  NO: "text-no",
  UNSURE: "text-unsure",
};

/** Where a running claim has got to, in as few words as the state allows. */
const PHASE_WORD: Record<number, string> = {
  0: "jury forming",
  1: "jury forming",
  2: "jury forming",
  3: "jury forming",
  4: "round one, sealed",
  5: "round one, reveal",
  6: "discussion",
  7: "round two, sealed",
  8: "round two, reveal",
};

/** The milestones the record lists; every other event kind is engine detail. */
const MILESTONE: Record<string, string> = {
  claim_created: "Claim created",
  committee_selected: "Committee drawn",
  evidence_frozen: "Evidence frozen",
  run_approved: "Run approved",
  vote_committed: "Vote sealed",
  phase_changed: "Phase change",
  vote_revealed: "Vote revealed",
  DELIBERATION_TURN: "Debate turn",
  debate_converged: "Debate ended",
  output_repaired: "Output repaired",
  inference_failed: "Seat failed",
  claim_finalized: "Finalized",
  verification_voided: "Attempt voided",
  verification_relaunched: "Relaunched",
  verification_gave_up: "Gave up",
};

/** The shared u8 vote outcome as its label. */
function outcomeOf(value: number | undefined): "YES" | "NO" | "UNSURE" | undefined {
  if (value === OUTCOME.YES) return "YES";
  if (value === OUTCOME.NO) return "NO";
  if (value === OUTCOME.UNSURE) return "UNSURE";
  return undefined;
}

/** "PROVIDER_ERROR" reads as "Provider error" in a line of its own. */
function reasonSentence(reason: string): string {
  const words = reason.replace(/_/g, " ").trim().toLowerCase();
  return words.length === 0 ? "" : `${words[0]!.toUpperCase()}${words.slice(1)}.`;
}

/** UTC, the clock the whole public record prints. */
function stamp(atMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return "";
  const iso = new Date(atMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

/** The verdict word and the colour it earns, for every state the page serves. */
function verdictOf(
  claim: ClaimInspection,
  stranded: boolean,
): { word: string; className: string; phase?: string } {
  const attempt = claim.attemptChain?.status;
  if (attempt === "VOIDED") return { word: "Voided", className: "text-ocean" };
  if (attempt === "GAVE_UP") return { word: "Gave up", className: "text-ocean" };
  if (claim.state === 12) return { word: "Cancelled", className: "text-ocean" };
  if (claim.state === 11) return { word: "Unresolved", className: "text-ocean" };
  if (claim.state >= 9) {
    const outcome = claim.result?.result;
    return {
      word: outcome ?? "Finalized",
      className: (outcome && OUTCOME_TEXT[outcome]) ?? "text-ocean",
    };
  }
  // The discussion window closed without a second round: a stop, not progress.
  if (stranded) return { word: "Expired", className: "text-ocean" };
  return {
    word: "In progress",
    className: "text-primary",
    ...(PHASE_WORD[claim.state] === undefined ? {} : { phase: PHASE_WORD[claim.state] }),
  };
}

/** One seat as the jury line and the tiles read it. */
type FinalVote = {
  outcome?: "YES" | "NO" | "UNSURE";
  revealed: boolean;
  committed: boolean;
  failed: boolean;
};

/** "4 of 5 jurors said YES, 1 failed." One line, whatever the claim's state. */
function jurySentence(votes: readonly FinalVote[], settled?: string): string {
  const total = votes.length;
  if (total === 0) return "The jury is not drawn yet.";
  const failed = votes.filter((vote) => vote.failed).length;
  const revealed = votes.filter((vote) => vote.outcome !== undefined);
  const sealed = votes.filter(
    (vote) => vote.committed && !vote.revealed && !vote.failed,
  ).length;

  if (revealed.length === 0) {
    if (failed === total) return `${total} jurors failed closed.`;
    if (sealed > 0) return `${sealed} of ${total} votes sealed.`;
    return `${total} jurors drawn, no votes yet.`;
  }

  const counts = new Map<string, number>();
  for (const vote of revealed) {
    counts.set(vote.outcome!, (counts.get(vote.outcome!) ?? 0) + 1);
  }
  const top = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, count]) => count === top);
  // The settled outcome is what the jurors are counted against; without one,
  // the largest group speaks, and a tie is reported as the split it is.
  const target =
    settled !== undefined && counts.has(settled)
      ? settled
      : leaders.length === 1
        ? leaders[0]![0]
        : undefined;

  const extras = [
    sealed > 0 ? `${sealed} sealed` : "",
    failed > 0 ? `${failed} failed` : "",
  ].filter((part) => part.length > 0);
  const tail = extras.length === 0 ? "" : `, ${extras.join(", ")}`;

  if (target === undefined) return `${revealed.length} jurors split${tail}.`;
  return `${counts.get(target)} of ${total} jurors said ${target}${tail}.`;
}

/** The claim's deliberation, snapshot and live stream merged by ordinal. */
function mergeTurns(
  claim: ClaimInspection,
  events: readonly ResolutionEvent[],
): DeliberationTurnPublic[] {
  const byOrdinal = new Map<number, DeliberationTurnPublic>();
  for (const turn of claim.deliberation ?? []) byOrdinal.set(turn.ordinal, turn);
  for (const event of events) {
    if (event.kind !== "DELIBERATION_TURN") continue;
    const payload = event.payload as Partial<DeliberationTurnPublic>;
    if (typeof payload.ordinal !== "number" || typeof payload.jurySeatId !== "string") continue;
    const existing = byOrdinal.get(payload.ordinal);
    byOrdinal.set(
      payload.ordinal,
      existing === undefined
        ? (payload as DeliberationTurnPublic)
        : { ...existing, ...payload },
    );
  }
  return [...byOrdinal.values()].sort((left, right) => left.ordinal - right.ordinal);
}

/** The audit bundle is opaque JSON; read only the field the proof rows need. */
function manifestBlobIds(report: FactCheckReport | null): Map<number, string> {
  const found = new Map<number, string>();
  const entries = report === null ? undefined : report.auditBundle.evidence;
  if (!Array.isArray(entries)) return found;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.phase === "number" && typeof record.manifestBlobId === "string") {
      found.set(record.phase, record.manifestBlobId);
    }
  }
  return found;
}

/** One milestone line, with the repeats of a round folded into a count. */
type TimelineRow = { key: string; label: string; count: number; atMs: number };

function timelineRows(events: readonly ResolutionEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const event of events) {
    if (event.visibility !== "PUBLIC_NOW") continue;
    const label = MILESTONE[event.kind];
    if (label === undefined) continue;
    const last = rows.at(-1);
    // Five sealed votes in a row are one line with a count, not five lines.
    if (last !== undefined && last.label === label) {
      last.count += 1;
      continue;
    }
    const atMs = Date.parse(event.publishedAt ?? event.occurredAt);
    rows.push({
      key: `${event.kind}:${event.sequence}`,
      label,
      count: 1,
      atMs: Number.isFinite(atMs) ? atMs : 0,
    });
  }
  return rows;
}

/** One line of the Proof section: a label, and what proves it. */
function ProofRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</span>
    </div>
  );
}

/** The two quiet ways out of this page. */
function SideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="ov-micro ov-micro-sm inline-flex min-h-10 items-center border border-border px-3 text-muted-foreground transition-colors hover:border-sea/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

/** The title block both views share: the statement, then its criteria. */
function ReportTitle({ claim }: { claim: ClaimInspection }) {
  return (
    // The reading measure holds in the full view too, where the panels below
    // run the wider console frame.
    <header className="max-w-4xl space-y-4">
      <Link
        href="/claims"
        className="ov-micro ov-micro-sm inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeft2 size="13" variant="Bold" />
        All claims
      </Link>

      {/* The statement is the title: nothing above it explains the page. It
          runs the full content column and breaks only at the column's edge.
          The display face balances its lines by default, which pinched a
          long statement into two short ones with a quarter of the column
          empty; `.ov-display` is unlayered CSS, so a utility class would
          lose to it and the override has to be inline. */}
      <h1
        style={{ textWrap: "pretty" }}
        className="ov-display text-4xl text-ocean md:text-5xl"
      >
        {claim.statement}
      </h1>

      {/* The criteria run the column too, pretty so the last line is not a
          single orphan word. */}
      {claim.resolutionCriteria && (
        <p className="text-[13px] leading-[1.6] text-pretty text-muted-foreground">
          {claim.resolutionCriteria}
        </p>
      )}
    </header>
  );
}

/**
 * The truth score in a card of its own: the dial the report used to carry, the
 * figure inside it, one caption under it and nothing else. The scoring link
 * lives in the Proof section, so the card only states the number.
 */
function TruthScoreCard({ scoreBps }: { scoreBps: number | null }) {
  return (
    <div className="flex w-full flex-col items-center gap-1.5 border border-border bg-card px-6 py-4 md:w-auto">
      {/* Under 160px the dial keeps only the figure, which is all the card
          wants: `compact` also drops the gauge's own tier chip. */}
      <VerdictGauge scoreBps={scoreBps} size={140} compact emptyTitle="N/A" />
      <span className="ov-micro ov-micro-sm text-muted-foreground">
        {scoreBps === null ? "No score yet" : "Truth score"}
      </span>
    </div>
  );
}

function ClaimReportContent({ params }: ClaimReportPageProps) {
  // Hooks run before the loading and error returns below (rules of hooks).
  const now = useNow();
  const { id } = use(params);
  const searchParams = useSearchParams();
  const { events } = useClaimEvents(id);
  const hasClaimRef = useRef(false);
  const requestedProofsRef = useRef(new Set<string>());
  const origin = useSyncExternalStore(NEVER_CHANGES, readOrigin, readFallbackOrigin);

  const [claim, setClaim] = useState<ClaimInspection | null>(null);
  const [report, setReport] = useState<FactCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineOffline, setEngineOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // One trail open at a time, the pattern the claim page uses.
  const [openJuror, setOpenJuror] = useState<number | null>(null);
  const [proofsByRunId, setProofsByRunId] = useState<Record<string, BrowserRunProof>>({});
  const [loadingRunIds, setLoadingRunIds] = useState<ReadonlySet<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      if (!hasClaimRef.current) setLoading(true);
      setEngineOffline(false);
      setNotFound(false);

      const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
      if (inspectRes.status === 503) {
        setEngineOffline(true);
        return;
      }
      if (inspectRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!inspectRes.ok) {
        setEngineOffline(true);
        return;
      }

      const inspectData: ClaimInspection = await inspectRes.json();
      setClaim(inspectData);
      hasClaimRef.current = true;

      if (inspectData.state >= 9) {
        try {
          const reportRes = await fetch(`/api/claims/${encodeURIComponent(id)}/report`);
          if (reportRes.ok) setReport(await reportRes.json());
        } catch {
          /* report is optional; the inspection view stands on its own */
        }
      }
    } catch {
      setEngineOffline(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const inspectRes = await fetch(`/api/claims/${encodeURIComponent(id)}?verify=1`);
        if (ignore) return;
        if (inspectRes.status === 503) {
          setEngineOffline(true);
          return;
        }
        if (inspectRes.status === 404) {
          setNotFound(true);
          return;
        }
        if (!inspectRes.ok) {
          setEngineOffline(true);
          return;
        }

        const inspectData: ClaimInspection = await inspectRes.json();
        if (!ignore) {
          setClaim(inspectData);
          hasClaimRef.current = true;
        }

        if (inspectData.state >= 9) {
          try {
            const reportRes = await fetch(`/api/claims/${encodeURIComponent(id)}/report`);
            if (reportRes.ok) {
              const reportData = await reportRes.json();
              if (!ignore) setReport(reportData);
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        if (!ignore) setEngineOffline(true);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, [id]);

  // Live: any new engine event refetches the inspection (debounced), so the
  // page follows the claim without a refresh button.
  const eventCount = events.length;
  useEffect(() => {
    if (eventCount === 0) return;
    const timer = setTimeout(() => {
      void loadData();
    }, 800);
    return () => clearTimeout(timer);
  }, [eventCount, loadData]);

  /** Fetch a juror's run proofs the first time its tile is opened. */
  const requestProofs = useCallback((runIds: readonly string[]) => {
    const pending = runIds.filter((runId) => !requestedProofsRef.current.has(runId));
    if (pending.length === 0) return;
    for (const runId of pending) requestedProofsRef.current.add(runId);
    setLoadingRunIds((current) => new Set([...current, ...pending]));
    void Promise.all(
      pending.map(async (runId) => {
        try {
          const response = await fetch(
            `/api/claims/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/proof`,
            { cache: "no-store" },
          );
          if (!response.ok) return null;
          return [runId, (await response.json()) as BrowserRunProof] as const;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      setLoadingRunIds((current) => {
        const next = new Set(current);
        for (const runId of pending) next.delete(runId);
        return next;
      });
      setProofsByRunId((current) => {
        const next = { ...current };
        for (const entry of loaded) {
          if (entry === null) continue;
          next[entry[0]] = entry[1];
        }
        return next;
      });
    });
  }, [id]);

  // The same record the Live view reads: one juror per agent, across both
  // rounds, with the research trail a fetched proof fills in for older claims.
  const transcript = useMemo(
    () =>
      claim === null
        ? { entries: [], jurors: [] as TranscriptJuror[] }
        : buildTranscript({ claim, events, proofs: Object.values(proofsByRunId) }),
    [claim, events, proofsByRunId],
  );

  // The debate, numbered the way the record numbers it, keyed by the seat that
  // spoke, so an opened juror shows its own turns and nobody else's.
  const debateBySeat = useMemo(() => {
    const bySeat = new Map<string, DebateTurnView[]>();
    if (claim === null) return bySeat;
    const turns = mergeTurns(claim, events);
    if (turns.length === 0) return bySeat;
    const seats = debateSeatsOf(claim);
    const standing = debateStanding({
      seats,
      turns,
      running: claim.state <= 6,
      convergedAfterExchange: claim.debateConvergedAfterExchange ?? null,
    });
    for (const view of debateTurnViews({ turns, seats, standing })) {
      const list = bySeat.get(view.turn.jurySeatId) ?? [];
      list.push(view);
      bySeat.set(view.turn.jurySeatId, list);
    }
    return bySeat;
  }, [claim, events]);

  const timeline = useMemo(() => timelineRows(events), [events]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-14">
        <div className="h-12 animate-pulse bg-surface" />
        <div className="h-4 w-2/3 animate-pulse bg-surface" />
        <div className="h-16 w-1/2 animate-pulse bg-surface" />
        <div className="h-24 animate-pulse bg-surface" />
      </div>
    );
  }

  if (engineOffline) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <Warning2 size="26" variant="Bold" />
        </span>
        <h1 className="text-xl font-semibold text-ocean">Engine offline (503)</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          The OpenVerdict verification engine backend is offline or not wired yet. Claim data
          cannot be retrieved from the active RPC node.
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => loadData()}>
            <Refresh size="14" variant="Bold" />
            Retry
          </Button>
          <Button asChild size="sm" className="min-h-[40px]">
            <Link href="/verify">Independent verifier</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !claim) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-ocean">Claim not found</h1>
        <p className="text-sm text-muted-foreground">No claim exists with this object id.</p>
        <HashChip value={id} kind="object" full className="max-w-md" />
        <Button asChild size="sm" className="mt-2 min-h-[40px]">
          <Link href="/claims">Back to claims directory</Link>
        </Button>
      </div>
    );
  }

  // --- the verdict, from the record alone ---------------------------------
  const stranded = now !== null && isStrandedDiscussion(claim, now);
  const verdict = verdictOf(claim, stranded);
  // The whole report is a query on this same route, so a link to it is
  // shareable and the browser's back button returns to the summary.
  const full = searchParams.get("view") === "full";
  const seatById = new Map(claim.commitments.map((seat) => [seat.jurySeatId, seat]));
  const jurors = transcript.jurors;
  // A juror's last seat is its final-round seat, which is the vote that counted.
  const finalVotes: FinalVote[] = jurors.map((juror) => {
    const seat = seatById.get(juror.seats.at(-1)?.seatId ?? "");
    const outcome = outcomeOf(seat?.outcome);
    return {
      ...(outcome === undefined ? {} : { outcome }),
      revealed: seat?.revealed ?? false,
      committed: seat?.committed ?? false,
      failed: seat?.failureStatus !== undefined,
    };
  });
  const juryLine = jurySentence(finalVotes, claim.result?.result);
  const hasRoundTwo = jurors.some((juror) => juror.seats.length > 1);
  const spokeInDebate = (claim.deliberation ?? []).some((turn) => turn.status === "SPOKEN");
  const chain = claim.attemptChain;
  const stopped = chain?.status === "VOIDED" || chain?.status === "GAVE_UP";
  const stoppedReason = !stopped
    ? null
    : reasonSentence(chain?.gaveUpReason ?? chain?.void?.reason ?? "no reason recorded");
  // The attempts line replaces the old panel, and only a chain of more than
  // one attempt earns it.
  const manyAttempts =
    chain !== undefined
    && (chain.attempt > 1 || chain.previousAttempts.length > 0 || chain.relaunchedAs !== undefined);
  const failedChecks =
    claim.verification === undefined
      ? []
      : [
          claim.verification.commitmentsRecomputed ? "" : "commitments",
          claim.verification.truthScoreRecomputed ? "" : "truth score",
          claim.verification.evidenceRootsRecomputed ? "" : "evidence roots",
        ].filter((part) => part.length > 0);

  const certificateId = report?.sui.certificateId ?? claim.result?.certificateId;
  const manifests = manifestBlobIds(report);
  const claimLink = `${origin}/claims/${id}`;
  // Seats of the same model wear different tints, keyed on committee order.
  const seatTints = jurors.map((juror) => ({
    id: String(juror.index),
    modelId: juror.modelId,
  }));

  // The whole report, behind ?view=full: every panel, hash and id the record
  // holds. It takes the console's wide frame, which the summary does not need,
  // and the same title block and top controls, where the second one returns.
  if (full) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 px-5 py-10 md:px-7 lg:py-14">
        <ReportTitle claim={claim} />
        <Hairline />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SideLink href={`/claims/${id}`}>Live view</SideLink>
          <SideLink href={`/claims/${id}/report`}>Summary</SideLink>
        </div>
        <FullReport claim={claim} report={report} events={events} stranded={stranded} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-5 py-10 md:px-7 lg:py-14">
      <ReportTitle claim={claim} />

      <Hairline />

      {/* ------------------------------------------------------- The verdict */}
      <section className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0 space-y-2 md:flex-1">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <p className={cn("ov-display text-4xl md:text-5xl", verdict.className)}>
              {verdict.word}
            </p>
            {verdict.phase && (
              <p className="text-[15px] text-muted-foreground">{verdict.phase}</p>
            )}
          </div>

          <p className="text-[15px] leading-[1.55] text-muted-foreground">{juryLine}</p>

          {hasRoundTwo && (
            <p className="text-[13px] leading-[1.55] text-muted-foreground">
              Round two after {spokeInDebate ? "cross-examination" : "a split vote"}.
            </p>
          )}

          {stoppedReason && (
            <p className="text-[13px] leading-[1.55] text-muted-foreground">{stoppedReason}</p>
          )}

          {manyAttempts && chain !== undefined && (
            <p className="text-[13px] leading-[1.55] text-muted-foreground">
              Attempt {chain.attempt} of {chain.maxAttempts}.{" "}
              {chain.previousAttempts.map((previous) => (
                <Fragment key={previous.claimId}>
                  <Link
                    href={`/claims/${previous.claimId}/report`}
                    className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Attempt {previous.attempt}
                  </Link>{" "}
                  was voided: {(previous.voidReason ?? "no reason recorded")
                    .replace(/_/g, " ")
                    .toLowerCase()}.{" "}
                </Fragment>
              ))}
              {chain.relaunchedAs !== undefined && (
                <Link
                  href={`/claims/${chain.relaunchedAs}/report`}
                  className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Relaunched attempt
                </Link>
              )}
            </p>
          )}

          {/* A failed recomputation is the one thing this page may never hide. */}
          {failedChecks.length > 0 && (
            <p className="text-[13px] leading-[1.55] text-no">
              Recompute failed: {failedChecks.join(", ")}.
            </p>
          )}
        </div>

        {/* The two ways on, and the score. On a phone the card comes first,
            straight under the verdict text, and the controls follow. */}
        <div className="flex shrink-0 flex-col-reverse gap-3 md:flex-col md:items-end">
          <div className="flex items-center gap-2">
            <SideLink href={`/claims/${id}`}>Live view</SideLink>
            <SideLink href={`/claims/${id}/report?view=full`}>Full view</SideLink>
          </div>
          <TruthScoreCard scoreBps={claim.result?.truthScoreBps ?? null} />
        </div>
      </section>

      {/* ---------------------------------------------------------- The jury */}
      <section>
        <h2 className="ov-micro ov-micro-sm text-muted-foreground">Jury</h2>
        <Hairline className="mt-3" />

        {jurors.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted-foreground">
            The jury appears here once Sui&apos;s randomness draws it.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {jurors.map((juror) => {
                const finalSeat = juror.seats.at(-1);
                const seat = seatById.get(finalSeat?.seatId ?? "");
                const outcome = outcomeOf(seat?.outcome);
                const failed = seat?.failureStatus !== undefined;
                const roundTwo = juror.seats.length > 1;
                const open = openJuror === juror.index;
                const word = failed
                  ? "Failed"
                  : (outcome ?? (seat?.committed ? "Sealed" : "Waiting"));
                const wordClass = failed
                  ? "text-no"
                  : outcome !== undefined
                    ? OUTCOME_TEXT[outcome]
                    : seat?.committed
                      ? "text-sealed"
                      : "text-muted-foreground";
                return (
                  <button
                    key={juror.index}
                    type="button"
                    onClick={() => {
                      if (!open) {
                        requestProofs(
                          juror.seats.map((entry) =>
                            deriveRunId(claim.claimId, entry.seatId, entry.phase),
                          ),
                        );
                      }
                      setOpenJuror((current) => (current === juror.index ? null : juror.index));
                    }}
                    aria-expanded={open}
                    {...(open ? { "aria-controls": `juror-trail-${juror.index}` } : {})}
                    className={cn(
                      "flex flex-col gap-2 border bg-card p-3 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      open ? "border-sea" : "border-border hover:border-sea/40",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <ModelLogo
                        modelId={juror.modelId}
                        variant={modelVariantFor(seatTints, String(juror.index))}
                        size={22}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                        Juror {juror.index}
                      </span>
                      {roundTwo && (
                        <span className="ov-micro ov-micro-sm shrink-0 border border-border px-1 text-muted-foreground">
                          R2
                        </span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-1.5">
                      <span className={cn("text-[15px] font-semibold", wordClass)}>{word}</span>
                      {seat?.confidenceBps !== undefined && outcome !== undefined && (
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {Math.round(seat.confidenceBps / 100)}%
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* One trail open at a time, full width under the row. */}
            {jurors.map((juror) => {
              if (openJuror !== juror.index) return null;
              const runIds = juror.seats.map((entry) =>
                deriveRunId(claim.claimId, entry.seatId, entry.phase),
              );
              const proof = runIds
                .map((runId) => proofsByRunId[runId])
                .filter((entry): entry is BrowserRunProof => entry !== undefined)
                .at(-1);
              const roundTwo = juror.seats.length > 1;
              const firstSeat = seatById.get(juror.seats[0]?.seatId ?? "");
              const firstOutcome = outcomeOf(firstSeat?.outcome);
              const turns = debateBySeat.get(juror.seats[0]?.seatId ?? "") ?? [];
              const variant = modelVariantFor(seatTints, String(juror.index));
              const onToggle = () => setOpenJuror(null);
              return (
                <div key={juror.index} className="mt-3">
                  {roundTwo && (firstOutcome !== undefined || turns.length > 0) && (
                    <div className="space-y-3 border border-b-0 border-sea bg-card px-4 py-3.5">
                      {firstOutcome !== undefined && (
                        <p className="text-[13px] text-muted-foreground">
                          Round one:{" "}
                          <span className={cn("font-semibold", OUTCOME_TEXT[firstOutcome])}>
                            {firstOutcome}
                          </span>
                          {firstSeat?.confidenceBps !== undefined && (
                            <span className="ml-1.5 font-mono tabular-nums">
                              {Math.round(firstSeat.confidenceBps / 100)}%
                            </span>
                          )}
                        </p>
                      )}
                      {turns.map((view) => (
                        <DebateTurnBubble key={view.turn.ordinal} {...view} density="compact" />
                      ))}
                    </div>
                  )}
                  <JurorTrailPanel
                    juror={juror}
                    view={jurorAt(juror, Number.POSITIVE_INFINITY)}
                    onToggle={onToggle}
                    panelId={`juror-trail-${juror.index}`}
                    variant={variant}
                    {...(proof === undefined ? {} : { proof })}
                    loadingProof={runIds.some((runId) => loadingRunIds.has(runId))}
                    className={cn(roundTwo && turns.length > 0 && "border-t-0")}
                  />
                </div>
              );
            })}
          </>
        )}
      </section>

      {/* --------------------------------------------------------- The proof */}
      <details className="group border border-border bg-card">
        <summary className="ov-micro ov-micro-sm flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ArrowDown2
            size="12"
            variant="Bold"
            className="shrink-0 transition-transform group-open:rotate-180"
          />
          Proof
        </summary>

        <div className="space-y-5 border-t border-border px-4 py-4">
          <div>
            <ProofRow label="Claim object">
              <HashChip value={claim.claimId} kind="object" tone="muted" />
            </ProofRow>

            {claim.committeeId && (
              <ProofRow label="Committee">
                <HashChip value={claim.committeeId} kind="object" tone="muted" />
              </ProofRow>
            )}

            {certificateId && (
              <ProofRow label="Certificate">
                <HashChip value={certificateId} kind="object" tone="muted" />
              </ProofRow>
            )}

            {claim.evidenceRoots.map((bundle) => {
              const blobId = manifests.get(bundle.phase);
              return (
                <ProofRow key={bundle.bundleId} label={`Evidence, phase ${bundle.phase}`}>
                  <HashChip value={bundle.root} label="root" kind="hash" tone="muted" />
                  {blobId === undefined ? (
                    <HashChip
                      value={bundle.bundleId}
                      label="manifest"
                      kind="object"
                      tone="muted"
                    />
                  ) : (
                    <HashChip
                      value={blobId}
                      label="manifest"
                      kind="blob"
                      tone="muted"
                    />
                  )}
                </ProofRow>
              );
            })}

            {jurors.flatMap((juror) =>
              juror.seats.map((seat) => {
                const runId = deriveRunId(claim.claimId, seat.seatId, seat.phase);
                return (
                  <ProofRow
                    key={runId}
                    label={
                      juror.seats.length > 1
                        ? `Juror ${juror.index} run, round ${seat.phase}`
                        : `Juror ${juror.index} run`
                    }
                  >
                    <HashChip
                      value={runId}
                      tone="muted"
                      href={`/api/claims/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/proof`}
                    />
                  </ProofRow>
                );
              }),
            )}

            {report !== null && (
              <ProofRow label="Audit bundle">
                <a
                  href={`/api/claims/${encodeURIComponent(id)}/report`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  JSON
                  <ExportSquare size="11" className="shrink-0 opacity-70" />
                </a>
              </ProofRow>
            )}
          </div>

          {timeline.length > 0 && (
            <ul className="space-y-1">
              {timeline.map((row) => (
                <li key={row.key} className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px] text-muted-foreground">
                    {row.label}
                    {row.count > 1 && (
                      <span className="ml-1.5 font-mono text-[11px] tabular-nums">
                        &times;{row.count}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80 tabular-nums">
                    {stamp(row.atMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* The agent path of the Audit page, in one line. */}
          <CommandRow
            text={`Read ${origin}/llms.txt, then audit ${claimLink} and explain the verdict.`}
            ready
            label="the agent prompt"
          />

          <Link
            href="/learn"
            className="inline-flex text-[13px] font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            How the score is computed
          </Link>
        </div>
      </details>
    </div>
  );
}

export default function ClaimReportPage(props: ClaimReportPageProps) {
  // `useSearchParams` reads the ?view= switch, so the tree needs a boundary.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-14">
          <div className="h-12 animate-pulse bg-surface" />
          <div className="h-4 w-2/3 animate-pulse bg-surface" />
          <div className="h-16 w-1/2 animate-pulse bg-surface" />
          <div className="h-24 animate-pulse bg-surface" />
        </div>
      }
    >
      <ClaimReportContent {...props} />
    </Suspense>
  );
}

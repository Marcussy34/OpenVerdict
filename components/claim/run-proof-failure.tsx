import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CloseCircle, ExportSquare } from "@/components/icons";
import { ResearchTrail } from "@/components/claim/run-proof-research";
import { TimeDisplay } from "@/components/time-display";
import { FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import type {
  TransparentAttempt,
  TransparentResearchStep,
  TransparentRunProof,
  TransparentBundle,
} from "@/components/claim/run-proof-types";

type WalrusUrl = (blobId: string) => string | null;

function plainEnglishFailure(
  status: string | undefined,
  message: string | undefined,
): string {
  if (status === "INVALID_SCHEMA") {
    const normalizedMessage = message?.toLowerCase() ?? "";
    return normalizedMessage.includes("no answer within") ||
      normalizedMessage.includes("turn budget")
      ? "No answer within the turn budget"
      : "The model never produced a valid answer";
  }
  if (status === "CITATION_INVALID") {
    return "Its citations could not be verified";
  }
  if (status === "PROVIDER_ERROR") {
    return "The model provider failed";
  }
  if (status === "TIMEOUT") {
    return "The call was cut at the seat deadline";
  }
  return message?.trim() || "The seat failed before it could commit";
}

function attemptOnlySteps(attempts: TransparentAttempt[]): TransparentResearchStep[] {
  return attempts.map((attempt, index) => ({
    index,
    turn: index + 1,
    modelRequestId: attempt.audit?.gonkaRequestId,
    action: { action: "model_attempt" },
    result: { tool: "attempt" },
  }));
}

/** Adapt failure audit material to the unchanged research and provenance views. */
export function failureDisplayBundle(
  proof: TransparentRunProof,
): TransparentBundle {
  const failure = proof.failure;
  const attempts = failure?.attempts ?? [];
  const lastAttempt = attempts[attempts.length - 1];
  const transcript = failure?.transcript ?? undefined;
  // Attempt-only failures still need turn cards for their recorded raw replies.
  const steps =
    transcript?.steps && transcript.steps.length > 0
      ? transcript.steps
      : attemptOnlySteps(attempts);

  return {
    version: 5,
    kind: "run-bundle",
    runId: proof.runId,
    attempts,
    audit: lastAttempt?.audit,
    rawResponse: lastAttempt?.response ?? lastAttempt?.rawResponse,
    transcript:
      transcript || steps.length > 0
        ? {
            ...transcript,
            steps,
            opened: transcript?.opened ?? [],
            citations: transcript?.citations ?? [],
            counts: transcript?.counts ?? {},
          }
        : undefined,
  };
}

export function RunProofFailure({
  proof,
  bundle,
  walrusUrl,
}: {
  proof: TransparentRunProof;
  bundle: TransparentBundle;
  walrusUrl: WalrusUrl;
}) {
  const failure = proof.failure;
  if (!failure) return null;

  const status = failure.status?.trim() || "UNKNOWN_FAILURE";
  const summary = plainEnglishFailure(failure.status, failure.message);
  const attempts = failure.attempts ?? [];
  const hasResearch = Boolean(failure.transcript || attempts.length > 0);
  const failureBlobUrl = failure.walrusBlobId
    ? walrusUrl(failure.walrusBlobId)
    : null;

  return (
    <section
      aria-labelledby={`run-failure-${proof.runId}`}
      className="space-y-4"
    >
      <Card size="sm" className="border-no/30 bg-no/6 ring-no/15">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CloseCircle size="17" variant="Bold" className="shrink-0 text-no" />
            <CardTitle id={`run-failure-${proof.runId}`} className="text-no">
              Seat failed before commit
            </CardTitle>
            <Badge
              variant="outline"
              className="ml-auto border-no/30 bg-no/8 font-mono text-no"
            >
              {status}
            </Badge>
          </div>
          <CardDescription className="text-xs leading-relaxed text-foreground/80">
            {summary}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-no/20 bg-card p-2.5">
              <FieldLabel>Engine message</FieldLabel>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">
                {failure.message?.trim() || "No failure message was recorded."}
              </p>
            </div>
            <div className="rounded-lg border border-no/20 bg-card p-2.5">
              <FieldLabel>Failed at</FieldLabel>
              <div className="mt-1">
                <TimeDisplay timestampMs={failure.failedAtMs} />
              </div>
            </div>
          </div>

          <p className="rounded-lg border border-no/25 bg-no/8 p-3 text-xs leading-relaxed text-no">
            This seat cast no vote, and no vote was invented. A round needs four
            matching reveals of five.
          </p>

          {failure.walrusBlobId && (
            <div className="flex flex-wrap items-center gap-2">
              {failureBlobUrl ? (
                <Button asChild variant="outline" size="sm" className="min-h-10">
                  <a href={failureBlobUrl} target="_blank" rel="noreferrer">
                    <ExportSquare size="14" />
                    Failure audit on Walrus
                  </a>
                </Button>
              ) : (
                <HashChip
                  value={failure.walrusBlobId}
                  label="failure blob"
                  tone="muted"
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {hasResearch && (
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-no">
              What the juror did before failing
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Recorded model turns, node replies, and research actions before the
              seat stopped.
            </p>
          </div>
          <ResearchTrail bundle={bundle} walrusUrl={walrusUrl} />
        </div>
      )}
    </section>
  );
}

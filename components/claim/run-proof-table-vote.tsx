"use client";

import { OUTCOME_CHIP } from "@/components/claim/claim-format";
import {
  isProofRecord,
  type ProofRecord,
  type TransparentBundle,
} from "@/components/claim/run-proof-types";
import { ArrowDown2, Code1, Judge } from "@/components/icons";
import { FieldLabel } from "@/components/viz/panel";
import { cn } from "@/lib/utils";

/** Proof JSON is untrusted, so table-vote fields are read defensively. */
function stringValue(record: ProofRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Numeric vote fields stay absent when the revealed bundle is malformed. */
function numberValue(record: ProofRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Round two exposes the prior vote and every public stance at the table. */
export function TableVotePanel({ bundle }: { bundle: TransparentBundle }) {
  const input = isProofRecord(bundle.input) ? bundle.input : {};
  const self = isProofRecord(input.self) ? input.self : {};
  const debate = Array.isArray(input.debate)
    ? input.debate.filter(isProofRecord)
    : [];
  const roundOneOutcome = stringValue(self, "roundOneOutcome");
  const roundOneConfidence = numberValue(self, "roundOneConfidenceBps");
  const convergedAfterExchange = numberValue(input, "convergedAfterExchange");

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <Judge size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
        <h3 className="text-sm leading-relaxed font-semibold text-ocean">
          Table vote: decided on the evidence on the table, no research in round two
        </h3>
      </div>

      <div className="grid gap-2 @xs:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-2.5">
          <FieldLabel>Juror round-one vote</FieldLabel>
          <span className={cn(
            "mt-1.5 inline-flex px-2 py-0.5 text-xs font-bold",
            roundOneOutcome === undefined
              ? "bg-muted text-muted-foreground"
              : OUTCOME_CHIP[roundOneOutcome],
          )}>
            {roundOneOutcome ?? "Not recorded"}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5">
          <FieldLabel>Round-one confidence</FieldLabel>
          <p className="mt-1.5 text-sm font-semibold text-ocean tabular-nums">
            {roundOneConfidence === undefined
              ? "Not recorded"
              : `${roundOneConfidence / 100}%`}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel>Debate stances</FieldLabel>
        {debate.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {debate.map((turn, index) => {
              const seat = numberValue(turn, "seat");
              const exchange = numberValue(turn, "exchange");
              const stance = stringValue(turn, "stance");
              const confidence = numberValue(turn, "confidenceBps");
              return (
                <li
                  key={`${seat ?? "seat"}-${exchange ?? "exchange"}-${index}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-ocean">
                    Seat {seat ?? "?"}
                  </span>
                  <span className="text-muted-foreground">
                    Exchange {exchange ?? "?"}
                  </span>
                  <span className={cn(
                    "px-2 py-0.5 text-[10px] font-bold",
                    stance === undefined
                      ? "bg-muted text-muted-foreground"
                      : OUTCOME_CHIP[stance],
                  )}>
                    {stance ?? "Not recorded"}
                  </span>
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {confidence === undefined
                      ? "Confidence not recorded"
                      : `${confidence / 100}% confidence`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-card p-3 text-xs text-muted-foreground">
            No debate stances were recorded.
          </p>
        )}
      </div>

      <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted-foreground">
        {convergedAfterExchange === undefined
          ? "Three exchanges, no convergence: to the vote"
          : `Debate converged after exchange ${convergedAfterExchange}: nobody moved`}
      </p>
    </section>
  );
}

/** A table vote pins one prompt and has no research policy or budgets. */
export function TableVoteSystemPrompt({ systemPrompt }: { systemPrompt?: string }) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ocean focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
        <ArrowDown2
          size="13"
          variant="Bold"
          className="text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
        <Code1 size="14" variant="Bold" className="text-primary" />
        System prompt
      </summary>
      <div className="space-y-2 border-t border-border p-3">
        <FieldLabel>System prompt</FieldLabel>
        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
          {systemPrompt ?? "Not recorded"}
        </pre>
      </div>
    </details>
  );
}

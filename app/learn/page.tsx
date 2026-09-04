import * as React from "react";
import type { Metadata } from "next";
import { Hairline, NumberChip, SplitButton } from "@/components/landing/primitives";
import { DOCS_URL } from "@/lib/web/site-urls";

export const metadata: Metadata = {
  title: "Learn",
};

// Everything technical (the protocol, the API, the audit checks) lives on the
// docs site, which is what keeps this page in plain words. DOCS_URL is the
// docs host when NEXT_PUBLIC_DOCS_URL is set and the in-app /docs otherwise.

/** How a verdict happens: five steps, one line each, in the reader's words. */
const STEPS = [
  "Your claim is written down and locked, so nobody can change it later.",
  "Five AI jurors, built by three different companies, research it on their own.",
  "Each juror seals its answer in an envelope nobody can open yet.",
  "All the envelopes open together. Four of the five must agree, or the jurors argue it out in public and vote again.",
  "The result goes onto a public ledger (the Sui blockchain), where nobody can edit it, not even us.",
];

/** Why the answer holds up, one reason per line. */
const REASONS = [
  "No juror can see another juror's answer before its own is sealed.",
  "Five jurors from three different AI companies, never one company alone.",
  "Every page a juror read is saved in public, exactly as it was.",
  "When the evidence is not enough, the answer is UNSURE, never a fake yes or no.",
];

/** How to read the 0 to 100 score. */
const SCORE: ReadonlyArray<readonly [string, string]> = [
  ["near 100", "the jurors are confident the claim is true"],
  ["near 0", "they are confident it is false"],
  ["around 50", "they are genuinely not sure"],
];

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16 md:px-7 md:py-24">
      {/* Hero: the console's centred title block, matching Verify, Claims and
          Agents. No eyebrow and no icon tile: those pages carry neither. */}
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <h1 className="ov-display text-5xl text-ocean md:text-6xl">How OpenVerdict works</h1>
        <p className="text-base text-muted-foreground">
          Ask whether a statement is true. Five AI jurors check it, and all of their
          work stays public.
        </p>
      </div>

      <Section n={1} title="What OpenVerdict does">
        <p>You give it one claim, for example:</p>
        <p className="border-l border-border pl-4 text-black">
          &ldquo;The EU AI Act entered into force on 1 August 2024.&rdquo;
        </p>
        <p>Five AI jurors research it on the live web and answer YES, NO or UNSURE.</p>
        <p>
          The answer comes with a score from 0 to 100 and a public record anyone can
          open.
        </p>
      </Section>

      <Section n={2} title="How a verdict happens">
        <ol className="space-y-2.5">
          {STEPS.map((step, i) => (
            <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
              {/* Quiet mono index: the heading chips carry the page's numbering. */}
              <span className="font-mono text-[13px] leading-[23px] text-black/55 tabular-nums">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section n={3} title="Why you can trust it">
        <ul className="space-y-2.5">
          {REASONS.map((reason) => (
            <li key={reason} className="flex gap-3">
              {/* The 3px ink square, the same mark a number chip carries. */}
              <span aria-hidden className="mt-[10px] size-[3px] shrink-0 bg-black/40" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={4} title="The score">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-l border-border pl-4">
          {SCORE.map(([reading, meaning]) => (
            <React.Fragment key={reading}>
              <dt className="font-mono text-[13px] leading-[23px] text-black tabular-nums">
                {reading}
              </dt>
              <dd>{meaning}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p>It is a plain average of how sure each juror was, so you can add it up yourself.</p>
      </Section>

      <Section n={5} title="Cost and account">
        <p>
          Reading a verdict, watching a jury and submitting a claim are free. No account,
          no wallet.
        </p>
        <p>
          A wallet is only for people who want to stake on a juror seat: at least 0.1 SUI,
          which comes back 24 hours after you unstake.
        </p>
      </Section>

      <Hairline />
      <div className="flex flex-wrap items-center justify-between gap-4 pt-8">
        <p className="max-w-[440px] text-[15px] leading-[1.55] text-black/70">
          Want the details? The full protocol, the API and the audit checks are in the
          docs.
        </p>
        <SplitButton href={DOCS_URL}>Read the docs</SplitButton>
      </div>
    </div>
  );
}

/** One numbered section: chip and heading on the left, the words on the right. */
function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {/* The hero is separated by space, so the rules only sit between sections. */}
      {n > 1 && <Hairline />}
      <div className="grid gap-4 py-9 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10 lg:py-11">
        <div className="flex items-start gap-3.5">
          <NumberChip n={n} className="mt-[3px]" />
          <h2 className="text-[19px] leading-snug font-medium tracking-[-0.01em] text-black md:text-[21px]">
            {title}
          </h2>
        </div>
        <div className="max-w-[480px] space-y-2.5 text-[15px] leading-[1.55] text-black/70">
          {children}
        </div>
      </div>
    </section>
  );
}

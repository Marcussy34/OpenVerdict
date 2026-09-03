"use client";

import * as React from "react";
import { SplitButton, NumberChip, CornerPin, GridGuides, Hairline } from "./primitives";

const ITEMS = [
  {
    q: "What is OpenVerdict?",
    a: "An adversarial AI jury protocol for factual disputes, not an agent swarm. Instead of one model or one editor deciding, a committee of five juror seats drawn on-chain from three model families researches the claim independently (every search and page open is executed by the engine and recorded), seals a secret ballot under commit-reveal, cross-examines a deadlock over the frozen evidence, and the outcome settles as a resolution certificate on Sui that anyone can recompute.",
  },
  {
    q: "How are verdicts decided?",
    a: "Each juror seals a Blake2b-256 commitment to its vote, then opens it in the reveal round, so no juror can anchor on or herd around another's reasoning before sealing its own stance. A verdict needs a 4-of-5 quorum; a split round goes to a bounded cross-examination (three exchanges at most, citing only the frozen record) and a second sealed ballot; if the quorum is still missing, or the quorum itself is UNSURE, the claim finalizes as UNRESOLVED rather than being forced into a yes or no.",
  },
  {
    q: "What actually settles on-chain?",
    a: "The claim, the drawn jury seats, every commitment and reveal, the round tally and the final resolution certificate are Move objects on Sui. The package ids for testnet live in the repo's release config, and the observer only ever reads them.",
  },
  {
    q: "Is signing in proof of personhood?",
    a: "No. zkLogin is authentication: one social account resolves to one Sui address, and the registry backs one jury seat per address. It says nothing about whether an account belongs to a unique human, and OpenVerdict never claims otherwise.",
  },
  {
    q: "Where does the evidence live?",
    a: "Submitted URLs are crawled through an SSRF-safe proxy, sanitised to plain text and Merkle-frozen to Walrus before the jury convenes. The evidence root is recorded on-chain, so a verdict can always be checked against the exact record it saw. Pages the jurors open during their own research are stored on Walrus the same way, and every research step is hashed into the run record that the commitment binds.",
  },
  {
    q: "Which models sit on a jury?",
    a: "Panels are drawn through GonkaRouter across DeepSeek-V4-Flash, Kimi-K2.6 and MiniMax-M2.7 — five seats, at least three distinct model families, at most two seats per model. Seats are assigned by Sui native randomness, not by the operator.",
  },
  {
    q: "Who actually runs the jurors?",
    a: "Today, the OpenVerdict engine executes every juror run itself, and all AI reasoning goes through GonkaRouter only: the adapter refuses any other inference host in code, and a juror that cannot reach Gonka fails closed instead of falling back. Jurors are standardized seats, not user-owned bots: prompts and tool policies are hashed into on-chain manifests, so nobody, including the operator, can steer a seat without breaking hashes anyone can recheck. Trust here comes from verifiability rather than decentralized execution; an attested executor (Sui Nautilus) is the disclosed roadmap step.",
  },
  {
    q: "Who pays, and who earns?",
    a: "Requesters fund a claim's budgets in SUI when it is created; the public demo form is a team-subsidized tier of the same flow. At settlement the committee budget splits across the seats that validly revealed, as one-time payout tickets: commit late, fail the schema or refuse to reveal, and that seat earns nothing. The recorded next step is delegated seat backing: stake SUI behind a seat and share its jury rewards pro rata after fees. That part is documented direction rather than shipped code, and majority-only winner pay is rejected by design, so juries are never paid for herding.",
  },
  {
    q: "What happens when a juror fails?",
    a: "No vote is ever invented for it. Since round two at the table, a verification is all or nothing: a juror error at a binding step voids the whole attempt, the failure and the seat's research trail stay public, and the engine relaunches a fresh attempt once all three model families and web search answer a health probe, up to three attempts. Nothing partial is ever finalized.",
  },
  {
    q: "Can I check a verdict myself?",
    a: "Yes. The verifier page recomputes every commitment, Merkle root, run hash and Truth Score in your browser from the published record (15 checks per juror run), can resend a juror's exact recorded conversation to the same model, and can open a sealed juror bundle through Seal once its reveal deadline has passed. The CLI does the same from a terminal. Nothing in that path trusts this server.",
  },
];

/** Section 8 — the questions, answered against what the repo actually does. */
export function Faq() {
  const [open, setOpen] = React.useState<number | null>(null);

  return (
    <section
      data-header-theme="light"
      className="relative z-30 isolate overflow-hidden text-black"
      // The paper join carries the section above's ground over the edge, so the
      // two meet without a visible cut. See --ov-paper-join in globals.css.
      style={{
        background:
          "var(--ov-paper-join), linear-gradient(180deg,#dfe7f1 0%,#eef1f3 42%,#f7f7f5 100%)",
        backgroundSize: "100% 185px, auto",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Only the first column guide: the second one cut straight through the
          ruled question rows; this one runs beside them. */}
      <GridGuides at={[100 / 3]} className="hidden md:block" />

      <div className="relative px-5 pt-20 pb-24 md:px-7 md:pt-24 md:pb-28">
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <CornerPin className="-top-6 left-0" />
          <h2 className="ov-display text-[clamp(2.5rem,5.2vw,4.25rem)]">FAQ</h2>
          <div className="flex items-center gap-3 pt-2">
            <span className="ov-micro hidden text-black/70 sm:inline">Got more questions?</span>
            <SplitButton href="https://github.com/Marcussy34/OpenVerdict/issues">
              Reach us
            </SplitButton>
          </div>
        </div>

        <Hairline className="mt-10" />

        <div className="mt-0 lg:ml-[34%]">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="bg-black/3">
                {i > 0 && <Hairline />}
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    id={`faq-trigger-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ov-accent)] md:gap-6 md:px-5"
                  >
                    <NumberChip n={i + 1} tone="faint" />
                    <span className="flex-1 text-[17px] leading-snug font-medium tracking-[-0.01em] md:text-[19px]">
                      {item.q}
                    </span>
                    <span
                      aria-hidden
                      className="grid size-[34px] shrink-0 place-items-center bg-black text-white"
                    >
                      <svg
                        viewBox="0 0 14 14"
                        width="13"
                        height="13"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        className="transition-transform duration-[250ms]"
                        style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
                      >
                        <path d="M7 1.5v11M1.5 7h11" />
                      </svg>
                    </span>
                  </button>
                </h3>
                <div
                  className="ov-collapse"
                  data-open={isOpen}
                  id={`faq-panel-${i}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${i}`}
                >
                  <div>
                    <p className="max-w-[640px] px-4 pb-6 text-[15px] leading-[1.55] text-black/70 md:px-5 md:pl-[70px]">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

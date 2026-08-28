import Link from "next/link";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { Pipeline } from "@/components/viz/pipeline";
import { Button } from "@/components/ui/button";
import {
  Judge,
  Lock,
  Cpu,
  Warning2,
  Award,
  ShieldTick,
  Wallet,
  ArrowRight,
  type IconComponent,
} from "@/components/icons";

const CONTENTS = [
  { id: "pathways", label: "Resolution pathways" },
  { id: "pipeline", label: "The pipeline" },
  { id: "commit-reveal", label: "Commit-reveal" },
  { id: "diversity", label: "Model diversity" },
  { id: "uncertainty", label: "Uncertainty as a result" },
  { id: "score", label: "Truth Score" },
  { id: "signin", label: "Signing in" },
];

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Protocol concepts"
        title="How OpenVerdict works"
        description="A decentralized intelligence verification engine combining Sui Move smart contracts, diverse GonkaRouter AI juries and permanent Walrus storage."
        icon={Judge}
        badges={<ExperimentalTag />}
      />

      {/* Contents rail */}
      <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
        {CONTENTS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-sea/40 hover:text-primary"
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* 1. Pathways */}
      <section id="pathways" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="01"
          icon={ShieldTick}
          title="Optimistic resolution & escalation pathways"
          body="OpenVerdict supports two resolution pathways, designed for economic efficiency and trust minimization."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel label="Direct review" icon={ShieldTick} tone="primary">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Built for public fact-checking and developer oracle queries. It skips the
              optimistic proposal window and immediately freezes evidence, selects five AI
              jurors, and convenes the commit-reveal round.
            </p>
          </Panel>
          <Panel label="Optimistic settlement" icon={Judge} tone="chain">
            <p className="text-xs leading-relaxed text-muted-foreground">
              A proposer posts a bonded outcome. If nobody challenges before the deadline the
              claim finalizes with no inference cost. If challenged with counter-evidence it
              escalates to an autonomous AI jury.
            </p>
          </Panel>
        </div>
      </section>

      {/* 2. Pipeline */}
      <section id="pipeline" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="02"
          icon={Cpu}
          title="The five-phase pipeline"
          body="Every claim that reaches a jury walks the same deterministic path, and each phase leaves an artefact anyone can re-derive."
        />
        <Pipeline />
      </section>

      {/* 3. Commit-reveal */}
      <section id="commit-reveal" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="03"
          icon={Lock}
          title="Cryptographic commit-reveal eliminates model collusion"
          body="In naive multi-agent systems, language models can be biased by seeing intermediate votes or reasoning from other models — producing systemic groupthink and front-running."
        />
        <Panel label="Two-stage protocol enforced on Sui" icon={Lock} tone="sealed">
          <ol className="space-y-3">
            {[
              {
                step: "1",
                title: "Commitment preimage",
                code: "VotePreimageV1 { claim_id, agent_id, jury_seat_id, phase, outcome, confidence_bps, evidence_root, output_hash, run_hash, salt }",
              },
              {
                step: "2",
                title: "On-chain sealed hash",
                code: "commitment = Blake2b256(BCS(VotePreimageV1))",
              },
              {
                step: "3",
                title: "Reveal verification",
                code: "Move asserts Blake2b256(preimage) == stored_commitment",
              },
            ].map((row) => (
              <li key={row.step} className="flex gap-3">
                <span className="ov-micro ov-micro-sm grid size-7 shrink-0 place-items-center rounded-lg bg-sealed/10 text-sealed">
                  {row.step}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <FieldLabel>{row.title}</FieldLabel>
                  <Well className="ov-scroll overflow-x-auto">
                    <code className="font-mono text-[11px] whitespace-pre text-ocean">
                      {row.code}
                    </code>
                  </Well>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Jurors cannot see or change their vote after committing. Unopened commitments are
            penalised through reputation and bond slashing once the deadline expires. Salts
            never leave the engine, and a malformed model output can never become a vote — the
            adapter fails closed.
          </p>
        </Panel>
      </section>

      {/* 4. Diversity */}
      <section id="diversity" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="04"
          icon={Cpu}
          title="Model diversity & architecture invariants"
          body="Large language models exhibit non-deterministic reasoning, hallucinations and shared training biases. Four invariants keep the jury resilient."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              title: "Strict 3-family rule",
              body: "Every 5-agent committee drawn by Sui native randomness must contain at least 3 distinct model families (DeepSeek-V4, Kimi-K2.6, MiniMax-M2.7).",
            },
            {
              title: "Human-backing separation",
              body: "No single human owner or entity may operate more than one seat in any committee.",
            },
            {
              title: "Zero-temperature determinism",
              body: "Inference calls run at temperature 0 with strict schema enforcement, eliminating prompt variance between reruns.",
            },
            {
              title: "SSRF-safe evidence ingestion",
              body: "Crawlers block private subnets, loopbacks and metadata IPs, and canonicalise HTML into plain text before hashing.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="ov-edge space-y-1.5 rounded-2xl border border-border bg-card p-4"
            >
              <h3 className="text-sm font-semibold text-ocean">{item.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Uncertainty */}
      <section id="uncertainty" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="05"
          icon={Warning2}
          title="Uncertainty as a first-class result"
          body="Unlike binary oracles that force an artificial YES or NO onto ambiguous claims, OpenVerdict treats UNSURE as a valid, honest outcome."
        />
        <Panel label="What UNSURE does" icon={Warning2} tone="warn">
          <p className="text-xs leading-relaxed text-muted-foreground">
            When evidence conflicts, cannot be verified, or is simply insufficient, a juror votes
            UNSURE and is assigned a neutral 5,000 bps probability. If four of five jurors agree
            on UNSURE — or if no 4-of-5 supermajority is reached after two rounds — the claim
            finalizes as{" "}
            <strong className="font-semibold text-ocean">UNRESOLVED</strong>, releasing policy
            refunds and protecting prediction-market participants from arbitrary settlement.
          </p>
        </Panel>
      </section>

      {/* 6. Truth score */}
      <section id="score" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="06"
          icon={Award}
          title="Deterministic Truth Score formulation"
          body="Rather than producing a subjective rating, the Truth Score is pure on-chain half-up integer arithmetic over revealed confidence basis points in the final valid round."
        />
        <Panel label="Formula" icon={Award} tone="yes">
          <Well className="space-y-1 font-mono text-xs">
            <div className="font-bold text-ocean">
              truthScoreBps = (Σ agentProbabilityBps + ⌊N / 2⌋) / N
            </div>
            <div className="text-muted-foreground">• YES → probability = confidenceBps</div>
            <div className="text-muted-foreground">
              • NO → probability = 10,000 − confidenceBps
            </div>
            <div className="text-muted-foreground">• UNSURE → probability = 5,000 bps</div>
          </Well>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Claims settled optimistically without a jury round return{" "}
            <em>&ldquo;Not independently reviewed&rdquo;</em> instead of an invented confidence
            score. You can rerun the whole calculation yourself in the browser.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3 min-h-[38px] font-semibold">
            <Link href="/verify">
              Open the independent verifier
              <ArrowRight size="14" variant="Bold" />
            </Link>
          </Button>
        </Panel>
      </section>

      {/* 7. Sign-in */}
      <section id="signin" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="07"
          icon={Wallet}
          title="Signing in"
          body="Reading claims, observing juries, browsing agents, verifying proofs, checking status and submitting a fact-check all require no sign-in."
        />
        <Panel label="Wallets & zkLogin" icon={Wallet} tone="chain">
          <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Deposits and position or payout views require a connected Sui wallet. Everything
              else on this site stays anonymous.
            </p>
            <p>
              Google sign-in uses Sui zkLogin through Enoki to create a self-custodial address.
              It is an authentication option — never proof of unique humanity.
            </p>
            <p>
              A juror agent receives the{" "}
              <strong className="font-semibold text-ocean">ZKLOGIN_BACKED</strong> label only
              after its Google zkLogin address signs the canonical backing message. With a fixed
              Enoki salt policy, one Google account maps to one backing hash and therefore one
              committee seat. This raises Sybil cost; it is not proof of personhood.
            </p>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function SectionHeading({
  index,
  icon: Icon,
  title,
  body,
}: {
  index: string;
  icon: IconComponent;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-sea/12 text-primary ring-1 ring-sea/20">
          <Icon size="17" variant="Bold" />
        </span>
        <span className="ov-micro ov-micro-sm text-muted-foreground tabular-nums">
          {index}
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-ocean sm:text-xl">{title}</h2>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

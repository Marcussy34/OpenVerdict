import { Badge } from "@/components/ui/badge";
import {
  Judge,
  Lock,
  Cpu,
  Warning2,
  Award,
  ShieldTick,
  Wallet,
} from "iconsax-react";

export default function LearnPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-10">
      {/* Header */}
      <div className="space-y-2 border-b border-border/80 pb-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Judge size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            How OpenVerdict Works: Protocol Concepts
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A decentralized intelligence verification engine and oracle combining Sui Move smart contracts, diverse GonkaRouter AI juries, and permanent Walrus storage.
        </p>
      </div>

      {/* Section 1: Optimistic Resolution & Disputation */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <ShieldTick size="20" variant="Bold" className="text-primary" />
          <h2>1. Optimistic Resolution &amp; Escalation Pathways</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          OpenVerdict supports two resolution pathways designed for economic efficiency and trust minimization:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2">
            <span className="font-bold text-foreground block text-sm">Direct Review</span>
            <p className="text-muted-foreground leading-relaxed">
              Designed for public fact-checking and developer oracle queries. Skips the optimistic proposal window and directly freezes evidence, selects 5 AI jurors, and convenes the commit-reveal jury round immediately.
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2">
            <span className="font-bold text-foreground block text-sm">Optimistic Settlement</span>
            <p className="text-muted-foreground leading-relaxed">
              A proposer posts a bonded proposed outcome. If no counter-claimant challenges the proposal before the challenge deadline, the claim finalizes without incurring inference costs. If challenged with counter-evidence, the claim escalates to an autonomous AI jury.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Cryptographic Commit-Reveal Protocol */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <Lock size="20" variant="Bold" className="text-primary" />
          <h2>2. Cryptographic Commit-Reveal: Eliminating Model Collusion</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          In naive multi-agent systems, language models can be biased by viewing intermediate votes or reasoning traces from other models, leading to systemic groupthink and frontrunning.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          OpenVerdict prevents collusion using a two-stage cryptographic commit-reveal protocol enforced directly on Sui:
        </p>
        <div className="rounded-xl bg-muted/40 p-4 border border-border/60 text-xs font-mono space-y-1.5 text-foreground/90">
          <div>1. Commitment Preimage: VotePreimageV1 &#123; claim_id, agent_id, outcome, confidence, evidence_root, run_hash, salt &#125;</div>
          <div>2. On-chain Sealed Hash: Commitment = Blake2b256(BCS(VotePreimageV1))</div>
          <div>3. Reveal Verification: Move verifies that Blake2b256(Preimage) == Stored Commitment</div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Jurors cannot view or modify their votes after commitment. Unopened commitments are penalized by reputation and bond slashing after deadline expiry.
        </p>
      </section>

      {/* Section 3: AI Limitations & Diversity */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <Cpu size="20" variant="Bold" className="text-primary" />
          <h2>3. Model Diversity &amp; Architecture Invariants</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Large language models exhibit non-deterministic reasoning, hallucinations, and shared training biases. To ensure resilient oracle consensus:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
          <li>
            <strong className="text-foreground">Strict 3-Model Rule:</strong> Every 5-agent committee selected via Sui native randomness must contain at least 3 distinct model families (e.g. DeepSeek-V4, Kimi-K2.6, MiniMax-M2.7).
          </li>
          <li>
            <strong className="text-foreground">Human-Backing Separation:</strong> No single human owner or entity may operate more than 1 seat in any committee.
          </li>
          <li>
            <strong className="text-foreground">Zero-Temperature Determinism:</strong> Inference calls use temperature 0 with strict schema enforcement to eliminate prompt variance.
          </li>
          <li>
            <strong className="text-foreground">SSRF-Safe Evidence Ingestion:</strong> Crawlers block private subnets, loopbacks, and metadata IPs, canonicalizing HTML into pure text before hashing.
          </li>
        </ul>
      </section>

      {/* Section 4: Uncertainty-as-a-Result */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <Warning2 size="20" variant="Bold" className="text-primary" />
          <h2>4. Uncertainty-as-a-Result: Treating UNSURE as First-Class</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Unlike traditional binary oracles that force an artificial YES or NO decision on ambiguous claims, OpenVerdict treats <strong>UNSURE</strong> as a valid, honest outcome.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When evidence is conflicting, unverified, or ambiguous, models vote UNSURE (assigned a neutral 5,000 bps probability). If 4 of 5 jurors agree on UNSURE, or if no 4-of-5 supermajority is reached after two rounds, the claim finalizes as <strong className="text-foreground">UNRESOLVED</strong>, releasing policy refunds and protecting prediction market participants from arbitrary settlement.
        </p>
      </section>

      {/* Section 5: Truth Score Formulation */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <Award size="20" variant="Bold" className="text-primary" />
          <h2>5. Deterministic Truth Score Formulation</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Rather than producing a subjective rating, the Truth Score is computed purely through on-chain deterministic half-up integer arithmetic over revealed confidence basis points in the final valid round:
        </p>
        <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2 text-xs">
          <div className="font-mono text-foreground font-bold">
            TruthScoreBps = (Σ AgentProbabilityBps + ⌊N / 2⌋) / N
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Where YES = Confidence Bps, NO = 10,000 - Confidence Bps, and UNSURE = 5,000 Bps.
          </p>
          <p className="text-muted-foreground text-[11px]">
            Claims settled without a jury round return <em>&quot;Not independently reviewed&quot;</em> to avoid inventing synthetic confidence scores.
          </p>
        </div>
      </section>

      {/* Section 6: Wallet connection and social onboarding */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-foreground font-bold text-lg">
          <Wallet size="20" variant="Bold" className="text-primary" />
          <h2>6. Signing in</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Reading claims, observing juries, browsing agents, verifying proofs,
          checking status, and submitting a fact-check require no sign-in.
          Deposits and position or payout views require a connected Sui wallet.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Google sign-in uses Sui zkLogin through Enoki to create a self-custodial
          address. It is an authentication option, not proof of unique humanity.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A juror agent receives the <strong className="text-foreground">ZKLOGIN_BACKED</strong> label only after its Google zkLogin address signs the canonical backing message. With a fixed Enoki salt policy, one Google account maps to one backing hash and therefore one committee seat; this raises Sybil cost but is not proof of personhood.
        </p>
      </section>
    </div>
  );
}

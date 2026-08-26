import { Badge } from "@/components/ui/badge";
import { Warning2, ShieldCross, Cpu, Lock, Link21 } from "iconsax-react";

export default function RiskPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      <div className="space-y-2 border-b border-border/80 pb-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Warning2 size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Risk Disclosure &amp; Protocol Limitations
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          OpenVerdict is an experimental decentralized oracle and AI jury protocol. Users and developers must understand the technical and economic risks before deploying capital.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        {/* Risk 1: AI Model Limitations */}
        <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Cpu size="20" variant="Bold" className="text-amber-500" />
            <h2>1. Large Language Model Non-Determinism &amp; Hallucinations</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Large language models (LLMs) may misinterpret complex domain-specific evidence, hallucinate factual relationships, or succumb to subtle adversarial prompt injections. While OpenVerdict mitigates this via strict 3-model diversity, zero temperature, and structured output validation, AI inference cannot provide absolute mathematical correctness.
          </p>
        </section>

        {/* Risk 2: Smart Contract & Unaudited Move Code */}
        <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Lock size="20" variant="Bold" className="text-red-500" />
            <h2>2. Unaudited Move Smart Contracts &amp; Capability Risk</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The Move protocol packages deployed on Sui Testnet and demonstration Mainnet environments are experimental and have not undergone a formal third-party security audit. Protocol parameters, caps, and coin pools should be constrained to low-value demonstration balances.
          </p>
        </section>

        {/* Risk 3: Economic Attack Vectors & Frontrunning */}
        <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Link21 size="20" variant="Bold" className="text-blue-500" />
            <h2>3. Oracle Latency &amp; Disputation Windows</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Optimistic claims rely on bonded challenge windows. If network congestion or off-chain indexer delays prevent timely challenge submissions before epoch deadlines, malicious proposals could finalize unchallenged. Direct review mode should be preferred for latency-critical oracle integrations.
          </p>
        </section>

        {/* Risk 4: Capped Demonstration Funds */}
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-2 text-amber-950 dark:text-amber-100">
          <div className="flex items-center gap-2 font-bold text-base">
            <ShieldCross size="20" variant="Bold" className="text-amber-600" />
            <h2>4. Demonstration Caps &amp; Hackathon Environment</h2>
          </div>
          <p className="text-xs leading-relaxed">
            During this release period, all prediction market pools (e.g. <code>DemoBinaryPool</code>) and jury bounties are strictly capped. Do not deposit meaningful financial capital.
          </p>
        </section>
      </div>
    </div>
  );
}

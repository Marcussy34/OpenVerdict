import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel } from "@/components/viz/panel";
import { Warning2, ShieldCross, Cpu, Lock, Link21 } from "@/components/icons";

const RISKS = [
  {
    index: "01",
    icon: Cpu,
    tone: "warn" as const,
    title: "Large language model non-determinism & hallucination",
    body: "LLMs may misinterpret complex domain-specific evidence, hallucinate factual relationships, or fall for subtle adversarial prompt injections. OpenVerdict mitigates this with strict 3-family model diversity, temperature 0, and structured output validation — but AI inference cannot provide absolute mathematical correctness.",
  },
  {
    index: "02",
    icon: Lock,
    tone: "warn" as const,
    title: "Unaudited Move smart contracts & capability risk",
    body: "The Move packages deployed on Sui testnet and demonstration mainnet environments are experimental and have not undergone a formal third-party security audit. Protocol parameters, caps and coin pools should be constrained to low-value demonstration balances.",
  },
  {
    index: "03",
    icon: Link21,
    tone: "chain" as const,
    title: "Oracle latency & disputation windows",
    body: "Optimistic claims rely on bonded challenge windows. If network congestion or off-chain indexer delays prevent timely challenge submission before epoch deadlines, a malicious proposal could finalize unchallenged. Prefer direct review for latency-critical oracle integrations.",
  },
];

export default function RiskPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <PageHeader
        eyebrow="Before you deploy capital"
        title="Risk disclosure"
        description="OpenVerdict is an experimental decentralized oracle and AI jury protocol. Understand the technical and economic risks first."
        icon={Warning2}
        badges={<ExperimentalTag />}
      />

      <div className="space-y-4">
        {RISKS.map((risk) => (
          <Panel
            key={risk.index}
            label={`Risk ${risk.index}`}
            icon={risk.icon}
            tone={risk.tone}
          >
            <h2 className="text-base font-semibold text-ocean">{risk.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{risk.body}</p>
          </Panel>
        ))}

        {/* Hackathon caps — deliberately louder than the other cards. */}
        <section className="ov-edge relative overflow-hidden rounded-2xl border border-unsure/35 bg-unsure/6 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-unsure/15 text-unsure">
              <ShieldCross size="20" variant="Bold" />
            </span>
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-unsure uppercase">
                Risk 04
              </span>
              <h2 className="text-base font-semibold text-ocean">
                Demonstration caps &amp; hackathon environment
              </h2>
              <p className="text-sm leading-relaxed text-foreground/80">
                During this release period all prediction market pools (for example{" "}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-xs text-ocean">
                  DemoBinaryPool
                </code>
                ) and jury bounties are strictly capped. Do not deposit meaningful financial
                capital.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

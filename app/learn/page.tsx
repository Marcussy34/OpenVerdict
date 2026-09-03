import type { Metadata } from "next";
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
  DocumentText,
  type IconComponent,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Learn",
};

const CONTENTS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "secret-votes", label: "Secret votes" },
  { id: "five-jurors", label: "Five jurors" },
  { id: "unsure", label: "When it's unsure" },
  { id: "truth-score", label: "Truth Score" },
  { id: "signin", label: "Signing in" },
  { id: "facts", label: "Key facts" },
];

// The Limitless-style closing table: one glance, the whole system.
const KEY_FACTS: Array<[string, string]> = [
  ["Chain", "Sui testnet: verdicts and certificates live on-chain"],
  ["Evidence storage", "Walrus: every source and juror work file, public"],
  ["AI inference", "GonkaRouter only, by protocol rule: DeepSeek, Kimi and MiniMax families; a juror that cannot reach Gonka fails closed, never falls back"],
  ["Currency", "SUI: requesters fund claim budgets; validly revealed seats earn jury-reward payout tickets"],
  ["Seat stake", "0.1 SUI minimum, posted by the staker, who receives that seat's jury rewards; the bond returns 24 hours after unstaking"],
  ["Jury", "5 jurors; 4 of 5 must agree to decide"],
  ["Outcomes", "YES, NO or UNRESOLVED, each with a 0-100 Truth Score"],
  ["Cost to read or verify", "Free: no account, no wallet, no gas"],
];

export default function LearnPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Get started"
        title="How OpenVerdict works"
        description="Submit a claim. An adversarial AI jury protocol, not an agent swarm: five juror seats from three model families research it independently, vote in secret, cross-examine a deadlock over the frozen evidence, and publish every step so anyone can check the answer."
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

      {/* 1. Overview */}
      <section id="overview" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="01"
          icon={ShieldTick}
          title="One question: is this claim true?"
          body="OpenVerdict is a public fact-checking machine whose work you can re-check."
        />
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            You submit one clear claim, for example{" "}
            <em>&ldquo;The first Bitcoin halving happened in November 2012.&rdquo;</em>{" "}
            Five AI jurors research it on the live web, weigh the evidence on both
            sides, and vote{" "}
            <strong className="font-semibold text-ocean">YES</strong>,{" "}
            <strong className="font-semibold text-ocean">NO</strong> or{" "}
            <strong className="font-semibold text-ocean">UNSURE</strong>.
          </p>
          <p>
            Votes are locked in secret first and only opened together, so no juror
            can copy or herd around another. If the panel splits, the jurors
            cross-examine each other in public over the frozen evidence (three
            exchanges at most, nothing new invented) and vote once more in
            secret; an honest deadlock ends as UNRESOLVED. The verdict and its{" "}
            <strong className="font-semibold text-ocean">Truth Score</strong> are
            then stamped on the Sui blockchain, where nobody can quietly edit them.
          </p>
        </div>
      </section>

      {/* 2. How it works */}
      <section id="how-it-works" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="02"
          icon={Cpu}
          title="How it works"
          body="Five steps, the same every time. Each one leaves a public record."
        />
        <Pipeline />
      </section>

      {/* 3. Secret votes */}
      <section id="secret-votes" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="03"
          icon={Lock}
          title="Votes are locked, then opened"
          body="If jurors could peek at each other, they would herd. So peeking is impossible."
        />
        <Panel label="Three moves" icon={Lock} tone="sealed">
          <ol className="space-y-3">
            {[
              {
                step: "1",
                title: "Lock",
                text: "Each juror's vote is sealed into a fingerprint on the blockchain. The vote itself stays hidden.",
              },
              {
                step: "2",
                title: "Wait",
                text: "Nothing opens until every juror has locked in, or the clock runs out.",
              },
              {
                step: "3",
                title: "Open",
                text: "Each vote must match its fingerprint exactly. A changed vote simply will not open.",
              },
            ].map((row) => (
              <li key={row.step} className="flex gap-3">
                <span className="ov-micro ov-micro-sm grid size-7 shrink-0 place-items-center rounded-lg bg-sealed/10 text-sealed">
                  {row.step}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <FieldLabel>{row.title}</FieldLabel>
                  <p className="text-xs leading-relaxed text-muted-foreground">{row.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
            No juror ever sees another vote before locking their own. Not the other
            jurors, not us, not anyone.
          </p>
        </Panel>
      </section>

      {/* 4. Five jurors */}
      <section id="five-jurors" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="04"
          icon={Judge}
          title="Five jurors, three AI makers"
          body="One AI can be wrong, biased, or having a bad day. Five from different makers keep each other honest."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              title: "Different makers",
              body: "Every jury mixes models from DeepSeek, Kimi and MiniMax, drawn randomly on-chain. No single company decides.",
            },
            {
              title: "Spread across models and keys",
              body: "A jury seats at most two jurors per model family and one per operational signing key, so one draw always spans three families and different operators. There is no cap per staker.",
            },
            {
              title: "Same run, same answer",
              body: "Jurors run in deterministic mode, so rerunning a vote gives the same result.",
            },
            {
              title: "Sources you can reopen",
              body: "Every page a juror read is stored publicly, exactly as it was fetched.",
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

      {/* 5. Unsure */}
      <section id="unsure" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="05"
          icon={Warning2}
          title={'"We don\u2019t know" is an honest answer'}
          body="Some claims cannot be settled with the evidence available. OpenVerdict never fakes certainty."
        />
        <Panel label="What UNSURE does" icon={Warning2} tone="warn">
          <p className="text-xs leading-relaxed text-muted-foreground">
            A juror who cannot verify a claim votes{" "}
            <strong className="font-semibold text-ocean">UNSURE</strong>. If the
            jury cannot reach 4-of-5 agreement, the claim ends as{" "}
            <strong className="font-semibold text-ocean">UNRESOLVED</strong> and
            fees are refunded, instead of forcing a fake YES or NO onto anyone
            relying on the answer.
          </p>
        </Panel>
      </section>

      {/* 6. Truth score */}
      <section id="truth-score" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="06"
          icon={Award}
          title="The Truth Score"
          body="Every verdict carries a confidence score from 0 to 100."
        />
        <Panel label="How to read it" icon={Award} tone="yes">
          <Well className="space-y-1 font-mono text-xs">
            <div className="font-bold text-ocean">95 = very confident the claim is TRUE</div>
            <div className="text-muted-foreground">5 = very confident it is FALSE</div>
            <div className="text-muted-foreground">around 50 = genuinely uncertain</div>
          </Well>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            It is a plain average of the jurors&apos; revealed confidence: a YES
            counts as its confidence, a NO as 100 minus it, an UNSURE as 50. No
            judgment calls, no hidden weights, and you can recompute it yourself
            in your browser.
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
          title="No account needed"
          body="Reading claims, watching juries, checking proofs and submitting a claim: all free, no sign-in."
        />
        <Panel label="Who signs in, then?" icon={Wallet} tone="chain">
          <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              A Sui wallet is only needed for deposits, payouts and staking on a
              seat. Everything else stays anonymous.
            </p>
            <p>
              People who want to open a juror seat stake on it: 0.1 SUI at
              least, real money posted by the staker. That seat&apos;s jury
              rewards go to the staker, and the bond is lost if the seat is
              slashed. Unstake any time and the bond returns 24 hours later.
            </p>
            <p>
              Any account can stake, and there is no cap on how many seats one
              staker opens. A Google sign-in (Sui zkLogin) works too, so people
              without a wallet can stake, and OpenVerdict sponsors the gas, so
              the 0.1 SUI is the only cost.
            </p>
          </div>
        </Panel>
      </section>

      {/* 8. Key facts */}
      <section id="facts" className="scroll-mt-24 space-y-4">
        <SectionHeading
          index="08"
          icon={DocumentText}
          title="Key facts"
          body="The whole system at a glance."
        />
        <div className="ov-edge overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full">
            <tbody>
              {KEY_FACTS.map(([stat, detail]) => (
                <tr key={stat} className="border-b border-border last:border-0">
                  <td className="w-48 px-4 py-3 align-top text-xs font-semibold text-muted-foreground">
                    {stat}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-ocean">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

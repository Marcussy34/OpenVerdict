import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel } from "@/components/viz/panel";
import { DocumentText, InfoCircle, Lock, Global, Warning2 } from "@/components/icons";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Data handling"
        title="Privacy notice"
        description="How OpenVerdict treats submitted claims, evidence URLs and on-chain oracle data."
        icon={DocumentText}
        badges={<ExperimentalTag />}
      />

      <Panel label="01 · Public & permanent storage" icon={Global} tone="chain">
        <h2 className="text-base font-semibold text-ocean">
          Blockchain and Walrus storage are public and permanent
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          When you submit a fact-check claim, pasted text or evidence URL, the content is parsed,
          hashed and published to the <strong className="text-ocean">Sui public blockchain</strong>{" "}
          and <strong className="text-ocean">Walrus decentralized storage</strong>.
        </p>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-unsure/30 bg-unsure/8 p-3.5">
          <Warning2 size="17" variant="Bold" className="mt-0.5 shrink-0 text-unsure" />
          <p className="text-xs leading-relaxed text-foreground/85">
            <strong className="font-semibold text-ocean">Warning.</strong> Do not submit private
            personal data, confidential keys, credentials or proprietary information. Stored
            blobs and transaction records are globally immutable and permanent.
          </p>
        </div>
      </Panel>

      <Panel label="02 · AI inference processing" icon={Lock} tone="sealed">
        <h2 className="text-base font-semibold text-ocean">GonkaRouter inference</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Submitted claims and sanitized evidence text are transmitted to LLM inference providers
          via GonkaRouter for jury deliberation. Inference prompts and model outputs are public
          and audited to prevent adversarial prompt injection. Models never fetch anything
          themselves and never receive API keys or transaction authority: every web search and
          page open a juror requests is executed by the engine, recorded and hashed, and salts
          and seal keys never leave the engine.
        </p>
      </Panel>

      <Panel label="03 · Analytics & cookies" icon={InfoCircle} tone="primary">
        <h2 className="text-base font-semibold text-ocean">No tracking</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The OpenVerdict observer interface uses no tracking cookies, advertising beacons or
          third-party analytics trackers. Web server logs contain standard ephemeral access
          records for rate limiting and DDoS prevention only.
        </p>
      </Panel>
    </div>
  );
}

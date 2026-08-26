import { Badge } from "@/components/ui/badge";
import { DocumentText, InfoCircle, Lock, Global } from "iconsax-react";

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      <div className="space-y-2 border-b border-border/80 pb-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <DocumentText size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Privacy Notice
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground">
          How OpenVerdict treats submitted claims, evidence URLs, and on-chain oracle data.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Global size="18" variant="Bold" className="text-primary" />
            1. Public &amp; Permanent Nature of Blockchain &amp; Walrus Storage
          </h2>
          <p>
            When you submit a fact-check claim, pasted text, or evidence URL, the content is parsed, hashed, and published to the <strong>Sui public blockchain</strong> and <strong>Walrus decentralized storage</strong>.
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-500/10 p-3 rounded-lg border border-amber-500/30">
            <strong>Warning:</strong> Do not submit private personal data, confidential keys, credentials, or proprietary information. Stored blobs and transaction records are globally immutable and permanent.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Lock size="18" variant="Bold" className="text-primary" />
            2. AI Inference Processing (GonkaRouter)
          </h2>
          <p>
            Submitted claims and sanitized evidence text are transmitted to LLM inference providers via GonkaRouter for jury deliberations. Inference prompts and model outputs are public and audited to prevent adversarial prompt injections.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <InfoCircle size="18" variant="Bold" className="text-primary" />
            3. Web Analytics &amp; Cookies
          </h2>
          <p>
            The OpenVerdict observer interface does not use tracking cookies, advertising beacons, or third-party analytics trackers. Web server logs contain standard ephemeral access records for rate-limiting and DDoS prevention only.
          </p>
        </section>
      </div>
    </div>
  );
}

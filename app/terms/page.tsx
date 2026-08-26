import { Badge } from "@/components/ui/badge";
import { DocumentText, Warning2 } from "iconsax-react";

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      <div className="space-y-2 border-b border-border/80 pb-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <DocumentText size="18" variant="Bold" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Terms of Use
          </h1>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Experimental
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Last updated: August 2026. Please review these terms carefully before interacting with OpenVerdict.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <Warning2 size="20" variant="Bold" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1 text-amber-900 dark:text-amber-100">
            <strong className="block font-bold">Experimental Research Software</strong>
            <span>
              OpenVerdict is experimental software developed for demonstration and hackathon evaluation. Smart contracts and AI juror models are unaudited.
            </span>
          </div>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground">1. Nature of the Protocol</h2>
          <p>
            OpenVerdict provides an autonomous AI jury coordination protocol on the Sui network. Outputs, Truth Scores, and Resolution Certificates represent deterministic aggregations of AI model inferences and do not constitute absolute truth, legal testimony, or financial advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground">2. Read-Only Observer Dashboard</h2>
          <p>
            This web interface operates solely as a read-only projection over public blockchain events, Walrus storage blobs, and engine feeds. The dashboard has no private keys, does not sign transactions on your behalf, and does not custody funds.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground">3. No Financial Advice</h2>
          <p>
            Nothing contained in this application or emitted by the OpenVerdict oracle constitutes investment, financial, legal, or tax advice. Any integration with prediction markets or settlement pools is undertaken entirely at the user&apos;s own risk.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground">4. Disclaimer of Warranties</h2>
          <p>
            THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-foreground">5. Open Source License</h2>
          <p>
            OpenVerdict is open-source software licensed under the MIT License. You are free to inspect, audit, verify, and run the engine locally.
          </p>
        </section>
      </div>
    </div>
  );
}

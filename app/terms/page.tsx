import type { Metadata } from "next";
import { PageHeader, ExperimentalTag } from "@/components/viz/page-header";
import { Panel } from "@/components/viz/panel";
import { DocumentText, Warning2 } from "@/components/icons";

export const metadata: Metadata = {
  title: "Terms of use",
};

const SECTIONS = [
  {
    index: "01",
    title: "Nature of the protocol",
    body: "OpenVerdict provides an adversarial AI jury protocol on the Sui network. Outputs, Truth Scores and Resolution Certificates represent deterministic aggregations of AI model inferences. They do not constitute absolute truth, legal testimony or financial advice.",
  },
  {
    index: "02",
    title: "Read-only observer dashboard",
    body: "This web interface operates solely as a read-only projection over public blockchain events, Walrus storage blobs and engine feeds. The dashboard holds no private keys, does not sign transactions on your behalf, and does not custody funds.",
  },
  {
    index: "03",
    title: "No financial advice",
    body: "Nothing in this application or emitted by the OpenVerdict oracle constitutes investment, financial, legal or tax advice. Any integration with prediction markets or settlement pools is undertaken entirely at the user's own risk.",
  },
  {
    index: "04",
    title: "Disclaimer of warranties",
    body: 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY.',
  },
  {
    index: "05",
    title: "Open source licence",
    body: "OpenVerdict is open-source software licensed under the MIT License. You are free to inspect, audit, verify and run the engine locally.",
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        eyebrow="Last updated August 2026"
        title="Terms of use"
        description="Please review these terms carefully before interacting with OpenVerdict."
        icon={DocumentText}
        badges={<ExperimentalTag />}
      />

      {/* Failure red, not amber: amber belongs to the UNSURE verdict alone. */}
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/35 bg-destructive/6 p-4">
        <Warning2 size="18" variant="Bold" className="mt-0.5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ocean">Experimental research software</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            OpenVerdict is experimental software developed for demonstration and hackathon
            evaluation. Smart contracts and AI juror models are unaudited.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <Panel key={section.index} label={`Section ${section.index}`}>
            <h2 className="text-base font-semibold text-ocean">{section.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}

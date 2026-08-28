"use client";

import { use } from "react";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel, Well } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { TimeDisplay } from "@/components/time-display";
import { DocumentText, ShieldTick, Global, Clock, Box, Lock } from "@/components/icons";

interface EvidenceDetailPageProps {
  params: Promise<{ id: string }>;
}

// Static timestamp (2026-08-27T00:00:00Z) keeps this render pure per react-hooks/purity.
const SAMPLE_RETRIEVED_AT_MS = 1756252800000;

export default function EvidenceDetailPage({ params }: EvidenceDetailPageProps) {
  const { id } = use(params);

  // Evidence artifact metadata as the manifest records it.
  const evidence = {
    evidenceId: id,
    sourceUrl: "https://example.com/press/release-2026-audit",
    retrievedAtMs: SAMPLE_RETRIEVED_AT_MS,
    walrusBlobId: "blob_walrus_981a2f90cde1482",
    walrusBlobObjectId: "0x4b78912e...6f01",
    walrusEndEpoch: 420,
    contentHash: "0x89ab12cd34ef567890abcdef1234567890abcdef1234567890abcdef12345678",
    canonicalHash: "0xfe1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    merkleRoot: "0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
    phase: 1,
    sourceClass: "PRIMARY_DOCUMENTATION",
    sanitizedExcerpt:
      "Official press release: 'The transaction throughput benchmark conducted across epochs 348 to 352 demonstrated a peak sustained rate exceeding 100 million verified transaction executions.' Content was sanitized and stripped of executable scripts.",
  };

  const HASHES = [
    {
      label: "Raw content Blake2b-256 hash",
      value: evidence.contentHash,
      hint: "Hash of the bytes exactly as retrieved, before any transformation.",
    },
    {
      label: "Sanitized canonical hash",
      value: evidence.canonicalHash,
      hint: "Hash of the HTML-to-text canonical form the jurors actually read.",
    },
    {
      label: "Bundle Merkle root",
      value: evidence.merkleRoot,
      hint: "Frozen on-chain; every juror commitment binds to this root.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        backHref="/claims"
        backLabel="All claims"
        eyebrow={`Phase ${evidence.phase} · ${evidence.sourceClass.replace(/_/g, " ").toLowerCase()}`}
        title="Evidence artifact"
        icon={DocumentText}
        badges={<ExperimentalTag />}
        actions={
          <MetaTag tone="yes">
            <ShieldTick size="11" variant="Bold" />
            Frozen on Walrus
          </MetaTag>
        }
      >
        <div className="mt-4">
          <HashChip value={evidence.evidenceId} label="evidence" tone="chain" head={12} tail={10} />
        </div>
      </PageHeader>

      {/* Source */}
      <Panel label="Original source" icon={Global} tone="chain">
        <div className="space-y-3">
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 font-mono text-sm font-semibold break-all text-primary hover:underline"
          >
            <Global size="16" variant="Bold" className="mt-0.5 shrink-0" />
            {evidence.sourceUrl}
          </a>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Clock size="13" variant="Bold" />
            <span>Retrieved at</span>
            <TimeDisplay timestampMs={evidence.retrievedAtMs} />
          </div>
        </div>
      </Panel>

      {/* Hashes */}
      <Panel label="Content hashes" icon={Lock} tone="sealed">
        <div className="space-y-3">
          {HASHES.map((h) => (
            <div key={h.label} className="space-y-1.5 rounded-xl border border-border bg-surface p-3">
              <FieldLabel>{h.label}</FieldLabel>
              <HashChip value={h.value} tone="sealed" full />
              <p className="text-[11px] text-muted-foreground">{h.hint}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Walrus */}
      <Panel label="Walrus decentralized storage" icon={Box} tone="primary">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel>Blob id</FieldLabel>
            <HashChip value={evidence.walrusBlobId} tone="chain" full />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Blob object id</FieldLabel>
            <HashChip value={evidence.walrusBlobObjectId} tone="chain" full />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Retention end epoch</FieldLabel>
            <p className="text-sm font-semibold text-ocean tabular-nums">
              {evidence.walrusEndEpoch}
            </p>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Source class</FieldLabel>
            <p className="ov-micro text-ocean">{evidence.sourceClass}</p>
          </div>
        </dl>
      </Panel>

      {/* Excerpt */}
      <Panel label="Sanitized excerpt shown to jurors" icon={DocumentText}>
        <Well className="font-mono text-xs leading-relaxed text-foreground/85">
          {evidence.sanitizedExcerpt}
        </Well>
      </Panel>

      {/* Safety */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface p-4">
        <ShieldTick size="16" variant="Bold" className="mt-0.5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ocean">
            SSRF &amp; content-sanitization guarantee (PRD §21.2)
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            All evidence is ingested through DNS-pinned, SSRF-safe proxies enforcing
            private-subnet blocks, size caps (≤2 MB) and HTML-to-text canonicalization before
            being committed to Walrus and referenced in jury inference prompts. Models never
            receive URLs, keys or transaction authority.
          </p>
        </div>
      </div>
    </div>
  );
}

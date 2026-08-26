"use client";

import { use } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TimeDisplay } from "@/components/time-display";
import {
  DocumentText,
  ShieldTick,
  Global,
  Clock,
} from "iconsax-react";

interface EvidenceDetailPageProps {
  params: Promise<{ id: string }>;
}

// Static timestamp (2026-08-27T00:00:00Z) to keep component render pure per react-hooks/purity
const SAMPLE_RETRIEVED_AT_MS = 1756252800000;

export default function EvidenceDetailPage({ params }: EvidenceDetailPageProps) {
  const { id } = use(params);

  // Evidence metadata representation
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

  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div className="space-y-1">
          <Link
            href="/claims"
            className="text-xs text-muted-foreground hover:text-foreground font-medium"
          >
            ← Back to Claims
          </Link>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <DocumentText size="18" variant="Bold" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Evidence Artifact</h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
            >
              Experimental
            </Badge>
          </div>
        </div>

        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold px-3 py-1 flex items-center gap-1.5"
        >
          <ShieldTick size="14" variant="Bold" />
          Frozen on Walrus
        </Badge>
      </div>

      {/* Primary Evidence Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6">
        <div className="space-y-2 border-b border-border/50 pb-5">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
            Original Source URL
          </span>
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono font-semibold text-primary hover:underline flex items-center gap-1.5 break-all"
          >
            <Global size="16" variant="Bold" className="shrink-0" />
            <span>{evidence.sourceUrl}</span>
          </a>
          <div className="text-xs text-muted-foreground pt-1 flex items-center gap-2">
            <Clock size="13" variant="Bold" />
            <span>Retrieved at:</span>
            <TimeDisplay timestampMs={evidence.retrievedAtMs} />
          </div>
        </div>

        {/* Hashes & Decentralized Storage IDs */}
        <div className="space-y-2.5 text-xs font-mono">
          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Raw Content Blake2b-256 Hash
            </span>
            <span className="text-foreground font-semibold break-all block">
              {evidence.contentHash}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Sanitized HTML Canonical Hash
            </span>
            <span className="text-foreground font-semibold break-all block">
              {evidence.canonicalHash}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Walrus Decentralized Blob ID
            </span>
            <span className="text-foreground font-semibold break-all block">
              {evidence.walrusBlobId} (Retention End Epoch: {evidence.walrusEndEpoch})
            </span>
          </div>
        </div>

        {/* Sanitized Excerpt */}
        <div className="space-y-2 pt-2">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
            Sanitized Content Excerpt (Presented to Juror Models)
          </span>
          <div className="p-4 rounded-xl bg-muted/60 border border-border/60 text-xs text-foreground/90 leading-relaxed font-mono">
            {evidence.sanitizedExcerpt}
          </div>
        </div>
      </div>

      {/* Safety Policy & SSRF Notice */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-5 space-y-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <ShieldTick size="15" variant="Bold" className="text-primary" />
          SSRF &amp; Content Sanitization Guarantee (PRD §21.2)
        </span>
        <p className="leading-relaxed">
          All evidence is ingested through DNS-pinned, SSRF-safe proxies enforcing private-subnet blocks, size caps (≤2MB), and HTML-to-text canonicalization before being committed to Walrus and referenced in jury inference prompts.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { Copy, TickCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Copies the claim's object id, the handle the auditor and the verify page
 * take. Icon only, beside the rail's "Claim assertion" label; a tick and the
 * word Copied stand in for a moment after a copy.
 */
export function CopyClaimId({ claimId, className }: { claimId: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  // Never flip state on an unmounted rail (the phone closes it as a sheet).
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(claimId);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (insecure context or denied): the id stays in the page URL.
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      aria-label={copied ? "Claim id copied" : "Copy the claim id"}
      title="Copy the claim id, the handle the audit takes"
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-1 px-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ov-accent)]",
        className,
      )}
    >
      {copied ? <TickCircle size="14" variant="Bold" className="text-yes" /> : <Copy size="14" />}
      <span className={copied ? undefined : "sr-only"}>{copied ? "Copied" : "Copy claim id"}</span>
    </button>
  );
}

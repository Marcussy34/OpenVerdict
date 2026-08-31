"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/viz/panel";
import { CloseCircle, ExportSquare, Global, Refresh, TickCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Metadata GonkaRouter publishes for any past request (no auth, no content). */
type GatewayReceipt = {
  x_request_id?: string;
  x_devshard_id?: string;
  model?: string;
  created_at?: string;
  outcome?: string;
  status_code?: number;
  stream?: boolean;
  total_tokens?: number;
  ttft_ms?: number;
  duration_ms?: number;
};

const DIRECT_URL_BASE = "https://api.gonkarouter.io/v1/receipts/";

function MatchRow({
  label,
  value,
  match,
}: {
  label: string;
  value: string | number | undefined;
  match?: boolean;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-2.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5 font-mono text-[11px] break-all text-foreground/90">
        {match !== undefined && (
          match
            ? <TickCircle size="13" variant="Bold" className="shrink-0 text-yes" />
            : <CloseCircle size="13" variant="Bold" className="shrink-0 text-no" />
        )}
        <span>{value ?? "n/a"}</span>
      </div>
    </div>
  );
}

/**
 * Third-party cross-check: GonkaRouter's public receipt for the recorded
 * request id, compared against what the sealed bundle recorded. Fetched
 * through our relay only because the gateway has no CORS yet; the direct
 * URL is printed so nobody has to trust the relay.
 */
export function GatewayReceiptCheck({
  requestId,
  devshardId,
  expectedModel,
}: {
  requestId: string;
  devshardId?: string;
  expectedModel?: string;
}) {
  const [receipt, setReceipt] = useState<GatewayReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/gateway-receipts/${encodeURIComponent(requestId)}`,
        { cache: "force-cache" },
      );
      if (response.status === 404) {
        setError("The gateway has no record of this request id.");
        setReceipt(null);
        return;
      }
      if (response.status === 429) {
        setError("The gateway rate-limited the lookup; try again in a moment.");
        return;
      }
      if (!response.ok) {
        setError("The gateway receipt service is unreachable right now.");
        return;
      }
      setReceipt(await response.json() as GatewayReceipt);
    } catch {
      setError("The gateway receipt lookup failed.");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  const directUrl = `${DIRECT_URL_BASE}${encodeURIComponent(requestId)}`;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Global size="15" variant="Bold" className="text-primary" />
          <span className="text-sm font-semibold text-ocean">Gateway receipt</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[34px] text-xs font-semibold"
          onClick={() => void check()}
          disabled={loading}
        >
          <Refresh size="13" variant="Bold" className={cn(loading && "animate-spin")} />
          {loading ? "Checking..." : receipt ? "Re-check" : "Check with GonkaRouter"}
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        GonkaRouter publishes metadata for every past request. Anyone can
        confirm this recorded call independently:{" "}
        <a
          href={directUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] break-all text-primary underline-offset-2 hover:underline"
        >
          {directUrl}
          <ExportSquare size="11" />
        </a>{" "}
        (the in-page check relays through this server only because the gateway
        does not send CORS headers yet).
      </p>

      {error && (
        <p className="rounded-lg border border-unsure/30 bg-unsure/8 p-2.5 text-xs font-semibold text-unsure">
          {error}
        </p>
      )}

      {receipt && (
        <div className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-4">
          <MatchRow
            label="Model"
            value={receipt.model}
            match={expectedModel === undefined ? undefined : receipt.model === expectedModel}
          />
          <MatchRow
            label="Devshard"
            value={receipt.x_devshard_id}
            match={devshardId === undefined ? undefined : receipt.x_devshard_id === devshardId}
          />
          <MatchRow label="Completed at" value={receipt.created_at} />
          <MatchRow
            label="Outcome"
            value={receipt.outcome !== undefined ? `${receipt.outcome} (${receipt.status_code ?? "?"})` : undefined}
            match={receipt.outcome === undefined ? undefined : receipt.outcome === "success"}
          />
          <MatchRow label="Total tokens (combined)" value={receipt.total_tokens} />
          <MatchRow label="Time to first token" value={receipt.ttft_ms !== undefined ? `${receipt.ttft_ms} ms` : undefined} />
          <MatchRow label="Duration" value={receipt.duration_ms !== undefined ? `${receipt.duration_ms} ms` : undefined} />
          <MatchRow label="Request id" value={receipt.x_request_id} match={receipt.x_request_id === requestId} />
        </div>
      )}
    </div>
  );
}

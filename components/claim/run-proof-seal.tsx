"use client";

import { useEffect, useState } from "react";

import {
  CloseCircle,
  Lock,
  Refresh,
  TickCircle,
  Warning2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HashChip } from "@/components/viz/hash-chip";
import { FieldLabel } from "@/components/viz/panel";
import {
  isProofRecord,
  type TransparentRunProof,
  type TransparentSealEscrow,
  type TransparentSealKeyServer,
} from "@/components/claim/run-proof-types";
import {
  parseSealIdentity,
  type SealIdentity,
} from "@/lib/seal/identity";
import { cn } from "@/lib/utils";

type DisplayEscrow = {
  packageId: string;
  identity: SealIdentity;
  deadlineMs: number;
  threshold: number;
  keyServers: Array<{
    objectId: string;
    weight: number;
    aggregatorUrl?: string;
  }>;
};

type MetadataResult =
  | { ok: true; value: DisplayEscrow }
  | { ok: false; error: string };

type RecoveryResult =
  | {
      kind: "revealed";
      keyHex: string;
      keysMatch: boolean;
    }
  | {
      kind: "unrevealed";
      keyHex: string;
      coreHash: string;
      coreHashMatches: boolean;
      outcome: string;
      confidenceBps?: number;
    };

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requiredString(value: unknown, field: string): string {
  if (value === undefined) throw new Error(`Seal escrow is missing ${field}`);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Seal escrow ${field} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(
  value: unknown,
  field: string,
  minimum: number,
): number {
  if (value === undefined) throw new Error(`Seal escrow is missing ${field}`);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Seal escrow ${field} must be an integer of at least ${minimum}`);
  }
  return value;
}

function displayKeyServer(
  server: TransparentSealKeyServer,
  index: number,
): DisplayEscrow["keyServers"][number] {
  const objectId = requiredString(server.objectId, `keyServers[${index}].objectId`);
  const weight = requiredInteger(server.weight, `keyServers[${index}].weight`, 1);
  const aggregatorUrl = server.aggregatorUrl;
  if (aggregatorUrl !== undefined) {
    try {
      const parsed = new URL(aggregatorUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new Error(`Seal escrow keyServers[${index}].aggregatorUrl is invalid`);
    }
  }
  return {
    objectId,
    weight,
    ...(aggregatorUrl === undefined ? {} : { aggregatorUrl }),
  };
}

function inspectEscrow(
  proof: TransparentRunProof,
  escrow: TransparentSealEscrow,
): MetadataResult {
  try {
    if (escrow.version === undefined) throw new Error("Seal escrow is missing version");
    if (escrow.version !== 1) throw new Error("Seal escrow version must be 1");
    if (escrow.provider === undefined) throw new Error("Seal escrow is missing provider");
    if (escrow.provider !== "seal") throw new Error("Seal escrow provider must be seal");

    const packageId = requiredString(escrow.packageId, "packageId");
    const identityHex = requiredString(escrow.identityHex, "identityHex");
    const deadlineMs = requiredInteger(escrow.deadlineMs, "deadlineMs", 0);
    const threshold = requiredInteger(escrow.threshold, "threshold", 1);
    requiredString(escrow.encryptedObjectBase64, "encryptedObjectBase64");
    const escrowAad = requiredString(escrow.aad, "aad");

    if (!Array.isArray(escrow.keyServers) || escrow.keyServers.length === 0) {
      throw new Error("Seal escrow is missing keyServers");
    }
    const keyServers = escrow.keyServers.map(displayKeyServer);
    const totalWeight = keyServers.reduce((sum, server) => sum + server.weight, 0);
    if (threshold > totalWeight) {
      throw new Error("Seal escrow threshold exceeds the available server weight");
    }

    const identity = parseSealIdentity(identityHex);
    if (identity.deadlineMs !== deadlineMs) {
      throw new Error("Seal escrow deadline does not match its encoded identity");
    }
    if (!sameHex(identity.claimId, proof.claimId)) {
      throw new Error("Seal identity claim does not match this run proof");
    }
    if (!sameHex(identity.jurySeatId, proof.jurySeatId)) {
      throw new Error("Seal identity seat does not match this run proof");
    }
    if (identity.phase !== proof.phase) {
      throw new Error("Seal identity phase does not match this run proof");
    }
    if (escrowAad !== proof.runId) {
      throw new Error("Seal escrow AAD does not match this run id");
    }

    const sealed = proof.sealed;
    if (!sealed) throw new Error("The sealed bundle document is missing");
    requiredString(sealed.ivHex, "sealed.ivHex");
    requiredString(sealed.coreHash, "sealed.coreHash");
    requiredString(sealed.ciphertextBase64, "sealed.ciphertextBase64");
    if (sealed.runId !== proof.runId || sealed.aad !== proof.runId) {
      throw new Error("The sealed bundle metadata does not match this run id");
    }

    const expectedDeadline =
      proof.phase === 1
        ? proof.claimDeadlines?.firstRevealDeadlineMs
        : proof.claimDeadlines?.secondRevealDeadlineMs;
    if (expectedDeadline !== undefined && expectedDeadline !== identity.deadlineMs) {
      throw new Error("Seal identity deadline does not match the claim deadline");
    }
    if (
      proof.sealPolicy?.packageId !== undefined &&
      !sameHex(proof.sealPolicy.packageId, packageId)
    ) {
      throw new Error("Seal policy package does not match this escrow");
    }

    return {
      ok: true,
      value: { packageId, identity, deadlineMs, threshold, keyServers },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The Seal escrow is invalid",
    };
  }
}

function countdownLabel(deadlineMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
  if (seconds === 0) return "open now";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (days > 0) return `${days}d ${hours}h until open`;
  if (hours > 0) return `${hours}h ${minutes}m until open`;
  if (minutes > 0) return `${minutes}m ${remainder}s until open`;
  return `${remainder}s until open`;
}

function revealedKey(proof: TransparentRunProof): string | null {
  if (!isProofRecord(proof.bundle?.seal)) return null;
  const keyHex = proof.bundle.seal.keyHex;
  return typeof keyHex === "string" && keyHex.trim() ? keyHex : null;
}

function recoveredVerdict(core: Record<string, unknown>): {
  outcome: string;
  confidenceBps?: number;
} {
  const output = isProofRecord(core.validatedOutput)
    ? core.validatedOutput
    : undefined;
  const outcome =
    typeof output?.outcome === "string" ? output.outcome : "Not recorded";
  const confidenceBps =
    typeof output?.confidenceBps === "number" &&
    Number.isFinite(output.confidenceBps)
      ? output.confidenceBps
      : undefined;
  return { outcome, ...(confidenceBps === undefined ? {} : { confidenceBps }) };
}

function Confidence({ basisPoints }: { basisPoints?: number }) {
  return (
    <p className="mt-1 text-sm font-semibold text-ocean">
      {basisPoints === undefined
        ? "Not recorded"
        : `${(basisPoints / 100).toFixed(2)}%`}
    </p>
  );
}

export function RunProofSeal({ proof }: { proof: TransparentRunProof }) {
  const escrow = proof.sealed?.escrow;
  const metadata = escrow ? inspectEscrow(proof, escrow) : null;
  const deadlineMs = metadata?.ok ? metadata.value.deadlineMs : null;
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecoveryResult | null>(null);

  useEffect(() => {
    if (deadlineMs === null) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      const next = Date.now();
      setNowMs(next);
      if (next >= deadlineMs && interval !== undefined) clearInterval(interval);
    };
    update();
    if (Date.now() < deadlineMs) interval = setInterval(update, 1_000);
    return () => {
      if (interval !== undefined) clearInterval(interval);
    };
  }, [deadlineMs]);

  if (!escrow) return null;

  const canOpen =
    metadata?.ok === true && nowMs !== null && nowMs >= metadata.value.deadlineMs;

  const openThroughSeal = async () => {
    if (!metadata?.ok || !proof.sealed || !canOpen) return;
    setOpening(true);
    setError(null);
    setResult(null);
    try {
      // Load the threshold crypto only after the reader asks to recover.
      const { openEscrowedBundle, recoverSealedKey } = await import(
        "@/lib/verify/seal-recovery"
      );
      const network =
        process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet"
          ? "mainnet"
          : "testnet";
      const keyHex = await recoverSealedKey({
        escrow,
        network,
        rpcUrl: process.env.NEXT_PUBLIC_SUI_GRPC_URL,
      });

      if (proof.bundle) {
        const expectedKey = revealedKey(proof);
        if (!expectedKey) {
          throw new Error("The revealed bundle is missing its reveal key");
        }
        setResult({
          kind: "revealed",
          keyHex,
          keysMatch: sameHex(keyHex, expectedKey),
        });
        return;
      }

      const opened = await openEscrowedBundle(proof.sealed, keyHex);
      const verdict = recoveredVerdict(opened.core);
      setResult({
        kind: "unrevealed",
        keyHex,
        coreHash: opened.coreHash,
        coreHashMatches: sameHex(opened.coreHash, proof.sealed.coreHash ?? ""),
        ...verdict,
      });
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "The Seal escrow could not be opened",
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <section
      aria-labelledby={`seal-escrow-${proof.runId}`}
      className="space-y-3 rounded-xl border border-sealed/25 bg-sealed/6 p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3
            id={`seal-escrow-${proof.runId}`}
            className="flex items-center gap-2 text-sm font-semibold text-ocean"
          >
            <Lock size="15" variant="Bold" className="text-sealed" />
            Seal escrow
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Anyone can open this seat&apos;s sealed research after the deadline
            without the operator.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void openThroughSeal()}
          disabled={opening || !canOpen}
          aria-busy={opening}
          className="min-h-[40px] font-semibold"
        >
          {opening ? (
            <Refresh size="15" variant="Bold" className="motion-safe:animate-spin" />
          ) : (
            <Lock size="15" variant="Bold" />
          )}
          {opening ? "Opening through Seal" : "Open through Seal"}
        </Button>
      </div>

      {metadata?.ok ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-2.5 sm:col-span-2">
              <FieldLabel>Policy package id</FieldLabel>
              <HashChip
                value={metadata.value.packageId}
                tone="sealed"
                head={12}
                tail={10}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5">
              <FieldLabel>Threshold</FieldLabel>
              <p className="mt-1 font-mono text-xs font-semibold text-ocean">
                {metadata.value.threshold} weighted share
                {metadata.value.threshold === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5">
              <FieldLabel>Phase</FieldLabel>
              <p className="mt-1 font-mono text-xs font-semibold text-ocean">
                Phase {metadata.value.identity.phase}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5 sm:col-span-2">
              <FieldLabel>Identity claim</FieldLabel>
              <HashChip value={metadata.value.identity.claimId} head={12} tail={10} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5 sm:col-span-2">
              <FieldLabel>Identity seat</FieldLabel>
              <HashChip value={metadata.value.identity.jurySeatId} head={12} tail={10} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-2.5">
            <FieldLabel>Reveal deadline encoded in the identity</FieldLabel>
            {nowMs === null ? (
              <p className="mt-1 text-xs text-muted-foreground">Checking reveal time</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <time
                  dateTime={new Date(metadata.value.deadlineMs).toISOString()}
                  className="text-xs font-semibold text-ocean"
                >
                  opens at {new Date(metadata.value.deadlineMs).toLocaleString()}
                </time>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                    canOpen
                      ? "border-yes/30 bg-yes/8 text-yes"
                      : "border-sealed/30 bg-sealed/8 text-sealed",
                  )}
                >
                  {countdownLabel(metadata.value.deadlineMs, nowMs)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel>Key servers</FieldLabel>
            <ul className="grid gap-2 lg:grid-cols-2">
              {metadata.value.keyServers.map((server) => (
                <li
                  key={server.objectId}
                  className="rounded-lg border border-border bg-card p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <HashChip value={server.objectId} head={10} tail={8} />
                    <span className="ml-auto text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      weight {server.weight}
                    </span>
                  </div>
                  {server.aggregatorUrl && (
                    <p className="mt-1.5 text-[10px] break-all text-muted-foreground">
                      {server.aggregatorUrl}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no"
        >
          <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
          {metadata?.error ?? "The Seal escrow metadata is unavailable"}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-no/25 bg-no/6 p-3 text-xs text-no"
        >
          <Warning2 size="15" variant="Bold" className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <Card
          size="sm"
          className={cn(
            result.kind === "revealed"
              ? result.keysMatch
                ? "ring-yes/30"
                : "ring-no/30"
              : result.coreHashMatches
                ? "ring-yes/30"
                : "ring-no/30",
          )}
        >
          <CardHeader>
            <CardTitle
              className={cn(
                "flex items-center gap-2",
                (result.kind === "revealed" && result.keysMatch) ||
                  (result.kind === "unrevealed" && result.coreHashMatches)
                  ? "text-yes"
                  : "text-no",
              )}
            >
              {(result.kind === "revealed" && result.keysMatch) ||
              (result.kind === "unrevealed" && result.coreHashMatches) ? (
                <TickCircle size="16" variant="Bold" />
              ) : (
                <CloseCircle size="16" variant="Bold" />
              )}
              {result.kind === "revealed"
                ? result.keysMatch
                  ? "Matches the revealed key"
                  : "Differs from the revealed key"
                : result.coreHashMatches
                  ? "Sealed core hash matches"
                  : "Sealed core hash differs"}
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              The key came from independent Seal key servers using this run&apos;s
              on-chain reveal policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border bg-surface p-2.5">
              <FieldLabel>Recovered key</FieldLabel>
              <HashChip
                value={result.keyHex}
                tone={
                  (result.kind === "revealed" && result.keysMatch) ||
                  (result.kind === "unrevealed" && result.coreHashMatches)
                    ? "yes"
                    : "muted"
                }
                head={12}
                tail={10}
              />
            </div>

            {result.kind === "unrevealed" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-surface p-2.5">
                  <FieldLabel>Recovered outcome</FieldLabel>
                  <p className="mt-1 text-sm font-semibold text-ocean">
                    {result.outcome}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface p-2.5">
                  <FieldLabel>Recovered confidence</FieldLabel>
                  <Confidence basisPoints={result.confidenceBps} />
                </div>
                <div className="rounded-lg border border-border bg-surface p-2.5 sm:col-span-2">
                  <FieldLabel>Recomputed sealed core hash</FieldLabel>
                  <HashChip
                    value={result.coreHash}
                    tone={result.coreHashMatches ? "yes" : "muted"}
                    head={12}
                    tail={10}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

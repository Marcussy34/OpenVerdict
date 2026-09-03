"use client";

import { useState, type FormEvent } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import {
  Refresh,
  ShieldTick,
  TickCircle,
  Wallet,
  Warning2,
} from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { Button } from "@/components/ui/button";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { MetaTag } from "@/components/viz/page-header";
import { Input } from "@/components/ui/input";
import type {
  StakedAgentBackingKind,
  ZkBackedRegistrationResult,
} from "@/lib/engine/contract";
import { buildZkLoginBackingMessage } from "@/lib/engine/zklogin";

/** Recorded manifest label, required by the API. It has no behavioral effect:
 * every juror runs the same protocol prompts and tools, so the card offers no
 * role choice and a stake buys a standardized seat. */
const STAKED_SEAT_ROLE = "INVESTIGATOR";

/** Human-readable name for each stake kind the server can return. */
const STAKE_KIND_LABELS: Record<StakedAgentBackingKind, string> = {
  WALLET_STAKED: "Wallet stake",
  ZKLOGIN_BACKED: "Google sign-in stake",
};

type RegistrationPhase = "idle" | "checking" | "signing" | "registering";
type OpenVerdictNetwork = "localnet" | "testnet" | "mainnet";

export function ZkLoginRegistrationCard({
  onRegistered,
}: {
  onRegistered: () => Promise<void>;
}) {
  const account = useCurrentAccount();
  return (
    <ZkLoginRegistrationForm
      key={account?.address ?? "disconnected"}
      account={account}
      onRegistered={onRegistered}
    />
  );
}

function ZkLoginRegistrationForm({
  account,
  onRegistered,
}: {
  account: ReturnType<typeof useCurrentAccount>;
  onRegistered: () => Promise<void>;
}) {
  const dAppKit = useDAppKit();
  const [modelId, setModelId] = useState("");
  const [phase, setPhase] = useState<RegistrationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [engineOffline, setEngineOffline] = useState(false);
  const [result, setResult] = useState<ZkBackedRegistrationResult | null>(null);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || phase !== "idle") return;

    const selectedModel = modelId.trim();
    if (!selectedModel) {
      setError("Enter a model ID from the active release manifest.");
      return;
    }

    setError(null);
    setEngineOffline(false);
    setResult(null);
    setPhase("checking");

    try {
      const statusResponse = await fetch("/api/status", { cache: "no-store" });
      const statusBody = await readJsonObject(statusResponse);
      if (statusResponse.status === 503) {
        setEngineOffline(true);
        setError("The staking engine is offline. Try again after it is configured.");
        return;
      }
      if (!statusResponse.ok || !isOpenVerdictNetwork(statusBody.network)) {
        throw new Error("Could not determine the active OpenVerdict network.");
      }

      setPhase("signing");
      // The wallet signs this exact text, no transaction and no gas.
      const message = buildZkLoginBackingMessage(
        account.address,
        statusBody.network,
      );
      const signed = await dAppKit.signPersonalMessage({ message });

      setPhase("registering");
      const response = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          signature: signed.signature,
          modelId: selectedModel,
          role: STAKED_SEAT_ROLE,
        }),
      });
      const responseBody = await readJsonObject(response);
      if (!response.ok) {
        if (response.status === 503 && responseBody.error === "engine_not_wired") {
          setEngineOffline(true);
        }
        throw new Error(
          typeof responseBody.message === "string"
            ? responseBody.message
            : registrationErrorMessage(response.status),
        );
      }
      if (!isRegistrationResult(responseBody)) {
        throw new Error("The staking service returned an invalid response.");
      }

      setResult(responseBody);
      await onRegistered();
    } catch (caught) {
      setError(friendlyRegistrationError(caught));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <Panel
      label="Stake on a juror seat"
      icon={ShieldTick}
      tone="sealed"
      action={<MetaTag tone="sealed">Any Sui account</MetaTag>}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-ocean">
          Stake on a juror seat
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect any Sui wallet, or continue with Google (zkLogin), and sign one
          message. No transaction, no gas. OpenVerdict registers the seat and
          records your staker hash, blake2b-256 of your address. Seats are
          standardized: the protocol pins every juror&apos;s model, prompts and
          tools.
        </p>
      </div>
      <div>
        {!account ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-2xl items-start gap-3">
              <Wallet
                size="20"
                variant="Bold"
                className="mt-0.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ocean">
                  Connect an account to stake
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Any Sui wallet works, and so does the Google option. The account
                  signs once; OpenVerdict stores only its staker hash.
                </p>
              </div>
            </div>
            <WalletConnectButton />
          </div>
        ) : result ? (
          <div
            className="space-y-4 rounded-xl border border-yes/30 bg-yes/6 p-4"
            role="status"
          >
            <div className="flex items-center gap-2 text-yes">
              <TickCircle size="19" variant="Bold" aria-hidden="true" />
              <p className="font-semibold">Seat staked</p>
              <MetaTag tone="yes">{STAKE_KIND_LABELS[result.backingKind]}</MetaTag>
            </div>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Agent profile</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={result.agentProfileId} tone="chain" full />
                </dd>
              </div>
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Transaction digest</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={result.digest} tone="chain" full />
                </dd>
              </div>
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Staker hash</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={result.humanBackingHash} tone="sealed" full />
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              You may stake on as many seats as you like. A committee draws at
              most one seat per staker hash and one per owner, so a single
              account never fills a jury.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => setResult(null)}
            >
              Stake on another seat
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submitRegistration} noValidate>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <label htmlFor="zk-agent-model" className="text-sm font-medium text-ocean">
                  Model ID
                </label>
                <Input
                  id="zk-agent-model"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="e.g. model from release manifest"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={128}
                  required
                  aria-invalid={error && !modelId.trim() ? "true" : undefined}
                  aria-describedby="zk-agent-model-help"
                  className="h-11"
                />
                <p id="zk-agent-model-help" className="text-xs text-muted-foreground">
                  Use an exact model ID from this deployment&apos;s catalog.
                </p>
              </div>
            </div>

            {error && (
              <div
                className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                role="alert"
              >
                <div className="flex items-center gap-2 text-destructive">
                  <Warning2 size="18" variant="Bold" aria-hidden="true" />
                  <p className="text-sm font-semibold">
                    {engineOffline ? "Staking service offline" : "Staking failed"}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    setError(null);
                    setEngineOffline(false);
                  }}
                >
                  <Refresh size="16" variant="Linear" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                The server verifies your personal-message signature, then the Sui
                draw rule keeps one staker hash from taking two seats in the same
                committee.
              </p>
              <Button
                type="submit"
                className="min-h-[44px] shrink-0 px-4"
                disabled={busy}
                aria-busy={busy}
              >
                {busy && (
                  <Refresh
                    size="16"
                    variant="Linear"
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                )}
                {phase === "checking"
                  ? "Checking network…"
                  : phase === "signing"
                    ? "Awaiting signature…"
                    : phase === "registering"
                      ? "Staking…"
                      : "Sign and stake"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isOpenVerdictNetwork(value: unknown): value is OpenVerdictNetwork {
  return value === "localnet" || value === "testnet" || value === "mainnet";
}

function isRegistrationResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ZkBackedRegistrationResult {
  return (
    typeof value.agentProfileId === "string" &&
    typeof value.humanBackingHash === "string" &&
    typeof value.backingKind === "string" &&
    value.backingKind in STAKE_KIND_LABELS &&
    typeof value.digest === "string"
  );
}

function registrationErrorMessage(status: number): string {
  if (status === 403) return "Public seat staking is disabled.";
  if (status === 429) return "Too many staking attempts. Wait a minute and try again.";
  if (status === 503) return "The staking service is temporarily unavailable.";
  return "The seat could not be staked. Check the model ID and your account, then retry.";
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/reject|cancel|denied/i.test(message)) {
    return "Signature request canceled. No seat was staked.";
  }
  return message || "The seat could not be staked. Try again.";
}

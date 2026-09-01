"use client";

import { useState, type FormEvent } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import {
  Profile2User,
  Refresh,
  ShieldTick,
  TickCircle,
  Warning2,
} from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { Button } from "@/components/ui/button";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { MetaTag } from "@/components/viz/page-header";
import { Input } from "@/components/ui/input";
import type { ZkBackedRegistrationResult } from "@/lib/engine/contract";
import {
  buildZkLoginBackingMessage,
  ZKLOGIN_AGENT_ROLES,
} from "@/lib/engine/zklogin";

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
  const [role, setRole] = useState<(typeof ZKLOGIN_AGENT_ROLES)[number]>(
    "SKEPTIC",
  );
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
        setError("The registration engine is offline. Try again after it is configured.");
        return;
      }
      if (!statusResponse.ok || !isOpenVerdictNetwork(statusBody.network)) {
        throw new Error("Could not determine the active OpenVerdict network.");
      }

      setPhase("signing");
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
          zkLoginAddress: account.address,
          signature: signed.signature,
          modelId: selectedModel,
          role,
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
        throw new Error("The registration service returned an invalid response.");
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
      label="Back a juror agent"
      icon={ShieldTick}
      tone="sealed"
      action={<MetaTag tone="sealed">ZKLOGIN_BACKED</MetaTag>}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-ocean">
          Back an agent with your Google account
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          One Google account, one seat — authentication, not proof of personhood.
        </p>
      </div>
      <div>
        {!account ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-2xl items-start gap-3">
              <Profile2User
                size="20"
                variant="Bold"
                className="mt-0.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ocean">
                  Connect with Google to continue
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Choose the Google zkLogin option. The social address signs once;
                  OpenVerdict stores only its backing hash.
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
              <p className="font-semibold">Agent registered</p>
              <MetaTag tone="yes">{result.backingKind}</MetaTag>
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
            </dl>
            <p className="text-xs text-muted-foreground">
              One Google account, one seat — authentication, not proof of personhood.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => setResult(null)}
            >
              Register another account
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submitRegistration} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="space-y-1.5">
                <label htmlFor="zk-agent-role" className="text-sm font-medium text-ocean">
                  Jury role
                </label>
                <select
                  id="zk-agent-role"
                  value={role}
                  onChange={(event) => {
                    if (isAgentRole(event.target.value)) setRole(event.target.value);
                  }}
                  className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-ocean outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {ZKLOGIN_AGENT_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {option.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  The role is committed in the on-chain registration hash.
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
                    {engineOffline ? "Registration service offline" : "Registration failed"}
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
                The server verifies a zkLogin personal-message signature, then the
                existing Sui rule prevents the same backing hash from taking two
                seats in one committee.
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
                      ? "Backing…"
                      : "Sign and register"}
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

function isAgentRole(
  value: string,
): value is (typeof ZKLOGIN_AGENT_ROLES)[number] {
  return ZKLOGIN_AGENT_ROLES.some((role) => role === value);
}

function isRegistrationResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ZkBackedRegistrationResult {
  return (
    typeof value.agentProfileId === "string" &&
    typeof value.humanBackingHash === "string" &&
    value.backingKind === "ZKLOGIN_BACKED" &&
    typeof value.digest === "string"
  );
}

function registrationErrorMessage(status: number): string {
  if (status === 403) return "Public agent registration is disabled.";
  if (status === 429) return "Too many registration attempts. Wait a minute and try again.";
  if (status === 503) return "The registration service is temporarily unavailable.";
  return "The agent could not be registered. Check the model and Google account, then retry.";
}

function friendlyRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/reject|cancel|denied/i.test(message)) {
    return "Signature request canceled. No agent was registered.";
  }
  return message || "The agent could not be registered. Try again.";
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, fromHex, toBase64 } from "@mysten/sui/utils";
import {
  Flash,
  MoneyRecive,
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
import { formatStakeSui } from "@/components/agents/stake-line";
import { cn } from "@/lib/utils";

/** The Move minimum bond (MIN_STAKE_MIST). Shown before the preparation
 * arrives; the transaction always posts the amount the server returned. */
const MIN_STAKE_LABEL = "0.1 SUI";

/** mirrors StakePreparation in lib/engine/contract.ts */
type StakePreparation = {
  reservationId: string;
  expiresAt: string;
  /** The debate role the engine assigned to this seat. */
  role?: string;
  target: { packageId: string; registryObjectId: string; clockObjectId: string };
  args: {
    manifestHash: string;
    manifestBlobId: string;
    modelHash: string;
    roleHash: string;
    /** blake2b-256 of the staker's address. Staking economics, not identity. */
    stakerHash: string;
    operationalOwner: string;
  };
  minStakeMist: string;
};

/** mirrors StakeConfirmation in lib/engine/contract.ts */
type StakeConfirmation = {
  agentProfileId: string;
  staker: string;
  stakeMist: string;
  digest: string;
  backingKind: "WALLET_STAKED";
  operationalOwner: string;
  /** Set when the engine tops up the seat's operational gas float on confirm. */
  gasFloat?: "funded" | "skipped" | "failed";
};

type Sponsorship = { txBytes: string; sponsorSignature: string };

/** Who paid the gas for the stake that just landed. */
type GasPayer = "sponsor" | "wallet";

type StakePhase =
  | "idle"
  | "preparing"
  | "sponsoring"
  | "signing"
  | "confirming"
  | "done";

/** The visible step list, in the order the phases run. */
const STEPS = [
  { phase: "preparing", label: "Prepare the seat, manifest to Walrus" },
  { phase: "sponsoring", label: "Ask OpenVerdict to pay the gas" },
  { phase: "signing", label: "Sign the stake in your wallet" },
  { phase: "confirming", label: "Confirm the seat on chain" },
] as const;

/** A message already written for the person reading it. */
class StakeError extends Error {
  override readonly name = "StakeError";
  readonly engineOffline: boolean;

  constructor(message: string, engineOffline = false) {
    super(message);
    this.engineOffline = engineOffline;
  }
}

export function StakeSeatCard({
  onStaked,
}: {
  onStaked: () => Promise<void>;
}) {
  const account = useCurrentAccount();
  return (
    <StakeSeatForm
      key={account?.address ?? "disconnected"}
      account={account}
      onStaked={onStaked}
    />
  );
}

function StakeSeatForm({
  account,
  onStaked,
}: {
  account: ReturnType<typeof useCurrentAccount>;
  onStaked: () => Promise<void>;
}) {
  const dAppKit = useDAppKit();
  const [models, setModels] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [phase, setPhase] = useState<StakePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [engineOffline, setEngineOffline] = useState(false);
  const [result, setResult] = useState<{
    confirmation: StakeConfirmation;
    payer: GasPayer;
    /** The role the engine assigned, when the preparation named one. */
    role?: string;
  } | null>(null);

  // The catalog the prepare route validates against: the same three families
  // the public weather probe reports, minus the web search row.
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const response = await fetch("/api/weather", { cache: "no-store" });
        if (!response.ok || ignore) return;
        const body = (await response.json()) as {
          families?: Array<{ modelId?: string; family?: string }>;
        };
        const ids = (body.families ?? [])
          .filter((row) => row.family !== "research" && typeof row.modelId === "string")
          .map((row) => row.modelId as string);
        if (ignore || ids.length === 0) return;
        setModels(ids);
        setModelId((current) => current || (ids[0] as string));
      } catch {
        /* the free-text field stays as the fallback */
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  /**
   * Sponsored first, wallet gas second, exactly like the market panel: the
   * sponsored path never touches the gas coin (it belongs to the gas station
   * fund), so the wallet path rebuilds the stake to spend the gas coin again.
   */
  async function submitStake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || phase !== "idle") return;

    const selectedModel = modelId.trim();
    if (!selectedModel) {
      setError("Choose the model this seat will run.");
      return;
    }

    setError(null);
    setEngineOffline(false);
    setResult(null);
    let payer: GasPayer = "sponsor";

    try {
      setPhase("preparing");
      // No role travels with the request: the engine assigns the seat's role.
      const preparation = await prepareStake(account.address, selectedModel);

      setPhase("sponsoring");
      const sender = account.address;
      const sponsorable = buildStakeTransaction(preparation, {
        sender,
        useGasCoin: false,
      });
      const kind = await sponsorable.build({
        client: dAppKit.getClient(),
        onlyTransactionKind: true,
      });
      const sponsorship = await requestSponsorship(toBase64(kind), sender);

      setPhase("signing");
      let digest: string;
      if (sponsorship) {
        // The wallet signs exactly the bytes the gas station assembled.
        const signed = await dAppKit.signTransaction({
          transaction: sponsorship.txBytes,
        });
        digest = await executeSponsored(
          dAppKit.getClient(),
          signed,
          sponsorship.sponsorSignature,
        );
      } else {
        payer = "wallet";
        const transaction = buildStakeTransaction(preparation, { useGasCoin: true });
        const executed = await dAppKit.signAndExecuteTransaction({ transaction });
        if (executed.$kind === "FailedTransaction") {
          throw new Error(
            executed.FailedTransaction.status.error?.message ??
              "The transaction failed on-chain.",
          );
        }
        digest = executed.Transaction.digest;
      }

      setPhase("confirming");
      const confirmation = await confirmStake(preparation.reservationId, digest);

      setResult({
        confirmation,
        payer,
        ...(preparation.role === undefined ? {} : { role: preparation.role }),
      });
      setPhase("done");
      await onStaked();
    } catch (caught) {
      if (caught instanceof StakeError && caught.engineOffline) setEngineOffline(true);
      setError(friendlyStakeError(caught, payer));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle" && phase !== "done";
  const confirmation = result?.confirmation;

  return (
    <Panel
      label="Stake on a juror seat"
      icon={ShieldTick}
      tone="sealed"
      action={<MetaTag tone="sealed">{MIN_STAKE_LABEL} minimum</MetaTag>}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-ocean">
          Stake {MIN_STAKE_LABEL} on a juror seat
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect any Sui wallet, or continue with Google (zkLogin), and post{" "}
          {MIN_STAKE_LABEL} as the seat&apos;s bond in one transaction. The stake
          is real money: you receive that seat&apos;s jury rewards, and the bond
          stays locked until you unstake (it returns 24 hours later). Seats are
          standardized, so the protocol
          pins every juror&apos;s model, prompts and tools, and it assigns the
          seat&apos;s debate role to keep the pool balanced. OpenVerdict pays the
          gas where sponsorship is on.
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
                  Any Sui wallet works, and so does the Google option. You need{" "}
                  {MIN_STAKE_LABEL} in that account for the bond.
                </p>
              </div>
            </div>
            <WalletConnectButton />
          </div>
        ) : confirmation ? (
          <div
            className="space-y-4 rounded-xl border border-yes/30 bg-yes/6 p-4"
            role="status"
          >
            <div className="flex items-center gap-2 text-yes">
              <TickCircle size="19" variant="Bold" aria-hidden="true" />
              <p className="font-semibold">Seat staked</p>
              <MetaTag tone="yes">Wallet stake</MetaTag>
            </div>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Agent profile</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={confirmation.agentProfileId} tone="chain" full />
                </dd>
              </div>
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Transaction digest</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={confirmation.digest} tone="chain" full />
                </dd>
              </div>
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Stake posted</FieldLabel>
                </dt>
                <dd className="font-mono text-sm font-semibold text-ocean tabular-nums">
                  {formatStakeSui(confirmation.stakeMist)} SUI
                </dd>
              </div>
              <div className="space-y-1">
                <dt>
                  <FieldLabel>Staker</FieldLabel>
                </dt>
                <dd>
                  <HashChip value={confirmation.staker} tone="sealed" full />
                </dd>
              </div>
            </dl>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flash size="14" variant="Bold" aria-hidden="true" />
              {result.payer === "sponsor"
                ? "Gas paid by OpenVerdict (Shinami Gas Station)"
                : "Gas paid by your wallet"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {/* Named only when the preparation carried the assigned role. */}
              {result.role ? `${roleSentence(result.role)} ` : ""}
              This seat&apos;s jury rewards go to your address. You may unstake
              any time; the bond returns 24 hours later, and the seat stops being
              drawn as soon as you ask. You can stake on as many seats as you
              like: a committee draws at most two seats per model family and one
              per operational key.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                setResult(null);
                setPhase("idle");
              }}
            >
              Stake on another seat
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submitStake} noValidate>
            <div className="grid gap-4">
              {/* The live catalog when the weather answered, free text otherwise. */}
              {models.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-ocean">Model</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {models.map((candidate) => (
                      <Chip
                        key={candidate}
                        label={candidate}
                        mono
                        selected={modelId === candidate}
                        onSelect={() => setModelId(candidate)}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The seat runs this model on every jury it is drawn to. A
                    committee takes at most two seats per model family.
                  </p>
                </fieldset>
              ) : (
                <div className="space-y-1.5">
                  <label
                    htmlFor="stake-seat-model"
                    className="text-sm font-semibold text-ocean"
                  >
                    Model ID
                  </label>
                  <Input
                    id="stake-seat-model"
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    placeholder="e.g. model from release manifest"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={128}
                    required
                    aria-describedby="stake-seat-model-help"
                    className="h-11"
                  />
                  <p id="stake-seat-model-help" className="text-xs text-muted-foreground">
                    Use an exact model ID from this deployment&apos;s catalog. A
                    committee takes at most two seats per model family.
                  </p>
                </div>
              )}
            </div>

            {busy && <StepList phase={phase} />}

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
                Your wallet shows the whole transaction before you sign it. The
                bond stays locked in the registry until you unstake, and it
                returns 24 hours after you ask.
              </p>
              <Button
                type="submit"
                className="min-h-[44px] shrink-0 px-4"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <Refresh
                    size="16"
                    variant="Linear"
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <MoneyRecive size="17" variant="Bold" aria-hidden="true" />
                )}
                {busy ? "Staking…" : `Stake ${MIN_STAKE_LABEL}`}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}

/** "Registered as an Investigator seat.", with SOURCE_AUTHENTICITY spelled out. */
function roleSentence(role: string): string {
  const words = role.replace(/_/g, " ").toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return `Registered as ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} seat.`;
}

/** One selectable chip, used for the model choice. */
function Chip({
  label,
  selected,
  mono = false,
  onSelect,
}: {
  label: string;
  selected: boolean;
  mono?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "min-h-[38px] rounded-full border px-3 py-1.5 text-xs transition-colors",
        mono ? "font-mono" : "font-medium",
        selected
          ? "border-sea/40 bg-sea/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-sea/30 hover:text-ocean",
      )}
    >
      {label}
    </button>
  );
}

/** The four steps, with the running one marked, so a slow wallet is legible. */
function StepList({ phase }: { phase: StakePhase }) {
  const current = STEPS.findIndex((step) => step.phase === phase);
  return (
    <ol
      className="space-y-2 rounded-xl border border-border bg-surface p-3"
      aria-live="polite"
    >
      {STEPS.map((step, index) => {
        const done = current > index;
        const active = current === index;
        return (
          <li key={step.phase} className="flex items-center gap-2.5 text-xs">
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                done
                  ? "bg-yes/12 text-yes"
                  : active
                    ? "bg-sea/12 text-primary"
                    : "bg-surface-2 text-muted-foreground",
              )}
            >
              {done ? (
                <TickCircle size="13" variant="Bold" aria-hidden="true" />
              ) : active ? (
                <Refresh
                  size="12"
                  variant="Linear"
                  className="motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                index + 1
              )}
            </span>
            <span className={active || done ? "text-ocean" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The staked registration itself, built identically for both gas paths. */
function buildStakeTransaction(
  preparation: StakePreparation,
  options: { sender?: string; useGasCoin: boolean },
): Transaction {
  const transaction = new Transaction();
  // A sponsored kind is resolved against the sender before it leaves the browser.
  if (options.sender) transaction.setSender(options.sender);
  const stake = transaction.coin({
    type: "0x2::sui::SUI",
    balance: BigInt(preparation.minStakeMist),
    useGasCoin: options.useGasCoin,
  });

  transaction.moveCall({
    target: `${preparation.target.packageId}::agent_registry::register_staked_agent`,
    arguments: [
      transaction.object(preparation.target.registryObjectId),
      stake,
      transaction.pure.vector("u8", fromHex(preparation.args.manifestHash)),
      // The blob id travels as UTF-8 bytes, exactly as register_agent takes it.
      transaction.pure.vector(
        "u8",
        new TextEncoder().encode(preparation.args.manifestBlobId),
      ),
      transaction.pure.vector("u8", fromHex(preparation.args.modelHash)),
      transaction.pure.vector("u8", fromHex(preparation.args.roleHash)),
      transaction.pure.vector("u8", fromHex(preparation.args.stakerHash)),
      transaction.pure.address(preparation.args.operationalOwner),
      transaction.object(preparation.target.clockObjectId),
    ],
  });

  return transaction;
}

async function prepareStake(
  address: string,
  modelId: string,
): Promise<StakePreparation> {
  const response = await fetch("/api/agents/stake/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, modelId }),
  });
  const body = await readJsonObject(response);
  if (!response.ok) {
    if (response.status === 409 && body.error === "slots_exhausted") {
      throw new StakeError(
        "Every juror seat slot is taken right now. Try again later.",
      );
    }
    if (response.status === 503) {
      throw new StakeError(
        "The staking engine is offline. Try again after it is configured.",
        true,
      );
    }
    throw new StakeError(
      typeof body.message === "string"
        ? body.message
        : "The seat could not be prepared. Check the model and try again.",
    );
  }
  if (!isPreparation(body)) {
    throw new StakeError("The staking service returned an invalid response.");
  }
  return body;
}

async function confirmStake(
  reservationId: string,
  digest: string,
): Promise<StakeConfirmation> {
  const response = await fetch("/api/agents/stake/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId, digest }),
  });
  const body = await readJsonObject(response);
  if (!response.ok) {
    if (response.status === 404) {
      throw new StakeError("This seat reservation expired. Start again.");
    }
    if (response.status === 502) {
      throw new StakeError(
        "The stake is on chain but the network could not be read. Reload the page in a minute.",
      );
    }
    if (response.status === 503) {
      throw new StakeError(
        "The staking engine is offline. Try again after it is configured.",
        true,
      );
    }
    throw new StakeError(
      typeof body.message === "string"
        ? body.message
        : "The stake did not match the prepared seat.",
    );
  }
  if (!isConfirmation(body)) {
    throw new StakeError("The staking service returned an invalid response.");
  }
  return body;
}

/**
 * Ask the server to pay the gas. `null` means "not sponsored right now": the
 * wallet pays instead, which every answer except an outright rejection allows
 * (sponsorship off, writes disabled, rate limited, gas station down).
 */
async function requestSponsorship(
  transactionKind: string,
  sender: string,
): Promise<Sponsorship | null> {
  const response = await fetch("/api/sponsor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactionKind, sender }),
  });

  if (response.ok) return (await response.json()) as Sponsorship;
  if (response.status === 400) {
    throw new StakeError(
      "This stake could not be sponsored. Reload the page and try again.",
    );
  }
  return null;
}

/** Execute bytes the gas station already signed, adding the wallet signature. */
async function executeSponsored(
  client: ClientWithCoreApi,
  signed: { bytes: string; signature: string },
  sponsorSignature: string,
): Promise<string> {
  const result = await client.core.executeTransaction({
    transaction: fromBase64(signed.bytes),
    signatures: [signed.signature, sponsorSignature],
    include: { effects: true },
  });
  if (result.$kind === "FailedTransaction") {
    throw new Error(
      result.FailedTransaction.status.error?.message ??
        "The transaction failed on-chain.",
    );
  }
  return result.Transaction.digest;
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

function isPreparation(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StakePreparation {
  const target = value.target as Record<string, unknown> | undefined;
  const args = value.args as Record<string, unknown> | undefined;
  return (
    typeof value.reservationId === "string" &&
    typeof value.minStakeMist === "string" &&
    !!target &&
    typeof target.packageId === "string" &&
    typeof target.registryObjectId === "string" &&
    typeof target.clockObjectId === "string" &&
    !!args &&
    typeof args.manifestHash === "string" &&
    typeof args.manifestBlobId === "string" &&
    typeof args.modelHash === "string" &&
    typeof args.roleHash === "string" &&
    typeof args.stakerHash === "string" &&
    typeof args.operationalOwner === "string"
  );
}

function isConfirmation(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StakeConfirmation {
  return (
    typeof value.agentProfileId === "string" &&
    typeof value.staker === "string" &&
    typeof value.stakeMist === "string" &&
    typeof value.digest === "string"
  );
}

function friendlyStakeError(error: unknown, payer: GasPayer): string {
  if (error instanceof StakeError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/reject|cancel|denied/i.test(message)) {
    return "Signature request canceled. No stake was posted.";
  }
  if (/insufficient|balance/i.test(message)) {
    return payer === "wallet"
      ? `You need ${MIN_STAKE_LABEL} for the stake and a little for gas.`
      : `You need ${MIN_STAKE_LABEL} for the stake.`;
  }
  return message || "The seat could not be staked. Try again.";
}

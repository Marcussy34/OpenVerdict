"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, fromHex, toBase64 } from "@mysten/sui/utils";
import {
  MoneyRecive,
  Refresh,
  ShieldTick,
  TickCircle,
  Wallet,
  Warning2,
} from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { useSuiBalance } from "@/components/wallet/use-sui-balance";
import { Button } from "@/components/ui/button";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { MetaTag } from "@/components/viz/page-header";
import { modelFamily } from "@/components/viz/model-badge";
import { Input } from "@/components/ui/input";
import { formatStakeSui } from "@/components/agents/stake-line";
import { isBelowMinimumStake } from "@/lib/web/stake-balance";
import { cn } from "@/lib/utils";

/** The Move minimum bond (MIN_STAKE_MIST). Shown before the preparation
 * arrives; the transaction always posts the amount the server returned. */
const MIN_STAKE_LABEL = "0.1 SUI";

/** Testnet SUI, for a connected wallet that cannot cover the bond yet. */
const FAUCET_URL = "https://faucet.sui.io";

/** No faucet exists on mainnet, so the low-balance line drops the link there. */
const IS_MAINNET = process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet";

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
    /** The model this seat was staked on, kept so the summary never drifts. */
    model: string;
    /** The role the engine assigned, when the preparation named one. */
    role?: string;
  } | null>(null);

  // The wallet's own balance, for the one question this card asks before a
  // stake: can this account cover the bond? A failed read stays null and the
  // button is left alone.
  const { mist: balanceMist, formatted: balanceLabel } = useSuiBalance(
    account?.address ?? null,
  );
  const lowBalance = balanceLabel !== null && isBelowMinimumStake(balanceMist);

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
        model: selectedModel,
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
        {/* The heading and the panel tag already carry the amount, and the
            block below already says how to connect, so this paragraph says
            only what nothing else on the card does. Gas is sponsored when the
            gas station answers and paid by the wallet when it does not, so the
            promise here is hedged the way submitStake actually behaves. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          You earn this seat&apos;s jury rewards. Unstake any time; the stake
          returns 24 hours later. OpenVerdict pays the gas when it can.
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
          <StakeResult
            confirmation={confirmation}
            payer={result.payer}
            model={result.model}
            {...(result.role === undefined ? {} : { role: result.role })}
            onReset={() => {
              setResult(null);
              setPhase("idle");
            }}
          />
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
                  {/* The model is the only choice the staker makes, so this is
                      where the role question gets answered. */}
                  <p className="text-xs text-muted-foreground">
                    The seat runs this model on every jury, and the protocol
                    assigns its debate role.
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
              <p
                id="stake-balance-note"
                className="max-w-2xl text-xs leading-relaxed text-muted-foreground"
              >
                {lowBalance ? (
                  <>
                    {/* The wallet cannot cover the bond, so this line says so
                        and points at the only fix. Gas is deliberately not
                        promised here: the card's intro already hedges it,
                        because sponsorship can fall back to wallet gas. On
                        mainnet there is no faucet, so the sentence stops. */}
                    This wallet holds {balanceLabel} SUI; the stake needs{" "}
                    {MIN_STAKE_LABEL}.
                    {IS_MAINNET ? null : (
                      <>
                        {" "}
                        <a
                          href={FAUCET_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-sea-ink underline decoration-sea-ink/30 underline-offset-[3px] transition-colors hover:decoration-sea-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          Get testnet SUI
                        </a>
                        .
                      </>
                    )}
                  </>
                ) : (
                  "Your wallet shows the whole transaction before you sign."
                )}
              </p>
              <Button
                type="submit"
                className="min-h-[44px] shrink-0 px-4"
                disabled={busy || lowBalance}
                aria-busy={busy}
                // A disabled button says nothing on its own: the low-balance
                // line above is what explains why, so it names it.
                aria-describedby={lowBalance ? "stake-balance-note" : undefined}
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

/**
 * The state after a stake lands: a quiet confirmation, not a receipt. Heading,
 * one line of what was staked, the four values worth keeping, and the way out.
 * No tinted panel; the check mark is the card's one success signal.
 *
 * Exported so the state can be rendered on its own with a fixed confirmation.
 */
export function StakeResult({
  confirmation,
  payer,
  model,
  role,
  onReset,
}: {
  confirmation: StakeConfirmation;
  payer: GasPayer;
  model: string;
  role?: string;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4" role="status">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <TickCircle
            size="18"
            variant="Bold"
            className="text-yes"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-ocean">Seat staked</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {/* The role is named only when the preparation carried one. */}
          {seatLine(model, role)} Rewards go to your address. Unstake any time;
          the stake returns 24 hours later.
        </p>
      </div>

      <dl className="border-y border-border">
        <ResultRow label="Seat">
          {/* The seat's own page, not the explorer: the profile id is the one
              id a staker comes back to. */}
          <HashChip
            value={confirmation.agentProfileId}
            tone="chain"
            href={`/agents/${confirmation.agentProfileId}`}
          />
        </ResultRow>
        <ResultRow label="Transaction">
          {/* `tx` resolves to suiTransactionUrl through the shared chip
              mapping, so this digest lands on SuiVision like every other. */}
          <HashChip value={confirmation.digest} tone="chain" kind="tx" />
        </ResultRow>
        <ResultRow label="Stake">
          <span className="font-mono text-xs font-semibold text-ocean tabular-nums">
            {formatStakeSui(confirmation.stakeMist)} SUI
          </span>
        </ResultRow>
        <ResultRow label="Gas">
          <span className="text-xs text-muted-foreground">
            {payer === "sponsor" ? "paid by OpenVerdict" : "paid by your wallet"}
          </span>
        </ResultRow>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href={`/agents/${confirmation.agentProfileId}`}>View seat</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px]"
          onClick={onReset}
        >
          Stake on another seat
        </Button>
      </div>
    </div>
  );
}

/**
 * "Investigator seat on DeepSeek-V4-Flash-0731": the role spelled out the way
 * SOURCE_AUTHENTICITY reads in words, and the model in the short form the
 * agents page uses rather than the full provider path.
 */
function seatLine(modelId: string, role?: string): string {
  const model = modelFamily(modelId).short;
  if (!role) return `Seat on ${model}.`;
  const words = role.replace(/_/g, " ").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} seat on ${model}.`;
}

/** One key/value row of the confirmation: micro label left, value right. */
function ResultRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0">
        <FieldLabel>{label}</FieldLabel>
      </dt>
      <dd className="flex min-w-0 justify-end text-right">{children}</dd>
    </div>
  );
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
        // The app's one chip recipe: sharp, one hairline weight, accent when
        // selected. Matches the claims and agents filter rails.
        "min-h-[38px] border px-3 py-1.5 text-xs transition-colors",
        mono ? "font-mono" : "font-medium",
        selected
          ? "border-sea/40 bg-sea/12 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-sea/40 hover:text-ocean",
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
                // Step markers are ink; only the running step wears the accent.
                // Green stays for protocol outcomes, not for wizard progress.
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                done
                  ? "bg-surface-2 text-muted-foreground"
                  : active
                    ? "bg-sea/12 text-primary"
                    : "bg-surface-2 text-muted-foreground/60",
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

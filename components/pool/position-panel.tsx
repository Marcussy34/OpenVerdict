"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  useCurrentAccount,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  ExportSquare,
  Flash,
  InfoCircle,
  MoneyRecive,
  Refresh,
  TickCircle,
  Warning2,
  Wallet,
} from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { MetaTag } from "@/components/viz/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const MAX_POOL_VALUE = 1_000_000_000n;
const SYSTEM_CLOCK_ID = "0x6";

type PoolStatus = {
  network?: string;
  packageId?: string;
  registryObjectId?: string;
  demoPoolObjectId?: string;
  clockObjectId?: string;
  coinType?: string;
  explorerTxTemplate?: string;
};

type PoolDeployment = {
  packageId: string;
  registryObjectId: string;
  demoPoolObjectId: string;
  clockObjectId: string;
  coinType: string;
  explorerTxTemplate?: string;
};

type StatusResult =
  | { key: string; state: "ready"; status: PoolStatus }
  | { key: string; state: "error" };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveDeployment(
  status: PoolStatus | null,
  network: string,
): PoolDeployment | null {
  if (
    !status ||
    status.network !== network ||
    !nonEmpty(status.packageId) ||
    !nonEmpty(status.registryObjectId) ||
    !nonEmpty(status.demoPoolObjectId) ||
    !nonEmpty(status.coinType)
  ) {
    return null;
  }

  return {
    packageId: status.packageId,
    registryObjectId: status.registryObjectId,
    demoPoolObjectId: status.demoPoolObjectId,
    clockObjectId: nonEmpty(status.clockObjectId)
      ? status.clockObjectId
      : SYSTEM_CLOCK_ID,
    coinType: status.coinType,
    ...(nonEmpty(status.explorerTxTemplate)
      ? { explorerTxTemplate: status.explorerTxTemplate }
      : {}),
  };
}

function validateAmount(value: string): string | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return "Enter a positive integer in coin base units.";
  }

  if (BigInt(value) > MAX_POOL_VALUE) {
    return "Amount exceeds the demo pool cap of 1,000,000,000 base units.";
  }

  return null;
}

function explorerUrl(template: string | undefined, digest: string) {
  if (!template?.includes("{digest}")) return null;

  try {
    const url = new URL(template.replace("{digest}", encodeURIComponent(digest)));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Who paid the gas for the deposit that just landed. */
type GasPayer = "sponsor" | "wallet";

type Sponsorship = { txBytes: string; sponsorSignature: string };

/** The server refused to sponsor these bytes: falling back would not help. */
class SponsorRejectedError extends Error {
  override readonly name = "SponsorRejectedError";
}

function friendlyTransactionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (error instanceof SponsorRejectedError) return error.message;
  if (/reject|cancel|denied/i.test(message)) {
    return "Signature request canceled. No deposit was submitted.";
  }
  if (/insufficient/i.test(message)) {
    return "This wallet does not have enough balance for the deposit and gas.";
  }

  return "Deposit failed. Check the pool state and your wallet balance, then try again.";
}

/** The pool entry itself, built identically for both gas paths. */
function buildEntryTransaction(
  deployment: PoolDeployment,
  amount: string,
  outcome: 1 | 2,
  options: { sender?: string; useGasCoin: boolean },
): Transaction {
  const transaction = new Transaction();
  // A sponsored kind is resolved against the sender before it leaves the browser.
  if (options.sender) transaction.setSender(options.sender);
  const stake = transaction.coin({
    balance: BigInt(amount),
    type: deployment.coinType,
    useGasCoin: options.useGasCoin,
  });

  transaction.moveCall({
    target: `${deployment.packageId}::demo_binary_pool::enter`,
    typeArguments: [deployment.coinType],
    arguments: [
      transaction.object(deployment.registryObjectId),
      transaction.object(deployment.demoPoolObjectId),
      stake,
      transaction.pure.u8(outcome),
      transaction.object(deployment.clockObjectId),
    ],
  });

  return transaction;
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
    throw new SponsorRejectedError(
      "This deposit could not be sponsored. Check the amount, then try again.",
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

export function PositionPanel() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const connectionKey = account ? `${network}:${account.address}` : null;
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null);
  const [statusRetry, setStatusRetry] = useState(0);
  const [outcome, setOutcome] = useState<1 | 2>(1);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitErrorResult, setSubmitErrorResult] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [digestResult, setDigestResult] = useState<{
    key: string;
    digest: string;
    payer: GasPayer;
  } | null>(null);

  useEffect(() => {
    if (!connectionKey) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Status request failed (${response.status})`);
        }

        setStatusResult({
          key: connectionKey,
          state: "ready",
          status: (await response.json()) as PoolStatus,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatusResult({ key: connectionKey, state: "error" });
      }
    })();

    return () => controller.abort();
  }, [connectionKey, statusRetry]);

  const statusState = !connectionKey
    ? "idle"
    : statusResult?.key === connectionKey
      ? statusResult.state
      : "loading";
  const poolStatus =
    statusResult?.key === connectionKey && statusResult.state === "ready"
      ? statusResult.status
      : null;
  const deposit = digestResult?.key === connectionKey ? digestResult : null;
  const digest = deposit?.digest ?? null;
  const submitError =
    submitErrorResult?.key === connectionKey
      ? submitErrorResult.message
      : null;

  const deployment = resolveDeployment(poolStatus, network);

  /**
   * Sponsored first, wallet gas second. The sponsored path never touches the
   * gas coin (it belongs to the gas station fund), so the wallet path rebuilds
   * the entry to let the stake come out of the gas coin again as before.
   */
  async function submitDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deployment || !connectionKey || !account) return;

    const validationError = validateAmount(amount);
    if (validationError) {
      setAmountError(validationError);
      return;
    }

    setAmountError(null);
    setSubmitErrorResult(null);
    setDigestResult(null);
    setSubmitting(true);

    try {
      const sender = account.address;
      const sponsorable = buildEntryTransaction(deployment, amount, outcome, {
        sender,
        useGasCoin: false,
      });
      const kind = await sponsorable.build({
        client: dAppKit.getClient(),
        onlyTransactionKind: true,
      });
      const sponsorship = await requestSponsorship(toBase64(kind), sender);

      let digest: string;
      let payer: GasPayer;
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
        payer = "sponsor";
      } else {
        const transaction = buildEntryTransaction(deployment, amount, outcome, {
          useGasCoin: true,
        });
        const result = await dAppKit.signAndExecuteTransaction({ transaction });
        if (result.$kind === "FailedTransaction") {
          throw new Error(
            result.FailedTransaction.status.error?.message ??
              "The transaction failed on-chain.",
          );
        }
        digest = result.Transaction.digest;
        payer = "wallet";
      }

      setDigestResult({ key: connectionKey, digest, payer });
      setAmount("");
    } catch (error) {
      setSubmitErrorResult({
        key: connectionKey,
        message: friendlyTransactionError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const transactionUrl = digest
    ? explorerUrl(deployment?.explorerTxTemplate, digest)
    : null;
  const coinSymbol = deployment?.coinType.split("::").at(-1) ?? "coin";

  return (
    <Panel
      label="Market position"
      icon={MoneyRecive}
      tone="chain"
      action={<MetaTag tone="chain">Wallet required</MetaTag>}
    >
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Demo binary pool positions are economic actions and require a connected wallet.
        Reading this claim stays anonymous.
      </p>
      <div>
        {!account ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-2xl items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sea/10 text-primary ring-1 ring-sea/20">
                <Wallet size="20" variant="Bold" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ocean">
                  Connect for market actions
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Deposit YES/NO with any Sui wallet — or continue with Google via
                  zkLogin. Reading this claim remains anonymous.
                </p>
              </div>
            </div>
            <WalletConnectButton />
          </div>
        ) : statusState === "idle" || statusState === "loading" ? (
          <div className="space-y-3" aria-label="Loading demo pool status">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : statusState === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-destructive">
              <Warning2 size="18" variant="Bold" aria-hidden="true" />
              <p className="text-sm font-semibold">Couldn&apos;t load pool status</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Check the engine connection, then try again.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                setStatusResult(null);
                setStatusRetry((retry) => retry + 1);
              }}
            >
              <Refresh size="16" variant="Linear" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : !deployment ? (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-surface p-4">
            <InfoCircle size="20" variant="Bold" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ocean">
                Pool not deployed on this network yet
              </p>
              <p className="text-sm text-muted-foreground">
                Your wallet is connected. Market controls will appear when the
                demo pool IDs are published for {network}.
              </p>
            </div>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submitDeposit} noValidate>
            <div className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
              A successful deposit creates an address-bound position object in
              this wallet. The wallet will show the full transaction before you
              sign.
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ocean">
                Position
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={outcome === 1 ? "default" : "outline"}
                  className="min-h-[44px]"
                  aria-pressed={outcome === 1}
                  onClick={() => setOutcome(1)}
                >
                  YES
                </Button>
                <Button
                  type="button"
                  variant={outcome === 2 ? "default" : "outline"}
                  className="min-h-[44px]"
                  aria-pressed={outcome === 2}
                  onClick={() => setOutcome(2)}
                >
                  NO
                </Button>
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <label
                htmlFor="market-deposit-amount"
                className="text-sm font-semibold text-ocean"
              >
                Amount ({coinSymbol} base units)
              </label>
              <Input
                id="market-deposit-amount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                className="min-h-[44px] font-mono tabular-nums"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setAmountError(null);
                }}
                aria-invalid={amountError ? "true" : undefined}
                aria-describedby={
                  amountError
                    ? "market-deposit-hint market-deposit-error"
                    : "market-deposit-hint"
                }
              />
              <p
                id="market-deposit-hint"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Positive integers only. Pool cap: 1,000,000,000 base units total
                across YES and NO; remaining capacity may be lower.
              </p>
              {amountError && (
                <p
                  id="market-deposit-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {amountError}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={submitting}
              aria-busy={submitting}
            >
              <MoneyRecive size="17" variant="Bold" aria-hidden="true" />
              {submitting
                ? "Awaiting signature…"
                : `Deposit ${outcome === 1 ? "YES" : "NO"}`}
            </Button>

            {submitError && (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                <Warning2
                  size="18"
                  variant="Bold"
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <p>{submitError}</p>
              </div>
            )}

            {digest && (
              <div
                className="space-y-2 rounded-xl border border-yes/30 bg-yes/6 p-3"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TickCircle
                    size="18"
                    variant="Bold"
                    className="text-yes"
                    aria-hidden="true"
                  />
                  Deposit submitted
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Flash size="14" variant="Bold" aria-hidden="true" />
                  {deposit?.payer === "sponsor"
                    ? "Gas paid by OpenVerdict (Shinami Gas Station)"
                    : "Gas paid by your wallet"}
                </p>
                <HashChip value={digest} label="digest" tone="chain" full />
                {transactionUrl && (
                  <a
                    href={transactionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    View transaction
                    <ExportSquare
                      size="15"
                      variant="Linear"
                      aria-hidden="true"
                    />
                  </a>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </Panel>
  );
}

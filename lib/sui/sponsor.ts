import type { SuiClientTypes } from "@mysten/sui/client";
import type { Keypair } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import type { OpenVerdictSuiClient } from "./client";

type GasBudget = bigint | number | string;

export interface SponsorAndExecuteInput {
  client: OpenVerdictSuiClient;
  tx: Transaction;
  senderKeypair: Keypair;
  sponsorKeypair: Keypair;
  gasBudget?: GasBudget;
}

export interface SponsoredExecutionResult {
  digest: string;
  effects: SuiClientTypes.TransactionEffects;
}

export class SponsoredTransactionError extends Error {
  override readonly name = "SponsoredTransactionError";
  readonly code = "SPONSORED_TRANSACTION_FAILED" as const;
  readonly digest?: string;

  constructor(message: string, digest?: string) {
    super(message);
    this.digest = digest;
  }
}

/** Build sender intent bytes, attach sponsor gas, collect both signatures, and execute. */
export async function sponsorAndExecute({
  client,
  tx,
  senderKeypair,
  sponsorKeypair,
  gasBudget,
}: SponsorAndExecuteInput): Promise<SponsoredExecutionResult> {
  const sender = senderKeypair.toSuiAddress();
  const sponsor = sponsorKeypair.toSuiAddress();

  // Sender context is needed while resolving sender-owned coin intents.
  tx.setSender(sender);
  const kindBytes = await tx.build({ client, onlyTransactionKind: true });
  const sponsorCoins = await listSponsorGasCoins(client, sponsor);
  const budget = parseGasBudget(gasBudget);
  const available = sponsorCoins.reduce(
    (total, coin) => total + BigInt(coin.balance),
    0n,
  );
  if (sponsorCoins.length === 0) {
    throw new SponsoredTransactionError("sponsor has no usable SUI gas coins");
  }
  if (budget !== undefined && available < budget) {
    throw new SponsoredTransactionError(
      `sponsor gas coins contain ${available} MIST but ${budget} MIST is required`,
    );
  }

  const sponsoredTx = Transaction.fromKind(kindBytes);
  sponsoredTx.setSender(sender);
  sponsoredTx.setGasOwner(sponsor);
  sponsoredTx.setGasPayment(
    sponsorCoins.map(({ objectId, version, digest }) => ({
      objectId,
      version,
      digest,
    })),
  );
  if (budget !== undefined) sponsoredTx.setGasBudget(budget);

  const transaction = await sponsoredTx.build({ client });
  const [senderSignature, sponsorSignature] = await Promise.all([
    senderKeypair.signTransaction(transaction),
    sponsorKeypair.signTransaction(transaction),
  ]);
  const result = await client.core.executeTransaction({
    transaction,
    signatures: [senderSignature.signature, sponsorSignature.signature],
    include: { effects: true },
  });
  if (result.$kind === "FailedTransaction") {
    throw new SponsoredTransactionError(
      result.FailedTransaction.status.error?.message ??
        "sponsored transaction failed",
      result.FailedTransaction.digest,
    );
  }
  return {
    digest: result.Transaction.digest,
    effects: result.Transaction.effects,
  };
}

async function listSponsorGasCoins(
  client: OpenVerdictSuiClient,
  owner: string,
): Promise<SuiClientTypes.Coin[]> {
  const coins: SuiClientTypes.Coin[] = [];
  let cursor: string | null = null;
  do {
    const page: SuiClientTypes.ListCoinsResponse = await client.core.listCoins({
      owner,
      cursor,
      limit: 50,
    });
    coins.push(...page.objects.filter((coin) => BigInt(coin.balance) > 0n));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null);
  return coins;
}

function parseGasBudget(value: GasBudget | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  const budget = BigInt(value);
  if (budget <= 0n) {
    throw new SponsoredTransactionError("gasBudget must be a positive MIST amount");
  }
  return budget;
}

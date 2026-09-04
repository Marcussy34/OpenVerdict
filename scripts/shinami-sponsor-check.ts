#!/usr/bin/env node
/**
 * Shinami Gas Station health check, and an optional live sponsorship proof.
 *
 *   pnpm sponsor:check            read-only: prints the fund line
 *   pnpm sponsor:check --send     sponsors one real operator transaction
 *
 * Without --send this only calls gas_getFund, so it costs nothing and touches
 * no chain. With --send it transfers one of the operator's own SUI coins back
 * to the operator, paid for by the gas station, and prints the gas owner as
 * proof that the operator did not pay. The access key is never printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuiClientTypes } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";
import {
  DEFAULT_SHINAMI_GAS_ENDPOINT,
  ShinamiGasStationError,
  SignerRegistry,
  createFallbackClient,
  getShinamiFund,
  loadReleaseManifest,
  sponsorWithGasStationAndExecute,
  type OpenVerdictSuiClient,
} from "../lib/sui";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = "config/release.testnet.json";
/** Matches the public route's ceiling: one small transaction, capped. */
const GAS_BUDGET_MIST = 50_000_000;

/** process.env first, then .env, the way the other operator scripts read it. */
function env(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  try {
    const raw = readFileSync(join(repositoryRoot, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function sui(mist: string | number): string {
  return (Number(mist) / Number(MIST_PER_SUI)).toFixed(4);
}

/** Smallest positive SUI coin the operator owns: cheapest thing to move. */
async function smallestCoin(
  client: OpenVerdictSuiClient,
  owner: string,
): Promise<SuiClientTypes.Coin> {
  const coins: SuiClientTypes.Coin[] = [];
  let cursor: string | null = null;
  do {
    const page: SuiClientTypes.ListCoinsResponse = await client.core.listCoins({
      owner,
      coinType: "0x2::sui::SUI",
      cursor,
      limit: 50,
    });
    coins.push(...page.objects.filter((coin) => BigInt(coin.balance) > 0n));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null);

  const smallest = coins.sort((a, b) => (BigInt(a.balance) < BigInt(b.balance) ? -1 : 1))[0];
  if (!smallest) throw new Error(`operator ${owner} owns no SUI coin objects`);
  return smallest;
}

function gasOwner(effects: SuiClientTypes.TransactionEffects): string {
  const owner = effects.gasObject?.outputOwner ?? effects.gasObject?.inputOwner;
  return owner?.$kind === "AddressOwner" ? owner.AddressOwner : "unknown";
}

async function main(): Promise<void> {
  const send = process.argv.includes("--send");
  const accessKey = env("SHINAMI_GAS_ACCESS_KEY");
  if (!accessKey) {
    console.error("SHINAMI_GAS_ACCESS_KEY is not set (env or .env)");
    process.exitCode = 2;
    return;
  }
  const endpoint = env("SHINAMI_GAS_ENDPOINT") ?? DEFAULT_SHINAMI_GAS_ENDPOINT;

  const fund = await getShinamiFund({ accessKey, endpoint });
  console.log(
    `fund: ${fund.name} | network ${fund.network} | balance ${sui(fund.balance)} SUI | in flight ${sui(fund.inFlight)} SUI`,
  );
  if (!send) {
    console.log("read-only check complete; pass --send to sponsor a real transaction");
    return;
  }

  const manifest = await loadReleaseManifest(
    join(repositoryRoot, env("OPENVERDICT_RELEASE_MANIFEST") ?? DEFAULT_MANIFEST),
  );
  const client = createFallbackClient(manifest);
  const operator = SignerRegistry.fromEnv({
    ...process.env,
    SUI_OPERATOR_SECRET_KEY: env("SUI_OPERATOR_SECRET_KEY"),
  }).getOperator();
  const address = operator.toSuiAddress();

  // Never tx.gas: the gas coin belongs to the fund, not to the operator.
  const coin = await smallestCoin(client, address);
  const tx = new Transaction();
  tx.transferObjects(
    [
      tx.objectRef({
        objectId: coin.objectId,
        version: coin.version,
        digest: coin.digest,
      }),
    ],
    address,
  );

  const result = await sponsorWithGasStationAndExecute({
    client,
    tx,
    senderKeypair: operator,
    gasStation: { accessKey, endpoint },
    gasBudget: GAS_BUDGET_MIST,
  });
  await client.core.waitForTransaction({ digest: result.digest });

  const payer = gasOwner(result.effects);
  console.log(`digest:    ${result.digest}`);
  console.log(`sender:    ${address}`);
  console.log(`gas owner: ${payer} ${payer === address ? "(OPERATOR PAID, not sponsored)" : "(sponsored)"}`);
  console.log(`explorer:  https://testnet.suivision.xyz/txblock/${result.digest}`);
  if (payer === address) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message =
    error instanceof ShinamiGasStationError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? // undici says only "fetch failed": the cause names the host or code.
          `${error.message}${error.cause ? ` (${String((error.cause as Error).message ?? error.cause)})` : ""}`
        : String(error);
  console.error(message);
  process.exitCode = 1;
});

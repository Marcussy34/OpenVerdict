#!/usr/bin/env node
/**
 * Report and fund the Walrus writer lanes (lib/walrus/lanes.ts). Each writer
 * signs its own register and certify transactions, so it needs its own SUI
 * for gas and its own WAL for storage; an unfunded writer simply falls back
 * to the operator lane, which is what every write used before.
 *
 *   pnpm walrus:writers                        # addresses and balances only
 *   pnpm walrus:writers --fund                 # top writers up from the operator
 *   pnpm walrus:writers --split-gas 3          # give each worker its own gas coin
 *   pnpm walrus:writers --fund --split-gas 3
 *
 * Prints addresses and balances only, never a key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import {
  SignerRegistry,
  createSuiClients,
  executeAndWait,
  loadReleaseManifest,
  type BoundWriter,
  type OpenVerdictSuiClient,
} from "../lib/sui";
import {
  SUI_COIN_TYPE,
  WRITER_SUI_FLOOR_MIST,
  WRITER_SUI_TARGET_MIST,
  WRITER_WAL_FLOOR_FROST,
  WRITER_WAL_TARGET_FROST,
  formatUnits,
  topUpAmount,
  walCoinType,
  writerBalances,
  type WriterBalances,
} from "../lib/walrus/funding";
import { repositoryRoot } from "./deploy-localnet";

const DEFAULT_MANIFEST_PATH = "config/release.testnet.json";
/** A gas slot coin: comfortably above the "at least 1 SUI" the slots need. */
const GAS_SLOT_SPLIT_MIST = 1_500_000_000n;
const ONE_SUI_MIST = 1_000_000_000n;

function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(join(repositoryRoot, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) out[match[1]!] = match[2]!.trim();
    }
  } catch {
    // .env is optional; process.env may carry the values instead.
  }
  return out;
}

interface Options {
  fund: boolean;
  splitGas: number;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { fund: false, splitGas: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fund") {
      options.fund = true;
      continue;
    }
    if (argument === "--split-gas") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 16) {
        throw new Error("--split-gas takes an integer between 1 and 16");
      }
      options.splitGas = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${String(argument)}`);
  }
  return options;
}

async function report(
  client: OpenVerdictSuiClient,
  operator: string,
  writers: readonly BoundWriter[],
  walType: string,
): Promise<WriterBalances[]> {
  const [operatorBalances, ...balances] = await Promise.all([
    writerBalances(client, operator, walType),
    ...writers.map((writer) => writerBalances(client, writer.address, walType)),
  ]);
  const gasCoins = await client.core.listCoins({ owner: operator, coinType: SUI_COIN_TYPE });
  const slotCoins = gasCoins.objects.filter(
    (coin) => BigInt(coin.balance) >= ONE_SUI_MIST,
  ).length;
  console.log(`WAL coin type ${walType}`);
  console.log(
    `operator ${operator}  ${formatUnits(operatorBalances?.sui ?? 0n)} SUI  ${formatUnits(
      operatorBalances?.wal ?? 0n,
    )} WAL  (${slotCoins} coin(s) of at least 1 SUI)`,
  );
  for (const [index, writer] of writers.entries()) {
    const held = balances[index];
    if (held === undefined) continue;
    const short =
      held.sui < WRITER_SUI_FLOOR_MIST || held.wal < WRITER_WAL_FLOOR_FROST;
    console.log(
      `writer ${index} ${writer.address}  ${formatUnits(held.sui)} SUI  ${formatUnits(
        held.wal,
      )} WAL  ${short ? "BELOW FLOOR" : "ok"}`,
    );
  }
  return balances.filter((entry): entry is WriterBalances => entry !== undefined);
}

/**
 * Split the operator's largest coin until at least `target` coins of one SUI
 * exist, so each worker process can pin a distinct gas slot.
 */
async function splitGas(
  client: OpenVerdictSuiClient,
  operator: SignerRegistry,
  target: number,
): Promise<void> {
  const signer = operator.getOperator();
  const address = signer.toSuiAddress();
  const listed = await client.core.listCoins({ owner: address, coinType: SUI_COIN_TYPE });
  const usable = listed.objects.filter((coin) => BigInt(coin.balance) >= ONE_SUI_MIST);
  if (usable.length >= target) {
    console.log(`gas slots: ${usable.length} coin(s) of at least 1 SUI, nothing to split`);
    return;
  }
  const missing = target - usable.length;
  const largest = [...listed.objects].sort((left, right) =>
    BigInt(right.balance) > BigInt(left.balance) ? 1 : -1,
  )[0];
  const needed = BigInt(missing) * GAS_SLOT_SPLIT_MIST + ONE_SUI_MIST;
  if (largest === undefined || BigInt(largest.balance) < needed) {
    console.log(
      `gas slots: need ${formatUnits(needed)} SUI in one coin to split ${missing} more; skipping`,
    );
    return;
  }
  const transaction = new Transaction();
  transaction.setSender(address);
  transaction.setGasPayment([
    { objectId: largest.objectId, version: largest.version, digest: largest.digest },
  ]);
  const parts = transaction.splitCoins(
    transaction.gas,
    Array.from({ length: missing }, () => transaction.pure.u64(GAS_SLOT_SPLIT_MIST)),
  );
  transaction.transferObjects(
    Array.from({ length: missing }, (_, index) => parts[index]!),
    address,
  );
  const result = await executeAndWait(client, signer, transaction);
  console.log(`gas slots: split ${missing} coin(s) of 1.5 SUI  digest ${result.digest}`);
}

/** One transaction topping every short writer up to the target balances. */
async function fundWriters(
  client: OpenVerdictSuiClient,
  registry: SignerRegistry,
  writers: readonly BoundWriter[],
  balances: readonly WriterBalances[],
  walType: string,
): Promise<void> {
  const signer = registry.getOperator();
  const address = signer.toSuiAddress();
  const transfers = writers.flatMap((writer, index) => {
    const held = balances[index];
    if (held === undefined) return [];
    const sui = topUpAmount(held.sui, WRITER_SUI_FLOOR_MIST, WRITER_SUI_TARGET_MIST);
    const wal = topUpAmount(held.wal, WRITER_WAL_FLOOR_FROST, WRITER_WAL_TARGET_FROST);
    return sui === 0n && wal === 0n ? [] : [{ address: writer.address, sui, wal }];
  });
  if (transfers.length === 0) {
    console.log("fund: every writer is above the floor");
    return;
  }
  const operatorHeld = await writerBalances(client, address, walType);
  const suiNeeded = transfers.reduce((total, entry) => total + entry.sui, 0n);
  const walNeeded = transfers.reduce((total, entry) => total + entry.wal, 0n);
  if (operatorHeld.sui < suiNeeded + ONE_SUI_MIST) {
    throw new Error(
      `operator holds ${formatUnits(operatorHeld.sui)} SUI, needs ${formatUnits(
        suiNeeded + ONE_SUI_MIST,
      )}`,
    );
  }
  if (operatorHeld.wal < walNeeded) {
    throw new Error(
      `operator holds ${formatUnits(operatorHeld.wal)} WAL, needs ${formatUnits(
        walNeeded,
      )}; run pnpm tsx scripts/exchange-wal.ts <sui amount> first`,
    );
  }
  const transaction = new Transaction();
  transaction.setSender(address);
  for (const entry of transfers) {
    if (entry.sui > 0n) {
      transaction.transferObjects(
        [transaction.add(coinWithBalance({ balance: entry.sui }))],
        entry.address,
      );
    }
    if (entry.wal > 0n) {
      transaction.transferObjects(
        [transaction.add(coinWithBalance({ balance: entry.wal, type: walType }))],
        entry.address,
      );
    }
  }
  const result = await executeAndWait(client, signer, transaction);
  for (const entry of transfers) {
    console.log(
      `fund: ${entry.address}  +${formatUnits(entry.sui)} SUI  +${formatUnits(entry.wal)} WAL`,
    );
  }
  console.log(`fund: digest ${result.digest}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dotenv = loadDotEnv();
  const env = { ...dotenv, ...process.env };
  const manifestPath = env.OPENVERDICT_RELEASE_MANIFEST?.trim() || DEFAULT_MANIFEST_PATH;
  const manifest = await loadReleaseManifest(manifestPath);
  if (manifest.network === "localnet") {
    throw new Error(`${manifestPath} is localnet; writer lanes only apply to testnet or mainnet`);
  }
  if (!env.SUI_OPERATOR_SECRET_KEY?.trim()) {
    throw new Error("SUI_OPERATOR_SECRET_KEY missing (.env or env)");
  }
  if (!env.OPENVERDICT_AGENT_SEED?.trim()) {
    throw new Error("OPENVERDICT_AGENT_SEED missing (.env or env): writers derive from it");
  }
  const registry = SignerRegistry.fromEnv(env);
  const writers = registry.listWalrusWriters();
  const client = createSuiClients({
    ...manifest,
    suiRpcUrl: env.OPENVERDICT_SUI_GRPC_URL?.trim() || manifest.suiRpcUrl,
  });
  const operator = registry.getOperator().toSuiAddress();
  if (writers.length === 0) {
    console.log("OPENVERDICT_WALRUS_WRITERS is 0: every write stays on the operator lane");
    return;
  }
  const walType = await walCoinType(client, manifest.network, env);

  const balances = await report(client, operator, writers, walType);
  if (options.splitGas > 0) await splitGas(client, registry, options.splitGas);
  if (options.fund) {
    await fundWriters(client, registry, writers, balances, walType);
    console.log("--- after funding ---");
    await report(client, operator, writers, walType);
  }
}

// Importable for its unit tests; only a direct run touches the network.
if (process.argv[1]?.endsWith("fund-walrus-writers.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

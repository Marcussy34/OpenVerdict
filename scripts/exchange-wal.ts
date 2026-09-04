#!/usr/bin/env node
/**
 * Swap testnet SUI for testnet WAL through the Walrus exchange (1:1), so the
 * operator can keep paying for blob storage. Run:
 *   pnpm tsx scripts/exchange-wal.ts <sui amount, e.g. 3>
 * Walrus writes stop with "Insufficient balance of WAL" when the operator
 * runs dry (2026-09-03 13:25, 0.0023 WAL left); this refills it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createFallbackClient } from "../lib/sui/client";
import { readConfig, repositoryRoot } from "./deploy-localnet";

const testnetConfigPath = join(repositoryRoot, "config/release.testnet.json");
// The SDK's testnet constants list several exchange objects; the first one.
const TESTNET_WAL_EXCHANGE = "0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073";
const WAL_EXCHANGE_PACKAGE = "0x82593828ed3fcb8c6a235eac9abd0adbe9c5f9bbffa9b1e7a45cdd884481ef9f";

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

async function main(): Promise<void> {
  const amount = Number(process.argv[2] ?? "3");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20) {
    throw new Error("usage: exchange-wal.ts <sui amount between 0 and 20>");
  }
  const dotenv = loadDotEnv();
  const secret = process.env.SUI_OPERATOR_SECRET_KEY ?? dotenv.SUI_OPERATOR_SECRET_KEY;
  if (!secret) throw new Error("SUI_OPERATOR_SECRET_KEY missing (.env or env)");
  const operator = Ed25519Keypair.fromSecretKey(secret);
  const address = operator.toSuiAddress();
  const config = await readConfig(testnetConfigPath);
  const client = createFallbackClient({
    network: "testnet",
    suiRpcUrl: String(config.suiRpcUrl ?? ""),
    suiRpcFallbackUrl: String(config.suiRpcFallbackUrl ?? ""),
  });
  const mist = BigInt(Math.round(amount * 1e9));
  const tx = new Transaction();
  tx.setSender(address);
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
  const [wal] = tx.moveCall({
    target: `${WAL_EXCHANGE_PACKAGE}::wal_exchange::exchange_all_for_wal`,
    arguments: [tx.object(TESTNET_WAL_EXCHANGE), payment!],
  });
  tx.transferObjects([wal!], address);
  const submitted = await client.signAndExecuteTransaction({
    signer: operator,
    transaction: tx,
  });
  const digest = (submitted as { digest: string }).digest;
  const status = (submitted as { effects?: { status?: { status?: string; error?: string } } })
    .effects?.status;
  if (status?.status === "failure") throw new Error(status.error ?? "exchange failed");
  console.log(`operator ${address}`);
  console.log(`swapped  ${amount} SUI for WAL`);
  console.log(`digest   ${digest}`);
  console.log(`explorer https://testnet.suivision.xyz/txblock/${digest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

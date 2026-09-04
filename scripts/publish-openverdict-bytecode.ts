#!/usr/bin/env node
/**
 * Publish move/openverdict from prebuilt base64 bytecode through the SDK's
 * JSON-RPC fallback client, for machines whose network path cannot serve the
 * CLI's gRPC publish (docs/demo/runbook.md section 2). Build the input with:
 *   sui move build --dump-bytecode-as-base64 --ignore-chain --path move/openverdict > bytecode.json
 * Run: pnpm tsx scripts/publish-openverdict-bytecode.ts <bytecode.json>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import { createFallbackClient } from "../lib/sui/client";
import {
  readConfig,
  repositoryRoot,
  resolveDeploymentIds,
  writeDeploymentConfig,
} from "./deploy-localnet";

const testnetConfigPath = join(repositoryRoot, "config/release.testnet.json");
// Same cap the CLI path used; unused gas is refunded.
const PUBLISH_GAS_BUDGET = 900_000_000n;

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
  const bytecodePath = process.argv[2];
  if (!bytecodePath) throw new Error("usage: publish-openverdict-bytecode.ts <bytecode.json>");
  const bytecode = JSON.parse(readFileSync(bytecodePath, "utf8")) as {
    modules: string[];
    dependencies: string[];
  };
  if (!Array.isArray(bytecode.modules) || bytecode.modules.length === 0) {
    throw new Error("bytecode JSON has no modules");
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

  const balance = await client.core.getBalance({ owner: address });
  console.log(`operator ${address}`);
  console.log(`balance ${balance.balance.balance} MIST`);

  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(PUBLISH_GAS_BUDGET);
  const [upgradeCap] = tx.publish(bytecode);
  if (!upgradeCap) throw new Error("publish command did not return an UpgradeCap");
  tx.transferObjects([upgradeCap], address);

  const submitted = await client.signAndExecuteTransaction({
    signer: operator,
    transaction: tx,
  });
  // The JSON-RPC client returns the response object directly, digest included.
  const digest = (submitted as { digest: string }).digest;
  const status = (submitted as { effects?: { status?: { status?: string; error?: string } } })
    .effects?.status;
  if (status?.status === "failure") {
    throw new Error(status.error ?? "package publish failed");
  }
  const ids = await resolveDeploymentIds(client, submitted, digest, address);
  await writeDeploymentConfig(testnetConfigPath, config, ids);
  console.log(`published ${ids.packageId}`);
  console.log(`registry  ${ids.registryObjectId}`);
  console.log(`digest    ${digest}`);
  console.log(`explorer  https://testnet.suivision.xyz/txblock/${digest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

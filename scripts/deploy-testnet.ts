#!/usr/bin/env node
/**
 * Publish the OpenVerdict Move package to Sui TESTNET (plan T8a).
 *
 * Uses the JSON-RPC fallback endpoint because this machine's network path
 * mangles TLS to Mysten-hosted hosts (see docs/demo/runbook.md §2), and an
 * ephemeral isolated sui-client config so the user's ~/.sui state is never
 * touched. Ids are written into config/release.testnet.json.
 *
 * Run: pnpm tsx scripts/deploy-testnet.ts [--force]
 */
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { createFallbackClient, loadReleaseManifest } from "../lib/sui";
import {
  findStringByKey,
  readConfig,
  repositoryRoot,
  resolveDeploymentIds,
  runProcess,
  writeDeploymentConfig,
} from "./deploy-localnet";

const testnetConfigPath = join(repositoryRoot, "config/release.testnet.json");
// Balance floor: publish budget plus headroom for the canary transactions.
const PUBLISH_GAS_BUDGET = 900_000_000n; // 0.9 SUI cap; unused gas is refunded
const MIN_BALANCE = 950_000_000n;

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
  const dotenv = loadDotEnv();
  const secret =
    process.env.SUI_OPERATOR_SECRET_KEY ?? dotenv.SUI_OPERATOR_SECRET_KEY;
  if (!secret) throw new Error("SUI_OPERATOR_SECRET_KEY missing (.env or env)");
  const operator = Ed25519Keypair.fromSecretKey(secret);
  const address = operator.toSuiAddress();

  const manifest = await loadReleaseManifest(testnetConfigPath);
  const rpcUrl = manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl;
  const client = createFallbackClient({
    network: "testnet",
    suiRpcUrl: rpcUrl,
  });

  const config = await readConfig(testnetConfigPath);
  const existing = typeof config.packageId === "string" ? config.packageId : "";
  const force = process.argv.includes("--force");
  if (existing && !force) {
    console.log(`testnet package already recorded: ${existing} (use --force to republish)`);
    return;
  }

  const balance = await client.core.getBalance({ owner: address });
  const total = BigInt(balance.balance.balance ?? 0);
  console.log(`operator ${address}\nbalance ${total} MIST`);
  if (total < MIN_BALANCE) {
    throw new Error(
      `insufficient testnet SUI: have ${total} MIST, need >= ${MIN_BALANCE}. ` +
        `Fund ${address} at https://faucet.sui.io`,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "openverdict-testnet-"));
  try {
    const decoded = decodeSuiPrivateKey(operator.getSecretKey());
    const keystorePath = join(directory, "sui.keystore");
    const keyBytes = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(decoded.secretKey),
    ]).toString("base64");
    await writeFile(keystorePath, `${JSON.stringify([keyBytes], null, 2)}\n`, {
      mode: 0o600,
    });
    const clientConfigPath = join(directory, "client.yaml");
    const quote = (value: string) => JSON.stringify(value);
    await writeFile(
      clientConfigPath,
      [
        "---",
        "keystore:",
        `  File: ${quote(keystorePath)}`,
        "envs:",
        "  - alias: testnet",
        `    rpc: ${quote(rpcUrl)}`,
        "    ws: ~",
        "    basic_auth: ~",
        "active_env: testnet",
        `active_address: ${quote(address)}`,
        "",
      ].join("\n"),
    );

    const packageDirectory = join(repositoryRoot, "move/openverdict");
    const lockPath = join(packageDirectory, "Move.lock");
    const originalLock = await readFile(lockPath).catch(() => undefined);
    let result: Awaited<ReturnType<typeof runProcess>>;
    try {
      result = await runProcess(
        "sui",
        [
          "client",
          "--client.config",
          clientConfigPath,
          "publish",
          "--json",
          "--gas-budget",
          PUBLISH_GAS_BUDGET.toString(),
        ],
        { cwd: packageDirectory, timeoutMs: 300_000 },
      );
    } finally {
      if (originalLock) await writeFile(lockPath, originalLock);
    }
    if (result.code !== 0) {
      throw new Error(
        `sui client publish failed (${result.code}): ${result.stderr.slice(0, 800) || result.stdout.slice(0, 800)}`,
      );
    }
    const output = JSON.parse(result.stdout) as unknown;
    const digest = findStringByKey(output, "digest");
    if (!digest) throw new Error("publish output missing digest");
    const ids = await resolveDeploymentIds(client, output, digest, address);
    await writeDeploymentConfig(testnetConfigPath, config, ids);
    console.log(`published ${ids.packageId}`);
    console.log(`registry  ${ids.registryObjectId}`);
    console.log(`digest    ${digest}`);
    console.log(`explorer  https://suiscan.xyz/testnet/tx/${digest}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

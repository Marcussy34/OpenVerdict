#!/usr/bin/env node
/**
 * Upgrade move/openverdict on testnet from prebuilt base64 bytecode with the
 * operator's UpgradeCap (the publish transferred it to the operator). Build:
 *   sui move build --dump-bytecode-as-base64 --no-tree-shaking --path move/openverdict > bytecode.json
 * Run: pnpm tsx scripts/upgrade-openverdict-bytecode.ts <bytecode.json>
 *
 * Sui keeps every object type at the address the package was first
 * published at, while Move calls must target the upgraded package. The script
 * therefore writes two ids to config/release.testnet.json: packageId (new,
 * for calls) and originalPackageId (first publish, for object types).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, UpgradePolicy } from "@mysten/sui/transactions";
import { createFallbackClient } from "../lib/sui/client";
import { readConfig, repositoryRoot } from "./deploy-localnet";
import { writeFile, rename } from "node:fs/promises";

const testnetConfigPath = join(repositoryRoot, "config/release.testnet.json");
const UPGRADE_GAS_BUDGET = 900_000_000n;

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

/** The operator's UpgradeCap for this package (the publish transferred it). */
async function findUpgradeCap(
  client: ReturnType<typeof createFallbackClient>,
  owner: string,
  packageIds: string[],
): Promise<string> {
  // After the first upgrade the cap's `package` field points at the latest
  // package, not the original one, so either id identifies our cap.
  const wanted = new Set(packageIds.map((id) => id.toLowerCase()));
  let cursor: string | null = null;
  do {
    const page: {
      objects: Array<{ objectId: string; json: Record<string, unknown> | null }>;
      cursor: string | null;
      hasNextPage: boolean;
    } = await client.core.listOwnedObjects({
      owner,
      type: "0x2::package::UpgradeCap",
      cursor,
      limit: 50,
      include: { json: true },
    });
    for (const object of page.objects) {
      const pkg = object.json?.package;
      if (typeof pkg === "string" && wanted.has(pkg.toLowerCase())) {
        return object.objectId;
      }
    }
    cursor = page.cursor;
    if (!page.hasNextPage) break;
  } while (cursor !== null);
  throw new Error(`no UpgradeCap for ${packageIds.join(" or ")} owned by ${owner}`);
}

async function main(): Promise<void> {
  const bytecodePath = process.argv[2];
  if (!bytecodePath) throw new Error("usage: upgrade-openverdict-bytecode.ts <bytecode.json>");
  const bytecode = JSON.parse(readFileSync(bytecodePath, "utf8")) as {
    modules: string[];
    dependencies: string[];
    digest?: number[];
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
  const currentPackageId = String(config.packageId ?? "");
  const originalPackageId = String(config.originalPackageId ?? currentPackageId);
  if (!currentPackageId) throw new Error("config has no packageId to upgrade");
  const client = createFallbackClient({
    network: "testnet",
    suiRpcUrl: String(config.suiRpcUrl ?? ""),
    suiRpcFallbackUrl: String(config.suiRpcFallbackUrl ?? ""),
  });
  const upgradeCapId = await findUpgradeCap(client, address, [currentPackageId, originalPackageId]);
  console.log(`operator     ${address}`);
  console.log(`current pkg  ${currentPackageId}`);
  console.log(`original pkg ${originalPackageId}`);
  console.log(`upgrade cap  ${upgradeCapId}`);

  // The package digest the ticket authorizes is the one the compiler
  // computed for exactly these modules and dependencies.
  const digest = bytecode.digest;
  if (!Array.isArray(digest) || digest.length !== 32) {
    throw new Error("bytecode JSON has no 32-byte digest; build with --dump-bytecode-as-base64");
  }
  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(UPGRADE_GAS_BUDGET);
  const ticket = tx.moveCall({
    target: "0x2::package::authorize_upgrade",
    arguments: [
      tx.object(upgradeCapId),
      tx.pure.u8(UpgradePolicy.COMPATIBLE),
      tx.pure.vector("u8", digest),
    ],
  });
  const receipt = tx.upgrade({
    modules: bytecode.modules.map((module) => Array.from(fromBase64(module))),
    dependencies: bytecode.dependencies,
    package: currentPackageId,
    ticket,
  });
  tx.moveCall({
    target: "0x2::package::commit_upgrade",
    arguments: [tx.object(upgradeCapId), receipt],
  });
  const submitted = await client.signAndExecuteTransaction({
    signer: operator,
    transaction: tx,
  });
  const txDigest = (submitted as { digest: string }).digest;
  const status = (submitted as { effects?: { status?: { status?: string; error?: string } } })
    .effects?.status;
  if (status?.status === "failure") {
    throw new Error(status.error ?? "package upgrade failed");
  }
  // The executing client does not always return object changes inline;
  // read the transaction back and take the published package from it.
  const changes = (submitted as { objectChanges?: Array<{ type: string; packageId?: string }> })
    .objectChanges;
  let newPackageId = changes?.find((change) => change.type === "published")?.packageId;
  if (!newPackageId) {
    // The new package is the one created object written as a package.
    const fetched = await client.core.getTransaction({
      digest: txDigest,
      include: { effects: true },
    });
    const changed = (fetched as { transaction?: { effects?: { changedObjects?: Array<{ objectId: string; idOperation: string; outputState: string }> } } })
      .transaction?.effects?.changedObjects ?? [];
    newPackageId = changed.find(
      (change) => change.idOperation === "Created" && change.outputState === "PackageWrite",
    )?.objectId;
  }
  if (!newPackageId) {
    // The core read above returns no "published" change on some RPCs; the
    // JSON-RPC object changes always carry the new package id.
    const legacy = await client.getTransactionBlock({
      digest: txDigest,
      options: { showObjectChanges: true },
    });
    const published = legacy.objectChanges?.find((change) => change.type === "published");
    newPackageId =
      published && "packageId" in published ? String(published.packageId) : undefined;
  }
  if (!newPackageId) {
    throw new Error(
      `upgrade executed (${txDigest}); read the published package id from the explorer and set packageId (calls) and originalPackageId (types) in ${testnetConfigPath}`,
    );
  }
  const updated = { ...config, packageId: newPackageId, originalPackageId };
  const tmp = `${testnetConfigPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(tmp, testnetConfigPath);
  console.log(`upgraded to  ${newPackageId}`);
  console.log(`digest       ${txDigest}`);
  console.log(`explorer     https://suiscan.xyz/testnet/tx/${txDigest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

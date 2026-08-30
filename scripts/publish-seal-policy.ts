#!/usr/bin/env node
// move/openverdict_seal/bytecode.json lets --bytecode publish without the Sui CLI.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  decodeSuiPrivateKey,
  type Keypair,
} from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { Transaction } from "@mysten/sui/transactions";

import { loadReleaseManifest, type ReleaseManifest } from "../lib/sui";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packagePath = "move/openverdict_seal";
const defaultManifestPath = "config/release.testnet.json";

interface Options {
  dryRun: boolean;
  bytecodePath?: string;
}

interface Bytecode {
  modules: string[];
  dependencies: string[];
}

function parseOptions(args: string[]): Options {
  let dryRun = false;
  let bytecodePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be specified once");
      dryRun = true;
      continue;
    }
    if (argument === "--bytecode") {
      if (bytecodePath !== undefined) {
        throw new Error("--bytecode may only be specified once");
      }
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--bytecode requires a file path");
      }
      bytecodePath = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }

  return { dryRun, ...(bytecodePath === undefined ? {} : { bytecodePath }) };
}

function parseBytecode(value: unknown, source: string): Bytecode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const { modules, dependencies } = value as Record<string, unknown>;
  if (
    !Array.isArray(modules) ||
    modules.length === 0 ||
    !modules.every((module) => typeof module === "string" && module.length > 0)
  ) {
    throw new Error(`${source} must contain a non-empty modules string array`);
  }
  if (
    !Array.isArray(dependencies) ||
    !dependencies.every(
      (dependency) =>
        typeof dependency === "string" && /^0x[0-9a-fA-F]+$/.test(dependency),
    )
  ) {
    throw new Error(`${source} must contain a dependency object-id array`);
  }
  return { modules, dependencies };
}

async function readBytecode(path: string): Promise<Bytecode> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`could not read bytecode JSON: ${path}`, { cause: error });
  }
  return parseBytecode(value, path);
}

function processErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const processError = error as Error & { stdout?: unknown; stderr?: unknown };
  const output = [processError.stdout, processError.stderr, error.message]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .join("\n");
  return output.slice(0, 4_000);
}

async function buildBytecode(manifest: ReleaseManifest): Promise<Bytecode> {
  const configDirectory = await mkdtemp(join(tmpdir(), "openverdict-seal-sui-"));
  const keystorePath = join(configDirectory, "sui.keystore");
  const configPath = join(configDirectory, "client.yaml");
  const chainRpcUrl = manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl;

  try {
    // Isolate chain selection so the build never changes the user's Sui config.
    await writeFile(keystorePath, "[]\n", { mode: 0o600 });
    await writeFile(
      configPath,
      [
        "---",
        "keystore:",
        `  File: ${JSON.stringify(keystorePath)}`,
        "envs:",
        `  - alias: ${manifest.network}`,
        `    rpc: ${JSON.stringify(chainRpcUrl)}`,
        "    ws: ~",
        "    basic_auth: ~",
        `active_env: ${manifest.network}`,
        "active_address: ~",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      SUI_CONFIG_DIR: configDirectory,
    };
    delete childEnv.SUI_OPERATOR_SECRET_KEY;
    let stdout: string;
    try {
      const result = await execFileAsync(
        "sui",
        [
          "move",
          "build",
          "--dump-bytecode-as-base64",
          "--path",
          packagePath,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: childEnv,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      throw new Error(`sui move build failed: ${processErrorMessage(error)}`);
    }
    return parseBytecode(JSON.parse(stdout) as unknown, "sui move build output");
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}

function operatorFromSecret(secret: string): Keypair {
  let decoded: ReturnType<typeof decodeSuiPrivateKey>;
  try {
    decoded = decodeSuiPrivateKey(secret);
  } catch {
    throw new Error("SUI_OPERATOR_SECRET_KEY must be a valid Sui bech32 secret key");
  }
  if (decoded.scheme === "ED25519") {
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }
  if (decoded.scheme === "Secp256k1") {
    return Secp256k1Keypair.fromSecretKey(decoded.secretKey);
  }
  if (decoded.scheme === "Secp256r1") {
    return Secp256r1Keypair.fromSecretKey(decoded.secretKey);
  }
  throw new Error(`unsupported operator key scheme: ${decoded.scheme}`);
}

function publishedObjectIds(transaction: {
  effects: {
    changedObjects: Array<{
      objectId: string;
      idOperation: string;
      outputState: string;
    }>;
  };
  objectTypes: Record<string, string>;
}): { packageId: string; upgradeCapId: string } {
  const createdIds = new Set(
    transaction.effects.changedObjects
      .filter((object) => object.idOperation === "Created")
      .map((object) => object.objectId),
  );
  const packageId =
    Object.entries(transaction.objectTypes).find(
      ([objectId, type]) => createdIds.has(objectId) && type === "package",
    )?.[0] ??
    transaction.effects.changedObjects.find(
      (object) => object.idOperation === "Created" && object.outputState === "PackageWrite",
    )?.objectId;
  const upgradeCapId = Object.entries(transaction.objectTypes).find(
    ([objectId, type]) =>
      createdIds.has(objectId) && type.endsWith("::package::UpgradeCap"),
  )?.[0];

  if (!packageId) throw new Error("publish transaction did not create a package object");
  if (!upgradeCapId) throw new Error("publish transaction did not create an UpgradeCap");
  return { packageId, upgradeCapId };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const secret = process.env.SUI_OPERATOR_SECRET_KEY?.trim();
  if (!options.dryRun && !secret) {
    throw new Error("SUI_OPERATOR_SECRET_KEY is required to publish the Seal policy");
  }
  const operator = secret ? operatorFromSecret(secret) : undefined;
  const manifestPath = resolve(
    repositoryRoot,
    process.env.OPENVERDICT_RELEASE_MANIFEST?.trim() || defaultManifestPath,
  );
  const manifest = await loadReleaseManifest(manifestPath);
  const bytecode = options.bytecodePath
    ? await readBytecode(resolve(repositoryRoot, options.bytecodePath))
    : await buildBytecode(manifest);
  const sender = operator?.toSuiAddress();

  if (options.dryRun) {
    console.log(
      JSON.stringify({
        moduleCount: bytecode.modules.length,
        dependencies: bytecode.dependencies,
        sender: sender ?? null,
      }),
    );
    if (!operator) {
      throw new Error(
        "SUI_OPERATOR_SECRET_KEY is required for the sender address; build summary printed above",
      );
    }
    return;
  }

  if (!operator || !sender) {
    throw new Error("SUI_OPERATOR_SECRET_KEY is required to publish the Seal policy");
  }
  const client = new SuiGrpcClient({
    network: manifest.network,
    baseUrl: manifest.suiRpcUrl,
  });
  const tx = new Transaction();
  tx.setSender(sender);
  const [upgradeCap] = tx.publish(bytecode);
  if (!upgradeCap) throw new Error("publish command did not return an UpgradeCap");
  tx.transferObjects([upgradeCap], sender);

  const submitted = await client.signAndExecuteTransaction({
    signer: operator,
    transaction: tx,
  });
  if (submitted.$kind === "FailedTransaction") {
    throw new Error(
      submitted.FailedTransaction.status.error?.message ?? "package publish failed",
    );
  }

  const settled = await client.waitForTransaction({
    digest: submitted.Transaction.digest,
    include: { effects: true, objectTypes: true },
  });
  if (settled.$kind === "FailedTransaction") {
    throw new Error(
      settled.FailedTransaction.status.error?.message ?? "package publish failed",
    );
  }

  const ids = publishedObjectIds(settled.Transaction);
  console.log(JSON.stringify({ ...ids, digest: settled.Transaction.digest }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

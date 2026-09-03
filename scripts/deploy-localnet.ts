#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  createFallbackClient,
  type OpenVerdictSuiClient,
} from "../lib/sui/client";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDir, "..");
export const localnetConfigPath = join(
  repositoryRoot,
  "config/release.localnet.json",
);
export const localnetRpcUrl = "http://127.0.0.1:9000";
export const localnetFaucetUrl = "http://127.0.0.1:9123/v2/gas";

const CAP_FIELDS = [
  "adminCapObjectId",
  "pauseCapObjectId",
  "evidenceCapObjectId",
  "runAttestorCapObjectId",
] as const;

type CapField = (typeof CAP_FIELDS)[number];

interface MutableLocalnetConfig extends Record<string, unknown> {
  packageId?: unknown;
  registryObjectId?: unknown;
  adminCapObjectId?: unknown;
  pauseCapObjectId?: unknown;
  evidenceCapObjectId?: unknown;
  runAttestorCapObjectId?: unknown;
}

export interface DeploymentObjectIds {
  packageId: string;
  registryObjectId: string;
  adminCapObjectId: string;
  pauseCapObjectId: string;
  evidenceCapObjectId: string;
  runAttestorCapObjectId: string;
}

export interface LocalnetDeployment extends DeploymentObjectIds {
  published: boolean;
  digest?: string;
  publisherKeypair?: Ed25519Keypair;
}

export interface DeployLocalnetOptions {
  force?: boolean;
  client?: OpenVerdictSuiClient;
  publisherKeypair?: Ed25519Keypair;
  configPath?: string;
  faucetUrl?: string;
  log?: (message: string) => void;
}

/** Publish OpenVerdict to a running localnet and persist the discovered object IDs. */
export async function deployLocalnet(
  options: DeployLocalnetOptions = {},
): Promise<LocalnetDeployment> {
  const configPath = options.configPath ?? localnetConfigPath;
  const config = await readConfig(configPath);
  const client =
    options.client ??
    createLocalnetRpcClient();
  const existingPackageId = objectId(config.packageId);

  if (!options.force && existingPackageId && (await objectExists(client, existingPackageId))) {
    options.log?.(`deployment: package ${existingPackageId} is already live; skipping publish`);
    return {
      packageId: existingPackageId,
      registryObjectId: objectId(config.registryObjectId) ?? "",
      adminCapObjectId: objectId(config.adminCapObjectId) ?? "",
      pauseCapObjectId: objectId(config.pauseCapObjectId) ?? "",
      evidenceCapObjectId: objectId(config.evidenceCapObjectId) ?? "",
      runAttestorCapObjectId: objectId(config.runAttestorCapObjectId) ?? "",
      published: false,
    };
  }

  const publisherKeypair = options.publisherKeypair ?? new Ed25519Keypair();
  await fundAddress({
    client,
    address: publisherKeypair.toSuiAddress(),
    faucetUrl: options.faucetUrl ?? localnetFaucetUrl,
  });
  options.log?.(`deployment: funded publisher ${publisherKeypair.toSuiAddress()}`);

  const clientDirectory = await mkdtemp(join(tmpdir(), "openverdict-sui-client-"));
  try {
    const clientConfig = await writeEphemeralClientConfig(
      clientDirectory,
      publisherKeypair,
    );
    const publishOutput = await runSuiPublish(clientConfig);
    const digest = findStringByKey(publishOutput, "digest");
    if (!digest) throw new Error("publish output did not contain a transaction digest");
    const ids = await resolveDeploymentIds(
      client,
      publishOutput,
      digest,
      publisherKeypair.toSuiAddress(),
    );
    await writeDeploymentConfig(configPath, config, ids);
    options.log?.(`deployment: published ${ids.packageId} in ${digest}`);
    return { ...ids, published: true, digest, publisherKeypair };
  } finally {
    await rm(clientDirectory, { recursive: true, force: true });
  }
}

/** Construct the JSON-RPC fallback required by the local Sui CLI. */
export function createLocalnetRpcClient(): OpenVerdictSuiClient {
  return createFallbackClient({
    network: "localnet",
    suiRpcUrl: localnetRpcUrl,
  });
}

/** Request local faucet SUI and wait until the address has a readable coin balance. */
export async function fundAddress(input: {
  client: OpenVerdictSuiClient;
  address: string;
  faucetUrl?: string;
  timeoutMs?: number;
}): Promise<void> {
  await requestSuiFromFaucetV2({
    host: input.faucetUrl ?? localnetFaucetUrl,
    recipient: input.address,
  });
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const { balance } = await input.client.core.getBalance({ owner: input.address });
      if (BigInt(balance.balance) > 0n) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`faucet funding was not indexed for ${input.address}`, {
    cause: lastError,
  });
}

/** Strip deployment-only capability metadata for the strict runtime manifest parser. */
export async function writeEngineCompatibleManifest(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const config = await readConfig(sourcePath);
  for (const field of CAP_FIELDS) delete config[field];
  await mkdir(dirname(targetPath), { recursive: true });
  await writeJsonAtomic(targetPath, config);
}

/** Record the pool created by the acceptance run through the deploy-owned config writer. */
export async function recordDemoPoolObjectId(
  poolId: string,
  configPath = localnetConfigPath,
): Promise<void> {
  const validated = objectId(poolId);
  if (!validated) throw new Error(`invalid demo pool object ID: ${poolId}`);
  const config = await readConfig(configPath);
  config.demoPoolObjectId = validated;
  await writeJsonAtomic(configPath, config);
}

async function writeEphemeralClientConfig(
  directory: string,
  keypair: Ed25519Keypair,
): Promise<string> {
  const decoded = decodeSuiPrivateKey(keypair.getSecretKey());
  if (decoded.scheme !== "ED25519") {
    throw new Error(`publisher must use ED25519, received ${decoded.scheme}`);
  }
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
  const yaml = [
    "---",
    "keystore:",
    `  File: ${quote(keystorePath)}`,
    "envs:",
    "  - alias: localnet",
    `    rpc: ${quote(localnetRpcUrl)}`,
    "    ws: ~",
    "    basic_auth: ~",
    "active_env: localnet",
    `active_address: ${quote(keypair.toSuiAddress())}`,
    "",
  ].join("\n");
  await writeFile(clientConfigPath, yaml, { mode: 0o600 });
  return clientConfigPath;
}

async function runSuiPublish(clientConfigPath: string): Promise<unknown> {
  const packageDirectory = join(repositoryRoot, "move/openverdict");
  const lockPath = join(packageDirectory, "Move.lock");
  const originalLock = await readFile(lockPath);
  // A regenesis localnet has a fresh chain id every run, so it can never be
  // a pinned environment in Move.toml; test-publish builds against the
  // testnet pins with ephemeral dependency addresses instead.
  const args = [
    "client",
    "--client.config",
    clientConfigPath,
    "test-publish",
    "--build-env",
    "testnet",
    "--json",
    "--gas-budget",
    "2000000000",
  ];
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    result = await runProcess("sui", args, {
      cwd: packageDirectory,
      timeoutMs: 180_000,
    });
  } finally {
    // Publishing records environment metadata; source-controlled Move.lock stays immutable.
    await writeFile(lockPath, originalLock);
    // test-publish also writes an ephemeral publication file pinned to this
    // regenesis chain id; the next localnet has another id and refuses it.
    await rm(join(packageDirectory, "Pub.localnet.toml"), { force: true });
  }
  if (result.code !== 0) {
    throw new Error(
      `sui client publish failed with exit ${result.code}: ${[
        result.stderr.trim(),
        result.stdout.trim(),
      ].filter(Boolean).join("\n").slice(0, 4_000)}`,
    );
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`sui client publish returned invalid JSON: ${result.stdout.slice(0, 500)}`, {
      cause: error,
    });
  }
}

export async function resolveDeploymentIds(
  client: OpenVerdictSuiClient,
  publishOutput: unknown,
  digest: string,
  publisher: string,
): Promise<DeploymentObjectIds> {
  const settled = await client.core.waitForTransaction({
    digest,
    timeout: 60_000,
    include: { effects: true, objectTypes: true },
  });
  if (settled.$kind === "FailedTransaction") {
    throw new Error(
      settled.FailedTransaction.status.error?.message ?? "package publish failed",
    );
  }

  const objectTypes = new Map<string, string>();
  for (const [id, type] of Object.entries(settled.Transaction.objectTypes)) {
    objectTypes.set(id, type);
  }
  collectTypedObjects(publishOutput, objectTypes);

  const createdIds = new Set<string>();
  for (const changed of settled.Transaction.effects.changedObjects) {
    if (changed.idOperation === "Created") createdIds.add(changed.objectId);
  }
  collectObjectIds(publishOutput, createdIds);
  for (const id of createdIds) {
    if (objectTypes.has(id)) continue;
    try {
      const { object } = await client.core.getObject({ objectId: id });
      objectTypes.set(id, object.type);
    } catch {
      // The publish JSON still supplies enough information on older CLI shapes.
    }
  }

  const packageId =
    findPublishedPackageId(publishOutput) ??
    findTypedObject(objectTypes, (type) => type === "package");
  if (!packageId) throw new Error("publish transaction did not create a package object");

  const registryObjectId = requiredTypedObject(
    objectTypes,
    `${packageId}::agent_registry::Registry`,
  );
  const capTypes: Record<CapField, string> = {
    adminCapObjectId: "AdminCap",
    pauseCapObjectId: "PauseCap",
    evidenceCapObjectId: "EvidenceCap",
    runAttestorCapObjectId: "RunAttestorCap",
  };
  const caps = {} as Record<CapField, string>;
  for (const field of CAP_FIELDS) {
    const type = `${packageId}::agent_registry::${capTypes[field]}`;
    caps[field] =
      findTypedObject(objectTypes, (value) => value === type) ??
      (await findOwnedObject(client, publisher, type));
  }
  return { packageId, registryObjectId, ...caps };
}

async function findOwnedObject(
  client: OpenVerdictSuiClient,
  owner: string,
  type: string,
): Promise<string> {
  const page = await client.core.listOwnedObjects({ owner, type, limit: 50 });
  const object = page.objects[0];
  if (!object) throw new Error(`publish transaction did not create ${type}`);
  return object.objectId;
}

function requiredTypedObject(types: Map<string, string>, type: string): string {
  const id = findTypedObject(types, (value) => value === type);
  if (!id) throw new Error(`publish transaction did not create ${type}`);
  return id;
}

function findTypedObject(
  types: Map<string, string>,
  predicate: (type: string) => boolean,
): string | undefined {
  for (const [id, type] of types) if (predicate(type)) return id;
  return undefined;
}

function collectTypedObjects(value: unknown, output: Map<string, string>): void {
  walkRecords(value, (record) => {
    const id = objectId(record.objectId);
    const type = typeof record.objectType === "string" ? record.objectType : undefined;
    if (id && type) output.set(id, type);
  });
}

function collectObjectIds(value: unknown, output: Set<string>): void {
  walkRecords(value, (record) => {
    const id = objectId(record.objectId);
    if (id) output.add(id);
  });
}

function findPublishedPackageId(value: unknown): string | undefined {
  let packageId: string | undefined;
  walkRecords(value, (record) => {
    if (packageId || record.type !== "published") return;
    packageId = objectId(record.packageId);
  });
  return packageId;
}

function walkRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walkRecords(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const nested of Object.values(record)) walkRecords(nested, visit);
}

export function findStringByKey(value: unknown, key: string): string | undefined {
  let found: string | undefined;
  walkRecords(value, (record) => {
    if (found === undefined && typeof record[key] === "string") {
      found = record[key];
    }
  });
  return found;
}

async function objectExists(client: OpenVerdictSuiClient, id: string): Promise<boolean> {
  try {
    const { object } = await client.core.getObject({ objectId: id });
    return object.objectId === id;
  } catch {
    return false;
  }
}

export async function readConfig(path: string): Promise<MutableLocalnetConfig> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value as MutableLocalnetConfig;
}

export async function writeDeploymentConfig(
  path: string,
  config: MutableLocalnetConfig,
  ids: DeploymentObjectIds,
): Promise<void> {
  Object.assign(config, ids);
  await writeJsonAtomic(path, config);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function objectId(value: unknown): string | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
    ? value
    : undefined;
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function main(): Promise<void> {
  const force = process.argv.slice(2).includes("--force");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--force");
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown.join(" ")}`);
  const deployment = await deployLocalnet({
    force,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  process.stdout.write(
    `${JSON.stringify({ ...deployment, publisherKeypair: undefined }, null, 2)}\n`,
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `DEPLOY_LOCALNET_FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

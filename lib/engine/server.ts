import { existsSync } from "node:fs";
import type { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { createFakeGonkaAdapter, createGonkaAdapter, type GonkaRouterAdapter } from "../gonka";
import { blake2b256, toHex, type AgentManifest, type OracleInferenceInput } from "../protocol";
import { createDb } from "../storage";
import {
  SignerRegistry,
  assertDeployedManifest,
  createSuiClients,
  loadReleaseManifest,
  type ReleaseManifest,
} from "../sui";
import { createLocalWalrusStore } from "../walrus/local";
import type { WalrusStore } from "../walrus/store";
import type { Engine } from "./contract";
import { createEngine } from "./engine";

let singleton: Promise<Engine> | undefined;

/**
 * Read an env var, treating blank as unset.
 *
 * Deployment dashboards (Vercel among them) persist a variable created without
 * a value as an empty string rather than omitting it, and `??` only falls back
 * on null/undefined. A blank OPENVERDICT_RELEASE_MANIFEST therefore survived as
 * "" and reached existsSync(""), taking the whole engine down with the useless
 * message "release manifest is missing: ".
 */
export function readEnv(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

/** Missing runtime configuration is exposed as a stable 503-compatible error. */
export class EngineNotWiredError extends Error {
  override readonly name = "EngineNotWiredError";
  readonly code = "ENGINE_NOT_WIRED" as const;

  constructor(message = "OpenVerdict engine runtime configuration is incomplete") {
    super(message);
  }
}

/** Build one process-wide engine shared by Next.js API routes and workers. */
export async function getServerEngine(): Promise<Engine> {
  singleton ??= buildServerEngine().catch((error: unknown) => {
    singleton = undefined;
    throw error;
  });
  return singleton;
}

async function buildServerEngine(): Promise<Engine> {
  const manifestPath = readEnv(
    process.env.OPENVERDICT_RELEASE_MANIFEST,
    "config/release.localnet.json",
  );
  if (!existsSync(/* turbopackIgnore: true */ manifestPath)) {
    throw new EngineNotWiredError(`release manifest is missing: ${manifestPath}`);
  }
  const manifest = await loadReleaseManifest(manifestPath);
  try {
    assertDeployedManifest(manifest);
  } catch {
    throw new EngineNotWiredError(
      `release manifest ${manifestPath} has no deployed packageId or registryObjectId`,
    );
  }
  if (!process.env.SUI_OPERATOR_SECRET_KEY?.trim()) {
    throw new EngineNotWiredError("SUI_OPERATOR_SECRET_KEY is required");
  }
  if (!process.env.OPENVERDICT_AGENT_SEED?.trim()) {
    throw new EngineNotWiredError(
      "OPENVERDICT_AGENT_SEED is required for the test-only demo allowlist",
    );
  }
  if (manifest.gonka.mode === "live" && !process.env.GONKA_ROUTER_API_KEY?.trim()) {
    throw new EngineNotWiredError("GONKA_ROUTER_API_KEY is required in live mode");
  }

  const signers = SignerRegistry.fromEnv(process.env, 7);
  const suiClient = createSuiClients(manifest);
  // Without DATABASE_URL this falls back to embedded PGlite, which needs a
  // writable directory. Serverless roots are read-only (mkdir '/var/task/
  // .pglite' fails with EROFS), so the data dir is overridable. Note the
  // fallback is per-container and ephemeral: set DATABASE_URL for real
  // persistence across cold starts and concurrent invocations.
  const db = createDb({
    url: process.env.DATABASE_URL || undefined,
    dataDir: readEnv(process.env.PGLITE_DATA_DIR, ".pglite"),
  });
  const walrus =
    manifest.walrus.mode === "local"
      ? createLocalWalrusStore(manifest.walrus.localDir ?? ".localnet/walrus-local")
      : await createRuntimeRealWalrusStore(manifest, signers.getOperator());
  const gonka =
    manifest.gonka.mode === "fake"
      ? createDynamicFakeAdapter()
      : createGonkaAdapter({
          // Same blank-vs-absent hazard: a blank override must not erase the
          // manifest's own base URL.
          baseUrl: readEnv(process.env.GONKA_ROUTER_BASE_URL, manifest.gonka.baseUrl),
          apiKey: process.env.GONKA_ROUTER_API_KEY ?? "",
          timeoutMs: numberEnv("GONKA_REQUEST_TIMEOUT_MS", 120_000),
          maxRetries: numberEnv("GONKA_MAX_RETRIES", 1),
        });

  return createEngine({
    network: manifest.network,
    manifestPath,
    db,
    walrus,
    gonka,
    suiClient,
    signers,
    ...(process.env.OPENVERDICT_ZKLOGIN_GRAPHQL_URL?.trim()
      ? { zkLoginGraphqlUrl: process.env.OPENVERDICT_ZKLOGIN_GRAPHQL_URL.trim() }
      : {}),
  });
}

/** Keep optional Walrus WASM out of local-only Next route bundles. */
async function createRuntimeRealWalrusStore(
  manifest: ReleaseManifest,
  signer: Signer,
): Promise<WalrusStore> {
  if (manifest.walrus.mode === "local") {
    throw new Error("real Walrus requires testnet or mainnet mode");
  }
  // Deliberately NOT webpackIgnore'd: that hid the import from the file
  // tracer, so @mysten/walrus never shipped to the serverless function and
  // every request died with "Cannot find package '@mysten/walrus'". The
  // package is listed in serverExternalPackages instead, which keeps the wasm
  // out of the route bundle AND lets the tracer follow it.
  const { WalrusFile, walrus } = await import("@mysten/walrus");
  const client = new SuiGrpcClient({
    network: manifest.walrus.mode,
    baseUrl: manifest.suiRpcUrl,
  }).$extend(walrus());
  const epochs = manifest.walrus.epochs ?? 10;
  return {
    async put(bytes, options) {
      const stableBytes = Uint8Array.from(bytes);
      const file = WalrusFile.from({
        contents: stableBytes,
        identifier:
          options?.identifier ??
          `${Buffer.from(blake2b256(stableBytes)).toString("base64url")}.bin`,
        tags: options?.tags,
      });
      const results = await client.walrus.writeFiles({
        files: [file],
        epochs: options?.epochs ?? epochs,
        deletable: options?.deletable ?? false,
        owner: options?.owner,
        signer,
      });
      const result = results[0];
      if (!result) throw new Error("Walrus write returned no file result");
      return {
        blobId: result.blobId,
        objectId: result.blobObject.id,
        endEpoch: result.blobObject.storage.end_epoch,
      };
    },
    async get(blobId) {
      const files = await client.walrus.getFiles({ ids: [blobId] });
      const file = files[0];
      if (!file) throw new Error(`Walrus blob not found: ${blobId}`);
      return Uint8Array.from(await file.bytes());
    },
  };
}

function createDynamicFakeAdapter(): GonkaRouterAdapter {
  const utilityAgentId = `0x${"00".repeat(32)}` as const;
  const utility = createFakeGonkaAdapter([{ agentProfileId: utilityAgentId }]);
  return {
    async run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown> {
      const confidenceOffset = blake2b256(
        new TextEncoder().encode(manifest.agentProfileId),
      )[0] ?? 0;
      return createFakeGonkaAdapter([
        {
          agentProfileId: manifest.agentProfileId,
          outcome: "YES",
          confidenceBps: 7_800 + (confidenceOffset % 5) * 100,
          gonkaRequestId: `msg_fake_${toHex(blake2b256(new TextEncoder().encode(input.runId))).slice(2, 18)}`,
        },
      ]).run(input, manifest);
    },
    normalizeResponse: utility.normalizeResponse,
    validateOutput: utility.validateOutput,
    buildRunAudit: utility.buildRunAudit,
  };
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}

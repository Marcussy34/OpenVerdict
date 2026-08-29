import { existsSync } from "node:fs";
import type { Signer } from "@mysten/sui/cryptography";
import {
  createFakeGonkaAdapter,
  createGonkaAdapter,
  type GonkaRouterAdapter,
} from "../gonka";
import { blake2b256, toHex, type AgentManifest, type OracleInferenceInput } from "../protocol";
import { createFirecrawlProvider } from "../research";
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
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (manifest.gonka.mode === "live" && !firecrawlApiKey) {
    throw new Error("FIRECRAWL_API_KEY is required for live juror research");
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
          // Research turns carry a growing conversation; give them longer.
          researchTimeoutMs: numberEnv("GONKA_RESEARCH_TIMEOUT_MS", 240_000),
          maxRetries: numberEnv("GONKA_MAX_RETRIES", 1),
        });
  const research = manifest.gonka.mode === "live"
    ? createFirecrawlProvider({
        apiKey: firecrawlApiKey ?? "",
        ...(process.env.FIRECRAWL_API_URL?.trim()
          ? { baseUrl: process.env.FIRECRAWL_API_URL.trim() }
          : {}),
      })
    : undefined;

  return createEngine({
    network: manifest.network,
    manifestPath,
    db,
    walrus,
    gonka,
    ...(research === undefined ? {} : { research }),
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
  const { createRealWalrusStore } = await import("../walrus/real");
  return createRealWalrusStore({
    network: manifest.walrus.mode,
    // Some networks (this developer machine among them) cannot complete TLS
    // to *.sui.io; https://public-rpc.sui-testnet.mystenlabs.com is the same
    // fullnode under its CNAME target, so it is an override, not a fallback.
    baseUrl: readEnv(process.env.OPENVERDICT_SUI_GRPC_URL, manifest.suiRpcUrl),
    signer,
    epochs: manifest.walrus.epochs ?? 10,
    // Serverless functions cannot fan a blob out to ~100 storage nodes (the
    // SDK gives up once a third of the shards fail); an upload relay takes
    // the slivers in one request. Opt in per host with WALRUS_UPLOAD_RELAY_URL.
    ...(process.env.WALRUS_UPLOAD_RELAY_URL?.trim()
      ? {
          uploadRelay: {
            host: process.env.WALRUS_UPLOAD_RELAY_URL.trim(),
            sendTip: { max: numberEnv("WALRUS_UPLOAD_RELAY_MAX_TIP_MIST", 1_000) },
          },
        }
      : {}),
  });
}

function createDynamicFakeAdapter(): GonkaRouterAdapter {
  const utilityAgentId = `0x${"00".repeat(32)}` as const;
  const utility = createFakeGonkaAdapter([{ agentProfileId: utilityAgentId }]);
  const completionAdapters = new WeakMap<object, GonkaRouterAdapter>();
  const adapterFor = (
    input: OracleInferenceInput,
    manifest: AgentManifest,
  ): GonkaRouterAdapter => {
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
    ]);
  };
  return {
    async run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown> {
      return adapterFor(input, manifest).run(input, manifest);
    },
    async complete(request) {
      let adapter = completionAdapters.get(request.attempts);
      if (!adapter) {
        adapter = adapterFor(request.input, request.manifest);
        completionAdapters.set(request.attempts, adapter);
      }
      return adapter.complete(request);
    },
    normalizeResponse: utility.normalizeResponse,
    validateOutput: utility.validateOutput,
    buildRunAudit: utility.buildRunAudit,
    // The fake jury must bind to the same prompt spec as the live adapter, or
    // the engine's fail-closed manifest check would reject every seat.
    promptSpec: utility.promptSpec,
    promptSpecHash: utility.promptSpecHash,
    toolPolicy: utility.toolPolicy,
    toolPolicyHash: utility.toolPolicyHash,
    legacyPromptSpec: utility.legacyPromptSpec,
  };
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}

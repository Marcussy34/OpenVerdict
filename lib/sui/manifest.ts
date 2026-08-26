import { readFile } from "node:fs/promises";
import { z } from "zod";

const optionalObjectId = z.union([
  z.literal(""),
  z.string().regex(/^0x[0-9a-fA-F]+$/, "must be a 0x-prefixed Sui object ID"),
]);

const requiredObjectId = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "must be a 0x-prefixed Sui object ID");

export const releaseManifestSchema = z
  .object({
    network: z.enum(["localnet", "testnet", "mainnet"]),
    suiRpcUrl: z.string().url(),
    suiFaucetUrl: z.string().url().optional(),
    packageId: optionalObjectId,
    registryObjectId: optionalObjectId,
    demoPoolObjectId: optionalObjectId.optional().default(""),
    clockObjectId: z.literal("0x6"),
    randomObjectId: z.literal("0x8"),
    coinType: z.string().regex(/^0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/),
    walrus: z
      .object({
        mode: z.enum(["local", "testnet", "mainnet"]),
        localDir: z.string().min(1).optional(),
        epochs: z.number().int().positive().optional(),
      })
      .strict(),
    gonka: z
      .object({
        mode: z.enum(["fake", "live"]),
        baseUrl: z.string().url(),
        models: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    committee: z
      .object({
        size: z.literal(5),
        threshold: z.literal(4),
        maxSeatsPerModel: z.literal(2),
        minDistinctModels: z.number().int().min(3).max(5),
      })
      .strict(),
    evidencePolicy: z
      .object({
        id: requiredObjectId,
        maxBytes: z.number().int().positive(),
        maxRedirects: z.number().int().min(0).max(10),
        timeoutMs: z.number().int().positive(),
        allowedMime: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    explorerTxTemplate: z.string(),
  })
  .strict();

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export class ReleaseManifestError extends Error {
  override readonly name = "ReleaseManifestError";
  readonly code = "INVALID_RELEASE_MANIFEST" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  const parsed = releaseManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ReleaseManifestError(z.prettifyError(parsed.error));
  }
  if (parsed.data.walrus.mode === "local" && !parsed.data.walrus.localDir) {
    throw new ReleaseManifestError("local Walrus mode requires walrus.localDir");
  }
  if (
    (parsed.data.network === "localnet" && parsed.data.walrus.mode !== "local") ||
    (parsed.data.network !== "localnet" && parsed.data.walrus.mode !== parsed.data.network)
  ) {
    throw new ReleaseManifestError("Walrus mode must match the release network");
  }
  if (new Set(parsed.data.gonka.models).size < parsed.data.committee.minDistinctModels) {
    throw new ReleaseManifestError(
      "Gonka model list does not satisfy committee.minDistinctModels",
    );
  }
  return parsed.data;
}

/** Read and validate the release manifest before any client is created. */
export async function loadReleaseManifest(path: string): Promise<ReleaseManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ReleaseManifestError(`could not read release manifest: ${path}`, {
      cause: error,
    });
  }
  return parseReleaseManifest(value);
}

export function assertDeployedManifest(
  manifest: ReleaseManifest,
): asserts manifest is ReleaseManifest & {
  packageId: `0x${string}`;
  registryObjectId: `0x${string}`;
} {
  if (manifest.packageId.length === 0 || manifest.registryObjectId.length === 0) {
    throw new ReleaseManifestError(
      "release manifest is missing packageId or registryObjectId",
    );
  }
}

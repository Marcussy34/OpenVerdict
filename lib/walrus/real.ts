import {
  NotFoundError as WalrusSdkNotFoundError,
  walrus,
  type StorageNodeClientOptions,
  type UploadRelayConfig,
  type WalrusPackageConfig,
} from "@mysten/walrus";
import type { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  assertValidWalrusEpoch,
  assertValidWalrusObjectId,
  type RenewableWalrusStore,
} from "./retention";
import {
  WalrusNotFoundError,
  assertValidWalrusBlobId,
} from "./store";

const EPOCH_CACHE_MS = 60_000;

export interface RealWalrusStoreConfig {
  network: "testnet" | "mainnet";
  baseUrl: string;
  signer: Signer;
  epochs: number;
  deletable?: boolean;
  uploadRelay?: UploadRelayConfig;
  packageConfig?: WalrusPackageConfig;
  storageNodeClientOptions?: StorageNodeClientOptions;
  wasmUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Create a signer-backed Walrus store using the current Sui client extension. */
export function createRealWalrusStore(
  config: RealWalrusStoreConfig,
): RenewableWalrusStore {
  validateBaseUrl(config.baseUrl);
  validateEpochs(config.epochs);

  const client = new SuiGrpcClient({
    network: config.network,
    baseUrl: config.baseUrl,
  }).$extend(
    walrus({
      packageConfig: config.packageConfig,
      storageNodeClientOptions: config.storageNodeClientOptions,
      uploadRelay: config.uploadRelay,
      wasmUrl: config.wasmUrl,
    }),
  );

  let epochCache:
    | { value: { currentEpoch: number; epochDurationMs: number }; fetchedAtMs: number }
    | undefined;

  return {
    async put(bytes, options) {
      const stableBytes = Uint8Array.from(bytes);
      const epochs = options?.epochs ?? config.epochs;
      validateEpochs(epochs);
      // Raw blobs carry no file metadata, so identifier/tags are accepted
      // (for interface parity with the local store and every caller) but
      // ignored here. Raw blobs are required, not quilts: writeFiles wraps
      // its input in a quilt container whose blobId addresses the container,
      // not the artifact, so a verifier hashing "the blob" would get a hash
      // that matches nothing on chain. writeBlob's blobId is derived from
      // the content itself, which is what content addressing needs.
      // Hosts share the operator signer. This SDK path bypasses the gateway
      // retry, so each writeBlob retry rebuilds with fresh object versions.
      const result = await retryStaleWalrusWrite(
        () =>
          client.walrus.writeBlob({
            blob: stableBytes,
            epochs,
            deletable: options?.deletable ?? config.deletable ?? false,
            owner: options?.owner,
            signer: config.signer,
          }),
        config.sleep ?? defaultSleep,
      );
      return {
        blobId: result.blobId,
        objectId: result.blobObject.id,
        endEpoch: result.blobObject.storage.end_epoch,
      };
    },

    async get(blobId) {
      assertValidWalrusBlobId(blobId);
      try {
        return Uint8Array.from(await client.walrus.readBlob({ blobId }));
      } catch (error) {
        if (error instanceof WalrusSdkNotFoundError) {
          throw new WalrusNotFoundError(blobId, { cause: error });
        }
        throw error;
      }
    },

    async epochInfo() {
      // The chain compares retention with the SUI epoch, so callers convert
      // Walrus end epochs with this clock; cached briefly, epochs last hours.
      const now = Date.now();
      if (epochCache && now - epochCache.fetchedAtMs < EPOCH_CACHE_MS) {
        return epochCache.value;
      }
      const staking = await client.walrus.stakingState();
      const value = {
        currentEpoch: Number(staking.epoch),
        epochDurationMs: Number(staking.epoch_duration),
      };
      if (
        !Number.isFinite(value.currentEpoch) ||
        value.currentEpoch < 0 ||
        !Number.isFinite(value.epochDurationMs) ||
        value.epochDurationMs <= 0
      ) {
        throw new Error("Walrus staking state reported invalid epoch information");
      }
      epochCache = { value, fetchedAtMs: now };
      return value;
    },

    async renew({ blobId, objectId, targetEndEpoch }) {
      assertValidWalrusBlobId(blobId);
      assertValidWalrusObjectId(objectId);
      assertValidWalrusEpoch(targetEndEpoch, "target end epoch");
      const { digest } = await client.walrus.executeExtendBlobTransaction({
        blobObjectId: objectId,
        endEpoch: targetEndEpoch,
        signer: config.signer,
      });
      const blobObject = await client.walrus.getBlobObject(objectId);
      if (blobObject.blob_id !== blobId) {
        throw new Error("renewed Walrus object does not match the blob ID");
      }
      if (blobObject.storage.end_epoch < targetEndEpoch) {
        throw new Error("Walrus renewal did not reach the requested end epoch");
      }
      return {
        endEpoch: blobObject.storage.end_epoch,
        transactionDigest: digest,
      };
    },
  };
}

function validateBaseUrl(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("Walrus Sui baseUrl must be an HTTP(S) URL");
  }
}

function validateEpochs(epochs: number): void {
  if (!Number.isSafeInteger(epochs) || epochs <= 0) {
    throw new Error("Walrus epochs must be a positive integer");
  }
}

const STALE_WALRUS_WRITE_PATTERN =
  /unavailable for consumption|needs to be rebuilt|ObjectVersionUnavailableForConsumption/i;
const WALRUS_WRITE_ATTEMPTS = 3;
const WALRUS_WRITE_RETRY_DELAY_MS = 750;

async function retryStaleWalrusWrite<T>(
  writeBlob: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await writeBlob();
    } catch (error) {
      if (
        attempt >= WALRUS_WRITE_ATTEMPTS ||
        !isStaleWalrusWriteError(error)
      ) {
        throw error;
      }
      await sleep(WALRUS_WRITE_RETRY_DELAY_MS * attempt);
    }
  }
}

function isStaleWalrusWriteError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (STALE_WALRUS_WRITE_PATTERN.test(errorMessage(current))) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

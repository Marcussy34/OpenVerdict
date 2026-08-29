import {
  NotFoundError as WalrusSdkNotFoundError,
  walrus,
  type StorageNodeClientOptions,
  type UploadRelayConfig,
  type WalrusPackageConfig,
} from "@mysten/walrus";
import type { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";
import { executeAndWait, waitForGasIndex } from "../sui/execute";
import { runOnOperatorLane } from "../sui/operator-lane";
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
      // One operator-signed operation at a time per process (shared with the
      // Sui gateway): every write spends from the same gas and WAL coins,
      // and five seats writing and approving together made the validators
      // reject each other's transactions. Uploads that wait here are
      // already off the model's critical path.
      const result = await runOnOperatorLane(async () => {
        const written = await retryStaleWalrusWrite(
          () =>
            writeBlobPinned(client, config.signer, stableBytes, {
              epochs,
              deletable: options?.deletable ?? config.deletable ?? false,
              owner: options?.owner,
            }),
          config.sleep ?? defaultSleep,
          // Drop cached object versions so the rebuilt transaction sees the coins as they are now.
          () => client.walrus.reset(),
        );
        // The SDK's certify just spent the gas coin; let the owned-object
        // index catch up before the next lane operation selects gas from it.
        await waitForGasIndex(client, config.signer.toSuiAddress());
        return written;
      });
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

    async blobIdFor(bytes) {
      // The blob id depends only on the content and the shard count, so it is
      // what writeBlob will report; the nonce only feeds relay authentication.
      const { blobId } = await client.walrus.computeBlobMetadata({
        bytes: Uint8Array.from(bytes),
      });
      return blobId;
    },

    async epochInfo() {
      // The chain compares retention with the SUI epoch, so callers convert
      // Walrus end epochs with this clock; cached briefly, epochs last hours.
      const now = Date.now();
      if (epochCache && now - epochCache.fetchedAtMs < EPOCH_CACHE_MS) {
        return epochCache.value;
      }
      // The SDK object loader has no TTL, so clear it whenever our cache misses.
      client.walrus.reset();
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

/**
 * writeBlob with its two Sui transactions (register, certify) executed by our
 * own executor, which pins gas from the object store. The SDK's built-in
 * execution selects gas from the owned-object index, which lags under load,
 * so its certify kept losing to the version its own register had consumed.
 */
async function writeBlobPinned(
  client: Parameters<typeof executeAndWait>[0] & {
    walrus: { writeBlobFlow: (options: { blob: Uint8Array }) => WalrusWriteFlow };
  },
  signer: Signer,
  blob: Uint8Array,
  options: { epochs: number; deletable: boolean; owner?: string },
): Promise<Awaited<ReturnType<WalrusWriteFlow["getBlob"]>>> {
  const flow = client.walrus.writeBlobFlow({ blob });
  await flow.encode();
  const registered = await executeAndWait(client, signer, () =>
    flow.register({
      epochs: options.epochs,
      deletable: options.deletable,
      owner: options.owner ?? signer.toSuiAddress(),
    }),
  );
  await flow.upload({ digest: registered.digest });
  await executeAndWait(client, signer, () => flow.certify());
  return flow.getBlob();
}

/** The subset of the SDK's write flow this store drives (step records are ignored). */
type WalrusWriteFlow = {
  encode(): Promise<unknown>;
  register(options: { epochs: number; deletable: boolean; owner: string }): Transaction;
  upload(options: { digest: string }): Promise<unknown>;
  certify(): Transaction;
  getBlob(): Promise<{
    blobId: string;
    blobObject: { id: string; storage: { end_epoch: number } };
  }>;
};

// Parallel writes from one signer race on the gas and WAL coins; every one of
// these wordings means "rebuild with fresh versions and try again".
const STALE_WALRUS_WRITE_PATTERN =
  /unavailable for consumption|needs to be rebuilt|ObjectVersionUnavailableForConsumption|provided version doesn't match|already locked by a different transaction|reserved for another transaction/i;
// Five seats finishing together write five sealed bundles and approve five
// runs on one gas coin; the budget below rides out such a burst.
const WALRUS_WRITE_ATTEMPTS = 8;
const WALRUS_WRITE_RETRY_DELAY_MS = 1_500;

async function retryStaleWalrusWrite<T>(
  writeBlob: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<void>,
  beforeRetry?: () => void,
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
      beforeRetry?.();
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
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // gRPC status messages arrive percent-encoded; decode before matching.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

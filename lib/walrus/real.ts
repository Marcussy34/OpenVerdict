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
      const result = await client.walrus.writeBlob({
        blob: stableBytes,
        epochs,
        deletable: options?.deletable ?? config.deletable ?? false,
        owner: options?.owner,
        signer: config.signer,
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

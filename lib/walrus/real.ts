import {
  NotFoundError as WalrusSdkNotFoundError,
  WalrusFile,
  walrus,
  type StorageNodeClientOptions,
  type UploadRelayConfig,
  type WalrusPackageConfig,
} from "@mysten/walrus";
import type { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { blake2b256 } from "../protocol/hash";
import {
  assertValidWalrusEpoch,
  assertValidWalrusObjectId,
  type RenewableWalrusStore,
} from "./retention";
import {
  WalrusNotFoundError,
  assertValidWalrusBlobId,
  type WalrusPutResult,
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
      const file = WalrusFile.from({
        contents: stableBytes,
        identifier: options?.identifier ?? defaultIdentifier(stableBytes),
        tags: options?.tags,
      });
      const results = await client.walrus.writeFiles({
        files: [file],
        epochs,
        deletable: options?.deletable ?? config.deletable ?? false,
        owner: options?.owner,
        signer: config.signer,
      });
      return singleWriteResult(results);
    },

    async get(blobId) {
      assertValidWalrusBlobId(blobId);
      try {
        const files = await client.walrus.getFiles({ ids: [blobId] });
        const file = files[0];
        if (file === undefined) throw new WalrusNotFoundError(blobId);
        return Uint8Array.from(await file.bytes());
      } catch (error) {
        if (error instanceof WalrusNotFoundError) throw error;
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

interface WalrusFileWriteResult {
  blobId: string;
  blobObject: {
    id: string;
    storage: { end_epoch: number };
  };
}

function singleWriteResult(
  results: readonly WalrusFileWriteResult[],
): WalrusPutResult {
  if (results.length !== 1) {
    throw new Error("Walrus writeFiles returned an unexpected result count");
  }
  const result = results[0];
  if (result === undefined) {
    throw new Error("Walrus writeFiles returned no file result");
  }
  return {
    blobId: result.blobId,
    objectId: result.blobObject.id,
    endEpoch: result.blobObject.storage.end_epoch,
  };
}

function defaultIdentifier(bytes: Uint8Array): string {
  return `${Buffer.from(blake2b256(bytes)).toString("base64url")}.bin`;
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

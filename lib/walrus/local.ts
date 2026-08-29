import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { blake2b256 } from "../protocol/hash";
import {
  WalrusNotFoundError,
  assertValidWalrusBlobId,
  type WalrusStore,
} from "./store";

/** Filesystem-backed content-addressed store for offline development and tests. */
export function createLocalWalrusStore(directory: string): WalrusStore {
  const root = resolve(directory);

  return {
    async put(bytes) {
      const stableBytes = Uint8Array.from(bytes);
      const blobId = localBlobId(stableBytes);
      const destination = resolve(root, blobId);
      const temporary = resolve(
        root,
        `.${blobId}.${process.pid}.${randomUUID()}.tmp`,
      );

      await mkdir(root, { recursive: true });
      try {
        await writeFile(temporary, stableBytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await removeTemporaryFile(temporary);
      }
      return { blobId };
    },

    async get(blobId) {
      assertValidWalrusBlobId(blobId);
      try {
        const handle = await open(
          resolve(root, blobId),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          return Uint8Array.from(await handle.readFile());
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (isFileNotFound(error)) {
          throw new WalrusNotFoundError(blobId, { cause: error });
        }
        throw error;
      }
    },

    async blobIdFor(bytes) {
      return localBlobId(Uint8Array.from(bytes));
    },
  };
}

/** Same content address `put` stores under; base64url like real Walrus ids. */
function localBlobId(bytes: Uint8Array): string {
  return Buffer.from(blake2b256(bytes)).toString("base64url");
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

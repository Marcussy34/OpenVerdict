import {
  DecryptionError,
  ExpiredSessionKeyError,
  GeneralError,
  InconsistentKeyServersError,
  InternalError,
  InvalidCiphertextError,
  InvalidClientOptionsError,
  InvalidKeyServerError,
  InvalidKeyServerObjectIdError,
  InvalidKeyServerVersionError,
  InvalidPackageError,
  InvalidParameterError,
  InvalidPTBError,
  InvalidSessionKeySignatureError,
  InvalidThresholdError,
  NoAccessError,
  SealAPIError,
  SealClient,
  SessionKey,
  TooManyFailedFetchKeyRequestsError,
  UnsupportedPackageIdError,
  type SealClientOptions,
} from "@mysten/seal";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";

import { canonicalJsonBytes } from "../gonka/canonical";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import type { HexString } from "../protocol/types";
import {
  parseSealIdentity,
  sealInnerId,
  type SealIdentity,
} from "../seal/identity";

const DEFAULT_GRPC_URL = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
} as const;

export type SealRecoveryNetwork = keyof typeof DEFAULT_GRPC_URL;

export type SealRecoveryEscrow = {
  version?: number;
  provider?: string;
  packageId?: string;
  identityHex?: string;
  deadlineMs?: number;
  threshold?: number;
  keyServers?: Array<{
    objectId?: string;
    weight?: number;
    aggregatorUrl?: string;
  }>;
  encryptedObjectBase64?: string;
  aad?: string;
};

export type EscrowedSealedDocument = {
  version?: number;
  kind?: string;
  runId?: string;
  algorithm?: string;
  ivHex?: string;
  aad?: string;
  coreHash?: string;
  ciphertextBase64?: string;
};

type ValidatedKeyServer = {
  objectId: HexString;
  weight: number;
  aggregatorUrl?: string;
};

type ValidatedEscrow = {
  version: 1;
  provider: "seal";
  packageId: HexString;
  identityHex: HexString;
  deadlineMs: number;
  threshold: number;
  keyServers: ValidatedKeyServer[];
  encryptedObjectBase64: string;
  aad: string;
};

export type SealDecryptContext = {
  escrow: ValidatedEscrow;
  identity: SealIdentity;
  encryptedObject: Uint8Array;
  network: SealRecoveryNetwork;
  rpcUrl: string;
};

type SealDecryptClient = Pick<SealClient, "decrypt">;

export type SealRecoveryDependencies = {
  /** Tests can replace the network operation with a deterministic decrypt. */
  decrypt?: (context: SealDecryptContext) => Promise<Uint8Array>;
  createSuiClient?: (options: {
    network: SealRecoveryNetwork;
    baseUrl: string;
  }) => SuiGrpcClient;
  createSealClient?: (options: SealClientOptions) => SealDecryptClient;
  createKeypair?: () => Ed25519Keypair;
  createSessionKey?: typeof SessionKey.create;
  createTransaction?: () => Transaction;
};

export type RecoverSealedKeyOptions = {
  escrow: SealRecoveryEscrow;
  network: SealRecoveryNetwork;
  rpcUrl?: string;
};

export type OpenedEscrowedBundle = {
  core: Record<string, unknown>;
  coreHash: HexString;
};

type ValidatedSealedDocument = Required<EscrowedSealedDocument>;

/** Recover the AES key with a temporary browser-only identity. */
export async function recoverSealedKey(
  options: RecoverSealedKeyOptions,
  dependencies: SealRecoveryDependencies = {},
): Promise<HexString> {
  const { escrow, identity, encryptedObject } = validateEscrow(options.escrow);
  const context: SealDecryptContext = {
    escrow,
    identity,
    encryptedObject,
    network: options.network,
    rpcUrl: options.rpcUrl?.trim() || DEFAULT_GRPC_URL[options.network],
  };

  let recovered: Uint8Array;
  try {
    recovered = dependencies.decrypt
      ? await dependencies.decrypt(context)
      : await decryptThroughSeal(context, dependencies);
  } catch (error) {
    throw new Error(sealRecoveryErrorMessage(error), { cause: error });
  }

  if (recovered.byteLength !== 32) {
    throw new Error(
      `Seal recovered ${recovered.byteLength} key bytes, expected 32`,
    );
  }
  return toHex(recovered);
}

/** Open the original AES bundle with browser Web Crypto. */
export async function openEscrowedBundle(
  sealed: EscrowedSealedDocument,
  keyHex: string,
): Promise<OpenedEscrowedBundle> {
  validateSealedDocument(sealed);
  const key = decodeHex(keyHex, "recovered key");
  const iv = decodeHex(sealed.ivHex, "sealed bundle ivHex");
  if (key.byteLength !== 32) {
    throw new Error("The recovered Seal key must be 32 bytes");
  }
  if (iv.byteLength !== 12) {
    throw new Error("The sealed bundle IV must be 12 bytes");
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto is not available in this browser");
  }
  const cryptoKey = await subtle.importKey(
    "raw",
    exactBuffer(key),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = new Uint8Array(
    await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: exactBuffer(iv),
        additionalData: exactBuffer(new TextEncoder().encode(sealed.aad)),
        tagLength: 128,
      },
      cryptoKey,
      exactBuffer(decodeBase64(sealed.ciphertextBase64, "ciphertextBase64")),
    ),
  );

  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  if (!isRecord(decoded)) {
    throw new Error("The recovered run bundle core is not a JSON object");
  }
  return {
    core: decoded,
    coreHash: toHex(blake2b256(canonicalJsonBytes(decoded))),
  };
}

export function sealRecoveryErrorMessage(error: unknown): string {
  if (error instanceof NoAccessError) {
    return "The key servers refuse until the reveal deadline passes";
  }
  if (error instanceof ExpiredSessionKeyError) {
    return "The temporary Seal session expired. Try again";
  }
  if (
    error instanceof InvalidCiphertextError ||
    error instanceof DecryptionError
  ) {
    return "The Seal escrow ciphertext could not be decrypted";
  }
  if (
    error instanceof InvalidPTBError ||
    error instanceof InvalidPackageError ||
    error instanceof InvalidParameterError ||
    error instanceof InvalidSessionKeySignatureError ||
    error instanceof UnsupportedPackageIdError
  ) {
    return "The Seal policy request is invalid for this escrow";
  }
  if (
    error instanceof InvalidClientOptionsError ||
    error instanceof InvalidKeyServerError ||
    error instanceof InvalidKeyServerObjectIdError ||
    error instanceof InvalidKeyServerVersionError ||
    error instanceof InvalidThresholdError
  ) {
    return "The Seal key server configuration is invalid";
  }
  if (
    error instanceof InconsistentKeyServersError ||
    error instanceof TooManyFailedFetchKeyRequestsError ||
    error instanceof InternalError ||
    error instanceof GeneralError ||
    error instanceof SealAPIError ||
    error instanceof TypeError
  ) {
    return "The Seal key servers are unavailable. Try again";
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The Seal key could not be recovered";
}

async function decryptThroughSeal(
  context: SealDecryptContext,
  dependencies: SealRecoveryDependencies,
): Promise<Uint8Array> {
  const createSuiClient =
    dependencies.createSuiClient ??
    ((options: { network: SealRecoveryNetwork; baseUrl: string }) =>
      new SuiGrpcClient(options));
  const suiClient = createSuiClient({
    network: context.network,
    baseUrl: context.rpcUrl,
  });
  const sealClient = dependencies.createSealClient
    ? dependencies.createSealClient({
        suiClient,
        serverConfigs: context.escrow.keyServers,
        verifyKeyServers: true,
      })
    : new SealClient({
        suiClient,
        serverConfigs: context.escrow.keyServers,
        verifyKeyServers: true,
      });

  // The observer never uses a wallet or a funded account.
  const keypair = dependencies.createKeypair?.() ?? new Ed25519Keypair();
  const createSessionKey = dependencies.createSessionKey ?? SessionKey.create;
  const sessionKey = await createSessionKey({
    address: keypair.toSuiAddress(),
    packageId: context.escrow.packageId,
    ttlMin: 10,
    signer: keypair,
    suiClient,
  });

  const tx = dependencies.createTransaction?.() ?? new Transaction();
  const identityBytes = fromHex(sealInnerId(context.escrow.identityHex));
  tx.moveCall({
    target: `${context.escrow.packageId}::reveal_lock::seal_approve`,
    arguments: [
      tx.pure.vector("u8", identityBytes),
      tx.object.clock(),
    ],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  return sealClient.decrypt({
    data: context.encryptedObject,
    sessionKey,
    txBytes,
  });
}

function validateEscrow(escrow: SealRecoveryEscrow): {
  escrow: ValidatedEscrow;
  identity: SealIdentity;
  encryptedObject: Uint8Array;
} {
  if (escrow.version === undefined) missing("version");
  if (escrow.version !== 1) invalid("version", "expected 1");
  if (escrow.provider === undefined) missing("provider");
  if (escrow.provider !== "seal") invalid("provider", "expected seal");

  const packageId = requiredHex(escrow.packageId, "packageId");
  const identityHex = requiredHex(escrow.identityHex, "identityHex");
  const deadlineMs = requiredInteger(escrow.deadlineMs, "deadlineMs", 0);
  const threshold = requiredInteger(escrow.threshold, "threshold", 1);
  const aad = requiredString(escrow.aad, "aad");
  const encryptedObjectBase64 = requiredString(
    escrow.encryptedObjectBase64,
    "encryptedObjectBase64",
  );
  const encryptedObject = decodeBase64(
    encryptedObjectBase64,
    "encryptedObjectBase64",
  );
  if (encryptedObject.byteLength === 0) {
    invalid("encryptedObjectBase64", "decoded value is empty");
  }

  let identity: SealIdentity;
  try {
    identity = parseSealIdentity(identityHex);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "could not decode";
    invalid("identityHex", detail);
  }
  if (identity.deadlineMs !== deadlineMs) {
    invalid("deadlineMs", "does not match the encoded identity");
  }

  if (escrow.keyServers === undefined) missing("keyServers");
  if (!Array.isArray(escrow.keyServers) || escrow.keyServers.length === 0) {
    invalid("keyServers", "expected at least one server");
  }
  const keyServers = escrow.keyServers.map((server, index) => ({
    objectId: requiredHex(server.objectId, `keyServers[${index}].objectId`),
    weight: requiredInteger(
      server.weight,
      `keyServers[${index}].weight`,
      1,
    ),
    ...(server.aggregatorUrl === undefined
      ? {}
      : {
          aggregatorUrl: requiredUrl(
            server.aggregatorUrl,
            `keyServers[${index}].aggregatorUrl`,
          ),
        }),
  }));
  const totalWeight = keyServers.reduce((sum, server) => sum + server.weight, 0);
  if (threshold > totalWeight) {
    invalid("threshold", `exceeds the available server weight ${totalWeight}`);
  }

  return {
    escrow: {
      version: 1,
      provider: "seal",
      packageId,
      identityHex,
      deadlineMs,
      threshold,
      keyServers,
      encryptedObjectBase64,
      aad,
    },
    identity,
    encryptedObject,
  };
}

function validateSealedDocument(
  sealed: EscrowedSealedDocument,
): asserts sealed is ValidatedSealedDocument {
  if (sealed.version === undefined) missingSealed("version");
  if (sealed.version !== 2) invalidSealed("version", "expected 2");
  if (sealed.kind === undefined) missingSealed("kind");
  if (sealed.kind !== "sealed-run-bundle") {
    invalidSealed("kind", "expected sealed-run-bundle");
  }
  if (sealed.algorithm === undefined) missingSealed("algorithm");
  if (sealed.algorithm !== "AES-256-GCM") {
    invalidSealed("algorithm", "expected AES-256-GCM");
  }
  const runId = requiredSealedString(sealed.runId, "runId");
  const aad = requiredSealedString(sealed.aad, "aad");
  if (runId !== aad) invalidSealed("aad", "does not match runId");
  requiredSealedString(sealed.ivHex, "ivHex");
  requiredSealedString(sealed.coreHash, "coreHash");
  requiredSealedString(sealed.ciphertextBase64, "ciphertextBase64");
}

function requiredString(value: unknown, field: string): string {
  if (value === undefined) missing(field);
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "expected a non-empty string");
  }
  return value;
}

function requiredSealedString(value: unknown, field: string): string {
  if (value === undefined) missingSealed(field);
  if (typeof value !== "string" || !value.trim()) {
    invalidSealed(field, "expected a non-empty string");
  }
  return value;
}

function requiredHex(value: unknown, field: string): HexString {
  const hex = requiredString(value, field);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    invalid(field, "expected 0x-prefixed, byte-aligned hex");
  }
  return hex.toLowerCase() as HexString;
}

function requiredInteger(
  value: unknown,
  field: string,
  minimum: number,
): number {
  if (value === undefined) missing(field);
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    invalid(field, `expected an integer of at least ${minimum}`);
  }
  return value;
}

function requiredUrl(value: unknown, field: string): string {
  const url = requiredString(value, field);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      invalid(field, "expected an http or https URL");
    }
  } catch {
    invalid(field, "expected a valid URL");
  }
  return url;
}

function decodeHex(value: string, field: string): Uint8Array {
  try {
    return fromHex(value);
  } catch {
    throw new Error(`The ${field} is not valid hex`);
  }
}

function decodeBase64(value: string, field: string): Uint8Array {
  try {
    return fromBase64(value);
  } catch {
    throw new Error(`Seal escrow ${field} is not valid base64`);
  }
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missing(field: string): never {
  throw new Error(`Seal escrow is missing ${field}`);
}

function invalid(field: string, detail: string): never {
  throw new Error(`Seal escrow ${field} is invalid: ${detail}`);
}

function missingSealed(field: string): never {
  throw new Error(`Sealed bundle is missing ${field}`);
}

function invalidSealed(field: string, detail: string): never {
  throw new Error(`Sealed bundle ${field} is invalid: ${detail}`);
}

import {
  EncryptedObject,
  SealClient,
  type SealCompatibleClient,
} from "@mysten/seal";
import {
  fromBase64,
  isValidSuiObjectId,
  toBase64,
} from "@mysten/sui/utils";

import { fromHex, toHex } from "../protocol/hash";
import type { HexString, SealEscrowV1 } from "../protocol/types";
import { sealIdentityHex, sealInnerId } from "./identity";

const utf8 = new TextEncoder();

export type SealEscrowPolicy = {
  packageId: HexString;
  threshold: number;
  keyServers: SealEscrowV1["keyServers"];
};

export type SealEscrowService = {
  policy: SealEscrowPolicy;
  escrowKey(params: {
    claimId: HexString;
    jurySeatId: HexString;
    phase: 1 | 2;
    deadlineMs: number;
    runId: HexString;
    keyBytes: Uint8Array;
  }): Promise<SealEscrowV1>;
};

export type ParsedEscrowObject = {
  packageId: HexString;
  /** Seal's full identity: policy package bytes followed by inner identity bytes. */
  id: HexString;
  threshold: number;
  services: Array<{ objectId: HexString; shareIndex: number }>;
};

type SealEncryptClient = Pick<SealClient, "encrypt">;

export function createSealEscrowService(options: {
  suiClient: SealCompatibleClient;
  packageId: HexString;
  threshold: number;
  keyServers: SealEscrowV1["keyServers"];
  /** Tests inject encryption so they never contact key servers. */
  client?: SealEncryptClient;
}): SealEscrowService {
  const keyServers = options.keyServers.map((server) => ({ ...server }));
  const policy: SealEscrowPolicy = {
    packageId: options.packageId,
    threshold: options.threshold,
    keyServers,
  };
  const client =
    options.client ??
    new SealClient({
      suiClient: options.suiClient,
      serverConfigs: keyServers,
      verifyKeyServers: true,
    });

  return {
    policy,
    async escrowKey(params): Promise<SealEscrowV1> {
      const identityHex = sealIdentityHex({
        claimId: params.claimId,
        jurySeatId: params.jurySeatId,
        phase: params.phase,
        deadlineMs: params.deadlineMs,
      });
      const { encryptedObject } = await client.encrypt({
        threshold: policy.threshold,
        packageId: policy.packageId,
        id: sealInnerId(identityHex),
        data: params.keyBytes,
        aad: utf8.encode(params.runId),
      });

      return {
        version: 1,
        provider: "seal",
        packageId: policy.packageId,
        identityHex,
        deadlineMs: params.deadlineMs,
        threshold: policy.threshold,
        keyServers: policy.keyServers.map((server) => ({ ...server })),
        encryptedObjectBase64: toBase64(encryptedObject),
        aad: params.runId,
      };
    },
  };
}

/** Decode the SDK object and expose stable, display-ready metadata. */
export function parseEscrowObject(escrow: SealEscrowV1): ParsedEscrowObject {
  const parsed = EncryptedObject.parse(fromBase64(escrow.encryptedObjectBase64));
  if (parsed.version !== 0) {
    throw new Error(`unsupported Seal encrypted object version ${parsed.version}`);
  }
  const packageId = normalizeHex(parsed.packageId);
  return {
    packageId,
    id: expectedFullIdHex(packageId, normalizeHex(parsed.id)),
    threshold: parsed.threshold,
    services: parsed.services.map(([objectId, shareIndex]) => ({
      objectId: normalizeHex(objectId),
      shareIndex,
    })),
  };
}

/** Mirror Seal's createFullId without importing its private utility. */
export function expectedFullIdHex(
  packageId: HexString,
  identityHex: HexString,
): HexString {
  if (!isValidSuiObjectId(packageId)) {
    throw new Error(`invalid Seal package ID ${packageId}`);
  }
  const packageBytes = fromHex(packageId);
  const identityBytes = fromHex(identityHex);
  const fullId = new Uint8Array(packageBytes.length + identityBytes.length);
  fullId.set(packageBytes);
  fullId.set(identityBytes, packageBytes.length);
  return toHex(fullId);
}

function normalizeHex(value: string): HexString {
  return (value.startsWith("0x") ? value : `0x${value}`).toLowerCase() as HexString;
}

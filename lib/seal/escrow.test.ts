import { EncryptedObject, type SealClient, type SealCompatibleClient } from "@mysten/seal";
import { toBase64 } from "@mysten/sui/utils";
import { describe, expect, it, vi } from "vitest";

import type { SealEscrowV1 } from "../protocol/types";
import {
  parseSealIdentity,
  sealIdentityHex,
  sealInnerId,
} from "./identity";
import {
  createSealEscrowService,
  expectedFullIdHex,
  parseEscrowObject,
} from "./escrow";

const PACKAGE_ID = `0x${"11".repeat(32)}` as const;
const CLAIM_ID = `0x${"22".repeat(32)}` as const;
const JURY_SEAT_ID = `0x${"33".repeat(32)}` as const;
const KEY_SERVER_ID = `0x${"44".repeat(32)}` as const;
const RUN_ID = `0x${"55".repeat(32)}` as const;
const DEADLINE_MS = Date.parse("2026-08-30T13:52:07.000Z");
const utf8 = new TextEncoder();

function dummyEncryptedObject(
  identityHex: `0x${string}`,
): Uint8Array<ArrayBuffer> {
  const bytes = EncryptedObject.serialize({
    version: 0,
    packageId: PACKAGE_ID,
    id: sealInnerId(identityHex),
    services: [[KEY_SERVER_ID, 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96),
        encryptedShares: [new Uint8Array(32)],
        encryptedRandomness: new Uint8Array(32),
      },
    },
    ciphertext: {
      Aes256Gcm: {
        blob: new Uint8Array([1, 2, 3]),
        aad: utf8.encode(RUN_ID),
      },
    },
  }).toBytes();
  return new Uint8Array(bytes);
}

function escrowRecord(identityHex: `0x${string}`): SealEscrowV1 {
  return {
    version: 1,
    provider: "seal",
    packageId: PACKAGE_ID,
    identityHex,
    deadlineMs: DEADLINE_MS,
    threshold: 1,
    keyServers: [{ objectId: KEY_SERVER_ID, weight: 1 }],
    encryptedObjectBase64: toBase64(dummyEncryptedObject(identityHex)),
    aad: RUN_ID,
  };
}

describe("Seal escrow", () => {
  it("round trips the run identity stored in the escrow record", () => {
    const identityHex = sealIdentityHex({
      claimId: CLAIM_ID,
      jurySeatId: JURY_SEAT_ID,
      phase: 1,
      deadlineMs: DEADLINE_MS,
    });
    const escrow = escrowRecord(identityHex);

    expect(parseSealIdentity(escrow.identityHex)).toEqual({
      claimId: CLAIM_ID,
      jurySeatId: JURY_SEAT_ID,
      phase: 1,
      deadlineMs: DEADLINE_MS,
    });
    expect(expectedFullIdHex(PACKAGE_ID, identityHex)).toBe(
      `0x${PACKAGE_ID.slice(2)}${identityHex.slice(2)}`,
    );
  });

  it("parses and normalizes an SDK encrypted object", () => {
    const identityHex = sealIdentityHex({
      claimId: CLAIM_ID,
      jurySeatId: JURY_SEAT_ID,
      phase: 1,
      deadlineMs: DEADLINE_MS,
    });

    expect(parseEscrowObject(escrowRecord(identityHex))).toEqual({
      packageId: PACKAGE_ID,
      id: expectedFullIdHex(PACKAGE_ID, identityHex),
      threshold: 1,
      services: [{ objectId: KEY_SERVER_ID, shareIndex: 1 }],
    });
  });

  it("encrypts the reveal key through an injected Seal client", async () => {
    const identityHex = sealIdentityHex({
      claimId: CLAIM_ID,
      jurySeatId: JURY_SEAT_ID,
      phase: 2,
      deadlineMs: DEADLINE_MS,
    });
    const encryptedObject = dummyEncryptedObject(identityHex);
    const encrypt = vi.fn<SealClient["encrypt"]>(async () => ({
      encryptedObject,
      key: new Uint8Array(32),
    }));
    const keyBytes = new Uint8Array(32).fill(9);
    const service = createSealEscrowService({
      suiClient: {} as SealCompatibleClient,
      packageId: PACKAGE_ID,
      threshold: 1,
      keyServers: [{ objectId: KEY_SERVER_ID, weight: 1 }],
      client: { encrypt },
    });

    const escrow = await service.escrowKey({
      claimId: CLAIM_ID,
      jurySeatId: JURY_SEAT_ID,
      phase: 2,
      deadlineMs: DEADLINE_MS,
      runId: RUN_ID,
      keyBytes,
    });

    expect(encrypt).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenCalledWith({
      threshold: 1,
      packageId: PACKAGE_ID,
      id: sealInnerId(identityHex),
      data: keyBytes,
      aad: utf8.encode(RUN_ID),
    });
    expect(escrow).toEqual({
      version: 1,
      provider: "seal",
      packageId: PACKAGE_ID,
      identityHex,
      deadlineMs: DEADLINE_MS,
      threshold: 1,
      keyServers: [{ objectId: KEY_SERVER_ID, weight: 1 }],
      encryptedObjectBase64: toBase64(encryptedObject),
      aad: RUN_ID,
    });
    expect(service.policy).toEqual({
      packageId: PACKAGE_ID,
      threshold: 1,
      keyServers: [{ objectId: KEY_SERVER_ID, weight: 1 }],
    });
  });
});

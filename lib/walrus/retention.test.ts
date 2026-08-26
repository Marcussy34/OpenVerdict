import { describe, expect, it, vi } from "vitest";
import {
  WalrusRenewalError,
  evaluateWalrusRetention,
  parseWalrusStorageReference,
  renewWalrusRetention,
  serializeWalrusStorageReference,
  type WalrusRenewalAlert,
  type WalrusStorageReference,
} from "./retention";

const reference: WalrusStorageReference = {
  blobId: Buffer.alloc(32, 9).toString("base64url"),
  objectId: `0x${"1a".repeat(32)}`,
  endEpoch: 20,
};

describe("Walrus retention", () => {
  it("persists and restores blob ID, object ID, and end epoch", () => {
    const serialized = serializeWalrusStorageReference(reference);

    expect(JSON.parse(serialized)).toEqual(reference);
    expect(parseWalrusStorageReference(serialized)).toEqual(reference);
  });

  it("rejects malformed persisted references", () => {
    expect(() =>
      parseWalrusStorageReference(
        JSON.stringify({ ...reference, blobId: "../../evidence" }),
      ),
    ).toThrow(/blob ID/i);
    expect(() =>
      parseWalrusStorageReference(
        JSON.stringify({ ...reference, objectId: "not-an-object" }),
      ),
    ).toThrow(/object ID/i);
  });

  it.each([
    ["CURRENT", 10, 20],
    ["CURRENT", 10, 19],
    ["RENEWAL_DUE", 10, 25],
    ["EXPIRED", 20, 25],
    ["EXPIRED", 21, 25],
  ] as const)(
    "reports %s at current epoch %i with required epoch %i",
    (status, currentEpoch, requiredThroughEpoch) => {
      expect(
        evaluateWalrusRetention(reference, {
          currentEpoch,
          requiredThroughEpoch,
        }),
      ).toEqual({
        status,
        remainingEpochs: Math.max(0, reference.endEpoch - currentEpoch),
      });
    },
  );

  it("renews to the target epoch and preserves content/object identity", async () => {
    const renew = vi.fn(async () => ({
      endEpoch: 30,
      transactionDigest: "renewal-digest",
    }));
    const alert = vi.fn();

    const result = await renewWalrusRetention({
      reference,
      targetEndEpoch: 30,
      renew,
      onFailure: alert,
    });

    expect(renew).toHaveBeenCalledWith({
      blobId: reference.blobId,
      objectId: reference.objectId,
      targetEndEpoch: 30,
    });
    expect(result).toEqual({
      reference: { ...reference, endEpoch: 30 },
      transactionDigest: "renewal-digest",
    });
    expect(alert).not.toHaveBeenCalled();
  });

  it("emits an alert and throws a typed error when renewal fails", async () => {
    const alerts: WalrusRenewalAlert[] = [];
    const renew = vi.fn(async () => {
      throw new Error("transaction rejected");
    });

    await expect(
      renewWalrusRetention({
        reference,
        targetEndEpoch: 30,
        renew,
        onFailure: (alert) => {
          alerts.push(alert);
        },
      }),
    ).rejects.toBeInstanceOf(WalrusRenewalError);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      code: "WALRUS_RENEWAL_FAILED",
      blobId: reference.blobId,
      objectId: reference.objectId,
      previousEndEpoch: 20,
      targetEndEpoch: 30,
      detail: "renewal executor failed",
    });
    expect(Number.isFinite(alerts[0]!.occurredAt)).toBe(true);
  });

  it("alerts when the network reports an insufficient renewed epoch", async () => {
    const alert = vi.fn();

    await expect(
      renewWalrusRetention({
        reference,
        targetEndEpoch: 30,
        renew: async () => ({ endEpoch: 29 }),
        onFailure: alert,
      }),
    ).rejects.toBeInstanceOf(WalrusRenewalError);
    expect(alert).toHaveBeenCalledOnce();
  });
});

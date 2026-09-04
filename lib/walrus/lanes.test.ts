import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Signer } from "@mysten/sui/cryptography";
import { describe, expect, it, vi } from "vitest";
import { WriteLanes, isBalanceError, type WriteLaneSigner } from "./lanes";

function writers(count: number): WriteLaneSigner[] {
  return Array.from({ length: count }, () => {
    const keypair = Ed25519Keypair.generate();
    return { keypair, address: keypair.toSuiAddress() };
  });
}

/** A write that blocks until the test releases it, recording lane order. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe("WriteLanes", () => {
  it("runs one write per writer lane at the same time", async () => {
    const pool = writers(2);
    const lanes = new WriteLanes({
      writers: pool,
      operator: Ed25519Keypair.generate(),
    });
    const first = gate();
    const second = gate();
    const started: string[] = [];
    const run = (label: string, wait: Promise<void>) =>
      lanes.run(async (signer) => {
        started.push(`${label}:${signer.toSuiAddress()}`);
        await wait;
        return label;
      });

    const writes = [run("a", first.wait), run("b", second.wait)];
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Both are in flight, each on its own writer, never on the operator.
    expect(started).toHaveLength(2);
    expect(started.map((entry) => entry.split(":")[1])).toEqual(
      pool.map((writer) => writer.address),
    );
    first.open();
    second.open();
    await expect(Promise.all(writes)).resolves.toEqual(["a", "b"]);
  });

  it("queues a third write behind the shortest lane, not behind both", async () => {
    const pool = writers(2);
    const lanes = new WriteLanes({
      writers: pool,
      operator: Ed25519Keypair.generate(),
    });
    const gates = [gate(), gate(), gate()];
    const signedBy: string[] = [];
    const writes = gates.map((entry, index) =>
      lanes.run(async (signer) => {
        signedBy.push(signer.toSuiAddress());
        await entry.wait;
        return index;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The third waits for a lane; releasing the first lets it start there.
    expect(signedBy).toHaveLength(2);
    gates[0]?.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signedBy).toEqual([
      pool[0]?.address,
      pool[1]?.address,
      pool[0]?.address,
    ]);
    gates[1]?.open();
    gates[2]?.open();
    await expect(Promise.all(writes)).resolves.toEqual([0, 1, 2]);
  });

  it("keeps every write on the operator lane when no writer is configured", async () => {
    const operator = Ed25519Keypair.generate();
    const lanes = new WriteLanes({ writers: [], operator });
    const signers: string[] = [];

    await Promise.all([
      lanes.run(async (signer) => signers.push(signer.toSuiAddress())),
      lanes.run(async (signer) => signers.push(signer.toSuiAddress())),
    ]);

    expect(lanes.laneCount).toBe(0);
    expect(signers).toEqual([operator.toSuiAddress(), operator.toSuiAddress()]);
  });

  it("keeps every write on the operator lane while the writers are unfunded", async () => {
    const operator = Ed25519Keypair.generate();
    const isFunded = vi.fn(async () => false);
    const unusable = vi.fn();
    const lanes = new WriteLanes({
      writers: writers(2),
      operator,
      isFunded,
      onLaneUnusable: unusable,
    });
    // The startup probe has to settle before selection can skip the lanes.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const signer = await lanes.run(async (used) => used.toSuiAddress());

    expect(signer).toBe(operator.toSuiAddress());
    expect(lanes.usableAddresses()).toEqual([]);
    expect(isFunded).toHaveBeenCalledTimes(2);
    expect(unusable).toHaveBeenCalledTimes(2);
  });

  it("finishes a write that ran the writer dry on the operator lane", async () => {
    const operator = Ed25519Keypair.generate();
    const pool = writers(1);
    const lanes = new WriteLanes({ writers: pool, operator });
    const signers: string[] = [];

    const result = await lanes.run(async (signer) => {
      signers.push(signer.toSuiAddress());
      if (signer.toSuiAddress() !== operator.toSuiAddress()) {
        throw new Error("Insufficient balance of WAL for the requested storage");
      }
      return "written";
    });

    expect(result).toBe("written");
    expect(signers).toEqual([pool[0]?.address, operator.toSuiAddress()]);
    // The writer left the pool, so the next write goes straight to the operator.
    expect(lanes.usableAddresses()).toEqual([]);
  });

  it("never retries a write that failed for a reason other than money", async () => {
    const operator = Ed25519Keypair.generate();
    const pool = writers(1);
    const lanes = new WriteLanes({ writers: pool, operator });
    const failure = new Error("blob is already certified");
    const attempts: string[] = [];

    await expect(
      lanes.run(async (signer: Signer) => {
        attempts.push(signer.toSuiAddress());
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(attempts).toEqual([pool[0]?.address]);
    expect(lanes.usableAddresses()).toEqual([pool[0]?.address]);
  });

  it("keeps a lane whose balance probe could not be read", async () => {
    const operator = Ed25519Keypair.generate();
    const pool = writers(1);
    let probes = 0;
    const lanes = new WriteLanes({
      writers: pool,
      operator,
      isFunded: async () => {
        probes += 1;
        if (probes === 1) throw new Error("fullnode unavailable");
        return true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The unreadable probe sent that write to the operator but kept the lane.
    await expect(lanes.run(async (signer) => signer.toSuiAddress())).resolves.toBe(
      pool[0]?.address,
    );
    expect(lanes.usableAddresses()).toEqual([pool[0]?.address]);
  });
});

describe("isBalanceError", () => {
  it.each([
    "Insufficient balance of WAL",
    "No valid gas coins found for the transaction",
    "GasBalanceTooLow: address 0x1",
    "insufficient gas",
    // Percent-encoded, the way gRPC delivers validator rejections.
    "Insufficient%20balance%20of%20WAL",
  ])("recognizes %s", (message) => {
    expect(isBalanceError(new Error(message))).toBe(true);
  });

  it("follows the cause chain", () => {
    expect(
      isBalanceError(
        new Error("Walrus write failed", {
          cause: new Error("insufficient balance"),
        }),
      ),
    ).toBe(true);
  });

  it("leaves unrelated failures alone", () => {
    expect(isBalanceError(new Error("blob is already certified"))).toBe(false);
    expect(isBalanceError(undefined)).toBe(false);
  });
});

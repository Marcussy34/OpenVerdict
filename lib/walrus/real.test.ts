import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it, vi } from "vitest";
import { createRealWalrusStore } from "./real";
import type { WalrusStore } from "./store";

describe("createRealWalrusStore", () => {
  it("constructs the current Sui gRPC client extension without network I/O", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const store = requireWalrusStore(
        createRealWalrusStore({
          network: "testnet",
          baseUrl: "https://fullnode.testnet.sui.io:443",
          signer: Ed25519Keypair.generate(),
          epochs: 3,
          uploadRelay: {
            host: "https://upload-relay.testnet.walrus.space",
            sendTip: { max: 1_000 },
          },
        }),
      );

      expect(store).toMatchObject({
        put: expect.any(Function),
        get: expect.any(Function),
        renew: expect.any(Function),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects invalid construction settings before creating a client", () => {
    const baseConfig = {
      network: "testnet" as const,
      baseUrl: "https://fullnode.testnet.sui.io:443",
      signer: Ed25519Keypair.generate(),
      epochs: 3,
    };

    expect(() => createRealWalrusStore({ ...baseConfig, epochs: 0 })).toThrow(
      /epochs/i,
    );
    expect(() =>
      createRealWalrusStore({ ...baseConfig, baseUrl: "not a URL" }),
    ).toThrow(/baseUrl/i);
  });
});

function requireWalrusStore(store: WalrusStore): WalrusStore {
  return store;
}

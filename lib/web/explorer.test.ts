import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The explorer host is read once at module load, so every case re-imports
 * the module after stubbing NEXT_PUBLIC_SUI_NETWORK.
 */
async function loadExplorer(network: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUI_NETWORK", network);
  return import("./explorer");
}

const OBJECT_ID = "0x4020f3cbe51c1cdf6d004696e7cdf0d19f67fde2572b72a5f39a51d119f8ebab";
const ADDRESS = "0x74125f01aa8ba74d2fd1b465fa776d94ca921852f35c4e3053670d8114d79b89";
const DIGEST = "A2Xdg2aCjYnopx23TKzUseiWqJXLXF2LbW8mAh82AXvj";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sui explorer urls", () => {
  it("points testnet objects at SuiVision and testnet transactions at Suiscan", async () => {
    const { suiObjectUrl, suiAccountUrl, suiTransactionUrl } = await loadExplorer("testnet");

    expect(suiObjectUrl(OBJECT_ID)).toBe(`https://testnet.suivision.xyz/object/${OBJECT_ID}`);
    expect(suiAccountUrl(ADDRESS)).toBe(`https://testnet.suivision.xyz/account/${ADDRESS}`);
    // Suiscan keeps the network in the path and calls the page /tx.
    expect(suiTransactionUrl(DIGEST)).toBe(`https://suiscan.xyz/testnet/tx/${DIGEST}`);
  });

  it("points mainnet objects at the apex SuiVision host and transactions at Suiscan mainnet", async () => {
    const { suiObjectUrl, suiAccountUrl, suiTransactionUrl } = await loadExplorer("mainnet");

    expect(suiObjectUrl(OBJECT_ID)).toBe(`https://suivision.xyz/object/${OBJECT_ID}`);
    expect(suiAccountUrl(ADDRESS)).toBe(`https://suivision.xyz/account/${ADDRESS}`);
    expect(suiTransactionUrl(DIGEST)).toBe(`https://suiscan.xyz/mainnet/tx/${DIGEST}`);
  });

  it("falls back to testnet for any other network", async () => {
    const { suiObjectUrl, suiTransactionUrl } = await loadExplorer("localnet");

    expect(suiObjectUrl(OBJECT_ID)).toBe(`https://testnet.suivision.xyz/object/${OBJECT_ID}`);
    expect(suiTransactionUrl(DIGEST)).toBe(`https://suiscan.xyz/testnet/tx/${DIGEST}`);
  });

  it("escapes anything that is not a plain id", async () => {
    const { suiObjectUrl } = await loadExplorer("testnet");

    expect(suiObjectUrl("0xabc/../evil?x=1")).toBe(
      "https://testnet.suivision.xyz/object/0xabc%2F..%2Fevil%3Fx%3D1",
    );
  });
});

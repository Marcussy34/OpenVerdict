import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The explorer host is read once at module load, so every case re-imports
 * the module after stubbing NEXT_PUBLIC_SUI_NETWORK.
 */
async function loadChipLink(network: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUI_NETWORK", network);
  return import("./chip-link");
}

const OBJECT_ID = "0x4020f3cbe51c1cdf6d004696e7cdf0d19f67fde2572b72a5f39a51d119f8ebab";
const ADDRESS = "0x74125f01aa8ba74d2fd1b465fa776d94ca921852f35c4e3053670d8114d79b89";
const DIGEST = "A2Xdg2aCjYnopx23TKzUseiWqJXLXF2LbW8mAh82AXvj";
const BLOB_ID = "kA9bFZ4wSg1kQ0PmYbLrJt2VuXNCe6dHsPq3RwT8yZk";
const HASH = "0x8f14e45fceea167a5a36dedd4bea2543b0c1f2b3d4e5f60718293a4b5c6d7e8f";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("chipHref", () => {
  it("sends objects, accounts and transactions to SuiVision", async () => {
    const { chipHref } = await loadChipLink("testnet");

    expect(chipHref("object", OBJECT_ID)).toBe(
      `https://testnet.suivision.xyz/object/${OBJECT_ID}`,
    );
    expect(chipHref("account", ADDRESS)).toBe(
      `https://testnet.suivision.xyz/account/${ADDRESS}`,
    );
    expect(chipHref("tx", DIGEST)).toBe(`https://testnet.suivision.xyz/txblock/${DIGEST}`);
  });

  it("sends a blob to the Walrus aggregator for the configured network", async () => {
    const { chipHref } = await loadChipLink("testnet");

    expect(chipHref("blob", BLOB_ID)).toBe(
      `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${BLOB_ID}`,
    );
  });

  it("leaves a blob copy-only when no public network is configured", async () => {
    const { chipHref } = await loadChipLink("localnet");

    expect(chipHref("blob", BLOB_ID)).toBeNull();
    // Sui still resolves on localnet: the testnet explorer is the fallback.
    expect(chipHref("object", OBJECT_ID)).toBe(
      `https://testnet.suivision.xyz/object/${OBJECT_ID}`,
    );
  });

  it("never links a hash, an id or an unclassified chip", async () => {
    const { chipHref } = await loadChipLink("mainnet");

    expect(chipHref("hash", HASH)).toBeNull();
    expect(chipHref("id", "req_01JAV3")).toBeNull();
    expect(chipHref(undefined, OBJECT_ID)).toBeNull();
  });
});

describe("chipExplorer", () => {
  it("names the destination of every linking kind", async () => {
    const { chipExplorer } = await loadChipLink("testnet");

    expect(chipExplorer("object")).toBe("SuiVision");
    expect(chipExplorer("account")).toBe("SuiVision");
    expect(chipExplorer("tx")).toBe("SuiVision");
    expect(chipExplorer("blob")).toBe("Walrus");
    expect(chipExplorer("hash")).toBeNull();
    expect(chipExplorer("id")).toBeNull();
  });
});

describe("chipTitle", () => {
  it("says where a linked chip goes", async () => {
    const { chipTitle } = await loadChipLink("testnet");

    expect(chipTitle({ value: OBJECT_ID, kind: "object", linked: true })).toBe(
      `${OBJECT_ID} (Open on SuiVision; copy icon copies)`,
    );
    expect(chipTitle({ value: BLOB_ID, label: "manifest", kind: "blob", linked: true })).toBe(
      `manifest: ${BLOB_ID} (Open on Walrus; copy icon copies)`,
    );
  });

  it("names no explorer for an internal link", async () => {
    const { chipTitle } = await loadChipLink("testnet");

    expect(chipTitle({ value: HASH, kind: undefined, linked: true })).toBe(
      `${HASH} (opens the linked page; copy icon copies)`,
    );
  });

  it("says a hash is a hash, not a link", async () => {
    const { chipTitle } = await loadChipLink("testnet");

    expect(chipTitle({ value: HASH, kind: "hash", linked: false })).toBe(
      `${HASH} (hash, not a link: copy)`,
    );
  });

  it("falls back to plain copy wording for ids", async () => {
    const { chipTitle } = await loadChipLink("testnet");

    expect(chipTitle({ value: "req_01JAV3", label: "gonka", kind: "id", linked: false })).toBe(
      "gonka: req_01JAV3 (click to copy)",
    );
  });
});

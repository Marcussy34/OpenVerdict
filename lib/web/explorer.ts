/**
 * Public explorer URLs for on-chain and storage artifacts. One home for
 * these so every hash chip in the app links to the same destinations.
 */

// SuiVision puts the network in the host rather than the path, and its
// transaction page is /txblock, not /tx.
const SUIVISION =
  process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet"
    ? "https://suivision.xyz"
    : "https://testnet.suivision.xyz";

export function suiObjectUrl(id: string): string {
  return `${SUIVISION}/object/${encodeURIComponent(id)}`;
}

export function suiAccountUrl(address: string): string {
  return `${SUIVISION}/account/${encodeURIComponent(address)}`;
}

export function suiTransactionUrl(digest: string): string {
  return `${SUIVISION}/txblock/${encodeURIComponent(digest)}`;
}

/** Walrus aggregator URL for a blob id; null when no public network is set. */
export function walrusBlobUrl(blobId: string): string | null {
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK;
  if (network === "testnet") {
    return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${encodeURIComponent(blobId)}`;
  }
  if (network === "mainnet") {
    return `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${encodeURIComponent(blobId)}`;
  }
  return null;
}

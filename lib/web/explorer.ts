/**
 * Public explorer URLs for on-chain and storage artifacts. One home for
 * these so every hash chip in the app links to the same destinations.
 */

const SUI_NETWORK =
  process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet" ? "mainnet" : "testnet";

export function suiObjectUrl(id: string): string {
  return `https://suiscan.xyz/${SUI_NETWORK}/object/${encodeURIComponent(id)}`;
}

export function suiAccountUrl(address: string): string {
  return `https://suiscan.xyz/${SUI_NETWORK}/account/${encodeURIComponent(address)}`;
}

export function suiTransactionUrl(digest: string): string {
  return `https://suiscan.xyz/${SUI_NETWORK}/tx/${encodeURIComponent(digest)}`;
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

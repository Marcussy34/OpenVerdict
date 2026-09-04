/**
 * What a chip's value actually is, and where a click on it should go.
 * One place for the mapping so every chip in the app agrees: a Sui object,
 * account or transaction opens on SuiVision, a Walrus blob opens on the
 * aggregator, and a hash or a bare id never pretends to be a link.
 */

import { suiAccountUrl, suiObjectUrl, suiTransactionUrl, walrusBlobUrl } from "./explorer";

export type ChipKind =
  /** A Sui object id: claim, committee, certificate, agent profile, seat, registry, package, Seal policy. */
  | "object"
  /** A Sui address: owner, staker, operational key. */
  | "account"
  /** A Sui transaction digest. */
  | "tx"
  /** A Walrus blob id. */
  | "blob"
  /** A blake2b or Merkle value: manifest, prompt, run, output hash, evidence root, commitment. */
  | "hash"
  /** Anything else that is only an identifier: gateway request id, devshard id, evidence id. */
  | "id";

/**
 * Explorer URL for a chip value, or null when the kind never links.
 * Walrus returns null when no public network is configured, so a blob chip
 * falls back to copy-only rather than pointing at nothing.
 */
export function chipHref(kind: ChipKind | undefined, value: string): string | null {
  switch (kind) {
    case "object":
      return suiObjectUrl(value);
    case "account":
      return suiAccountUrl(value);
    case "tx":
      return suiTransactionUrl(value);
    case "blob":
      return walrusBlobUrl(value);
    default:
      // hash, id and unclassified chips copy, they never link.
      return null;
  }
}

/** Where a linked chip goes, named for the title attribute. */
export function chipExplorer(kind: ChipKind | undefined): string | null {
  if (kind === "object" || kind === "account" || kind === "tx") return "SuiVision";
  if (kind === "blob") return "Walrus";
  return null;
}

/**
 * The chip's hover title: the value, plus what happens on click. A hash says
 * it is a hash so nobody waits for a page that will never open.
 */
export function chipTitle({
  value,
  label,
  kind,
  linked,
}: {
  value: string;
  label?: string | undefined;
  kind?: ChipKind | undefined;
  linked: boolean;
}): string {
  const prefix = label ? `${label}: ` : "";
  if (linked) {
    const explorer = chipExplorer(kind);
    // An internal page (a run proof, an agent) has no explorer to name.
    const destination = explorer === null ? "opens the linked page" : `Open on ${explorer}`;
    return `${prefix}${value} (${destination}; copy icon copies)`;
  }
  if (kind === "hash") return `${prefix}${value} (hash, not a link: copy)`;
  return `${prefix}${value} (click to copy)`;
}

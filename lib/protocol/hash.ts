import { blake2b } from "@noble/hashes/blake2.js";

/**
 * Sui's `sui::hash::blake2b256` — BLAKE2b with a 32-byte digest.
 * Single shared implementation so every layer (protocol, evidence, engine)
 * hashes identically to Move.
 */
export function blake2b256(bytes: Uint8Array): Uint8Array {
  return blake2b(bytes, { dkLen: 32 });
}

/** Lowercase hex with 0x prefix — canonical display form for hashes. */
export function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}`;
}

/** Parse 0x-prefixed (or bare) hex into bytes. Throws on odd length / bad chars. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`invalid hex: ${hex.slice(0, 16)}…`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

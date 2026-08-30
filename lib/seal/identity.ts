import { bcs } from "@mysten/sui/bcs";
import { fromHex, toHex } from "../protocol/hash";
import type { HexString } from "../protocol/types";

/**
 * Seal escrow identity for one juror run: the inner id bytes that follow the
 * policy package id in Seal's full identity (`createFullId` in @mysten/seal).
 *
 * Layout, byte for byte what `openverdict_seal::reveal_lock::seal_approve`
 * peels with `sui::bcs`: claim id (address, 32 bytes), jury seat id
 * (address, 32 bytes), phase (u8), reveal deadline in ms (u64, little
 * endian). The claim and seat ids make the identity unique per run; only the
 * deadline is enforced on chain, the verifier binds the rest to the run.
 */
export type SealIdentity = {
  claimId: HexString;
  jurySeatId: HexString;
  phase: 1 | 2;
  deadlineMs: number;
};

const SealIdentityBcs = bcs.struct("SealIdentity", {
  claimId: bcs.Address,
  jurySeatId: bcs.Address,
  phase: bcs.u8(),
  deadlineMs: bcs.u64(),
});

/** Encode the identity as 0x-prefixed hex (73 bytes). */
export function sealIdentityHex(identity: SealIdentity): HexString {
  if (identity.phase !== 1 && identity.phase !== 2) {
    throw new Error("seal identity phase must be 1 or 2");
  }
  if (!Number.isSafeInteger(identity.deadlineMs) || identity.deadlineMs < 0) {
    throw new Error("seal identity deadline must be a non-negative integer");
  }
  return toHex(
    SealIdentityBcs.serialize({
      claimId: identity.claimId,
      jurySeatId: identity.jurySeatId,
      phase: identity.phase,
      deadlineMs: BigInt(identity.deadlineMs),
    }).toBytes(),
  );
}

/** Decode an identity; throws on any malformed or trailing bytes. */
export function parseSealIdentity(identityHex: string): SealIdentity {
  const bytes = fromHex(identityHex);
  if (bytes.length !== 32 + 32 + 1 + 8) {
    throw new Error(`seal identity must be 73 bytes, got ${bytes.length}`);
  }
  const parsed = SealIdentityBcs.parse(bytes);
  const phase = Number(parsed.phase);
  if (phase !== 1 && phase !== 2) {
    throw new Error(`seal identity phase must be 1 or 2, got ${phase}`);
  }
  const deadlineMs = Number(BigInt(parsed.deadlineMs));
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new Error("seal identity deadline does not fit a safe integer");
  }
  return {
    claimId: normalizeHex(parsed.claimId),
    jurySeatId: normalizeHex(parsed.jurySeatId),
    phase,
    deadlineMs,
  };
}

/** The SDK wants the inner id as hex without the 0x prefix. */
export function sealInnerId(identityHex: HexString): string {
  return identityHex.startsWith("0x") ? identityHex.slice(2) : identityHex;
}

function normalizeHex(value: string): HexString {
  return (value.startsWith("0x") ? value : `0x${value}`).toLowerCase() as HexString;
}

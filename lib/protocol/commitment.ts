import { RunRecordV1Bcs, VotePreimageV1Bcs } from "./bcs";
import { blake2b256 } from "./hash";
import type { RunRecordV1, VotePreimageV1 } from "./types";

/** Compute the exact commitment checked by the Move reveal function. */
export function computeVoteCommitment(preimage: VotePreimageV1): Uint8Array {
  return blake2b256(VotePreimageV1Bcs.serialize(preimage).toBytes());
}

/** Bind all canonical run fields into the approved run hash. */
export function computeRunHash(runRecord: RunRecordV1): Uint8Array {
  return blake2b256(RunRecordV1Bcs.serialize(runRecord).toBytes());
}

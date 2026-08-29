/**
 * Walrus and Sui count epochs on different clocks (testnet: both ~24 h;
 * mainnet: Walrus 14 days, Sui 24 h) and from different origins, but the Move
 * contract compares a retention epoch with `ctx.epoch()`, the SUI epoch
 * (evidence.move new_evidence_bundle, jury.move approve_run and reveal_vote,
 * E_RETENTION_EXPIRED). So the chain must receive the Sui epoch at which the
 * Walrus retention ends, never the raw Walrus end epoch.
 */
export type RetentionEpochInput = {
  /** Walrus epoch until which the blob is stored (from writeBlob). */
  walrusEndEpoch: number;
  walrusCurrentEpoch: number;
  walrusEpochDurationMs: number;
  suiCurrentEpoch: number;
  suiEpochDurationMs: number;
  /** Floor on how far ahead of the current Sui epoch the answer must be. */
  minimumEpochsAhead?: number;
};

function assertEpoch(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function assertDuration(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

/** Sui epoch at which a Walrus retention ends, never earlier than the next Sui epoch. */
export function toChainRetentionEpoch(input: RetentionEpochInput): number {
  assertEpoch(input.walrusEndEpoch, "walrusEndEpoch");
  assertEpoch(input.walrusCurrentEpoch, "walrusCurrentEpoch");
  assertEpoch(input.suiCurrentEpoch, "suiCurrentEpoch");
  assertDuration(input.walrusEpochDurationMs, "walrusEpochDurationMs");
  assertDuration(input.suiEpochDurationMs, "suiEpochDurationMs");
  const minimumAhead = input.minimumEpochsAhead ?? 1;
  assertEpoch(minimumAhead, "minimumEpochsAhead");

  const walrusEpochsLeft = Math.max(0, input.walrusEndEpoch - input.walrusCurrentEpoch);
  const suiEpochsLeft = Math.ceil(
    (walrusEpochsLeft * input.walrusEpochDurationMs) / input.suiEpochDurationMs,
  );
  return input.suiCurrentEpoch + Math.max(minimumAhead, suiEpochsLeft);
}

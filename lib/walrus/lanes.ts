import type { Signer } from "@mysten/sui/cryptography";
import { runOnOperatorLane } from "../sui/operator-lane";

/** A keypair allowed to sign Walrus register and certify transactions. */
export interface WriteLaneSigner {
  keypair: Signer;
  address: string;
}

export interface WriteLanesConfig {
  /** Writer keys. Empty keeps every write on the operator lane, as before. */
  writers: readonly WriteLaneSigner[];
  /** Signs the fallback lane; also every protocol transaction elsewhere. */
  operator: Signer;
  /** True while this writer still holds enough SUI and WAL to pay for a write. */
  isFunded?: (address: string) => Promise<boolean>;
  /** Told when a lane leaves the pool, so a host can log it once. */
  onLaneUnusable?: (address: string, reason: string) => void;
}

interface Lane {
  writer: WriteLaneSigner;
  /** Writes queued on this lane right now; the pool picks the shortest queue. */
  queued: number;
  tail: Promise<void>;
  /** Memoized balance probe; cleared when the writer runs dry mid-write. */
  probe?: Promise<boolean>;
  /** Last probe result, so selection skips a broke writer without awaiting. */
  usable: boolean;
}

// A writer that cannot pay for its own register or certify transaction. Sui
// and the Walrus SDK phrase it several ways; all of them mean the same thing,
// so the write belongs on the operator lane instead.
const BALANCE_ERROR_PATTERN =
  /insufficient (?:balance|funds|gas|coin)|balance of wal|no valid gas coins|gas balance too low|unable to select gas|no coins of type|insufficientcoinbalance|insufficientgas|gasbalancetoolow/i;

/** Whether an error (or any of its causes) says the signer ran out of coins. */
export function isBalanceError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const raw =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    // gRPC status messages arrive percent-encoded; decode before matching.
    let text = raw;
    try {
      text = decodeURIComponent(raw);
    } catch {
      text = raw;
    }
    if (BALANCE_ERROR_PATTERN.test(text)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * One promise chain per Walrus writer key, so five sealed uploads run K wide
 * instead of queueing behind each other on the operator's single gas and WAL
 * coins. Each writer signs its own register and certify transactions; the
 * operator lane keeps only protocol transactions, and stays the fallback for
 * an empty pool or a writer that cannot pay.
 */
export class WriteLanes {
  readonly #lanes: Lane[];
  readonly #operator: Signer;
  readonly #isFunded: (address: string) => Promise<boolean>;
  readonly #onLaneUnusable: (address: string, reason: string) => void;

  constructor(config: WriteLanesConfig) {
    this.#operator = config.operator;
    this.#isFunded = config.isFunded ?? (async () => true);
    this.#onLaneUnusable = config.onLaneUnusable ?? ((): void => undefined);
    this.#lanes = config.writers.map((writer) => ({
      writer,
      queued: 0,
      tail: Promise.resolve(),
      usable: true,
    }));
    // Probe balances at startup so the first burst already knows which lanes
    // can pay; a probe that fails only defers that lane to its first write.
    for (const lane of this.#lanes) void this.#funded(lane);
  }

  /** How many writer lanes exist (0 means every write uses the operator). */
  get laneCount(): number {
    return this.#lanes.length;
  }

  /** Addresses still believed able to pay; a host may report them once. */
  usableAddresses(): string[] {
    return this.#lanes.filter((lane) => lane.usable).map((lane) => lane.writer.address);
  }

  /** Run one Walrus write on the least busy usable lane. */
  async run<T>(write: (signer: Signer) => Promise<T>): Promise<T> {
    const lane = this.#pick();
    if (lane === undefined) return this.#onOperator(write);
    lane.queued += 1;
    const attempt = lane.tail.then(() => this.#onLane(lane, write));
    // The chain must survive a failed write and never leave it unhandled.
    lane.tail = attempt.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await attempt;
    } finally {
      lane.queued -= 1;
    }
  }

  async #onLane<T>(lane: Lane, write: (signer: Signer) => Promise<T>): Promise<T> {
    if (!(await this.#funded(lane))) return this.#onOperator(write);
    try {
      return await write(lane.writer.keypair);
    } catch (error) {
      if (!isBalanceError(error)) throw error;
      // The writer ran dry mid-write: re-probe it before its next turn and
      // finish this write on the operator lane, exactly as before the pool.
      lane.probe = undefined;
      lane.usable = false;
      this.#onLaneUnusable(lane.writer.address, "ran out of SUI or WAL");
      return this.#onOperator(write);
    }
  }

  #onOperator<T>(write: (signer: Signer) => Promise<T>): Promise<T> {
    return runOnOperatorLane(() => write(this.#operator));
  }

  /** The usable lane with the fewest queued writes, or none when all are broke. */
  #pick(): Lane | undefined {
    let best: Lane | undefined;
    for (const lane of this.#lanes) {
      if (!lane.usable) continue;
      if (best === undefined || lane.queued < best.queued) best = lane;
    }
    return best;
  }

  #funded(lane: Lane): Promise<boolean> {
    lane.probe ??= this.#isFunded(lane.writer.address)
      .then((funded) => {
        lane.usable = funded;
        if (!funded) {
          this.#onLaneUnusable(lane.writer.address, "below the SUI or WAL floor");
        }
        return funded;
      })
      .catch(() => {
        // A probe that could not read balances says nothing about the writer:
        // retry it on the next write rather than losing the lane for good.
        lane.probe = undefined;
        return false;
      });
    return lane.probe;
  }
}

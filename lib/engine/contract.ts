import type {
  AgentBackingKind,
  AgentManifestDocument,
  GatewayResponseMeta,
  HexString,
  InferenceFailureV1,
  InferenceRunAudit,
  OracleInferenceOutput,
  PublicRunBundle,
  SealEscrowV1,
  SealedRunBundleV2,
} from "../protocol/types";
import type { ClaimMode, ClaimState, VoteOutcome } from "../protocol/constants";

/**
 * Orchestrator-owned seam between the engine (workers/CLI/API) and every
 * consumer. lib/engine implements it; app/api and the CLI depend only on the
 * types in this file plus `getServerEngine()` from lib/engine/server.
 * All DTOs are JSON-serializable: ids/hashes as 0x-hex or base64url strings.
 */

// ---------------------------------------------------------------------------
// Resolution events (PRD §29.12)
// ---------------------------------------------------------------------------

export type ResolutionEventSource =
  | "ENGINE"
  | "GONKA_ROUTER"
  | "TOOL"
  | "EVIDENCE"
  | "SUI";

export type ResolutionEventVisibility =
  | "PUBLIC_NOW"
  | "PUBLIC_AFTER_REVEAL"
  | "INTERNAL_REDACTED";

export type ResolutionEvent = {
  eventId: string;
  claimId: string;
  sequence: number;
  phase: string;
  kind: string;
  source: ResolutionEventSource;
  visibility: ResolutionEventVisibility;
  actorId?: string;
  runId?: string;
  occurredAt: string;
  publishedAt?: string;
  transactionDigest?: string;
  checkpoint?: number;
  artifactHash?: `0x${string}`;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type FactCheckRequest = {
  /** Bounded claim statement. */
  claim: string;
  /** Optional pasted explanatory text (stored as evidence). */
  text?: string;
  /** Zero or more public https URLs submitted as evidence. */
  urls: string[];
  /** Resolution criteria; a deterministic default is derived when omitted. */
  resolutionCriteria?: string;
  /** Optional explicit deadlines (canary/operator use); network defaults otherwise. */
  deadlines?: ClaimCreateRequest["deadlines"];
};

export type ClaimCreateRequest = {
  statement: string;
  resolutionCriteria: string;
  mode: ClaimMode;
  /** Millisecond epoch deadlines, strictly increasing per PRD §16.1. */
  deadlines: {
    evidenceCutoffMs: number;
    proposalDeadlineMs: number;
    challengeDeadlineMs: number;
    firstCommitDeadlineMs: number;
    firstRevealDeadlineMs: number;
    discussionDeadlineMs: number;
    secondCommitDeadlineMs: number;
    secondRevealDeadlineMs: number;
  };
  /** Budget amounts in the settlement coin's smallest unit, as decimal strings. */
  committeeBudget: string;
  evidenceBudget: string;
};

export type ChallengeReason = {
  reason: string;
  evidenceUrls: string[];
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TxResult = {
  digest: string;
  checkpoint?: number;
  /** Object ids created or mutated that consumers may need to follow. */
  objectIds?: Record<string, string>;
};

export type AgentRunSummary = {
  runId: string;
  agentProfileId: string;
  modelId: string;
  gonkaRequestId: string;
  status: InferenceRunAudit["status"];
  attempt: number;
  latencyMs: number;
  /** Present only after a valid reveal or for engine-internal callers. */
  output?: OracleInferenceOutput;
};

export type JuryRunReport = {
  claimId: string;
  phase: 1 | 2;
  runs: AgentRunSummary[];
};

export type RunProof = {
  runId: string;
  claimId: string;
  phase: 1 | 2;
  agentProfileId: string;
  jurySeatId: string;
  promptHash: HexString;
  inputHash: HexString;
  outputHash: HexString;
  runHash: HexString;
  gateway: GatewayResponseMeta;
  sealedBlobId: string | null;
  sealed: SealedRunBundleV2 | null;
  revealedBlobId: string | null;
  revealed: boolean;
  bundle: PublicRunBundle | null;
  failure?: InferenceFailureV1;
  claimDeadlines?: {
    firstRevealDeadlineMs: number;
    secondRevealDeadlineMs: number;
  };
  sealPolicy?: {
    packageId: HexString;
    threshold: number;
    keyServers: SealEscrowV1["keyServers"];
  };
};

export type FailedRunProof = Omit<
  RunProof,
  | "runHash"
  | "sealedBlobId"
  | "sealed"
  | "revealedBlobId"
  | "revealed"
  | "bundle"
  | "failure"
> & {
  runHash: null;
  sealedBlobId: null;
  sealed: null;
  revealedBlobId: null;
  revealed: false;
  bundle: null;
  failure: InferenceFailureV1;
};

export type RunProofResult = RunProof | FailedRunProof;

export type FinalizeReport = {
  claimId: string;
  result: "YES" | "NO" | "UNSURE" | "UNRESOLVED";
  truthScoreBps: number | null;
  certificateId: string;
  digest: string;
};

export type CommitmentStatus = {
  jurySeatId: string;
  agentProfileId: string;
  /** The seat's model, from the agent's registered manifest; resolves juror
      identity even for seats that failed before any inference completed. */
  modelId?: string;
  committed: boolean;
  revealed: boolean;
  outcome?: VoteOutcome;
  confidenceBps?: number;
  /** Set when the seat failed before committing (status of its failure record). */
  failureStatus?: string;
};

export type RoundReadinessStatus = {
  phase: 1 | 2;
  expectedJurySeatIds: string[];
  committedJurySeatIds: string[];
  revealedJurySeatIds: string[];
};

/** Attempt states let later engine work expose one verification chain. */
/** Relaunch context: which verification and attempt a new claim continues. */
export type VerificationRelaunchContext = {
  verificationId: string;
  attempt: 2 | 3;
  parentClaimId: string;
};

export type AttemptChainStatus = "ACTIVE" | "VOIDED" | "SETTLED" | "GAVE_UP";

/** Public links and failures across at most three verification attempts. */
export type AttemptChain = {
  verificationId: string;
  attempt: 1 | 2 | 3;
  maxAttempts: 3;
  status: AttemptChainStatus;
  void?: {
    seatId?: string;
    modelId?: string;
    phase?: 1 | 2;
    reason: string;
    message?: string;
    atMs: number;
  };
  relaunchedAs?: string;
  gaveUpReason?: string;
  previousAttempts: Array<{
    claimId: string;
    attempt: 1 | 2 | 3;
    status: AttemptChainStatus;
    voidReason?: string;
  }>;
};

export type ClaimInspection = {
  claimId: string;
  mode: ClaimMode;
  state: ClaimState;
  statement: string;
  resolutionCriteria: string;
  deadlines: ClaimCreateRequest["deadlines"];
  proposedOutcome?: "YES" | "NO" | "UNSURE";
  committeeId?: string;
  evidenceRoots: { phase: 1 | 2; root: `0x${string}`; bundleId: string }[];
  commitments: CommitmentStatus[];
  /** Local records used only to avoid submitting a known-early chain call. */
  rounds?: RoundReadinessStatus[];
  /** Public deliberation turns: revealed round-1 jurors arguing the split
   * between reveal 1 and round 2, in ordinal order. */
  deliberation?: DeliberationTurnPublic[];
  attemptChain?: AttemptChain;
  debateConvergedAfterExchange?: 1 | 2 | 3;
  result?: FinalizeReport;
  /** Populated when inspect() is called with { verify: true }. */
  verification?: {
    commitmentsRecomputed: boolean;
    truthScoreRecomputed: boolean;
    evidenceRootsRecomputed: boolean;
    issues: string[];
  };
};

/** One public deliberation turn: a revealed round-1 juror arguing its case
 * between reveal 1 and round 2. Emitted live as a PUBLIC_NOW event and
 * frozen into the phase-2 evidence as a hashed transcript artifact. */
export type DeliberationTurnPublic = {
  claimId: string;
  jurySeatId: string;
  agentProfileId: string;
  modelId?: string;
  /** 0-based order across the whole debate. */
  ordinal: number;
  /** Three exchanges allow the debate to stop after nobody moves. */
  exchange: 1 | 2 | 3;
  stance?: "YES" | "NO" | "UNSURE";
  confidenceBps?: number;
  /** Which deliberation prompt spec ran this turn; absent on V1 to V3 turns. */
  specVersion?: "4";
  /** V4 conversation fields, all absent on V1 to V3 turns. `argument` stays
   * the composed analysis plus position, so older readers need no change. */
  answering?: number | null;
  theirPoint?: string;
  analysis?: string;
  question?: { seat: number; text: string };
  position?: string;
  /** Bounded plain-text argument (no markdown), at most 1200 chars. */
  argument: string;
  /** Evidence ids from the phase-1 manifest or URLs from this juror's own
   * revealed transcript; engine-validated, fail-closed per turn. */
  citations: string[];
  status: "SPOKEN" | "SKIPPED";
  /** Failure label when status is SKIPPED (argument is empty then). */
  failureStatus?: string;
  atMs: number;
};

export type AgentCard = {
  agentProfileId: string;
  owner: string;
  modelId: string;
  role: string;
  outcome: "YES" | "NO" | "UNSURE";
  confidenceBps: number;
  gonkaRequestId: string;
  evidenceIds: string[];
  reasoning: string;
  publicReasoningTrace: OracleInferenceOutput["publicReasoningTrace"];
};

/** Public fact-check report per PRD §26.9, in display order. */
export type FactCheckReport = {
  claimId: string;
  statement: string;
  submittedUrls: string[];
  label: "YES" | "NO" | "UNSURE" | "UNRESOLVED" | "PENDING";
  truthScore: number | null;
  truthScoreFormula: string;
  finalRoundVotes: {
    jurySeatId: string;
    outcome: "YES" | "NO" | "UNSURE";
    confidenceBps: number;
    /** Only valid reveals (matching their commitment) enter the truth score. */
    valid: boolean;
  }[];
  agents: AgentCard[];
  evidence: {
    evidenceId: string;
    sourceUrl: string;
    blobId: string;
    contentHash: `0x${string}`;
  }[];
  evidenceRoot?: `0x${string}`;
  sui: {
    claimObjectId: string;
    committeeId?: string;
    certificateId?: string;
    revealedVoteIds: string[];
  };
  /** Complete machine-readable audit bundle (identifiers + hashes). */
  auditBundle: Record<string, unknown>;
};

export type EngineStatus = {
  appVersion: string;
  network: string;
  packageId: string;
  registryObjectId: string;
  suiHealthy: boolean;
  latestCheckpoint?: number;
  gonkaMode: "fake" | "live";
  walrusMode: "local" | "testnet" | "mainnet";
  dbHealthy: boolean;
  paused: boolean;
};

/**
 * Off-chain signal from AgentManifest.humanVerificationProvider, written by
 * the engine at registration time. It is currently reliable because the engine
 * controls every registration path. Move stores only a caller-supplied opaque
 * human_backing_hash (the staker hash) and does not verify this kind, so a
 * future unmapped path fails closed to UNKNOWN.
 */
export type AgentBackingStatus = {
  kind: "ZKLOGIN" | "WALLET" | "ALLOWLIST" | "UNKNOWN";
  label?: string;
};

export type AgentTrackRecord = {
  seatsServed: number;
  committed: number;
  revealed: number;
  agreedWithCertificate: number;
};

export type AgentDirectoryEntry = {
  agentProfileId: string;
  owner: string;
  modelId: string;
  role: string;
  manifestHash: `0x${string}`;
  active: boolean;
  reputation: Record<string, number>;
  /** Engine-recorded off-chain backing signal. See AgentBackingStatus. */
  backing: AgentBackingStatus;
  trackRecord: AgentTrackRecord;
  /** Account that posted this seat's bond; absent on seats the operator posted. */
  staker?: string;
  /** Decimal-string MIST the staker posted as the bond. */
  stakeMist?: string;
  /**
   * Decimal-string BigInt sum of u64 mist in payout_tickets for reason 2
   * (settlement.move REASON_JURY_REWARD) whose recipient matches this seat's
   * owner or its staker, case-insensitively. Tickets count when awarded on
   * chain, whether withdrawn or not, so this is lifetime jury rewards and not
   * a live wallet balance.
   */
  earnedMist: string;
};

// ---------------------------------------------------------------------------
// Engine interface (plan contract C5)
// ---------------------------------------------------------------------------

/**
 * Wallet-signed stake on a juror seat: the staking account signs the canonical
 * stake message, and the engine records blake2b-256 of its address as the
 * staker hash. Any account may stake on as many seats as it likes; the Move
 * draw caps seats per model, family and operational key and needs a Skeptic
 * and a Source-authenticity seat, with no cap per staker: a diversity rule,
 * never an identity claim. Staking economics only.
 */
export type ZkBackedRegistrationRequest = {
  /** The staking account's address (zkLogin or any wallet). */
  zkLoginAddress: string;
  /** Base64 personal-message signature over the canonical stake message. */
  signature: string;
  /** Model id from the release manifest catalog. */
  modelId: string;
  /**
   * Role label, e.g. SKEPTIC / SOURCE_AUTHENTICITY. Optional: the engine
   * assigns the least represented role on this model when none is named.
   */
  role?: string;
};

/** Stake kinds a signed registration can produce; the demo allowlist is seeded. */
export type StakedAgentBackingKind = Exclude<
  AgentBackingKind,
  "TESTNET_DEMO_ALLOWLIST"
>;

export type ZkBackedRegistrationResult = {
  agentProfileId: string;
  humanBackingHash: `0x${string}`;
  backingKind: StakedAgentBackingKind;
  digest: string;
  /** The role recorded for the seat: the caller's, or the engine's assignment. */
  role: string;
};

/**
 * Real stake, step one. The engine reserves a signing slot, writes the seat's
 * manifest document to Walrus, and hands back everything the staker's wallet
 * needs to build the one transaction that posts the bond. The reservation
 * expires, so an abandoned prepare returns its slot to the pool.
 */
export type StakePreparationRequest = {
  /** Canonical lowercase 32-byte Sui address of the staking account. */
  stakerAddress: string;
  /** Model id from the release manifest catalog. */
  modelId: string;
  /**
   * Role label, e.g. SKEPTIC / SOURCE_AUTHENTICITY / INVESTIGATOR. Optional:
   * the engine assigns the least represented role on this model when none is
   * named, so the browser card sends nothing here.
   */
  role?: string;
};

export type StakePreparation = {
  reservationId: string;
  expiresAt: string;
  /** The seat's debate role: the one the caller named, or the engine's pick. */
  role: string;
  target: {
    packageId: string;
    registryObjectId: string;
    clockObjectId: string;
  };
  /** register_staked_agent arguments, in the order the entry function takes them. */
  args: {
    manifestHash: HexString;
    manifestBlobId: string;
    modelHash: HexString;
    roleHash: HexString;
    stakerHash: HexString;
    operationalOwner: HexString;
  };
  /** Decimal MIST the bond must reach; agent_registry MIN_STAKE_MIST. */
  minStakeMist: string;
};

export type StakeConfirmationRequest = {
  reservationId: string;
  digest: string;
};

/** Real stake, step two: the settled transaction, read back and recorded. */
export type StakeConfirmation = {
  agentProfileId: string;
  staker: string;
  stakeMist: string;
  digest: string;
  backingKind: "WALLET_STAKED";
  operationalOwner: string;
  /** Whether the seat's signing key got its gas float; never fails the confirm. */
  gasFloat: "funded" | "skipped" | "failed";
};

/** One model family's latest health probe (public "weather"). */
export type WeatherFamily = {
  modelId: string;
  /** Derived from the model id; anything unknown keeps the model id as label. */
  family: "deepseek" | "minimax" | "kimi" | "research" | string;
  ok: boolean;
  latencyMs: number;
  /** HTTP status as text, or TIMEOUT / ERROR. */
  status: string;
};

/** The three families' latest probes plus the web search provider. A jury needs all of them ok. */
export type WeatherReport = {
  probedAtMs: number | null;
  /** No probe, or the newest probe is older than WEATHER_STALE_MS. */
  stale: boolean;
  /** Not stale and every family ok. Unknown weather is never "clear". */
  clear: boolean;
  families: WeatherFamily[];
};

/**
 * A submission either launches at once or is refused outright. Bad weather is
 * never held: nothing is stored and the visitor submits again themselves.
 */
export type FactCheckSubmission =
  | { kind: "claim"; claimId: string }
  | { kind: "refused"; reason: "WEATHER_NOT_CLEAR"; weather: WeatherReport };

export interface Engine {
  /** Submit a fact check: launch on clear or unknown weather, refuse on bad weather. */
  factCheckSubmit(req: FactCheckRequest): Promise<FactCheckSubmission>;
  /** Probe the three families when the stored probe is older than the interval. */
  weatherTick(): Promise<void>;
  weather(): Promise<WeatherReport>;
  /** Start a fact check; `relaunch` links a new attempt to a voided one (engine internal). */
  factCheckStart(
    req: FactCheckRequest,
    relaunch?: VerificationRelaunchContext,
  ): Promise<{ claimId: string }>;
  /** Verify the stake signature, derive the staker hash, register on-chain. */
  registerZkBackedAgent(
    req: ZkBackedRegistrationRequest,
  ): Promise<ZkBackedRegistrationResult>;
  /** Reserve a signing slot and publish the seat's manifest for a real stake. */
  prepareStake(req: StakePreparationRequest): Promise<StakePreparation>;
  /** Read the staker's settled transaction, bind the slot, record the seat. */
  confirmStake(req: StakeConfirmationRequest): Promise<StakeConfirmation>;
  claimCreate(req: ClaimCreateRequest): Promise<{ claimId: string; digest: string }>;
  propose(claimId: string, outcome: VoteOutcome): Promise<TxResult>;
  challenge(claimId: string, reason: ChallengeReason): Promise<TxResult>;
  selectCommittee(claimId: string): Promise<TxResult>;
  evidenceFreeze(claimId: string, phase: 1 | 2): Promise<TxResult>;
  runDeliberation(claimId: string): Promise<void>;
  juryRun(claimId: string, phase: 1 | 2): Promise<JuryRunReport>;
  votesCommit(claimId: string, phase: 1 | 2): Promise<TxResult[]>;
  votesReveal(claimId: string, phase: 1 | 2): Promise<TxResult[]>;
  advance(claimId: string): Promise<TxResult | null>;
  finalize(claimId: string): Promise<FinalizeReport>;
  voidAttempt(
    claimId: string,
    reason: {
      reason: string;
      message?: string;
      seatId?: string;
      modelId?: string;
      phase?: 1 | 2;
    },
  ): Promise<void>;
  relaunchTick(): Promise<void>;
  inspect(claimId: string, opts?: { verify?: boolean }): Promise<ClaimInspection>;
  report(claimId: string): Promise<FactCheckReport>;
  listClaims(filter?: { state?: ClaimState }): Promise<ClaimInspection[]>;
  listAgents(): Promise<AgentDirectoryEntry[]>;
  runProof(claimId: string, runId: string): Promise<RunProofResult>;
  agentManifestDocument(
    agentProfileId: string,
  ): Promise<AgentManifestDocument | null>;
  status(): Promise<EngineStatus>;
  events(claimId: string, fromSequence?: number): AsyncIterable<ResolutionEvent>;
}

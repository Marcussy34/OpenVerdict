import { randomBytes, randomUUID } from "node:crypto";
import {
  parseSerializedSignature,
  type SignatureScheme,
} from "@mysten/sui/cryptography";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import {
  buildEvidenceManifest,
  canonicalizeHtml,
  retrieveEvidence,
  type EvidenceManifestItem,
  type RetrievalPolicy,
  type RetrievedArtifact,
} from "../evidence";
import {
  DELIBERATION_PROMPT_SPEC_V3,
  DELIBERATION_PROMPT_SPEC_V4,
  EMPTY_TOOL_TRANSCRIPT_HASH,
  TABLE_VOTE_PROMPT_SPEC_V1,
  GonkaRunError,
  buildTableVoteMessages,
  canonicalJsonBytes,
  canonicalJsonString,
  hashCanonicalJson,
  promptSpecHash,
  repairUnsupportedClaims,
  tableVotePromptSpecHash,
  toolPolicyHash,
  unsupportedClaimsRepairNote,
  validateOutputAgainstManifest,
  type GonkaAttemptRecord,
  type GonkaRouterAdapter,
  type GonkaRunResult,
  type GonkaWeatherProbe,
} from "../gonka";
import { extractJsonObject } from "../gonka/adapter";
import {
  CLAIM_MODE,
  CLAIM_STATE,
  OUTCOME,
  agentProbabilityBps,
  blake2b256,
  computeRunHash,
  computeTruthScoreBps,
  computeVoteCommitment,
  fromHex,
  toHex,
  type AgentManifest,
  type AgentManifestDocument,
  type AgentManifestDocumentV3,
  type AgentManifestDocumentV4,
  type AgentManifestDocumentV5,
  type AgentManifestDocumentV6,
  type HexString,
  type InferenceFailureV1,
  type InferenceRunAudit,
  type OracleInferenceInput,
  type OracleInferenceOutput,
  type PromptSpecV2,
  type PromptSpecV3,
  type PromptSpecV4,
  type PromptSpecV5,
  type PublicRunBundle,
  type PublicRunBundleCore,
  type ResearchTranscriptV1,
  type SealedRunBundleV2,
  type ToolPolicyV2,
  type ToolPolicyV3,
  type ToolPolicyV4,
  type TableVoteDebateTurn,
  type TableVoteInput,
  type TableVoteStance,
  type VoteOutcome,
} from "../protocol";
import {
  createFakeResearchProvider,
  createSearchCache,
  runResearchLoop,
  transcriptHash,
  type PageStore,
  type ResearchLoopFailureStatus,
  type ResearchProvider,
  type SearchCache,
  type PageStorePage,
} from "../research";
import {
  createRepository,
  migrate,
  type AgentManifestRecord,
  type ClaimRecord,
  type CommitteeRecord,
  type DeliberationTurnRecord,
  type EvidenceArtifactRecord,
  type EvidenceManifestRecord,
  type EvidenceSubmissionRecord,
  type GonkaWeatherRecord,
  type InferenceRunRecord,
  type JurySeatRecord,
  type Repository,
  type ResolutionCertificateRecord,
  type RevealRecord,
  type RoundTallyRecord,
  type RunApprovalRecord,
  type StakeReservationRecord,
  type VerificationAttemptRecord,
  type VotePackageRecord,
  type RunProofRecord,
} from "../storage";
import { getOrBuildPublicRunProof } from "../verify/public-run-proof";
import {
  createSuiGateway,
  loadReleaseManifest,
  outcomeLabel,
  toChainRetentionEpoch,
  type JuryDiversity,
  type RegistryRosterSeat,
  type ReleaseManifest,
  type StakeRegistrationRead,
  type SuiGateway,
} from "../sui";
import type { SealEscrowService } from "../seal/escrow";
import { serializePublicEvent } from "../events";
import type { WalrusStore, WalrusPutResult } from "../walrus";
import type {
  AgentBackingStatus,
  AgentCard,
  AgentDirectoryEntry,
  VerificationRelaunchContext,
  AgentRunSummary,
  AgentTrackRecord,
  ChallengeReason,
  ClaimCreateRequest,
  ClaimInspection,
  CommitmentStatus,
  DeliberationTurnPublic,
  Engine,
  EngineStatus,
  FactCheckReport,
  FactCheckRequest,
  FactCheckSubmission,
  FinalizeReport,
  JuryDiversitySummary,
  JuryRunReport,
  ResolutionEvent,
  ResolutionEventSource,
  ResolutionEventVisibility,
  RunProofResult,
  StakeConfirmation,
  StakeConfirmationRequest,
  StakePreparation,
  StakePreparationRequest,
  StakedAgentBackingKind,
  TxResult,
  WeatherFamily,
  WeatherReport,
  ZkBackedRegistrationRequest,
  ZkBackedRegistrationResult,
} from "./contract";
import type { EngineAgentConfig, EngineConfig } from "./config";
import {
  ChainReadError,
  ClaimNotFoundError,
  EngineCapacityError,
  EngineNoEvidenceError,
  EngineStateError,
  EngineValidationError,
  StakeReservationNotFoundError,
  ZkLoginVerificationError,
} from "./errors";
import {
  EVIDENCE_POLICY_V1_LABEL,
  buildAgentManifestDocument,
  parseAgentManifestDocument,
} from "./agentManifestDocument";
import {
  nextDebateTurn,
  type DebateSeat,
  type DebateTurnFacts,
  type DebateTurnPlan,
} from "./debateOrder";
import { rankDebateRoles } from "./debate-role";
import {
  DEFAULT_DRAW_RULE,
  rosterAdmitsDraw,
  rosterCanSeat,
  type DrawRule,
} from "./draw-feasibility";
import { researchStepEvent } from "./research-feed";
import {
  buildRunBundleCore,
  buildTableVoteBundleCore,
  canonicalCoreBytes,
  sealRunBundle,
} from "./runBundle";
import {
  buildZkLoginBackingMessage,
  ZKLOGIN_AGENT_ROLES,
  type ZkLoginAgentRole,
  type ZkLoginVerificationInput,
  type ZkLoginVerifier,
} from "./zklogin";

const ZERO_OBJECT_ID = `0x${"00".repeat(32)}` as const;
const MAX_LOCAL_WALRUS_EPOCH = Number.MAX_SAFE_INTEGER;
const SUI_ADDRESS_PATTERN = /^0x[0-9a-f]{64}$/;
const MAX_ZKLOGIN_SIGNATURE_LENGTH = 16_384;
const MAX_FACT_CHECK_TEXT_LENGTH = 20_000;
const ZKLOGIN_VERIFICATION_PROVIDER = "zklogin:enoki";
/** Every non-zkLogin wallet stakes by signing a personal message. */
const WALLET_VERIFICATION_PROVIDER = "sui-wallet-personal-message";
/** A seat whose bond was really posted on chain by its staker. */
const WALLET_STAKE_VERIFICATION_PROVIDER = "sui-wallet-stake";
const DEMO_ALLOWLIST_VERIFICATION_PROVIDER = "demo-allowlist";
/** agent_registry MIN_STAKE_MIST: 0.1 SUI. */
export const MIN_STAKE_MIST = 100_000_000n;
/**
 * The largest stake a prepare accepts: 1000 SUI. The chain takes any amount,
 * but a seat's draw weight already caps at ten times the minimum, so a bigger
 * number buys nothing and would only lock the money behind a 24 hour unstake.
 * The ceiling is the engine's, not the Move package's.
 */
export const MAX_STAKE_MIST = 1_000_000_000_000n;
/** A prepared slot is held this long before it returns to the free pool. */
export const STAKE_RESERVATION_TTL_MS = 15 * 60_000;
/** A staked seat signs its own commits and reveals out of this float. */
export const SEAT_GAS_FLOAT_MIST = 300_000_000n;
/** Below this the seat gets topped up on confirm; above it, nothing moves. */
export const SEAT_GAS_FLOAT_MIN_MIST = 200_000_000n;
// move/openverdict/sources/settlement.move defines REASON_JURY_REWARD as 2.
const JURY_REWARD_REASON = 2;
const CLAIM_STATEMENT_SOURCE_URL = "urn:openverdict:claim-statement";
const ROUND_ONE_PUBLIC_RECORD_SOURCE_URL =
  "urn:openverdict:round-1-public-record";
const DELIBERATION_TRANSCRIPT_SOURCE_URL =
  "urn:openverdict:deliberation-transcript";
const PER_TURN_BUDGET_MS = 60_000;
// Only the fallback bound now: a settled debate freezes as soon as it
// converges (runDeliberation), so this reserve matters only for a debate
// still taking turns when the discussion window runs out.
const DEFAULT_EVIDENCE_FREEZE_LEAD_MS = 30_000;
const MAX_DELIBERATION_CITATIONS = 8;
const MAX_DELIBERATION_ALLOWED_CITATIONS = 60;
/** Three exchanges bound the public debate before the table vote. */
export const MAX_DELIBERATION_EXCHANGES = 3;
/** Three total claims bound automatic retries after binding failures. */
export const MAX_VERIFICATION_ATTEMPTS = 3;
/** One probe serves nearby worker ticks and every pending relaunch. */
export const RELAUNCH_WEATHER_CACHE_MS = 120_000;
/** Six hours bounds how long an unavailable model family blocks a verification. */
export const RELAUNCH_GIVE_UP_MS = 6 * 60 * 60 * 1000;
/** A model family gets one minute to answer its direct health check. */
export const RELAUNCH_PROBE_TIMEOUT_MS = 60_000;
/** Stored probes are refreshed at most once every two minutes. */
export const WEATHER_PROBE_INTERVAL_MS = 120_000;
/**
 * The longest the gate reuses one read of the registry's eligibility
 * records when nothing else says the registry moved. An eligibility command
 * writes the chain and the engine's mirror together, and a change in that
 * mirror throws the cached read away at once (see eligibilityRevision), so
 * this only bounds a change made on chain alone. Shorter than the probe on
 * purpose: ending degraded mode must not wait out a probe window.
 */
export const REGISTRY_ROSTER_CACHE_MS = 30_000;
/** Unknown weather must not refuse a public submission. */
export const WEATHER_STALE_MS = 300_000;
/** The research provider's row in the weather table (not a Gonka model). */
export const RESEARCH_WEATHER_ID = "research:firecrawl";
/**
 * Families a committee must span while the chain has not been read. The Move
 * default, so a registry that never set the field gates exactly as before.
 */
export const DEFAULT_REQUIRED_FAMILIES = DEFAULT_DRAW_RULE.requiredModels;
/** Below three families the jury sat in degraded mode, and every record says so. */
export const FULL_MODEL_FAMILIES = 3;
/** The credit check is a single small GET; it never waits on a model. */
export const RESEARCH_PROBE_TIMEOUT_MS = 15_000;
/**
 * Cleared weather relaunches at most one voided attempt per window.
 * Round-one research runs from +70 s to +600 s, so ten minutes keeps two
 * engine-launched juries from researching at the same time: three juries
 * side by side drew a 429 storm from the shared gateway (2026-09-03 01:48).
 * A direct submission on clear weather still launches at once.
 */
export const RELAUNCH_SPACING_MS = 10 * 60_000;
/** The two live deliberation contracts; V1 and V2 stay published history. */
const DELIBERATION_SPEC_V3 = {
  version: "3",
  systemPrompt: DELIBERATION_PROMPT_SPEC_V3.systemPrompt,
  maxOutputTokens: DELIBERATION_PROMPT_SPEC_V3.maxOutputTokens as number,
  promptSpecHash: promptSpecHash(DELIBERATION_PROMPT_SPEC_V3),
} as const;
const DELIBERATION_SPEC_V4 = {
  version: "4",
  systemPrompt: DELIBERATION_PROMPT_SPEC_V4.systemPrompt,
  maxOutputTokens: DELIBERATION_PROMPT_SPEC_V4.maxOutputTokens as number,
  promptSpecHash: promptSpecHash(DELIBERATION_PROMPT_SPEC_V4),
} as const;
type DeliberationSpec = typeof DELIBERATION_SPEC_V3 | typeof DELIBERATION_SPEC_V4;
/** Bounds on the V4 conversation fields; argument stays under its 1200 bound. */
const MAX_DELIBERATION_THEIR_POINT = 240;
const MAX_DELIBERATION_ANALYSIS = 900;
const MAX_DELIBERATION_POSITION = 240;
const MAX_DELIBERATION_QUESTION = 240;

/**
 * Which contract this debate runs on. Read once when the debate starts so an
 * exchange can never be split across two contracts, and recorded per turn.
 */
export function selectedDeliberationSpec(): DeliberationSpec {
  return process.env.OPENVERDICT_DELIBERATION_SPEC === "3"
    ? DELIBERATION_SPEC_V3
    : DELIBERATION_SPEC_V4;
}

export function agentBackingStatus(
  humanVerificationProvider: string,
): AgentBackingStatus {
  switch (humanVerificationProvider) {
    case ZKLOGIN_VERIFICATION_PROVIDER:
      return { kind: "ZKLOGIN", label: humanVerificationProvider };
    case WALLET_VERIFICATION_PROVIDER:
    // A real stake is still a wallet-owned seat; the label tells them apart.
    case WALLET_STAKE_VERIFICATION_PROVIDER:
      return { kind: "WALLET", label: humanVerificationProvider };
    // Two historical spellings: the engine's registration path writes
    // "demo-allowlist", the testnet seed documents carry the longer form.
    case DEMO_ALLOWLIST_VERIFICATION_PROVIDER:
    case "testnet-demo-allowlist":
      return { kind: "ALLOWLIST", label: humanVerificationProvider };
    default:
      return { kind: "UNKNOWN", label: humanVerificationProvider };
  }
}

function trackRecordFor(
  trackRecords: Map<string, AgentTrackRecord>,
  agentProfileId: string,
): AgentTrackRecord {
  const existing = trackRecords.get(agentProfileId);
  if (existing !== undefined) return existing;
  const trackRecord: AgentTrackRecord = {
    seatsServed: 0,
    committed: 0,
    revealed: 0,
    agreedWithCertificate: 0,
  };
  trackRecords.set(agentProfileId, trackRecord);
  return trackRecord;
}

type PriorRoundPublicRecord = NonNullable<OracleInferenceInput["priorRound"]>;

type InferenceFailureInput =
  | OracleInferenceInput
  | TableVoteInput
  | Pick<TableVoteInput, "kind" | "runId" | "evidenceManifest">;

/** Relaunch context keeps every new claim linked to its first verification. */

type DeliberationFailureStatus =
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "INVALID_CITATIONS"
  // V4 labels each broken part of the conversation contract on its own.
  | "INVALID_LENGTH"
  | "INVALID_ANSWERING"
  | "INVALID_QUESTION"
  | "WINDOW_EXHAUSTED";

type DeliberationDebater = {
  jurySeatId: string;
  agentProfileId: string;
  modelId: string;
  seatIndex: number;
  outcome: OracleInferenceOutput["outcome"];
  confidenceBps: number;
  run: InferenceRunRecord;
  manifest?: AgentManifestRecord;
  input?: OracleInferenceInput;
  openedUrls: string[];
};

type DeliberationPlanTurn = {
  debater: DeliberationDebater;
  ordinal: number;
  exchange: 1 | 2 | 3;
  /** Who this turn answers, and any question it must answer first. */
  plan: DebateTurnPlan;
};

/** Everything a spoken turn contributes to the public record. */
type DeliberationTurnContent = {
  argument: string;
  citations: string[];
  stance?: TableVoteStance;
  confidenceBps?: number;
  answering?: number | null;
  theirPoint?: string;
  analysis?: string;
  question?: { seat: number; text: string };
  position?: string;
};

type DeliberationConvergenceTurn = Pick<
  DeliberationTurnPublic,
  "jurySeatId" | "exchange" | "status" | "stance"
>;

type DeliberationExchangeAnalysis =
  | { complete: false }
  | {
      complete: true;
      comparable: boolean;
      moved: boolean;
      stances: Map<string, TableVoteStance | undefined>;
    };

/** Resolve one full exchange against each seat's prior effective stance. */
function analyzeDeliberationExchange(
  turns: ReadonlyArray<DeliberationConvergenceTurn>,
  previousStances: ReadonlyMap<string, TableVoteStance | undefined>,
  exchange: 1 | 2 | 3,
): DeliberationExchangeAnalysis {
  const turnBySeat = new Map(
    turns
      .filter((turn) => turn.exchange === exchange)
      .map((turn) => [turn.jurySeatId, turn]),
  );
  if ([...previousStances.keys()].some((seatId) => !turnBySeat.has(seatId))) {
    return { complete: false };
  }

  let comparable = true;
  let moved = false;
  const stances = new Map<string, TableVoteStance | undefined>();
  for (const [seatId, previousStance] of previousStances) {
    const turn = turnBySeat.get(seatId);
    if (turn === undefined) return { complete: false };
    const stance = turn.status === "SKIPPED" ? previousStance : turn.stance;
    stances.set(seatId, stance);
    if (stance === undefined || previousStance === undefined) {
      comparable = false;
    } else if (stance !== previousStance) {
      moved = true;
    }
  }
  return { complete: true, comparable, moved, stances };
}

/** Find the first complete exchange where every juror kept its stance. */
export function debateConvergedAfterExchange(
  turns: ReadonlyArray<
    Pick<
      DeliberationTurnPublic,
      "jurySeatId" | "exchange" | "status" | "stance"
    >
  >,
  // jurySeatId -> round-one outcome
  roundOneStances: ReadonlyMap<string, "YES" | "NO" | "UNSURE">,
): 1 | 2 | 3 | null {
  if (roundOneStances.size === 0) return null;
  let previousStances = new Map<string, TableVoteStance | undefined>(
    roundOneStances,
  );
  for (const exchange of [1, 2, MAX_DELIBERATION_EXCHANGES] as const) {
    const analysis = analyzeDeliberationExchange(
      turns,
      previousStances,
      exchange,
    );
    if (!analysis.complete) return null;
    if (analysis.comparable && !analysis.moved) return exchange;
    previousStances = analysis.stances;
  }
  return null;
}

/** Tell later turns when the immediately preceding exchange changed a vote. */
function debateMovedBeforeExchange(
  turns: ReadonlyArray<DeliberationConvergenceTurn>,
  roundOneStances: ReadonlyMap<string, TableVoteStance>,
  exchange: 1 | 2 | 3,
): boolean {
  if (exchange === 1 || roundOneStances.size === 0) return false;
  let previousStances = new Map<string, TableVoteStance | undefined>(
    roundOneStances,
  );
  for (const priorExchange of [1, 2] as const) {
    if (priorExchange >= exchange) return false;
    const analysis = analyzeDeliberationExchange(
      turns,
      previousStances,
      priorExchange,
    );
    if (!analysis.complete) return false;
    if (priorExchange === exchange - 1) return analysis.moved;
    previousStances = analysis.stances;
  }
  return false;
}

type SeatResearchConfig =
  | {
      bundleVersion: 3;
      spec: PromptSpecV2;
      policy: ToolPolicyV2;
    }
  | {
      bundleVersion: 4;
      spec: PromptSpecV3;
      policy: ToolPolicyV3;
    }
  | {
      // Prompt v5 appends instructions to v4 and keeps the v4 budgets, so it
      // still produces a v5 bundle.
      bundleVersion: 5;
      spec: PromptSpecV4 | PromptSpecV5;
      policy: ToolPolicyV4;
    };

class ResearchLoopError extends GonkaRunError {
  readonly status: ResearchLoopFailureStatus;
  readonly transcript?: ResearchTranscriptV1;

  constructor(
    status: ResearchLoopFailureStatus,
    message: string,
    attempts: GonkaAttemptRecord[] = [],
    transcript?: ResearchTranscriptV1,
  ) {
    super(message, attempts);
    this.name = "ResearchLoopError";
    this.status = status;
    if (transcript !== undefined) this.transcript = transcript;
  }
}
const DEFAULT_EVIDENCE_POLICY: RetrievalPolicy = {
  maxBytes: 5_000_000,
  maxRedirects: 3,
  timeoutMs: 15_000,
  allowedMime: [
    "text/html",
    "text/plain",
    "application/json",
    "application/pdf",
  ],
};

interface EngineDependencies {
  sleep: (milliseconds: number) => Promise<void>;
  repository: Repository;
  manifest: ReleaseManifest;
  gateway: SuiGateway;
  walrus: WalrusStore;
  gonka: GonkaRouterAdapter;
  research: ResearchProvider | undefined;
  now: () => number;
  retrieve: NonNullable<EngineConfig["retrieve"]>;
  retrievalPolicy: RetrievalPolicy;
  eventPollIntervalMs: number;
  zkLoginVerifier: ZkLoginVerifier;
  operationalAgentSlots: readonly { address: string; index: number }[];
  sealEscrow: SealEscrowService | undefined;
}

export async function createEngine(
  config: EngineConfig & { sealEscrow?: SealEscrowService },
): Promise<Engine> {
  const manifest = await loadReleaseManifest(config.manifestPath);
  if (manifest.network !== config.network) {
    throw new EngineValidationError(
      `engine network ${config.network} does not match manifest network ${manifest.network}`,
    );
  }
  await migrate(config.db);
  const repository = createRepository(config.db);
  const gateway = resolveGateway(config, manifest);
  const operationalAgentSlots =
    config.signers?.listAgents().map(({ address, index }) => ({ address, index })) ?? [];
  const engine = new OpenVerdictEngine({
    repository,
    manifest,
    gateway,
    walrus: config.walrus,
    gonka: config.gonka,
    research:
      config.research ??
      (manifest.gonka.mode === "fake" ? createFakeResearchProvider() : undefined),
    now: config.now ?? Date.now,
    sleep: config.sleep ?? sleep,
    retrieve: config.retrieve ?? retrieveEvidence,
    retrievalPolicy: config.retrievalPolicy ?? manifestEvidencePolicy(manifest),
    eventPollIntervalMs: config.eventPollIntervalMs ?? 1_000,
    zkLoginVerifier: config.zkLoginVerifier ?? createDefaultZkLoginVerifier(config),
    operationalAgentSlots,
    sealEscrow: config.sealEscrow,
  });
  await engine.initialize(config.initialAgents ?? []);
  return engine;
}

class OpenVerdictEngine implements Engine {
  readonly #repository: Repository;
  readonly #manifest: ReleaseManifest;
  readonly #gateway: SuiGateway;
  readonly #walrus: WalrusStore;
  readonly #gonka: GonkaRouterAdapter;
  readonly #research: ResearchProvider | undefined;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  /** Per-claim chain of votesCommit calls so seats commit as they finish, never concurrently. */
  readonly #commitQueues = new Map<string, Promise<void>>();
  /** One debate runner per claim prevents overlapping worker ticks from duplicating turns. */
  readonly #pendingDeliberations = new Map<string, Promise<void>>();
  /** Claims whose phase-two freeze is already running, so the debate's own
   * freeze-on-settle never re-enters evidenceFreeze. */
  readonly #freezingPhaseTwo = new Set<string>();
  /** Weather survives worker ticks so pending claims share the same short probe window. */
  #weatherProbeCache: {
    probedAtMs: number;
    results: GonkaWeatherProbe[];
  } | null = null;
  /** The registry's draw rule, read once per weather probe and cached with it. */
  #juryDiversityCache: { diversity: JuryDiversity; readAtMs: number } | null = null;
  /** The registry's eligibility records; see REGISTRY_ROSTER_CACHE_MS. */
  #registrySeatsCache: {
    seats: RegistryRosterSeat[];
    readAtMs: number;
    revision: string;
  } | null = null;
  /** A committee's recorded pair never changes once drawn, so it is cached for good. */
  readonly #committeeDiversityCache = new Map<string, number>();
  readonly #retrieve: NonNullable<EngineConfig["retrieve"]>;
  readonly #retrievalPolicy: RetrievalPolicy;
  readonly #eventPollIntervalMs: number;
  readonly #zkLoginVerifier: ZkLoginVerifier;
  readonly #operationalAgentSlots: readonly { address: string; index: number }[];
  readonly #sealEscrow: SealEscrowService | undefined;
  #registrationTail: Promise<void> = Promise.resolve();
  #lastRelaunchAtMs: number | null = null;

  constructor(dependencies: EngineDependencies) {
    this.#repository = dependencies.repository;
    this.#manifest = dependencies.manifest;
    this.#gateway = dependencies.gateway;
    this.#walrus = dependencies.walrus;
    this.#gonka = dependencies.gonka;
    this.#research = dependencies.research;
    this.#now = dependencies.now;
    this.#sleep = dependencies.sleep;
    this.#retrieve = dependencies.retrieve;
    this.#retrievalPolicy = dependencies.retrievalPolicy;
    this.#eventPollIntervalMs = dependencies.eventPollIntervalMs;
    this.#zkLoginVerifier = dependencies.zkLoginVerifier;
    this.#operationalAgentSlots = dependencies.operationalAgentSlots;
    this.#sealEscrow = dependencies.sealEscrow;
  }

  async initialize(agents: EngineAgentConfig[]): Promise<void> {
    for (const agent of agents) {
      const timestamp = this.isoNow();
      await this.#repository.saveAgentManifest({
        manifest: agent.manifest,
        role: agent.role,
        ...(agent.agentCapId === undefined ? {} : { agentCapId: agent.agentCapId }),
        active: agent.active ?? true,
        reputation: agent.reputation ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  async weatherTick(): Promise<void> {
    const stored = await this.#repository.listGonkaWeather();
    const newestStoredAtMs = newestWeatherAtMs(stored);
    const probedAtMs = this.#now();
    if (
      newestStoredAtMs !== null &&
      probedAtMs - newestStoredAtMs < WEATHER_PROBE_INTERVAL_MS
    ) {
      return;
    }

    // The research provider is probed alongside the families: a jury with
    // no web search answers UNSURE on everything (five seats did, 2026-09-03
    // 05:00, on a 402 from the search API). Its row shares the weather table
    // under the RESEARCH_WEATHER_ID key.
    const [modelResults, researchProbe] = await Promise.all([
      this.#gonka.probeModels(
        this.#manifest.gonka.models,
        RELAUNCH_PROBE_TIMEOUT_MS,
      ),
      this.#research?.probe?.(RESEARCH_PROBE_TIMEOUT_MS) ?? Promise.resolve(undefined),
    ]);
    const results: GonkaWeatherProbe[] =
      researchProbe === undefined
        ? modelResults
        : [
            ...modelResults,
            {
              modelId: RESEARCH_WEATHER_ID,
              ok: researchProbe.ok,
              latencyMs: researchProbe.latencyMs,
              status: researchProbe.status as GonkaWeatherProbe["status"],
            },
          ];
    const probedAt = new Date(probedAtMs).toISOString();
    await this.#repository.saveGonkaWeather(
      results.map((result) => ({
        modelId: result.modelId,
        ok: result.ok,
        latencyMs: result.latencyMs,
        status:
          result.modelId === RESEARCH_WEATHER_ID && researchProbe?.detail !== undefined
            ? `${result.status} ${researchProbe.detail}`
            : String(result.status),
        probedAt,
      })),
    );
    // Relaunches share this probe so the three families are never called twice.
    this.#weatherProbeCache = { probedAtMs, results };
    // The draw rule is read with the probe, so the gate and the probe age
    // together. The mirror is reconciled against the registry here too, so
    // rows from an earlier package registry stop showing as active seats.
    await this.juryDiversity();
    await this.syncEligibilityMirror();
  }

  /**
   * The draw rule the registry demands of the next committee: how many model
   * families it must span and how many seats one family may hold. Read from
   * chain at most once per probe interval; a read failure keeps the last known
   * answer, and the Move defaults until one is read, so a flaky node never
   * loosens the gate.
   */
  private async juryDiversity(): Promise<JuryDiversity> {
    const now = this.#now();
    if (
      this.#juryDiversityCache !== null &&
      now - this.#juryDiversityCache.readAtMs < WEATHER_PROBE_INTERVAL_MS
    ) {
      return this.#juryDiversityCache.diversity;
    }
    try {
      const diversity = await this.#gateway.juryDiversity();
      this.#juryDiversityCache = { diversity, readAtMs: now };
      return diversity;
    } catch {
      return this.#juryDiversityCache?.diversity ?? DEFAULT_DRAW_RULE;
    }
  }

  /** The draw rule in the shape lib/engine/draw-feasibility mirrors. */
  private async drawRule(): Promise<DrawRule> {
    const { requiredModels, maxSeatsPerModel } = await this.juryDiversity();
    return { requiredModels, maxSeatsPerModel };
  }

  /**
   * The eligibility records of the CURRENT registry, so neither the relaunch
   * tick nor the public weather route reads the chain per call. The read is
   * reused only while the caller's mirror still carries the eligibility it
   * was taken under: an operator command writes the chain and the mirror in
   * one step, from another process, so a change there means the registry
   * moved and this read is thrown away at once. Null means the chain could
   * not be read and there is no earlier answer: the caller falls back to the
   * mirror rather than guessing, because a failed read must never loosen the
   * gate.
   */
  private async registrySeats(
    mirror: readonly AgentManifestRecord[],
  ): Promise<RegistryRosterSeat[] | null> {
    const now = this.#now();
    const revision = eligibilityRevision(mirror);
    if (
      this.#registrySeatsCache !== null &&
      this.#registrySeatsCache.revision === revision &&
      now - this.#registrySeatsCache.readAtMs < REGISTRY_ROSTER_CACHE_MS
    ) {
      return this.#registrySeatsCache.seats;
    }
    try {
      const seats = await this.#gateway.registryRoster();
      this.#registrySeatsCache = { seats, readAtMs: now, revision };
      return seats;
    } catch (error) {
      process.stderr.write(
        `weather gate: registry roster unreadable, falling back to the engine mirror: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      return this.#registrySeatsCache?.seats ?? null;
    }
  }

  /**
   * Families with at least one active seat the draw can actually see.
   *
   * The engine's agent mirror is wider than the registry: it keeps a row for
   * every seat ever registered, including seats of earlier package versions
   * whose registry `select_committee` no longer reads (25 active mirror rows
   * against 12 active registry seats on 2026-09-05), and a family that only
   * lives in those rows held the gate shut on an outage nobody could be
   * drawn into. So eligibility comes from the registry; the mirror only
   * supplies the seat's model id, which the registry carries as a hash.
   *
   * When the chain cannot be read the mirror answers alone, which is the
   * stricter reading: it lists at least the registry's families and usually
   * more, so every family that might still be drawn has to answer its probe.
   */
  private async activeFamilies(): Promise<string[]> {
    const records = await this.#repository.listAgentManifests();
    const seats = await this.registrySeats(records);
    const families: string[] = [];
    const add = (modelId: string): void => {
      const family = weatherFamily(modelId);
      if (!families.includes(family)) families.push(family);
    };
    if (seats === null) {
      for (const record of records) {
        if (record.active) add(record.manifest.modelId);
      }
      return families;
    }
    const mirrored = new Map(
      records.map((record) => [record.manifest.agentProfileId.toLowerCase(), record]),
    );
    for (const seat of seats) {
      if (!seat.active) continue;
      // The registry stores a blake2b hash of the model id and resolves it
      // against the release catalog; the mirror holds the id itself, so it
      // wins when both know the seat.
      add(mirrored.get(seat.agentProfileId.toLowerCase())?.manifest.modelId ?? seat.modelId);
    }
    return families;
  }

  /**
   * Take mirror rows the current registry does not hold out of the gate's
   * count for good. The registry read above already ignores them, but the
   * roster the console and the operator reports show reads the mirror, and
   * an operator had to run an UPDATE by hand to clear the last set.
   */
  private async syncEligibilityMirror(): Promise<void> {
    const seats = await this.registrySeats(await this.#repository.listAgentManifests());
    if (seats === null || seats.length === 0) return;
    // A record whose profile id did not decode reads as "unknown", and
    // treating it as a registry member would mark every real row stale.
    if (seats.some((seat) => !seat.agentProfileId.startsWith("0x"))) {
      process.stderr.write(
        "weather gate: the registry roster has unreadable profile ids, the mirror is left alone\n",
      );
      return;
    }
    try {
      const stale = await this.#repository.deactivateAgentManifestsOutsideRegistry(
        seats.map((seat) => seat.agentProfileId),
        this.isoNow(),
      );
      if (stale.length > 0) {
        process.stderr.write(
          `weather gate: ${stale.length} agent mirror row(s) outside the current registry marked inactive: ${stale.join(", ")}\n`,
        );
      }
    } catch (error) {
      // Housekeeping: a write failure must never take the probe down.
      process.stderr.write(
        `weather gate: mirror sync failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }

  async weather(): Promise<WeatherReport> {
    const rows = await this.#repository.listGonkaWeather();
    const probedAtMs = newestWeatherAtMs(rows);
    const stale =
      probedAtMs === null || this.#now() - probedAtMs >= WEATHER_STALE_MS;
    const families = rows.map<WeatherFamily>((row) => ({
      modelId: row.modelId,
      family: weatherFamily(row.modelId),
      ok: row.ok,
      latencyMs: row.latencyMs,
      status: row.status,
    }));
    const [{ requiredModels: requiredFamilies }, activeFamilies] = await Promise.all([
      this.juryDiversity(),
      this.activeFamilies(),
    ]);
    // A family with no active seat cannot be drawn, so its outage does not
    // stop a jury; a family that still holds seats must answer. Web search is
    // not a model family and is required either way. Stale weather is unknown,
    // never clear.
    const healthy = new Set(
      families.filter((family) => family.ok).map((family) => family.family),
    );
    const research = families.find((family) => family.family === "research");
    const clear =
      !stale &&
      activeFamilies.length >= requiredFamilies &&
      activeFamilies.every((family) => healthy.has(family)) &&
      (research === undefined || research.ok);
    return { probedAtMs, stale, clear, families, requiredFamilies, activeFamilies };
  }

  async factCheckSubmit(req: FactCheckRequest): Promise<FactCheckSubmission> {
    validateFactCheckRequest(req);
    const weather = await this.weather();
    // Bad weather stops a submission outright: nothing is stored and the
    // visitor submits again themselves. Unknown weather is not bad weather,
    // so a deployment with no probe yet still launches immediately.
    if (!weather.clear && !weather.stale) {
      return { kind: "refused", reason: "WEATHER_NOT_CLEAR", weather };
    }
    const result = await this.factCheckStart(req);
    return { kind: "claim", claimId: result.claimId };
  }

  async factCheckStart(
    req: FactCheckRequest,
    relaunch?: VerificationRelaunchContext,
  ): Promise<{ claimId: string }> {
    validateFactCheckRequest(req);
    if (process.env.OPENVERDICT_DEBUG_DEADLINES === "1") {
      console.error("FCS req.deadlines:", JSON.stringify(req.deadlines));
    }
    // The public form sends only the statement; every such claim is judged by
    // this one public rubric (the API and CLI may still pass their own).
    const resolutionCriteria =
      req.resolutionCriteria?.trim() ||
      "Decide whether the statement is true as written, as of the claim's evidence cutoff. Weigh evidence for and against from primary sources found through your own research; the submitter's material is context only. Answer YES or NO only when credible sources agree; answer UNSURE when they conflict or are insufficient.";
    const claim = await this.createClaimRecord(
      {
        statement: req.claim.trim(),
        resolutionCriteria,
        mode: CLAIM_MODE.DIRECT_REVIEW,
        // Without explicit deadlines the ladder starts at the create_claim
        // transaction (createClaimRecord), after the request's Walrus writes.
        ...(req.deadlines === undefined ? {} : { deadlines: req.deadlines }),
        committeeBudget: process.env.OPENVERDICT_DEFAULT_COMMITTEE_BUDGET ?? "10000000",
        evidenceBudget: process.env.OPENVERDICT_DEFAULT_EVIDENCE_BUDGET ?? "0",
      },
      {
        directReviewStarted: true,
        submittedText: req.text?.trim(),
        submittedUrls: req.urls,
      },
      relaunch,
    );
    // Link the parent the moment the relaunched claim exists: the evidence
    // ingestion below can fail on a Walrus hiccup, and an unlinked parent
    // would be relaunched again on the next tick (duplicate claims).
    if (relaunch !== undefined) {
      await this.linkRelaunchedAttempt(relaunch.parentClaimId, claim.claimId);
    }
    await this.ingestFactCheckEvidence(claim, req);
    return { claimId: claim.claimId };
  }

  /** Record on the parent attempt which claim replaced it (idempotent). */
  private async linkRelaunchedAttempt(
    parentClaimId: string,
    relaunchedAs: string,
  ): Promise<void> {
    const parent = await this.#repository.getVerificationAttempt(parentClaimId);
    if (parent === undefined || parent.relaunchedAs !== undefined) return;
    await this.#repository.saveVerificationAttempt({
      ...parent,
      relaunchedAs,
      updatedAt: this.isoNow(),
    });
  }

  async voidAttempt(
    claimId: string,
    reason: {
      reason: string;
      message?: string;
      seatId?: string;
      modelId?: string;
      phase?: 1 | 2;
    },
  ): Promise<void> {
    const claim = await this.claim(claimId);
    const attempt = await this.ensureVerificationAttempt(claim);
    if (
      attempt.status === "VOIDED" ||
      attempt.status === "SETTLED" ||
      attempt.status === "GAVE_UP"
    ) {
      return;
    }
    const timestamp = this.isoNow();
    await this.#repository.saveVerificationAttempt({
      ...attempt,
      status: "VOIDED",
      voidReason: reason.reason,
      ...(reason.message === undefined ? {} : { voidMessage: reason.message }),
      ...(reason.seatId === undefined ? {} : { voidedSeatId: reason.seatId }),
      ...(reason.modelId === undefined ? {} : { voidedModelId: reason.modelId }),
      ...(reason.phase === undefined ? {} : { voidedPhase: reason.phase }),
      voidedAt: timestamp,
      updatedAt: timestamp,
    });
    await this.emit({
      claimId,
      phase: claimStateName(claim.state),
      kind: "verification_voided",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: {
        claim_id: claimId,
        verification_id: attempt.verificationId,
        attempt: attempt.attempt,
        reason: reason.reason,
        message: reason.message,
        jury_seat_id: reason.seatId,
        model_id: reason.modelId,
        phase: reason.phase,
      },
    });
  }

  async relaunchTick(): Promise<void> {
    const attempts = await this.#repository.listVerificationAttemptsByStatus(
      "VOIDED",
    );
    for (const attempt of attempts) {
      if (attempt.relaunchedAs !== undefined) continue;
      try {
        // A previous tick may have created the next attempt and failed before
        // linking it; adopt that claim instead of launching another one.
        const existingNext = (
          await this.#repository.listVerificationAttempts(attempt.verificationId)
        ).find(
          (row) =>
            row.parentClaimId === attempt.claimId &&
            row.attempt === attempt.attempt + 1,
        );
        if (existingNext !== undefined) {
          await this.linkRelaunchedAttempt(attempt.claimId, existingNext.claimId);
          continue;
        }
        const claim = await this.claim(attempt.claimId);
        if (attempt.attempt >= MAX_VERIFICATION_ATTEMPTS) {
          await this.giveUpVerificationAttempt(
            claim,
            attempt,
            "ATTEMPTS_EXHAUSTED",
          );
          continue;
        }
        if (attempt.voidedAt === undefined) {
          throw new Error("voided attempt has no void timestamp");
        }
        const voidedAtMs = Date.parse(attempt.voidedAt);
        if (!Number.isFinite(voidedAtMs)) {
          throw new Error("voided attempt has an invalid void timestamp");
        }
        const nowMs = this.#now();
        if (nowMs - voidedAtMs > RELAUNCH_GIVE_UP_MS) {
          await this.giveUpVerificationAttempt(
            claim,
            attempt,
            "WEATHER_TIMEOUT",
          );
          continue;
        }
        if (
          this.#weatherProbeCache === null ||
          nowMs - this.#weatherProbeCache.probedAtMs >=
            RELAUNCH_WEATHER_CACHE_MS
        ) {
          const results = await this.#gonka.probeModels(
            this.#manifest.gonka.models,
            RELAUNCH_PROBE_TIMEOUT_MS,
          );
          this.#weatherProbeCache = { probedAtMs: nowMs, results };
        }
        // The same rule the submission gate uses: a model family with no
        // active seat cannot be drawn, so its outage must not strand a voided
        // attempt while the operator runs degraded mode. Web search is always
        // required, and there still have to be enough families to draw a jury.
        const active = new Set(await this.activeFamilies());
        const { requiredModels } = await this.juryDiversity();
        const relaunchable =
          active.size >= requiredModels &&
          this.#weatherProbeCache.results.every(
            (result) =>
              result.ok ||
              (result.modelId !== RESEARCH_WEATHER_ID &&
                !active.has(weatherFamily(result.modelId))),
          );
        if (!relaunchable) {
          continue;
        }
        // One relaunch per window; the rest wait for a later tick.
        if (
          this.#lastRelaunchAtMs !== null &&
          nowMs - this.#lastRelaunchAtMs < RELAUNCH_SPACING_MS
        ) {
          continue;
        }
        const nextAttempt: 2 | 3 = attempt.attempt === 1 ? 2 : 3;
        this.#lastRelaunchAtMs = nowMs;
        const relaunched = await this.factCheckStart(
          {
            claim: claim.statement,
            ...(claim.submittedText === undefined
              ? {}
              : { text: claim.submittedText }),
            urls: claim.submittedUrls,
            resolutionCriteria: claim.resolutionCriteria,
          },
          {
            verificationId: attempt.verificationId,
            attempt: nextAttempt,
            parentClaimId: attempt.claimId,
          },
        );
        await this.#repository.saveVerificationAttempt({
          ...attempt,
          relaunchedAs: relaunched.claimId,
          updatedAt: this.isoNow(),
        });
        await this.emit({
          claimId: attempt.claimId,
          phase: claimStateName(claim.state),
          kind: "verification_relaunched",
          source: "ENGINE",
          visibility: "PUBLIC_NOW",
          payload: {
            claim_id: attempt.claimId,
            verification_id: attempt.verificationId,
            attempt: attempt.attempt,
            relaunched_as: relaunched.claimId,
            next_attempt: nextAttempt,
          },
        });
      } catch (error) {
        process.stderr.write(
          `relaunch: claim ${attempt.claimId.slice(0, 10)}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }
  }

  async registerZkBackedAgent(
    req: ZkBackedRegistrationRequest,
  ): Promise<ZkBackedRegistrationResult> {
    validateZkBackedRegistrationRequest(req, this.#manifest);
    const message = buildZkLoginBackingMessage(
      req.zkLoginAddress,
      this.#manifest.network,
    );

    let verified: boolean;
    try {
      verified = await this.#zkLoginVerifier.verify({
        zkLoginAddress: req.zkLoginAddress,
        message,
        signature: req.signature,
      });
    } catch (error) {
      throw new ZkLoginVerificationError(
        "signature verification is temporarily unavailable",
        { cause: error },
      );
    }
    if (!verified) {
      throw new EngineValidationError("signature is invalid for the stake message");
    }

    // The staker hash is blake2b-256 of the staking address; the address and
    // its signature are used for authentication and deliberately not stored.
    const humanBackingHash = toHex(blake2b256(fromHex(req.zkLoginAddress)));
    const backingKind = stakeBackingKind(req.signature);
    return this.withRegistrationLock(() =>
      this.registerVerifiedZkBackedAgent(req, humanBackingHash, backingKind),
    );
  }

  async claimCreate(req: ClaimCreateRequest): Promise<{ claimId: string; digest: string }> {
    validateClaimCreateRequest(req);
    const claim = await this.createClaimRecord(req, {
      directReviewStarted: false,
      submittedUrls: [],
    });
    return { claimId: claim.claimId, digest: claim.transactionDigest ?? "" };
  }

  async propose(claimId: string, outcome: VoteOutcome): Promise<TxResult> {
    const claim = await this.claim(claimId);
    if (claim.mode !== CLAIM_MODE.OPTIMISTIC_SETTLEMENT || claim.state !== CLAIM_STATE.CREATED) {
      throw new EngineStateError("only a newly-created optimistic claim accepts a proposal");
    }
    const result = await this.#gateway.propose({
      claimId,
      outcome,
      proposerBondAmount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
    });
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.PROPOSED,
      proposedOutcome: outcome,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    });
    await this.emit({
      claimId,
      phase: "PROPOSAL",
      kind: "proposal_submitted",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        outcome: outcomeLabel(outcome),
        transaction_digest: result.digest,
        amount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      },
    });
    return result;
  }

  async challenge(claimId: string, reason: ChallengeReason): Promise<TxResult> {
    const claim = await this.claim(claimId);
    if (claim.state !== CLAIM_STATE.PROPOSED) {
      throw new EngineStateError("only a proposed claim can be challenged");
    }
    if (reason.reason.trim().length === 0) {
      throw new EngineValidationError("challenge reason must not be empty");
    }
    validateHttpsUrls(reason.evidenceUrls);
    const reasonBytes = new TextEncoder().encode(reason.reason.trim());
    const storedReason = await this.#walrus.put(reasonBytes, {
      identifier: `challenge-${claimId}.txt`,
    });
    const result = await this.#gateway.challenge({
      claimId,
      challengerBondAmount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      reasonHash: blake2b256(reasonBytes),
      reasonBlobId: storedReason.blobId,
    });
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.CHALLENGED,
      transactionDigest: result.digest,
    });
    await this.emit({
      claimId,
      phase: "CHALLENGE",
      kind: "challenge_submitted",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        transaction_digest: result.digest,
        reason_blob_id: storedReason.blobId,
        amount: process.env.OPENVERDICT_PROPOSER_BOND ?? "1",
      },
    });
    await Promise.all(
      reason.evidenceUrls.map((url, index) =>
        this.ingestUrl(claim, url, 1, `challenge-${index + 1}`),
      ),
    );
    return result;
  }

  async selectCommittee(claimId: string): Promise<TxResult> {
    let claim = await this.claim(claimId);
    const existing = await this.#repository.getCommitteeForClaim(claimId);
    if (existing !== undefined) {
      // Crash recovery: a failure inside the seat loop below (seen live: a
      // missing agent manifest) leaves the committee row saved but the seat
      // rows and the COMMIT_1 transition unwritten. Treating that torn state
      // as already-selected livelocked the claim, so finish the interrupted
      // writes from the committee record before taking the shortcut.
      const savedSeats = await this.#repository.listJurySeats(claimId, 1);
      if (savedSeats.length < existing.jurySeatIds.length) {
        const timestamp = this.isoNow();
        const present = new Set(savedSeats.map((seat) => seat.jurySeatId));
        for (const [index, agentProfileId] of existing.agentProfileIds.entries()) {
          const jurySeatId = existing.jurySeatIds[index];
          if (jurySeatId === undefined || present.has(jurySeatId)) continue;
          const record = await this.#repository.getAgentManifest(agentProfileId);
          if (!record) {
            throw new EngineStateError(
              `committee recovery requires the registered manifest for agent ${agentProfileId}`,
            );
          }
          await this.#repository.saveJurySeat({
            jurySeatId,
            claimId,
            committeeId: existing.committeeId,
            agentProfileId,
            agentOwner: record.manifest.owner,
            ...(record.agentCapId === undefined ? {} : { agentCapId: record.agentCapId }),
            phase: 1,
            status: "OFFERED",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      if (claim.state === CLAIM_STATE.REVIEW_REQUESTED) {
        const digest = existing.randomnessTransactionDigest ?? "already-selected";
        const transaction: TxResult = {
          digest,
          objectIds: {
            committee: existing.committeeId,
            roundTally: existing.roundTallyId,
          },
        };
        await this.saveClaim({
          ...claim,
          state: CLAIM_STATE.COMMIT_1,
          committeeId: existing.committeeId,
          transactionDigest: digest,
        });
        await this.emit({
          claimId,
          phase: "COMMIT_1",
          kind: "committee_selected",
          source: "SUI",
          visibility: "PUBLIC_NOW",
          transaction,
          payload: {
            claim_id: claimId,
            committee_id: existing.committeeId,
            first_round_tally_id: existing.roundTallyId,
            agent_profile_ids: existing.agentProfileIds,
            jury_seat_ids: existing.jurySeatIds,
            transaction_digest: digest,
          },
        });
      }
      await this.acceptOfferedSeats(claimId, 1);
      return {
        digest: existing.randomnessTransactionDigest ?? "already-selected",
        objectIds: {
          committee: existing.committeeId,
          roundTally: existing.roundTallyId,
        },
      };
    }
    if (claim.state === CLAIM_STATE.CREATED && claim.mode === CLAIM_MODE.DIRECT_REVIEW) {
      await this.#gateway.startDirectReview(claimId);
      claim = await this.saveClaim({ ...claim, state: CLAIM_STATE.REVIEW_REQUESTED });
    } else if (claim.state === CLAIM_STATE.CHALLENGED) {
      await this.#gateway.startChallengedReview(claimId);
      claim = await this.saveClaim({ ...claim, state: CLAIM_STATE.REVIEW_REQUESTED });
    }
    if (claim.state !== CLAIM_STATE.REVIEW_REQUESTED) {
      throw new EngineStateError("committee selection requires REVIEW_REQUESTED");
    }

    const drawStartedAt = performance.now();
    const result = await this.#gateway.selectCommittee(claimId);
    const drawMs = since(drawStartedAt);
    const timestamp = this.isoNow();
    const committee: CommitteeRecord = {
      committeeId: result.committeeId,
      claimId,
      phase: 1,
      roundTallyId: result.roundTallyId,
      agentProfileIds: result.seats.map((seat) => seat.agentProfileId),
      jurySeatIds: result.seats.map((seat) => seat.jurySeatId),
      reserveAgentProfileIds: result.reserveAgentProfileIds,
      randomnessTransactionDigest: result.digest,
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveCommittee(committee);
    await this.#repository.saveRoundTally(emptyTally(committee, timestamp));

    for (const [index, selected] of result.seats.entries()) {
      await this.ensureAgent(selected.agentProfileId, selected.owner, index, selected.agentCapId);
      await this.#repository.saveJurySeat({
        jurySeatId: selected.jurySeatId,
        claimId,
        committeeId: result.committeeId,
        agentProfileId: selected.agentProfileId,
        agentOwner: selected.owner,
        ...(selected.agentCapId === undefined ? {} : { agentCapId: selected.agentCapId }),
        phase: 1,
        status: "OFFERED",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    await this.saveClaim({
      ...claim,
      state: CLAIM_STATE.COMMIT_1,
      committeeId: result.committeeId,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
    });
    await this.emit({
      claimId,
      phase: "COMMIT_1",
      kind: "committee_selected",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: claimId,
        committee_id: result.committeeId,
        first_round_tally_id: result.roundTallyId,
        agent_profile_ids: committee.agentProfileIds,
        jury_seat_ids: committee.jurySeatIds,
        transaction_digest: result.digest,
        timing_ms: { draw: drawMs },
      },
    });
    await this.acceptOfferedSeats(claimId, 1);
    return result;
  }

  async evidenceFreeze(claimId: string, phase: 1 | 2): Promise<TxResult> {
    const claim = await this.claim(claimId);
    // Move rejects a freeze after the phase window (commit deadline for
    // phase one, discussion deadline for phase two); refuse here, before
    // the manifest upload, so a closed window costs no Walrus write.
    const windowEndMs =
      phase === 1
        ? claim.deadlines.firstCommitDeadlineMs
        : claim.deadlines.discussionDeadlineMs;
    if (this.#now() > windowEndMs) {
      throw new EngineStateError(
        `evidence freeze window for phase ${phase} closed at ${new Date(windowEndMs).toISOString()}`,
      );
    }
    const existing = await this.#repository.getEvidenceManifest(claimId, phase);
    if (existing?.evidenceBundleId) {
      const tally = await this.#repository.getRoundTally(claimId, phase);
      if (tally) {
        await this.bindSeatsToEvidence(
          claimId,
          phase,
          tally.roundTallyId,
          existing.evidenceBundleId,
          existing.root,
        );
      }
      return {
        digest: existing.transactionDigest ?? "already-frozen",
        objectIds: { evidenceBundle: existing.evidenceBundleId },
      };
    }

    if (phase === 2) {
      // The transcript must be final before its hash enters the phase-two
      // root. The flag tells that debate's own freeze-on-settle to stand
      // down: this call freezes as soon as the turns are done.
      this.#freezingPhaseTwo.add(claimId);
      try {
        await this.runDeliberation(claimId);
      } finally {
        this.#freezingPhaseTwo.delete(claimId);
      }
    }

    let publicRecordArtifact: EvidenceArtifactRecord | undefined;
    let deliberationArtifact: EvidenceArtifactRecord | undefined;
    let artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 2) {
      const priorRound = await this.roundOnePublicRecord(claimId);
      publicRecordArtifact = await this.ensureRoundOnePublicRecordArtifact(
        claim,
        priorRound,
      );
      deliberationArtifact = await this.ensureDeliberationTranscriptArtifact(claim);
      artifacts = artifacts.filter(
        (artifact) =>
          artifact.evidenceId !== publicRecordArtifact?.evidenceId &&
          artifact.evidenceId !== deliberationArtifact?.evidenceId,
      );
      if (artifacts.length === 0) {
        artifacts = await this.#repository.listEvidenceArtifacts(claimId, 1);
      }
    }
    artifacts = uniqueEvidenceArtifacts(statementArtifactFirst(artifacts));
    if (deliberationArtifact) artifacts.push(deliberationArtifact);
    if (publicRecordArtifact) artifacts.push(publicRecordArtifact);
    if (artifacts.length === 0) {
      throw new EngineNoEvidenceError();
    }
    const manifestItems = artifacts.map(toEvidenceManifestItem);
    const built = buildEvidenceManifest(manifestItems);
    const archiveStartedAt = performance.now();
    const manifestUpload = await this.#walrus.put(
      new TextEncoder().encode(built.manifestJson),
      { identifier: `evidence-${claimId}-${phase}.json` },
    );
    const archiveMs = since(archiveStartedAt);
    const root = toHex(built.root);
    const policyId = evidencePolicyId(this.#manifest);
    const freezeStartedAt = performance.now();
    const result = await this.#gateway.freezeEvidence({
      claimId,
      phase,
      root: built.root,
      manifestBlobId: manifestUpload.blobId,
      manifestBlobObjectId: manifestUpload.objectId ?? ZERO_OBJECT_ID,
      sourceCount: artifacts.length,
      policyId: fromHex(policyId),
      walrusEndEpoch: await this.chainRetentionEpoch(manifestUpload.endEpoch),
    });
    const freezeMs = since(freezeStartedAt);
    const timestamp = this.isoNow();
    const record: EvidenceManifestRecord = {
      manifestId: deterministicId(`manifest:${claimId}:${phase}`),
      claimId,
      phase,
      evidenceBundleId: result.evidenceBundleId,
      root,
      manifestBlobId: manifestUpload.blobId,
      ...(manifestUpload.objectId === undefined
        ? {}
        : { manifestBlobObjectId: manifestUpload.objectId }),
      sourceCount: artifacts.length,
      policyId,
      ...(manifestUpload.endEpoch === undefined
        ? { walrusEndEpoch: MAX_LOCAL_WALRUS_EPOCH }
        : { walrusEndEpoch: manifestUpload.endEpoch }),
      sortedLeaves: artifacts.map((artifact) => artifact.evidenceId).sort(),
      transactionDigest: result.digest,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceManifest(record);

    const tally = await this.#repository.getRoundTally(claimId, phase);
    if (tally !== undefined) {
      await this.#repository.saveRoundTally({ ...tally, evidenceRoot: root, updatedAt: timestamp });
      await this.bindSeatsToEvidence(claimId, phase, tally.roundTallyId, result.evidenceBundleId, root);
    }
    await this.emit({
      claimId,
      phase: `ROUND_${phase}`,
      kind: "evidence_frozen",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      artifactHash: root,
      transaction: result,
      payload: {
        claim_id: claimId,
        phase,
        evidence_bundle_id: result.evidenceBundleId,
        root,
        manifest_blob_id: manifestUpload.blobId,
        transaction_digest: result.digest,
        timing_ms: { archive: archiveMs, freeze: freezeMs },
      },
    });
    return result;
  }

  async runDeliberation(claimId: string): Promise<void> {
    const pending = this.#pendingDeliberations.get(claimId);
    if (pending) return pending;
    const run = this.executeDeliberation(claimId);
    this.#pendingDeliberations.set(claimId, run);
    try {
      await run;
    } finally {
      this.#pendingDeliberations.delete(claimId);
    }
    await this.freezeSettledDebate(claimId);
  }

  /**
   * The transcript is final the moment the debate converges or its last
   * exchange completes, so freeze phase two here instead of waiting for the
   * evidence worker's next tick. The freeze lead stays the fallback bound for
   * a debate still taking turns, and the worker still freezes claims this
   * process never deliberated.
   */
  private async freezeSettledDebate(claimId: string): Promise<void> {
    // evidenceFreeze runs the debate itself; it freezes when that returns.
    if (this.#freezingPhaseTwo.has(claimId)) return;
    try {
      const claim = await this.claim(claimId);
      if (claim.state !== CLAIM_STATE.DISCUSSION) return;
      if (this.#now() > claim.deadlines.discussionDeadlineMs) return;
      const existing = await this.#repository.getEvidenceManifest(claimId, 2);
      if (existing?.evidenceBundleId) return;
      await this.evidenceFreeze(claimId, 2);
    } catch (error) {
      // The evidence worker retries every tick; a failed freeze must never
      // fail the debate that produced the transcript.
      process.stderr.write(
        `deliberation freeze: claim ${claimId}: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }

  async juryRun(claimId: string, phase: 1 | 2): Promise<JuryRunReport> {
    const claim = await this.claim(claimId);
    const evidence = await this.requiredEvidenceManifest(claimId, phase);
    const committee = await this.requiredCommittee(claimId);
    const seats = await this.#repository.listJurySeats(claimId, phase);
    if (seats.length !== 5) throw new EngineStateError("jury run requires five selected seats");
    const priorRound =
      phase === 2 ? await this.roundOnePublicRecord(claimId) : undefined;
    const tableVoteContext =
      phase === 2 ? await this.tableVoteDebate(claimId) : undefined;
    const researchConfigs = new Map<string, SeatResearchConfig>();
    // One Walrus read per seat for the published manifest document. Five of
    // them in sequence spent seconds of the commit window before any juror
    // started, so they run together; the seats are settled and the first
    // seat's error is rethrown, so which failure surfaces does not change.
    const preflightStartedAt = performance.now();
    const validations = await Promise.allSettled(
      seats.map(async (seat): Promise<void> => {
        const agent = await this.requiredAgent(seat.agentProfileId);
        if (phase === 2) {
          const document = await this.agentManifestDocument(seat.agentProfileId);
          if (document === null) {
            throw new EngineValidationError(
              `agent ${seat.agentProfileId} table vote manifest document is missing; run pnpm tsx scripts/publish-agent-manifests.ts`,
            );
          }
          this.assertTableVoteManifestHashes(agent.manifest, document);
          return;
        }
        if (
          agent.manifest.version === "3" ||
          agent.manifest.version === "4" ||
          agent.manifest.version === "5" ||
          agent.manifest.version === "6"
        ) {
          const document = await this.agentManifestDocument(seat.agentProfileId);
          if (
            document === null ||
            document.version !== agent.manifest.version ||
            (document.version !== "3" &&
              document.version !== "4" &&
              document.version !== "5" &&
              document.version !== "6")
          ) {
            throw new EngineValidationError(
              `agent ${seat.agentProfileId} manifest document is missing or has the wrong version`,
            );
          }
          this.assertResearchManifestHashes(agent.manifest, document);
          let researchConfig: SeatResearchConfig;
          if (document.version === "5" || document.version === "6") {
            researchConfig = {
              bundleVersion: 5,
              spec: document.promptSpec,
              policy: document.toolPolicy,
            };
          } else if (document.version === "4") {
            researchConfig = {
              bundleVersion: 4,
              spec: document.promptSpec,
              policy: document.toolPolicy,
            };
          } else {
            researchConfig = {
              bundleVersion: 3,
              spec: document.promptSpec,
              policy: document.toolPolicy,
            };
          }
          researchConfigs.set(seat.agentProfileId, researchConfig);
          return;
        }

        // Older synthetic manifests have no stored document. Keep their v2
        // binding path unchanged for local fixtures and migration tooling.
        const spec = this.#gonka.promptSpec();
        const policy = this.#gonka.toolPolicy();
        const liveHash = promptSpecHash(spec);
        const liveToolPolicyHash = toolPolicyHash(policy);
        if (agent.manifest.promptHash !== liveHash) {
          throw new EngineValidationError(
            `agent ${seat.agentProfileId} manifest prompt hash ${agent.manifest.promptHash} does not match the engine prompt spec ${liveHash}; run pnpm tsx scripts/publish-agent-manifests.ts`,
          );
        }
        if (agent.manifest.toolPolicyHash !== liveToolPolicyHash) {
          throw new EngineValidationError(
            `agent ${seat.agentProfileId} manifest tool policy hash ${agent.manifest.toolPolicyHash} does not match the engine tool policy ${liveToolPolicyHash}; run pnpm tsx scripts/publish-agent-manifests.ts`,
          );
        }
        researchConfigs.set(seat.agentProfileId, {
          bundleVersion: 3,
          spec,
          policy,
        });
      }),
    );
    for (const validation of validations) {
      if (validation.status === "rejected") throw validation.reason;
    }
    const manifestsMs = since(preflightStartedAt);
    const research = this.#research;
    if (phase === 1 && !research) {
      throw new EngineValidationError("research provider not configured");
    }
    // approve_run and commit_vote need the seat bound to the frozen evidence
    // (jury.move E_EVIDENCE_NOT_BOUND). Binds are agent-signed and can fail;
    // retry them here every tick and let an unbound seat wait for the next
    // tick instead of failing it closed.
    const bindStartedAt = performance.now();
    if (evidence.evidenceBundleId) {
      const tally = await this.requiredTally(claimId, phase);
      await this.bindSeatsToEvidence(
        claimId,
        phase,
        tally.roundTallyId,
        evidence.evidenceBundleId,
        evidence.root,
      );
    }
    const bindsMs = since(bindStartedAt);
    const boundSeats = (await this.#repository.listJurySeats(claimId, phase)).filter(
      (seat) => seat.evidenceBound,
    );
    if (boundSeats.length < seats.length) {
      process.stderr.write(
        `jury run: claim ${claimId.slice(0, 10)}…: ${seats.length - boundSeats.length} seat(s) not yet bound, running the rest\n`,
      );
    }
    const artifacts = await this.artifactsForPhase(claimId, phase);
    // The gap between the frozen evidence and the first juror is all of this:
    // it was 32 s on 2026-09-05 with the manifest reads and the binds in
    // sequence, so every run prints what it cost.
    process.stderr.write(
      `jury run: claim ${claimId.slice(0, 10)}…: phase ${phase} preflight ${Math.round(
        manifestsMs + bindsMs,
      )} ms (manifests ${Math.round(manifestsMs)} ms, binds ${Math.round(bindsMs)} ms)\n`,
    );
    const searchCache = createSearchCache();
    const storedPageCache = new Map<string, Promise<PageStorePage>>();
    // Background Walrus writes of discovered pages, keyed by evidence id.
    const pageUploads = new Map<string, Promise<void>>();
    // Every seat must finish early enough for the lock, the approvals and
    // the commits to land before the commit deadline; a seat past this point
    // fails closed while its committee mates still commit (4 of 5 settle).
    const commitDeadlineMs =
      phase === 1
        ? claim.deadlines.firstCommitDeadlineMs
        : claim.deadlines.secondCommitDeadlineMs;
    const seatDeadlineMs = commitDeadlineMs - SEAT_COMMIT_MARGIN_MS;
    const commitFloorMs = acceptanceFloorMs(committee, phase, commitDeadlineMs);

    // Commit pump: the chain allows lock_committee only from the acceptance
    // floor, seats finish at different times, and the slowest seat must not
    // decide when the others commit. From the floor until the deadline, push
    // the queued commit every few seconds while seats are still running.
    let seatsDone = false;
    let signalSeatsDone: () => void = () => undefined;
    const seatsSettled = new Promise<void>((resolve) => {
      signalSeatsDone = resolve;
    });
    const pump = (async () => {
      while (!seatsDone) {
        await Promise.race([seatsSettled, sleep(COMMIT_PUMP_INTERVAL_MS)]);
        if (seatsDone) break;
        const now = this.#now();
        if (now < commitFloorMs || now > commitDeadlineMs) continue;
        await this.queueCommit(claimId, phase);
      }
    })();

    try {
      await Promise.all(
        boundSeats.map(async (seat) => {
          const existing = (await this.#repository.listInferenceRuns(claimId, phase)).find(
            (run) => run.jurySeatId === seat.jurySeatId,
          );
          if (existing !== undefined) return;
          if (phase === 2) {
            if (priorRound === undefined || tableVoteContext === undefined) {
              throw new EngineStateError("table vote context is missing");
            }
            await this.runTableVoteSeat(
              claim,
              committee,
              seat,
              evidence,
              artifacts,
              priorRound,
              tableVoteContext.debate,
              tableVoteContext.convergedAfterExchange,
              tableVoteContext.deliberationSpecVersion,
              seatDeadlineMs,
              commitFloorMs,
            );
            return;
          }
          const researchConfig = researchConfigs.get(seat.agentProfileId);
          if (researchConfig === undefined) {
            throw new EngineValidationError(
              `agent ${seat.agentProfileId} has no validated research configuration`,
            );
          }
          if (research === undefined) {
            throw new EngineValidationError("research provider not configured");
          }
          await this.runSeat(
            claim,
            committee,
            seat,
            evidence,
            artifacts,
            priorRound,
            research,
            searchCache,
            storedPageCache,
            pageUploads,
            researchConfig,
            seatDeadlineMs,
            commitFloorMs,
          );
        }),
      );
    } finally {
      seatsDone = true;
      signalSeatsDone();
    }
    await pump;
    // Let background page uploads finish inside this tick; failures were
    // already attributed to the seats that cited those pages.
    await Promise.allSettled([...pageUploads.values()]);
    await this.#commitQueues.get(claimId);
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    return {
      claimId,
      phase,
      runs: runs.map(toAgentRunSummary),
    };
  }

  async votesCommit(claimId: string, phase: 1 | 2): Promise<TxResult[]> {
    const claim = await this.claim(claimId);
    assertCommitState(claim.state, phase);
    const committee = await this.requiredCommittee(claimId);
    const tally = await this.requiredTally(claimId, phase);
    if (!committee.locked) {
      await this.#gateway.lockCommittee({
        claimId,
        committeeId: committee.committeeId,
        roundTallyId: tally.roundTallyId,
      });
      await this.#repository.saveCommittee({
        ...committee,
        locked: true,
        updatedAt: this.isoNow(),
      });
    }
    const existingPackages = await this.#repository.listVotePackages(claimId, phase);
    const existingBySeat = new Map(existingPackages.map((item) => [item.jurySeatId, item]));
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    const validRuns = runs.filter(
      (run) => run.validationStatus === "SCHEMA_VALID" && run.output && run.runHash,
    );
    const results: TxResult[] = [];

    for (const run of validRuns) {
      const existing = existingBySeat.get(run.jurySeatId);
      if (existing?.committed) {
        results.push({ digest: existing.commitmentTransactionDigest ?? "already-committed" });
        continue;
      }
      const output = run.output;
      const runHash = run.runHash;
      if (!output || !runHash) continue;
      const approval = await this.#repository.getRunApproval(run.runId);
      if (!approval || approval.consumed) continue;
      const outcome = outcomeCode(output.outcome);
      const salt = randomBytes(32);
      const commitment = toHex(
        computeVoteCommitment({
          claim_id: claimId,
          agent_profile_id: run.agentProfileId,
          jury_seat_id: run.jurySeatId,
          phase,
          outcome,
          confidence_bps: output.confidenceBps,
          evidence_root: fromHex(run.evidenceRoot),
          output_hash: fromHex(run.outputHash),
          run_hash: fromHex(runHash),
          salt,
        }),
      );
      const commitStartedAt = performance.now();
      const result = await this.#gateway.commitVote({
        jurySeatId: run.jurySeatId,
        roundTallyId: tally.roundTallyId,
        agentProfileId: run.agentProfileId,
        runApprovalId: approval.runApprovalId,
        commitment: fromHex(commitment),
      });
      const commitMs = since(commitStartedAt);
      const timestamp = this.isoNow();
      // TODO: V1 local recovery stores plaintext hex. Encrypt salts before production.
      const votePackage: VotePackageRecord = {
        votePackageId: deterministicId(`vote:${claimId}:${phase}:${run.jurySeatId}`),
        claimId,
        phase,
        jurySeatId: run.jurySeatId,
        agentProfileId: run.agentProfileId,
        runId: run.runId,
        outcome,
        confidenceBps: output.confidenceBps,
        evidenceRoot: run.evidenceRoot,
        outputHash: run.outputHash,
        runHash,
        commitment,
        saltHex: toHex(salt),
        commitmentTransactionDigest: result.digest,
        committed: true,
        revealed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveVotePackage(votePackage);
      await this.#repository.saveRunApproval({
        ...approval,
        consumed: true,
        updatedAt: timestamp,
      });
      await this.updateSeat(run.jurySeatId, { status: "COMMITTED", commitment, runHash });
      await this.emit({
        claimId,
        phase: `COMMIT_${phase}`,
        kind: "vote_committed",
        source: "SUI",
        visibility: "PUBLIC_NOW",
        actorId: run.agentProfileId,
        runId: run.runId,
        transaction: result,
        payload: {
          claim_id: claimId,
          phase,
          agent_profile_id: run.agentProfileId,
          jury_seat_id: run.jurySeatId,
          transaction_digest: result.digest,
          timing_ms: { commit: commitMs },
        },
      });
      results.push(result);
    }
    return results;
  }

  async votesReveal(claimId: string, phase: 1 | 2): Promise<TxResult[]> {
    const claim = await this.claim(claimId);
    assertRevealState(claim.state, phase);
    const tally = await this.requiredTally(claimId, phase);
    const packages = await this.#repository.listVotePackages(claimId, phase);
    const runs = await this.#repository.listInferenceRuns(claimId, phase);
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const results: TxResult[] = [];
    let updatedTally = tally;

    // Every bundle is published the moment the reveal phase opens, all of
    // them at once on the Walrus writer lanes, and each seat reveals as soon
    // as its own upload lands.
    const pending = packages.flatMap((votePackage) => {
      if (!votePackage.committed || votePackage.revealed) return [];
      const run = runById.get(votePackage.runId);
      if (
        !run?.output ||
        !run.runHash ||
        !run.sealKeyHex ||
        !run.sealIvHex ||
        !run.coreHash ||
        !run.sealedBlobId ||
        !run.audit.bundleCore
      ) {
        return [];
      }
      const core = JSON.parse(
        run.audit.bundleCore,
      ) as PublicRunBundleCore;
      const bundle: PublicRunBundle = {
        ...core,
        seal: {
          algorithm: "AES-256-GCM",
          keyHex: run.sealKeyHex,
          ivHex: run.sealIvHex,
          aad: run.runId,
          sealedBlobId: run.sealedBlobId,
          coreHash: run.coreHash,
        },
      };
      return [{ votePackage, run, output: run.output, bundle }];
    });
    // Started here, not awaited here: every upload runs from this instant,
    // and each reveal below waits only for its own. Awaiting the whole batch
    // made every seat pay the slowest write (12.9 s to 23.3 s on 2026-09-05,
    // and all five reveals landed in the same second).
    type SeatUpload = { upload?: WalrusPutResult; uploadMs: number };
    const uploads: Array<Promise<SeatUpload>> = pending.map(
      async ({ run, bundle }): Promise<SeatUpload> => {
        const startedAt = performance.now();
        try {
          const upload = await this.#walrus.put(canonicalJsonBytes(bundle), {
            identifier: `${run.runId}-run-bundle.json`,
          });
          return { upload, uploadMs: since(startedAt) };
        } catch {
          // A failed publication must not consume the on-chain reveal opportunity.
          return { uploadMs: since(startedAt) };
        }
      },
    );

    // Reveal on chain in parallel: every seat transaction is signed and paid
    // by its own agent, so seats never contend on gas (two seats of one
    // agent stay sequential), and a failed reveal must not stop its
    // siblings; the shared bookkeeping below runs in order afterwards.
    type RevealWork = (typeof pending)[number] & {
      uploading: Promise<SeatUpload>;
      upload: WalrusPutResult | undefined;
      uploadMs: number;
      revealMs: number;
      result?: Awaited<ReturnType<SuiGateway["revealVote"]>>;
    };
    const work: RevealWork[] = pending.map((entry, index) => ({
      ...entry,
      uploading: uploads[index] ?? Promise.resolve({ uploadMs: 0 }),
      upload: undefined,
      uploadMs: 0,
      revealMs: 0,
    }));
    const byAgent = new Map<string, RevealWork[]>();
    for (const item of work) {
      const list = byAgent.get(item.votePackage.agentProfileId) ?? [];
      list.push(item);
      byAgent.set(item.votePackage.agentProfileId, list);
    }
    const failures: unknown[] = [];
    await Promise.all(
      [...byAgent.values()].map(async (items) => {
        for (const item of items) {
          const published = await item.uploading;
          item.upload = published.upload;
          item.uploadMs = published.uploadMs;
          const { votePackage, upload } = item;
          if (!upload) continue;
          const revealStartedAt = performance.now();
          try {
            item.result = await this.#gateway.revealVote({
              jurySeatId: votePackage.jurySeatId,
              roundTallyId: tally.roundTallyId,
              agentProfileId: votePackage.agentProfileId,
              outcome: votePackage.outcome,
              confidenceBps: votePackage.confidenceBps,
              outputHash: fromHex(votePackage.outputHash),
              runHash: fromHex(votePackage.runHash),
              salt: fromHex(votePackage.saltHex),
              argumentBlobId: upload.blobId,
              argumentBlobObjectId: upload.objectId ?? ZERO_OBJECT_ID,
              argumentWalrusEndEpoch: await this.chainRetentionEpoch(upload.endEpoch),
            });
          } catch (error) {
            failures.push(error);
          } finally {
            item.revealMs = since(revealStartedAt);
          }
        }
      }),
    );

    for (const {
      votePackage,
      run,
      output,
      upload: argumentUpload,
      uploadMs,
      revealMs,
      result,
    } of work) {
      if (!argumentUpload || !result) continue;
      const timestamp = this.isoNow();
      await this.#repository.saveInferenceRun({
        ...run,
        revealedBlobId: argumentUpload.blobId,
        ...(argumentUpload.objectId === undefined
          ? {}
          : { revealedObjectId: argumentUpload.objectId }),
        updatedAt: timestamp,
      });
      const reveal: RevealRecord = {
        revealedVoteId: result.revealedVoteId,
        votePackageId: votePackage.votePackageId,
        claimId,
        phase,
        roundTallyId: tally.roundTallyId,
        jurySeatId: votePackage.jurySeatId,
        agentProfileId: votePackage.agentProfileId,
        runId: votePackage.runId,
        outcome: votePackage.outcome,
        confidenceBps: votePackage.confidenceBps,
        valid: true,
        transactionDigest: result.digest,
        ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#repository.saveReveal(reveal);
      await this.#repository.saveVotePackage({
        ...votePackage,
        revealed: true,
        updatedAt: timestamp,
      });
      updatedTally = addRevealToTally(updatedTally, reveal);
      await this.#repository.saveRoundTally(updatedTally);
      await this.updateSeat(votePackage.jurySeatId, { status: "REVEALED" });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "vote_revealed",
        source: "SUI",
        visibility: "PUBLIC_NOW",
        actorId: votePackage.agentProfileId,
        runId: votePackage.runId,
        transaction: result,
        payload: {
          claim_id: claimId,
          phase,
          round_tally_id: tally.roundTallyId,
          agent_profile_id: votePackage.agentProfileId,
          jury_seat_id: votePackage.jurySeatId,
          revealed_vote_id: result.revealedVoteId,
          outcome: outcomeLabel(votePackage.outcome),
          confidence_bps: votePackage.confidenceBps,
          valid: true,
          transaction_digest: result.digest,
          timing_ms: { upload: uploadMs, reveal: revealMs },
        },
      });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "inference_completed",
        source: "GONKA_ROUTER",
        visibility: "PUBLIC_AFTER_REVEAL",
        actorId: run.agentProfileId,
        runId: run.runId,
        occurredAt: run.completedAt,
        publishedAt: timestamp,
        artifactHash: run.outputHash,
        payload: {
          run_id: run.runId,
          gonka_request_id: run.gonkaRequestId,
          model_id: run.modelId,
          latency_ms: run.latencyMs,
          schema_status: run.validationStatus,
          token_usage: {
            input: run.inputTokens,
            output: run.outputTokens,
          },
          output: run.output,
        },
      });
      await this.emit({
        claimId,
        phase: `REVEAL_${phase}`,
        kind: "argument_published",
        source: "GONKA_ROUTER",
        visibility: "PUBLIC_AFTER_REVEAL",
        actorId: votePackage.agentProfileId,
        runId: votePackage.runId,
        artifactHash: run.outputHash,
        payload: {
          claim_id: claimId,
          phase,
          agent_id: votePackage.agentProfileId,
          gonka_request_id: run.gonkaRequestId,
          argument_hash: run.outputHash,
          reasoning_trace_hash: hashCanonicalJson(output.publicReasoningTrace),
          evidence_ids: citedEvidenceIds(output),
          reasoning: output.reasoning,
          public_reasoning_trace: output.publicReasoningTrace,
        },
      });
      results.push(result);
    }
    // Surface a lost seat only after every other seat's reveal is recorded.
    if (failures.length > 0) throw failures[0];
    return results;
  }

  async advance(claimId: string): Promise<TxResult | null> {
    const claim = await this.claim(claimId);
    if (
      claim.state === CLAIM_STATE.REVIEW_REQUESTED ||
      claim.state === CLAIM_STATE.CHALLENGED ||
      (claim.state === CLAIM_STATE.CREATED && claim.mode === CLAIM_MODE.DIRECT_REVIEW)
    ) {
      return this.selectCommittee(claimId);
    }
    if (claim.state === CLAIM_STATE.COMMIT_1 || claim.state === CLAIM_STATE.COMMIT_2) {
      const phase = claim.state === CLAIM_STATE.COMMIT_1 ? 1 : 2;
      const tally = await this.requiredTally(claimId, phase);
      const result = await this.#gateway.advancePhase(claimId, tally.roundTallyId);
      const next = phase === 1 ? CLAIM_STATE.REVEAL_1 : CLAIM_STATE.REVEAL_2;
      await this.changePhase(claim, next, result);
      return result;
    }
    if (claim.state === CLAIM_STATE.REVEAL_1) {
      const tally = await this.requiredTally(claimId, 1);
      if (thresholdOutcome(tally) !== null) return null;
      const result = await this.#gateway.openDiscussion({
        claimId,
        firstRoundTallyId: tally.roundTallyId,
      });
      await this.#repository.saveRoundTally({ ...tally, closed: true, updatedAt: this.isoNow() });
      await this.changePhase(claim, CLAIM_STATE.DISCUSSION, result);
      return result;
    }
    if (claim.state === CLAIM_STATE.DISCUSSION) {
      const evidence = await this.#repository.getEvidenceManifest(claimId, 2);
      const evidenceBundleId = evidence?.evidenceBundleId;
      if (!evidenceBundleId) {
        throw new EngineStateError(
          "phase-two evidence must be frozen before the discussion deadline",
        );
      }
      if (!evidence) throw new EngineStateError("phase-two evidence manifest is missing");
      const committee = await this.requiredCommittee(claimId);
      const firstTally = await this.requiredTally(claimId, 1);
      const result = await this.#gateway.createSecondRound({
        claimId,
        committeeId: committee.committeeId,
        firstRoundTallyId: firstTally.roundTallyId,
      });
      const timestamp = this.isoNow();
      const phaseTwoCommittee: CommitteeRecord = {
        ...committee,
        phase: 2,
        roundTallyId: result.roundTallyId,
        jurySeatIds: result.seats.map((seat) => seat.jurySeatId),
        updatedAt: timestamp,
      };
      await this.#repository.saveCommittee(phaseTwoCommittee);
      await this.#repository.saveRoundTally(emptyTally(phaseTwoCommittee, timestamp));
      for (const selected of result.seats) {
        await this.#repository.saveJurySeat({
          jurySeatId: selected.jurySeatId,
          claimId,
          committeeId: committee.committeeId,
          agentProfileId: selected.agentProfileId,
          agentOwner: selected.owner,
          ...(selected.agentCapId === undefined ? {} : { agentCapId: selected.agentCapId }),
          phase: 2,
          status: "ACCEPTED",
          evidenceRoot: evidence.root,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      // The chain is in COMMIT_2 as soon as the transaction lands; record
      // that before the agent-signed binds, which may fail and are retried
      // by juryRun. Otherwise a failed bind left the database in DISCUSSION
      // and every later advance aborted with E_INVALID_CLAIM_STATE.
      await this.changePhase(claim, CLAIM_STATE.COMMIT_2, result);
      await this.bindSeatsToEvidence(
        claimId,
        2,
        result.roundTallyId,
        evidenceBundleId,
        evidence.root,
      );
      return result;
    }
    return null;
  }

  async finalize(claimId: string): Promise<FinalizeReport> {
    const claim = await this.claim(claimId);
    const existing = await this.#repository.getResolutionCertificate(claimId);
    if (existing) return certificateToFinalizeReport(existing);
    if (claim.state === CLAIM_STATE.PROPOSED && claim.proposedOutcome !== undefined) {
      const unchallengedStartedAt = performance.now();
      const chain = await this.#gateway.finalizeUnchallenged(claimId);
      const finalizeMs = since(unchallengedStartedAt);
      const result =
        claim.proposedOutcome === OUTCOME.UNSURE
          ? "UNRESOLVED"
          : outcomeLabel(claim.proposedOutcome);
      return this.persistFinalization(claim, chain, result, null, 1, [], finalizeMs);
    }
    const phase = claim.state === CLAIM_STATE.REVEAL_1 ? 1 : claim.state === CLAIM_STATE.REVEAL_2 ? 2 : null;
    if (phase === null) throw new EngineStateError("claim is not in a finalizable reveal phase");
    const tally = await this.requiredTally(claimId, phase);
    const threshold = thresholdOutcome(tally);
    if (phase === 1 && threshold === null) {
      throw new EngineStateError("round one has no threshold; advance to discussion");
    }
    const result =
      threshold === null || threshold === OUTCOME.UNSURE
        ? "UNRESOLVED"
        : outcomeLabel(threshold);
    const reveals = await this.#repository.listReveals(claimId, phase);
    const truthScoreBps = computeTruthScoreBps(
      reveals.filter((reveal) => reveal.valid).map((reveal) => ({
        outcome: reveal.outcome,
        confidenceBps: reveal.confidenceBps,
      })),
    );
    const committee = await this.requiredCommittee(claimId);
    const evidence = await this.requiredEvidenceManifest(claimId, phase);
    if (!evidence.evidenceBundleId) throw new EngineStateError("evidence bundle is missing");
    const finalizeStartedAt = performance.now();
    const chain = await this.#gateway.finalize({
      claimId,
      committeeId: committee.committeeId,
      roundTallyId: tally.roundTallyId,
      evidenceBundleId: evidence.evidenceBundleId,
    });
    return this.persistFinalization(
      claim,
      chain,
      result,
      truthScoreBps,
      phase,
      reveals.map((reveal) => reveal.revealedVoteId),
      since(finalizeStartedAt),
    );
  }

  /**
   * How many model families the registry demanded when this committee was
   * drawn. The chain records the pair on the committee itself, so it never
   * moves with the registry's current setting. A committee drawn before
   * degraded mode existed carries none, which is exactly the default.
   */
  private async committeeRequiredFamilies(committeeId: string): Promise<number> {
    const cached = this.#committeeDiversityCache.get(committeeId);
    if (cached !== undefined) return cached;
    try {
      const { requiredModels } = await this.#gateway.committeeDiversity(committeeId);
      this.#committeeDiversityCache.set(committeeId, requiredModels);
      return requiredModels;
    } catch {
      return DEFAULT_REQUIRED_FAMILIES;
    }
  }

  /** The public degraded flag: fewer than three families judged this claim. */
  private async juryDiversitySummary(
    committeeId: string | undefined,
    modelIds: Iterable<string | undefined>,
  ): Promise<JuryDiversitySummary | undefined> {
    const families = new Set<string>();
    for (const modelId of modelIds) {
      if (modelId !== undefined) families.add(weatherFamily(modelId));
    }
    if (committeeId === undefined || families.size === 0) return undefined;
    return {
      familyCount: families.size,
      requiredFamilies: await this.committeeRequiredFamilies(committeeId),
      degraded: families.size < FULL_MODEL_FAMILIES,
    };
  }

  async inspect(claimId: string, opts: { verify?: boolean } = {}): Promise<ClaimInspection> {
    const claim = await this.claim(claimId);
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    const manifests = await this.evidenceManifests(claimId);
    const packages = [
      ...(await this.#repository.listVotePackages(claimId, 1)),
      ...(await this.#repository.listVotePackages(claimId, 2)),
    ];
    const tallies = (
      await Promise.all([
        this.#repository.getRoundTally(claimId, 1),
        this.#repository.getRoundTally(claimId, 2),
      ])
    ).filter((tally): tally is RoundTallyRecord => tally !== undefined);
    const seats = [
      ...(await this.#repository.listJurySeats(claimId, 1)),
      ...(await this.#repository.listJurySeats(claimId, 2)),
    ];
    const packageBySeat = new Map(packages.map((item) => [item.jurySeatId, item]));
    const reveals = await this.#repository.listReveals(claimId);
    const revealBySeat = new Map(reveals.map((reveal) => [reveal.jurySeatId, reveal]));
    // A seat that failed before committing keeps a failure record on its run
    // row; the claim page marks the seat from it without loading the proof.
    const failureBySeat = new Map(
      (await this.#repository.listInferenceRuns(claimId))
        .filter((run) => run.failure !== undefined)
        .map((run) => [run.jurySeatId, run.failure?.status ?? "PROVIDER_ERROR"]),
    );
    // Each seat's model comes from its agent's registered manifest, so juror
    // identity (and the canvas family mascot) resolves even for seats that
    // failed before any inference completed.
    const modelByAgent = new Map<string, string>();
    for (const agentProfileId of new Set(seats.map((seat) => seat.agentProfileId))) {
      const manifest = await this.#repository.getAgentManifest(agentProfileId);
      const modelId = manifest?.manifest.modelId;
      if (modelId !== undefined) modelByAgent.set(agentProfileId, modelId);
    }
    const commitments: CommitmentStatus[] = seats.map((seat) => {
      const item = packageBySeat.get(seat.jurySeatId);
      const reveal = revealBySeat.get(seat.jurySeatId);
      const failureStatus = failureBySeat.get(seat.jurySeatId);
      const modelId = modelByAgent.get(seat.agentProfileId);
      return {
        jurySeatId: seat.jurySeatId,
        agentProfileId: seat.agentProfileId,
        ...(modelId === undefined ? {} : { modelId }),
        committed: item?.committed ?? false,
        revealed: item?.revealed ?? false,
        ...(reveal === undefined
          ? {}
          : { outcome: reveal.outcome, confidenceBps: reveal.confidenceBps }),
        ...(failureStatus !== undefined && !(item?.committed ?? false)
          ? { failureStatus }
          : {}),
      };
    });
    const rounds = tallies.map((tally) => ({
      phase: tally.phase,
      expectedJurySeatIds: tally.expectedJurySeatIds,
      committedJurySeatIds: tally.expectedJurySeatIds.filter(
        (jurySeatId) => packageBySeat.get(jurySeatId)?.committed,
      ),
      revealedJurySeatIds: tally.revealedJurySeatIds,
    }));
    const result = await this.#repository.getResolutionCertificate(claimId);
    const attempt = await this.#repository.getVerificationAttempt(claimId);
    let attemptChain: ClaimInspection["attemptChain"];
    if (attempt !== undefined) {
      const siblings = await this.#repository.listVerificationAttempts(
        attempt.verificationId,
      );
      attemptChain = {
        verificationId: attempt.verificationId,
        attempt: attempt.attempt,
        maxAttempts: 3,
        status: attempt.status,
        ...(attempt.status === "VOIDED" &&
        attempt.voidReason !== undefined &&
        attempt.voidedAt !== undefined
          ? {
              void: {
                ...(attempt.voidedSeatId === undefined
                  ? {}
                  : { seatId: attempt.voidedSeatId }),
                ...(attempt.voidedModelId === undefined
                  ? {}
                  : { modelId: attempt.voidedModelId }),
                ...(attempt.voidedPhase === undefined
                  ? {}
                  : { phase: attempt.voidedPhase }),
                reason: attempt.voidReason,
                ...(attempt.voidMessage === undefined
                  ? {}
                  : { message: attempt.voidMessage }),
                atMs: Date.parse(attempt.voidedAt),
              },
            }
          : {}),
        ...(attempt.relaunchedAs === undefined
          ? {}
          : { relaunchedAs: attempt.relaunchedAs }),
        ...(attempt.gaveUpReason === undefined
          ? {}
          : { gaveUpReason: attempt.gaveUpReason }),
        previousAttempts: siblings
          .filter((sibling) => sibling.attempt < attempt.attempt)
          .map((sibling) => ({
            claimId: sibling.claimId,
            attempt: sibling.attempt,
            status: sibling.status,
            ...(sibling.voidReason === undefined
              ? {}
              : { voidReason: sibling.voidReason }),
          })),
      };
    }
    const deliberation = (
      await this.#repository.listDeliberationTurns(claimId)
    ).map(toPublicDeliberationTurn);
    const roundOneStances = new Map(
      (await this.#repository.listReveals(claimId, 1)).map((reveal) => [
        reveal.jurySeatId,
        outcomeLabel(reveal.outcome),
      ]),
    );
    const convergedAfterExchange = debateConvergedAfterExchange(
      deliberation,
      roundOneStances,
    );
    const jury = await this.juryDiversitySummary(
      committee?.committeeId,
      commitments.map((commitment) => commitment.modelId),
    );
    const inspection: ClaimInspection = {
      claimId,
      mode: claim.mode,
      state: claim.state,
      statement: claim.statement,
      resolutionCriteria: claim.resolutionCriteria,
      deadlines: claim.deadlines,
      ...(claim.proposedOutcome === undefined
        ? {}
        : { proposedOutcome: outcomeLabel(claim.proposedOutcome) }),
      ...(committee === undefined ? {} : { committeeId: committee.committeeId }),
      evidenceRoots: manifests.map((manifest) => ({
        phase: manifest.phase,
        root: manifest.root,
        bundleId: manifest.evidenceBundleId ?? "",
      })),
      commitments,
      rounds,
      ...(deliberation.length === 0 ? {} : { deliberation }),
      ...(attemptChain === undefined ? {} : { attemptChain }),
      ...(convergedAfterExchange === null
        ? {}
        : { debateConvergedAfterExchange: convergedAfterExchange }),
      ...(jury === undefined ? {} : { jury }),
      ...(result === undefined ? {} : { result: certificateToFinalizeReport(result) }),
    };
    if (opts.verify) inspection.verification = await this.verifyClaim(claim, manifests, packages, result);
    return inspection;
  }

  async report(claimId: string): Promise<FactCheckReport> {
    const claim = await this.claim(claimId);
    const certificate = await this.#repository.getResolutionCertificate(claimId);
    const finalPhase = certificate?.finalPhase ?? (claim.state >= CLAIM_STATE.COMMIT_2 ? 2 : 1);
    const reveals = await this.#repository.listReveals(claimId, finalPhase);
    const runs = await this.#repository.listInferenceRuns(claimId, finalPhase);
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const agentsById = new Map<string, AgentManifestRecord>(
      (await this.#repository.listAgentManifests()).map((agent) => [
        agent.manifest.agentProfileId,
        agent,
      ]),
    );
    const agents: AgentCard[] = reveals.flatMap((reveal) => {
      const run = runById.get(reveal.runId);
      const agent = agentsById.get(reveal.agentProfileId);
      if (!run?.output || !agent) return [];
      return [toAgentCard(reveal, { ...run, output: run.output }, agent)];
    });
    const artifacts = await this.#repository.listEvidenceArtifacts(claimId);
    const evidence = await this.#repository.getEvidenceManifest(claimId, finalPhase);
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    const approvals = await this.#repository.listRunApprovals(claimId);
    const votePackages = [
      ...(await this.#repository.listVotePackages(claimId, 1)),
      ...(await this.#repository.listVotePackages(claimId, 2)),
    ];
    const truthScoreBps = certificate?.truthScoreBps ?? null;
    // The committee's own seats decide the family count, so a seat that failed
    // before any inference still counts towards the diversity the draw gave.
    const jury = await this.juryDiversitySummary(
      committee?.committeeId,
      (committee?.agentProfileIds ?? []).map(
        (agentProfileId) => agentsById.get(agentProfileId)?.manifest.modelId,
      ),
    );
    return {
      claimId,
      statement: claim.statement,
      submittedUrls: claim.submittedUrls,
      label: certificate?.result ?? "PENDING",
      truthScore: truthScoreBps === null ? null : truthScoreBps / 100,
      truthScoreFormula:
        "confidence is read as the juror's probability that its own vote is correct; mean(YES confidence, NO (10000-confidence), UNSURE 5000) over valid reveals, rounded half-up; displayed as basis-points / 100",
      // Every final-round reveal, with the flag the score uses: only valid
      // reveals enter the mean, so the page can print the same terms.
      finalRoundVotes: reveals.map((reveal) => ({
        jurySeatId: reveal.jurySeatId,
        outcome: outcomeLabel(reveal.outcome),
        confidenceBps: reveal.confidenceBps,
        valid: reveal.valid,
      })),
      agents,
      evidence: artifacts.map((artifact) => ({
        evidenceId: artifact.evidenceId,
        sourceUrl: artifact.sourceUrl,
        blobId: artifact.canonicalWalrusBlobId,
        contentHash: artifact.contentHash,
      })),
      ...(evidence === undefined ? {} : { evidenceRoot: evidence.root }),
      ...(jury === undefined ? {} : { jury }),
      sui: {
        claimObjectId: claimId,
        ...(committee === undefined ? {} : { committeeId: committee.committeeId }),
        ...(certificate === undefined ? {} : { certificateId: certificate.certificateId }),
        revealedVoteIds: reveals.map((reveal) => reveal.revealedVoteId),
      },
      auditBundle: {
        version: 1,
        claim: {
          claimId,
          packageId: claim.packageId,
          transactionDigest: claim.transactionDigest,
        },
        committee:
          committee === undefined
            ? null
            : {
                committeeId: committee.committeeId,
                roundTallyId: committee.roundTallyId,
                agentProfileIds: committee.agentProfileIds,
                jurySeatIds: committee.jurySeatIds,
                transactionDigest: committee.randomnessTransactionDigest,
              },
        evidence: (await this.evidenceManifests(claimId)).map((manifest) => ({
          phase: manifest.phase,
          root: manifest.root,
          manifestBlobId: manifest.manifestBlobId,
          evidenceBundleId: manifest.evidenceBundleId,
        })),
        evidenceArtifacts: artifacts.map((artifact) => ({
          evidenceId: artifact.evidenceId,
          contentHash: artifact.contentHash,
          canonicalHash: artifact.canonicalHash,
          rawWalrusBlobId: artifact.rawWalrusBlobId,
          canonicalWalrusBlobId: artifact.canonicalWalrusBlobId,
        })),
        runs: reveals.flatMap((reveal) => {
          const run = runById.get(reveal.runId);
          return run
            ? [{
                runId: run.runId,
                agentProfileId: run.agentProfileId,
                gonkaRequestId: run.gonkaRequestId,
                promptHash: run.promptHash,
                inputHash: run.inputHash,
                outputHash: run.outputHash,
                runHash: run.runHash,
                runWalrusBlobId: run.runWalrusBlobId,
                toolTranscriptHash: run.toolTranscriptHash,
                toolTranscriptWalrusBlobId: run.toolTranscriptWalrusBlobId,
              }]
            : [];
        }),
        runApprovals: approvals.map((approval) => ({
          runApprovalId: approval.runApprovalId,
          runId: approval.runId,
          runHash: approval.runHash,
          transactionDigest: approval.transactionDigest,
        })),
        commitments: votePackages.map((item) => ({
          votePackageId: item.votePackageId,
          phase: item.phase,
          jurySeatId: item.jurySeatId,
          agentProfileId: item.agentProfileId,
          commitment: item.commitment,
          transactionDigest: item.commitmentTransactionDigest,
          revealed: item.revealed,
        })),
        reveals: reveals.map((reveal) => ({
          revealedVoteId: reveal.revealedVoteId,
          runId: reveal.runId,
          transactionDigest: reveal.transactionDigest,
        })),
        certificate: certificate ?? null,
      },
    };
  }

  async listClaims(filter: { state?: ClaimRecord["state"] } = {}): Promise<ClaimInspection[]> {
    const claims = await this.#repository.listClaims(filter.state);
    return Promise.all(claims.map((claim) => this.inspect(claim.claimId)));
  }

  async listAgents(): Promise<AgentDirectoryEntry[]> {
    const [agents, jurySeats, votePackages, reveals, certificates, payoutTickets] =
      await Promise.all([
        this.#repository.listAgentManifests(),
        this.#repository.listAllJurySeats(),
        this.#repository.listAllVotePackages(),
        this.#repository.listAllReveals(),
        this.#repository.listAllResolutionCertificates(),
        this.#repository.listAllPayoutTickets(),
      ]);
    const trackRecords = new Map<string, AgentTrackRecord>();
    for (const seat of jurySeats) {
      trackRecordFor(trackRecords, seat.agentProfileId).seatsServed += 1;
    }
    for (const votePackage of votePackages) {
      const trackRecord = trackRecordFor(trackRecords, votePackage.agentProfileId);
      if (votePackage.committed) trackRecord.committed += 1;
      if (votePackage.revealed) trackRecord.revealed += 1;
    }
    const certificateByClaim = new Map(
      certificates.map((certificate) => [certificate.claimId, certificate]),
    );
    for (const reveal of reveals) {
      if (!reveal.valid) continue;
      const certificate = certificateByClaim.get(reveal.claimId);
      if (
        certificate !== undefined &&
        outcomeLabel(reveal.outcome) === certificate.result
      ) {
        trackRecordFor(trackRecords, reveal.agentProfileId).agreedWithCertificate += 1;
      }
    }
    const earnedMistByOwner = new Map<string, bigint>();
    for (const payoutTicket of payoutTickets) {
      if (payoutTicket.reason !== JURY_REWARD_REASON) continue;
      const owner = payoutTicket.recipient.toLowerCase();
      earnedMistByOwner.set(
        owner,
        (earnedMistByOwner.get(owner) ?? 0n) + BigInt(payoutTicket.amount),
      );
    }

    return agents.map((record) => {
      const staker = record.manifest.stakerAddress;
      // A staked seat's rewards go to its staker, an older seat's to its owner.
      // Both are summed, and a set keeps a self-staked seat counted once.
      const recipients = new Set([record.manifest.owner.toLowerCase()]);
      if (staker) recipients.add(staker.toLowerCase());
      let earnedMist = 0n;
      for (const recipient of recipients) {
        earnedMist += earnedMistByOwner.get(recipient) ?? 0n;
      }
      return {
        agentProfileId: record.manifest.agentProfileId,
        owner: record.manifest.owner,
        modelId: record.manifest.modelId,
        role: record.role,
        manifestHash: record.manifest.manifestHash,
        active: record.active,
        reputation: record.reputation,
        backing: agentBackingStatus(record.manifest.humanVerificationProvider),
        trackRecord: trackRecordFor(trackRecords, record.manifest.agentProfileId),
        ...(staker === undefined ? {} : { staker }),
        ...(record.manifest.stakeMist === undefined
          ? {}
          : { stakeMist: record.manifest.stakeMist }),
        earnedMist: String(earnedMist),
      };
    });
  }

  /** Proof persistence surface consumed by lib/verify/public-run-proof. */
  async getStoredRunProof(runId: string): Promise<RunProofRecord | undefined> {
    return this.#repository.getRunProof(runId);
  }

  async saveStoredRunProof(
    record: RunProofRecord,
    options: { replace: boolean },
  ): Promise<void> {
    if (options.replace) await this.#repository.replaceRunProof(record);
    else await this.#repository.saveRunProof(record);
  }

  /** Builds and stores every revealed run's proof, strictly one at a time. */
  private async warmRunProofs(claimId: string): Promise<void> {
    // The warmer runs detached from finalize, so nothing here may ever
    // reject: a torn-down store (tests, shutdown) only logs and stops.
    try {
      const reveals = [
        ...(await this.#repository.listReveals(claimId, 1)),
        ...(await this.#repository.listReveals(claimId, 2)),
      ];
      for (const reveal of reveals) {
        try {
          await getOrBuildPublicRunProof(this, claimId, reveal.runId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `run proof warm: claim ${claimId} run ${reveal.runId} failed: ${message}\n`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`run proof warm: claim ${claimId} failed: ${message}\n`);
    }
  }

  async runProof(claimId: string, runId: string): Promise<RunProofResult> {
    const claim = await this.claim(claimId);
    const run = (await this.#repository.listInferenceRuns(claimId)).find(
      (candidate) => candidate.runId === runId,
    );
    if (!run) {
      throw new EngineValidationError(
        `inference run ${runId} was not found for claim ${claimId}`,
      );
    }
    const common = {
      runId: run.runId,
      claimId: run.claimId,
      phase: run.phase,
      agentProfileId: run.agentProfileId,
      jurySeatId: run.jurySeatId,
      promptHash: run.promptHash,
      inputHash: run.inputHash,
      outputHash: run.outputHash,
      gateway: {
        ...(run.audit.gatewayRequestId === undefined
          ? {}
          : { gatewayRequestId: run.audit.gatewayRequestId }),
        ...(run.audit.devshardId === undefined
          ? {}
          : { devshardId: run.audit.devshardId }),
        ...(run.audit.systemFingerprint === undefined
          ? {}
          : { systemFingerprint: run.audit.systemFingerprint }),
      },
      claimDeadlines: {
        firstRevealDeadlineMs: claim.deadlines.firstRevealDeadlineMs,
        secondRevealDeadlineMs: claim.deadlines.secondRevealDeadlineMs,
      },
      ...(this.#manifest.seal === undefined
        ? {}
        : {
            sealPolicy: {
              packageId: this.#manifest.seal.packageId as `0x${string}`,
              threshold: this.#manifest.seal.threshold,
              keyServers: this.#manifest.seal.keyServers.map((server) => ({
                ...server,
                objectId: server.objectId as `0x${string}`,
              })),
            },
          }),
    };
    if (run.failure) {
      return {
        ...common,
        runHash: null,
        sealedBlobId: null,
        sealed: null,
        revealedBlobId: null,
        revealed: false,
        bundle: null,
        failure: run.failure,
      };
    }
    if (!run.runHash) {
      throw new EngineValidationError(
        `inference run ${runId} has no validated run hash`,
      );
    }
    const sealedBlobId = run.sealedBlobId ?? null;
    const revealedBlobId = run.revealedBlobId ?? null;
    // Both blobs live on Walrus and testnet reads are slow; fetch them
    // together instead of back to back.
    const [sealedBytes, revealedBytes] = await Promise.all([
      sealedBlobId === null ? null : this.#walrus.get(sealedBlobId),
      revealedBlobId === null ? null : this.#walrus.get(revealedBlobId),
    ]);
    const sealed =
      sealedBytes === null
        ? null
        : JSON.parse(new TextDecoder().decode(sealedBytes)) as SealedRunBundleV2;
    const bundle =
      revealedBytes === null
        ? null
        : JSON.parse(new TextDecoder().decode(revealedBytes)) as PublicRunBundle;
    return {
      ...common,
      runHash: run.runHash,
      sealedBlobId,
      sealed,
      revealedBlobId,
      revealed: revealedBlobId !== null,
      bundle,
    };
  }

  async agentManifestDocument(
    agentProfileId: string,
  ): Promise<AgentManifestDocument | null> {
    const record = await this.#repository.getAgentManifest(agentProfileId);
    if (
      !record ||
      (record.manifest.version !== "2" &&
        record.manifest.version !== "3" &&
        record.manifest.version !== "4" &&
        record.manifest.version !== "5" &&
        record.manifest.version !== "6")
    ) {
      return null;
    }
    const bytes = await this.#walrus.get(record.manifest.manifestBlobId);
    try {
      return parseAgentManifestDocument(bytes);
    } catch {
      return null;
    }
  }

  /** Keep sealing, approval and persistence identical across both run kinds. */
  private async finishSeatRun(params: {
    claim: ClaimRecord;
    committee: CommitteeRecord;
    seat: JurySeatRecord;
    agent: AgentManifestRecord;
    evidence: EvidenceManifestRecord;
    input: OracleInferenceInput | TableVoteInput;
    runResult: GonkaRunResult;
    output: OracleInferenceOutput;
    transcript: ResearchTranscriptV1 | null;
    promptHash: HexString;
    buildCore: (
      audit: InferenceRunAudit,
      runHash: HexString,
    ) => PublicRunBundleCore;
    commitFloorMs: number;
    /** What the model calls for this seat cost, for the run_approved timings. */
    modelMs: number;
  }): Promise<void> {
    const adapterAudit = await this.#gonka.buildRunAudit(params.runResult);
    const normalized = {
      gonkaRequestId: adapterAudit.gonkaRequestId,
      modelId: adapterAudit.responseModelId ?? adapterAudit.modelId,
      output: params.output,
    };
    // One canonical run ID spans visible retry attempts for this jury seat.
    const runId = params.input.runId as HexString;
    const outputHash = toHex(blake2b256(canonicalJsonBytes(normalized.output)));
    const toolTranscriptHash = params.transcript === null
      ? EMPTY_TOOL_TRANSCRIPT_HASH
      : transcriptHash(params.transcript);
    const audit: InferenceRunAudit = {
      ...adapterAudit,
      runId,
      claimObjectId: params.claim.claimId as HexString,
      agentProfileId: params.seat.agentProfileId as HexString,
      jurySeatId: params.seat.jurySeatId as HexString,
      phase: params.seat.phase,
      modelId: params.agent.manifest.modelId,
      responseModelId: normalized.modelId,
      gonkaRequestId: normalized.gonkaRequestId,
      promptHash: params.promptHash,
      inputHash: hashCanonicalJson(params.input),
      outputHash,
      // The sealed blob ID is known only after this core is encrypted and uploaded.
      runWalrusBlobId: "",
      toolTranscriptHash,
      toolTranscriptWalrusBlobId: "",
      toolCallCount:
        params.transcript === null
          ? 0
          : params.transcript.counts.searches + params.transcript.counts.opens,
      evidenceRoot: params.evidence.root,
      ...params.runResult.gateway,
      status: "SCHEMA_VALID",
    };
    const runHash = toHex(
      computeRunHash({
        run_id: audit.runId,
        claim_object_id: params.claim.claimId,
        agent_profile_id: params.seat.agentProfileId,
        jury_seat_id: params.seat.jurySeatId,
        phase: params.seat.phase,
        attempt: audit.attempt,
        provider_id: "gonkarouter",
        model_id: params.agent.manifest.modelId,
        gonka_request_id: normalized.gonkaRequestId,
        prompt_hash: fromHex(params.promptHash),
        input_hash: fromHex(audit.inputHash),
        output_hash: fromHex(outputHash),
        tool_transcript_hash: fromHex(audit.toolTranscriptHash),
        evidence_root: fromHex(params.evidence.root),
        requested_at_ms: audit.requestedAtMs,
        completed_at_ms: audit.completedAtMs,
      }),
    );
    const core = params.buildCore(audit, runHash);
    const bundleCore = new TextDecoder().decode(canonicalCoreBytes(core));
    const sealStartedAt = performance.now();
    const { sealed, seal } = sealRunBundle(core, { runId: audit.runId });
    const sealMs = since(sealStartedAt);
    let sealedDocument = sealed;
    let escrowMs = 0;
    const escrowStartedAt = performance.now();
    if (this.#sealEscrow) {
      const deadlineMs =
        params.seat.phase === 1
          ? params.claim.deadlines.firstRevealDeadlineMs
          : params.claim.deadlines.secondRevealDeadlineMs;
      try {
        const escrow = await this.#sealEscrow.escrowKey({
          claimId: params.claim.claimId as HexString,
          jurySeatId: params.seat.jurySeatId as HexString,
          phase: params.seat.phase,
          deadlineMs,
          runId: audit.runId,
          keyBytes: fromHex(seal.keyHex),
        });
        sealedDocument = { ...sealed, escrow };
      } catch (error) {
        // Escrow is insurance and must never cost a jury seat.
        process.stderr.write(
          `seal-escrow failed: claim ${params.claim.claimId} seat ${params.seat.jurySeatId}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
      escrowMs = since(escrowStartedAt);
    }
    const uploadStartedAt = performance.now();
    const sealedUpload = await this.#walrus.put(
      canonicalJsonBytes(sealedDocument),
      { identifier: `${runId}-sealed-run-bundle.json` },
    );
    const uploadMs = since(uploadStartedAt);
    const retainedUntil = endEpoch(sealedUpload) ?? MAX_LOCAL_WALRUS_EPOCH;
    // The database keeps the Walrus epoch (renewals); the chain gets Sui epochs.
    const chainRetainedUntil = await this.chainRetentionEpoch(
      endEpoch(sealedUpload),
    );
    const approveStartedAt = performance.now();
    const approval = await this.#gateway.approveRun({
      claimId: params.claim.claimId,
      committeeId: params.committee.committeeId,
      jurySeatId: params.seat.jurySeatId,
      agentProfileId: params.seat.agentProfileId,
      agentOwner: params.seat.agentOwner,
      phase: params.seat.phase,
      runHash: fromHex(runHash),
      runBlobId: sealedUpload.blobId,
      runBlobObjectId: sealedUpload.objectId ?? ZERO_OBJECT_ID,
      toolBlobId: sealedUpload.blobId,
      toolBlobObjectId: sealedUpload.objectId ?? ZERO_OBJECT_ID,
      walrusEndEpoch: chainRetainedUntil,
    });
    const approveMs = since(approveStartedAt);
    const timestamp = this.isoNow();
    const storedAudit: InferenceRunRecord["audit"] = {
      ...audit,
      runWalrusBlobId: sealedUpload.blobId,
      toolTranscriptWalrusBlobId: sealedUpload.blobId,
      bundleCore,
    };
    const run: InferenceRunRecord = {
      runId: audit.runId,
      claimId: params.claim.claimId,
      phase: params.seat.phase,
      agentProfileId: params.seat.agentProfileId,
      jurySeatId: params.seat.jurySeatId,
      attempt: audit.attempt,
      providerId: "gonkarouter",
      modelId: params.agent.manifest.modelId,
      gonkaRequestId: normalized.gonkaRequestId,
      promptHash: params.promptHash,
      inputHash: audit.inputHash,
      outputHash,
      runHash,
      runWalrusBlobId: sealedUpload.blobId,
      ...(sealedUpload.objectId === undefined
        ? {}
        : { runWalrusObjectId: sealedUpload.objectId }),
      sealKeyHex: seal.keyHex,
      sealIvHex: seal.ivHex,
      coreHash: seal.coreHash,
      sealedBlobId: sealedUpload.blobId,
      ...(sealedUpload.objectId === undefined
        ? {}
        : { sealedObjectId: sealedUpload.objectId }),
      toolTranscriptHash: audit.toolTranscriptHash,
      toolTranscriptWalrusBlobId: sealedUpload.blobId,
      ...(sealedUpload.objectId === undefined
        ? {}
        : { toolTranscriptWalrusObjectId: sealedUpload.objectId }),
      walrusEndEpoch: retainedUntil,
      evidenceRoot: params.evidence.root,
      validationStatus: "SCHEMA_VALID",
      latencyMs: audit.latencyMs,
      ...(audit.inputTokens === undefined ? {} : { inputTokens: audit.inputTokens }),
      ...(audit.outputTokens === undefined ? {} : { outputTokens: audit.outputTokens }),
      output: normalized.output,
      audit: storedAudit,
      requestedAt: new Date(audit.requestedAtMs).toISOString(),
      completedAt: new Date(audit.completedAtMs).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveInferenceRun(run);
    const approvalRecord: RunApprovalRecord = {
      runApprovalId: approval.runApprovalId,
      runId: run.runId,
      claimId: params.claim.claimId,
      jurySeatId: params.seat.jurySeatId,
      agentProfileId: params.seat.agentProfileId,
      runHash,
      transactionDigest: approval.digest,
      attestor: "operator",
      validationErrors: [],
      consumed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveRunApproval(approvalRecord);
    await this.updateSeat(params.seat.jurySeatId, {
      status: "RUN_APPROVED",
      runHash,
    });
    await this.emitRunApproval(params.claim.claimId, run, approvalRecord, {
      model: params.modelMs,
      seal: sealMs,
      escrow: escrowMs,
      upload: uploadMs,
      approve: approveMs,
    });
    // A finished seat commits immediately once the chain accepts the lock.
    if (this.#now() >= params.commitFloorMs) {
      await this.queueCommit(params.claim.claimId, params.seat.phase);
    }
  }

  /**
   * Move compares retention epochs with ctx.epoch(), the SUI epoch, while
   * Walrus reports its own epoch numbers; convert before anything goes on
   * chain. Local stores have no retention clock, so they keep the sentinel.
   */
  private async chainRetentionEpoch(
    walrusEndEpoch: number | undefined,
  ): Promise<number> {
    if (walrusEndEpoch === undefined || this.#walrus.epochInfo === undefined) {
      return MAX_LOCAL_WALRUS_EPOCH;
    }
    const [walrus, sui] = await Promise.all([
      this.#walrus.epochInfo(),
      this.#gateway.epochInfo(),
    ]);
    return toChainRetentionEpoch({
      walrusEndEpoch,
      walrusCurrentEpoch: walrus.currentEpoch,
      walrusEpochDurationMs: walrus.epochDurationMs,
      suiCurrentEpoch: sui.currentEpoch,
      suiEpochDurationMs: sui.epochDurationMs,
    });
  }

  async status(): Promise<EngineStatus> {
    const [sui, dbHealthy] = await Promise.all([
      this.#gateway.health(),
      this.#repository.healthy(),
    ]);
    return {
      appVersion: "0.1.0",
      network: this.#manifest.network,
      packageId: this.#manifest.packageId,
      registryObjectId: this.#manifest.registryObjectId,
      suiHealthy: sui.healthy,
      ...(sui.latestCheckpoint === undefined
        ? {}
        : { latestCheckpoint: sui.latestCheckpoint }),
      gonkaMode: this.#manifest.gonka.mode,
      walrusMode: this.#manifest.walrus.mode,
      dbHealthy,
      paused: sui.paused,
    };
  }

  async *events(
    claimId: string,
    fromSequence = 1,
  ): AsyncIterable<ResolutionEvent> {
    let nextSequence = Math.max(1, fromSequence);
    while (true) {
      const rows = await this.#repository.listResolutionEvents(claimId, nextSequence);
      const revealedRunIds = await this.#repository.revealedRunIds(claimId);
      for (const row of rows) {
        nextSequence = Math.max(nextSequence, row.sequence + 1);
        const publicEvent = serializePublicEvent(row, { revealedRunIds });
        if (publicEvent) yield publicEvent;
      }
      const claim = await this.#repository.getClaim(claimId);
      if (claim === undefined) throw new ClaimNotFoundError(claimId);
      if (isTerminalState(claim.state) && rows.length === 0) return;
      await delay(this.#eventPollIntervalMs);
    }
  }

  private async createClaimRecord(
    request: Omit<ClaimCreateRequest, "deadlines"> & {
      /** Omitted for hosted fact-checks: the default ladder is measured from the transaction. */
      deadlines?: ClaimCreateRequest["deadlines"];
    },
    submission: {
      directReviewStarted: boolean;
      submittedText?: string;
      submittedUrls: string[];
    },
    relaunch?: VerificationRelaunchContext,
  ): Promise<ClaimRecord> {
    const ladder = (): ClaimCreateRequest["deadlines"] =>
      request.deadlines ?? defaultDeadlines(this.#now(), this.#manifest.network);
    validateClaimCreateRequest({ ...request, deadlines: ladder() });
    const [statementUpload, criteriaUpload] = await Promise.all([
      this.#walrus.put(
        new TextEncoder().encode(request.statement),
        { identifier: "claim-statement.txt" },
      ),
      this.#walrus.put(
        new TextEncoder().encode(request.resolutionCriteria),
        { identifier: "resolution-criteria.txt" },
      ),
    ]);
    const policyId = evidencePolicyId(this.#manifest);
    const contentHash = blake2b256(
      canonicalJsonBytes({
        statement: request.statement,
        resolutionCriteria: request.resolutionCriteria,
      }),
    );
    // The two writes above take about 35 s on testnet; a ladder computed at
    // the start of the request would already have spent its evidence cutoff
    // before the workers can see the claim, so measure it from here.
    const deadlines = ladder();
    validateClaimCreateRequest({ ...request, deadlines });
    const result = await this.#gateway.createClaim({
      ...request,
      deadlines,
      directReviewStarted: submission.directReviewStarted,
      contentHash,
      statementBlobId: statementUpload.blobId,
      criteriaBlobId: criteriaUpload.blobId,
      evidencePolicyId: fromHex(policyId),
    });
    const timestamp = this.isoNow();
    const claim: ClaimRecord = {
      claimId: result.claimId,
      network: this.#manifest.network,
      packageId: this.#manifest.packageId,
      registryObjectId: this.#manifest.registryObjectId,
      transactionDigest: result.digest,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
      packageVersion: 1,
      coinType: this.#manifest.coinType,
      mode: request.mode,
      state: submission.directReviewStarted
        ? CLAIM_STATE.REVIEW_REQUESTED
        : CLAIM_STATE.CREATED,
      ...(result.creator === undefined ? {} : { creator: result.creator }),
      statement: request.statement,
      resolutionCriteria: request.resolutionCriteria,
      deadlines,
      committeeBudget: request.committeeBudget,
      evidenceBudget: request.evidenceBudget,
      ...(submission.submittedText === undefined
        ? {}
        : { submittedText: submission.submittedText }),
      submittedUrls: submission.submittedUrls,
      statementBlobId: statementUpload.blobId,
      criteriaBlobId: criteriaUpload.blobId,
      evidencePolicyId: policyId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveClaim(claim);
    await this.#repository.saveVerificationAttempt({
      verificationId: relaunch?.verificationId ?? claim.claimId,
      claimId: claim.claimId,
      attempt: relaunch?.attempt ?? 1,
      ...(relaunch === undefined
        ? {}
        : { parentClaimId: relaunch.parentClaimId }),
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.emit({
      claimId: result.claimId,
      phase: "CREATE",
      kind: "claim_created",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: result,
      payload: {
        claim_id: result.claimId,
        claim_mode: request.mode,
        package_id: this.#manifest.packageId,
        transaction_digest: result.digest,
        checkpoint: result.checkpoint,
        policy_id: policyId,
        coin_type_hash: toHex(
          blake2b256(new TextEncoder().encode(this.#manifest.coinType)),
        ),
      },
    });
    return claim;
  }

  private async ingestFactCheckEvidence(
    claim: ClaimRecord,
    request: FactCheckRequest,
  ): Promise<void> {
    await this.ingestText(claim, claim.statement, 1, {
      evidenceLabel: `statement:${claim.claimId}:1`,
      sourceUrl: CLAIM_STATEMENT_SOURCE_URL,
    });
    const tasks: Promise<void>[] = request.urls.map((url, index) =>
      this.ingestUrl(claim, url, 1, `url-${index + 1}`),
    );
    if (request.text?.trim()) {
      tasks.push(this.ingestText(claim, request.text.trim(), 1));
    }
    await Promise.all(tasks);
  }

  private async ingestText(
    claim: ClaimRecord,
    text: string,
    phase: 1 | 2,
    options: {
      evidenceId?: string;
      evidenceLabel?: string;
      sourceUrl?: string;
    } = {},
  ): Promise<void> {
    const evidenceId =
      options.evidenceId ??
      deterministicId(options.evidenceLabel ?? `text:${claim.claimId}:${phase}`);
    const sourceUrl = options.sourceUrl ?? "urn:openverdict:submitted-text";
    const timestamp = this.isoNow();
    const submission: EvidenceSubmissionRecord = {
      submissionId: deterministicId(`submission:${evidenceId}`),
      evidenceId,
      claimId: claim.claimId,
      phase,
      submittedText: text,
      sourceClass: "USER_SUBMITTED",
      retrievalStatus: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceSubmission(submission);
    await this.emitEvidenceSubmitted(submission);
    const bytes = new TextEncoder().encode(text);
    const raw = await this.#walrus.put(bytes, { identifier: `${evidenceId}-raw.txt` });
    const canonical = await this.#walrus.put(bytes, {
      identifier: `${evidenceId}-canonical.txt`,
    });
    const completedAt = this.isoNow();
    await this.#repository.saveEvidenceArtifact({
      evidenceId,
      submissionId: submission.submissionId,
      claimId: claim.claimId,
      phase,
      sourceUrl,
      finalUrl: sourceUrl,
      sourceClass: "USER_SUBMITTED",
      mimeType: "text/plain",
      byteLength: bytes.byteLength,
      contentHash: toHex(blake2b256(bytes)),
      canonicalHash: toHex(blake2b256(bytes)),
      rawWalrusBlobId: raw.blobId,
      ...(raw.objectId === undefined ? {} : { rawWalrusObjectId: raw.objectId }),
      canonicalWalrusBlobId: canonical.blobId,
      ...(canonical.objectId === undefined
        ? {}
        : { canonicalWalrusObjectId: canonical.objectId }),
      ...(endEpoch(raw, canonical) === undefined
        ? {}
        : { walrusEndEpoch: endEpoch(raw, canonical) }),
      parserVersion: "utf8-text-v1",
      excerpt: text.slice(0, 500),
      retrievedAt: completedAt,
      createdAt: timestamp,
      updatedAt: completedAt,
    });
    await this.#repository.saveEvidenceSubmission({
      ...submission,
      retrievalStatus: "ACCEPTED",
      updatedAt: completedAt,
    });
    await this.emitEvidenceRetrieved(claim.claimId, evidenceId, "ACCEPTED", 0, bytes.byteLength);
  }

  private async ingestUrl(
    claim: ClaimRecord,
    url: string,
    phase: 1 | 2,
    suffix: string,
  ): Promise<void> {
    validateHttpsUrls([url]);
    const evidenceId = deterministicId(`url:${claim.claimId}:${phase}:${suffix}:${url}`);
    const startedAt = this.#now();
    const timestamp = new Date(startedAt).toISOString();
    const submission: EvidenceSubmissionRecord = {
      submissionId: deterministicId(`submission:${evidenceId}`),
      evidenceId,
      claimId: claim.claimId,
      phase,
      sourceUrl: url,
      sourceClass: "USER_SUBMITTED",
      retrievalStatus: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceSubmission(submission);
    await this.emitEvidenceSubmitted(submission);
    const retrieved = await this.#retrieve(url, this.#retrievalPolicy);
    if ("rejectionCode" in retrieved) {
      await this.#repository.saveEvidenceSubmission({
        ...submission,
        retrievalStatus: "REJECTED",
        rejectionCode: retrieved.rejectionCode,
        updatedAt: this.isoNow(),
      });
      await this.emitEvidenceRetrieved(
        claim.claimId,
        evidenceId,
        "REJECTED",
        Math.max(0, this.#now() - startedAt),
        0,
      );
      return;
    }
    await this.persistRetrievedArtifact(claim, submission, retrieved, startedAt);
  }

  private async persistRetrievedArtifact(
    claim: ClaimRecord,
    submission: EvidenceSubmissionRecord,
    retrieved: RetrievedArtifact,
    startedAt: number,
  ): Promise<void> {
    const canonical = canonicalArtifact(retrieved);
    const rawUpload = await this.#walrus.put(retrieved.bytes, {
      identifier: `${submission.evidenceId}-raw`,
    });
    const canonicalBytes = new TextEncoder().encode(canonical.text);
    const canonicalUpload = await this.#walrus.put(canonicalBytes, {
      identifier: `${submission.evidenceId}-canonical.txt`,
    });
    const timestamp = this.isoNow();
    const artifact: EvidenceArtifactRecord = {
      evidenceId: submission.evidenceId,
      submissionId: submission.submissionId,
      claimId: claim.claimId,
      phase: submission.phase,
      sourceUrl: submission.sourceUrl ?? retrieved.finalUrl,
      finalUrl: retrieved.finalUrl,
      mimeType: retrieved.mimeType,
      byteLength: retrieved.byteLength,
      contentHash: toHex(retrieved.contentHash),
      canonicalHash: toHex(blake2b256(canonicalBytes)),
      rawWalrusBlobId: rawUpload.blobId,
      ...(rawUpload.objectId === undefined
        ? {}
        : { rawWalrusObjectId: rawUpload.objectId }),
      canonicalWalrusBlobId: canonicalUpload.blobId,
      ...(canonicalUpload.objectId === undefined
        ? {}
        : { canonicalWalrusObjectId: canonicalUpload.objectId }),
      ...(endEpoch(rawUpload, canonicalUpload) === undefined
        ? {}
        : { walrusEndEpoch: endEpoch(rawUpload, canonicalUpload) }),
      parserVersion: canonical.parserVersion,
      excerpt: canonical.text.slice(0, 500),
      retrievedAt: new Date(retrieved.retrievedAt).toISOString(),
      createdAt: submission.createdAt,
      updatedAt: timestamp,
    };
    await this.#repository.saveEvidenceArtifact(artifact);
    await this.#repository.saveEvidenceSubmission({
      ...submission,
      retrievalStatus: "ACCEPTED",
      updatedAt: timestamp,
    });
    await this.emitEvidenceRetrieved(
      claim.claimId,
      submission.evidenceId,
      "ACCEPTED",
      Math.max(0, this.#now() - startedAt),
      retrieved.byteLength,
    );
  }

  /** Cast round two from frozen public material without opening new pages. */
  private async runTableVoteSeat(
    claim: ClaimRecord,
    committee: CommitteeRecord,
    seat: JurySeatRecord,
    evidence: EvidenceManifestRecord,
    artifacts: EvidenceArtifactRecord[],
    priorRound: PriorRoundPublicRecord,
    debate: TableVoteDebateTurn[],
    convergedAfterExchange: 1 | 2 | 3 | null,
    deliberationSpecVersion: "4" | undefined,
    seatDeadlineMs: number,
    commitFloorMs: number,
  ): Promise<void> {
    const agent = await this.requiredAgent(seat.agentProfileId);
    const tableVotePromptHash = agent.manifest.tableVotePromptHash;
    if (tableVotePromptHash === undefined) {
      throw new EngineValidationError(
        `agent ${seat.agentProfileId} has no table vote prompt hash; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
    const baseRunId = deterministicId(
      `run:${claim.claimId}:${seat.jurySeatId}:${seat.phase}`,
    );
    const evidenceManifest = oracleEvidenceManifest(evidence, artifacts);
    let failureInput: InferenceFailureInput = {
      kind: "TABLE_VOTE",
      runId: baseRunId,
      evidenceManifest,
    };
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "inference_started",
      source: "GONKA_ROUTER",
      visibility: "INTERNAL_REDACTED",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: {
        run_id: baseRunId,
        agent_id: seat.agentProfileId,
        provider_id: "gonkarouter",
        model_id: agent.manifest.modelId,
        attempt: 1,
      },
    });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: { genericStage: "INFERENCE", status: "RUNNING", latencyMs: 0 },
    });

    try {
      const [firstTally, firstReveals, firstRuns] = await Promise.all([
        this.requiredTally(claim.claimId, 1),
        this.#repository.listReveals(claim.claimId, 1),
        this.#repository.listInferenceRuns(claim.claimId, 1),
      ]);
      const firstReveal = firstReveals.find(
        (reveal) => reveal.agentProfileId === seat.agentProfileId,
      );
      const firstRun = firstRuns.find(
        (run) => run.agentProfileId === seat.agentProfileId,
      );
      const seatIndex = firstReveal === undefined
        ? -1
        : firstTally.expectedJurySeatIds.indexOf(firstReveal.jurySeatId);
      if (
        firstReveal === undefined ||
        firstRun?.output === undefined ||
        firstReveal.runId !== firstRun.runId ||
        seatIndex < 0
      ) {
        throw new EngineStateError(
          `table vote seat ${seat.jurySeatId} is missing its round one output`,
        );
      }
      const input: TableVoteInput = {
        protocolVersion: "1.0",
        kind: "TABLE_VOTE",
        runId: baseRunId,
        agentRole: agent.role,
        claim: {
          statement: claim.statement,
          resolutionCriteria: claim.resolutionCriteria,
        },
        evidenceManifest,
        // A V4 transcript numbers seats from 1, so the table sees both the
        // index it always had and the number the debate used.
        priorRound: deliberationSpecVersion === undefined
          ? priorRound
          : {
              ...priorRound,
              seats: priorRound.seats.map((seat) => ({
                ...seat,
                seatNumber: seat.seatIndex + 1,
              })),
            },
        debate,
        convergedAfterExchange,
        // Which debate contract produced the transcript above, when not V3.
        ...(deliberationSpecVersion === undefined
          ? {}
          : { deliberationSpecVersion }),
        self: {
          seatIndex,
          ...(deliberationSpecVersion === undefined
            ? {}
            : { seatNumber: seatIndex + 1 }),
          role: agent.role,
          roundOneOutcome: outcomeLabel(firstReveal.outcome),
          roundOneConfidenceBps: firstReveal.confidenceBps,
          roundOneOutput: firstRun.output,
        },
        outputContract: {
          requiredOutcome: true,
          requiredEvidenceIds: true,
          maximumReasonLength: 4_000,
        },
      };
      failureInput = input;
      const messages = buildTableVoteMessages(TABLE_VOTE_PROMPT_SPEC_V1, input);
      const attempts: GonkaAttemptRecord[] = [];
      // Every model call for this seat, retries included, is the "model" leg
      // of the run_approved timings.
      const modelStartedAt = performance.now();
      let lastError: unknown = new Error("table vote produced no valid output");
      for (let call = 0; call < 2; call += 1) {
        const remainingMs = seatDeadlineMs - this.#now();
        if (remainingMs <= 0) {
          lastError = Object.assign(new Error("table vote seat deadline elapsed"), {
            name: "TimeoutError",
          });
          break;
        }
        const completion = await this.#gonka.complete({
          manifest: {
            ...agent.manifest,
            promptHash: tableVotePromptHash,
          },
          messages,
          kind: "PRIMARY",
          jsonMode: true,
          input,
          attempts,
          timeoutMs: Math.min(120_000, remainingMs),
          maxOutputTokens: TABLE_VOTE_PROMPT_SPEC_V1.maxOutputTokens,
        });
        if (!completion.ok) {
          lastError = completion.error;
          continue;
        }
        const modelMs = since(modelStartedAt);
        const validated = validateTableVote(completion.content, {
          frozenEvidenceIds: evidenceManifest.items.map(
            (item) => item.evidenceId,
          ),
          maximumReasonLength: input.outputContract.maximumReasonLength,
        });
        if (!validated.ok) {
          // Keep invalid attempts visible even when the second call succeeds.
          completion.attempt.audit.status = "INVALID_SCHEMA";
          lastError = new Error(validated.errors.join("; "));
          continue;
        }
        completion.attempt.audit.status = "SCHEMA_VALID";
        if (validated.repairs.length > 0) {
          // Publish the repair before the seat commit so auditors see it in order.
          await this.emit({
            claimId: claim.claimId,
            phase: claimStateName(claim.state),
            kind: "output_repaired",
            source: "ENGINE",
            visibility: "PUBLIC_NOW",
            actorId: seat.agentProfileId,
            runId: baseRunId,
            payload: {
              claim_id: claim.claimId,
              jury_seat_id: seat.jurySeatId,
              agent_profile_id: seat.agentProfileId,
              run_id: baseRunId,
              phase: 2,
              field: "unsupportedClaims",
              dropped: validated.repairs,
            },
          });
        }
        const runResult: GonkaRunResult = {
          type: "gonka-run-result",
          attempts,
          response: completion.response,
          request: completion.request,
          gateway: completion.gateway,
        };
        await this.finishSeatRun({
          claim,
          committee,
          seat,
          agent,
          evidence,
          input,
          runResult,
          output: validated.output,
          transcript: null,
          modelMs,
          promptHash: tableVotePromptHash,
          buildCore: (audit, runHash) =>
            buildTableVoteBundleCore({
              input,
              runResult,
              validatedOutput: validated.output,
              audit,
              runHash,
              promptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
            }),
          commitFloorMs,
        });
        return;
      }
      throw new GonkaRunError(
        lastError instanceof Error ? lastError.message : String(lastError),
        attempts,
      );
    } catch (error) {
      await this.persistInferenceFailure(
        claim,
        seat,
        agent,
        failureInput,
        error,
      );
    }
  }

  private async runSeat(
    claim: ClaimRecord,
    committee: CommitteeRecord,
    seat: JurySeatRecord,
    evidence: EvidenceManifestRecord,
    artifacts: EvidenceArtifactRecord[],
    priorRound: PriorRoundPublicRecord | undefined,
    research: ResearchProvider,
    searchCache: SearchCache,
    storedPageCache: Map<string, Promise<PageStorePage>>,
    pageUploads: Map<string, Promise<void>>,
    researchConfig: SeatResearchConfig,
    seatDeadlineMs: number,
    commitFloorMs: number,
  ): Promise<void> {
    const agent = await this.requiredAgent(seat.agentProfileId);
    const baseRunId = deterministicId(`run:${claim.claimId}:${seat.jurySeatId}:${seat.phase}`);
    const input = oracleInput(
      claim,
      seat,
      evidence,
      artifacts,
      priorRound,
      agent.role,
      baseRunId,
      researchConfig.spec.version,
    );
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "inference_started",
      source: "GONKA_ROUTER",
      visibility: "INTERNAL_REDACTED",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: {
        run_id: baseRunId,
        agent_id: seat.agentProfileId,
        provider_id: "gonkarouter",
        model_id: agent.manifest.modelId,
        attempt: 1,
      },
    });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: baseRunId,
      payload: { genericStage: "INFERENCE", status: "RUNNING", latencyMs: 0 },
    });

    try {
      const pages: PageStore = {
        lookup: async (evidenceId) => {
          const pending = storedPageCache.get(evidenceId);
          if (pending) return pending;
          const record = await this.#repository.getEvidenceArtifact(evidenceId);
          if (!record || record.sourceClass !== "DISCOVERED") return undefined;
          const text = new TextDecoder().decode(
            await this.#walrus.get(record.canonicalWalrusBlobId),
          );
          const stored: PageStorePage = {
            evidenceId,
            url: record.sourceUrl,
            finalUrl: record.finalUrl,
            ...(record.title === undefined ? {} : { title: record.title }),
            text,
            totalChars: text.length,
            truncated: record.byteLength > text.length,
            contentHash: record.contentHash,
            canonicalHash: record.canonicalHash,
            canonicalWalrusBlobId: record.canonicalWalrusBlobId,
          };
          storedPageCache.set(evidenceId, Promise.resolve(stored));
          return stored;
        },
        store: async (page, meta) => {
          const existing = storedPageCache.get(meta.evidenceId);
          if (existing) return existing;
          const truncated = page.markdown.length > meta.maxPageChars;
          const text = truncated
            ? page.markdown.slice(0, meta.maxPageChars)
            : page.markdown;
          const bytes = new TextEncoder().encode(text);
          const hash = toHex(blake2b256(bytes));
          const identifier = `${meta.evidenceId}-discovered.md`;
          const stored = (blobId: string): PageStorePage => ({
            evidenceId: meta.evidenceId,
            url: meta.normalizedUrl,
            finalUrl: page.finalUrl,
            ...(page.title === undefined ? {} : { title: page.title }),
            text,
            totalChars: text.length,
            truncated,
            contentHash: hash,
            canonicalHash: hash,
            canonicalWalrusBlobId: blobId,
          });
          // Records the discovered page once its bytes are on Walrus.
          const persist = async (upload: WalrusPutResult): Promise<void> => {
            const timestamp = this.isoNow();
            const submissionId = deterministicId(`submission:${meta.evidenceId}`);
            await this.#repository.saveEvidenceSubmission({
              submissionId,
              evidenceId: meta.evidenceId,
              claimId: claim.claimId,
              phase: seat.phase,
              sourceUrl: meta.normalizedUrl,
              sourceClass: "DISCOVERED",
              retrievalStatus: "ACCEPTED",
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            await this.#repository.saveEvidenceArtifact({
              evidenceId: meta.evidenceId,
              submissionId,
              claimId: claim.claimId,
              phase: seat.phase,
              sourceUrl: meta.normalizedUrl,
              finalUrl: page.finalUrl,
              mimeType: "text/markdown",
              byteLength: new TextEncoder().encode(page.markdown).byteLength,
              contentHash: hash,
              canonicalHash: hash,
              rawWalrusBlobId: upload.blobId,
              canonicalWalrusBlobId: upload.blobId,
              ...(upload.objectId === undefined
                ? {}
                : {
                    rawWalrusObjectId: upload.objectId,
                    canonicalWalrusObjectId: upload.objectId,
                  }),
              ...(upload.endEpoch === undefined
                ? {}
                : { walrusEndEpoch: upload.endEpoch }),
              parserVersion: "firecrawl-markdown-v1",
              ...(page.title === undefined ? {} : { title: page.title }),
              excerpt: text.slice(0, 500),
              retrievedAt: new Date(page.fetchedAtMs).toISOString(),
              createdAt: timestamp,
              updatedAt: timestamp,
              sourceClass: "DISCOVERED",
              discoveredByRunId: input.runId,
            });
          };
          const walrus = this.#walrus;
          const blobId = walrus.blobIdFor ? await walrus.blobIdFor(bytes) : undefined;
          if (blobId === undefined) {
            // No content address ahead of the write: upload before the model sees the page.
            const pending = (async (): Promise<PageStorePage> => {
              const upload = await walrus.put(bytes, { identifier });
              await persist(upload);
              return stored(upload.blobId);
            })();
            storedPageCache.set(meta.evidenceId, pending);
            try {
              return await pending;
            } catch (error) {
              if (storedPageCache.get(meta.evidenceId) === pending) {
                storedPageCache.delete(meta.evidenceId);
              }
              throw error;
            }
          }
          // Walrus blob ids are content addresses, so the id is known before
          // the write (about 14 s on testnet). Hand the page to the model now
          // and upload in the background; every seat awaits the uploads of the
          // pages it opened before sealing, so a failed write still fails that
          // seat closed.
          const upload = (async (): Promise<void> => {
            const result = await walrus.put(bytes, { identifier });
            if (result.blobId !== blobId) {
              throw new Error(
                `discovered page ${meta.evidenceId} uploaded as ${result.blobId}, expected ${blobId}`,
              );
            }
            await persist(result);
          })();
          // The seats that opened the page observe the rejection; never leave it unhandled.
          upload.catch(() => undefined);
          pageUploads.set(meta.evidenceId, upload);
          const ready = stored(blobId);
          storedPageCache.set(meta.evidenceId, Promise.resolve(ready));
          return ready;
        },
      };
      // The research loop is this seat's model time: many calls, one budget.
      const modelStartedAt = performance.now();
      const loop = await runResearchLoop({
        complete: (request) => this.#gonka.complete(request),
        provider: research,
        policy: researchConfig.policy,
        spec: researchConfig.spec,
        input,
        manifest: agent.manifest,
        claimId: claim.claimId,
        phase: seat.phase,
        pages,
        searchCache,
        now: this.#now,
        sleep: this.#sleep,
        deadlineMs: seatDeadlineMs,
        onStep: (step) => {
          // RESEARCH_TICK keeps its original shape for older clients: the two
          // tool actions only, activity shape only. An allowlist, so a fourth
          // step kind never leaks into the legacy event by default.
          if (step.kind === "search" || step.kind === "open") {
            void this.emit({
              claimId: claim.claimId,
              phase: `INFERENCE_${seat.phase}`,
              kind: "RESEARCH_TICK",
              source: "ENGINE",
              visibility: "PUBLIC_NOW",
              actorId: seat.agentProfileId,
              runId: baseRunId,
              payload: {
                jurySeatId: seat.jurySeatId,
                kind: step.kind,
                ordinal: step.ordinal,
              },
            }).catch(() => undefined);
          }
          // The live feed: public web material only, and it cannot fail the seat.
          void this.emit(
            researchStepEvent({ claim, seat, runId: baseRunId, step }),
          ).catch(() => undefined);
        },
      });
      const modelMs = since(modelStartedAt);
      if (!loop.ok) {
        throw new ResearchLoopError(
          loop.status,
          loop.message,
          loop.attempts,
          loop.transcript,
        );
      }
      // Every page this run opened must be on Walrus before the run is sealed
      // and cited on chain; a failed background upload fails the seat closed.
      await Promise.all(
        loop.opened.map((page) => pageUploads.get(page.evidenceId)),
      );
      const response: GonkaRunResult = {
        type: "gonka-run-result",
        attempts: loop.attempts,
        response: loop.response,
        request: loop.request,
        gateway: loop.gateway,
      };
      if (loop.repairs.length > 0) {
        // The vote and every other evidentiary field still passed strict validation.
        await this.emit({
          claimId: claim.claimId,
          phase: claimStateName(claim.state),
          kind: "output_repaired",
          source: "ENGINE",
          visibility: "PUBLIC_NOW",
          actorId: seat.agentProfileId,
          runId: baseRunId,
          payload: {
            claim_id: claim.claimId,
            jury_seat_id: seat.jurySeatId,
            agent_profile_id: seat.agentProfileId,
            run_id: baseRunId,
            phase: 1,
            field: "unsupportedClaims",
            dropped: loop.repairs,
          },
        });
      }
      await this.finishSeatRun({
        claim,
        committee,
        seat,
        agent,
        evidence,
        input,
        runResult: response,
        output: loop.output,
        transcript: loop.transcript,
        modelMs,
        promptHash: agent.manifest.promptHash,
        buildCore: (audit, runHash) => {
          const bundleParams = {
            input,
            runResult: response,
            validatedOutput: loop.output,
            audit,
            runHash,
            transcript: loop.transcript,
          };
          if (researchConfig.bundleVersion === 5) {
            return buildRunBundleCore({
              ...bundleParams,
              promptSpec: researchConfig.spec,
              toolPolicy: researchConfig.policy,
            });
          }
          if (researchConfig.bundleVersion === 4) {
            return buildRunBundleCore({
              ...bundleParams,
              promptSpec: researchConfig.spec,
              toolPolicy: researchConfig.policy,
            });
          }
          return buildRunBundleCore({
            ...bundleParams,
            promptSpec: researchConfig.spec,
            toolPolicy: researchConfig.policy,
          });
        },
        commitFloorMs,
      });
    } catch (error) {
      await this.persistInferenceFailure(claim, seat, agent, input, error);
      return;
    }
  }

  /**
   * Runs votesCommit for a claim after any earlier queued commit finished, so
   * seats finishing together never race on the lock or double-commit. A
   * failure (for example the committee's acceptance window still open on
   * chain) is logged; the next seat, or the worker's final votesCommit,
   * tries again.
   */
  private queueCommit(claimId: string, phase: 1 | 2): Promise<void> {
    const previous = this.#commitQueues.get(claimId) ?? Promise.resolve();
    const next = previous
      .then(() => this.votesCommit(claimId, phase))
      .then(
        () => undefined,
        (error: unknown) => {
          process.stderr.write(
            `commit after seat: claim ${claimId.slice(0, 10)}…: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
        },
      );
    this.#commitQueues.set(claimId, next);
    return next;
  }

  private async persistInferenceFailure(
    claim: ClaimRecord,
    seat: JurySeatRecord,
    agent: AgentManifestRecord,
    input: InferenceFailureInput,
    error: unknown,
  ): Promise<void> {
    // Surface the underlying cause: the audit row only keeps a category
    // (PROVIDER_ERROR etc.), which made real failures (an on-chain abort in
    // acceptJurySeat, a Walrus read error) invisible in operations.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `inference failed: claim ${claim.claimId.slice(0, 10)}… seat ${seat.jurySeatId.slice(0, 10)}… (${agent.manifest.modelId}): ${
        message
      }\n`,
    );
    const failedAudit = terminalFailureAudit(error);
    const timestampMs = this.#now();
    const runId = input.runId as `0x${string}`;
    const status =
      terminalFailureStatus(error) ?? failedAudit?.status ?? "PROVIDER_ERROR";
    const timestamp = new Date(timestampMs).toISOString();
    const zeroHash = hashCanonicalJson(null);
    const promptHash =
      "kind" in input && input.kind === "TABLE_VOTE"
        ? agent.manifest.tableVotePromptHash ?? agent.manifest.promptHash
        : agent.manifest.promptHash;
    let failure: InferenceFailureV1 = {
      version: 1,
      status,
      message,
      failedAtMs: timestampMs,
      transcript:
        error instanceof ResearchLoopError ? error.transcript ?? null : null,
      attempts:
        error instanceof GonkaRunError ? error.result.attempts : [],
    };
    try {
      const upload = await this.#walrus.put(canonicalJsonBytes(failure), {
        identifier: `${runId}-failed-run.json`,
      });
      failure = { ...failure, walrusBlobId: upload.blobId };
    } catch (uploadError) {
      // A Walrus outage must not hide the local failure audit.
      process.stderr.write(
        `failed-run upload: ${
          uploadError instanceof Error ? uploadError.message : String(uploadError)
        }\n`,
      );
    }
    const audit: InferenceRunAudit = {
      ...(failedAudit ?? {
        runId: runId as `0x${string}`,
        attempt: 1,
        providerId: "gonkarouter" as const,
        modelId: agent.manifest.modelId,
        gonkaRequestId: "",
        outputHash: zeroHash,
        runWalrusBlobId: "",
        toolTranscriptHash: EMPTY_TOOL_TRANSCRIPT_HASH,
        toolTranscriptWalrusBlobId: "",
        toolCallCount: 0,
        requestedAtMs: timestampMs,
        completedAtMs: timestampMs,
        latencyMs: 0,
        status,
      }),
      runId,
      claimObjectId: claim.claimId as `0x${string}`,
      agentProfileId: seat.agentProfileId as `0x${string}`,
      jurySeatId: seat.jurySeatId as `0x${string}`,
      phase: seat.phase,
      promptHash,
      inputHash: hashCanonicalJson(input),
      evidenceRoot: input.evidenceManifest.root as `0x${string}`,
      status,
    };
    const record: InferenceRunRecord = {
      runId: audit.runId,
      claimId: claim.claimId,
      phase: seat.phase,
      agentProfileId: seat.agentProfileId,
      jurySeatId: seat.jurySeatId,
      attempt: audit.attempt,
      providerId: "gonkarouter",
      modelId: agent.manifest.modelId,
      gonkaRequestId: audit.gonkaRequestId,
      promptHash,
      inputHash: audit.inputHash,
      outputHash: audit.outputHash,
      toolTranscriptHash: audit.toolTranscriptHash,
      evidenceRoot: input.evidenceManifest.root as `0x${string}`,
      validationStatus: status,
      latencyMs: audit.latencyMs,
      audit,
      failure,
      requestedAt: new Date(audit.requestedAtMs).toISOString(),
      completedAt: new Date(audit.completedAtMs).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveInferenceRun(record);
    await this.updateSeat(seat.jurySeatId, { status: "NO_VALID_INFERENCE" });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "inference_failed",
      source: "GONKA_ROUTER",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: record.runId,
      payload: {
        run_id: record.runId,
        category: status,
        retry_count: Math.max(0, audit.attempt - 1),
      },
    });
    await this.emit({
      claimId: claim.claimId,
      phase: `INFERENCE_${seat.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: seat.agentProfileId,
      runId: record.runId,
      payload: {
        genericStage: "INFERENCE",
        status: "NO_VALID_INFERENCE",
        latencyMs: audit.latencyMs,
      },
    });
    await this.voidAttempt(claim.claimId, {
      reason: status,
      message,
      seatId: seat.jurySeatId,
      modelId: agent.manifest.modelId,
      phase: seat.phase,
    });
  }

  private async emitRunApproval(
    claimId: string,
    run: InferenceRunRecord,
    approval: RunApprovalRecord,
    timingMs: {
      model: number;
      seal: number;
      escrow: number;
      upload: number;
      approve: number;
    },
  ): Promise<void> {
    await this.emit({
      claimId,
      phase: `INFERENCE_${run.phase}`,
      kind: "run_approved",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      actorId: run.agentProfileId,
      runId: run.runId,
      transactionDigest: approval.transactionDigest,
      artifactHash: approval.runHash,
      payload: {
        run_id: run.runId,
        agent_profile_id: run.agentProfileId,
        jury_seat_id: run.jurySeatId,
        run_approval_id: approval.runApprovalId,
        run_hash: approval.runHash,
        transaction_digest: approval.transactionDigest,
        timing_ms: timingMs,
      },
    });
    await this.emit({
      claimId,
      phase: `INFERENCE_${run.phase}`,
      kind: "agent_activity",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: run.agentProfileId,
      runId: run.runId,
      payload: {
        genericStage: "INFERENCE",
        status: "COMPLETED",
        latencyMs: run.latencyMs,
      },
    });
  }

  private async persistFinalization(
    claim: ClaimRecord,
    chain: Awaited<ReturnType<SuiGateway["finalize"]>>,
    result: ResolutionCertificateRecord["result"],
    truthScoreBps: number | null,
    phase: 1 | 2,
    voteIds: string[],
    finalizeMs: number,
  ): Promise<FinalizeReport> {
    const timestamp = this.isoNow();
    const certificate: ResolutionCertificateRecord = {
      certificateId: chain.certificateId,
      claimId: claim.claimId,
      result,
      ...(truthScoreBps === null ? {} : { truthScoreBps }),
      finalPhase: phase,
      finalRoundVoteIds: voteIds,
      transactionDigest: chain.digest,
      ...(chain.checkpoint === undefined ? {} : { checkpoint: chain.checkpoint }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.saveResolutionCertificate(certificate);
    const payoutTickets =
      chain.payoutTickets.length > 0
        ? chain.payoutTickets
        : chain.payoutTicketIds.map((payoutTicketId) => ({
            payoutTicketId,
            recipient: claim.creator ?? ZERO_OBJECT_ID,
            amount: "0",
            reason: 0,
          }));
    for (const payout of payoutTickets) {
      await this.#repository.savePayoutTicket({
        payoutTicketId: payout.payoutTicketId,
        claimId: claim.claimId,
        recipient: payout.recipient,
        amount: payout.amount,
        coinType: claim.coinType,
        reason: payout.reason,
        consumed: false,
        createdTransactionDigest: chain.digest,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const nextState =
      result === "UNRESOLVED"
        ? CLAIM_STATE.UNRESOLVED
        : claim.state === CLAIM_STATE.PROPOSED
          ? CLAIM_STATE.FINALIZED_UNCHALLENGED
          : CLAIM_STATE.FINALIZED_REVIEWED;
    await this.saveClaim({
      ...claim,
      state: nextState,
      certificateId: chain.certificateId,
      result,
      ...(truthScoreBps === null ? {} : { truthScoreBps }),
      transactionDigest: chain.digest,
    });
    const attempt = await this.ensureVerificationAttempt(claim);
    await this.#repository.saveVerificationAttempt({
      ...attempt,
      status: "SETTLED",
      updatedAt: timestamp,
    });
    const tally = await this.#repository.getRoundTally(claim.claimId, phase);
    if (tally) {
      await this.#repository.saveRoundTally({ ...tally, closed: true, updatedAt: timestamp });
    }
    await this.emit({
      claimId: claim.claimId,
      phase: "FINALIZED",
      kind: "claim_finalized",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction: chain,
      payload: {
        claim_id: claim.claimId,
        certificate_id: chain.certificateId,
        outcome: result,
        reviewed: claim.state !== CLAIM_STATE.PROPOSED,
        truth_score_bps: truthScoreBps,
        transaction_digest: chain.digest,
        timing_ms: {
          finalize: finalizeMs,
          // Wall clock from the claim row's creation, so the console can show
          // what the whole verification took without replaying the events.
          total_from_created: totalSinceCreated(claim.createdAt, this.#now()),
        },
      },
    });
    // Fire-and-forget: warm and persist this claim's public run proofs so no
    // viewer (or fresh deploy) ever pays the first heavy build. A failed build
    // only logs; finalization never waits on it.
    void this.warmRunProofs(claim.claimId);
    return certificateToFinalizeReport(certificate);
  }

  private async verifyClaim(
    claim: ClaimRecord,
    manifests: EvidenceManifestRecord[],
    packages: VotePackageRecord[],
    certificate?: ResolutionCertificateRecord,
  ): Promise<NonNullable<ClaimInspection["verification"]>> {
    const issues: string[] = [];
    let commitmentsRecomputed = true;
    for (const item of packages) {
      const recomputed = toHex(
        computeVoteCommitment({
          claim_id: item.claimId,
          agent_profile_id: item.agentProfileId,
          jury_seat_id: item.jurySeatId,
          phase: item.phase,
          outcome: item.outcome,
          confidence_bps: item.confidenceBps,
          evidence_root: fromHex(item.evidenceRoot),
          output_hash: fromHex(item.outputHash),
          run_hash: fromHex(item.runHash),
          salt: fromHex(item.saltHex),
        }),
      );
      if (recomputed !== item.commitment) {
        commitmentsRecomputed = false;
        issues.push(`commitment mismatch for jury seat ${item.jurySeatId}`);
      }
    }
    let evidenceRootsRecomputed = true;
    for (const manifest of manifests) {
      const artifacts = uniqueEvidenceArtifacts(
        await this.artifactsForPhase(claim.claimId, manifest.phase),
      );
      const recomputed = toHex(
        buildEvidenceManifest(artifacts.map(toEvidenceManifestItem)).root,
      );
      if (recomputed !== manifest.root) {
        evidenceRootsRecomputed = false;
        issues.push(`evidence root mismatch for phase ${manifest.phase}`);
      }
    }
    let truthScoreRecomputed = true;
    if (certificate) {
      const reveals = await this.#repository.listReveals(claim.claimId, certificate.finalPhase);
      const recomputed = computeTruthScoreBps(
        reveals.filter((reveal) => reveal.valid).map((reveal) => ({
          outcome: reveal.outcome,
          confidenceBps: reveal.confidenceBps,
        })),
      );
      if (recomputed !== (certificate.truthScoreBps ?? null)) {
        truthScoreRecomputed = false;
        issues.push("truth score mismatch");
      }
    }
    return {
      commitmentsRecomputed,
      truthScoreRecomputed,
      evidenceRootsRecomputed,
      issues,
    };
  }

  private async registerVerifiedZkBackedAgent(
    req: ValidatedZkBackedRegistrationRequest,
    humanBackingHash: `0x${string}`,
    backingKind: StakedAgentBackingKind,
  ): Promise<ZkBackedRegistrationResult> {
    const verificationProvider =
      backingKind === "ZKLOGIN_BACKED"
        ? ZKLOGIN_VERIFICATION_PROVIDER
        : WALLET_VERIFICATION_PROVIDER;
    // One account may stake on several seats, so nothing here rejects a repeat
    // staker hash: the Move draw rule seats at most one of them per committee.
    const slot = await this.allocateOperationalSlot();
    // Nobody picks a debate role: the engine assigns one when none is named.
    const role = req.role ?? (await this.assignSeatRole(slot.address, req.modelId));

    // Persist only the pseudonymous staker hash; the staking address and its
    // signature are used for authentication and deliberately not stored.
    const built = buildAgentManifestDocument({
      network: this.#manifest.network,
      backingKind,
      humanBackingHash,
      humanVerificationProvider: verificationProvider,
      operationalOwner: slot.address as `0x${string}`,
      role,
      modelId: req.modelId,
      promptSpec: this.#gonka.promptSpec(),
      toolPolicy: this.#gonka.toolPolicy(),
      // The document carries the human-readable label; verifiers hash it.
      evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
    });
    // Fail closed if the document's policy hash and the id the engine records
    // at evidence freeze ever diverge (a release manifest that overrides
    // evidencePolicy.id needs a matching document label first).
    const enginePolicyId = evidencePolicyId(this.#manifest);
    if (built.document.evidencePolicyHash !== enginePolicyId) {
      throw new EngineValidationError(
        `manifest document evidence policy hash ${built.document.evidencePolicyHash} does not match the engine evidence policy id ${enginePolicyId}`,
      );
    }
    const manifestUpload = await this.#walrus.put(built.bytes, {
      identifier: `agent-${humanBackingHash.slice(2, 18)}.json`,
    });
    const result = await this.#gateway.registerAgent({
      agentIndex: slot.index,
      bondAmount: 1,
      manifestHash: fromHex(built.manifestHash),
      manifestBlobId: manifestUpload.blobId,
      modelHash: blake2b256(new TextEncoder().encode(req.modelId)),
      roleHash: blake2b256(new TextEncoder().encode(`OPENVERDICT_ROLE_${role}`)),
      humanBackingHash: fromHex(humanBackingHash),
    });

    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: result.agentProfileId as `0x${string}`,
      owner: result.owner as `0x${string}`,
      humanAttestationHash: humanBackingHash,
      humanVerificationProvider: verificationProvider,
      version: built.document.version,
      manifestBlobId: manifestUpload.blobId,
      manifestHash: built.manifestHash,
      promptHash: built.promptHash,
      modelId: req.modelId,
      providerId: "gonkarouter",
      toolPolicyHash: built.toolPolicyHash,
      evidencePolicyHash: built.document.evidencePolicyHash,
      publicKey: result.owner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: result.checkpoint ?? 0,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role,
      ...(result.agentCapId === undefined
        ? {}
        : { agentCapId: result.agentCapId }),
      active: true,
      reputation: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      agentProfileId: result.agentProfileId,
      humanBackingHash,
      backingKind,
      digest: result.digest,
      role,
    };
  }

  /**
   * First free operational signing slot. Slots are a fixed deterministic pool,
   * so a slot is taken while its address owns a persisted seat or while a live
   * stake reservation still holds it. An expired reservation frees its slot.
   */
  private async allocateOperationalSlot(): Promise<{
    address: string;
    index: number;
  }> {
    const [agents, pending] = await Promise.all([
      this.#repository.listAgentManifests(),
      this.#repository.listPendingStakeReservations(this.isoNow()),
    ]);
    const usedOwners = new Set([
      ...agents.map((agent) => agent.manifest.owner.toLowerCase()),
      ...pending.map((reservation) => reservation.operationalOwner.toLowerCase()),
    ]);
    const slot = this.#operationalAgentSlots.find(
      (candidate) => !usedOwners.has(candidate.address.toLowerCase()),
    );
    if (!slot) {
      throw new EngineCapacityError(
        `operational agent signer capacity exhausted (${this.#operationalAgentSlots.length} deterministic slots configured)`,
      );
    }
    return slot;
  }

  /**
   * Refuses a seat that no committee could ever hold. The draw caps live in
   * jury.move and lib/engine/draw-feasibility.ts mirrors them, so the two must
   * change together. A roster that already draws a jury has to keep drawing one
   * with this seat on it, or the staker pays for a seat that never votes. A
   * roster that cannot draw a jury yet is still growing: every seat added to it
   * is part of the fix, so nothing is refused there.
   */
  private async assertSeatIsDrawable(
    owner: string,
    modelId: string,
    role: string,
  ): Promise<void> {
    // Only confirmed seats are in the registry the draw reads.
    const roster = (await this.#repository.listAgentManifests())
      .filter((agent) => agent.active)
      .map((agent) => ({
        owner: agent.manifest.owner,
        modelId: agent.manifest.modelId,
        role: agent.role,
        active: true,
      }));
    // The registry's own rule, so a stake that degraded mode needs (a third
    // seat on one model) is not refused by a mirror still holding the default.
    const rule = await this.drawRule();
    if (!rosterAdmitsDraw(roster, rule).ok) return;
    const seat = rosterCanSeat(roster, { owner, modelId, role, active: true }, rule);
    if (!seat.ok) throw new EngineValidationError(seat.reason);
  }

  /**
   * The debate role a seat gets when its staker names none. Research is the
   * same for every seat, so nobody picks a role: the engine keeps the pool
   * balanced (the least represented role among the active seats on this model)
   * and skips a role no committee could seat, since the staker can no longer
   * pick a different one after a refusal. assertSeatIsDrawable still has the
   * last word when nothing fits.
   */
  private async assignSeatRole(
    owner: string,
    modelId: string,
  ): Promise<ZkLoginAgentRole> {
    const roster = (await this.#repository.listAgentManifests()).map((agent) => ({
      owner: agent.manifest.owner,
      modelId: agent.manifest.modelId,
      role: agent.role,
      active: agent.active,
    }));
    const ranked = rankDebateRoles(roster, modelId);
    const rule = await this.drawRule();
    // A roster that cannot draw a jury yet refuses nothing, so balance decides.
    if (!rosterAdmitsDraw(roster, rule).ok) return ranked[0]!;
    const drawable = ranked.find(
      (role) => rosterCanSeat(roster, { owner, modelId, role, active: true }, rule).ok,
    );
    return drawable ?? ranked[0]!;
  }

  /**
   * Real stake, step one. Validates the seat's model and role, reserves a
   * signing slot under the registration lock, publishes the seat's manifest
   * document to Walrus, and returns the register_staked_agent arguments the
   * staker's wallet signs. Nothing is on chain yet.
   */
  async prepareStake(req: StakePreparationRequest): Promise<StakePreparation> {
    validateStakePreparationRequest(req, this.#manifest);
    // Any amount from the minimum up: the chain sets the seat's draw weight
    // from it. Re-serialized from BigInt so the wallet is handed a canonical
    // number rather than whatever shape the caller sent.
    const stakeMist = (
      req.amountMist === undefined ? MIN_STAKE_MIST : BigInt(req.amountMist)
    ).toString();
    // The staker hash is blake2b-256 of the staking address, exactly as the
    // signed-message path derives it, so the Move draw rule sees one shape.
    const stakerHash = toHex(blake2b256(fromHex(req.stakerAddress)));
    return this.withRegistrationLock(async () => {
      const slot = await this.allocateOperationalSlot();
      // Nobody picks a debate role: the engine assigns one when none is named.
      const role = req.role ?? (await this.assignSeatRole(slot.address, req.modelId));
      await this.assertSeatIsDrawable(slot.address, req.modelId, role);
      const built = buildAgentManifestDocument({
        network: this.#manifest.network,
        backingKind: "WALLET_STAKED",
        humanBackingHash: stakerHash,
        humanVerificationProvider: WALLET_STAKE_VERIFICATION_PROVIDER,
        operationalOwner: slot.address as `0x${string}`,
        role,
        modelId: req.modelId,
        promptSpec: this.#gonka.promptSpec(),
        toolPolicy: this.#gonka.toolPolicy(),
        // The document carries the human-readable label; verifiers hash it.
        evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
      });
      // Same fail-closed check the signed-message path runs: a release manifest
      // that overrides the evidence policy id needs a matching document label.
      const enginePolicyId = evidencePolicyId(this.#manifest);
      if (built.document.evidencePolicyHash !== enginePolicyId) {
        throw new EngineValidationError(
          `manifest document evidence policy hash ${built.document.evidencePolicyHash} does not match the engine evidence policy id ${enginePolicyId}`,
        );
      }
      const upload = await this.#walrus.put(built.bytes, {
        identifier: `agent-${stakerHash.slice(2, 18)}.json`,
      });
      const nowMs = this.#now();
      const reservation: StakeReservationRecord = {
        reservationId: randomUUID(),
        stakerAddress: req.stakerAddress,
        slotIndex: slot.index,
        operationalOwner: slot.address,
        modelId: req.modelId,
        role,
        manifestHash: built.manifestHash,
        manifestBlobId: upload.blobId,
        documentVersion: built.document.version,
        promptHash: built.promptHash,
        toolPolicyHash: built.toolPolicyHash,
        ...(built.tableVotePromptHash === undefined
          ? {}
          : { tableVotePromptHash: built.tableVotePromptHash }),
        evidencePolicyHash: built.document.evidencePolicyHash,
        stakerHash,
        status: "PENDING",
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + STAKE_RESERVATION_TTL_MS).toISOString(),
      };
      await this.#repository.saveStakeReservation(reservation);
      return {
        reservationId: reservation.reservationId,
        expiresAt: reservation.expiresAt,
        role,
        target: {
          packageId: this.#manifest.packageId,
          registryObjectId: this.#manifest.registryObjectId,
          clockObjectId: this.#manifest.clockObjectId,
        },
        args: {
          manifestHash: built.manifestHash,
          manifestBlobId: upload.blobId,
          modelHash: toHex(blake2b256(new TextEncoder().encode(req.modelId))),
          roleHash: toHex(
            blake2b256(new TextEncoder().encode(`OPENVERDICT_ROLE_${role}`)),
          ),
          stakerHash,
          operationalOwner: slot.address as `0x${string}`,
        },
        minStakeMist: MIN_STAKE_MIST.toString(),
        stakeMist,
      };
    });
  }

  /**
   * Real stake, step two. Reads the staker's settled transaction, checks it
   * against the reservation, records the seat, and tops its signing key up with
   * gas. A replayed confirm returns the stored result instead of writing again.
   */
  async confirmStake(req: StakeConfirmationRequest): Promise<StakeConfirmation> {
    validateStakeConfirmationRequest(req);
    const reservation = await this.#repository.getStakeReservation(
      req.reservationId,
    );
    if (!reservation) {
      throw new StakeReservationNotFoundError(req.reservationId);
    }
    if (reservation.status === "CONFIRMED") {
      return storedStakeConfirmation(reservation);
    }
    if (
      reservation.status === "EXPIRED" ||
      Date.parse(reservation.expiresAt) <= this.#now()
    ) {
      if (reservation.status !== "EXPIRED") {
        await this.#repository.saveStakeReservation({
          ...reservation,
          status: "EXPIRED",
        });
      }
      throw new StakeReservationNotFoundError(req.reservationId);
    }

    let registration: StakeRegistrationRead;
    try {
      registration = await this.#gateway.readStakeRegistration(req.digest);
    } catch (error) {
      throw new ChainReadError(
        `stake transaction ${req.digest} could not be read from the chain`,
        { cause: error },
      );
    }

    // Everything below is the reservation's own contract with the chain: a
    // mismatch means this digest belongs to some other transaction.
    if (!sameAddress(registration.sender, reservation.stakerAddress)) {
      throw new EngineValidationError(
        "the stake transaction was sent by a different account than the reservation",
      );
    }
    if (
      !sameAddress(registration.operationalOwner, reservation.operationalOwner)
    ) {
      throw new EngineValidationError(
        "the stake transaction names a different operational owner than the reservation",
      );
    }
    if (registration.manifestHash !== reservation.manifestHash) {
      throw new EngineValidationError(
        "the stake transaction carries a different manifest hash than the reservation",
      );
    }
    // The chain's own floor, re-checked here. There is no ceiling on this
    // side: the money is already posted, so a stake above the prepare limit is
    // recorded rather than stranded, and the draw weight caps it anyway.
    if (BigInt(registration.amountMist) < MIN_STAKE_MIST) {
      throw new EngineValidationError(
        `the stake of ${registration.amountMist} MIST is below the ${MIN_STAKE_MIST} MIST minimum`,
      );
    }

    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: registration.agentProfileId as `0x${string}`,
      owner: registration.operationalOwner as `0x${string}`,
      humanAttestationHash: reservation.stakerHash as `0x${string}`,
      humanVerificationProvider: WALLET_STAKE_VERIFICATION_PROVIDER,
      version: reservation.documentVersion,
      manifestBlobId: reservation.manifestBlobId,
      manifestHash: reservation.manifestHash as `0x${string}`,
      promptHash: reservation.promptHash as `0x${string}`,
      ...(reservation.tableVotePromptHash === undefined
        ? {}
        : { tableVotePromptHash: reservation.tableVotePromptHash as `0x${string}` }),
      modelId: reservation.modelId,
      providerId: "gonkarouter",
      toolPolicyHash: reservation.toolPolicyHash as `0x${string}`,
      evidencePolicyHash: reservation.evidencePolicyHash as `0x${string}`,
      publicKey: registration.operationalOwner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: registration.checkpoint ?? 0,
      stakerAddress: registration.sender as `0x${string}`,
      stakeMist: registration.amountMist,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role: reservation.role,
      agentCapId: registration.agentCapId,
      active: true,
      reputation: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Closed before the gas float moves, so a second confirm racing this one
    // replays the stored result instead of sending the operator's SUI twice.
    const confirmed: StakeReservationRecord = {
      ...reservation,
      status: "CONFIRMED",
      digest: req.digest,
      agentProfileId: registration.agentProfileId,
      stakeMist: registration.amountMist,
    };
    await this.#repository.saveStakeReservation(confirmed);

    // Funding is bookkeeping around a seat that already exists on chain, so a
    // dead operator key must never turn a paid stake into a failed confirm.
    let gasFloat: StakeConfirmation["gasFloat"] = "skipped";
    try {
      const funding = await this.#gateway.fundAddress({
        address: registration.operationalOwner,
        amountMist: SEAT_GAS_FLOAT_MIST.toString(),
        minBalanceMist: SEAT_GAS_FLOAT_MIN_MIST.toString(),
      });
      gasFloat = funding.funded ? "funded" : "skipped";
    } catch (error) {
      gasFloat = "failed";
      process.stderr.write(
        `stake: gas float for ${registration.operationalOwner} failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
    const settled: StakeReservationRecord = { ...confirmed, gasFloat };
    await this.#repository.saveStakeReservation(settled);
    return storedStakeConfirmation(settled);
  }

  private async withRegistrationLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#registrationTail.then(operation);
    this.#registrationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async requiredCommittee(claimId: string): Promise<CommitteeRecord> {
    const committee = await this.#repository.getCommitteeForClaim(claimId);
    if (!committee) throw new EngineStateError("claim has no selected committee");
    return committee;
  }

  private async requiredTally(claimId: string, phase: 1 | 2): Promise<RoundTallyRecord> {
    const tally = await this.#repository.getRoundTally(claimId, phase);
    if (!tally) throw new EngineStateError(`claim has no round ${phase} tally`);
    return tally;
  }

  private async requiredEvidenceManifest(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceManifestRecord> {
    const manifest = await this.#repository.getEvidenceManifest(claimId, phase);
    if (!manifest) throw new EngineStateError(`round ${phase} evidence is not frozen`);
    return manifest;
  }

  private assertResearchManifestHashes(
    manifest: AgentManifest,
    document:
      | AgentManifestDocumentV3
      | AgentManifestDocumentV4
      | AgentManifestDocumentV5
      | AgentManifestDocumentV6,
  ): void {
    if (document.modelId !== manifest.modelId) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest document model does not match the registered model`,
      );
    }
    const computedPromptHash = promptSpecHash(document.promptSpec);
    if (
      document.promptHash.toLowerCase() !== computedPromptHash.toLowerCase() ||
      manifest.promptHash.toLowerCase() !== computedPromptHash.toLowerCase()
    ) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest prompt hash does not match its prompt document; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
    const computedToolPolicyHash = toolPolicyHash(document.toolPolicy);
    if (
      document.toolPolicyHash.toLowerCase() !==
        computedToolPolicyHash.toLowerCase() ||
      manifest.toolPolicyHash.toLowerCase() !==
        computedToolPolicyHash.toLowerCase()
    ) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} manifest tool policy hash does not match its policy document; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
  }

  /** Phase two must bind every seat to the one published table-vote prompt. */
  private assertTableVoteManifestHashes(
    manifest: AgentManifest,
    document: AgentManifestDocument,
  ): void {
    const expectedHash = tableVotePromptSpecHash();
    if (
      manifest.version !== "6" ||
      document.version !== "6" ||
      document.modelId !== manifest.modelId ||
      promptSpecHash(document.tableVotePromptSpec).toLowerCase() !==
        document.tableVotePromptHash.toLowerCase() ||
      document.tableVotePromptHash.toLowerCase() !== expectedHash.toLowerCase() ||
      manifest.tableVotePromptHash?.toLowerCase() !== expectedHash.toLowerCase()
    ) {
      throw new EngineValidationError(
        `agent ${manifest.agentProfileId} table vote manifest is not a matching v6 document; run pnpm tsx scripts/publish-agent-manifests.ts`,
      );
    }
  }

  private async requiredAgent(agentProfileId: string): Promise<AgentManifestRecord> {
    const agent = await this.#repository.getAgentManifest(agentProfileId);
    if (!agent) throw new EngineStateError(`agent manifest is missing: ${agentProfileId}`);
    return agent;
  }

  private async ensureAgent(
    agentProfileId: string,
    owner: string,
    index: number,
    agentCapId?: string,
  ): Promise<void> {
    if (await this.#repository.getAgentManifest(agentProfileId)) return;
    if (this.#manifest.gonka.mode === "live") {
      throw new EngineStateError(
        `live mode requires the registered manifest for agent ${agentProfileId}`,
      );
    }
    // Fake mode may synthesize display metadata for a freshly deployed demo registry.
    const hash = (label: string) =>
      toHex(blake2b256(new TextEncoder().encode(`${label}:${agentProfileId}`)));
    const role =
      index === 0
        ? "SKEPTIC"
        : index === 1
          ? "SOURCE_AUTHENTICITY"
          : "ANALYST";
    const humanBackingHash = hash("human");
    const modelId =
      this.#manifest.gonka.models[index % this.#manifest.gonka.models.length] ??
      "unknown";
    const built = buildAgentManifestDocument({
      network: this.#manifest.network,
      backingKind: "TESTNET_DEMO_ALLOWLIST",
      humanBackingHash,
      humanVerificationProvider: DEMO_ALLOWLIST_VERIFICATION_PROVIDER,
      operationalOwner: owner as `0x${string}`,
      role,
      modelId,
      promptSpec: this.#gonka.promptSpec(),
      toolPolicy: this.#gonka.toolPolicy(),
      evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
    });
    const manifestUpload = await this.#walrus.put(built.bytes, {
      identifier: `agent-demo-${agentProfileId.slice(2, 18)}.json`,
    });
    const timestamp = this.isoNow();
    const manifest: AgentManifest = {
      agentProfileId: agentProfileId as `0x${string}`,
      owner: owner as `0x${string}`,
      humanAttestationHash: humanBackingHash,
      humanVerificationProvider: DEMO_ALLOWLIST_VERIFICATION_PROVIDER,
      version: built.document.version,
      manifestBlobId: manifestUpload.blobId,
      manifestHash: built.manifestHash,
      promptHash: built.promptHash,
      modelId,
      providerId: "gonkarouter",
      toolPolicyHash: built.toolPolicyHash,
      evidencePolicyHash: built.document.evidencePolicyHash,
      publicKey: owner,
      registeredAtMs: this.#now(),
      registeredCheckpoint: 0,
    };
    await this.#repository.saveAgentManifest({
      manifest,
      role,
      ...(agentCapId === undefined ? {} : { agentCapId }),
      active: true,
      reputation: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private async bindSeatsToEvidence(
    claimId: string,
    phase: 1 | 2,
    roundTallyId: string,
    evidenceBundleId: string,
    root: `0x${string}`,
  ): Promise<void> {
    // Idempotent and never fatal: each bind is signed by the seat's agent
    // (its own gas), so one failure must not take the whole round down. A
    // seat that stays unbound is retried by the next juryRun tick.
    //
    // Agents run side by side, seats of one agent stay in order: the binds
    // are five separate signers, and running them in sequence cost the round
    // one transaction round trip per seat before any juror could start.
    const seats = await this.#repository.listJurySeats(claimId, phase);
    await Promise.all(
      groupByAgent(seats.filter((seat) => !seat.evidenceBound)).map(async (agentSeats) => {
        for (const seat of agentSeats) {
          try {
            await this.#gateway.bindJurySeatEvidence({
              jurySeatId: seat.jurySeatId,
              agentProfileId: seat.agentProfileId,
              roundTallyId,
              evidenceBundleId,
            });
          } catch (error) {
            process.stderr.write(
              `bind seat: claim ${claimId.slice(0, 10)}… seat ${seat.jurySeatId.slice(0, 10)}…: ${
                error instanceof Error ? error.message : String(error)
              }\n`,
            );
            continue;
          }
          await this.#repository.saveJurySeat({
            ...seat,
            evidenceRoot: root,
            evidenceBound: true,
            updatedAt: this.isoNow(),
          });
        }
      }),
    );
  }

  private async acceptOfferedSeats(
    claimId: string,
    phase: 1 | 2,
  ): Promise<void> {
    // Agent-signed like the binds, so the same rule applies: agents in
    // parallel, seats of one agent in order. The chain's twenty-second
    // acceptance window is unchanged; only the engine stops queueing behind
    // itself inside it.
    const seats = await this.#repository.listJurySeats(claimId, phase);
    await Promise.all(
      groupByAgent(seats.filter((seat) => seat.status === "OFFERED")).map(
        async (agentSeats) => {
          for (const seat of agentSeats) {
            await this.#gateway.acceptJurySeat({
              jurySeatId: seat.jurySeatId,
              agentProfileId: seat.agentProfileId,
            });
            await this.#repository.saveJurySeat({
              ...seat,
              status: "ACCEPTED",
              updatedAt: this.isoNow(),
            });
          }
        },
      ),
    );
  }

  private async updateSeat(
    jurySeatId: string,
    patch: Partial<Pick<JurySeatRecord, "status" | "commitment" | "runHash">>,
  ): Promise<void> {
    const seat = await this.#repository.getJurySeat(jurySeatId);
    if (!seat) throw new EngineStateError(`jury seat is missing: ${jurySeatId}`);
    await this.#repository.saveJurySeat({
      ...seat,
      ...patch,
      updatedAt: this.isoNow(),
    });
  }

  private async changePhase(
    claim: ClaimRecord,
    state: ClaimRecord["state"],
    transaction: TxResult,
  ): Promise<void> {
    await this.saveClaim({ ...claim, state, transactionDigest: transaction.digest });
    await this.emit({
      claimId: claim.claimId,
      phase: claimStateName(state),
      kind: "phase_changed",
      source: "SUI",
      visibility: "PUBLIC_NOW",
      transaction,
      payload: {
        claim_id: claim.claimId,
        previous_phase: claimStateName(claim.state),
        new_phase: claimStateName(state),
        checkpoint: transaction.checkpoint,
        transaction_digest: transaction.digest,
      },
    });
  }

  private async emitEvidenceSubmitted(record: EvidenceSubmissionRecord): Promise<void> {
    await this.emit({
      claimId: record.claimId,
      phase: `EVIDENCE_${record.phase}`,
      kind: "evidence_submitted",
      source: "EVIDENCE",
      visibility: "PUBLIC_NOW",
      payload: {
        claim_id: record.claimId,
        evidence_id: record.evidenceId,
        source_class: record.sourceClass,
      },
    });
  }

  private async emitEvidenceRetrieved(
    claimId: string,
    evidenceId: string,
    status: string,
    latencyMs: number,
    bytes: number,
  ): Promise<void> {
    await this.emit({
      claimId,
      phase: "EVIDENCE",
      kind: "evidence_retrieved",
      source: "EVIDENCE",
      visibility: "PUBLIC_NOW",
      payload: {
        evidence_id: evidenceId,
        status,
        latency_ms: latencyMs,
        bytes,
      },
    });
  }

  private async emit(input: {
    claimId: string;
    phase: string;
    kind: string;
    source: ResolutionEventSource;
    visibility: ResolutionEventVisibility;
    actorId?: string;
    runId?: string;
    transaction?: TxResult;
    transactionDigest?: string;
    artifactHash?: `0x${string}`;
    occurredAt?: string;
    publishedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<ResolutionEvent> {
    return this.#repository.appendResolutionEvent({
      eventId: randomUUID(),
      claimId: input.claimId,
      phase: input.phase,
      kind: input.kind,
      source: input.source,
      visibility: input.visibility,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      occurredAt: input.occurredAt ?? this.isoNow(),
      ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
      ...(input.transaction?.digest === undefined && input.transactionDigest === undefined
        ? {}
        : { transactionDigest: input.transaction?.digest ?? input.transactionDigest }),
      ...(input.transaction?.checkpoint === undefined
        ? {}
        : { checkpoint: input.transaction.checkpoint }),
      ...(input.artifactHash === undefined ? {} : { artifactHash: input.artifactHash }),
      payload: compactRecord(input.payload),
    });
  }

  private async claim(claimId: string): Promise<ClaimRecord> {
    const claim = await this.#repository.getClaim(claimId);
    if (!claim) throw new ClaimNotFoundError(claimId);
    return claim;
  }

  private async saveClaim(claim: ClaimRecord): Promise<ClaimRecord> {
    const updated = { ...claim, updatedAt: this.isoNow() };
    await this.#repository.saveClaim(updated);
    return updated;
  }

  /** Legacy claims receive the same first-attempt row before a terminal update. */
  private async ensureVerificationAttempt(
    claim: ClaimRecord,
  ): Promise<VerificationAttemptRecord> {
    const existing = await this.#repository.getVerificationAttempt(claim.claimId);
    if (existing !== undefined) return existing;
    const attempt: VerificationAttemptRecord = {
      verificationId: claim.claimId,
      claimId: claim.claimId,
      attempt: 1,
      status: "ACTIVE",
      createdAt: claim.createdAt,
      updatedAt: this.isoNow(),
    };
    await this.#repository.saveVerificationAttempt(attempt);
    return attempt;
  }

  /** One terminal path keeps give-up rows and their public events consistent. */
  private async giveUpVerificationAttempt(
    claim: ClaimRecord,
    attempt: VerificationAttemptRecord,
    reason: "ATTEMPTS_EXHAUSTED" | "WEATHER_TIMEOUT",
  ): Promise<void> {
    const timestamp = this.isoNow();
    await this.#repository.saveVerificationAttempt({
      ...attempt,
      status: "GAVE_UP",
      gaveUpReason: reason,
      updatedAt: timestamp,
    });
    await this.emit({
      claimId: attempt.claimId,
      phase: claimStateName(claim.state),
      kind: "verification_gave_up",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      payload: {
        claim_id: attempt.claimId,
        verification_id: attempt.verificationId,
        attempt: attempt.attempt,
        reason,
      },
    });
  }

  private async executeDeliberation(claimId: string): Promise<void> {
    const claim = await this.claim(claimId);
    if (claim.state !== CLAIM_STATE.DISCUSSION) return;

    const spec = selectedDeliberationSpec();
    const { priorRound, debaters } = await this.deliberationDebaters(claimId);
    const roundOneStances = new Map(
      debaters.map((debater) => [debater.jurySeatId, debater.outcome]),
    );
    const freezeLeadMs = nonNegativeNumberEnv(
      "OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS",
      DEFAULT_EVIDENCE_FREEZE_LEAD_MS,
    );
    const phaseOneManifest = debaters.length === 0
      ? undefined
      : await this.requiredEvidenceManifest(claimId, 1);
    const seatIndexById = new Map(
      debaters.map((debater) => [debater.jurySeatId, debater.seatIndex]),
    );
    const debaterBySeatId = new Map(
      debaters.map((debater) => [debater.jurySeatId, debater]),
    );
    const seats = debaters.map<DebateSeat>((debater) => ({
      jurySeatId: debater.jurySeatId,
      seatIndex: debater.seatIndex,
      role: debater.manifest?.role ?? "",
    }));

    for (const exchange of [1, 2, MAX_DELIBERATION_EXCHANGES] as const) {
      // The next speaker is a pure function of the turns already stored, so a
      // restarted worker continues the same conversation. The stored turns are
      // re-read every turn because the evidence worker can drive the same
      // debate from another process, and both must follow one order.
      for (;;) {
        const stored = await this.#repository.listDeliberationTurns(claimId);
        const plan = nextDebateTurn({
          seats,
          turns: stored.map(toDebateTurnFacts),
          roundOneStances,
          exchange,
        });
        if (plan === undefined) break;
        const debater = debaterBySeatId.get(plan.seat.jurySeatId);
        if (debater === undefined) break;
        const turn: DeliberationPlanTurn = {
          debater,
          exchange,
          ordinal: plan.ordinal,
          plan,
        };
        const windowExhausted =
          this.#now() + PER_TURN_BUDGET_MS >
          claim.deadlines.discussionDeadlineMs - freezeLeadMs;
        const record = windowExhausted
          ? this.deliberationTurnRecord(
              turn,
              spec,
              "SKIPPED",
              { argument: "", citations: [] },
              "WINDOW_EXHAUSTED",
            )
          : await this.completeDeliberationTurn(
              claim,
              turn,
              spec,
              priorRound,
              stored,
              seatIndexById,
              this.deliberationAllowedCitations(
                turn.debater,
                phaseOneManifest,
                priorRound,
              ),
              debateMovedBeforeExchange(stored, roundOneStances, exchange),
            );
        // A sibling process may have spoken for this seat while the model ran.
        // Its turn is the record; this one is dropped and the order re-planned.
        const latest = await this.#repository.listDeliberationTurns(claimId);
        if (
          latest.some(
            (other) =>
              other.ordinal === turn.ordinal ||
              (other.exchange === exchange &&
                other.jurySeatId === turn.debater.jurySeatId),
          )
        ) {
          continue;
        }
        await this.persistDeliberationTurn(record);
      }

      const convergedAfterExchange = debateConvergedAfterExchange(
        await this.#repository.listDeliberationTurns(claimId),
        roundOneStances,
      );
      if (convergedAfterExchange === exchange) {
        const alreadyEmitted = (
          await this.#repository.listResolutionEvents(claimId)
        ).some(
          (event) =>
            event.kind === "debate_converged" &&
            event.payload.exchange === exchange,
        );
        if (!alreadyEmitted) {
          await this.emit({
            claimId,
            phase: "DISCUSSION",
            kind: "debate_converged",
            source: "ENGINE",
            visibility: "PUBLIC_NOW",
            payload: { claim_id: claimId, exchange },
          });
        }
        break;
      }
    }

    await this.ensureDeliberationTranscriptArtifact(claim);
  }

  /** Freeze the spoken turns in debate order for every table voter. */
  private async tableVoteDebate(claimId: string): Promise<{
    debate: TableVoteDebateTurn[];
    convergedAfterExchange: 1 | 2 | 3 | null;
    deliberationSpecVersion?: "4";
  }> {
    const [tally, reveals, turns] = await Promise.all([
      this.requiredTally(claimId, 1),
      this.#repository.listReveals(claimId, 1),
      this.#repository.listDeliberationTurns(claimId),
    ]);
    const seatIndexById = new Map(
      tally.expectedJurySeatIds.map((jurySeatId, seatIndex) => [
        jurySeatId,
        seatIndex,
      ]),
    );
    const debate = turns
      .filter((turn) => turn.status === "SPOKEN")
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((turn): TableVoteDebateTurn => {
        const seatIndex = seatIndexById.get(turn.jurySeatId);
        if (
          seatIndex === undefined ||
          turn.stance === undefined ||
          turn.confidenceBps === undefined
        ) {
          throw new EngineStateError(
            `spoken table debate turn ${turn.turnId} is incomplete`,
          );
        }
        return {
          seat: seatIndex,
          exchange: turn.exchange,
          argument: turn.argument,
          citations: turn.citations,
          stance: turn.stance,
          confidenceBps: turn.confidenceBps,
          // The table reads the thread too, when the debate ran on V4. Its
          // seat numbers are 1-based, so the speaker carries one as well.
          ...(turn.specVersion === undefined
            ? {}
            : { seatNumber: seatIndex + 1 }),
          ...(turn.answering === undefined || turn.answering === null
            ? {}
            : { answering: turn.answering }),
          ...(turn.theirPoint === undefined || turn.theirPoint.length === 0
            ? {}
            : { theirPoint: turn.theirPoint }),
          ...(turn.question === undefined ? {} : { question: turn.question }),
        };
      });
    const roundOneStances = new Map(
      reveals.map((reveal) => [
        reveal.jurySeatId,
        outcomeLabel(reveal.outcome),
      ]),
    );
    const specVersion = turns.find(
      (turn) => turn.specVersion !== undefined,
    )?.specVersion;
    return {
      debate,
      convergedAfterExchange: debateConvergedAfterExchange(
        turns,
        roundOneStances,
      ),
      ...(specVersion === undefined
        ? {}
        : { deliberationSpecVersion: specVersion }),
    };
  }

  private async deliberationDebaters(
    claimId: string,
  ): Promise<{
    priorRound: PriorRoundPublicRecord;
    debaters: DeliberationDebater[];
  }> {
    const [priorRound, tally, reveals, runs] = await Promise.all([
      this.roundOnePublicRecord(claimId),
      this.requiredTally(claimId, 1),
      this.#repository.listReveals(claimId, 1),
      this.#repository.listInferenceRuns(claimId, 1),
    ]);
    const revealedSeatIds = new Set(tally.revealedJurySeatIds);
    const revealBySeat = new Map(
      reveals.map((reveal) => [reveal.jurySeatId, reveal]),
    );
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const debaters = await Promise.all(
      tally.expectedJurySeatIds.flatMap((jurySeatId, seatIndex) => {
        if (!revealedSeatIds.has(jurySeatId)) return [];
        const reveal = revealBySeat.get(jurySeatId);
        const run = reveal === undefined ? undefined : runById.get(reveal.runId);
        if (reveal === undefined || run?.output === undefined) {
          throw new EngineStateError(
            `round one deliberation is missing seat ${jurySeatId}`,
          );
        }
        return [{ reveal, run, seatIndex }];
      }).map(async ({ reveal, run, seatIndex }): Promise<DeliberationDebater> => {
        const core = revealedRunBundleCore(run);
        return {
          jurySeatId: reveal.jurySeatId,
          agentProfileId: reveal.agentProfileId,
          modelId: run.modelId,
          seatIndex,
          outcome: outcomeLabel(reveal.outcome),
          confidenceBps: reveal.confidenceBps,
          run,
          manifest: await this.#repository.getAgentManifest(reveal.agentProfileId),
          // Debaters are round-one research seats; a v6 table vote core carries a
          // TableVoteInput and never reaches this path.
          input:
            core !== undefined && !("kind" in core.input) ? core.input : undefined,
          openedUrls:
            core !== undefined && "transcript" in core
              ? core.transcript.opened.flatMap((page) => [page.url, page.finalUrl])
              : [],
        };
      }),
    );
    return { priorRound, debaters };
  }

  private deliberationAllowedCitations(
    debater: DeliberationDebater,
    manifest: EvidenceManifestRecord | undefined,
    priorRound: PriorRoundPublicRecord,
  ): string[] {
    const ownEvidenceIds = debater.run.output?.publicReasoningTrace.flatMap(
      (entry) => entry.evidenceIds,
    ) ?? [];
    const recordEvidenceIds = priorRound.seats.flatMap((seat) =>
      seat.publicReasoningTrace.flatMap((entry) => entry.evidenceIds),
    );
    return uniqueStrings([
      ...ownEvidenceIds,
      ...debater.openedUrls,
      ...(manifest?.sortedLeaves ?? []),
      ...recordEvidenceIds,
    ]).slice(0, MAX_DELIBERATION_ALLOWED_CITATIONS);
  }

  private async completeDeliberationTurn(
    claim: ClaimRecord,
    turn: DeliberationPlanTurn,
    spec: DeliberationSpec,
    priorRound: PriorRoundPublicRecord,
    priorTurns: DeliberationTurnRecord[],
    seatIndexById: ReadonlyMap<string, number>,
    allowedCitations: string[],
    movedSoFar: boolean,
  ): Promise<DeliberationTurnRecord> {
    const { debater, plan } = turn;
    const skipped = (
      failureStatus: DeliberationFailureStatus,
      gonkaRequestId?: string,
    ): DeliberationTurnRecord =>
      this.deliberationTurnRecord(
        turn,
        spec,
        "SKIPPED",
        { argument: "", citations: [] },
        failureStatus,
        gonkaRequestId,
      );
    if (debater.manifest === undefined || debater.input === undefined) {
      return skipped("PROVIDER_ERROR");
    }
    // V4 addresses seats from 1, so its seat numbers equal the juror numbers
    // the console and the CLI print. Everything inside the engine, including
    // the speaking order, keeps the 0-based seat index.
    const asSeen = (seatIndex: number): number =>
      spec.version === "4" ? seatIndex + 1 : seatIndex;
    const seatSeen = (jurySeatId: string): number | undefined => {
      const seatIndex = seatIndexById.get(jurySeatId);
      return seatIndex === undefined ? undefined : asSeen(seatIndex);
    };
    const spokenPriorTurns = priorTurns
      .filter(
        (prior) => prior.ordinal < turn.ordinal && prior.status === "SPOKEN",
      )
      .sort((left, right) => left.ordinal - right.ordinal);
    const lastSpokenTurn = spokenPriorTurns.at(-1);
    const mostRecentSpeaker = lastSpokenTurn === undefined
      ? null
      : (seatSeen(lastSpokenTurn.jurySeatId) ?? null);
    const debateSoFar = spokenPriorTurns.map((prior) => ({
      seat: seatSeen(prior.jurySeatId),
      exchange: prior.exchange,
      argument: prior.argument,
      citations: prior.citations,
      ...(prior.stance === undefined ? {} : { stance: prior.stance }),
      ...(prior.confidenceBps === undefined
        ? {}
        : { confidenceBps: prior.confidenceBps }),
      // V4 turns show the thread they answered; V1 to V3 turns carry none.
      ...(prior.answering === undefined ? {} : { answering: prior.answering }),
      ...(prior.theirPoint === undefined
        ? {}
        : { theirPoint: prior.theirPoint }),
      ...(prior.question === undefined ? {} : { question: prior.question }),
      ...(prior.position === undefined ? {} : { position: prior.position }),
    }));
    const roundOneSeats = priorRound.seats.map(({ seatIndex, outcome }) => ({
      seatIndex: asSeen(seatIndex),
      outcome,
    }));
    const answerSeat = plan.answering === null ? null : asSeen(plan.answering);
    const pendingQuestion = plan.pendingQuestion === undefined
      ? undefined
      : { from: asSeen(plan.pendingQuestion.from), text: plan.pendingQuestion.text };
    const turnInstructions = spec.version === "4"
      ? deliberationTurnInstructionsV4({
          exchange: turn.exchange,
          role: debater.manifest.role,
          outcome: debater.outcome,
          seatNumber: asSeen(debater.seatIndex),
          roundOneSeats: roundOneSeats.map(({ seatIndex, outcome }) => ({
            seatNumber: seatIndex,
            outcome,
          })),
          answerSeat,
          pendingQuestion,
          opensDebate: plan.opensDebate,
          lastSpeakerThisExchange: plan.lastSpeakerThisExchange === null
            ? null
            : asSeen(plan.lastSpeakerThisExchange),
          movedSoFar,
        })
      : deliberationTurnInstructions({
          exchange: turn.exchange,
          role: debater.manifest.role,
          outcome: debater.outcome,
          seatIndex: debater.seatIndex,
          roundOneSeats,
          mostRecentSpeaker,
          movedSoFar,
        });
    const messages = [
      { role: "system" as const, content: spec.systemPrompt },
      {
        role: "user" as const,
        content: canonicalJsonString({
          statement: claim.statement,
          resolutionCriteria: claim.resolutionCriteria,
          // V4 renumbers the record's seats for the model; the frozen
          // round-one artifact itself is never touched.
          roundOneRecord: spec.version === "4"
            ? {
                ...priorRound,
                seats: priorRound.seats.map((seat) => ({
                  ...seat,
                  seatIndex: asSeen(seat.seatIndex),
                })),
              }
            : priorRound,
          debateSoFar,
          exchange: turn.exchange,
          mostRecentSpeaker,
          // V4 states the conversation duties as data, not only as prose.
          ...(spec.version === "4"
            ? { answerSeat, pendingQuestion: pendingQuestion ?? null }
            : {}),
          turnInstructions,
          self: {
            jurySeatId: debater.jurySeatId,
            seatIndex: asSeen(debater.seatIndex),
            role: debater.manifest.role,
            outcome: debater.outcome,
            confidenceBps: debater.confidenceBps,
          },
          allowedCitations,
        }),
      },
    ];
    try {
      const completion = await this.#gonka.complete({
        manifest: debater.manifest.manifest,
        messages,
        kind: "PRIMARY",
        jsonMode: true,
        input: debater.input,
        attempts: [],
        timeoutMs: PER_TURN_BUDGET_MS,
        maxOutputTokens: spec.maxOutputTokens,
      });
      if (!completion.ok) return skipped(completion.status);
      const validated = spec.version === "4"
        ? validateDeliberationOutputV4(completion.content, {
            allowedCitations: new Set(allowedCitations),
            seatNumbers: new Set(
              [...seatIndexById.values()].map((seatIndex) => asSeen(seatIndex)),
            ),
            selfSeatNumber: asSeen(debater.seatIndex),
            opensDebate: plan.opensDebate,
          })
        : validateDeliberationOutput(
            completion.content,
            new Set(allowedCitations),
          );
      if (!validated.ok) {
        return skipped(validated.failureStatus, completion.gonkaRequestId);
      }
      return this.deliberationTurnRecord(
        turn,
        spec,
        "SPOKEN",
        validated.content,
        undefined,
        completion.gonkaRequestId,
      );
    } catch (error) {
      return skipped(deliberationProviderFailure(error));
    }
  }

  private deliberationTurnRecord(
    turn: DeliberationPlanTurn,
    spec: DeliberationSpec,
    status: DeliberationTurnPublic["status"],
    content: DeliberationTurnContent,
    failureStatus?: DeliberationFailureStatus,
    gonkaRequestId?: string,
  ): DeliberationTurnRecord {
    const atMs = this.#now();
    const timestamp = new Date(atMs).toISOString();
    // Only a spoken V4 turn carries the conversation fields, so a V1 to V3
    // transcript keeps hashing to exactly the bytes it always did.
    const conversation = status === "SPOKEN" && spec.version === "4"
      ? {
          specVersion: "4" as const,
          answering: content.answering ?? null,
          theirPoint: content.theirPoint ?? "",
          analysis: content.analysis ?? "",
          ...(content.question === undefined
            ? {}
            : { question: content.question }),
          position: content.position ?? "",
        }
      : {};
    return {
      turnId: `${turn.debater.run.claimId}:${turn.ordinal}`,
      claimId: turn.debater.run.claimId,
      jurySeatId: turn.debater.jurySeatId,
      agentProfileId: turn.debater.agentProfileId,
      modelId: turn.debater.modelId,
      ordinal: turn.ordinal,
      exchange: turn.exchange,
      ...conversation,
      argument: content.argument,
      citations: content.citations,
      ...(content.stance === undefined ? {} : { stance: content.stance }),
      ...(content.confidenceBps === undefined
        ? {}
        : { confidenceBps: content.confidenceBps }),
      status,
      ...(failureStatus === undefined ? {} : { failureStatus }),
      atMs,
      ...(gonkaRequestId === undefined ? {} : { gonkaRequestId }),
      promptSpecHash: spec.promptSpecHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async persistDeliberationTurn(
    record: DeliberationTurnRecord,
  ): Promise<void> {
    await this.#repository.saveDeliberationTurn(record);
    const turn = toPublicDeliberationTurn(record);
    // Public streaming is best effort. The stored transcript remains authoritative.
    await this.emit({
      claimId: turn.claimId,
      phase: "DISCUSSION",
      kind: "DELIBERATION_TURN",
      source: "ENGINE",
      visibility: "PUBLIC_NOW",
      actorId: turn.agentProfileId,
      occurredAt: new Date(turn.atMs).toISOString(),
      payload: { ...turn },
    }).catch(() => undefined);
  }

  /** Assemble only vote data already made public by the round one reveal. */
  private async roundOnePublicRecord(
    claimId: string,
  ): Promise<PriorRoundPublicRecord> {
    const [tally, reveals, runs] = await Promise.all([
      this.requiredTally(claimId, 1),
      this.#repository.listReveals(claimId, 1),
      this.#repository.listInferenceRuns(claimId, 1),
    ]);
    if (reveals.length !== tally.revealedJurySeatIds.length) {
      throw new EngineStateError("round one revealed public record is incomplete");
    }
    const seatIndexById = new Map(
      tally.expectedJurySeatIds.map((jurySeatId, seatIndex) => [
        jurySeatId,
        seatIndex,
      ]),
    );
    const revealBySeat = new Map(
      reveals.map((reveal) => [reveal.jurySeatId, reveal]),
    );
    const runById = new Map(runs.map((run) => [run.runId, run]));
    const seats = tally.revealedJurySeatIds.map((jurySeatId) => {
      const seatIndex = seatIndexById.get(jurySeatId);
      const reveal = revealBySeat.get(jurySeatId);
      const run = reveal === undefined ? undefined : runById.get(reveal.runId);
      if (seatIndex === undefined || reveal === undefined || run?.output === undefined) {
        throw new EngineStateError(
          `round one revealed public record is missing seat ${jurySeatId}`,
        );
      }
      return {
        seatIndex,
        modelId: run.modelId,
        outcome: outcomeLabel(reveal.outcome),
        confidenceBps: reveal.confidenceBps,
        publicReasoningTrace: run.output.publicReasoningTrace,
      };
    });
    return {
      phase: 1,
      seats: seats.sort((left, right) => left.seatIndex - right.seatIndex),
    };
  }

  private async ensureRoundOnePublicRecordArtifact(
    claim: ClaimRecord,
    priorRound: PriorRoundPublicRecord,
  ): Promise<EvidenceArtifactRecord> {
    const evidenceId = roundOnePublicRecordEvidenceId(claim.claimId);
    const content = canonicalJsonString(priorRound);
    const contentHash = toHex(blake2b256(new TextEncoder().encode(content)));
    const existing = await this.#repository.getEvidenceArtifact(evidenceId);
    if (existing !== undefined) {
      if (
        existing.claimId !== claim.claimId ||
        existing.phase !== 2 ||
        existing.sourceUrl !== ROUND_ONE_PUBLIC_RECORD_SOURCE_URL ||
        existing.contentHash !== contentHash
      ) {
        throw new EngineStateError("round one public record evidence is inconsistent");
      }
      return existing;
    }
    await this.ingestText(claim, content, 2, {
      evidenceId,
      sourceUrl: ROUND_ONE_PUBLIC_RECORD_SOURCE_URL,
    });
    const artifact = await this.#repository.getEvidenceArtifact(evidenceId);
    if (artifact === undefined) {
      throw new EngineStateError("round one public record evidence is missing");
    }
    return artifact;
  }

  private async ensureDeliberationTranscriptArtifact(
    claim: ClaimRecord,
  ): Promise<EvidenceArtifactRecord> {
    const evidenceId = deliberationTranscriptEvidenceId(claim.claimId);
    const [records, roundOneReveals] = await Promise.all([
      this.#repository.listDeliberationTurns(claim.claimId),
      this.#repository.listReveals(claim.claimId, 1),
    ]);
    const roundOneStances = new Map(
      roundOneReveals.map((reveal) => [
        reveal.jurySeatId,
        outcomeLabel(reveal.outcome),
      ]),
    );
    const content = canonicalJsonString({
      version: 1,
      kind: "deliberation-transcript",
      convergedAfterExchange: debateConvergedAfterExchange(
        records,
        roundOneStances,
      ),
      turns: records
        .map(toPublicDeliberationTurn)
        .sort((left, right) => left.ordinal - right.ordinal),
    });
    const contentHash = toHex(blake2b256(new TextEncoder().encode(content)));
    const existing = await this.#repository.getEvidenceArtifact(evidenceId);
    if (existing !== undefined) {
      if (
        existing.claimId !== claim.claimId ||
        existing.phase !== 2 ||
        existing.sourceUrl !== DELIBERATION_TRANSCRIPT_SOURCE_URL ||
        existing.contentHash !== contentHash
      ) {
        throw new EngineStateError("deliberation transcript evidence is inconsistent");
      }
      return existing;
    }
    await this.ingestText(claim, content, 2, {
      evidenceId,
      sourceUrl: DELIBERATION_TRANSCRIPT_SOURCE_URL,
    });
    const artifact = await this.#repository.getEvidenceArtifact(evidenceId);
    if (artifact === undefined) {
      throw new EngineStateError("deliberation transcript evidence is missing");
    }
    return artifact;
  }

  private async artifactsForPhase(
    claimId: string,
    phase: 1 | 2,
  ): Promise<EvidenceArtifactRecord[]> {
    const artifacts = await this.#repository.listEvidenceArtifacts(claimId, phase);
    if (phase === 1) return statementArtifactFirst(artifacts);
    const publicRecordEvidenceId = roundOnePublicRecordEvidenceId(claimId);
    const transcriptEvidenceId = deliberationTranscriptEvidenceId(claimId);
    const publicRecordArtifact = artifacts.find(
      (artifact) => artifact.evidenceId === publicRecordEvidenceId,
    );
    if (publicRecordArtifact === undefined) {
      throw new EngineStateError("round one public record evidence is missing");
    }
    // Optional on purpose: claims frozen before the deliberation phase
    // existed have no transcript, and their roots must keep recomputing.
    // New claims always carry one, because the phase-two freeze ensures the
    // artifact before it builds the manifest.
    const transcriptArtifact = artifacts.find(
      (artifact) => artifact.evidenceId === transcriptEvidenceId,
    );
    let secondRoundArtifacts = artifacts.filter(
      (artifact) =>
        artifact.evidenceId !== publicRecordEvidenceId &&
        artifact.evidenceId !== transcriptEvidenceId,
    );
    if (secondRoundArtifacts.length === 0) {
      secondRoundArtifacts = await this.#repository.listEvidenceArtifacts(claimId, 1);
    }
    return [
      ...statementArtifactFirst(secondRoundArtifacts),
      ...(transcriptArtifact === undefined ? [] : [transcriptArtifact]),
      publicRecordArtifact,
    ];
  }

  private async evidenceManifests(claimId: string): Promise<EvidenceManifestRecord[]> {
    const values = await Promise.all([
      this.#repository.getEvidenceManifest(claimId, 1),
      this.#repository.getEvidenceManifest(claimId, 2),
    ]);
    return values.filter((value): value is EvidenceManifestRecord => value !== undefined);
  }

  private isoNow(): string {
    return new Date(this.#now()).toISOString();
  }
}

type ValidatedZkBackedRegistrationRequest = ZkBackedRegistrationRequest & {
  zkLoginAddress: `0x${string}`;
  /** Absent is the normal case now: the engine assigns the seat's role. */
  role?: ZkLoginAgentRole;
};

function validateZkBackedRegistrationRequest(
  request: ZkBackedRegistrationRequest,
  manifest: ReleaseManifest,
): asserts request is ValidatedZkBackedRegistrationRequest {
  if (
    typeof request.zkLoginAddress !== "string" ||
    !SUI_ADDRESS_PATTERN.test(request.zkLoginAddress)
  ) {
    throw new EngineValidationError(
      "the staking address must be a canonical lowercase 32-byte Sui address",
    );
  }
  if (
    typeof request.signature !== "string" ||
    request.signature.length === 0 ||
    request.signature.length > MAX_ZKLOGIN_SIGNATURE_LENGTH ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(request.signature)
  ) {
    throw new EngineValidationError("signature must be a bounded base64 string");
  }
  if (
    typeof request.modelId !== "string" ||
    !manifest.gonka.models.includes(request.modelId)
  ) {
    throw new EngineValidationError(
      "modelId must be present in the release manifest catalog",
    );
  }
  assertOptionalRole(request.role);
}

function isZkLoginAgentRole(role: string): role is ZkLoginAgentRole {
  return ZKLOGIN_AGENT_ROLES.some((candidate) => candidate === role);
}

/** An API caller may still name a role; the browser card never does. */
function assertOptionalRole(
  role: string | undefined,
): asserts role is ZkLoginAgentRole | undefined {
  if (role === undefined) return;
  if (typeof role !== "string" || !isZkLoginAgentRole(role)) {
    throw new EngineValidationError(
      `role must be one of ${ZKLOGIN_AGENT_ROLES.join(", ")}`,
    );
  }
}

type ValidatedStakePreparationRequest = StakePreparationRequest & {
  stakerAddress: `0x${string}`;
  /** Absent is the normal case now: the engine assigns the seat's role. */
  role?: ZkLoginAgentRole;
};

function validateStakePreparationRequest(
  request: StakePreparationRequest,
  manifest: ReleaseManifest,
): asserts request is ValidatedStakePreparationRequest {
  if (
    typeof request.stakerAddress !== "string" ||
    !SUI_ADDRESS_PATTERN.test(request.stakerAddress)
  ) {
    throw new EngineValidationError(
      "the staking address must be a canonical lowercase 32-byte Sui address",
    );
  }
  if (
    typeof request.modelId !== "string" ||
    !manifest.gonka.models.includes(request.modelId)
  ) {
    throw new EngineValidationError(
      "modelId must be present in the release manifest catalog",
    );
  }
  assertOptionalRole(request.role);
  assertOptionalStakeAmount(request.amountMist);
}

/**
 * The optional stake amount: whole MIST, at least the minimum and at most the
 * ceiling. Absent means the minimum, which is what every caller sent before
 * the amount was a choice. The digit bound keeps a pasted essay out of BigInt
 * before the range check runs.
 */
function assertOptionalStakeAmount(amountMist: string | undefined): void {
  if (amountMist === undefined) return;
  if (typeof amountMist !== "string" || !/^\d{1,20}$/.test(amountMist)) {
    throw new EngineValidationError("amountMist must be a decimal amount of MIST");
  }
  const amount = BigInt(amountMist);
  if (amount < MIN_STAKE_MIST) {
    throw new EngineValidationError(
      `the stake must be at least ${MIN_STAKE_MIST} MIST (0.1 SUI)`,
    );
  }
  if (amount > MAX_STAKE_MIST) {
    throw new EngineValidationError(
      `the stake must be at most ${MAX_STAKE_MIST} MIST (1000 SUI)`,
    );
  }
}

/** Sui transaction digests are base58; the bound keeps a stray blob out of SQL. */
const MAX_TRANSACTION_DIGEST_LENGTH = 64;
const MAX_RESERVATION_ID_LENGTH = 64;

function validateStakeConfirmationRequest(
  request: StakeConfirmationRequest,
): void {
  if (
    typeof request.reservationId !== "string" ||
    request.reservationId.length === 0 ||
    request.reservationId.length > MAX_RESERVATION_ID_LENGTH
  ) {
    throw new EngineValidationError("reservationId must be a bounded string");
  }
  if (
    typeof request.digest !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(request.digest) ||
    request.digest.length > MAX_TRANSACTION_DIGEST_LENGTH
  ) {
    throw new EngineValidationError("digest must be a base58 transaction digest");
  }
}

/** Sui addresses are compared case-insensitively; nothing else normalizes. */
function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** The confirmation a CONFIRMED reservation replays, byte for byte. */
function storedStakeConfirmation(
  reservation: StakeReservationRecord,
): StakeConfirmation {
  if (!reservation.agentProfileId || !reservation.digest) {
    throw new EngineStateError(
      `confirmed stake reservation ${reservation.reservationId} has no recorded transaction`,
    );
  }
  return {
    agentProfileId: reservation.agentProfileId,
    staker: reservation.stakerAddress,
    stakeMist: reservation.stakeMist ?? MIN_STAKE_MIST.toString(),
    digest: reservation.digest,
    backingKind: "WALLET_STAKED",
    operationalOwner: reservation.operationalOwner,
    gasFloat: reservation.gasFloat ?? "skipped",
  };
}

/**
 * The stake kind follows the signature scheme: a zkLogin signature keeps the
 * zkLogin kind, every other wallet scheme is a plain wallet stake. Only an
 * already-verified signature reaches this, so unreadable bytes fail closed.
 */
function stakeBackingKind(signature: string): StakedAgentBackingKind {
  try {
    return parseSerializedSignature(signature).signatureScheme === "ZkLogin"
      ? "ZKLOGIN_BACKED"
      : "WALLET_STAKED";
  } catch {
    throw new EngineValidationError("signature scheme could not be read");
  }
}

function createDefaultZkLoginVerifier(config: EngineConfig): ZkLoginVerifier {
  const configuredUrl = config.zkLoginGraphqlUrl?.trim();
  const graphqlUrl =
    configuredUrl ||
    (config.network === "localnet"
      ? undefined
      : `https://sui-${config.network}.mystenlabs.com/graphql`);
  return new MystenSdkZkLoginVerifier(config.network, graphqlUrl);
}

/** Uses the SDK helper, which delegates zkLogin JWK/epoch checks to GraphQL. */
class MystenSdkZkLoginVerifier implements ZkLoginVerifier {
  readonly #client?: SuiGraphQLClient;

  constructor(
    network: EngineConfig["network"],
    graphqlUrl: string | undefined,
  ) {
    if (graphqlUrl) {
      this.#client = new SuiGraphQLClient({
        network,
        url: graphqlUrl,
      });
    }
  }

  async verify(input: ZkLoginVerificationInput): Promise<boolean> {
    let scheme: SignatureScheme;
    try {
      scheme = parseSerializedSignature(input.signature).signatureScheme;
    } catch {
      return false;
    }

    // Only zkLogin needs GraphQL (JWK and epoch lookups). Every other wallet
    // scheme verifies locally from the signature's own public key.
    if (scheme !== "ZkLogin") {
      return isValidPersonalMessageSignature(input.message, input.signature, {
        address: input.zkLoginAddress,
      });
    }

    if (!this.#client) {
      throw new Error(
        "zkLogin GraphQL verification requires zkLoginGraphqlUrl on localnet",
      );
    }

    return isValidPersonalMessageSignature(input.message, input.signature, {
      address: input.zkLoginAddress,
      client: this.#client,
    });
  }
}

function resolveGateway(config: EngineConfig, manifest: ReleaseManifest): SuiGateway {
  if (config.suiGateway) return config.suiGateway;
  if (!config.suiClient || !config.signers) {
    throw new EngineValidationError(
      "createEngine requires suiClient and signers when suiGateway is not injected",
    );
  }
  return createSuiGateway({
    client: config.suiClient,
    signers: config.signers,
    manifest,
  });
}

export function manifestEvidencePolicy(manifest: ReleaseManifest): RetrievalPolicy {
  return manifest.evidencePolicy
    ? {
        maxBytes: manifest.evidencePolicy.maxBytes,
        maxRedirects: manifest.evidencePolicy.maxRedirects,
        timeoutMs: manifest.evidencePolicy.timeoutMs,
        allowedMime: manifest.evidencePolicy.allowedMime,
      }
    : DEFAULT_EVIDENCE_POLICY;
}

function evidencePolicyId(manifest: ReleaseManifest): `0x${string}` {
  return (
    manifest.evidencePolicy?.id ??
    toHex(blake2b256(new TextEncoder().encode(EVIDENCE_POLICY_V1_LABEL)))
  ) as `0x${string}`;
}

/** Time reserved after the last seat for lock_committee, approvals and commit_vote txs. */
const SEAT_COMMIT_MARGIN_MS = 60_000;
/** How often juryRun retries the queued commit between the acceptance floor and the deadline. */
const COMMIT_PUMP_INTERVAL_MS = 5_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Integer milliseconds since a performance.now() mark. Every event that
 * closes a step carries these as a `timing_ms` payload object, so a live
 * claim says what each step actually cost
 * (docs/superpowers/specs/2026-09-04-fast-path-design.md section 4).
 */
function since(startedAtMs: number): number {
  return Math.max(0, Math.round(performance.now() - startedAtMs));
}

/**
 * What the engine's own mirror says about eligibility right now: every seat
 * it knows, with the flag it carries. `agents eligibility` and `registry
 * sync-mirror` write the chain and this mirror together, so a change here is
 * the engine's signal that the registry moved, and it crosses processes
 * because the mirror is the shared database. Deployments hold tens of rows,
 * so the string is small and built only when the gate is asked.
 */
function eligibilityRevision(records: readonly AgentManifestRecord[]): string {
  return records
    .map(
      (record) =>
        `${record.manifest.agentProfileId.toLowerCase()}:${record.active ? "1" : "0"}`,
    )
    .sort()
    .join(",");
}

/**
 * Seats grouped by the agent that signs for them. Every agent-signed
 * transaction (accept, bind, commit, reveal) spends that agent's own gas
 * coin, so two seats of one agent must go in order while different agents
 * never contend: this is the shape every such step runs in.
 */
function groupByAgent<T extends { agentProfileId: string }>(seats: readonly T[]): T[][] {
  const byAgent = new Map<string, T[]>();
  for (const seat of seats) {
    const list = byAgent.get(seat.agentProfileId) ?? [];
    list.push(seat);
    byAgent.set(seat.agentProfileId, list);
  }
  return [...byAgent.values()];
}

/** Whole-claim wall clock for claim_finalized; 0 when the row has no usable date. */
function totalSinceCreated(createdAt: string, nowMs: number): number {
  const startedAtMs = Date.parse(createdAt);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.round(nowMs - startedAtMs));
}

/** Mirrors jury.move ACCEPTANCE_WINDOW_MS: seats have twenty seconds to accept. */
export const COMMITTEE_ACCEPTANCE_WINDOW_MS = 20_000;

/**
 * Chain floor for lock_committee: twenty seconds after selection, never past
 * the commit deadline (jury.move acceptance_deadline). The database timestamps
 * trail the chain by a few seconds, so this estimate is never early; an
 * unparsable timestamp defers to the worker's final votesCommit. Round two
 * has no floor: the committee is already locked and commit_vote has no time
 * floor of its own, so table votes commit the moment they are ready.
 */
function acceptanceFloorMs(
  committee: CommitteeRecord,
  phase: 1 | 2,
  commitDeadlineMs: number,
): number {
  if (phase === 2) return 0;
  const startMs = Date.parse(committee.createdAt);
  if (!Number.isFinite(startMs) || startMs >= commitDeadlineMs) return commitDeadlineMs;
  return Math.min(commitDeadlineMs, startMs + COMMITTEE_ACCEPTANCE_WINDOW_MS + 2_000);
}

// V3 adds public stance updates while keeping V2's direct turn duties.
export function deliberationTurnInstructions(input: {
  exchange: 1 | 2 | 3;
  role: string;
  outcome: "YES" | "NO" | "UNSURE";
  seatIndex: number;
  roundOneSeats: Array<{
    seatIndex: number;
    outcome: "YES" | "NO" | "UNSURE";
  }>;
  mostRecentSpeaker: number | null;
  movedSoFar: boolean;
}): string {
  const others = input.roundOneSeats.filter(
    (seat) => seat.seatIndex !== input.seatIndex,
  );
  const dissenters = others.filter((seat) => seat.outcome !== input.outcome);
  const unanimous = dissenters.length === 0;
  const oppositeOutcome = input.outcome === "YES"
    ? "NO"
    : input.outcome === "NO"
      ? "YES"
      : "a definite YES or NO";
  const roleSentence = input.role === "SKEPTIC"
    ? "You hold the SKEPTIC role: attack the weakest link in the majority reasoning even when you share the vote."
    : input.role === "SOURCE_AUTHENTICITY"
      ? "You hold the SOURCE_AUTHENTICITY role: weigh the reliability and relevance of the sources cited so far and say which deserve less weight."
      : "Argue only from the evidence in the record.";

  if (input.exchange === 1) {
    const sentences = [
      "Exchange one.",
      typeof input.mostRecentSpeaker === "number"
        ? `Begin by answering Seat ${input.mostRecentSpeaker}, the most recent speaker: name the specific claim, citation or inference of theirs you endorse or dispute.`
        : "You speak first.",
      `Then give the single strongest reason for your ${input.outcome} vote that no seat has stated yet.`,
    ];
    if (dissenters.length > 0) {
      const dissentingVotes = dissenters
        .map((seat) => `Seat ${seat.seatIndex} voted ${seat.outcome}`)
        .join(" and ");
      sentences.push(
        `${dissentingVotes}, so dispute one specific citation or inference from at least one of them.`,
      );
    } else {
      sentences.push(
        `Every revealed seat voted ${input.outcome}, so state the strongest objection to that consensus and answer it.`,
      );
    }
    sentences.push(
      "State your current stance and confidence in the stance and confidenceBps fields.",
      roleSentence,
    );
    return sentences.join(" ");
  }

  const sentences = [
    input.exchange === 2 ? "Exchange two." : "Exchange three.",
    ...(input.movedSoFar
      ? [
          "At least one seat changed its stance in the previous exchange; address that change directly.",
        ]
      : []),
    "Answer the strongest objection raised against your position in exchange one, naming the seat that raised it.",
    unanimous
      ? `Every seat agrees with you, so present the best case for ${oppositeOutcome} using the allowed source that supports it most, and explain why it does not change your vote.`
      : "If a seat changed its reasoning or conceded a point, say whether that moves you.",
    "Do not restate points already made in this debate; add only new reasoning or direct answers.",
    "Close with your final position: whether you keep, raise, lower or change your confidence, and why.",
  ];
  if (input.exchange === 3) {
    sentences.push(
      "This is the last exchange: say plainly whether you now hold, raise, lower or change your vote, and what single piece of evidence decides it.",
    );
  }
  sentences.push(
    "State your current stance and confidence in the stance and confidenceBps fields.",
    roleSentence,
  );
  return sentences.join(" ");
}

/**
 * V4 turn duties. Every turn answers a named seat first, may put one question
 * to a named seat, and states its position last, so the debate reads as a
 * conversation instead of a row of briefs.
 */
export function deliberationTurnInstructionsV4(input: {
  exchange: 1 | 2 | 3;
  role: string;
  outcome: "YES" | "NO" | "UNSURE";
  /** Every number here is a 1-based seat number, as the model sees them. */
  seatNumber: number;
  roundOneSeats: Array<{
    seatNumber: number;
    outcome: "YES" | "NO" | "UNSURE";
  }>;
  /** The seat the engine expects this turn to answer, null when it opens. */
  answerSeat: number | null;
  pendingQuestion?: { from: number; text: string };
  opensDebate: boolean;
  lastSpeakerThisExchange: number | null;
  movedSoFar: boolean;
}): string {
  const others = input.roundOneSeats.filter(
    (seat) => seat.seatNumber !== input.seatNumber,
  );
  const dissenters = others.filter((seat) => seat.outcome !== input.outcome);
  const unanimous = dissenters.length === 0;
  const oppositeOutcome = input.outcome === "YES"
    ? "NO"
    : input.outcome === "NO"
      ? "YES"
      : "a definite YES or NO";
  const roleSentence = input.role === "SKEPTIC"
    ? "You hold the SKEPTIC role: attack the weakest link in the majority reasoning even when you share the vote."
    : input.role === "SOURCE_AUTHENTICITY"
      ? "You hold the SOURCE_AUTHENTICITY role: weigh the reliability and relevance of the sources cited so far and say which deserve less weight."
      : "Argue only from the evidence in the record.";

  const sentences = [
    input.exchange === 1
      ? "Exchange one."
      : input.exchange === 2
        ? "Exchange two."
        : "Exchange three.",
  ];
  if (input.movedSoFar) {
    sentences.push(
      "At least one seat changed its stance in the previous exchange; address that change directly.",
    );
  }

  // Who this turn answers: a question to you wins, then the last speaker,
  // then the opposing seat the engine picked for an opening turn.
  const lastSpeaker =
    input.lastSpeakerThisExchange !== null &&
    input.lastSpeakerThisExchange !== input.seatNumber
      ? input.lastSpeakerThisExchange
      : null;
  if (input.pendingQuestion !== undefined) {
    sentences.push(
      `Seat ${input.pendingQuestion.from} asked you: '${input.pendingQuestion.text}' Answer it first, set answering to ${input.pendingQuestion.from}, and restate their question in theirPoint.`,
    );
  } else if (lastSpeaker !== null) {
    sentences.push(
      `Seat ${lastSpeaker} spoke last: answer their point first, set answering to ${lastSpeaker}, and restate that point in theirPoint.`,
    );
  } else if (input.opensDebate) {
    sentences.push(
      input.answerSeat === null
        ? "You open the debate and no seat opposes you: set answering to null and theirPoint to the empty string."
        : `You open the debate: Seat ${input.answerSeat} is the strongest opposing seat, so set answering to ${input.answerSeat} and restate in theirPoint the round-one reasoning of theirs you dispute.`,
    );
  } else {
    sentences.push(
      input.answerSeat === null
        ? "No seat has spoken yet in this exchange: answer the strongest objection raised against your position, name that seat in answering and restate it in theirPoint."
        : `No seat has spoken yet in this exchange: answer the strongest objection raised against your position, name that seat in answering (Seat ${input.answerSeat} argued the other side last) and restate it in theirPoint.`,
    );
  }

  if (input.exchange === 1) {
    sentences.push(
      `Then give the single strongest reason for your ${input.outcome} vote that no seat has stated yet.`,
    );
    sentences.push(
      dissenters.length > 0
        ? `${listSentence(
            dissenters.map(
              (seat) => `Seat ${seat.seatNumber} voted ${seat.outcome}`,
            ),
          )}, so dispute one specific citation or inference from at least one of them.`
        : `Every revealed seat voted ${input.outcome}, so state the strongest objection to that consensus and answer it.`,
    );
  } else {
    sentences.push(
      unanimous
        ? `Every seat agrees with you, so present the best case for ${oppositeOutcome} using the allowed source that supports it most, and explain why it does not change your vote.`
        : "If a seat changed its reasoning or conceded a point, say plainly whether that moves you.",
    );
    sentences.push(
      "Do not restate points already made in this debate; add only new reasoning or direct answers.",
    );
  }
  if (input.exchange === 3) {
    sentences.push(
      "This is the last exchange: say plainly whether you now hold, raise, lower or change your vote, and what single piece of evidence decides it.",
    );
  }

  sentences.push(
    // Nobody speaks after the last exchange, so a question there is a dead end.
    input.exchange === MAX_DELIBERATION_EXCHANGES
      ? "Do not ask a question in the last exchange: set question to null."
      : "Ask one pointed question of a named seat that the record can answer, or set question to null.",
    "Write the analysis before the position: analysis is your new reasoning about the point you answered, position is your one-line conclusion and comes last.",
    "State your current stance and confidence in the stance and confidenceBps fields.",
    roleSentence,
  );
  return sentences.join(" ");
}

/** "a", "a and b", "a, b and c": one readable list, no Oxford comma. */
function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function defaultDeadlines(
  now: number,
  network: ReleaseManifest["network"],
): ClaimCreateRequest["deadlines"] {
  if (network === "localnet") {
    // Worker-friendly ladder: multi-process worker cadence (poll loops +
    // acceptance window = selection + half-way-to-commit) needs real room, or
    // browser-submitted claims miss every commit window and finalize
    // UNRESOLVED. Test harnesses pass explicit deadlines and are unaffected.
    return {
      evidenceCutoffMs: now + 45_000,
      proposalDeadlineMs: now + 50_000,
      challengeDeadlineMs: now + 55_000,
      // Minutes-scale windows: the three workers share one operator signer,
      // so equivocation stalls (objects reserved by a sibling's tx) can eat
      // tens of seconds per phase; short ladders lose whole windows to it.
      firstCommitDeadlineMs: now + 360_000,
      firstRevealDeadlineMs: now + 480_000,
      discussionDeadlineMs: now + 600_000,
      secondCommitDeadlineMs: now + 720_000,
      secondRevealDeadlineMs: now + 840_000,
    };
  }
  // Fast ladder (hosted), measured from the create_claim transaction (the
  // request's own Walrus writes come before it): a certificate can land
  // only after the reveal deadline (settlement.move) and the committee
  // locks only after the midpoint of the commit window (jury.move), so
  // these windows, not the models, set the time to resolution. The cutoff
  // leaves room for the statement artifact write that follows creation;
  // hosted seats took 19 to 45 s with page writes off the critical path; a
  // seat that misses the commit window fails closed and 4 of 5 still settle.
  // Committees must span three model families (jury.move
  // E_INSUFFICIENT_DIVERSE_AGENTS) and a round needs four matching reveals
  // of five (REQUIRED_MATCHING), so the slowest family must usually make it:
  // Kimi-K2.6 answered in 33 to 100 s on 2026-08-30. Juror research v2
  // (a support search, a challenge search, pages on both sides, nudges)
  // runs six to ten turns per seat; with a 240 s commit window every
  // seat of claim #20 hit the seat deadline mid-research, so the commit
  // window is 330 s (about 230 s of research). The reveal window must
  // hold the advance (about 15 s after the commit deadline) plus five
  // reveal-bundle writes, which run one at a time on the operator lane at
  // about 15 s each: a 60 s window lost every reveal of claim #15, so it
  // is 120 s.
  // 2026-08-30 22:30: the owner keeps all jurors at equal selection weight
  // and accepts slower verdicts so that the slow family finishes. Kimi's
  // calls on claim #22 took 60, 5 and 36 s and its fourth (the minimum
  // trail under policy v4 is four turns) was cut at 97 s by the seat
  // bound, so the commit window grows from 330 s to 450 s (about 350 s of
  // research; a certificate lands about 10 min after the POST). The reveal
  // window and the discussion window keep their lengths and shift with it.
  // 2026-08-30 23:00: round two used to get only 120 s of research (its
  // commit deadline minus the 60 s seat margin minus the discussion
  // deadline), a sprint that cut two seats of claim #24 mid-call and left
  // every two-round claim UNRESOLVED, so the second commit window is now
  // as long as the first (450 s after the discussion deadline) and the
  // second reveal window stays 120 s: a two-round claim ends about 21 min
  // after the POST, a one-round verdict still at about 10 min.
  // 2026-09-02: the 840 s discussion window allows up to fifteen 60 s turns
  // plus the 120 s freeze lead. The 240 s second commit window allows five
  // short vote runs plus their approve and commit transactions.
  // 2026-09-03 04:45: under the all-or-nothing rule every seat must finish,
  // and the night's voids were seats still retrying shed or timed-out calls
  // at the deadline (four of five committed by about +330 s, the fifth
  // stuck), so the first commit window grows from 450 s to 600 s (about
  // 500 s of research). The later windows keep their lengths and shift by
  // 150 s: a one-round verdict lands about 12 min after the POST, a
  // two-round claim about 32 min.
  const second = 1_000;
  return {
    evidenceCutoffMs: now + 60 * second,
    proposalDeadlineMs: now + 65 * second,
    challengeDeadlineMs: now + 70 * second,
    firstCommitDeadlineMs: now + 600 * second,
    firstRevealDeadlineMs: now + 720 * second,
    discussionDeadlineMs: now + 1560 * second,
    secondCommitDeadlineMs: now + 1800 * second,
    secondRevealDeadlineMs: now + 1920 * second,
  };
}

function newestWeatherAtMs(rows: readonly GonkaWeatherRecord[]): number | null {
  let newest: number | null = null;
  for (const row of rows) {
    const parsed = Date.parse(row.probedAt);
    if (!Number.isFinite(parsed)) continue;
    newest = newest === null ? parsed : Math.max(newest, parsed);
  }
  return newest;
}

function weatherFamily(modelId: string): WeatherFamily["family"] {
  if (modelId === RESEARCH_WEATHER_ID) return "research";
  const normalized = modelId.toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("kimi")) return "kimi";
  return modelId;
}

function validateFactCheckRequest(request: FactCheckRequest): void {
  if (request.claim.trim().length === 0 || request.claim.length > 32_000) {
    throw new EngineValidationError("claim must contain 1 to 32000 characters");
  }
  if (
    request.text !== undefined &&
    request.text.length > MAX_FACT_CHECK_TEXT_LENGTH
  ) {
    throw new EngineValidationError(
      `text exceeds maximum length of ${MAX_FACT_CHECK_TEXT_LENGTH} characters`,
    );
  }
  validateHttpsUrls(request.urls);
}

function validateClaimCreateRequest(request: ClaimCreateRequest): void {
  if (request.statement.trim().length === 0 || request.statement.length > 32_000) {
    throw new EngineValidationError("statement must contain 1 to 32000 characters");
  }
  if (
    request.resolutionCriteria.trim().length === 0 ||
    request.resolutionCriteria.length > 32_000
  ) {
    throw new EngineValidationError(
      "resolution criteria must contain 1 to 32000 characters",
    );
  }
  const deadlines = Object.values(request.deadlines);
  if (
    deadlines.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    deadlines.some((value, index) => index > 0 && value <= deadlines[index - 1]!)
  ) {
    throw new EngineValidationError("claim deadlines must be safe, strictly increasing milliseconds");
  }
  for (const [name, value] of [
    ["committeeBudget", request.committeeBudget],
    ["evidenceBudget", request.evidenceBudget],
  ] as const) {
    if (!/^\d+$/.test(value)) {
      throw new EngineValidationError(`${name} must be a non-negative decimal string`);
    }
  }
}

function validateHttpsUrls(urls: string[]): void {
  if (urls.length > 16) throw new EngineValidationError("at most 16 evidence URLs are allowed");
  for (const value of urls) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new EngineValidationError(`invalid evidence URL: ${value}`);
    }
    if (parsed.protocol !== "https:") {
      throw new EngineValidationError(`evidence URL must use HTTPS: ${value}`);
    }
  }
}

function emptyTally(committee: CommitteeRecord, timestamp: string): RoundTallyRecord {
  return {
    roundTallyId: committee.roundTallyId,
    claimId: committee.claimId,
    committeeId: committee.committeeId,
    phase: committee.phase,
    expectedJurySeatIds: committee.jurySeatIds,
    revealedJurySeatIds: [],
    revealedVoteIds: [],
    yesCount: 0,
    noCount: 0,
    unsureCount: 0,
    truthProbabilitySumBps: 0,
    truthProbabilityCount: 0,
    closed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toEvidenceManifestItem(record: EvidenceArtifactRecord): EvidenceManifestItem {
  return {
    evidenceId: record.evidenceId,
    contentHash: fromHex(record.contentHash),
    canonicalHash: fromHex(record.canonicalHash),
    sourceUrl: record.sourceUrl,
    finalUrl: record.finalUrl,
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    retrievedAt: Date.parse(record.retrievedAt),
    parserVersion: record.parserVersion,
    rawWalrusBlobId: record.rawWalrusBlobId,
    ...(record.rawWalrusObjectId === undefined
      ? {}
      : { rawWalrusObjectId: record.rawWalrusObjectId as `0x${string}` }),
    canonicalWalrusBlobId: record.canonicalWalrusBlobId,
    ...(record.canonicalWalrusObjectId === undefined
      ? {}
      : { canonicalWalrusObjectId: record.canonicalWalrusObjectId as `0x${string}` }),
    ...(record.walrusEndEpoch === undefined
      ? {}
      : { walrusEndEpoch: record.walrusEndEpoch }),
  };
}

function uniqueEvidenceArtifacts(
  artifacts: EvidenceArtifactRecord[],
): EvidenceArtifactRecord[] {
  const contentHashes = new Set<string>();
  const canonicalHashes = new Set<string>();
  return artifacts.filter((artifact) => {
    if (
      contentHashes.has(artifact.contentHash) ||
      canonicalHashes.has(artifact.canonicalHash)
    ) {
      return false;
    }
    contentHashes.add(artifact.contentHash);
    canonicalHashes.add(artifact.canonicalHash);
    return true;
  });
}

function statementArtifactFirst(
  artifacts: EvidenceArtifactRecord[],
): EvidenceArtifactRecord[] {
  return [
    ...artifacts.filter(
      (artifact) => artifact.sourceUrl === CLAIM_STATEMENT_SOURCE_URL,
    ),
    ...artifacts.filter(
      (artifact) => artifact.sourceUrl !== CLAIM_STATEMENT_SOURCE_URL,
    ),
  ];
}

function roundOnePublicRecordEvidenceId(claimId: string): string {
  return `round-1-public-record:${claimId}`;
}

function deliberationTranscriptEvidenceId(claimId: string): string {
  return `deliberation-transcript:${claimId}`;
}

/**
 * Only the facts the speaking order depends on, in its own vocabulary. The
 * order works on 0-based seat indexes, so a V4 question, which names a 1-based
 * seat number, is translated back here.
 */
function toDebateTurnFacts(record: DeliberationTurnRecord): DebateTurnFacts {
  return {
    jurySeatId: record.jurySeatId,
    ordinal: record.ordinal,
    exchange: record.exchange,
    status: record.status,
    ...(record.stance === undefined ? {} : { stance: record.stance }),
    ...(record.question === undefined
      ? {}
      : {
          question: {
            seat: record.question.seat - 1,
            text: record.question.text,
          },
        }),
  };
}

function toPublicDeliberationTurn(
  record: DeliberationTurnRecord,
): DeliberationTurnPublic {
  return {
    claimId: record.claimId,
    jurySeatId: record.jurySeatId,
    agentProfileId: record.agentProfileId,
    ...(record.modelId === undefined ? {} : { modelId: record.modelId }),
    ordinal: record.ordinal,
    exchange: record.exchange,
    // Absent on V1 to V3 turns, so their canonical bytes never change.
    ...(record.specVersion === undefined
      ? {}
      : { specVersion: record.specVersion }),
    ...(record.answering === undefined ? {} : { answering: record.answering }),
    ...(record.theirPoint === undefined
      ? {}
      : { theirPoint: record.theirPoint }),
    ...(record.analysis === undefined ? {} : { analysis: record.analysis }),
    ...(record.question === undefined ? {} : { question: record.question }),
    ...(record.position === undefined ? {} : { position: record.position }),
    argument: record.argument,
    citations: record.citations,
    ...(record.stance === undefined ? {} : { stance: record.stance }),
    ...(record.confidenceBps === undefined
      ? {}
      : { confidenceBps: record.confidenceBps }),
    status: record.status,
    ...(record.failureStatus === undefined
      ? {}
      : { failureStatus: record.failureStatus }),
    atMs: record.atMs,
  };
}

function revealedRunBundleCore(
  run: InferenceRunRecord,
): PublicRunBundleCore | undefined {
  if (run.revealedBlobId === undefined || run.audit.bundleCore === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(run.audit.bundleCore) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("kind" in parsed) ||
      parsed.kind !== "run-bundle" ||
      !("input" in parsed)
    ) {
      return undefined;
    }
    return parsed as PublicRunBundleCore;
  } catch {
    return undefined;
  }
}

/** A table vote is valid only when its standard output cites frozen evidence. */
export function validateTableVote(
  content: unknown,
  ctx: {
    frozenEvidenceIds: readonly string[];
    maximumReasonLength: number;
  },
):
  | { ok: true; output: OracleInferenceOutput; repairs: string[] }
  | { ok: false; errors: string[] } {
  try {
    if (typeof content !== "string") {
      throw new Error("table vote output must be JSON content");
    }
    const extracted = extractJsonObject(content) as OracleInferenceOutput;
    // MiniMax sometimes writes a sentence here. No other output field is repaired.
    const repair = repairUnsupportedClaims(
      extracted,
      (evidenceId) => ctx.frozenEvidenceIds.includes(evidenceId),
    );
    const output = repair.output;
    const evidenceManifest: OracleInferenceInput["evidenceManifest"] = {
      root: "",
      items: ctx.frozenEvidenceIds.map((evidenceId) => ({
        evidenceId,
        sourceClass: "TABLE_VOTE",
        retrievedAt: "",
        walrusBlobId: "",
        contentHash: "",
        excerpt: "",
      })),
    };
    validateOutputAgainstManifest(output, evidenceManifest);
    if (output.reasoning.length > ctx.maximumReasonLength) {
      throw new Error(
        `reasoning exceeds ${ctx.maximumReasonLength} characters`,
      );
    }
    return {
      ok: true,
      output,
      repairs: repair.dropped.map(unsupportedClaimsRepairNote),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

type DeliberationOutputValidation =
  | { ok: true; content: DeliberationTurnContent }
  | { ok: false; failureStatus: DeliberationFailureStatus };

function validateDeliberationOutput(
  content: string,
  allowedCitations: ReadonlySet<string>,
): DeliberationOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return { ok: false, failureStatus: "INVALID_OUTPUT" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, failureStatus: "INVALID_OUTPUT" };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "argument" ||
    keys[1] !== "citations" ||
    keys[2] !== "confidenceBps" ||
    keys[3] !== "stance" ||
    typeof record.argument !== "string" ||
    !Array.isArray(record.citations) ||
    record.citations.length > MAX_DELIBERATION_CITATIONS ||
    record.citations.some((citation) => typeof citation !== "string") ||
    (record.stance !== "YES" &&
      record.stance !== "NO" &&
      record.stance !== "UNSURE") ||
    typeof record.confidenceBps !== "number" ||
    !Number.isInteger(record.confidenceBps) ||
    record.confidenceBps < 0 ||
    record.confidenceBps > 10_000
  ) {
    return { ok: false, failureStatus: "INVALID_OUTPUT" };
  }
  const citations = [...new Set(record.citations as string[])];
  if (citations.some((citation) => !allowedCitations.has(citation))) {
    return { ok: false, failureStatus: "INVALID_CITATIONS" };
  }
  const argument = record.argument
    .replace(/\u2014/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200)
    .trim();
  if (argument.length === 0) {
    return { ok: false, failureStatus: "INVALID_OUTPUT" };
  }
  return {
    ok: true,
    content: {
      argument,
      citations,
      stance: record.stance,
      confidenceBps: record.confidenceBps,
    },
  };
}

/** Plain single-line text: the same normalization V3 applies to argument. */
function normalizeDeliberationText(value: string): string {
  return value.replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim();
}

/**
 * The V4 conversation contract. Everything that is not exactly the contract
 * fails closed with the label that names the broken part, so a malformed turn
 * is a visible SKIPPED seat and never a silently repaired argument.
 */
export function validateDeliberationOutputV4(
  content: string,
  ctx: {
    allowedCitations: ReadonlySet<string>;
    /** The 1-based seat numbers V4 shows the model, one per debater. */
    seatNumbers: ReadonlySet<number>;
    selfSeatNumber: number;
    opensDebate: boolean;
  },
): DeliberationOutputValidation {
  const invalid = (
    failureStatus: DeliberationFailureStatus,
  ): DeliberationOutputValidation => ({ ok: false, failureStatus });
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return invalid("INVALID_OUTPUT");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalid("INVALID_OUTPUT");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (
    keys !==
      "analysis,answering,citations,confidenceBps,position,question,stance,theirPoint" ||
    typeof record.theirPoint !== "string" ||
    typeof record.analysis !== "string" ||
    typeof record.position !== "string" ||
    (record.answering !== null &&
      (typeof record.answering !== "number" ||
        !Number.isInteger(record.answering))) ||
    !Array.isArray(record.citations) ||
    record.citations.length > MAX_DELIBERATION_CITATIONS ||
    record.citations.some((citation) => typeof citation !== "string") ||
    (record.stance !== "YES" &&
      record.stance !== "NO" &&
      record.stance !== "UNSURE") ||
    typeof record.confidenceBps !== "number" ||
    !Number.isInteger(record.confidenceBps) ||
    record.confidenceBps < 0 ||
    record.confidenceBps > 10_000
  ) {
    return invalid("INVALID_OUTPUT");
  }

  let question: { seat: number; text: string } | undefined;
  if (record.question !== null) {
    const raw = record.question;
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join(",") !== "seat,text"
    ) {
      return invalid("INVALID_OUTPUT");
    }
    const asked = raw as { seat: unknown; text: unknown };
    if (
      typeof asked.seat !== "number" ||
      !Number.isInteger(asked.seat) ||
      typeof asked.text !== "string"
    ) {
      return invalid("INVALID_OUTPUT");
    }
    const text = normalizeDeliberationText(asked.text);
    if (text.length > MAX_DELIBERATION_QUESTION) {
      return invalid("INVALID_LENGTH");
    }
    if (
      text.length === 0 ||
      asked.seat === ctx.selfSeatNumber ||
      !ctx.seatNumbers.has(asked.seat)
    ) {
      return invalid("INVALID_QUESTION");
    }
    question = { seat: asked.seat, text };
  }

  const theirPoint = normalizeDeliberationText(record.theirPoint);
  const analysis = normalizeDeliberationText(record.analysis);
  const position = normalizeDeliberationText(record.position);
  if (
    theirPoint.length > MAX_DELIBERATION_THEIR_POINT ||
    analysis.length > MAX_DELIBERATION_ANALYSIS ||
    position.length > MAX_DELIBERATION_POSITION
  ) {
    return invalid("INVALID_LENGTH");
  }
  if (analysis.length === 0 || position.length === 0) {
    return invalid("INVALID_OUTPUT");
  }

  const answering = record.answering;
  if (answering === null) {
    // A turn may answer nobody only while nobody has spoken.
    if (!ctx.opensDebate || theirPoint.length > 0) {
      return invalid("INVALID_ANSWERING");
    }
  } else if (
    answering === ctx.selfSeatNumber ||
    !ctx.seatNumbers.has(answering) ||
    theirPoint.length === 0
  ) {
    return invalid("INVALID_ANSWERING");
  }

  const citations = [...new Set(record.citations as string[])];
  if (citations.some((citation) => !ctx.allowedCitations.has(citation))) {
    return invalid("INVALID_CITATIONS");
  }

  return {
    ok: true,
    content: {
      // Older readers see one bounded argument: the analysis then the position.
      argument: `${analysis} ${position}`.trim(),
      citations,
      stance: record.stance,
      confidenceBps: record.confidenceBps,
      answering,
      theirPoint,
      analysis,
      ...(question === undefined ? {} : { question }),
      position,
    },
  };
}

function deliberationProviderFailure(error: unknown): "PROVIDER_ERROR" | "TIMEOUT" {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error);
  return name.includes("timeout") || message.includes("timeout")
    ? "TIMEOUT"
    : "PROVIDER_ERROR";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function canonicalArtifact(artifact: RetrievedArtifact): {
  text: string;
  parserVersion: string;
} {
  if (artifact.mimeType === "text/html") return canonicalizeHtml(artifact.bytes);
  if (artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json") {
    return {
      text: new TextDecoder("utf8", { fatal: false }).decode(artifact.bytes).trim(),
      parserVersion: "utf8-text-v1",
    };
  }
  return {
    text: Buffer.from(artifact.bytes).toString("base64"),
    parserVersion: "binary-base64-v1",
  };
}

function endEpoch(...uploads: WalrusPutResult[]): number | undefined {
  const epochs = uploads.flatMap((upload) =>
    upload.endEpoch === undefined ? [] : [upload.endEpoch],
  );
  return epochs.length === 0 ? undefined : Math.min(...epochs);
}

/** Both rounds must hash the same frozen evidence projection. */
function oracleEvidenceManifest(
  manifest: EvidenceManifestRecord,
  artifacts: EvidenceArtifactRecord[],
): OracleInferenceInput["evidenceManifest"] {
  return {
    root: manifest.root,
    items: artifacts.map((artifact) => ({
      evidenceId: artifact.evidenceId,
      sourceClass: "USER_SUBMITTED",
      retrievedAt: artifact.retrievedAt,
      walrusBlobId: artifact.canonicalWalrusBlobId,
      contentHash: artifact.contentHash,
      excerpt: artifact.excerpt,
    })),
  };
}

function oracleInput(
  claim: ClaimRecord,
  seat: JurySeatRecord,
  manifest: EvidenceManifestRecord,
  artifacts: EvidenceArtifactRecord[],
  priorRound: PriorRoundPublicRecord | undefined,
  role: string,
  runId: string,
  promptVersion: "2" | "3" | "4" | "5",
): OracleInferenceInput {
  return {
    protocolVersion: "1.0",
    runId,
    agentRole: role,
    promptVersion,
    submission: {
      kind:
        claim.submittedText && claim.submittedUrls.length > 0
          ? "TEXT_AND_URL"
          : claim.submittedText
            ? "TEXT"
            : "URL",
      ...(claim.submittedText === undefined
        ? {}
        : {
            submittedTextHash: toHex(
              blake2b256(new TextEncoder().encode(claim.submittedText)),
            ),
          }),
      submittedUrls: claim.submittedUrls,
    },
    claim: {
      statement: claim.statement,
      resolutionCriteria: claim.resolutionCriteria,
      outcomes: ["YES", "NO", "UNSURE"],
      relevantDeadline: new Date(
        seat.phase === 1
          ? claim.deadlines.firstCommitDeadlineMs
          : claim.deadlines.secondCommitDeadlineMs,
      ).toISOString(),
    },
    evidenceManifest: oracleEvidenceManifest(manifest, artifacts),
    ...(priorRound === undefined ? {} : { priorRound }),
    outputContract: {
      requiredOutcome: true,
      requiredEvidenceIds: true,
      maximumReasonLength: 4_000,
    },
  };
}

function toAgentRunSummary(run: InferenceRunRecord): AgentRunSummary {
  return {
    runId: run.runId,
    agentProfileId: run.agentProfileId,
    modelId: run.modelId,
    gonkaRequestId: run.gonkaRequestId,
    status: run.audit.status,
    attempt: run.attempt,
    latencyMs: run.latencyMs,
  };
}

function terminalFailureAudit(error: unknown): InferenceRunAudit | undefined {
  if (!(error instanceof GonkaRunError)) return undefined;
  return error.result.attempts.at(-1)?.audit;
}

function terminalFailureStatus(
  error: unknown,
): InferenceRunAudit["status"] | undefined {
  return error instanceof ResearchLoopError ? error.status : undefined;
}

function outcomeCode(outcome: OracleInferenceOutput["outcome"]): VoteOutcome {
  if (outcome === "YES") return OUTCOME.YES;
  if (outcome === "NO") return OUTCOME.NO;
  return OUTCOME.UNSURE;
}

function addRevealToTally(
  tally: RoundTallyRecord,
  reveal: RevealRecord,
): RoundTallyRecord {
  return {
    ...tally,
    revealedJurySeatIds: [...tally.revealedJurySeatIds, reveal.jurySeatId],
    revealedVoteIds: [...tally.revealedVoteIds, reveal.revealedVoteId],
    yesCount: tally.yesCount + (reveal.outcome === OUTCOME.YES ? 1 : 0),
    noCount: tally.noCount + (reveal.outcome === OUTCOME.NO ? 1 : 0),
    unsureCount: tally.unsureCount + (reveal.outcome === OUTCOME.UNSURE ? 1 : 0),
    truthProbabilitySumBps:
      tally.truthProbabilitySumBps +
      agentProbabilityBps(reveal.outcome, reveal.confidenceBps),
    truthProbabilityCount: tally.truthProbabilityCount + 1,
    updatedAt: reveal.updatedAt,
  };
}

function thresholdOutcome(tally: RoundTallyRecord): VoteOutcome | null {
  if (tally.yesCount >= 4) return OUTCOME.YES;
  if (tally.noCount >= 4) return OUTCOME.NO;
  if (tally.unsureCount >= 4) return OUTCOME.UNSURE;
  return null;
}

function assertCommitState(state: ClaimRecord["state"], phase: 1 | 2): void {
  const expected = phase === 1 ? CLAIM_STATE.COMMIT_1 : CLAIM_STATE.COMMIT_2;
  if (state !== expected) {
    throw new EngineStateError(`round ${phase} votes cannot commit in ${claimStateName(state)}`);
  }
}

function assertRevealState(state: ClaimRecord["state"], phase: 1 | 2): void {
  const expected = phase === 1 ? CLAIM_STATE.REVEAL_1 : CLAIM_STATE.REVEAL_2;
  if (state !== expected) {
    throw new EngineStateError(`round ${phase} votes cannot reveal in ${claimStateName(state)}`);
  }
}

function certificateToFinalizeReport(
  record: ResolutionCertificateRecord,
): FinalizeReport {
  return {
    claimId: record.claimId,
    result: record.result,
    truthScoreBps: record.truthScoreBps ?? null,
    certificateId: record.certificateId,
    digest: record.transactionDigest,
  };
}

function toAgentCard(
  reveal: RevealRecord,
  run: InferenceRunRecord & { output: OracleInferenceOutput },
  agent: AgentManifestRecord,
): AgentCard {
  return {
    agentProfileId: reveal.agentProfileId,
    owner: agent.manifest.owner,
    modelId: run.modelId,
    role: agent.role,
    outcome: outcomeLabel(reveal.outcome),
    confidenceBps: reveal.confidenceBps,
    gonkaRequestId: run.gonkaRequestId,
    evidenceIds: citedEvidenceIds(run.output),
    reasoning: run.output.reasoning,
    publicReasoningTrace: run.output.publicReasoningTrace,
  };
}

function citedEvidenceIds(output: OracleInferenceOutput): string[] {
  return [
    ...new Set([
      ...output.evidenceFor,
      ...output.evidenceAgainst,
      ...output.unsupportedClaims,
      ...output.decisiveEvidence,
      ...output.publicReasoningTrace.flatMap((entry) => entry.evidenceIds),
    ]),
  ];
}

function claimStateName(state: ClaimRecord["state"]): string {
  const name = Object.entries(CLAIM_STATE).find(([, value]) => value === state)?.[0];
  return name ?? `UNKNOWN_${state}`;
}

function isTerminalState(state: ClaimRecord["state"]): boolean {
  return (
    state === CLAIM_STATE.FINALIZED_UNCHALLENGED ||
    state === CLAIM_STATE.FINALIZED_REVIEWED ||
    state === CLAIM_STATE.UNRESOLVED ||
    state === CLAIM_STATE.CANCELLED
  );
}

function deterministicId(label: string): `0x${string}` {
  return toHex(blake2b256(new TextEncoder().encode(label)));
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

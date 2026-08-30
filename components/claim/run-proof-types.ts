import type { BrowserRunProof } from "@/lib/verify/run-proof";

export type ProofRecord = Record<string, unknown>;

export type TransparentMessage = {
  role?: "system" | "user" | "assistant" | string;
  content?: string;
  [key: string]: unknown;
};

export type TransparentAudit = {
  runId?: string;
  claimObjectId?: string;
  agentProfileId?: string;
  jurySeatId?: string;
  phase?: number;
  attempt?: number;
  providerId?: string;
  modelId?: string;
  responseModelId?: string;
  gonkaRequestId?: string;
  gatewayRequestId?: string;
  devshardId?: string;
  systemFingerprint?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  requestedAtMs?: number;
  completedAtMs?: number;
  status?: string;
  [key: string]: unknown;
};

export type TransparentAttempt = {
  type?: string;
  kind?: string;
  audit?: TransparentAudit;
  response?: unknown;
  rawResponse?: unknown;
  error?: unknown;
  investigationFlags?: string[];
  [key: string]: unknown;
};

export type TransparentSearchResult = {
  rank?: number;
  n?: number;
  url?: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
  [key: string]: unknown;
};

export type TransparentResearchAction = {
  action?: string;
  query?: string;
  url?: string;
  /** Policy v4 batch open: up to three urls opened in one turn. */
  urls?: string[];
  from?: number;
  intent?: string;
  sides?: string[] | string;
  side?: string;
  content?: string;
  output?: unknown;
  [key: string]: unknown;
};

export type TransparentResearchResult = {
  tool?: string;
  code?: string;
  message?: string;
  errors?: string[];
  cached?: boolean;
  query?: string;
  results?: TransparentSearchResult[];
  evidenceId?: string;
  ref?: string;
  url?: string;
  origin?: string;
  from?: number;
  chars?: number;
  totalChars?: number;
  contentHash?: string;
  canonicalWalrusBlobId?: string;
  valid?: boolean;
  intent?: string;
  sides?: string[] | string;
  side?: string;
  [key: string]: unknown;
};

export type TransparentResearchStep = {
  index?: number;
  turn?: number;
  startedAtMs?: number;
  completedAtMs?: number;
  modelRequestId?: string;
  /** Set on every page step of a batch open (bundle v5): its place in the batch. */
  batch?: { size?: number; position?: number };
  action?: TransparentResearchAction;
  result?: TransparentResearchResult;
  [key: string]: unknown;
};

export type TransparentOpenedPage = {
  evidenceId?: string;
  ref?: string;
  url?: string;
  finalUrl?: string;
  origin?: string;
  title?: string;
  contentHash?: string;
  canonicalHash?: string;
  canonicalWalrusBlobId?: string;
  totalChars?: number;
  truncated?: boolean;
  sides?: string[] | string;
  side?: string;
  [key: string]: unknown;
};

export type TransparentCitation = {
  evidenceId?: string;
  url?: string;
  quote?: string;
  found?: boolean;
  [key: string]: unknown;
};

export type TransparentReasoningStep = {
  check?: string;
  evidenceIds?: string[];
  assessment?: string;
  finding?: string;
  [key: string]: unknown;
};

export type TransparentValidatedOutput = {
  outcome?: string;
  confidenceBps?: number;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  unsupportedClaims?: string[];
  decisiveEvidence?: string[];
  reasoning?: string;
  publicReasoningTrace?: TransparentReasoningStep[];
  citations?: TransparentCitation[];
  counterEvidenceSummary?: unknown;
  [key: string]: unknown;
};

export type TransparentTranscript = {
  version?: number;
  provider?: { name?: string; mode?: string; [key: string]: unknown };
  steps?: TransparentResearchStep[];
  opened?: TransparentOpenedPage[];
  citations?: TransparentCitation[];
  counts?: ProofRecord;
  [key: string]: unknown;
};

/** Failed runs are untrusted and may omit any field recorded before commit. */
export type TransparentInferenceFailure = {
  version?: number;
  status?: string;
  message?: string;
  failedAtMs?: number;
  transcript?: TransparentTranscript | null;
  attempts?: TransparentAttempt[] | null;
  walrusBlobId?: string;
  [key: string]: unknown;
};

export type TransparentBundle = {
  version: number;
  kind?: string;
  runId: string;
  claimId?: string;
  phase?: 1 | 2;
  agentProfileId?: string;
  jurySeatId?: string;
  promptSpec?: {
    systemPrompt?: string;
    [key: string]: unknown;
  };
  promptHash?: string;
  toolPolicy?: ProofRecord;
  toolPolicyHash?: string;
  input?: unknown;
  inputHash?: string;
  request?: {
    model?: string;
    attemptKind?: string;
    messages?: TransparentMessage[];
    [key: string]: unknown;
  };
  attempts?: TransparentAttempt[];
  rawResponse?: unknown;
  gateway?: ProofRecord;
  validatedOutput?: TransparentValidatedOutput;
  outputHash?: string;
  audit?: TransparentAudit;
  runHash?: string;
  transcript?: TransparentTranscript;
  verify?: ProofRecord;
  seal?: {
    sealedBlobId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type TransparentSealKeyServer = {
  objectId?: string;
  weight?: number;
  aggregatorUrl?: string;
  [key: string]: unknown;
};

/** Proof JSON is untrusted, so every Seal field stays optional until checked. */
export type TransparentSealEscrow = {
  version?: number;
  provider?: string;
  packageId?: string;
  identityHex?: string;
  deadlineMs?: number;
  threshold?: number;
  keyServers?: TransparentSealKeyServer[];
  encryptedObjectBase64?: string;
  aad?: string;
  [key: string]: unknown;
};

export type TransparentSealedBundle = {
  version?: number;
  kind?: string;
  runId?: string;
  algorithm?: string;
  ivHex?: string;
  aad?: string;
  coreHash?: string;
  ciphertextBase64?: string;
  escrow?: TransparentSealEscrow;
  [key: string]: unknown;
};

export type TransparentClaimDeadlines = {
  firstRevealDeadlineMs?: number;
  secondRevealDeadlineMs?: number;
  [key: string]: unknown;
};

export type TransparentSealPolicy = {
  packageId?: string;
  threshold?: number;
  keyServers?: TransparentSealKeyServer[];
  [key: string]: unknown;
};

export type SuiRunArtifact = {
  objectId?: string;
  transactionDigest?: string;
};

export type SuiRunProof = {
  claimObjectId?: string;
  agentProfileId?: string;
  jurySeatId?: string;
  runApproval?: SuiRunArtifact;
  commitment?: SuiRunArtifact;
  reveal?: SuiRunArtifact;
};

export type TransparentRunProof = Omit<
  BrowserRunProof,
  | "bundle"
  | "sealed"
  | "claimDeadlines"
  | "sealPolicy"
  | "failure"
  | "runHash"
> & {
  runHash: BrowserRunProof["runHash"] | null;
  bundle: TransparentBundle | null;
  sealed?: TransparentSealedBundle | null;
  claimDeadlines?: TransparentClaimDeadlines;
  sealPolicy?: TransparentSealPolicy;
  sui?: SuiRunProof;
  failure?: TransparentInferenceFailure;
};

export function isProofRecord(value: unknown): value is ProofRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTransparentBundle(value: unknown): value is TransparentBundle {
  if (!isProofRecord(value)) return false;
  return (
    // Bundle core v5 (batched opens) has the same shape plus batch markers.
    (value.version === 2 ||
      value.version === 3 ||
      value.version === 4 ||
      value.version === 5) &&
    value.kind === "run-bundle" &&
    typeof value.runId === "string"
  );
}

function stringField(record: ProofRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Build the viewer proof shell without depending on a not-yet-exported bundle type. */
export function proofFromTransparentBundle(
  bundle: TransparentBundle,
): TransparentRunProof {
  const audit = isProofRecord(bundle.audit) ? bundle.audit : undefined;
  const seal = isProofRecord(bundle.seal) ? bundle.seal : undefined;
  const gateway = isProofRecord(bundle.gateway) ? bundle.gateway : {};

  return {
    runId: bundle.runId,
    claimId: bundle.claimId ?? stringField(audit, "claimObjectId") ?? "",
    phase: bundle.phase === 2 ? 2 : 1,
    agentProfileId:
      bundle.agentProfileId ?? stringField(audit, "agentProfileId") ?? "",
    jurySeatId: bundle.jurySeatId ?? stringField(audit, "jurySeatId") ?? "",
    promptHash: (bundle.promptHash ?? stringField(audit, "promptHash") ?? "0x") as `0x${string}`,
    inputHash: (bundle.inputHash ?? stringField(audit, "inputHash") ?? "0x") as `0x${string}`,
    outputHash: (bundle.outputHash ?? stringField(audit, "outputHash") ?? "0x") as `0x${string}`,
    runHash: (bundle.runHash ?? "0x") as `0x${string}`,
    gateway,
    sealedBlobId: stringField(seal, "sealedBlobId") ?? null,
    sealed: null,
    revealedBlobId: null,
    revealed: true,
    bundle,
  };
}

export function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

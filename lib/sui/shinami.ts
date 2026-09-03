import { toBase64 } from "@mysten/sui/utils";

/**
 * Shinami Gas Station JSON-RPC client (docs.shinami.com/api-docs/sui/gas-station/api).
 *
 * Server-side only: the Gas Station refuses CORS, and an access key that leaks
 * lets anyone drain the fund. Nothing here is importable from a client bundle
 * without also handing the key over, so route handlers and scripts are the only
 * callers. No new dependency: one plain fetch per call.
 */

/** US region endpoint; SHINAMI_GAS_ENDPOINT overrides it for another region. */
export const DEFAULT_SHINAMI_GAS_ENDPOINT = "https://api.us1.shinami.com/sui/gas/v1";

const DEFAULT_TIMEOUT_MS = 20_000;

export type ShinamiErrorCode =
  | "SHINAMI_NOT_CONFIGURED"
  | "SHINAMI_HTTP_ERROR"
  | "SHINAMI_RPC_ERROR"
  | "SHINAMI_SPONSOR_FAILED"
  | "SHINAMI_TIMEOUT";

/** Never carries the access key: the key travels in a header, never in a message. */
export class ShinamiGasStationError extends Error {
  override readonly name = "ShinamiGasStationError";
  readonly code: ShinamiErrorCode;
  readonly status?: number;

  constructor(message: string, code: ShinamiErrorCode, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ShinamiConfig {
  accessKey: string;
  endpoint: string;
}

/** Read the gas station credentials, or null when sponsorship is not configured. */
export function readShinamiConfig(
  env: Record<string, string | undefined> = process.env,
): ShinamiConfig | null {
  const accessKey = env.SHINAMI_GAS_ACCESS_KEY?.trim();
  if (!accessKey) return null;
  return {
    accessKey,
    endpoint: env.SHINAMI_GAS_ENDPOINT?.trim() || DEFAULT_SHINAMI_GAS_ENDPOINT,
  };
}

interface RpcCallInput {
  accessKey: string;
  method: string;
  params: unknown[];
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface JsonRpcEnvelope {
  result?: unknown;
  error?: { code?: number; message?: string };
}

async function rpcCall({
  accessKey,
  method,
  params,
  endpoint = DEFAULT_SHINAMI_GAS_ENDPOINT,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RpcCallInput): Promise<unknown> {
  if (!accessKey.trim()) {
    throw new ShinamiGasStationError(
      "Shinami gas station access key is not configured",
      "SHINAMI_NOT_CONFIGURED",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": accessKey,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    // Abort and transport failures share one shape; neither can echo the key.
    const aborted = controller.signal.aborted;
    throw new ShinamiGasStationError(
      aborted
        ? `Shinami ${method} timed out after ${timeoutMs} ms`
        : `Shinami ${method} request failed: ${describe(error)}`,
      aborted ? "SHINAMI_TIMEOUT" : "SHINAMI_HTTP_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }

  // A JSON-RPC error still arrives with an HTTP status, so read the body first
  // and prefer its message: "gas object cannot be used" beats a bare 400.
  const body = await readJson(response);
  if (body?.error) {
    throw new ShinamiGasStationError(
      body.error.message?.trim() ||
        `Shinami ${method} returned JSON-RPC error ${body.error.code ?? "unknown"}`,
      "SHINAMI_RPC_ERROR",
      response.status,
    );
  }
  if (!response.ok) {
    throw new ShinamiGasStationError(
      `Shinami ${method} returned HTTP ${response.status}`,
      "SHINAMI_HTTP_ERROR",
      response.status,
    );
  }
  return body?.result;
}

async function readJson(response: Response): Promise<JsonRpcEnvelope | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as JsonRpcEnvelope) : null;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SponsorWithShinamiInput {
  accessKey: string;
  /** BCS-serialized TransactionKind: raw bytes or an already base64 string. */
  transactionKind: Uint8Array | string;
  sender: string;
  /** MIST cap; omit to use Shinami's auto-budgeting dry run. */
  gasBudget?: bigint | number | string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ShinamiSponsorship {
  /** Base64 TransactionData, gas attached; the sender signs exactly these bytes. */
  txBytes: string;
  sponsorSignature: string;
  txDigest: string;
  /** Gas-object expiry as returned by Shinami (Unix epoch seconds). */
  expireAtTime: number;
}

/** Ask the gas station to attach its gas coin and sign the resulting TransactionData. */
export async function sponsorWithShinami({
  accessKey,
  transactionKind,
  sender,
  gasBudget,
  endpoint,
  fetchImpl,
  timeoutMs,
}: SponsorWithShinamiInput): Promise<ShinamiSponsorship> {
  const kindBase64 =
    typeof transactionKind === "string" ? transactionKind : toBase64(transactionKind);
  // Positional params: [transactionBytes, sender, gasBudget?]. A trailing
  // undefined would serialize as null and be read as an explicit budget.
  const params: unknown[] = [kindBase64, sender];
  if (gasBudget !== undefined) params.push(normalizeGasBudget(gasBudget));

  const result = await rpcCall({
    accessKey,
    method: "gas_sponsorTransactionBlock",
    params,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

  const sponsorship = result as Record<string, unknown> | null | undefined;
  const txBytes = sponsorship?.txBytes;
  const signature = sponsorship?.signature;
  const txDigest = sponsorship?.txDigest;
  if (
    typeof txBytes !== "string" ||
    typeof signature !== "string" ||
    typeof txDigest !== "string"
  ) {
    throw new ShinamiGasStationError(
      "Shinami returned an incomplete sponsorship",
      "SHINAMI_SPONSOR_FAILED",
    );
  }
  return {
    txBytes,
    sponsorSignature: signature,
    txDigest,
    expireAtTime: Number(sponsorship?.expireAtTime ?? 0),
  };
}

function normalizeGasBudget(value: bigint | number | string): number {
  const budget = Number(BigInt(value));
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new ShinamiGasStationError(
      "gasBudget must be a positive MIST amount",
      "SHINAMI_SPONSOR_FAILED",
    );
  }
  return budget;
}

export interface ShinamiFund {
  name: string;
  network: string;
  /** MIST, as returned (a number today; kept wide so a string does not break us). */
  balance: string | number;
  inFlight: string | number;
  depositAddress: string | null;
}

/** Fund balance behind the access key: the health line for `pnpm sponsor:check`. */
export async function getShinamiFund({
  accessKey,
  endpoint,
  fetchImpl,
  timeoutMs,
}: {
  accessKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ShinamiFund> {
  const result = await rpcCall({
    accessKey,
    method: "gas_getFund",
    params: [],
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

  const fund = result as Record<string, unknown> | null | undefined;
  if (!fund || typeof fund !== "object") {
    throw new ShinamiGasStationError(
      "Shinami returned no fund information",
      "SHINAMI_SPONSOR_FAILED",
    );
  }
  return {
    name: String(fund.name ?? ""),
    network: String(fund.network ?? ""),
    balance: (fund.balance as string | number | undefined) ?? 0,
    inFlight: (fund.inFlight as string | number | undefined) ?? 0,
    depositAddress:
      typeof fund.depositAddress === "string" ? fund.depositAddress : null,
  };
}

import { NextResponse } from "next/server";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import { validateSponsoredKind } from "@/lib/sui/sponsor-policy";
import {
  ShinamiGasStationError,
  readShinamiConfig,
  sponsorWithShinami,
} from "@/lib/sui/shinami";
import { rateLimitPublic, requirePublicWritesEnabled } from "../_lib/guard";

/**
 * POST /api/sponsor: pay a user's gas for one demo binary pool entry.
 *
 * The browser builds the TransactionKind, this route allowlists it and asks
 * Shinami Gas Station to attach gas and sign; the wallet then signs the bytes
 * Shinami returned. The access key stays server-side (the gas station refuses
 * CORS anyway) and every sponsorship is capped and rate limited.
 */

/** Hard ceiling per sponsorship, in MIST. A pool entry costs a small fraction. */
const SPONSOR_GAS_BUDGET_MIST = 50_000_000;

/** A base64 TransactionKind for one pool entry is far below this. */
const MAX_KIND_BASE64_LENGTH = 8_192;

export async function POST(req: Request) {
  try {
    const disabled = requirePublicWritesEnabled();
    if (disabled) return disabled;
    const limited = rateLimitPublic(req);
    if (limited) return limited;

    const gasStation = readShinamiConfig();
    if (!gasStation) {
      return NextResponse.json(
        {
          error: "sponsor_unavailable",
          message: "gas sponsorship is not configured",
        },
        { status: 503 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return rejected("Invalid JSON payload");
    }
    if (!body || typeof body !== "object") {
      return rejected("Request body must be an object");
    }

    const payload = body as Record<string, unknown>;
    const { transactionKind, sender } = payload;
    if (typeof sender !== "string" || !isValidSuiAddress(sender)) {
      return rejected("sender must be a valid Sui address");
    }
    if (
      typeof transactionKind !== "string" ||
      transactionKind.length === 0 ||
      transactionKind.length > MAX_KIND_BASE64_LENGTH
    ) {
      return rejected("transactionKind must be base64 TransactionKind bytes");
    }

    // The package id decides which move target may be sponsored, so it comes
    // from the engine's own manifest, never from the request.
    const engine = await getServerEngine();
    const { packageId } = await engine.status();
    const verdict = validateSponsoredKind(transactionKind, { packageId });
    if (!verdict.ok) return rejected(verdict.reason);

    const sponsorship = await sponsorWithShinami({
      accessKey: gasStation.accessKey,
      endpoint: gasStation.endpoint,
      transactionKind,
      sender,
      gasBudget: SPONSOR_GAS_BUDGET_MIST,
    });
    return NextResponse.json(sponsorship, { status: 200 });
  } catch (error) {
    if (error instanceof ShinamiGasStationError) {
      // The gas station's own message: it never carries the access key.
      console.error("[sponsor] gas station error:", error.code, error.message);
      return NextResponse.json(
        { error: "sponsor_failed", message: error.message },
        { status: 502 },
      );
    }
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

function rejected(message: string): NextResponse {
  return NextResponse.json({ error: "sponsor_rejected", message }, { status: 400 });
}

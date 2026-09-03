import { NextResponse } from "next/server";
import type { StakeConfirmationRequest } from "@/lib/engine/contract";
import {
  ChainReadError,
  EngineValidationError,
  StakeReservationNotFoundError,
} from "@/lib/engine/errors";
import { EngineNotWiredError, getServerEngine } from "@/lib/engine/server";
import { rateLimitPublic, requirePublicWritesEnabled } from "../../../_lib/guard";

const FIELD_LIMITS = {
  reservationId: 64,
  digest: 64,
} as const;

/**
 * POST /api/agents/stake/confirm: record a seat whose bond is already posted.
 *
 * The engine reads the staker's settled transaction, checks it against the
 * reservation, binds the seat's signing slot and tops it up with gas. Replaying
 * a confirmed reservation returns the stored result rather than writing twice.
 */
export async function POST(req: Request) {
  try {
    const disabled = requirePublicWritesEnabled();
    if (disabled) return disabled;
    const limited = rateLimitPublic(req);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return validationResponse("Invalid JSON payload");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationResponse("Request body must be an object");
    }

    const payload = body as Record<string, unknown>;
    const reservationId = boundedField(
      payload,
      "reservationId",
      FIELD_LIMITS.reservationId,
    );
    if (!reservationId) {
      return validationResponse(
        "reservationId is required and must be at most 64 characters",
      );
    }
    const digest = boundedField(payload, "digest", FIELD_LIMITS.digest);
    if (!digest) {
      return validationResponse("digest is required and must be at most 64 characters");
    }

    // Pick only the two public confirm fields; ignore all caller extras.
    const request: StakeConfirmationRequest = { reservationId, digest };
    const engine = await getServerEngine();
    const confirmation = await engine.confirmStake(request);
    return NextResponse.json(confirmation, { status: 200 });
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    if (
      error instanceof StakeReservationNotFoundError ||
      (error as Error)?.name === "StakeReservationNotFoundError"
    ) {
      return NextResponse.json(
        {
          error: "reservation_not_found",
          message: "that stake reservation is unknown or has expired",
        },
        { status: 404 },
      );
    }
    if (error instanceof ChainReadError || (error as Error)?.name === "ChainReadError") {
      return NextResponse.json(
        {
          error: "chain_read_failed",
          message: "the stake transaction could not be read from the chain",
        },
        { status: 502 },
      );
    }
    if (
      error instanceof EngineValidationError ||
      (error as Error)?.name === "EngineValidationError"
    ) {
      return validationResponse(
        error instanceof Error ? error.message : "Invalid stake confirmation",
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

function boundedField(
  payload: Record<string, unknown>,
  field: keyof typeof FIELD_LIMITS,
  maxLength: number,
): string | null {
  const value = payload[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function validationResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: "validation_error", message },
    { status: 400 },
  );
}

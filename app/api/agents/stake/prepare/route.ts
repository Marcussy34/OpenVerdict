import { NextResponse } from "next/server";
import type { StakePreparationRequest } from "@/lib/engine/contract";
import { EngineCapacityError, EngineValidationError } from "@/lib/engine/errors";
import { EngineNotWiredError, getServerEngine } from "@/lib/engine/server";
import { rateLimitPublic, requirePublicWritesEnabled } from "../../../_lib/guard";

const FIELD_LIMITS = {
  address: 66,
  modelId: 128,
  role: 32,
} as const;

/**
 * POST /api/agents/stake/prepare: reserve a juror seat for a real stake.
 *
 * The engine picks a free operational signing slot, writes the seat's manifest
 * document to Walrus and returns the register_staked_agent arguments. Nothing
 * is on chain until the staker signs and /stake/confirm reads the result, and
 * the reservation expires so an abandoned prepare frees its slot again.
 *
 * `role` is optional: with none named the engine assigns the least represented
 * debate role on that model and returns it as `role`.
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
    const address = boundedField(payload, "address", FIELD_LIMITS.address);
    if (!address) {
      return validationResponse("address is required and must be at most 66 characters");
    }
    const modelId = boundedField(payload, "modelId", FIELD_LIMITS.modelId);
    if (!modelId) {
      return validationResponse("modelId is required and must be at most 128 characters");
    }
    // No role means the engine assigns one; a named role must still fit.
    const role = optionalBoundedField(payload, "role", FIELD_LIMITS.role);
    if (role === INVALID_FIELD) {
      return validationResponse("role must be at most 32 characters");
    }

    // Pick only the public stake fields; ignore all caller extras.
    const request: StakePreparationRequest = {
      stakerAddress: address,
      modelId,
      ...(role === undefined ? {} : { role }),
    };
    const engine = await getServerEngine();
    const preparation = await engine.prepareStake(request);
    return NextResponse.json(preparation, { status: 200 });
  } catch (error) {
    return stakeErrorResponse(error);
  }
}

/** Shared by both stake routes so their status codes never drift apart. */
function stakeErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof EngineNotWiredError ||
    (error as Error)?.name === "EngineNotWiredError"
  ) {
    return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
  }
  if (
    error instanceof EngineCapacityError ||
    (error as Error)?.name === "EngineCapacityError"
  ) {
    return NextResponse.json({ error: "slots_exhausted" }, { status: 409 });
  }
  if (
    error instanceof EngineValidationError ||
    (error as Error)?.name === "EngineValidationError"
  ) {
    return validationResponse(
      error instanceof Error ? error.message : "Invalid stake request",
    );
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: "internal_error", message }, { status: 500 });
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

/** Present but unusable, kept apart from "absent" so only the former is a 400. */
const INVALID_FIELD = Symbol("invalid_field");

/** An omitted or null field stays absent; anything else must be a bounded string. */
function optionalBoundedField(
  payload: Record<string, unknown>,
  field: keyof typeof FIELD_LIMITS,
  maxLength: number,
): string | undefined | typeof INVALID_FIELD {
  const value = payload[field];
  if (value === undefined || value === null) return undefined;
  return boundedField(payload, field, maxLength) ?? INVALID_FIELD;
}

function validationResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: "validation_error", message },
    { status: 400 },
  );
}

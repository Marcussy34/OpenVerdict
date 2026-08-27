import { NextResponse } from "next/server";
import type { ZkBackedRegistrationRequest } from "@/lib/engine/contract";
import {
  EngineValidationError,
  ZkLoginVerificationError,
} from "@/lib/engine/errors";
import { EngineNotWiredError, getServerEngine } from "@/lib/engine/server";
import { rateLimitPublic, requirePublicWritesEnabled } from "../../_lib/guard";

const FIELD_LIMITS = {
  zkLoginAddress: 66,
  signature: 16_384,
  modelId: 128,
  role: 32,
} as const;

/** POST /api/agents/register: authenticate zkLogin backing and register an agent. */
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
    const zkLoginAddress = boundedField(
      payload,
      "zkLoginAddress",
      FIELD_LIMITS.zkLoginAddress,
    );
    if (!zkLoginAddress) {
      return validationResponse("zkLoginAddress is required and must be at most 66 characters");
    }
    const signature = boundedField(
      payload,
      "signature",
      FIELD_LIMITS.signature,
    );
    if (!signature) {
      return validationResponse("signature is required and must be at most 16384 characters");
    }
    const modelId = boundedField(payload, "modelId", FIELD_LIMITS.modelId);
    if (!modelId) {
      return validationResponse("modelId is required and must be at most 128 characters");
    }
    const role = boundedField(payload, "role", FIELD_LIMITS.role);
    if (!role) {
      return validationResponse("role is required and must be at most 32 characters");
    }

    // Pick only the four public registration fields; ignore all caller extras.
    const registration: ZkBackedRegistrationRequest = {
      zkLoginAddress,
      signature,
      modelId,
      role,
    };
    const engine = await getServerEngine();
    const result = await engine.registerZkBackedAgent(registration);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    if (
      error instanceof ZkLoginVerificationError ||
      (error as Error)?.name === "ZkLoginVerificationError"
    ) {
      return NextResponse.json(
        {
          error: "zklogin_verification_unavailable",
          message: "Social-login signature verification is temporarily unavailable",
        },
        { status: 503 },
      );
    }
    if (
      error instanceof EngineValidationError ||
      (error as Error)?.name === "EngineValidationError"
    ) {
      return validationResponse(
        error instanceof Error ? error.message : "Invalid registration request",
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

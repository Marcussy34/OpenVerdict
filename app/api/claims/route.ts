import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import type { ClaimCreateRequest } from "@/lib/engine/contract";
import type { ClaimState } from "@/lib/protocol/constants";

/** GET /api/claims: list all claims with optional state filter. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stateParam = searchParams.get("state");

    let filter: { state?: ClaimState } | undefined;
    if (stateParam !== null && stateParam !== undefined && stateParam !== "") {
      const parsedState = Number(stateParam);
      if (!Number.isNaN(parsedState)) {
        filter = { state: parsedState as ClaimState };
      }
    }

    const engine = await getServerEngine();
    const claims = await engine.listClaims(filter);

    return NextResponse.json({ claims }, { status: 200 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

/** POST /api/claims: create a new on-chain claim. */
export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "validation_error", message: "Request body must be an object" },
        { status: 400 },
      );
    }

    const payload = body as Record<string, unknown>;

    // Basic structural validation
    if (typeof payload.statement !== "string" || !payload.statement.trim()) {
      return NextResponse.json(
        { error: "validation_error", message: "statement is required and must be non-empty" },
        { status: 400 },
      );
    }
    if (typeof payload.resolutionCriteria !== "string" || !payload.resolutionCriteria.trim()) {
      return NextResponse.json(
        { error: "validation_error", message: "resolutionCriteria is required and must be non-empty" },
        { status: 400 },
      );
    }
    if (typeof payload.mode !== "number" || (payload.mode !== 1 && payload.mode !== 2)) {
      return NextResponse.json(
        { error: "validation_error", message: "mode must be 1 (DIRECT_REVIEW) or 2 (OPTIMISTIC_SETTLEMENT)" },
        { status: 400 },
      );
    }
    if (!payload.deadlines || typeof payload.deadlines !== "object") {
      return NextResponse.json(
        { error: "validation_error", message: "deadlines object is required" },
        { status: 400 },
      );
    }

    const engine = await getServerEngine();
    const result = await engine.claimCreate(payload as unknown as ClaimCreateRequest);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

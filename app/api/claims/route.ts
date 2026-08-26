import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import type { ClaimCreateRequest } from "@/lib/engine/contract";
import type { ClaimMode, ClaimState } from "@/lib/protocol/constants";
import { requireOperatorToken } from "../_lib/guard";

const DEADLINE_KEYS = [
  "evidenceCutoffMs",
  "proposalDeadlineMs",
  "challengeDeadlineMs",
  "firstCommitDeadlineMs",
  "firstRevealDeadlineMs",
  "discussionDeadlineMs",
  "secondCommitDeadlineMs",
  "secondRevealDeadlineMs",
] as const;

const MAX_STATEMENT_LENGTH = 2_000;
const MAX_CRITERIA_LENGTH = 4_000;
const BUDGET_PATTERN = /^\d{1,18}$/;

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

/**
 * POST /api/claims: create a new on-chain claim.
 * Operator-only: the engine signs with the operator key, so this route
 * requires the OPENVERDICT_OPERATOR_TOKEN bearer token.
 */
export async function POST(req: Request) {
  try {
    const denied = requireOperatorToken(req);
    if (denied) return denied;

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

    const statement =
      typeof payload.statement === "string" ? payload.statement.trim() : "";
    if (!statement || statement.length > MAX_STATEMENT_LENGTH) {
      return NextResponse.json(
        { error: "validation_error", message: "statement is required (non-empty, bounded)" },
        { status: 400 },
      );
    }
    const resolutionCriteria =
      typeof payload.resolutionCriteria === "string"
        ? payload.resolutionCriteria.trim()
        : "";
    if (!resolutionCriteria || resolutionCriteria.length > MAX_CRITERIA_LENGTH) {
      return NextResponse.json(
        { error: "validation_error", message: "resolutionCriteria is required (non-empty, bounded)" },
        { status: 400 },
      );
    }
    if (payload.mode !== 1 && payload.mode !== 2) {
      return NextResponse.json(
        { error: "validation_error", message: "mode must be 1 (DIRECT_REVIEW) or 2 (OPTIMISTIC_SETTLEMENT)" },
        { status: 400 },
      );
    }
    const rawDeadlines =
      payload.deadlines && typeof payload.deadlines === "object"
        ? (payload.deadlines as Record<string, unknown>)
        : undefined;
    if (!rawDeadlines) {
      return NextResponse.json(
        { error: "validation_error", message: "deadlines object is required" },
        { status: 400 },
      );
    }
    // Explicit field picking — never pass client objects through untyped.
    const deadlines = {} as ClaimCreateRequest["deadlines"];
    for (const key of DEADLINE_KEYS) {
      const value = rawDeadlines[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        return NextResponse.json(
          { error: "validation_error", message: `deadlines.${key} must be a positive integer` },
          { status: 400 },
        );
      }
      deadlines[key] = value;
    }
    const committeeBudget =
      typeof payload.committeeBudget === "string" ? payload.committeeBudget : "";
    const evidenceBudget =
      typeof payload.evidenceBudget === "string" ? payload.evidenceBudget : "";
    if (!BUDGET_PATTERN.test(committeeBudget) || !BUDGET_PATTERN.test(evidenceBudget)) {
      return NextResponse.json(
        { error: "validation_error", message: "budgets must be bounded decimal strings" },
        { status: 400 },
      );
    }

    const request: ClaimCreateRequest = {
      statement,
      resolutionCriteria,
      mode: payload.mode as ClaimMode,
      deadlines,
      committeeBudget,
      evidenceBudget,
    };

    const engine = await getServerEngine();
    const result = await engine.claimCreate(request);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

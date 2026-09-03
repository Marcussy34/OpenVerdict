import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import { ClaimNotFoundError } from "@/lib/engine/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/claims/[id]/report: fetch final fact-check report and audit bundle. */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "validation_error", message: "claim id is required" },
        { status: 400 },
      );
    }

    const engine = await getServerEngine();
    const report = await engine.report(id);

    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    // An unknown id is the caller's mistake, not a server failure (404, not 500).
    if (error instanceof ClaimNotFoundError || (error as Error)?.name === "ClaimNotFoundError") {
      return NextResponse.json(
        { error: "claim_not_found", message: (error as Error).message },
        { status: 404 },
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

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
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

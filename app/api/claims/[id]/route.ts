import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/claims/[id]: inspect a claim with optional verification passthrough. */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "validation_error", message: "claim id is required" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const verifyParam = searchParams.get("verify");
    const verify = verifyParam === "1" || verifyParam === "true";

    const engine = await getServerEngine();
    const inspection = await engine.inspect(id, { verify });

    return NextResponse.json(inspection, { status: 200 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

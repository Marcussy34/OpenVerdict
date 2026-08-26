import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

/** GET /api/status: retrieve live engine, Sui, GonkaRouter, Walrus, and DB status. */
export async function GET() {
  try {
    const engine = await getServerEngine();
    const status = await engine.status();

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

/** GET /api/agents: list registered agents and reputation dimensions. */
export async function GET() {
  try {
    const engine = await getServerEngine();
    const agents = await engine.listAgents();

    return NextResponse.json({ agents }, { status: 200 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

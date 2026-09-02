import { NextResponse } from "next/server";
import { EngineNotWiredError, getServerEngine } from "@/lib/engine/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/** GET /api/weather: return the latest public model-family probe. */
export async function GET() {
  try {
    const engine = await getServerEngine();
    return NextResponse.json(await engine.weather(), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json(
        { error: "engine_not_wired" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "internal_error", message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

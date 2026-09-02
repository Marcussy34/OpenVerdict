import { NextResponse } from "next/server";
import { EngineNotWiredError, getServerEngine } from "@/lib/engine/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/fact-checks/queue/[id]: return one public queue item. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const engine = await getServerEngine();
    const item = await engine.getQueuedFactCheck(id);
    if (item === undefined) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(item, {
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

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

/** POST /api/evidence: submit evidence artifact or source URL to a claim. */
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
    if (!payload.claimId || typeof payload.claimId !== "string") {
      return NextResponse.json(
        { error: "validation_error", message: "claimId is required" },
        { status: 400 },
      );
    }
    if (!payload.url && !payload.text) {
      return NextResponse.json(
        { error: "validation_error", message: "Either url or text must be provided" },
        { status: 400 },
      );
    }

    // Engine invocation (stub until wired)
    await getServerEngine();

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

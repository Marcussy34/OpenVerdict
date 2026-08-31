import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import { getOrBuildPublicRunProof } from "@/lib/verify/public-run-proof";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

const IMMUTABLE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

/** Return the public proof material for one inference run. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, runId } = await context.params;
    if (!id || !runId) {
      return NextResponse.json(
        { error: "validation_error", message: "claim id and run id are required" },
        { status: 400 },
      );
    }

    const engine = await getServerEngine();
    const proof = await getOrBuildPublicRunProof(engine, id, runId);
    if (!proof) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      proof.body,
      proof.immutable
        ? { status: 200, headers: IMMUTABLE_HEADERS }
        : { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    if (
      (error as Error)?.name === "EngineValidationError" &&
      (error as Error)?.message.includes("was not found")
    ) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Return the published version 2 manifest document for one agent. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { error: "validation_error", message: "agent id is required" },
        { status: 400 },
      );
    }

    const engine = await getServerEngine();
    const manifest = await engine.agentManifestDocument(id);
    if (!manifest) {
      return NextResponse.json({ error: "manifest_not_found" }, { status: 404 });
    }

    return NextResponse.json(manifest, { status: 200 });
  } catch (error) {
    if (
      error instanceof EngineNotWiredError ||
      (error as Error)?.name === "EngineNotWiredError"
    ) {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import { reexecuteRun } from "@/lib/verify/reexecute";
import {
  rateLimitPublic,
  requirePublicWritesEnabled,
} from "../../../../../_lib/guard";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

function providerErrorMessage(error: unknown): string {
  const fallback = "The model provider could not complete the re-execution";
  const message = error instanceof Error ? error.message : fallback;
  const apiKey = process.env.GONKA_ROUTER_API_KEY?.trim();
  const redacted = apiKey
    ? message.split(apiKey).join("[REDACTED]")
    : message;
  return redacted.trim().slice(0, 500) || fallback;
}

/** Re-run one revealed juror request without granting the observer a signer. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const disabled = requirePublicWritesEnabled();
    if (disabled) return disabled;
    const limited = rateLimitPublic(request);
    if (limited) return limited;

    const { id, runId } = await context.params;
    if (!id || !runId) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: "claim id and run id are required",
        },
        { status: 400 },
      );
    }

    const engine = await getServerEngine();
    const proof = (await engine.runProof(id, runId)) as
      | Awaited<ReturnType<typeof engine.runProof>>
      | null;
    if (!proof) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    if (!proof.revealed || !proof.bundle) {
      return NextResponse.json(
        { error: "run_not_revealed" },
        { status: 409 },
      );
    }

    try {
      const result = await reexecuteRun(proof.bundle);
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        { error: "provider_error", message: providerErrorMessage(error) },
        { status: 502 },
      );
    }
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
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "internal_error", message },
      { status: 500 },
    );
  }
}

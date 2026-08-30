import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import { touchWake } from "@/lib/engine/wake";
import type { FactCheckRequest } from "@/lib/engine/contract";
import { rateLimitPublic, requirePublicWritesEnabled } from "../_lib/guard";

/** Max byte caps and validation limits for public fact-check submission. */
const MAX_CLAIM_LENGTH = 1000;
const MIN_CLAIM_LENGTH = 5;
const MAX_TEXT_LENGTH = 20_000;
const MAX_CRITERIA_LENGTH = 2000;
const MAX_URLS_COUNT = 5;

/** POST /api/fact-checks: starts a direct-review fact check through the engine. */
export async function POST(req: Request) {
  try {
    const disabled = requirePublicWritesEnabled();
    if (disabled) return disabled;
    const limited = rateLimitPublic(req);
    if (limited) return limited;

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

    // 1. Validate claim
    if (typeof payload.claim !== "string") {
      return NextResponse.json(
        { error: "validation_error", message: "claim statement is required and must be a string" },
        { status: 400 },
      );
    }
    const claim = payload.claim.trim();
    if (claim.length < MIN_CLAIM_LENGTH || claim.length > MAX_CLAIM_LENGTH) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: `claim statement must be between ${MIN_CLAIM_LENGTH} and ${MAX_CLAIM_LENGTH} characters`,
        },
        { status: 400 },
      );
    }

    // 2. Validate optional text
    let text: string | undefined;
    if (payload.text !== undefined && payload.text !== null) {
      if (typeof payload.text !== "string") {
        return NextResponse.json(
          { error: "validation_error", message: "text must be a string if provided" },
          { status: 400 },
        );
      }
      text = payload.text.trim();
      if (text.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
          {
            error: "validation_error",
            message: `text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`,
          },
          { status: 400 },
        );
      }
    }

    // 3. Validate urls
    const urls: string[] = [];
    if (payload.urls !== undefined && payload.urls !== null) {
      if (!Array.isArray(payload.urls)) {
        return NextResponse.json(
          { error: "validation_error", message: "urls must be an array" },
          { status: 400 },
        );
      }
      if (payload.urls.length > MAX_URLS_COUNT) {
        return NextResponse.json(
          {
            error: "validation_error",
            message: `urls cannot exceed ${MAX_URLS_COUNT} items`,
          },
          { status: 400 },
        );
      }
      for (const u of payload.urls) {
        if (typeof u !== "string") {
          return NextResponse.json(
            { error: "validation_error", message: "each url must be a string" },
            { status: 400 },
          );
        }
        const trimmedUrl = u.trim();
        // https-only up front — matches the evidence retriever's hard boundary.
        let parsed: URL;
        try {
          parsed = new URL(trimmedUrl);
        } catch {
          return NextResponse.json(
            { error: "validation_error", message: "invalid url submitted" },
            { status: 400 },
          );
        }
        if (parsed.protocol !== "https:" || trimmedUrl.length > 2048) {
          return NextResponse.json(
            {
              error: "validation_error",
              message: "urls must be https:// and at most 2048 characters",
            },
            { status: 400 },
          );
        }
        urls.push(trimmedUrl);
      }
    }

    // 4. Validate optional resolutionCriteria
    let resolutionCriteria: string | undefined;
    if (payload.resolutionCriteria !== undefined && payload.resolutionCriteria !== null) {
      if (typeof payload.resolutionCriteria !== "string") {
        return NextResponse.json(
          { error: "validation_error", message: "resolutionCriteria must be a string if provided" },
          { status: 400 },
        );
      }
      resolutionCriteria = payload.resolutionCriteria.trim();
      if (resolutionCriteria.length > MAX_CRITERIA_LENGTH) {
        return NextResponse.json(
          {
            error: "validation_error",
            message: `resolutionCriteria exceeds maximum length of ${MAX_CRITERIA_LENGTH} characters`,
          },
          { status: 400 },
        );
      }
    }

    const requestData: FactCheckRequest = {
      claim,
      text,
      urls,
      resolutionCriteria,
    };

    const engine = await getServerEngine();
    const result = await engine.factCheckStart(requestData);
    // Idle workers poll slowly; the wake file ends their wait at once.
    touchWake();

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

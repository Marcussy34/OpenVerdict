import { NextResponse } from "next/server";
import { getServerEngine, EngineNotWiredError } from "@/lib/engine/server";
import type { ResolutionEvent } from "@/lib/engine/contract";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/claims/[id]/events
 * Server-Sent Events stream or JSON snapshot of resolution events for a claim.
 */
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
    const isSnapshot = searchParams.get("snapshot") === "1";

    // Sequence parsing: Last-Event-ID header takes precedence, then ?from= query param
    const lastEventIdHeader = req.headers.get("last-event-id");
    const fromQueryParam = searchParams.get("from");
    let fromSequence: number | undefined;

    if (lastEventIdHeader) {
      const parsed = parseInt(lastEventIdHeader, 10);
      if (!Number.isNaN(parsed)) fromSequence = parsed + 1;
    } else if (fromQueryParam) {
      const parsed = parseInt(fromQueryParam, 10);
      if (!Number.isNaN(parsed)) fromSequence = parsed;
    }

    const engine = await getServerEngine();

    // Snapshot mode returns complete JSON array of events
    if (isSnapshot) {
      const events: ResolutionEvent[] = [];
      for await (const event of engine.events(id, fromSequence)) {
        events.push(event);
      }
      return NextResponse.json({ events }, { status: 200 });
    }

    // SSE streaming mode
    const encoder = new TextEncoder();
    let isAborted = false;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        // Abort cleanup
        req.signal.addEventListener("abort", () => {
          isAborted = true;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          try {
            controller.close();
          } catch {
            // Controller may already be closed
          }
        });

        // 15s SSE heartbeat to keep proxy and client connections alive
        heartbeatInterval = setInterval(() => {
          if (isAborted) {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          }
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
          }
        }, 15_000);

        try {
          for await (const event of engine.events(id, fromSequence)) {
            if (isAborted) break;
            const sseChunk = `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(sseChunk));
          }
        } catch {
          // Stream iteration finished or aborted
        } finally {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (!isAborted) {
            try {
              controller.close();
            } catch {
              // Ignore close error
            }
          }
        }
      },
      cancel() {
        isAborted = true;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof EngineNotWiredError || (error as Error)?.name === "EngineNotWiredError") {
      return NextResponse.json({ error: "engine_not_wired" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}

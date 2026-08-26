import type { Engine } from "./contract";

/**
 * Server-side engine singleton for Next.js API routes and the observer.
 * STUB: replaced by the real engine wiring in the engine workstream (T5).
 * Routes must degrade gracefully (503) while the engine is not yet wired.
 */
export class EngineNotWiredError extends Error {
  constructor() {
    super("OpenVerdict engine is not wired yet — see lib/engine/server.ts");
    this.name = "EngineNotWiredError";
  }
}

export async function getServerEngine(): Promise<Engine> {
  throw new EngineNotWiredError();
}

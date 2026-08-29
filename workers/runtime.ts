import { Client } from "pg";

export interface WorkerRuntimeOptions {
  name: string;
  tick: () => Promise<void>;
  intervalMs?: number;
}

// All workers share one Sui operator signer. Concurrent submissions equivocate
// its gas coin ("objects reserved for another transaction") and starve jury
// windows, so multi-process runs must be single-writer: with Postgres present,
// a session-scoped advisory lock serializes ticks across worker processes.
// The lock auto-releases if a worker dies; pglite runs are single-process
// already and skip it.
const TICK_LOCK_KEY = 1_869_640_753; // "ovt1"

class TickSerializer {
  private client: Client | null = null;

  constructor(private readonly url: string) {}

  private async connected(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ connectionString: this.url });
    await client.connect();
    // A dropped session releases its advisory locks server-side; just reconnect.
    client.on("error", () => {
      this.client = null;
    });
    this.client = client;
    return client;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.connected();
    // Transaction-level lock, not a session lock: behind a transaction-mode
    // pooler (Neon's pgbouncer) a session lock lands on whichever server
    // connection served that statement, the pooler then hands that
    // connection to other clients and routes the unlock elsewhere, and the
    // lock is stranded forever (every worker blocked, silent). An open
    // transaction pins one server connection for the whole tick, and the
    // lock ends with the COMMIT, or with the connection if the worker dies.
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [TICK_LOCK_KEY]);
      return await fn();
    } finally {
      try {
        await client.query("COMMIT");
      } catch {
        this.client = null;
      }
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }
}

/** Run a bounded polling tick until SIGINT/SIGTERM requests a clean stop. */
export async function runWorker(options: WorkerRuntimeOptions): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const intervalMs = options.intervalMs ?? numberEnv("OPENVERDICT_WORKER_POLL_MS", 2_000);
  const dbUrl = process.env.DATABASE_URL?.trim();
  const serializer = dbUrl ? new TickSerializer(dbUrl) : null;

  try {
    while (!controller.signal.aborted) {
      try {
        await (serializer ? serializer.run(options.tick) : options.tick());
      } catch (error) {
        // A phase deadline commonly makes a queue item temporarily ineligible.
        process.stderr.write(
          `${options.name}: ${errorCode(error)}: ${errorMessage(error)}\n`,
        );
      }
      await wait(intervalMs, controller.signal);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await serializer?.close();
  }
}

/** Process claims independently: one claim's failure (a Move abort on a
 * permanently stuck claim, a transient RPC error) must not starve the claims
 * after it in the list — head-of-line blocking here froze whole pipelines. */
export async function forEachClaim<T extends { claimId: string }>(
  name: string,
  claims: readonly T[],
  handle: (claim: T) => Promise<void>,
): Promise<void> {
  for (const claim of claims) {
    try {
      await handle(claim);
    } catch (error) {
      process.stderr.write(
        `${name}: claim ${claim.claimId.slice(0, 10)}…: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }
}

export function isWorkerEntrypoint(importMetaUrl: string): boolean {
  const path = process.argv[1];
  return path !== undefined && new URL(importMetaUrl).pathname === path;
}

async function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "WORKER_TICK_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

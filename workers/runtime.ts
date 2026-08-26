export interface WorkerRuntimeOptions {
  name: string;
  tick: () => Promise<void>;
  intervalMs?: number;
}

/** Run a bounded polling tick until SIGINT/SIGTERM requests a clean stop. */
export async function runWorker(options: WorkerRuntimeOptions): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const intervalMs = options.intervalMs ?? numberEnv("OPENVERDICT_WORKER_POLL_MS", 2_000);

  try {
    while (!controller.signal.aborted) {
      try {
        await options.tick();
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

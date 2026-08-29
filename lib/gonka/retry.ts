export type VisibleRetryAttempt<T> =
  | {
      ok: true;
      value: T;
      requestedAtMs: number;
      completedAtMs: number;
    }
  | {
      ok: false;
      error: unknown;
      requestedAtMs: number;
      completedAtMs: number;
    };

export interface VisibleRetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  jitterMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  /** No retry starts at or after this wall-clock point (a seat's deadline). */
  deadlineMs?: number;
}

export class VisibleRetryError<T = unknown> extends Error {
  readonly attempts: Array<VisibleRetryAttempt<T>>;

  constructor(attempts: Array<VisibleRetryAttempt<T>>) {
    super("GonkaRouter request failed after the visible retry policy");
    this.name = "VisibleRetryError";
    this.attempts = attempts;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read an SDK or test-double HTTP status without trusting its concrete class. */
export function getGonkaErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

/** SDK timeout errors may wrap the original AbortError as a cause. */
export function isGonkaTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  const visited = new Set<unknown>();

  while (current && !visited.has(current)) {
    visited.add(current);
    if (isRecord(current)) {
      const name = typeof current.name === "string" ? current.name : "";
      const message = typeof current.message === "string" ? current.message : "";
      const status = typeof current.status === "number" ? current.status : undefined;
      if (
        name === "TimeoutError" ||
        name === "AbortError" ||
        name === "APIConnectionTimeoutError" ||
        (status === undefined && /timed?\s*out|timeout/i.test(message))
      ) {
        return true;
      }
      current = current.cause;
      continue;
    }
    break;
  }

  return false;
}

/** PRD 31.5: timeout, 429, and eligible transient 5xx only. */
export function isRetryableGonkaError(error: unknown): boolean {
  if (isGonkaTimeoutError(error)) return true;
  const status = getGonkaErrorStatus(error);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Execute a provider operation with at most one fully visible retry. */
export async function runWithVisibleRetry<T>(
  operation: () => Promise<T>,
  options: VisibleRetryOptions,
): Promise<{ value: T; attempts: Array<VisibleRetryAttempt<T>> }> {
  const retryLimit = Math.min(1, Math.max(0, Math.trunc(options.maxRetries)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const attempts: Array<VisibleRetryAttempt<T>> = [];

  for (let retry = 0; retry <= retryLimit; retry += 1) {
    const requestedAtMs = now();
    try {
      const value = await operation();
      attempts.push({ ok: true, value, requestedAtMs, completedAtMs: now() });
      return { value, attempts };
    } catch (error) {
      attempts.push({ ok: false, error, requestedAtMs, completedAtMs: now() });
      // A call that ran out its deadline must not be retried past it: the
      // seat fails closed now instead of after one more futile call.
      const pastDeadline =
        options.deadlineMs !== undefined && now() >= options.deadlineMs;
      if (retry === retryLimit || pastDeadline || !isRetryableGonkaError(error)) {
        throw new VisibleRetryError(attempts);
      }

      // GonkaRouter's verified guidance asks 429 callers to back off 30–60s.
      const rateLimited = getGonkaErrorStatus(error) === 429;
      const baseDelayMs = Math.max(
        0,
        options.baseDelayMs ?? (rateLimited ? 30_000 : 250),
      );
      const jitterMs = Math.max(
        0,
        options.jitterMs ?? (rateLimited ? 30_000 : 250),
      );
      const delayMs = baseDelayMs + Math.floor(random() * (jitterMs + 1));
      await sleep(delayMs);
    }
  }

  throw new VisibleRetryError(attempts);
}

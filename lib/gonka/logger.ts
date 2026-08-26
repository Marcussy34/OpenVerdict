export type LogLevel = "info" | "error";
export type LogSink = (level: LogLevel, entry: unknown) => void;

export interface RedactingLogger {
  info(entry: unknown): void;
  error(entry: unknown): void;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "xapikey",
  "salt",
  "challengesalt",
  "prompt",
  "promptbody",
  "messages",
  "requestbody",
  "body",
  "input",
  "canonicalinput",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (normalized.endsWith("hash")) return false;
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("authorization") ||
    normalized.endsWith("salt") ||
    normalized.endsWith("prompt") ||
    normalized.endsWith("promptbody") ||
    normalized.endsWith("messages") ||
    normalized.endsWith("requestbody") ||
    normalized.endsWith("canonicalinput")
  );
}

function redactString(value: string): string {
  return value
    .replaceAll(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replaceAll(/\bsk-[A-Za-z0-9_-]{4,}\b/g, REDACTED);
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(item, seen);
  }
  return output;
}

/** Recursively remove values that must never enter request logs. */
export function redactLogValue(value: unknown): unknown {
  return redact(value, new WeakSet());
}

/** Create a minimal structured logger that always redacts before emission. */
export function createRedactingLogger(sink: LogSink): RedactingLogger {
  return {
    info: (entry) => sink("info", redactLogValue(entry)),
    error: (entry) => sink("error", redactLogValue(entry)),
  };
}

/** Default adapter logger; applications may inject their structured sink. */
export const silentRedactingLogger = createRedactingLogger(() => undefined);

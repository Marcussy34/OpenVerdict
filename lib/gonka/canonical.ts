const encoder = new TextEncoder();

function serializeCanonical(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError(`value is not representable as canonical JSON: ${typeof value}`);
  }

  if (stack.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
  stack.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeCanonical(item, stack)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON accepts only arrays and plain objects");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], stack)}`);
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

/** Stable JSON with lexicographically sorted object keys. */
export function canonicalJsonString(value: unknown): string {
  return serializeCanonical(value, new Set());
}

/** UTF-8 bytes used by Gonka input/output audit hashes. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJsonString(value));
}

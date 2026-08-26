import { describe, expect, it, vi } from "vitest";
import { createRedactingLogger, redactLogValue } from "./logger";

describe("redacting logger", () => {
  it("removes keys, salts, authorization, and full prompt bodies", () => {
    const redacted = redactLogValue({
      apiKey: "sk-super-secret",
      salt: "private-salt",
      authorization: "Bearer sk-super-secret",
      prompt: "private full prompt",
      messages: [{ role: "user", content: "private full prompt" }],
      gonkaRouterApiKey: "alternate-secret",
      systemPrompt: "another private full prompt",
      requestMessages: [{ role: "user", content: "private request message" }],
      nested: { challengeSalt: "also-private" },
      promptHash: "0xsafe",
      runId: "run-safe",
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("sk-super-secret");
    expect(serialized).not.toContain("private-salt");
    expect(serialized).not.toContain("private full prompt");
    expect(serialized).not.toContain("also-private");
    expect(serialized).not.toContain("alternate-secret");
    expect(serialized).not.toContain("another private full prompt");
    expect(serialized).not.toContain("private request message");
    expect(serialized).toContain("0xsafe");
    expect(serialized).toContain("run-safe");
  });

  it("redacts before invoking the sink", () => {
    const sink = vi.fn();
    const logger = createRedactingLogger(sink);

    logger.info({ apiKey: "secret", status: "SCHEMA_VALID" });

    expect(sink).toHaveBeenCalledWith("info", {
      apiKey: "[REDACTED]",
      status: "SCHEMA_VALID",
    });
  });
});

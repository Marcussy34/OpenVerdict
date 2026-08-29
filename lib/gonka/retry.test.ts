import { describe, expect, it, vi } from "vitest";
import {
  VisibleRetryError,
  isRetryableGonkaError,
  runWithVisibleRetry,
} from "./retry";

describe("Gonka retry policy", () => {
  it.each([429, 500, 502, 503, 504])("marks HTTP %i retryable", (status) => {
    expect(isRetryableGonkaError(Object.assign(new Error("provider"), { status }))).toBe(
      true,
    );
  });

  it.each([400, 401, 403, 404, 409, 422, 501])(
    "does not retry deterministic HTTP %i",
    (status) => {
      expect(
        isRetryableGonkaError(Object.assign(new Error("provider"), { status })),
      ).toBe(false);
    },
  );

  it("does not retry once the deadline has passed", async () => {
    // A seat's call that ran out its remaining time: retrying would only
    // burn one more call past the seat deadline.
    let clock = 0;
    const operation = vi.fn<() => Promise<string>>().mockImplementation(async () => {
      clock += 100;
      throw Object.assign(new Error("timeout"), { status: 503 });
    });
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      runWithVisibleRetry(operation, {
        maxRetries: 1,
        now: () => clock,
        deadlineMs: 50,
        sleep,
      }),
    ).rejects.toBeInstanceOf(VisibleRetryError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("makes exactly one visible retry with jitter", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();

    const result = await runWithVisibleRetry(operation, {
      maxRetries: 1,
      baseDelayMs: 10,
      jitterMs: 10,
      random: () => 0.5,
      sleep,
    });

    expect(result.value).toBe("ok");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.map((attempt) => attempt.ok)).toEqual([false, true]);
    expect(sleep).toHaveBeenCalledWith(15);
  });

  it("does not retry a deterministic 400", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error("unknown model"), { status: 400 }));

    await expect(
      runWithVisibleRetry(operation, { maxRetries: 1, sleep: async () => undefined }),
    ).rejects.toMatchObject({ attempts: [{ ok: false }] });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("does not mistake a deterministic 400 timeout parameter error for a timeout", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error("invalid timeout parameter"), { status: 400 }));

    await expect(
      runWithVisibleRetry(operation, { maxRetries: 1, sleep: async () => undefined }),
    ).rejects.toMatchObject({ attempts: [{ ok: false }] });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("uses the verified 30–60 second rate-limit backoff by default", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429 }))
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();

    await runWithVisibleRetry(operation, {
      maxRetries: 1,
      random: () => 0.5,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(45_000);
  });

  it("preserves both timeout attempts when the retry is exhausted", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });

    try {
      await runWithVisibleRetry(() => Promise.reject(timeout), {
        maxRetries: 1,
        sleep: async () => undefined,
      });
      throw new Error("expected runWithVisibleRetry to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(VisibleRetryError);
      expect((error as VisibleRetryError).attempts).toHaveLength(2);
    }
  });
});

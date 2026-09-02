import { describe, expect, it, vi } from "vitest";
import { canonicalJsonBytes } from "../gonka/canonical";
import { blake2b256, toHex } from "../protocol/hash";
import type {
  OracleInferenceOutput,
  PublicRunBundle,
} from "../protocol/types";
import {
  reexecuteRun,
  type ReexecuteCompletion,
} from "./reexecute";

const MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507";
const RECORDED_OUTPUT: OracleInferenceOutput = {
  outcome: "YES",
  confidenceBps: 8_700,
  evidenceFor: ["evidence-1"],
  evidenceAgainst: [],
  unsupportedClaims: [],
  decisiveEvidence: ["evidence-1"],
  reasoning: "The cited record supports the claim.",
  publicReasoningTrace: [
    {
      check: "Compare the claim with the cited record",
      evidenceIds: ["evidence-1"],
      assessment: "SUPPORTS",
      finding: "The values agree.",
    },
  ],
};

function outputHash(output: unknown): `0x${string}` {
  return toHex(blake2b256(canonicalJsonBytes(output)));
}

function bundle(version: 2 | 3 | 4 | 5 | 6 = 5): PublicRunBundle {
  return {
    version,
    request: {
      model: MODEL,
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "Evaluate the recorded claim." },
      ],
    },
    promptSpec: {
      maxOutputTokens: 4_096,
      responseFormat: "json_object",
    },
    validatedOutput: RECORDED_OUTPUT,
    outputHash: outputHash(RECORDED_OUTPUT),
    audit: {
      modelId: MODEL,
      responseModelId: MODEL,
    },
  } as unknown as PublicRunBundle;
}

function fakeCompletion({
  content,
  servedModel = MODEL,
}: {
  content: string;
  servedModel?: string;
}) {
  return vi.fn<ReexecuteCompletion>(async () => ({
    data: {
      id: "gonka-request-2",
      model: servedModel,
      system_fingerprint: "fingerprint-2",
      choices: [{ message: { content } }],
    },
    headers: new Headers({
      "x-request-id": "gateway-request-2",
      "x-devshard-id": "devshard-2",
    }),
  }));
}

function fixedClock(): () => number {
  const times = [1_800_000_000_000, 1_800_000_000_037];
  return () => times.shift() ?? times[0]!;
}

describe("reexecuteRun", () => {
  it("reports a matching research verdict and sends the recorded request", async () => {
    const recordedBundle = bundle(5);
    const content = `<think>{"outcome":"NO"}</think>\n${JSON.stringify({
      action: "answer",
      output: RECORDED_OUTPUT,
    })}`;
    const completion = fakeCompletion({ content });

    const result = await reexecuteRun(recordedBundle, {
      completion,
      now: fixedClock(),
    });

    expect(completion).toHaveBeenCalledWith(
      {
        model: MODEL,
        temperature: 0,
        max_tokens: 4_096,
        messages: recordedBundle.request.messages,
        response_format: { type: "json_object" },
      },
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(result).toMatchObject({
      requestedAt: "2027-01-15T08:00:00.000Z",
      completedAt: "2027-01-15T08:00:00.037Z",
      latencyMs: 37,
      gatewayRequestId: "gateway-request-2",
      devshardId: "devshard-2",
      systemFingerprint: "fingerprint-2",
      servedModel: MODEL,
      outputHash: recordedBundle.outputHash,
      outcome: "YES",
      confidenceBps: 8_700,
      matches: { outcome: true, outputHash: true, servedModel: true },
    });
  });

  it("reports a differing verdict from an older direct-output bundle", async () => {
    const freshOutput: OracleInferenceOutput = {
      ...RECORDED_OUTPUT,
      outcome: "NO",
      confidenceBps: 6_200,
    };

    const result = await reexecuteRun(bundle(2), {
      completion: fakeCompletion({ content: JSON.stringify(freshOutput) }),
    });

    expect(result.outcome).toBe("NO");
    expect(result.confidenceBps).toBe(6_200);
    expect(result.matches.outcome).toBe(false);
    expect(result.matches.outputHash).toBe(false);
    expect(result.matches.servedModel).toBe(true);
  });

  it("parses a bare vote object for a v6 table vote bundle", async () => {
    const recordedBundle = bundle(6);
    const completion = fakeCompletion({
      content: JSON.stringify(RECORDED_OUTPUT),
    });

    const result = await reexecuteRun(recordedBundle, { completion });

    expect(completion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: recordedBundle.request.messages,
      }),
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(result.outcome).toBe(RECORDED_OUTPUT.outcome);
    expect(result.confidenceBps).toBe(RECORDED_OUTPUT.confidenceBps);
  });

  it("reports a served-model mismatch independently", async () => {
    const result = await reexecuteRun(bundle(5), {
      completion: fakeCompletion({
        content: JSON.stringify({
          action: "answer",
          output: RECORDED_OUTPUT,
        }),
        servedModel: "different/model",
      }),
    });

    expect(result.matches).toEqual({
      outcome: true,
      outputHash: true,
      servedModel: false,
    });
  });

  it("fails closed when the response has no parseable JSON", async () => {
    await expect(
      reexecuteRun(bundle(5), {
        completion: fakeCompletion({ content: "No JSON was returned." }),
      }),
    ).rejects.toThrow(
      "Re-execution response did not contain a parseable JSON object",
    );
  });
});

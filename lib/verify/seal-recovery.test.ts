import { NoAccessError } from "@mysten/seal";
import { describe, expect, it } from "vitest";

import { canonicalJsonBytes } from "../gonka/canonical";
import { makeInput, makeOutput } from "../gonka/fixtures.test-utils";
import {
  DEFAULT_PROMPT_SPEC_V1,
  promptSpecHash,
} from "../gonka/promptSpec";
import { sealRunBundle } from "../engine/runBundle";
import { blake2b256, toHex } from "../protocol/hash";
import type { PublicRunBundleCoreV2 } from "../protocol/types";
import { sealIdentityHex } from "../seal/identity";
import {
  openEscrowedBundle,
  recoverSealedKey,
  type SealRecoveryEscrow,
} from "./seal-recovery";

const runId = `0x${"01".repeat(32)}` as const;
const claimId = `0x${"02".repeat(32)}` as const;
const agentProfileId = `0x${"03".repeat(32)}` as const;
const jurySeatId = `0x${"04".repeat(32)}` as const;
const packageId = `0x${"05".repeat(32)}` as const;
const deadlineMs = 1_800_000_000_000;

function makeEscrow(): SealRecoveryEscrow {
  return {
    version: 1,
    provider: "seal",
    packageId,
    identityHex: sealIdentityHex({
      claimId,
      jurySeatId,
      phase: 2,
      deadlineMs,
    }),
    deadlineMs,
    threshold: 1,
    keyServers: [
      {
        objectId: `0x${"06".repeat(32)}`,
        weight: 1,
      },
    ],
    encryptedObjectBase64: btoa("encrypted-key"),
    aad: runId,
  };
}

function makeCore(): PublicRunBundleCoreV2 {
  const input = makeInput({ runId });
  const validatedOutput = makeOutput();
  const promptHash = promptSpecHash(DEFAULT_PROMPT_SPEC_V1);
  const inputHash = toHex(blake2b256(canonicalJsonBytes(input)));
  const outputHash = toHex(blake2b256(canonicalJsonBytes(validatedOutput)));
  const runHash = `0x${"07".repeat(32)}` as const;

  return {
    version: 2,
    kind: "run-bundle",
    runId,
    claimId,
    phase: 2,
    agentProfileId,
    jurySeatId,
    promptSpec: DEFAULT_PROMPT_SPEC_V1,
    promptHash,
    input,
    inputHash,
    request: {
      model: "vendor/model-a",
      temperature: 0,
      maxTokens: 4096,
      responseFormat: "json_object",
      attemptKind: "PRIMARY",
      messages: [
        { role: "system", content: DEFAULT_PROMPT_SPEC_V1.systemPrompt },
        {
          role: "user",
          content: new TextDecoder().decode(canonicalJsonBytes(input)),
        },
      ],
    },
    attempts: [],
    rawResponse: { id: "request-1" },
    gateway: {},
    validatedOutput,
    outputHash,
    audit: {
      runId,
      claimObjectId: claimId,
      agentProfileId,
      jurySeatId,
      phase: 2,
      attempt: 1,
      providerId: "gonkarouter",
      modelId: "vendor/model-a",
      gonkaRequestId: "request-1",
      promptHash,
      inputHash,
      outputHash,
      runWalrusBlobId: "sealed-blob",
      toolTranscriptHash: `0x${"08".repeat(32)}`,
      toolTranscriptWalrusBlobId: "transcript-blob",
      toolCallCount: 0,
      evidenceRoot: `0x${"09".repeat(32)}`,
      requestedAtMs: 1,
      completedAtMs: 2,
      latencyMs: 1,
      status: "SCHEMA_VALID",
    },
    runHash,
    verify: {
      promptHash: "blake2b256(canonicalJson(promptSpec))",
      inputHash: "blake2b256(canonicalJson(input))",
      outputHash: "blake2b256(canonicalJson(validatedOutput))",
      runHash: "blake2b256(BCS(RunRecordV1))",
      commitment: "blake2b256(BCS(VotePreimageV1))",
    },
  };
}

describe("Seal escrow recovery", () => {
  it("parses the identity before requesting the recovered key", async () => {
    const recoveredBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    let parsedIdentity: unknown;

    const recoveredKey = await recoverSealedKey(
      { escrow: makeEscrow(), network: "testnet" },
      {
        decrypt: async ({ identity }) => {
          parsedIdentity = identity;
          return recoveredBytes;
        },
      },
    );

    expect(parsedIdentity).toEqual({
      claimId,
      jurySeatId,
      phase: 2,
      deadlineMs,
    });
    expect(recoveredKey).toBe(toHex(recoveredBytes));
  });

  it("maps a pre-deadline access refusal to readable copy", async () => {
    await expect(
      recoverSealedKey(
        { escrow: makeEscrow(), network: "testnet" },
        {
          decrypt: async () => {
            throw new NoAccessError();
          },
        },
      ),
    ).rejects.toThrow(
      "The key servers refuse until the reveal deadline passes",
    );
  });

  it("fails closed when a required escrow field is missing", async () => {
    await expect(
      recoverSealedKey(
        {
          escrow: { ...makeEscrow(), packageId: undefined },
          network: "testnet",
        },
        { decrypt: async () => new Uint8Array(32) },
      ),
    ).rejects.toThrow("Seal escrow is missing packageId");
  });

  it("opens a locally sealed bundle and recomputes its core hash", async () => {
    const core = makeCore();
    const { sealed, seal } = sealRunBundle(core, { runId });

    const opened = await openEscrowedBundle(sealed, seal.keyHex);

    expect(opened.core).toEqual(core);
    expect(opened.coreHash).toBe(sealed.coreHash);
  });
});

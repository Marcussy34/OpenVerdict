# Proof Chain v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every juror inference provable end to end: the exact prompt is bound on chain through the agent manifest, the exact request and response are published on Walrus, the pre-commit artifact is sealed so no vote leaks before its reveal, and a verifier can recompute every hash in the browser.

**Architecture:** A versioned `PromptSpecV1` becomes data (not a code constant); its hash is the `promptHash` in every agent manifest and therefore the `prompt_hash` inside every on-chain run hash, and the engine refuses to run a seat whose manifest hash does not match the live spec (fail closed). Each run produces a `PublicRunBundleV2` (prompt spec, exact request, raw response, validated output, audit, hashes). At inference time only an AES-256-GCM sealed copy is published and cited by `approve_run`; at reveal time the plaintext bundle plus the key are published and cited as `argument_blob_id`, so the pre-commit existence proof survives and nothing leaks early. The seven seeded jurors get real manifest documents on chain through `agent_registry::update_agent_manifest`. The UI exposes all of it with client-side recomputation.

**Tech Stack:** TypeScript (ESM), `@noble/hashes` blake2b, `@mysten/sui` v2 BCS, Node `crypto` AES-256-GCM (ciphertext || tag layout so WebCrypto can decrypt in the browser), drizzle over Postgres/PGlite, Walrus SDK, Next.js 16 App Router, shadcn/ui, iconsax-react, vitest.

**Spec:** This document, section "Design decisions" (approved in chat on 2026-08-29; no separate spec file). Background facts: `docs/CHECKPOINT-2026-08-29.md`, PRD sections 6, 14, 17.7, 22.

## Global Constraints

- Never use an em dash (U+2014) in any file, comment, commit message, or output. Use commas, colons, parentheses, or periods.
- No git commits by workers unless the task says so; the manager commits after review. Never touch `.env`.
- `lib/engine/contract.ts` is the seam between engine and consumers; any new engine method must be added there, in `lib/engine/engine.ts`, and in the CLI or API where the task says.
- The u8 wire codes and `computeVoteCommitment` are frozen contracts; do not change `lib/protocol/bcs.ts` structs or `lib/protocol/constants.ts`.
- `RunRecordV1` (`lib/protocol/bcs.ts:20`) stays byte-identical: `prompt_hash` and `input_hash` keep their meaning. This plan only makes them true and verifiable.
- No Move changes. `agent_registry::update_agent_manifest`, `jury::approve_run`, and `jury::reveal_vote` are used exactly as deployed at package `0xb411210a52dad799b9b4a53e3a44b30c3c8b8a3b1981795f830166533a474c1d`.
- Models never receive URLs, keys, or transaction authority; salts and seal keys never leave the engine's database; malformed model output never becomes a vote.
- Icons: iconsax-react only. Components: shadcn/ui + Tailwind utilities, no custom CSS files.
- Tests: vitest (`pnpm test`), `pnpm typecheck`, `pnpm lint`, `pnpm build` must stay green at the end of each task.
- Walrus blob ids are 43-char base64url; the local store (`lib/walrus/local.ts`) is used by tests and returns no objectId or endEpoch.

---

## Design decisions (read before any task)

1. **PromptSpecV1 is the single source of every byte a model can receive besides the canonical input.** It carries the system prompt, the JSON-fallback suffix, the repair system prompt, temperature, max output tokens, and response format. Its hash is `blake2b256(canonicalJsonBytes(spec))`.
2. **`AgentManifest.promptHash` must equal the live adapter's `promptSpecHash()`**, checked in `juryRun` before any request. A mismatch is an `EngineValidationError` naming the agent, the two hashes, and the fix (`pnpm tsx scripts/publish-agent-manifests.ts`).
3. **`AgentManifestDocumentV2` is the one manifest format** for both backing kinds (`TESTNET_DEMO_ALLOWLIST` and `ZKLOGIN_BACKED`). It embeds the prompt spec, the tool policy, and the evidence policy. `manifestHash = blake2b256(canonicalJsonBytes(document))`.
4. **`PublicRunBundleV2` replaces the v1 bundle.** The plaintext bundle is published only at reveal time. At inference time a `SealedRunBundleV2` (AES-256-GCM over the canonical core bytes, key held in Postgres) is published and cited by `approve_run` as `run_blob_id`. The reveal cites the plaintext bundle as `argument_blob_id`; the plaintext bundle carries the key, IV, sealed blob id, and core hash so anyone can decrypt the sealed blob and confirm equality.
5. **Gateway identifiers are audit pointers, not proofs.** GonkaRouter returns `id` (`devshard-<n>-<seq>`), header `x-request-id`, header `x-devshard-id`, and `system_fingerprint`. All four are recorded. No Gonka chain record id exists through the broker today (verified 2026-08-29 against the live API and gonka.ai docs), and nothing in this plan claims one.
6. **Seed and canary scripts derive manifests from the same builder.** `scripts/seed-testnet-agents.ts` reconstructs the DB row from the on-chain `manifest_blob_id` and the Walrus document, and refuses placeholders.

### Shared types (defined in Task 1, consumed by every later task)

```ts
// lib/protocol/types.ts (append)
export type PromptSpecV1 = {
  version: "1";
  providerId: "gonkarouter";
  systemPrompt: string;
  jsonFallbackSuffix: string;
  repairSystemPrompt: string;
  temperature: 0;
  maxOutputTokens: 4096;
  responseFormat: "json_object";
};

export type AgentBackingKind = "TESTNET_DEMO_ALLOWLIST" | "ZKLOGIN_BACKED";

export type AgentManifestDocumentV2 = {
  version: "2";
  network: "localnet" | "testnet" | "mainnet";
  backingKind: AgentBackingKind;
  humanBackingHash: HexString;
  humanVerificationProvider: string;
  operationalOwner: HexString;
  role: string;
  modelId: string;
  providerId: "gonkarouter";
  promptSpec: PromptSpecV1;
  promptHash: HexString;
  toolPolicy: { version: "1"; tools: [] };
  toolPolicyHash: HexString;
  evidencePolicyId: string;
  evidencePolicyHash: HexString;
};

export type GatewayResponseMeta = {
  gatewayRequestId?: string;   // header x-request-id
  devshardId?: string;         // header x-devshard-id
  systemFingerprint?: string;  // body system_fingerprint
};

export type ProviderRequestRecord = {
  model: string;
  temperature: 0;
  maxTokens: 4096;
  responseFormat: "json_object" | "none";
  attemptKind: "PRIMARY" | "RETRY" | "JSON_PROMPT_FALLBACK" | "REPAIR";
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export type PublicRunBundleCoreV2 = {
  version: 2;
  kind: "run-bundle";
  runId: HexString;
  claimId: HexString;
  phase: 1 | 2;
  agentProfileId: HexString;
  jurySeatId: HexString;
  promptSpec: PromptSpecV1;
  promptHash: HexString;
  input: OracleInferenceInput;
  inputHash: HexString;
  request: ProviderRequestRecord;          // the attempt that produced validatedOutput
  attempts: unknown[];                      // adapter attempt records, verbatim
  rawResponse: unknown;                     // provider body of the final attempt
  gateway: GatewayResponseMeta;
  validatedOutput: OracleInferenceOutput;
  outputHash: HexString;
  audit: InferenceRunAudit;
  runHash: HexString;
  verify: {
    promptHash: "blake2b256(canonicalJson(promptSpec))";
    inputHash: "blake2b256(canonicalJson(input))";
    outputHash: "blake2b256(canonicalJson(validatedOutput))";
    runHash: "blake2b256(BCS(RunRecordV1))";
    commitment: "blake2b256(BCS(VotePreimageV1))";
  };
};

export type RunBundleSeal = {
  algorithm: "AES-256-GCM";
  keyHex: HexString;        // 32 bytes
  ivHex: HexString;         // 12 bytes
  aad: string;              // the runId, utf8
  sealedBlobId: string;
  coreHash: HexString;      // blake2b256 of the canonical core bytes
};

export type PublicRunBundleV2 = PublicRunBundleCoreV2 & { seal: RunBundleSeal };

export type SealedRunBundleV2 = {
  version: 2;
  kind: "sealed-run-bundle";
  runId: HexString;
  algorithm: "AES-256-GCM";
  ivHex: HexString;
  aad: string;
  coreHash: HexString;
  ciphertextBase64: string;   // ciphertext || 16-byte auth tag, base64
};
```

---

## File structure

- `lib/gonka/promptSpec.ts` (new): `DEFAULT_PROMPT_SPEC_V1`, `promptSpecHash(spec)`, `buildPrimaryMessages(spec, input)`, `buildFallbackMessages(spec, input)`, `buildRepairMessages(spec, input, invalidContent)`.
- `lib/gonka/adapter.ts` (modify): consume the spec, capture response headers, return `request` + `gateway` on the run result, expose `promptSpec()` and `promptSpecHash()` on the adapter interface.
- `lib/gonka/fake.ts` (modify): same interface additions.
- `lib/gonka/types.ts` (modify): `GonkaRunResult` gains `request: ProviderRequestRecord` and `gateway: GatewayResponseMeta`.
- `lib/gonka/audit.ts` (modify): audit gains `gatewayRequestId`, `devshardId`, `systemFingerprint` (optional strings).
- `lib/protocol/types.ts` (modify): the shared types above; `InferenceRunAudit` gains the three optional gateway fields.
- `lib/engine/agentManifestDocument.ts` (new): `buildAgentManifestDocument(params)` returning `{ document, bytes, manifestHash, promptHash, toolPolicyHash }`.
- `lib/engine/runBundle.ts` (new): `buildRunBundleCore(...)`, `sealRunBundle(core)`, `openSealedRunBundle(sealed, seal)`, `canonicalCoreBytes(core)`.
- `lib/engine/engine.ts` (modify): prompt binding check, sealed upload + approve, plaintext upload at reveal, `registerZkBackedAgent` uses the document builder, new read methods `runProof` and `agentManifestDocument`.
- `lib/engine/contract.ts` (modify): the two new read methods and their result types.
- `lib/storage/schema.ts` + `lib/storage/migrate.ts` + `lib/storage/repository.ts` (modify): `inference_runs` gains `seal_key_hex`, `seal_iv_hex`, `core_hash`, `sealed_blob_id`, `sealed_object_id`, `revealed_blob_id`, `revealed_object_id`.
- `lib/sui/builders.ts`, `lib/sui/gateway.ts`, `lib/sui/gateway-types.ts`, `lib/sui/fake.ts` (modify): `update_agent_manifest`.
- `scripts/lib/testnet-agents.ts` (new, extracted from `scripts/seed-testnet-agents.ts`): `discoverAgents`.
- `scripts/publish-agent-manifests.ts` (new), `scripts/seed-testnet-agents.ts` (rewrite), `scripts/testnet-canary.ts`, `scripts/localnet-e2e.ts`, `scripts/cockpit-demo.ts` (modify: real manifests).
- `app/api/claims/[id]/runs/[runId]/proof/route.ts` (new), `app/api/agents/[id]/manifest/route.ts` (new), `app/claims/[id]/page.tsx`, `app/verify/page.tsx`, `app/agents/[id]/page.tsx`, `components/claim/run-proof.tsx` (new).
- Docs: `PRD.md` section 1.1 item 8, `docs/STATUS.md`, `docs/CHECKPOINT-2026-08-29.md`, `docs/demo/runbook.md`, `docs/diagrams/05-data-placement.excalidraw`, `docs/diagrams/06-protocol-artifacts.excalidraw`.

---

### Task 1: Prompt spec, spec-driven adapter, manifest document v2, engine binding, bundle v2 core

**Files:**
- Create: `lib/gonka/promptSpec.ts`, `lib/gonka/promptSpec.test.ts`, `lib/engine/agentManifestDocument.ts`, `lib/engine/agentManifestDocument.test.ts`, `lib/engine/runBundle.ts`, `lib/engine/runBundle.test.ts`
- Modify: `lib/protocol/types.ts`, `lib/gonka/adapter.ts`, `lib/gonka/fake.ts`, `lib/gonka/types.ts`, `lib/gonka/audit.ts`, `lib/gonka/index.ts`, `lib/engine/engine.ts` (juryRun around lines 1440-1530, registerZkBackedAgent around lines 1895-1960), `lib/engine/contract.ts`, `lib/engine/engine.test.ts`, `lib/gonka/adapter.test.ts`, `lib/gonka/fake.test.ts`

**Interfaces:**
- Produces: everything in "Shared types"; `DEFAULT_PROMPT_SPEC_V1: PromptSpecV1`; `promptSpecHash(spec: PromptSpecV1): HexString`; `GonkaRouterAdapter.promptSpec(): PromptSpecV1` and `.promptSpecHash(): HexString`; `buildAgentManifestDocument({ network, backingKind, humanBackingHash, humanVerificationProvider, operationalOwner, role, modelId, promptSpec, evidencePolicyId }): { document: AgentManifestDocumentV2; bytes: Uint8Array; manifestHash: HexString; promptHash: HexString; toolPolicyHash: HexString }`; `buildRunBundleCore(...)`, `canonicalCoreBytes(core): Uint8Array`, `sealRunBundle(core, { runId, random? }): { sealed: SealedRunBundleV2; seal: Omit<RunBundleSeal, "sealedBlobId"> }`, `openSealedRunBundle(sealed: SealedRunBundleV2, seal: Pick<RunBundleSeal, "keyHex" | "ivHex" | "aad">): PublicRunBundleCoreV2`; engine read methods `runProof(claimId, runId): Promise<RunProof>` and `agentManifestDocument(agentProfileId): Promise<AgentManifestDocumentV2 | null>` where `RunProof = { runId, claimId, phase, agentProfileId, jurySeatId, promptHash, inputHash, outputHash, runHash, gateway: GatewayResponseMeta, sealedBlobId: string | null, revealedBlobId: string | null, revealed: boolean, bundle: PublicRunBundleV2 | null }` (bundle is null until revealed).

- [ ] **Step 1: Failing tests for the prompt spec**

```ts
// lib/gonka/promptSpec.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_SPEC_V1, promptSpecHash, buildPrimaryMessages, buildRepairMessages } from "./promptSpec";

describe("promptSpec", () => {
  it("hashes canonically and stably", () => {
    const a = promptSpecHash(DEFAULT_PROMPT_SPEC_V1);
    const b = promptSpecHash({ ...DEFAULT_PROMPT_SPEC_V1 });
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
  it("changes when any byte of the system prompt changes", () => {
    const changed = { ...DEFAULT_PROMPT_SPEC_V1, systemPrompt: DEFAULT_PROMPT_SPEC_V1.systemPrompt + " " };
    expect(promptSpecHash(changed)).not.toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V1));
  });
  it("builds the primary messages from the spec only", () => {
    const messages = buildPrimaryMessages(DEFAULT_PROMPT_SPEC_V1, { protocolVersion: "1.0" } as never);
    expect(messages[0]).toEqual({ role: "system", content: DEFAULT_PROMPT_SPEC_V1.systemPrompt });
    expect(messages[1]?.role).toBe("user");
  });
  it("repair messages use the repair system prompt verbatim", () => {
    const messages = buildRepairMessages(DEFAULT_PROMPT_SPEC_V1, { evidenceManifest: { items: [] }, outputContract: { maximumReasonLength: 4000 } } as never, "not json");
    expect(messages[0]).toEqual({ role: "system", content: DEFAULT_PROMPT_SPEC_V1.repairSystemPrompt });
  });
});
```

- [ ] **Step 2: Run, expect failure** (`pnpm vitest run lib/gonka/promptSpec.test.ts`: module not found)

- [ ] **Step 3: Implement `lib/gonka/promptSpec.ts`**: move the existing `JSON_SYSTEM_PROMPT` text (adapter.ts:48-61) into `DEFAULT_PROMPT_SPEC_V1.systemPrompt`, the string `" JSON only; no markdown fences or prose outside the object."` into `jsonFallbackSuffix`, and the repair system prompt (adapter.ts:588-592, joined by single spaces) into `repairSystemPrompt`. `temperature: 0`, `maxOutputTokens: 4096`, `responseFormat: "json_object"`. `promptSpecHash = toHex(blake2b256(canonicalJsonBytes(spec)))`. Message builders reproduce exactly the messages the adapter builds today (primary: system + canonicalJsonString(input); fallback: system + suffix; repair: repair system prompt + the canonical JSON repair payload with `task`, `validEvidenceIds`, `maximumReasonLength`, `invalidOutput` sliced to 20000).

- [ ] **Step 4: Adapter consumes the spec.** `createGonkaAdapter(cfg)` accepts optional `promptSpec` (default `DEFAULT_PROMPT_SPEC_V1`). Replace the inline message construction with the builders; take `temperature`, `max_tokens`, and response format from the spec. Use `client.chat.completions.create(...).withResponse()` to capture headers; record `gatewayRequestId = headers.get("x-request-id")`, `devshardId = headers.get("x-devshard-id")`, `systemFingerprint = body.system_fingerprint` into `GonkaRunResult.gateway`, and the exact final attempt into `GonkaRunResult.request` (model, temperature, maxTokens, responseFormat `"json_object"` when the request carried `response_format`, else `"none"`, attemptKind, messages). Add `promptSpec()` and `promptSpecHash()` to the `GonkaRouterAdapter` interface and both adapters (fake returns the default). `buildRunAudit` copies the three gateway fields into the audit. Update `lib/gonka/adapter.test.ts` fixtures: the fake fetch in `lib/gonka/fake.ts` must also return the two headers so tests cover them.

- [ ] **Step 5: Failing tests for the manifest document**

```ts
// lib/engine/agentManifestDocument.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_SPEC_V1, promptSpecHash } from "../gonka/promptSpec";
import { buildAgentManifestDocument } from "./agentManifestDocument";

const base = {
  network: "testnet" as const,
  backingKind: "TESTNET_DEMO_ALLOWLIST" as const,
  humanBackingHash: `0x${"11".repeat(32)}` as const,
  humanVerificationProvider: "testnet-demo-allowlist",
  operationalOwner: `0x${"22".repeat(32)}` as const,
  role: "SKEPTIC",
  modelId: "MiniMaxAI/MiniMax-M2.7",
  promptSpec: DEFAULT_PROMPT_SPEC_V1,
  evidencePolicyId: "OPENVERDICT_EVIDENCE_POLICY_V1",
};

describe("buildAgentManifestDocument", () => {
  it("embeds the prompt spec and binds its hash", () => {
    const built = buildAgentManifestDocument(base);
    expect(built.document.version).toBe("2");
    expect(built.document.promptHash).toBe(promptSpecHash(DEFAULT_PROMPT_SPEC_V1));
    expect(built.promptHash).toBe(built.document.promptHash);
    expect(built.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("is deterministic for equal inputs and sensitive to the model id", () => {
    expect(buildAgentManifestDocument(base).manifestHash).toBe(buildAgentManifestDocument({ ...base }).manifestHash);
    expect(buildAgentManifestDocument({ ...base, modelId: "moonshotai/Kimi-K2.6" }).manifestHash).not.toBe(buildAgentManifestDocument(base).manifestHash);
  });
});
```

- [ ] **Step 6: Implement `lib/engine/agentManifestDocument.ts`**: `toolPolicy = { version: "1", tools: [] }`, `toolPolicyHash = toHex(blake2b256(canonicalJsonBytes(toolPolicy)))`, `evidencePolicyHash = toHex(blake2b256(utf8(evidencePolicyId)))` (matches the existing `hexHash("OPENVERDICT_EVIDENCE_POLICY_V1")` convention in scripts), `promptHash = promptSpecHash(spec)`, `bytes = canonicalJsonBytes(document)`, `manifestHash = toHex(blake2b256(bytes))`. Also export `parseAgentManifestDocument(bytes: Uint8Array): AgentManifestDocumentV2` with a zod schema that rejects anything but version "2".

- [ ] **Step 7: `registerZkBackedAgent` uses the builder** (engine.ts around 1913-1960): build the document with `backingKind: "ZKLOGIN_BACKED"`, `promptSpec: this.#gonka.promptSpec()`, `evidencePolicyId: evidencePolicyId(this.#manifest)`; upload `bytes`; pass `manifestHash` bytes to `registerAgent`; set `manifest.version = "2"`, `manifest.promptHash = built.promptHash`, `manifest.toolPolicyHash = built.toolPolicyHash`. Extend the existing zkLogin registration test in `lib/engine/engine.test.ts` to assert `promptHash === promptSpecHash(DEFAULT_PROMPT_SPEC_V1)` and that the Walrus store received a document whose `version` is "2".

- [ ] **Step 8: Failing test for the fail-closed prompt binding** in `lib/engine/engine.test.ts`: build an engine (existing test factory) whose initial agent manifest has `promptHash: "0x" + "ab".repeat(32)`; drive a claim to the point where `juryRun` runs; expect it to reject with an `EngineValidationError` whose message contains "prompt hash" and "publish-agent-manifests". Then a positive test: with `promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V1)` the run succeeds.

- [ ] **Step 9: Implement the binding** in `juryRun` before the adapter call: compare `agent.manifest.promptHash` with `this.#gonka.promptSpecHash()`; on mismatch throw `EngineValidationError` with the message `agent ${agentProfileId} manifest prompt hash ${manifestHash} does not match the engine prompt spec ${liveHash}; run pnpm tsx scripts/publish-agent-manifests.ts`. Update every existing engine test fixture agent to use `promptSpecHash(DEFAULT_PROMPT_SPEC_V1)` (search for `promptHash:` in `lib/engine/engine.test.ts` and `scripts/`; scripts are handled in Task 3, tests here).

- [ ] **Step 10: Failing tests for the bundle core and sealing**

```ts
// lib/engine/runBundle.test.ts
import { describe, expect, it } from "vitest";
import { blake2b256, toHex } from "../protocol";
import { canonicalCoreBytes, openSealedRunBundle, sealRunBundle } from "./runBundle";

const core = { version: 2, kind: "run-bundle", runId: `0x${"01".repeat(32)}` /* plus every other field, use a fixture helper */ } as never;

describe("run bundle sealing", () => {
  it("round-trips through AES-256-GCM and binds the core hash", () => {
    const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
    expect(sealed.kind).toBe("sealed-run-bundle");
    expect(sealed.coreHash).toBe(toHex(blake2b256(canonicalCoreBytes(core))));
    expect(seal.keyHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(openSealedRunBundle(sealed, seal)).toEqual(core);
  });
  it("rejects a wrong key and a tampered ciphertext", () => {
    const { sealed, seal } = sealRunBundle(core, { runId: core.runId });
    expect(() => openSealedRunBundle(sealed, { ...seal, keyHex: `0x${"00".repeat(32)}` })).toThrow();
    const tampered = { ...sealed, ciphertextBase64: sealed.ciphertextBase64.slice(0, -4) + "AAAA" };
    expect(() => openSealedRunBundle(tampered, seal)).toThrow();
  });
});
```

- [ ] **Step 11: Implement `lib/engine/runBundle.ts`**: `canonicalCoreBytes = canonicalJsonBytes(core)`; `sealRunBundle` uses `crypto.randomBytes(32)` key and `randomBytes(12)` IV (injectable `random` for tests), `createCipheriv("aes-256-gcm", key, iv)` with `setAAD(utf8(runId))`, output `ciphertext || authTag` base64; `openSealedRunBundle` decrypts with `createDecipheriv`, sets AAD, splits the last 16 bytes as the tag, checks `blake2b256(plaintext)` equals `coreHash`, then parses JSON. `buildRunBundleCore` assembles the core from the run result, input, audit, and hashes.

- [ ] **Step 12: Engine uses the bundle core at inference time (plaintext for now).** In `juryRun` replace the v1 bundle object (engine.ts:1506-1517) with `buildRunBundleCore(...)`; keep publishing it as today (Task 2 seals it). Persist `promptHash`, `gateway` fields in the run audit. Add the read methods `runProof` and `agentManifestDocument` to `contract.ts` and `engine.ts` (`agentManifestDocument` fetches the profile's `manifestBlobId` from the DB manifest, reads the blob from Walrus, parses with `parseAgentManifestDocument`, returns null if the blob is not a v2 document). Add tests for both read methods over the fake gateway and local Walrus store.

- [ ] **Step 13: Gate**: `pnpm vitest run lib/gonka lib/engine`, then `pnpm typecheck`, `pnpm lint`. Report the list of changed files.

---

### Task 2: Sealed pre-commit bundle, plaintext publication at reveal, storage columns

**Files:**
- Modify: `lib/storage/schema.ts` (`inferenceRuns`), `lib/storage/migrate.ts`, `lib/storage/repository.ts`, `lib/storage/types.ts`, `lib/engine/engine.ts` (juryRun upload block around 1455-1530; `votesReveal` around 665-700), `lib/engine/engine.test.ts`, `lib/protocol/types.ts` (`InferenceRunRecord` if defined there)

**Interfaces:**
- Consumes: Task 1's `sealRunBundle`, `openSealedRunBundle`, `buildRunBundleCore`, `PublicRunBundleV2`, `RunProof`.
- Produces: `InferenceRunRecord` gains `sealKeyHex`, `sealIvHex`, `coreHash`, `sealedBlobId`, `sealedObjectId`, `revealedBlobId`, `revealedObjectId` (all nullable); `runProof` returns the plaintext bundle only when `revealedBlobId` is set.

- [ ] **Step 1: Migration.** Append to `MIGRATION_SQL` in `lib/storage/migrate.ts`:

```sql
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS seal_key_hex TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS seal_iv_hex TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS core_hash TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS sealed_blob_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS sealed_object_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS revealed_blob_id TEXT;
ALTER TABLE inference_runs ADD COLUMN IF NOT EXISTS revealed_object_id TEXT;
```

Mirror the columns in `schema.ts` and the record mapping in `repository.ts`. Add a comment next to `seal_key_hex`: same trust boundary as `vote_packages.salt_hex`; encrypt at rest before production.

- [ ] **Step 2: Failing engine test**: run a claim through `juryRun` with the local Walrus store; assert the Walrus store received exactly two blobs for the seat before the commit (the sealed bundle and the tool transcript), that the sealed blob parses as `SealedRunBundleV2`, that no blob written before the reveal contains the string of the validated outcome, and that after `votesReveal` a plaintext `PublicRunBundleV2` exists whose `seal.sealedBlobId` equals the earlier sealed blob id and whose `seal.coreHash` verifies via `openSealedRunBundle`.

- [ ] **Step 3: Implement.** In `juryRun`: drop the separate raw-response upload; build the core; `sealRunBundle`; upload the sealed JSON as `${baseRunId}-sealed-run-bundle.json`; upload the tool transcript as before; call `approveRun` with `runBlobId = sealed upload blob id`; persist `runWalrusBlobId = sealedBlobId` (what chain cites), `sealedBlobId`, `sealedObjectId`, `sealKeyHex`, `sealIvHex`, `coreHash`. In `votesReveal`: for each package, rebuild the plaintext bundle `{ ...core, seal }` (core reconstructed from the stored audit, output, input, and adapter records; store the canonical core JSON in `inference_runs.audit.bundleCore` at inference time so no recomputation is needed), upload as `${runId}-run-bundle.json`, pass its blob id as `argumentBlobId` (and object id / end epoch), persist `revealedBlobId`, `revealedObjectId`. `runProof` returns `bundle` from the revealed blob.

- [ ] **Step 4: Gate**: `pnpm vitest run lib/engine lib/storage`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

---

### Task 3: On-chain manifest updates and scripts

**Files:**
- Create: `scripts/lib/testnet-agents.ts`, `scripts/publish-agent-manifests.ts`
- Modify: `lib/sui/builders.ts`, `lib/sui/gateway.ts`, `lib/sui/gateway-types.ts`, `lib/sui/fake.ts`, `lib/sui/sui.test.ts`, `scripts/seed-testnet-agents.ts`, `scripts/testnet-canary.ts`, `scripts/localnet-e2e.ts`, `scripts/cockpit-demo.ts`

**Interfaces:**
- Consumes: `buildAgentManifestDocument`, `parseAgentManifestDocument`, `DEFAULT_PROMPT_SPEC_V1`, `promptSpecHash`.
- Produces: `buildUpdateAgentManifestTransaction(manifest, input: UpdateAgentManifestTransactionInput): Transaction` where `UpdateAgentManifestTransactionInput = { agentProfileId: string; agentCapId: string; manifestHash: Uint8Array; manifestBlobId: string; modelHash: Uint8Array; roleHash: Uint8Array }`; `SuiGateway.updateAgentManifest(input: UpdateAgentManifestTransactionInput & { agentIndex: number }): Promise<TxResult & { version?: number }>` (signed by the agent keypair, parses the `AgentManifestUpdated` event); `discoverAgents(client, manifest, signers): Promise<DiscoveredAgent[]>` moved to `scripts/lib/testnet-agents.ts` with `DiscoveredAgent = { index, owner, profileId, capId, manifestHash, manifestBlobId, humanBackingHash }` (read the profile object's fields, not only the cap).

- [ ] **Step 1: Builder + gateway + fake**, mirroring `register_agent` (builders.ts:156, gateway.ts:69). Move call target `agent_registry::update_agent_manifest` with arguments `[registry, profile, cap, manifest_hash, manifest_blob_id, model_hash, role_hash, clock]`. Test in `lib/sui/sui.test.ts`: the built transaction targets the right function with 8 arguments, and the fake gateway records the update and bumps a version counter.

- [ ] **Step 2: `scripts/publish-agent-manifests.ts`**: env `SUI_OPERATOR_SECRET_KEY`, `OPENVERDICT_AGENT_SEED`, `DATABASE_URL`; manifest `config/release.testnet.json`; real Walrus store (find the SDK store factory in `lib/walrus/real.ts`; the operator signer pays). For each discovered agent: role and model as in `seed-testnet-agents.ts` (index < 3 SOURCE_AUTHENTICITY + models[0]; < 5 SKEPTIC + models[1]; else SKEPTIC + models[2]); `humanBackingHash` read from the profile; build the v2 document with `backingKind: "TESTNET_DEMO_ALLOWLIST"`, `humanVerificationProvider: "testnet-demo-allowlist"`, `operationalOwner: owner`; if the on-chain `manifest_hash` already equals the computed hash, skip; else upload bytes, call `updateAgentManifest`, then `saveAgentManifest` with version "2" and the real hashes. Print a table: index, profile, old hash, new hash, blob id, digest. `--dry-run` prints without sending.

- [ ] **Step 3: `scripts/seed-testnet-agents.ts` v2**: for each discovered agent read `manifest_blob_id` from the profile, fetch the blob from Walrus, `parseAgentManifestDocument`, and save the DB manifest from the document (role, model, hashes, `version: "2"`). If parsing fails, exit non-zero with `profile ${id} still carries a placeholder manifest: run scripts/publish-agent-manifests.ts first`.

- [ ] **Step 4: Canary, e2e, cockpit**: wherever they register agents with `promptHash: hexHash(...)` or `deterministicId(...)`, build the v2 document, upload it to the script's Walrus store, and pass the real `manifestHash`/`manifestBlobId`/`promptHash`. Keep their role and model assignment unchanged.

- [ ] **Step 5: Gate**: `pnpm vitest run lib/sui`, `pnpm typecheck`, `pnpm lint`. Do NOT run the scripts against testnet; the manager does that.

---

### Task 4: Verifier UI and proof API routes

**Files:**
- Create: `app/api/claims/[id]/runs/[runId]/proof/route.ts`, `app/api/agents/[id]/manifest/route.ts`, `components/claim/run-proof.tsx`
- Modify: `app/claims/[id]/page.tsx`, `app/verify/page.tsx`, `app/agents/[id]/page.tsx`

**Interfaces:**
- Consumes: `engine.runProof(claimId, runId)` and `engine.agentManifestDocument(agentProfileId)` through `getServerEngine()`; `PublicRunBundleV2`, `SealedRunBundleV2`; browser-safe hashing from `lib/protocol` (already used by `/verify`); WebCrypto `AES-GCM` for decryption.

- [ ] **Step 1: Routes.** `GET /api/claims/[id]/runs/[runId]/proof` returns `RunProof` (503 `engine_not_wired` pattern from the other routes; 404 when the run is unknown). `GET /api/agents/[id]/manifest` returns the v2 document or 404. Both anonymous (watch tier).

- [ ] **Step 2: `components/claim/run-proof.tsx`**: for one juror: rows for prompt hash, input hash, output hash, run hash, gateway request id, devshard id, sealed blob id, revealed blob id (hash-chip style already in `components/viz/hash-chip.tsx`), a collapsible "exact prompt" panel (system prompt + the user message JSON, monospace, scrollable), the model output, and a "Recompute in this browser" button that: recomputes promptHash, inputHash, outputHash from the bundle; recomputes runHash with `RunRecordV1Bcs` from the audit fields; decrypts the sealed blob (fetched through the proof route, which should include `sealed: SealedRunBundleV2 | null`) with the key from `bundle.seal` and checks `coreHash`; shows green or red per check with iconsax `TickCircle` / `CloseCircle`. Before the reveal it shows the sealed blob id and the phrase "sealed until reveal".

- [ ] **Step 3: Wire it** into the juror section of `app/claims/[id]/page.tsx`; add a run-hash mode to `app/verify/page.tsx` (paste a bundle JSON or a revealed blob id; same checks); show the manifest document (prompt spec, hashes, blob id) on `app/agents/[id]/page.tsx`.

- [ ] **Step 4: Gate**: `pnpm typecheck`, `pnpm lint`, `pnpm build`. Manual check in `pnpm dev` with the cockpit demo state (`scripts/cockpit-demo.ts`) if available.

---

### Task 5: Docs and diagrams

**Files:**
- Modify: `PRD.md` (section 1.1, add item 8), `docs/STATUS.md`, `docs/CHECKPOINT-2026-08-29.md`, `docs/demo/runbook.md`, `docs/diagrams/05-data-placement.excalidraw`, `docs/diagrams/06-protocol-artifacts.excalidraw`

- [ ] **Step 1**: PRD 1.1 item 8: prompt spec bound through the manifest, bundle v2, sealed pre-commit publication, gateway ids recorded as pointers, no Gonka chain record id available through brokers (devshard model).
- [ ] **Step 2**: STATUS layer table rows for inference adapter and engine; checkpoint "Known gaps": mark the pre-reveal exposure fixed and the placeholder manifests fixed once Task 6 ran.
- [ ] **Step 3**: Diagram text: in `05-data-placement.excalidraw` replace the run bundle lines with the sealed-then-revealed description; in `06-protocol-artifacts.excalidraw` add the prompt-spec hash line to box 1. Re-render both with `uv run python render_excalidraw.py` from the skill references directory.

---

### Task 7: Raw-blob Walrus store (content addressing that verifiers can actually use)

**Why (verified live on testnet, 2026-08-29):** `client.walrus.writeFiles` wraps every artifact in a quilt. The `blobId` it returns is the quilt container (a 445 KB encoded blob), and the file itself is only readable through the per-file patch id (`result.id`, the blob id plus a suffix), which the store never records. So `RealWalrusStore.get(blobId)` returns quilt bytes, not the artifact, and anyone hashing "the blob" gets a hash that matches nothing on chain. `writeBlob` + `readBlob` round-trip byte-exact and the blob id is derived from the content, which is what the proof chain needs.

**Files:**
- Modify: `lib/walrus/real.ts`, `lib/walrus/real.test.ts`, `lib/walrus/store.ts` (only if the put options type needs a comment), `lib/engine/server.ts` (`createRuntimeRealWalrusStore`, lines 122-173)

**Interfaces:**
- `RealWalrusStore.put(bytes, options)` keeps its signature; `identifier` and `tags` are accepted and ignored (raw blobs carry no file metadata; note this in a comment). Returns `{ blobId, objectId, endEpoch }` from `client.walrus.writeBlob({ blob, epochs, deletable, owner, signer })` (`blobId`, `blobObject.id`, `blobObject.storage.end_epoch`).
- `RealWalrusStore.get(blobId)` uses `client.walrus.readBlob({ blobId })` and maps the SDK not-found error to `WalrusNotFoundError` exactly as today.
- `lib/engine/server.ts`: delete the duplicated store body and have `createRuntimeRealWalrusStore` dynamically import `../walrus/real` and call `createRealWalrusStore({ network: manifest.walrus.mode, baseUrl: readEnv(process.env.OPENVERDICT_SUI_GRPC_URL, manifest.suiRpcUrl), signer, epochs: manifest.walrus.epochs ?? 10 })`. The env override exists because some networks (this developer machine among them) cannot complete TLS to `*.sui.io`; `https://public-rpc.sui-testnet.mystenlabs.com` is the same fullnode under its CNAME target.

- [ ] **Step 1: Failing tests** in `lib/walrus/real.test.ts`: the existing tests mock the SDK; change the mocks so `writeBlob` and `readBlob` are what the store calls, assert `getFiles`/`writeFiles` are never called, assert a put followed by a get returns the identical bytes, and assert the not-found mapping.
- [ ] **Step 2: Implement** the store change and the `server.ts` dedupe. Keep `renew` unchanged.
- [ ] **Step 3: Gate**: `pnpm vitest run lib/walrus lib/engine/server.test.ts`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

### Task 6: Live rollout (manager only)

Environment facts for the rollout (verified 2026-08-29):
- Operator `0xff3538d7…9e1a` now holds 5.000 WAL (testnet) from the official exchange, tx `5wsBonnaCKCvtRJpoDjsjK62EgphV4U1AWbFYAKJwGm1`; before this it held none, so every hosted Walrus write would have failed.
- On this machine `*.sui.io` fails the TLS handshake ("wrong version number"); use `https://public-rpc.sui-testnet.mystenlabs.com` as the gRPC base URL for local scripts (`OPENVERDICT_SUI_GRPC_URL`). The hosted container reaches `fullnode.testnet.sui.io` normally (the app moved from Vercel to Railway on 2026-08-30).
- A raw testnet Walrus write of a 53-byte blob took about 29 s; a quilt write about 28 to 43 s.

- [x] Full gate: `pnpm test`, `pnpm test:move` (unchanged, sanity), `pnpm typecheck`, `pnpm lint`, `pnpm build`. (done 2026-08-29)
- [x] (done 2026-08-29; the database moved from Neon to Railway Postgres on 2026-08-30 and manifests are version 5 since 2026-08-30 21:33) `pnpm tsx scripts/publish-agent-manifests.ts --dry-run`, then live against testnet; verify 7/7 profiles carry the new `manifest_hash` via `sui_getObject`; run `scripts/seed-testnet-agents.ts` to confirm it reconstructs the same rows.
- [x] Redeploy (done; the app deploys on Railway since 2026-08-30) and confirm `/api/agents` shows the current manifest version and `/api/status` stays healthy.
- [x] (done 2026-08-29 late, see docs/STATUS.md) `scripts/testnet-canary.ts` with short explicit deadlines: full lifecycle with live GonkaRouter; inspect one sealed blob (pre-commit) and one revealed bundle; run the browser recompute on the report page.
- [ ] Update the checkpoint with the certificate id and blob ids.

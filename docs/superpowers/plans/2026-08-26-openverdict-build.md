# OpenVerdict Full Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (orchestrator dispatches Codex/Gemini workers per task, reviews every diff, runs every gate itself). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete OpenVerdict verification engine from `PRD.md` — Sui Move protocol package, TypeScript protocol/inference/evidence libraries, headless engine + CLI, workers, storage, and the read-only Next.js observer/fact-check frontend — runnable end-to-end against a local Sui network with a fake GonkaRouter adapter, and switchable to live GonkaRouter + Testnet via config.

**Architecture:** One repository, one root npm package (ESM), per PRD §27.5: `move/openverdict` (Sui Move package), `lib/*` (domain libraries), `cli/` (commander CLI), `workers/` (queue loops), `app/` (Next.js 16 App Router observer + fact-check UI + API routes), `config/` (release manifests). The engine is headless-first: the full claim lifecycle must complete via CLI with the frontend stopped (PRD §27.2 acceptance test).

**Tech Stack (verified against live registries/docs on 2026-08-26):**

| Dependency | Version | Notes |
| --- | --- | --- |
| node | 24.10.0 (local) | engines >=22 |
| pnpm | 11.8.0 | package manager |
| sui CLI | 1.52.2 | `sui move build/test`, localnet `sui start` |
| @mysten/sui | 2.26.2 | **v2: ESM-only, `SuiGrpcClient` from `@mysten/sui/grpc`, `network` param required, `getObject` THROWS if missing** |
| @mysten/walrus | 1.2.19 | client-extension: `client.$extend(walrus())`, `client.walrus.writeFiles/getFiles/getBlob` |
| @mysten/dapp-kit-core / -react | 1.6.18 / 2.1.20 | new dapp-kit v2 (web components + React hooks) |
| next | 16.3.3 | App Router |
| react / react-dom | 19.2.8 | |
| typescript | 5.9.3 | pinned 5.x (NOT 7.x) for Next/tooling compat |
| zod | 4.4.3 | zod v4 API |
| openai | 7.5.0 | OpenAI-compatible client → GonkaRouter `/v1/chat/completions` |
| tailwindcss | 4.3.3 | v4 CSS-first (`@import "tailwindcss"`) |
| vitest | 4.1.11 | TS tests |
| tsx | 4.23.12 | CLI/dev runner |
| drizzle-orm | 0.45.2 | Postgres dialect |
| @electric-sql/pglite | 0.5.7 | in-process Postgres for dev/tests (no docker needed) |
| pg | 8.23.0 | production driver |
| @noble/hashes | 2.3.0 | blake2b(32) == Sui `blake2b256` |
| commander | 15.0.0 | CLI |
| iconsax-react | 0.0.8 | icons (per user rules; NOT lucide) |

**Spec:** `PRD.md` (repo root, v3.1) — the plan argues from it; executors read both. `README.md` is the narrative summary.

## Global Constraints

- ESM everywhere: root `package.json` has `"type": "module"`; tsconfig `module`/`moduleResolution` = `"NodeNext"` for node code (Next app uses `"Bundler"` via its own tsconfig include).
- **Verified doc corrections that OVERRIDE the PRD:**
  1. `select_committee` (and any function taking `&Random`) MUST be a **private `entry fun`** — the Move compiler rejects `public fun` with `&Random`. Selection + JurySeat creation completes in ONE Move call (PTB restriction: only TransferObjects/MergeCoins may follow a Random MoveCall). Never accept a `RandomGenerator` parameter; build it internally with `random::new_generator(r, ctx)`.
  2. GonkaRouter (live-verified): base `https://api.gonkarouter.io`; OpenAI-compatible `POST /v1/chat/completions`, Anthropic-compatible `POST /v1/messages`; auth `x-api-key: <key>` or `Authorization: Bearer <key>`; response id looks like `msg_…`; **output hard cap 4096 tokens (default 3072 if omitted; requests >4096 silently clamped; reasoning tokens count toward it)** → adapter uses `max_tokens: 4096` and `GONKA_REQUEST_TIMEOUT_MS` default **120000** (PRD's 8000 is wrong for reasoning models); burst ≥200 concurrent / ≤1000 req/min → 5 parallel jury calls are safe; 429 does not bill, back off 30–60s.
  3. Known catalog model families (account catalog may use vendor-prefixed like `moonshotai/Kimi-K2.6` OR short ids like `kimi-k2-6` — resolve from release manifest, never hardcode in source): DeepSeek-V4-Flash, Kimi-K2.6, MiniMax-M2.7 — all support function calling. Three families satisfies the ≥3-model rule.
  4. @mysten/sui v2 API: `new SuiGrpcClient({ network, baseUrl })`; `keypair.signAndExecuteTransaction({ transaction, client, include })` returns `$kind` union (`'Transaction' | 'FailedTransaction'`); query methods are `listCoins/listEvents/listTransactions/getTransaction/getObject/getBalance`; local fullnode `http://127.0.0.1:9000`, local faucet `http://127.0.0.1:9123/v2/gas` (`requestSuiFromFaucetV2`).
  5. Sui system objects: Clock `0x6` (immutable ref), Random `0x8`.
- Move: edition `2024`. States/outcomes are `u8` constants — Outcome: `0=NONE, 1=YES, 2=NO, 3=UNSURE`; claim result additionally `4=UNRESOLVED`; ClaimMode: `1=DIRECT_REVIEW, 2=OPTIMISTIC_SETTLEMENT`. Claim states (u8): `0=CREATED, 1=PROPOSED, 2=CHALLENGED, 3=REVIEW_REQUESTED, 4=COMMIT_1, 5=REVEAL_1, 6=DISCUSSION, 7=COMMIT_2, 8=REVEAL_2, 9=FINALIZED_UNCHALLENGED, 10=FINALIZED_REVIEWED, 11=UNRESOLVED, 12=CANCELLED`. These exact codes are the BCS contract shared with TS (`lib/protocol/constants.ts`).
- Commitment: `blake2b256(BCS(VotePreimageV1))` — struct field order EXACTLY: `claim_id: ID, agent_profile_id: ID, jury_seat_id: ID, phase: u8, outcome: u8, confidence_bps: u16, evidence_root: vector<u8>, output_hash: vector<u8>, run_hash: vector<u8>, salt: vector<u8>` (PRD §22.1). TS mirror uses `bcs.Address` for `ID`, `bcs.vector(bcs.u8())` for `vector<u8>`.
- Truth Score (PRD §20.5): YES→`confidence_bps`, NO→`10000-confidence_bps`, UNSURE→`5000`; `truth_score_bps = (sum + floor(n/2)) / n` integer math over the FINAL valid round only; committee threshold = 4 matching valid votes of committee size 5 (denominator = committee size).
- Jury diversity (PRD §19.3): ≤1 seat per owner, ≤1 per human-backing hash, ≤2 per model id, ≥3 distinct models across 5 seats.
- Security invariants (PRD §28.8, §32) are acceptance criteria, not suggestions. Evidence retriever must pass the SSRF suite (PRD §33.5). No secrets/salts in logs. Models never receive keys or transaction authority.
- Comments: short, concise, helpful (user rule). No `Co-Authored-By` in any commit. **Do not git-commit — orchestrator handles VCS; user has not requested commits.**
- Icons: iconsax-react only. UI: shadcn/ui + Tailwind utilities, no custom CSS files beyond globals.
- Local doc digests for workers (read these, do not re-fetch): `.firecrawl/gonkarouter-docs.md`, `.firecrawl/gonkarouter-models.md`, `.firecrawl/sui-randomness.md`, `.firecrawl/sui-ts-sdk.md`, `.firecrawl/sui-v2-migration.md`, `.firecrawl/walrus-sdk.md`, `.firecrawl/dapp-kit.md`, `.firecrawl/mysten-llms.txt` (index of `.md`-suffixed doc URLs, fetchable if net available).

---

## File Structure (ownership map — workstreams touch ONLY their own paths)

```text
LICENSE                      T0 (orchestrator)  MIT
package.json, tsconfig*.json, next.config.ts,
postcss.config.mjs, vitest.config.ts,
components.json, .env.example, .gitignore,
docker-compose.yml           T0 (orchestrator)  — workers NEVER edit these
config/release.localnet.json T0
config/release.testnet.json  T0
move/openverdict/**          T1 (Codex WS-A)    Move package + tests
lib/protocol/**              T2 (Codex WS-B)    BCS schemas, hashing, constants, truth score
lib/gonka/**                 T2 (Codex WS-B)    GonkaRouter adapter + fake + zod schemas
lib/evidence/**              T3 (Codex WS-C)    safe retriever, canonicalize, merkle
lib/walrus/**                T3 (Codex WS-C)    WalrusStore iface, LocalWalrusStore, RealWalrusStore
lib/sui/**                   T5 (Codex WS-D)    clients, tx builders, event indexer helpers
lib/storage/**               T5 (Codex WS-D)    drizzle schema + repositories (pglite/pg)
lib/engine/**                T5 (Codex WS-D)    domain layer + resolution event log
lib/events/**                T5 (Codex WS-D)    ResolutionEvent types + SSE serialization/visibility
cli/**                       T5 (Codex WS-D)    commander CLI (bin: openverdict)
workers/**                   T5 (Codex WS-D)    evidence/inference/resolution workers (engine loops)
app/**                       T6 (Gemini WS-E)   Next.js routes, API handlers, components, observer
components/**                T6 (Gemini WS-E)   shadcn/ui generated + custom presentational
scripts/**                   T7 (orchestrator + Codex fixes)  localnet lifecycle E2E, deploy, parity vectors
tests/integration/**         T7                 cross-layer integration tests
README.md rewrite            T8 (orchestrator)  after everything works
```

## Interface Contracts (the cross-workstream API — breaking these fails review)

### C1. Move package `openverdict` — modules `agent_registry, claim, evidence, jury, settlement, demo_fact_checker, demo_binary_pool`

Structs/fields exactly per PRD §28.2–28.3 (Registry, EligibilityRecord, Reputation, AgentProfile, AgentCap, AdminCap, PauseCap, EvidenceCap, RunAttestorCap, EvidenceBundle, Committee, JurySeat, RoundTally, RunApproval, RevealedVote, ResolutionCertificate, Claim<T>) with these clarifications:

- `init` of the package creates + transfers `AdminCap, PauseCap, EvidenceCap, RunAttestorCap` to publisher and shares `Registry { version: 1, eligible_agents: vector[], paused: false }`.
- `select_committee<T>(registry: &Registry, claim: &mut Claim<T>, r: &Random, clock: &Clock, ctx: &mut TxContext)` is **`entry fun`** (not public); in one call: snapshot eligible agents, draw with `new_generator`, enforce diversity, create shared `Committee`, shared `RoundTally` (phase 1), and 5 owned `JurySeat`s transferred to agent owners + reserves; abort `E_INSUFFICIENT_DIVERSE_AGENTS` if constraints unsatisfiable after bounded draws (cap 64 draws).
- Reveal: `reveal_vote(seat: JurySeat, tally: &mut RoundTally, cap: &AgentCap, outcome: u8, confidence_bps: u16, output_hash: vector<u8>, run_hash: vector<u8>, salt: vector<u8>, argument_blob_id: vector<u8>, argument_blob_object_id: ID, argument_walrus_end_epoch: u64, clock: &Clock, ctx: &mut TxContext)`: recompute `blake2b256(bcs::to_bytes(&VotePreimageV1{...}))`, require == stored commitment, consume seat, create + freeze `RevealedVote`, append to tally (yes/no/unsure counts, `truth_probability_sum_bps`, `truth_probability_count`).
- `finalize_claim<T>` reads the phase's closed tally: 4-of-5 matching YES/NO → `FINALIZED_REVIEWED` w/ result; 4 UNSURE → result UNRESOLVED; else phase advance or UNRESOLVED terminal (PRD §17.12, §23); computes `truth_score_bps` from tally accumulators, creates + freezes `ResolutionCertificate`, creates `PayoutTicket<T>`s.
- Immutable-after-create: `EvidenceBundle`, `RevealedVote`, `ResolutionCertificate` via `transfer::public_freeze_object`.
- All events per PRD §28.5, exact names/fields. All error constants `const E...: u64` documented in one `errors` section per module.
- Public read accessors for the demo pool: `certificate_claim_id`, `certificate_result`, `certificate_package_version` (PRD §28.9).
- Full function list per PRD §28.4 (with the entry-fun correction above; time checks via `&Clock` + `clock.timestamp_ms()`).

### C2. `lib/protocol` (TS) exports

```ts
// constants.ts — MUST equal Move u8 codes (Global Constraints)
export const OUTCOME: { NONE: 0; YES: 1; NO: 2; UNSURE: 3 };
export const CLAIM_RESULT: { NONE: 0; YES: 1; NO: 2; UNSURE: 3; UNRESOLVED: 4 };
export const CLAIM_MODE: { DIRECT_REVIEW: 1; OPTIMISTIC_SETTLEMENT: 2 };
export const CLAIM_STATE: { CREATED: 0; PROPOSED: 1; /* … per Global Constraints */ };
// bcs.ts
export const VotePreimageV1Bcs: BcsType<…>; // field order per Global Constraints
export const RunRecordV1Bcs: BcsType<…>;    // per PRD §17.7 canonical run hash
export const ClaimIntentV1Bcs: BcsType<…>;  // per PRD §16.3
// hash.ts
export function blake2b256(bytes: Uint8Array): Uint8Array;           // @noble/hashes blake2b dkLen 32
export function computeVoteCommitment(p: VotePreimageV1): Uint8Array;
export function computeRunHash(r: RunRecordV1): Uint8Array;
// truthScore.ts
export function agentProbabilityBps(outcome: 1|2|3, confidenceBps: number): number;
export function computeTruthScoreBps(votes: Array<{outcome: 1|2|3; confidenceBps: number}>): number | null; // null when 0 valid
// types.ts: VotePreimageV1, RunRecordV1, ClaimIntentV1, AgentManifest (PRD §14.1), InferenceRunAudit (PRD §14.2)
```

### C3. `lib/gonka` exports

```ts
export interface GonkaRouterAdapter {            // PRD §20.8 exactly
  run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown>;
  normalizeResponse(response: unknown): Promise<{ gonkaRequestId: string; modelId: string; output: OracleInferenceOutput }>;
  validateOutput(output: OracleInferenceOutput, evidenceManifest: OracleInferenceInput['evidenceManifest']): Promise<void>;
  buildRunAudit(response: unknown): Promise<InferenceRunAudit>;
}
export function createGonkaAdapter(cfg: { baseUrl?: string; apiKey: string; timeoutMs?: number; maxRetries?: number }): GonkaRouterAdapter; // openai SDK, temperature 0, max_tokens 4096, response_format json_object w/ JSON-only-prompt fallback
export function createFakeGonkaAdapter(fixtures: FakeFixture[]): GonkaRouterAdapter;   // deterministic, offline
export const oracleInferenceInputSchema: z.ZodType<OracleInferenceInput>;   // PRD §20.3
export const oracleInferenceOutputSchema: z.ZodType<OracleInferenceOutput>; // PRD §20.4 + validation rules (strict, no extra keys, confidence 0..10000, evidence ids ⊆ manifest, 1..8 trace entries, byte caps)
```

Retry policy per PRD §31.5 (one retry on timeout/429/5xx, new visible attempt, never cross-model substitution). Log fields per §31.4; NEVER log key/salts/full prompts.

### C4. `lib/evidence` + `lib/walrus` exports

```ts
export interface RetrievalPolicy { maxBytes: number; maxRedirects: number; timeoutMs: number; allowedMime: string[] }
export function retrieveEvidence(url: string, policy: RetrievalPolicy): Promise<RetrievedArtifact | RetrievalRejection>; // SSRF-safe per PRD §21.2 — https-only, DNS resolve + block loopback/private/link-local/metadata/reserved ranges, re-validate EVERY redirect hop, size/time caps, MIME allowlist, no JS execution
export function canonicalizeHtml(bytes: Uint8Array): { text: string; parserVersion: string };
export function buildEvidenceManifest(items: EvidenceManifestItem[]): { root: Uint8Array; manifestJson: string }; // Merkle over blake2b256(BCS leaf), sorted by evidenceId; leaf BCS struct EvidenceLeafV1 { evidence_id: vector<u8> (utf8), content_hash: vector<u8>, canonical_hash: vector<u8> }
export interface WalrusStore { put(bytes: Uint8Array, opts?): Promise<{ blobId: string; objectId?: string; endEpoch?: number }>; get(blobId: string): Promise<Uint8Array>; }
export function createLocalWalrusStore(dir: string): WalrusStore;   // fs-backed, blobId = base64url(blake2b256(bytes)) — offline dev/test
export function createRealWalrusStore(cfg): WalrusStore;            // @mysten/walrus client extension per .firecrawl/walrus-sdk.md
```

### C5. `lib/engine` exports (consumed by CLI, workers, and app API routes)

```ts
export function createEngine(cfg: EngineConfig): Promise<Engine>;
export interface EngineConfig { network: 'localnet'|'testnet'|'mainnet'; manifestPath: string; db: DbHandle; walrus: WalrusStore; gonka: GonkaRouterAdapter; suiClient: SuiGrpcClient; signers: SignerRegistry }
export interface Engine {
  factCheckStart(req: FactCheckRequest): Promise<{ claimId: string }>;
  claimCreate(req: ClaimCreateRequest): Promise<{ claimId: string; digest: string }>;
  propose(claimId: string, outcome: 1|2|3): Promise<TxResult>;
  challenge(claimId: string, reasonFile: ChallengeReason): Promise<TxResult>;
  selectCommittee(claimId: string): Promise<TxResult>;
  evidenceFreeze(claimId: string, phase: 1|2): Promise<TxResult>;
  juryRun(claimId: string, phase: 1|2): Promise<JuryRunReport>;   // 5 agents through GonkaRouterAdapter, run audits, RunApprovals
  votesCommit(claimId: string, phase: 1|2): Promise<TxResult[]>;
  votesReveal(claimId: string, phase: 1|2): Promise<TxResult[]>;
  advance(claimId: string): Promise<TxResult | null>;
  finalize(claimId: string): Promise<FinalizeReport>;
  inspect(claimId: string, opts?: { verify?: boolean }): Promise<ClaimInspection>;
  report(claimId: string): Promise<FactCheckReport>;              // PRD §26.9 JSON audit bundle
  events(claimId: string, fromSequence?: number): AsyncIterable<ResolutionEvent>;
}
```

`ResolutionEvent` exactly per PRD §29.12 including `visibility: 'PUBLIC_NOW'|'PUBLIC_AFTER_REVEAL'|'INTERNAL_REDACTED'` with serialization-time filtering (pre-reveal leaks are test failures).

### C6. Storage (drizzle, pglite dev / pg prod)

Tables (PRD §30 subset, snake_case): `claims, committees, jury_seats, round_tallies, evidence_submissions, evidence_artifacts, evidence_manifests, inference_runs, tool_calls, run_approvals, vote_packages, reveals, resolution_certificates, resolution_events, agent_manifests, payout_tickets`. Export `createDb(opts: { url?: string })` → pglite when no url, pg Pool otherwise; `migrate(db)` runs idempotent DDL.

### C7. HTTP API (app/api, thin handlers over Engine/storage)

Per PRD §29: `POST /api/fact-checks`, `POST/GET /api/claims`, `GET /api/claims/[id]`, `POST /api/evidence`, `GET /api/evidence/[id]`, `GET /api/inferences/[runId]`, `GET /api/agents`, `GET /api/status`, `GET /api/claims/[id]/events` (SSE w/ `Last-Event-ID` replay + JSON snapshot `?snapshot=1`). Engine access from routes via a singleton `getServerEngine()` helper exported from `lib/engine/server.ts` (WS-D provides it; WS-E imports it — the ONLY app→lib coupling point).

### C8. Config

`config/release.localnet.json` / `release.testnet.json`: `{ network, packageId, registryObjectId, clockObjectId: "0x6", randomObjectId: "0x8", coinType, walrus: { mode: "local"|"testnet", localDir? }, gonka: { baseUrl, models: string[], mode: "fake"|"live" }, explorerTxTemplate }`. `.env.example` documents `GONKA_ROUTER_API_KEY`, `GONKA_ROUTER_BASE_URL`, `DATABASE_URL`, `SUI_*` per PRD §35.2. Secrets only via env; manifests contain no secrets.

---

## Tasks

### Task 0 (T0, orchestrator): Repo scaffold — configs, license, deps

**Files:** LICENSE, .gitignore, package.json, tsconfig.json, tsconfig.node.json, next.config.ts, postcss.config.mjs, vitest.config.ts, app/{layout,page,globals.css} placeholder, components.json (shadcn), config/release.*.json, .env.example, docker-compose.yml, `move/` via `sui move new openverdict`.

- [ ] MIT LICENSE (holder: `Marcussy34 and OpenVerdict contributors`, year 2026)
- [ ] package.json: `"type": "module"`, engines node >=22, all deps from the version table, scripts: `dev,build,start,lint,typecheck,test,test:move,cli,e2e:localnet`
- [ ] `pnpm install` clean; `sui move new openverdict` under `move/`; `pnpm dlx shadcn@latest init` + baseline components (button,card,badge,tabs,table,separator,skeleton,alert,input,textarea,dialog,scroll-area,tooltip)
- [ ] Verify gates: `pnpm typecheck` and `pnpm build` pass on the empty shell; `sui move build` passes on the empty Move package.

### Task 1 (T1 = WS-A, Codex): Sui Move package

**Files:** `move/openverdict/sources/{agent_registry,claim,evidence,jury,settlement,demo_fact_checker,demo_binary_pool}.move`, `move/openverdict/tests/*.move`, `Move.toml`.
**Interfaces:** Produces C1. Consumes nothing.
**Steps (worker-internal TDD):** for each module: write `sui move test` scenario tests first (creation validation, illegal transitions abort, deadline ±1ms boundaries, commit/reveal match+mismatch, 4-of-5 threshold incl. UNSURE and unresolved paths, truth-score vectors incl. rounding, payout one-time consumption, pause behavior, capability misuse, randomness bounds via test-only Random) then implement until green. Coverage targets per PRD §33.1/33.3.
**Gate (orchestrator):** `cd move/openverdict && sui move build 2>&1 | grep -ci error` == 0 and `sui move test` all pass; review full diff.

### Task 2 (T2 = WS-B, Codex): TS protocol core + GonkaRouter adapter

**Files:** `lib/protocol/**`, `lib/gonka/**`, colocated `*.test.ts`.
**Interfaces:** Produces C2 + C3. Consumes C2 constants internally.
**Steps:** TDD with vitest: BCS byte-exactness tests (hand-computed small vectors), blake2b256 against a known test vector, truth-score table incl. rounding + null case, zod schema acceptance/rejection fixtures per PRD §33.4 (malformed JSON, unknown outcome, invented evidence id, extra fields, >8 trace entries, confidence bounds), fake adapter determinism, retry-visible-attempts behavior with mocked fetch (429/5xx/timeout), no-key-in-logs assertion.
**Gate:** `pnpm vitest run lib/protocol lib/gonka` green; review diff.

### Task 3 (T3 = WS-C, Codex): Evidence service + Walrus store

**Files:** `lib/evidence/**`, `lib/walrus/**`, colocated tests.
**Interfaces:** Produces C4. Consumes C2 (`blake2b256`, BCS leaf helper) — import from `lib/protocol`.
**Steps:** TDD: SSRF suite per PRD §33.5 (private-IP + metadata URLs, redirect-to-private, redirect loops, oversized/compressed bombs, MIME rejects, duplicate content, injection-html canonicalization, reproducible roots) using a local test http server; LocalWalrusStore round-trip; RealWalrusStore compiled + type-checked behind config (no live network in tests).
**Gate:** `pnpm vitest run lib/evidence lib/walrus` green; review diff.

### Task 4 (T4, orchestrator): TS↔Move parity vectors

**Files:** `scripts/gen-parity-vectors.ts`, `move/openverdict/tests/parity_tests.move` (append-only), `tests/integration/parity.test.ts`.

- [ ] Generate ≥6 VotePreimageV1 vectors (varied outcomes/salts/roots) + expected blake2b256 via TS; embed the same literals in a Move test asserting `compute_commitment` equality; run both suites.
**Gate:** both `sui move test` and vitest pass on identical bytes. This is the cryptographic contract test — hard requirement before T5.

### Task 5 (T5 = WS-D, Codex): Engine, storage, Sui client layer, CLI, workers

**Files:** `lib/sui/**`, `lib/storage/**`, `lib/engine/**`, `lib/events/**`, `cli/**`, `workers/**`, tests.
**Interfaces:** Produces C5 + C6 + `getServerEngine()`; consumes C1 (deployed package via manifest), C2, C3, C4.
**Steps:** storage schema + repos (pglite tests) → sui tx builders for every C1 entry function (Transaction API, per-function unit tests against BCS of built tx where feasible) → engine lifecycle orchestration with fake adapter + LocalWalrus + pglite (unit tests per phase; deadline/idempotency; NO_VALID_INFERENCE exclusion; phase-gated event visibility tests) → CLI commands mapping 1:1 to Engine (PRD §27.3 list, `--json` NDJSON, non-zero exit codes, confirmation output showing network/package/objects/signer) → workers as thin loops over engine queues.
**Gate:** `pnpm vitest run lib tests` green, `pnpm typecheck` green; CLI `openverdict --help` renders all commands; review diff.

### Task 6 (T6 = WS-E, Gemini): Next.js observer + fact-check UI

**Files:** `app/**` (all routes per PRD §26.1 incl. api handlers per C7), `components/**`.
**Interfaces:** Consumes C5 via `getServerEngine()` and C7 shapes; produces the read-only UI.
**Steps:** implement `/` + `/fact-check` (form → POST /api/fact-checks → live report page), `/claims/[id]` timeline (PRD §26.3), `/claims/[id]/observe` (5 agent lanes + phase rail, SSE consumption with reconnect cursor, strict pre-reveal redaction — render ONLY what the event stream provides), `/agents`, `/agents/[id]`, `/evidence/[id]`, `/verify` (recompute hashes client-side via lib/protocol), `/status`, `/learn`, `/terms`, `/privacy`, `/risk` (static content from PRD), experimental labels everywhere, `Not independently reviewed` state for score-less claims. shadcn/ui + Tailwind + iconsax-react. Dashboard has NO signer and NO mutation calls other than the two POST entry forms (fact-check submit, evidence submit).
**Gate:** `pnpm build` green; `pnpm typecheck` green; route-by-route render check; review diff.

### Task 7 (T7, orchestrator + Codex fixes): Localnet end-to-end

**Files:** `scripts/localnet-e2e.ts`, `scripts/deploy-localnet.ts`, `tests/integration/**`.

- [ ] `sui start --with-faucet --force-regenesis` (background) → deploy package → write `config/release.localnet.json` with real ids → register 5 agents (5 local keypairs) → run FULL direct-review lifecycle via CLI with fake adapter (evidence freeze → jury run → commit → reveal → threshold → certificate) → recompute Truth Score off-chain and assert equality → demo_binary_pool settle + payout ticket withdraw → PRD §27.2 acceptance: dashboard stopped throughout; then boot app and verify `/claims/[id]` reconstructs the timeline.
- [ ] Split-vote path: fixture forcing 3–2 → discussion → phase 2 → 4–1 finalize. Unresolved path: forced no-threshold → UNRESOLVED + refunds.
**Gate:** `pnpm e2e:localnet` exits 0 with both paths.

### Task 7b (T7b, Codex, after T5+onboarding merge): zkLogin-backed agent registration

**Decision (2026-08-27, user-directed):** close part of the DIVE human-backing gap Sui-natively. Under one OAuth `aud` with a fixed salt service (Enoki), one social account derives exactly ONE zkLogin address (addr from iss+aud+sub+salt; doc-verified). Registration flow: agent owner authenticates via zkLogin → server verifies the zkLogin signature (GraphQL `verifyZkLoginSignature` endpoint — doc-verified) → `human_backing_hash = blake2b256(zkLogin address)` → existing Move rule "one committee seat per human_backing_hash" enforces **one social account = one seat** on-chain, no schema change.
**Honest labeling (PRD §14.4 guardrail):** this raises Sybil cost (accounts, not keypairs), it is NOT proof-of-personhood — one human can hold multiple Google accounts. UI label `ZKLOGIN_BACKED`, never "verified human". Demo path: the 5 allowlist agents register with zkLogin-derived backing hashes to demonstrate the mechanism live.
**Files:** lib/engine (registration path) + app registration page section + README/judge-defence lines.

### Task 8 (T8, orchestrator): Docs, env, release manifests, final review — EXPANDED

- [ ] **Public deployment (user-directed, 2026-08-27):** Railway as primary target — one persistent service runs Next.js + engine singleton + workers with managed Postgres (`DATABASE_URL`), which our SSE streams, background workers, and process-wide engine need; Vercel's serverless model breaks all three (no persistent process, pglite non-durable). Steps: Railway project + Postgres, env config (operator key, manifest=testnet, GONKA key when available), deploy, verify /status + live fact-check; publish URL in README. Observer-only Vercel deploy is the fallback if Railway blocks.

- [ ] README: add real Getting Started (install, localnet e2e, live-mode env), architecture pointers, limitations; keep PRD as spec of record.
- [ ] `.env.example` complete; docker-compose (postgres) optional-but-working; `openverdict fact-check start` documented with a sample `fact-check.json`.
- [ ] Full verification sweep (superpowers:verification-before-completion): typecheck, lint, vitest, move tests, build, e2e:localnet — all green, outputs captured.

### Task 8a (T8a, REQUIRED — promoted from optional 2026-08-27): Testnet deploy + public canary

Faucet SUI is free — no user input needed. Publish the package to Sui Testnet, create registry + caps, register the 5 demo agents, write real ids into config/release.testnet.json, run ONE full direct-review canary lifecycle (fake adapter unless the Gonka key is present), verify certificate + Display rendering on a public explorer, and put the explorer links in the README. This is the DIVE-parity "live on a public network" bar. Ordering: after T7 passes, before Railway.

### Task 8b: Live GonkaRouter smoke — REQUIRED FOR SUBMISSION, user-key-gated

Not optional (reclassified 2026-08-27): the Gonka track requires real Request IDs in the demo. Blocked ONLY on `GONKA_ROUTER_API_KEY` (user provides; new accounts get free credit at gonkarouter.io/dashboard). When present: run one jury round in live mode on testnet, capture 5 real `msg_…` ids across ≥3 model families, keep the audit bundle.

### Task 9 (T9, new 2026-08-27): Demo & submission package

- [ ] Prepared demo claim per PRD §36.1/§36.3: one completed lifecycle preserved on Testnet with all digests/objects/blob ids recorded in a `docs/demo/` runbook.
- [ ] `/fact-check` live URL (Railway, from T8) + README demo instructions + downloadable JSON audit bundle link.
- [ ] Video script doc following the PRD §36.6 110-second timing (recording itself = user task).
- [ ] Optional stretch: optimistic propose→challenge E2E path (already contract-tested in Move; an E2E demo of it is polish, not a gate).
- [ ] Mainnet canary: explicitly USER-GATED (real SUI + native USDC funding decision per PRD §33.9); Testnet is the demo network until the user funds mainnet.

## Self-Review (spec coverage)

- PRD §14–§25 protocol semantics → T1/T2/T5. §20 inference → T2/T5. §21 evidence → T3. §26 UX → T6. §27 architecture/CLI → T5. §28 Move → T1. §29 API → T5/T6. §30 data → T5. §31 Gonka → T2. §32 security → gates in T1/T3/T5/T6. §33 testing → per-task gates + T4 + T7. §34 events → T5 (`lib/events`). §35 deploy → T7 scripts + T8. §36 demo → T7 fixtures. Not in scope (explicitly deferred, PRD P1): sponsored transactions, zkLogin, multi-attestor approvals, notifications, mainnet canary — recorded in README limitations.
- Placeholder scan: none — worker prompts must carry the concrete specs above.
- Type consistency: C2 constants are the single source for u8 codes; C5 signatures use C2/C3/C4 types; T6 imports only `getServerEngine` + types.

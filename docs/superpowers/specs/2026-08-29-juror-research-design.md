# Juror research v1: independent, recorded, citable

> Design spec, 2026-08-29. Approved in chat by the product owner ("go ahead with
> your plan"). Companion plan: `docs/superpowers/plans/2026-08-29-juror-research.md`.
> Builds on proof chain v2 (`docs/superpowers/plans/2026-08-29-proof-chain-v2.md`).

## 1. Goal

Every juror run researches the claim on its own: it searches the web, opens
pages, and answers with citations (URL plus quote). Every step is executed by
the engine, recorded, hashed into the on-chain run hash, sealed before the
commit, and published at reveal. A citation is valid only if that juror
actually opened that page during its run and the quote exists in the stored
page text. The model never fetches anything itself and never sees a key.

The product sentence the prompt embodies: "Research independently. Cite
sources with URLs." Nothing else is added to the system prompt beyond the
action protocol and the answer schema.

## 2. Non-goals (v1)

- Native OpenAI tool calling (`tools` / `tool_calls`). The loop uses plain JSON
  actions so it works on every GonkaRouter model that already honours the JSON
  output contract.
- Crawling whole sites, screenshots, page actions, browser automation.
- Shared pre-freeze discovery (one search for all jurors). May come later as a
  baseline; it is not what "research independently" means.
- Self-hosted Firecrawl. Supported by configuration only (`FIRECRAWL_API_URL`).
- Reputation, Move changes, new on-chain fields. None are needed.

## 3. Architecture in one paragraph

`juryRun` (inference worker) no longer makes one model call per seat. For each
seat it runs a **research loop**: system prompt (prompt spec v2 plus the tool
policy budgets) and the frozen input, then a conversation in which the model
emits exactly one JSON action per turn (`search`, `open`, `answer`). The engine
executes `search` and `open` through a `ResearchProvider` (Firecrawl v2 REST,
cloud today), stores every opened page on Walrus as a `DISCOVERED` evidence
artifact, appends the compact tool result to the conversation, and continues
until `answer` or the budget ends. The final answer is validated (schema,
evidence ids, citations) with one repair round, then the run is recorded
exactly like today: audit, run hash (now with a real `tool_transcript_hash`),
sealed bundle core (now including the transcript), `approve_run`, commit,
reveal.

## 4. Components

### 4.1 `lib/research/provider.ts`: the `ResearchProvider` seam

```ts
export type SearchResult = {
  rank: number;            // 1-based position in the provider response
  url: string;             // absolute http(s) URL as returned
  title: string;           // trimmed, max 200 chars
  snippet: string;         // trimmed, max policy.snippetChars
  publishedAt?: string;    // ISO date if the provider supplies one
};

export type OpenedPage = {
  url: string;             // requested URL
  finalUrl: string;        // provider-reported source URL after redirects
  title?: string;
  markdown: string;        // main-content markdown, untruncated
  fetchedAtMs: number;
  statusCode?: number;
};

export interface ResearchProvider {
  readonly name: "firecrawl" | "fake";
  readonly mode: "cloud" | "selfhost" | "fake";
  search(query: string, options: { limit: number; timeoutMs: number }): Promise<SearchResult[]>;
  open(url: string, options: { timeoutMs: number }): Promise<OpenedPage>;
}
```

`FirecrawlProvider` (`lib/research/firecrawl.ts`) calls `POST {base}/v2/search`
with `{ query, limit, sources: ["web"], timeout }` and reads `data.web[]`
(`title`, `description`, `url`); and `POST {base}/v2/scrape` with
`{ url, formats: ["markdown"], onlyMainContent: true, timeout }` and reads
`data.markdown`, `data.metadata.title`, `data.metadata.sourceURL`,
`data.metadata.statusCode`. Auth header `Authorization: Bearer <key>`. Base URL
default `https://api.firecrawl.dev`, override `FIRECRAWL_API_URL`; `mode` is
`cloud` when the base host is `api.firecrawl.dev`, else `selfhost`. Errors map
to `ResearchProviderError` with `{ kind: "http" | "network" | "timeout" | "empty", status? }`.
The provider never logs URLs together with the key; the key never appears in
any record. `fetch` is injectable for tests.

`FakeResearchProvider` (`lib/research/fake.ts`) is deterministic: `search(q)`
returns `policy.resultsPerSearch` results with urls
`https://fake.evidence.test/<slug(q)>/<rank>`, titles `Result <rank> for <q>`,
snippets derived from the query; `open(url)` returns markdown
`# <title>\n\nFake page for <url>. <sentence repeated to ~2,000 chars>` so
quote checks and slicing are exercised. Unknown hosts throw `network` errors.

### 4.2 `lib/research/actions.ts`: the action protocol

The model's reply must be exactly one JSON object:

```ts
type SearchAction = { action: "search"; query: string };            // 3..200 chars
type OpenAction   = { action: "open"; url: string; from?: number };  // from >= 0 integer, default 0
type AnswerAction = { action: "answer"; output: OracleInferenceOutput }; // see 4.5
```

Zod schemas are strict (no extra keys). Parsing uses the existing
`extractJsonObject` so fenced or prefixed JSON still parses. Anything else is
an invalid turn (see 4.4 repair rules).

Tool results are appended as `user` messages (never `tool` role, for provider
compatibility) with exactly this JSON, canonical key order:

```ts
{ tool: "search", query, results: [{ n, title, url, snippet, publishedAt? }] }
{ tool: "open", url, evidenceId, from, chars, totalChars, truncated: boolean, text }
{ tool: "error", code: "BUDGET_SEARCHES" | "BUDGET_OPENS" | "URL_NOT_SEEN" | "OPEN_FAILED" | "SEARCH_FAILED" | "INVALID_ACTION", message }
```

`text` is the slice `[from, from + policy.pageSliceChars)` of the stored
canonical page text (see 4.3). `URL_NOT_SEEN`: the model may only open a URL
that appeared in an earlier search result of this run or in the submitter's
`submittedUrls`; anything else is refused (prevents invented URLs and keeps the
loop goal-directed). Refusals and failures count as turns but not against the
search/open budgets, except that a failed provider call still consumes the
budget unit (so a broken site cannot grant unlimited retries).

### 4.3 Discovered evidence and the per-claim cache

Opening a page persists it as an evidence artifact with
`sourceClass: "DISCOVERED"` (new member of `EvidenceSourceClass`), through the
same canonicalisation used for submitted URLs where possible: the provider's
markdown is the canonical text (`parserVersion: "firecrawl-markdown-v1"`),
`contentHash = blake2b256(markdown bytes)`, `canonicalHash` identical, raw and
canonical Walrus uploads identical bytes (one upload, both ids equal), `excerpt`
first 500 chars, `title` from metadata. Canonical text is capped at
`policy.maxPageChars` before hashing so a 5 MB page cannot bloat Walrus; the
cap is recorded (`truncated: true`).

Identity: `evidenceId = deterministicId("discovered:" + claimId + ":" + phase + ":" + normalizedUrl)`
where `normalizedUrl` lowercases scheme and host and strips a trailing slash
and fragment. The submission row uses `sourceClass: "DISCOVERED"` and
`sourceUrl: normalizedUrl`. Both rows get `phase` = the run's phase.

Per-claim cache: `open` first looks up the artifact by `evidenceId`; a hit
returns the stored text without a provider call (still records a transcript
step with `cached: true`). Searches are cached in memory for the duration of
one `juryRun` call keyed by `(phase, normalized query)` with in-flight promise
sharing, so parallel seats issuing the same query get identical results.

Origin tracking: every opened page in a run is tagged `origin: "SEARCH"` (URL
came from a search result of this run) or `origin: "SUBMITTED"` (URL came from
`submittedUrls`). Only `SEARCH` pages count as independent evidence.

Listing rules: `artifactsForPhase` (frozen manifest and model input) and the
observer's claim evidence lists exclude `DISCOVERED` artifacts. They are
reachable by id (from revealed bundles) on `/evidence/[id]`. The
`evidence_artifacts` table gains `source_class TEXT` (nullable; null reads as
`USER_SUBMITTED`).

### 4.4 `lib/research/loop.ts`: the loop runner

```ts
export async function runResearchLoop(deps: {
  complete: GonkaCompletion;          // adapter primitive, 4.6
  provider: ResearchProvider;
  policy: ToolPolicyV2;
  spec: PromptSpecV2;
  input: OracleInferenceInput;        // frozen, same as today
  manifest: AgentManifest;
  pages: PageStore;                   // open/persist/lookup DISCOVERED pages (engine-provided)
  searchCache: SearchCache;           // per juryRun
  now: () => number;
}): Promise<ResearchLoopResult>;
```

Turn algorithm (`maxTurns` from the policy, default 8):

1. Messages start as `[system: composeSystemPrompt(spec, policy), user: canonicalJson(input)]`.
2. Call `complete` (JSON mode; JSON-prompt fallback on `response_format`
   unsupported, exactly like today's `run`). Parse one action.
3. `search`: budget check, cache or provider call, append tool result, record
   step. `open`: seen-URL check, budget check, page store (cached or provider),
   append the slice, record step. `answer`: validate (4.5); valid → done;
   invalid → one repair turn (repair system prompt plus the validation errors
   plus the invalid content), then fail closed.
4. Invalid action JSON: one repair turn as above; a second invalid turn fails
   closed (`INVALID_SCHEMA`).
5. Turn `maxTurns - 1` without an answer: the engine appends
   `{ tool: "error", code: "BUDGET_TURNS", message: "Answer now." }` and the
   final turn must be `answer`, else fail closed.
6. Provider (model) failures use the existing visible retry (max 1) and
   `PROVIDER_ERROR` / `TIMEOUT` statuses; the whole loop has a wall-clock cap
   `policy.maxLoopMs` (default 600,000 ms), after which the run fails closed
   with `TIMEOUT`.

The result carries: `attempts` (one `GonkaAttemptRecord` per model call, as
today), the final `ProviderRequestRecord` (its `messages` are the entire
conversation, so the bundle records literally what the model saw),
`response` (final raw completion), `gateway`, `output`, `transcript` (4.7),
`opened` pages, and `citationChecks`.

### 4.5 Answer contract and citation rules

`OracleInferenceOutput` gains `citations: Array<{ evidenceId, url, quote }>`
(type-optional for old fixtures, required by the loop validator; quote 20 to
300 chars). Validation order, all errors reported together for the repair turn:

1. Existing schema rules (outcome, confidence, trace 1..8, reasoning length).
2. Evidence ids in `evidenceFor`, `evidenceAgainst`, `unsupportedClaims`,
   `decisiveEvidence`, trace entries, and citations must be in the union of the
   frozen manifest ids and the ids of pages opened in this run.
3. Citations reference opened pages only: every citation's `evidenceId` must
   be in `transcript.opened` for this run (a submitter URL the juror opens
   becomes an opened page with `origin: "SUBMITTED"` and its own
   `discovered:` id; the frozen `url:` artifact ids stay usable in the
   evidence arrays but not in citations); `url` must equal that page's `url`
   or `finalUrl`; `quote` is checked against the stored canonical text after
   whitespace collapsing, case-insensitive. Since 2026-08-30 a quote that is
   not found no longer fails the seat: the engine blanks it in the validated
   output (the citation stays a verified URL) and the transcript keeps the
   claimed quote with `found: false`; the verifier requires a found quote
   only for citations that still carry one.
4. Independence: `outcome` `YES` or `NO` requires at least one citation whose
   page has `origin: "SEARCH"`. `UNSURE` needs no citation.
5. `decisiveEvidence`, when non-empty, must contain at least one cited id.

Procedural guard (added 2026-08-30 after three of five hosted seats answered
from memory with invented citations): a `YES` or `NO` answered before any
page with `origin: "SEARCH"` has been opened is refused before validation
with the `RESEARCH_REQUIRED` tool error (message names the independence
rule and tells the model to search, open, then answer). At most two such
refusals per run, each consuming a turn; afterwards the answer goes through
the normal validation and repair path above. `UNSURE` is never refused, and
an answer on the last turn is validated as usual.

Failure after the repair turn fails the seat closed with status
`CITATION_INVALID` (new `InferenceRunStatus` member, treated like
`INVALID_SCHEMA` everywhere: no vote, `NO_VALID_INFERENCE` reporting).

### 4.6 Gonka adapter primitive

`GonkaRouterAdapter` gains:

```ts
complete(request: {
  manifest: AgentManifest;
  messages: Array<{ role: "system" | "user"; content: string }>;
  kind: GonkaAttemptKind;             // PRIMARY | RETRY | JSON_PROMPT_FALLBACK | REPAIR
  jsonMode: boolean;
  spec: PromptSpecV2;                 // temperature, max tokens, response format
  attempts: GonkaAttemptRecord[];     // shared, appended in place
  input: OracleInferenceInput;        // for attempt audits
}): Promise<
  | { ok: true; response: unknown; request: ProviderRequestRecord; gateway: GatewayResponseMeta; content: string; gonkaRequestId: string }
  | { ok: false; error: unknown; responseFormatUnsupported: boolean }
>;
```

It is the existing `executeProviderRequest` plus request-id and model checks
lifted out of `run` (duplicate request ids, model mismatch, missing id are
`PROVIDER_ERROR` attempts exactly as now). `run` stays for the old single-shot
path and its tests; the engine stops calling it. The fake adapter implements
`complete` by replaying scripted actions: `FakeFixture.actions?: FakeAction[]`
(default `[{ search: "<claim statement>" }, { open: "<first result url>" }]`)
followed by an answer that cites the first opened page with a quote taken
from its text. The fake keeps its failure modes (`malformed_json`,
`invented_evidence_id`, ...) and adds `bad_citation` (quote not in page) and
`no_independent_citation` (YES with only a submitted-page citation).

### 4.7 Prompt spec v2, tool policy v2, manifest document v3

```ts
export type PromptSpecV2 = {
  version: "2";
  providerId: "gonkarouter";
  systemPrompt: string;        // protocol + answer schema; starts with the product sentence
  jsonFallbackSuffix: string;
  repairSystemPrompt: string;
  temperature: 0;
  maxOutputTokens: 4096;
  responseFormat: "json_object";
};

export type ToolPolicyV2 = {
  version: "2";
  tools: ["search", "open"];
  provider: "firecrawl";
  maxSearches: number;      // default 3
  maxOpens: number;         // default 4
  maxTurns: number;         // default 8
  resultsPerSearch: number; // default 5
  snippetChars: number;     // default 200
  pageSliceChars: number;   // default 6000
  maxPageChars: number;     // default 60000
  maxLoopMs: number;        // default 600000
};
```

`DEFAULT_TOOL_POLICY_V2` fixes the defaults above; any other values change the
hash and therefore the manifests. `OracleInferenceInput.promptVersion` becomes
`"2"` (the input schema literal is widened to `"1" | "2"`).

`promptSpecHash(spec) = blake2b256(canonicalJson(spec))` unchanged in form;
`toolPolicyHash = blake2b256(canonicalJson(policy))`. The composed system
message is `spec.systemPrompt + "\n" + canonicalJson({ budgets: policy })`, so
a verifier recomputes it from the two hashed documents.

`AgentManifestDocumentV3` = V2 fields with `version: "3"`, `promptSpec:
PromptSpecV2`, `toolPolicy: ToolPolicyV2`. `parseAgentManifestDocument` accepts
v2 or v3 (discriminated union); every producer (engine zk registration,
publish/seed/canary/e2e/cockpit scripts) emits v3. `juryRun` fails closed
unless every seat's `promptHash` equals `promptSpecHash(DEFAULT_PROMPT_SPEC_V2)`
and `toolPolicyHash` equals `toolPolicyHash(DEFAULT_TOOL_POLICY_V2)` (the
tool policy check is new).

### 4.8 Transcript, run hash, bundle core v3

```ts
export type ResearchTranscriptV1 = {
  version: 1;
  runId: HexString;
  provider: { name: string; mode: string };
  policyHash: HexString;
  steps: Array<{
    index: number;                       // 0-based
    turn: number;                        // model turn that produced the action
    startedAtMs: number;
    completedAtMs: number;
    modelRequestId: string;              // gonkaRequestId of that turn
    action: SearchAction | OpenAction | AnswerAction | { action: "invalid"; content: string };
    result:
      | { tool: "search"; cached: boolean; resultsHash: HexString; results: SearchResult[] }
      | { tool: "open"; cached: boolean; evidenceId: string; origin: "SEARCH" | "SUBMITTED"; from: number; chars: number; totalChars: number; contentHash: HexString; canonicalWalrusBlobId: string }
      | { tool: "error"; code: string; message: string }
      | { tool: "answer"; valid: boolean; errors: string[] };
  }>;
  opened: Array<{ evidenceId: string; url: string; finalUrl: string; origin: "SEARCH" | "SUBMITTED"; title?: string; contentHash: HexString; canonicalHash: HexString; canonicalWalrusBlobId: string; totalChars: number; truncated: boolean }>;
  citations: Array<{ evidenceId: string; url: string; quote: string; found: boolean }>;
  counts: { searches: number; opens: number; turns: number };
};
```

`tool_transcript_hash = blake2b256(canonicalJson(transcript))`,
`tool_call_count = counts.searches + counts.opens`. Both already live in
`RunRecordV1`, so the on-chain run hash now binds the whole research trail
without a Move change. The engine no longer uploads a `"[]"` tool blob; the
on-chain `tool_blob_id` / `tool_blob_object_id` cite the **sealed bundle blob**
(Move only requires non-empty ids), because the transcript is inside the
sealed core and must not be public before reveal.

`PublicRunBundleCoreV3` = V2 core with `version: 3`, plus `toolPolicy`,
`toolPolicyHash`, `transcript`, and `verify.toolTranscriptHash:
"blake2b256(canonicalJson(transcript))"`, `verify.systemPrompt:
"promptSpec.systemPrompt + \"\\n\" + canonicalJson({budgets: toolPolicy})"`.
Sealing, reveal publication, `runProof`, and `agentManifestDocument` are
unchanged in flow; types widen to `V2 | V3`.

### 4.9 Engine integration

- `EngineConfig.research?: ResearchProvider`. Live Gonka mode without a
  provider fails closed in `juryRun` (`EngineValidationError: research provider
  not configured`); fake Gonka mode defaults to `FakeResearchProvider`.
- `server.ts`: `FirecrawlProvider` from `FIRECRAWL_API_KEY` (required when
  `gonka.mode === "live"`; startup error otherwise) and `FIRECRAWL_API_URL`.
- `juryRun`: prompt and tool policy binding checks; a per-call `SearchCache`;
  per seat `runResearchLoop`; then the existing post-processing with
  `toolTranscriptHash`, `toolCallCount`, bundle core v3, `approve_run` citing
  the sealed blob twice.
- `PageStore` implementation inside the engine: lookup by evidence id,
  provider open, cap, hash, Walrus upload, `saveEvidenceSubmission` +
  `saveEvidenceArtifact` with `sourceClass: "DISCOVERED"`, `emitEvidenceRetrieved`
  is NOT emitted (resolution events stay phase-gated and pre-reveal safe).
- `validateOutputAgainstManifest` takes an extra allowed-id set (opened pages).
- Round 2 uses the same loop; peers' revealed arguments remain in the input as
  today.

### 4.10 Verifier and UI

- `lib/verify/run-proof.ts`: for v3 bundles add checks `toolTranscriptHash`
  (recompute from `bundle.transcript`), `toolPolicyHash`, `systemPrompt`
  (composed message equals `request.messages[0].content`), and `citations`
  (every citation id is in `transcript.opened`, every `found` flag true, YES/NO
  has a SEARCH-origin citation). Quote-in-page recomputation from Walrus is a
  follow-up; the engine's `found` flags are part of the hashed transcript.
- `components/claim/run-proof.tsx`: a "Research trail" panel: each step with
  query/results or opened page (title, URL, hash, Walrus link, slice), errors,
  and the citations table with check marks.
- `/verify` Run proof tab and `/agents/[id]` manifest panel display v3 fields
  (tool policy budgets, provider).
- Claim report page: citations rendered under each revealed juror argument.

### 4.11 Rules and docs

- `CLAUDE.md` hard rule and PRD wording change from "models never receive
  URLs" to: models never fetch, never hold keys or transaction authority; every
  URL they see or open is engine-executed and recorded in the sealed transcript.
- PRD §1.1 item 9, `docs/STATUS.md` rows, `docs/demo/runbook.md`,
  `docs/CHECKPOINT-2026-08-29.md` Known gaps ("jurors judge from user-picked
  snippets" closed), `.env.example` (`FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`).

## 5. Data flow (one seat)

```
input (frozen) ─┐
                ▼
 system(v2 + budgets) + user(input) ──► model ──► {search q}
   engine: cache? → Firecrawl /v2/search → results (5 lines) ──► model ──► {open url}
   engine: seen? cache? → Firecrawl /v2/scrape → cap → hash → Walrus → DISCOVERED artifact
           → slice(0..6000) ──► model ──► {answer …citations}
   engine: schema + ids + quotes + independence ─► ok
 transcript → tool_transcript_hash → RunRecordV1 → run_hash
 core v3 (prompt, input, messages, response, output, audit, transcript) → seal → Walrus
 approve_run(run_hash, sealed blob, sealed blob) → commit → reveal(core + key)
```

## 6. Error handling summary

| Situation | Behaviour |
|---|---|
| Model returns non-JSON or unknown action | one repair turn, then `INVALID_SCHEMA`, no vote |
| Model opens a URL it has not seen | `URL_NOT_SEEN` tool error, turn consumed |
| Budget exhausted | tool error naming the budget; final turn forced to answer |
| Provider search/open fails | tool error, budget unit consumed, model may continue |
| YES/NO answered before any SEARCH page was opened | `RESEARCH_REQUIRED` tool error (at most two per run), turn consumed, then the row below applies |
| Citation quote not in page | quote blanked in the validated output, citation kept as a verified URL, transcript records `found: false` |
| Citation of a page not opened, URL mismatch, or YES/NO without a SEARCH citation | repair turn with the exact failures, then `CITATION_INVALID`, no vote |
| Model call fails (network, 5xx) | existing visible retry then `PROVIDER_ERROR` / `TIMEOUT` |
| Loop exceeds `maxLoopMs` | `TIMEOUT`, no vote |
| Firecrawl key missing in live mode | engine refuses to start (`server.ts`) |

Every failure path is a recorded attempt or transcript step; nothing is silent.

## 7. Testing

- Unit: action schemas; Firecrawl provider with injected `fetch` (request
  bodies, response mapping, error kinds, no key in errors); fake provider
  determinism; citation validator (all five rules); transcript hashing
  stability; `composeSystemPrompt`.
- Loop: scripted fake adapter through search → open → answer; budget
  exhaustion and forced answer; `URL_NOT_SEEN`; repair then fail closed;
  cached search and cached page; wall-clock cap.
- Engine: existing lifecycle tests run on the loop with the fake provider;
  DISCOVERED artifacts excluded from the frozen manifest and claim listings;
  `tool_blob_id` equals the sealed blob; transcript inside the sealed core;
  prompt and tool policy binding fail closed; `CITATION_INVALID` seat has no
  vote and the round still settles with four valid seats.
- Verifier: v3 bundle checks incl. a tampered transcript and a citation of an
  unopened page; v2 bundles still verify.
- Live (manager): one single-seat probe against Firecrawl cloud and
  GonkaRouter per model family before the testnet canary; then the canary.
- Move tests unchanged (no Move change).

## 8. Cost and limits

Per claim worst case: 5 seats × (3 searches + 4 opens) = 35 Firecrawl calls;
typical 15 to 20 credits. Model calls: up to 8 per seat. Wall clock per round:
about 2 to 4 minutes with the default budgets, inside the 15-minute commit
floor. The dedicated Firecrawl account's key lives only in the worker host
env and `.env` locally.

## 8b. Hardening after the first live probe (2026-08-29 23:52)

The first probe (DeepSeek-V4-Flash, MiniMax-M2.7, Kimi-K2.6 against Firecrawl
cloud and GonkaRouter) showed the protocol works but validation was too
brittle for real models. Amendments, all binding for v1:

1. **Page refs.** Every opened page gets a short ref `p<n>` (1-based order of
   first open in the run) that the `open` tool result carries next to the full
   `evidenceId`. In the answer, any evidence-id position (`citations[].evidenceId`,
   `evidenceFor`, `evidenceAgainst`, `unsupportedClaims`, `decisiveEvidence`,
   `publicReasoningTrace[].evidenceIds`) may hold a ref or a full id; a citation
   may omit `evidenceId` when its `url` matches an opened page. The loop
   resolves refs and urls to full ids before validation; `validatedOutput`
   (the hashed, published form) always carries full ids. Unknown refs are
   validation errors.
2. **Quote matching.** `quoteFound` normalizes both sides with NFKC, maps
   curly quotes and apostrophes to straight ones, maps dashes to `-`, strips
   markdown syntax (links to their text, images to alt text, emphasis and code
   markers, heading, blockquote and list markers), collapses whitespace, and
   lowercases before the substring test. Still deterministic and exact: a
   verifier recomputes the same function.
3. **Budgets.** `pageSliceChars` 6000 → 4000 (context stayed too large for a
   fifth turn); research completions use a dedicated
   `researchTimeoutMs` (default 240,000 ms, env `GONKA_RESEARCH_TIMEOUT_MS`)
   instead of the 120 s single-shot timeout; `maxLoopMs` stays 600,000.
4. **Prompt text.** Cite by ref; copy quotes verbatim as one exact sentence
   from the text you received (no paraphrase, no ellipsis); prefer one or two
   citations; the repair prompt names these two rules explicitly.

## 9. Rollout

1. Full gate (`pnpm test`, `typecheck`, `lint`, `build`).
2. `scripts/publish-agent-manifests.ts --dry-run` then live: seven v3 manifest
   documents (new prompt and tool policy hashes), then `seed-testnet-agents.ts`.
3. Live single-seat probe, then `scripts/testnet-canary.ts`.
4. Commit and push (owner authorises), Railway workers deploy with
   `FIRECRAWL_API_KEY` set.

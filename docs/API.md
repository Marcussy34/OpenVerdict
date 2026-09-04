# OpenVerdict public API

Complete reference for every route under `app/api`. The base URL of the
production deployment is `https://app.openverdict.info/api`; `--base <url>`
in the CLI and the `<base>` in every example below point at any deployment.

Every response is JSON except the Server-Sent Events stream. The TypeScript
types behind the shapes live in [`lib/engine/contract.ts`](../lib/engine/contract.ts);
the status codes below come from the route handlers themselves.

## Conventions

**Ids.** Claim ids, run ids, seat ids, agent profile ids, certificate ids and
object ids are 66-character lowercase hex strings (`0x` plus 64 hex digits).
Transaction digests are base58. Walrus blob ids are base64url. Queue ids and
stake reservation ids are UUIDs. GonkaRouter request ids look like
`req-<digits>-<digits>`.

**Errors.** Every error body carries an `error` code and usually a `message`:

```json
{ "error": "validation_error", "message": "claim id is required" }
```

Error codes are lowercase snake case everywhere except `POST /api/extract-claim`,
which uses uppercase codes (`INVALID_URL`, `NO_CLAIM_FOUND`, `FETCH_FAILED`,
`ENGINE_NOT_WIRED`, `INTERNAL_ERROR`).

**Two statuses appear on almost every route.** `503 engine_not_wired` means
the deployment is missing its chain, storage or database wiring. `500
internal_error` carries the underlying message. Neither is listed again per
route below unless the route behaves differently.

## Guards

| Guard | Applies to | Failure |
| --- | --- | --- |
| Public read | every `GET` in this document | none |
| Public writes flag | every public `POST` | `403 writes_disabled`, message "public submissions are disabled", unless `OPENVERDICT_PUBLIC_WRITES=enabled` |
| Rate limit | every public `POST` | `429 rate_limited`, message "too many submissions, retry later" |
| Free seats flag | `POST /api/agents/register` only | `403 free_seats_disabled`, message "stake on a seat through /agents", unless `OPENVERDICT_FREE_SEATS=enabled` |
| Operator token | `POST /api/claims` only | `403 forbidden`, message "not authorized for this action" |

The rate limiter (`app/api/_lib/guard.ts`) is in-process and fixed-window over
60 seconds. The global ceiling is 60 requests per window across all guarded
writes, and it is checked first so a spoofed header cannot route around it.
The per-client bucket of 5 requests per window applies only when
`OPENVERDICT_TRUST_PROXY=1`, because `x-forwarded-for` is attacker-controlled
otherwise; the client key is the first hop, SHA-256 hashed before storage.

Operator auth compares a `Authorization: Bearer <OPENVERDICT_OPERATOR_TOKEN>`
header in constant time and returns one uniform 403 on every failure, so the
response never reveals whether a token is configured. A token shorter than 16
characters keeps operator writes closed.

## Reading routes

### GET /api/weather

The latest public probe of the three model families and the web search
provider. A jury needs all four. Sent with `Cache-Control: no-store`.

```bash
curl -s https://app.openverdict.info/api/weather
```

```json
{
  "probedAtMs": 1788496731822,
  "stale": false,
  "clear": false,
  "families": [
    { "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731", "family": "deepseek", "ok": false, "latencyMs": 60004, "status": "TIMEOUT" },
    { "modelId": "research:firecrawl", "family": "research", "ok": true, "latencyMs": 297, "status": "200 1189 credits" }
  ]
}
```

`clear` is true only when the probe is fresh and every family is `ok`; unknown
weather is never clear. `stale` is true when there is no probe or the newest
one is older than the staleness window. `status` is the HTTP status as text,
or `TIMEOUT` or `ERROR`.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `WeatherReport` | the latest probe |
| 503 | `engine_not_wired` | deployment not wired |
| 500 | `internal_error` | unexpected failure |

### GET /api/status

Live engine, Sui, GonkaRouter, Walrus and database status.

```bash
curl -s https://app.openverdict.info/api/status
```

```json
{
  "appVersion": "0.1.0",
  "network": "testnet",
  "packageId": "0x1f7b684d36979046a077b38caae8d567616bc691f23b018e65ac194d314f0c13",
  "registryObjectId": "0x4020f3cbe51c1cdf6d004696e7cdf0d19f67fde2572b72a5f39a51d119f8ebab",
  "suiHealthy": true,
  "gonkaMode": "live",
  "walrusMode": "testnet",
  "dbHealthy": true,
  "paused": false
}
```

`latestCheckpoint` is optional and absent when the node did not answer.
`gonkaMode` is `live` or `fake`; `walrusMode` is `local`, `testnet` or
`mainnet`.

| Status | Body |
| --- | --- |
| 200 | `EngineStatus` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/claims

The board: every claim as a full `ClaimInspection`, newest first.

Query: `state=<number>` filters on the on-chain claim state (see the state
table under "Ids and links"). A non-numeric value is ignored. There is no
server-side `limit`: the handler reads only `state`, so a caller that passes
`?limit=` must trim the array itself, which is what `ov board --limit` does.

```bash
curl -s "https://app.openverdict.info/api/claims?state=10"
```

```json
{ "claims": [ { "claimId": "0x2732...", "state": 10, "...": "trimmed" } ] }
```

| Status | Body |
| --- | --- |
| 200 | `{ claims: ClaimInspection[] }` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/claims/{id}

One claim, its deadlines, its committee, its commitments and its result.

Query: `verify=1` or `verify=true` adds a `verification` object
(`commitmentsRecomputed`, `truthScoreRecomputed`, `evidenceRootsRecomputed`,
`issues[]`) recomputed server-side.

```bash
curl -s https://app.openverdict.info/api/claims/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6
```

```json
{
  "claimId": "0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6",
  "mode": 1,
  "state": 10,
  "statement": "Humans use only ten percent of their brains.",
  "resolutionCriteria": "Decide whether the statement is true as written ...",
  "deadlines": {
    "evidenceCutoffMs": 1788405501694,
    "proposalDeadlineMs": 1788405506694,
    "challengeDeadlineMs": 1788405511694,
    "firstCommitDeadlineMs": 1788406041694,
    "firstRevealDeadlineMs": 1788406161694,
    "discussionDeadlineMs": 1788407001694,
    "secondCommitDeadlineMs": 1788407241694,
    "secondRevealDeadlineMs": 1788407361694
  },
  "committeeId": "0xcb8560e363f87e690ef55e1a7d4d49c039cc0efe8b43179e1b49e36dfcfe39b6",
  "evidenceRoots": [
    { "phase": 1, "root": "0x532792ca...", "bundleId": "0xad34aa81..." }
  ],
  "commitments": [
    {
      "jurySeatId": "0x44525825...",
      "agentProfileId": "0x546e1491...",
      "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731",
      "committed": true,
      "revealed": true,
      "outcome": 2,
      "confidenceBps": 9500
    }
  ],
  "rounds": [
    { "phase": 1, "expectedJurySeatIds": ["0x..."], "committedJurySeatIds": ["0x..."], "revealedJurySeatIds": ["0x..."] }
  ],
  "attemptChain": {
    "verificationId": "0xf0db7043...",
    "attempt": 3,
    "maxAttempts": 3,
    "status": "SETTLED",
    "previousAttempts": [
      { "claimId": "0xf0db7043...", "attempt": 1, "status": "VOIDED", "voidReason": "PROVIDER_ERROR" }
    ]
  },
  "result": {
    "claimId": "0x2732...",
    "result": "NO",
    "truthScoreBps": 200,
    "certificateId": "0x42954c91...",
    "digest": "572tT7FGmL6FG3ZEzf2DkorPzaStVymnvxNVMgF2bkXi"
  }
}
```

Key fields. `outcome` in a commitment is the numeric vote code (1 YES, 2 NO,
3 UNSURE); `result.result` is the string form and adds `UNRESOLVED`.
`confidenceBps` is basis points out of 10000. `deliberation[]` appears on a
two-round claim: one `DeliberationTurnPublic` per debate turn, with `ordinal`,
`exchange` (1 to 3), `stance`, `confidenceBps`, `argument`, `citations[]` and
`status` (`SPOKEN` or `SKIPPED`). `debateConvergedAfterExchange` is present
when the debate stopped early. `attemptChain.status` is `ACTIVE`, `VOIDED`,
`SETTLED` or `GAVE_UP`, and a voided attempt carries `void` and later
`relaunchedAs`.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `ClaimInspection` | the claim |
| 400 | `validation_error` | empty id |
| 404 | `claim_not_found` | no claim with that id |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### GET /api/claims/{id}/report

The public fact-check report in display order, plus the machine-readable audit
bundle.

```bash
curl -s https://app.openverdict.info/api/claims/0x2732.../report
```

```json
{
  "claimId": "0x2732...",
  "statement": "Humans use only ten percent of their brains.",
  "submittedUrls": [],
  "label": "NO",
  "truthScore": 2,
  "truthScoreFormula": "confidence is read as the juror's probability that its own vote is correct; mean(YES confidence, NO (10000-confidence), UNSURE 5000) over valid reveals, rounded half-up; displayed as basis-points / 100",
  "finalRoundVotes": [
    { "jurySeatId": "0x44525825...", "outcome": "NO", "confidenceBps": 9500, "valid": true }
  ],
  "agents": [
    {
      "agentProfileId": "0x546e1491...",
      "owner": "0xc751f1d9...",
      "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731",
      "role": "SOURCE_AUTHENTICITY",
      "outcome": "NO",
      "confidenceBps": 9500,
      "gonkaRequestId": "devshard-70083-36",
      "evidenceIds": ["0x8966af5f..."],
      "reasoning": "The claim that humans use only ten percent ...",
      "publicReasoningTrace": [
        { "check": "Search for evidence challenging the claim", "finding": "...", "assessment": "CONTRADICTS", "evidenceIds": ["0x..."] }
      ]
    }
  ],
  "evidence": [
    { "evidenceId": "0x15617905...", "sourceUrl": "urn:openverdict:claim-statement", "blobId": "5Wm-E1ZTXcfuIBjKaLhoZqOhUUGJ99RdGlStBEPwkBk", "contentHash": "0x8753be8c..." }
  ],
  "evidenceRoot": "0x532792ca...",
  "sui": {
    "claimObjectId": "0x2732...",
    "committeeId": "0xcb8560e3...",
    "certificateId": "0x42954c91...",
    "revealedVoteIds": ["0x29b1445e..."]
  },
  "auditBundle": { "...": "trimmed" }
}
```

`label` is `YES`, `NO`, `UNSURE`, `UNRESOLVED` or `PENDING`. `truthScore` is
basis points divided by 100, or `null` before settlement. `valid` on a vote is
false when the reveal did not match its commitment; only valid reveals enter
the score. `auditBundle` holds `version`, `claim`, `committee`, `evidence`,
`evidenceArtifacts`, `runs`, `runApprovals`, `commitments`, `reveals` and
`certificate`.

| Status | Body |
| --- | --- |
| 200 | `FactCheckReport` |
| 400 | `validation_error` |
| 404 | `claim_not_found` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/claims/{id}/events

The resolution event log, either as a Server-Sent Events stream (the default)
or as a JSON snapshot.

Query and headers:

| Parameter | Effect |
| --- | --- |
| `snapshot=1` | return `{ events: ResolutionEvent[] }` as JSON instead of streaming |
| `from=N` | start at sequence `N`, inclusive |
| `Last-Event-ID: N` header | resume at sequence `N + 1`; takes precedence over `from` |

```bash
curl -s "https://app.openverdict.info/api/claims/0x2732.../events?snapshot=1&from=70"
curl -N  "https://app.openverdict.info/api/claims/0x2732.../events?from=70"
```

The stream is sent with `Content-Type: text/event-stream; charset=utf-8`,
`Cache-Control: no-cache, no-transform`, `Connection: keep-alive` and
`X-Accel-Buffering: no`. Events are unnamed, so an `EventSource` receives them
through `onmessage`; each carries `id: <sequence>` and one `data:` line. A
`: heartbeat` comment every 15 seconds keeps proxies from closing the
connection.

The envelope:

```json
{
  "kind": "claim_finalized",
  "phase": "FINALIZED",
  "source": "SUI",
  "claimId": "0x2732...",
  "eventId": "e9e50366-4810-4c9b-a7c3-a6803793a9b8",
  "sequence": 78,
  "occurredAt": "2026-09-03T03:27:41.882Z",
  "publishedAt": "2026-09-03T03:27:41.882Z",
  "visibility": "PUBLIC_NOW",
  "transactionDigest": "572tT7FGmL6FG3ZEzf2DkorPzaStVymnvxNVMgF2bkXi",
  "payload": { "outcome": "NO", "truth_score_bps": 200, "certificate_id": "0x42954c91..." }
}
```

| Field | Meaning |
| --- | --- |
| `kind` | what happened, for example `claim_created`, `evidence_submitted`, `evidence_retrieved`, `committee_selected`, `evidence_frozen`, `agent_activity`, `RESEARCH_TICK`, `output_repaired`, `run_approved`, `vote_committed`, `phase_changed`, `vote_revealed`, `inference_completed`, `argument_published`, `claim_finalized` |
| `phase` | lifecycle phase label, for example `CREATE`, `EVIDENCE_1`, `EVIDENCE`, `COMMIT_1`, `ROUND_1`, `INFERENCE_1`, `REVEAL_1`, `DISCUSSION`, `COMMIT_2`, `REVEAL_2`, `FINALIZED` |
| `source` | `ENGINE`, `GONKA_ROUTER`, `TOOL`, `EVIDENCE` or `SUI` |
| `claimId` | the claim this event belongs to |
| `eventId` | UUID, unique per event |
| `sequence` | monotonic per claim; the SSE `id:` and the `--since` value |
| `occurredAt` | ISO 8601 UTC |
| `visibility` | `PUBLIC_NOW`, `PUBLIC_AFTER_REVEAL` or `INTERNAL_REDACTED` |
| `payload` | free-form object, one shape per `kind` |

Optional: `publishedAt`, `actorId`, `runId`, `transactionDigest`,
`checkpoint`, `artifactHash`.

| Status | Body |
| --- | --- |
| 200 | SSE stream, or `{ events }` with `snapshot=1` |
| 400 | `validation_error` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/claims/{id}/runs/{runId}/proof

Everything public about one juror inference run. A revealed run is immutable,
so it is served with `Cache-Control: public, max-age=31536000, immutable`.

```bash
curl -s https://app.openverdict.info/api/claims/0x2732.../runs/0x36173f41.../proof
```

Top level: `runId`, `claimId`, `phase`, `agentProfileId`, `jurySeatId`,
`promptHash`, `inputHash`, `outputHash`, `runHash`, `gateway`,
`claimDeadlines`, `sealPolicy`, `sealedBlobId`, `sealed`, `revealedBlobId`,
`revealed`, `bundle`, `sui`. A failed seat carries `failure` and nulls for
`runHash`, `bundle` and both blob ids.

```json
{
  "gateway": { "gatewayRequestId": "req-1788405572969008592-322552", "devshardId": "70083", "systemFingerprint": "vllm-0.25.1-tp2-8aac2e07" },
  "sealPolicy": { "packageId": "0xf54eb611...", "threshold": 1, "keyServers": [ { "objectId": "0xb012378c...", "weight": 1, "aggregatorUrl": "https://seal-aggregator-testnet.mystenlabs.com" } ] },
  "sui": {
    "claimObjectId": "0x2732...",
    "agentProfileId": "0x4ee8af57...",
    "jurySeatId": "0xc5e4acc5...",
    "runApproval": { "objectId": "0xcf3a6bc9...", "transactionDigest": "FKDaAKuki8Hsjk1ZiYvvm4WTQjiKMoWiTsVgdXxqbWaE" },
    "commitment": { "objectId": "0x98cdacf3...", "transactionDigest": "Fgc3kP5b2zaidMT4geQLf2pUesPb5mgPFhUsJkhisXm9" },
    "reveal": { "objectId": "0xea1afadf...", "transactionDigest": "2a8Pg3xUHeheVGV7xFRK1XaSjRBujMnbwQbvBKc9dcho" }
  }
}
```

The bundle sections, in the order a verifier walks them:

| Section | What it holds |
| --- | --- |
| `request.messages` | the exact conversation sent to the model, system message first; this is what the re-execution check resends |
| `request` also | `model`, `attemptKind`, `maxTokens`, `temperature`, `responseFormat` |
| `promptSpec`, `promptHash` | the pinned prompt and its hash |
| `toolPolicy`, `toolPolicyHash` | the search and open budgets the juror ran under |
| `transcript.steps[]` | every search and open, each with `action` (`action`, `intent` support or challenge, `query`), `result`, `modelRequestId` and `completedAtMs` |
| `transcript.opened[]` | every page opened, with `evidenceId`, `contentHash`, `canonicalHash` and its Walrus blob ids |
| `transcript.citations`, `transcript.counts` | what was cited, and the search, open and turn counts |
| `validatedOutput` | the schema-checked answer: `outcome`, `confidenceBps`, `reasoning`, `publicReasoningTrace`, `citations`, `evidenceFor`, `evidenceAgainst`, `decisiveEvidence`, `counterEvidenceSummary`, `unsupportedClaims` |
| `rawResponse` | the provider response verbatim, including `id`, `model`, `system_fingerprint`, `usage` and `metrics` |
| `gateway` | `gatewayRequestId`, `devshardId`, `systemFingerprint` |
| `audit` | the flat `InferenceRunAudit` record: model, request ids, token counts, latency, evidence root and every hash |
| `seal` | the revealed key material: `sealedBlobId`, `algorithm`, `ivHex`, `keyHex`, `coreHash`, `aad` |
| `verify` | the formula for each hash, for example `runHash: blake2b256(BCS(RunRecordV1))` |
| `attempts[]` | every provider attempt, retries, repairs and hedges included |

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | the proof body | |
| 400 | `validation_error` | missing claim id or run id |
| 404 | `run_not_found` | no such run on that claim |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### GET /api/fact-checks/queue/{id}

One queued submission. Sent with `Cache-Control: no-store`.

```bash
curl -s https://app.openverdict.info/api/fact-checks/queue/<queueId>
```

```json
{
  "queueId": "…",
  "status": "QUEUED",
  "statement": "…",
  "createdAt": "2026-09-04T04:00:00.000Z",
  "expiresAt": "2026-09-04T10:00:00.000Z",
  "weather": { "clear": false, "stale": false, "families": [] }
}
```

`status` is `QUEUED`, `LAUNCHED`, `EXPIRED` or `CANCELLED`. A launched item
carries `claimId`; a failed launch carries `launchError`.

| Status | Body |
| --- | --- |
| 200 | `QueuedFactCheck` |
| 404 | `not_found` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/agents

The juror seat directory.

```bash
curl -s https://app.openverdict.info/api/agents
```

```json
{
  "agents": [
    {
      "agentProfileId": "0x81a73726...",
      "owner": "0x6573776e...",
      "modelId": "MiniMaxAI/MiniMax-M2.7",
      "role": "SKEPTIC",
      "manifestHash": "0xdd897be7...",
      "active": true,
      "reputation": {},
      "backing": { "kind": "WALLET", "label": "sui-wallet-stake" },
      "trackRecord": { "seatsServed": 0, "committed": 0, "revealed": 0, "agreedWithCertificate": 0 },
      "staker": "0x9cd8dcd0...",
      "stakeMist": "100000000",
      "earnedMist": "6650000"
    }
  ]
}
```

`staker` is the account that posted the seat's bond, absent on seats the
operator opened. `stakeMist` is that bond in MIST as a decimal string.
`earnedMist` is lifetime jury reward tickets for the seat, whether withdrawn
or not, never a live wallet balance. The `backing` object is the engine's
record of how the seat was opened (`ZKLOGIN`, `WALLET`, `ALLOWLIST` or
`UNKNOWN`): the field name is historical, and the value describes the staking
path, not any identity claim.

| Status | Body |
| --- | --- |
| 200 | `{ agents: AgentDirectoryEntry[] }` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/agents/{id}/manifest

The published manifest document for one seat: the pinned prompt, tool policy
and evidence policy that its runs are hashed against.

```bash
curl -s https://app.openverdict.info/api/agents/0x044ef4ad.../manifest
```

```json
{
  "version": "5",
  "network": "testnet",
  "backingKind": "TESTNET_DEMO_ALLOWLIST",
  "humanBackingHash": "0x6136b57b...",
  "humanVerificationProvider": "testnet-demo-allowlist",
  "operationalOwner": "0x6573776e...",
  "role": "SKEPTIC",
  "modelId": "MiniMaxAI/MiniMax-M2.7",
  "providerId": "gonkarouter",
  "promptSpec": { "version": "4", "providerId": "gonkarouter", "systemPrompt": "… trimmed …" },
  "promptHash": "0x…",
  "toolPolicy": { "…": "trimmed" },
  "toolPolicyHash": "0x…",
  "evidencePolicyId": "…",
  "evidencePolicyHash": "0x…"
}
```

`humanBackingHash` is the staker hash and `backingKind` names the staking
path; both field names are historical and neither asserts anything about a
person. `operationalOwner` is the engine signing key that runs the seat.

| Status | Body |
| --- | --- |
| 200 | `AgentManifestDocument` |
| 400 | `validation_error` |
| 404 | `manifest_not_found` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### GET /api/gateway-receipts/{requestId}

A thin proxy onto GonkaRouter's public receipts lookup
(`https://api.gonkarouter.io/v1/receipts/`), which has no CORS headers so the
browser cannot call it directly. Metadata only, no auth, no content. The
`requestId` must match `req-<digits and dashes>`. A receipt for a finished
request never changes, so successful lookups are cached in process and served
`Cache-Control: public, max-age=31536000, immutable`.

```bash
curl -s https://app.openverdict.info/api/gateway-receipts/req-1788405572969008592-322552
```

```json
{
  "x_request_id": "req-1788405572969008592-322552",
  "x_devshard_id": "70083",
  "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "created_at": "2026-09-03T03:19:51Z",
  "outcome": "success",
  "status_code": 200,
  "stream": false,
  "total_tokens": 9029,
  "ttft_ms": 18315,
  "duration_ms": 18315
}
```

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | the receipt, verbatim from the gateway | |
| 400 | `validation_error` | the id does not look like `req-...` |
| 404 | `receipt_not_found` | the gateway has no record of that id |
| 429 | `gateway_rate_limited` | the gateway rate limited the lookup |
| 502 | `gateway_error` (with the upstream `status`) or `gateway_unreachable` | the gateway failed or timed out after 15 seconds |

## Writing routes

### POST /api/extract-claim

Extract up to three checkable factual claims from a page or a pasted
paragraph, using one GonkaRouter model. Guards: public writes flag, rate
limit. Note the uppercase error codes on this route.

Body: exactly one of `url` or `text`, and nothing else (the schema is strict).

| Field | Limits |
| --- | --- |
| `url` | 1 to 2048 characters, `http:` or `https:`; fetched through the SSRF-guarded evidence retriever |
| `text` | 40 to 20000 characters; never fetched |

```bash
curl -s -X POST https://app.openverdict.info/api/extract-claim \
  -H 'content-type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Eiffel_Tower"}'
```

```json
{
  "claims": [
    { "claim": "The Eiffel Tower was completed in 1889.", "reason": "A dated, falsifiable construction fact.", "quote": "… trimmed …" }
  ],
  "language": "en",
  "claim": "The Eiffel Tower was completed in 1889.",
  "sourceUrl": "https://en.wikipedia.org/wiki/Eiffel_Tower",
  "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "gonkaRequestId": "devshard-70083-2",
  "gatewayRequestId": "req-…"
}
```

`claims[]` is in source order, at most three, each claim at most 1000
characters with the quote at most 300 and the reason at most 2000. The
top-level `claim` repeats the first one for older clients. `sourceUrl` appears
only on the URL path and is the final URL after redirects. The model receives
only a bounded, inert excerpt of the page (at most 12000 characters) and is
told never to follow instructions inside it. The handler retries once with a
prompt-based JSON fallback if the provider rejects the response format, and
once more with a repair turn if the reply does not parse.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | one to three claims |
| 400 | `INVALID_URL` | body is not exactly one valid url or one text of 40 to 20000 characters |
| 403 | `writes_disabled` | public writes are off |
| 404 | `NO_CLAIM_FOUND` | the source held no checkable factual claim, or the model failed or replied unparseably |
| 429 | `rate_limited` | over the limit |
| 502 | `FETCH_FAILED` | the source page could not be fetched safely |
| 503 | `ENGINE_NOT_WIRED` | deployment not wired |
| 500 | `INTERNAL_ERROR` | the extraction runtime could not start |

### POST /api/fact-checks

Submit a claim for direct review. Guards: public writes flag, rate limit.

| Field | Required | Limits |
| --- | --- | --- |
| `claim` | yes | string, 5 to 1000 characters after trimming |
| `text` | no | string, up to 20000 characters |
| `urls` | no | array of at most 5 strings, each `https:` and at most 2048 characters |
| `resolutionCriteria` | no | string, up to 2000 characters |

```bash
curl -s -X POST https://app.openverdict.info/api/fact-checks \
  -H 'content-type: application/json' \
  -d '{"claim":"The first Bitcoin halving happened in November 2012."}'
```

Clear weather returns 200 and the claim is live on Sui:

```json
{ "claimId": "0x2732…" }
```

Weather that is not clear returns 202 and the submission is queued:

```json
{ "queued": true, "queueId": "…", "weather": { "clear": false, "stale": false, "families": [] } }
```

A queued submission launches on the first clear probe, one launch every ten
minutes, and expires after six hours. Unknown weather never queues.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | launched, `claimId` returned |
| 202 | | queued, `queueId` and the current weather returned |
| 400 | `validation_error` | the message names the field and its bound |
| 403 | `writes_disabled` | |
| 429 | `rate_limited` | |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### POST /api/claims/{id}/runs/{runId}/reexecute

Resend one revealed juror's exact recorded conversation to the same model and
compare the answer. This costs a real model call, so it sits behind the public
writes flag and the rate limit. It grants the caller no signer and writes
nothing on chain.

```bash
curl -s -X POST https://app.openverdict.info/api/claims/0x2732.../runs/0x36173f41.../reexecute
```

```json
{
  "requestedAt": "2026-09-04T04:00:00.000Z",
  "completedAt": "2026-09-04T04:00:18.000Z",
  "latencyMs": 18000,
  "gatewayRequestId": "req-…",
  "devshardId": "70083",
  "systemFingerprint": "vllm-0.25.1-tp2-8aac2e07",
  "servedModel": "deepseek-ai/DeepSeek-V4-Flash-0731",
  "outputHash": "0x…",
  "outcome": "NO",
  "confidenceBps": 9500,
  "matches": { "outcome": true, "outputHash": false, "servedModel": true },
  "rawContent": "… the model's reply …"
}
```

`matches` compares the fresh answer against the recorded one. A differing
`outputHash` is normal: models are not deterministic, so this is corroboration,
never proof.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | the re-execution result |
| 400 | `validation_error` | missing claim id or run id |
| 403 | `writes_disabled` | |
| 404 | `run_not_found` | |
| 409 | `run_not_revealed` | the run is still sealed |
| 429 | `rate_limited` | |
| 502 | `provider_error` | the model provider failed; the message is truncated to 500 characters and the API key redacted |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### POST /api/agents/stake/prepare

Step one of staking on a juror seat. The engine validates the model and role,
allocates a free operational signing slot, writes the seat's manifest document
to Walrus and returns the `register_staked_agent` arguments. Nothing is on
chain yet, and an abandoned reservation expires and frees its slot again.
Guards: public writes flag, rate limit.

| Field | Limits |
| --- | --- |
| `address` | the staker's Sui address, 1 to 66 characters |
| `modelId` | 1 to 128 characters, from the release manifest catalog |
| `role` | 1 to 32 characters, for example `SKEPTIC` |

```bash
curl -s -X POST https://app.openverdict.info/api/agents/stake/prepare \
  -H 'content-type: application/json' \
  -d '{"address":"0x9cd8…","modelId":"MiniMaxAI/MiniMax-M2.7","role":"SKEPTIC"}'
```

```json
{
  "reservationId": "…",
  "expiresAt": "2026-09-04T04:15:00.000Z",
  "target": { "packageId": "0x1f7b684d…", "registryObjectId": "0x4020f3cb…", "clockObjectId": "0x6" },
  "args": {
    "manifestHash": "0x…",
    "manifestBlobId": "…",
    "modelHash": "0x…",
    "roleHash": "0x…",
    "stakerHash": "0x…",
    "operationalOwner": "0x…"
  },
  "minStakeMist": "100000000"
}
```

`args` are in the order the entry function takes them. `stakerHash` is
blake2b-256 of the staker address. `minStakeMist` is 0.1 SUI.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | the reservation |
| 400 | `validation_error` | a field is missing, too long, or the model or role is unknown |
| 403 | `writes_disabled` | |
| 409 | `slots_exhausted` | every operational signing slot is taken |
| 429 | `rate_limited` | |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### POST /api/agents/stake/confirm

Step two. The engine reads the staker's settled transaction, checks it against
the reservation, binds the seat's signing slot and tops it up with gas.
Replaying a confirmed reservation returns the stored result rather than
writing twice. Guards: public writes flag, rate limit.

| Field | Limits |
| --- | --- |
| `reservationId` | 1 to 64 characters, from `prepare` |
| `digest` | 1 to 64 characters, the settled transaction digest |

```bash
curl -s -X POST https://app.openverdict.info/api/agents/stake/confirm \
  -H 'content-type: application/json' \
  -d '{"reservationId":"…","digest":"…"}'
```

```json
{
  "agentProfileId": "0x81a73726…",
  "staker": "0x9cd8dcd0…",
  "stakeMist": "100000000",
  "digest": "…",
  "backingKind": "WALLET_STAKED",
  "operationalOwner": "0x…",
  "gasFloat": "funded"
}
```

`gasFloat` is `funded`, `skipped` or `failed`; funding the seat's signing key
never fails the confirmation.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | the seat is recorded |
| 400 | `validation_error` | the transaction does not match the reservation |
| 403 | `writes_disabled` | |
| 404 | `reservation_not_found` | unknown or expired reservation |
| 429 | `rate_limited` | |
| 502 | `chain_read_failed` | the transaction could not be read from the chain |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

### POST /api/agents/register

The older signed-message path: the staker signs a canonical message and the
**operator** posts the bond. A signature is not money, so this route is off by
default and answers 403 unless `OPENVERDICT_FREE_SEATS=enabled`. Real seats
come from `prepare` plus `confirm` above. Guards: public writes flag, free
seats flag, rate limit.

| Field | Limits |
| --- | --- |
| `address` (or `zkLoginAddress` for older clients; `address` wins) | up to 66 characters |
| `signature` | base64 personal-message signature, up to 16384 characters |
| `modelId` | up to 128 characters |
| `role` | up to 32 characters |

```bash
curl -s -X POST https://app.openverdict.info/api/agents/register \
  -H 'content-type: application/json' \
  -d '{"address":"0x…","signature":"…","modelId":"…","role":"SKEPTIC"}'
```

```json
{ "agentProfileId": "0x…", "humanBackingHash": "0x…", "backingKind": "WALLET_STAKED", "digest": "…" }
```

`humanBackingHash` is the staker hash: a historical field name, not an
identity claim. Any Sui wallet signature is accepted, zkLogin included.

| Status | Code | Meaning |
| --- | --- | --- |
| 201 | | the seat is registered |
| 400 | `validation_error` | a field is missing or too long, or the engine rejected the request |
| 403 | `writes_disabled` or `free_seats_disabled` | |
| 409 | `slots_exhausted` | |
| 429 | `rate_limited` | |
| 503 | `engine_not_wired` or `zklogin_verification_unavailable` | signature verification is temporarily unavailable |
| 500 | `internal_error` | |

### POST /api/sponsor

Ask Shinami's Gas Station to attach gas and sign one allowlisted transaction.
The browser builds the `TransactionKind`, this route allowlists it, and the
user's wallet then signs the bytes Shinami returned, so the user still
approves the full transaction. The access key never leaves the server. Guards:
public writes flag, rate limit.

| Field | Limits |
| --- | --- |
| `sender` | a valid Sui address |
| `transactionKind` | base64 `TransactionKind`, 1 to 8192 characters |

The allowlist is positive, not a blocklist: at most eight commands, no Move
call except `demo_binary_pool::enter` and `agent_registry::register_staked_agent`
in the deployed package (plus the `0x2::coin` helpers the SDK emits to
assemble the stake), no reference to the gas coin, no withdrawal naming the
sponsor instead of the sender. The gas budget is capped server-side at
50,000,000 MIST, and the package id comes from the engine's own manifest,
never from the request.

```json
{ "txBytes": "…", "sponsorSignature": "…", "txDigest": "…", "expireAtTime": 1788500000 }
```

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | | gas attached and signed |
| 400 | `sponsor_rejected` | the body or the transaction kind failed the allowlist; the message says why |
| 403 | `writes_disabled` | |
| 429 | `rate_limited` | |
| 502 | `sponsor_failed` | the gas station returned an error |
| 503 | `sponsor_unavailable` or `engine_not_wired` | no `SHINAMI_GAS_ACCESS_KEY` configured |
| 500 | `internal_error` | |

### POST /api/evidence

Submit an evidence artifact or source URL against a claim. Guards: public
writes flag, rate limit. **This handler is a stub in the current build**: it
validates the body, touches the engine and returns 201, but persists nothing.
Evidence in production is gathered by the engine's own retriever.

| Field | Required |
| --- | --- |
| `claimId` | yes, a string |
| `url` or `text` | at least one of the two |

| Status | Code |
| --- | --- |
| 201 | `{ "success": true }` |
| 400 | `validation_error` |
| 403 | `writes_disabled` |
| 429 | `rate_limited` |
| 503 | `engine_not_wired` |
| 500 | `internal_error` |

### POST /api/claims (operator only)

Create a claim directly on chain, bypassing the fact-check front door. The
engine signs with the operator key, so this route needs
`Authorization: Bearer <OPENVERDICT_OPERATOR_TOKEN>`.

| Field | Limits |
| --- | --- |
| `statement` | non-empty, at most 2000 characters |
| `resolutionCriteria` | non-empty, at most 4000 characters |
| `mode` | `1` DIRECT_REVIEW or `2` OPTIMISTIC_SETTLEMENT |
| `deadlines` | all eight keys, each a positive safe integer in milliseconds: `evidenceCutoffMs`, `proposalDeadlineMs`, `challengeDeadlineMs`, `firstCommitDeadlineMs`, `firstRevealDeadlineMs`, `discussionDeadlineMs`, `secondCommitDeadlineMs`, `secondRevealDeadlineMs` |
| `committeeBudget`, `evidenceBudget` | decimal strings of 1 to 18 digits, in MIST |

| Status | Code | Meaning |
| --- | --- | --- |
| 201 | | `{ claimId, digest }` |
| 400 | `validation_error` | the message names the offending field |
| 403 | `forbidden` | missing, weak or wrong bearer token |
| 503 | `engine_not_wired` | |
| 500 | `internal_error` | |

## Ids and links

Claim, run, seat, agent profile, certificate and evidence ids are 66-character
lowercase hex. Transaction digests are base58; Walrus blob ids are base64url.

| What | URL pattern |
| --- | --- |
| Claim page | `https://app.openverdict.info/claims/<claimId>` |
| Report page | `https://app.openverdict.info/claims/<claimId>/report` |
| Queue page | `https://app.openverdict.info/fact-check/queue/<queueId>` |
| Evidence page | `https://app.openverdict.info/evidence/<evidenceId>` |
| Agent page | `https://app.openverdict.info/agents/<agentProfileId>` |
| Board, submit, verify, agents, risk | `/claims`, `/fact-check`, `/verify`, `/agents`, `/risk` |
| Sui object | `https://suiscan.xyz/testnet/object/<objectId>` |
| Sui transaction | `https://suiscan.xyz/testnet/tx/<digest>` |
| Walrus blob | `https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>` |
| GonkaRouter receipt | `https://api.gonkarouter.io/v1/receipts/<gatewayRequestId>` |

There is no page at `/claims/<id>/runs/<runId>`: run detail is a panel on the
claim page. The auditor and the CLI accept that shape as an input link and
audit the whole claim while highlighting that run.

On-chain claim states, as returned in `state`:

| Value | Name | Value | Name |
| --- | --- | --- | --- |
| 0 | CREATED | 7 | COMMIT_2 |
| 1 | PROPOSED | 8 | REVEAL_2 |
| 2 | CHALLENGED | 9 | FINALIZED_UNCHALLENGED |
| 3 | REVIEW_REQUESTED | 10 | FINALIZED_REVIEWED |
| 4 | COMMIT_1 | 11 | UNRESOLVED |
| 5 | REVEAL_1 | 12 | CANCELLED |
| 6 | DISCUSSION | | |

States 1, 2 and 9 belong to the optimistic (bonded) pathway. Vote outcome
codes are 1 YES, 2 NO, 3 UNSURE; claim results add 4 UNRESOLVED. Claim modes
are 1 DIRECT_REVIEW and 2 OPTIMISTIC_SETTLEMENT.

## CLI exit codes and HTTP statuses

`pnpm ov <command>` maps HTTP responses onto these exit codes:

| Exit | Meaning | HTTP status behind it |
| --- | --- | --- |
| 0 | success; for `watch`, the claim finalized | 200, 201, 202 |
| 1 | `audit` only: at least one check FAILed | any (the failure is in the recomputation, not the transport) |
| 2 | input or request error, one `error: ...` line on stderr | 400, 404, and any transport failure |
| 3 | `watch` only: the attempt voided or the verification gave up | 200 (the state came from the claim record) |
| 4 | `watch` only: stopped before the end, `--for` reached | 200 |
| 5 | `submit` and `extract` only: rate limited or public writes disabled | 429, 403 |

`ov audit` and `pnpm audit:claim` share exit codes 0, 1 and 2: 0 when every
check passed, was UNAVAILABLE or was SKIPPED, 1 on any FAIL, 2 on an input or
fetch error. A source outage marks a check UNAVAILABLE with a manual URL, and
never FAIL.

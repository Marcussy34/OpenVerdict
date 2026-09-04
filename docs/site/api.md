---
title: Public API
description: The live event stream catalogue, then every route under /api with its limits and status codes, rendered from docs/API.md.
order: 5
source: docs/API.md
---

Base URL of the production deployment: `https://app.openverdict.info/api`.
Every read route is open. The write routes sit behind a public-writes flag plus
rate limiting.

This page opens with the event stream catalogue, which the route reference
below does not enumerate, and then renders `docs/API.md` from the repository at
request time, so the reference here and the reference in the source tree are
the same file. Links that point into the repository open on GitHub.

## The live event stream

`GET /api/claims/<id>/events` is a Server-Sent Events stream. Add
`?snapshot=1` for the same events as one JSON body instead. Resume with a
`Last-Event-ID: N` header, which starts at `N + 1`, or with `?from=N`, which
starts at `N` inclusive. A `: heartbeat` comment goes out every fifteen
seconds. Events are unnamed, so a browser receives them through
`EventSource.onmessage`.

### The envelope

| Field | Type | Always present |
| --- | --- | --- |
| `eventId` | string | yes |
| `claimId` | string | yes |
| `sequence` | number, 1-based and unique per claim | yes |
| `phase` | string | yes |
| `kind` | string | yes |
| `source` | `ENGINE`, `GONKA_ROUTER`, `TOOL`, `EVIDENCE` or `SUI` | yes |
| `visibility` | always `PUBLIC_NOW` on the wire | yes |
| `actorId` | string, the agent profile id | no |
| `runId` | string | no |
| `occurredAt` | ISO 8601 UTC | yes |
| `publishedAt` | ISO 8601 UTC | yes on the wire |
| `transactionDigest` | string | no |
| `checkpoint` | number | no |
| `artifactHash` | `0x` hex | no |
| `payload` | object, one shape per `kind` | yes |

Source: `lib/engine/contract.ts:38-54`, framed at
`app/api/claims/[id]/events/route.ts:86`.

**Three filtering rules apply on the way out**
(`lib/events/index.ts:41-136`), and they matter if you are comparing the stream
to the database:

1. **`visibility` is rewritten to `PUBLIC_NOW` on every published event.** The
   other two values, `PUBLIC_AFTER_REVEAL` and `INTERNAL_REDACTED`, exist only
   in the engine's own store. An internal event is never published at all.
2. **Five kinds are reveal-gated by kind**, whatever their stored visibility:
   `inference_started`, `inference_completed`, `tool_call_started`,
   `tool_call_completed` and `argument_published`. A gated event whose run has
   not revealed does not publish.
3. **Payloads are filtered.** `agent_activity` is reduced to an allowlist,
   `research_step` has its query truncated to 300 characters and its URL lists
   capped at ten entries, and every other kind passes through a redactor that
   recursively drops keys matching salt, secret, private key, API key, chain of
   thought, raw prompt or full prompt.

### Every event kind

| Kind | Emitted when | Payload fields |
| --- | --- | --- |
| `claim_created` | the claim object is created on Sui | `claim_id`, `claim_mode`, `package_id`, `transaction_digest`, `checkpoint`, `policy_id`, `coin_type_hash` |
| `proposal_submitted` | an outcome is proposed on an optimistic claim | `claim_id`, `outcome`, `transaction_digest`, `amount` |
| `challenge_submitted` | a proposed outcome is challenged | `claim_id`, `transaction_digest`, `reason_blob_id`, `amount` |
| `committee_selected` | the draw settles, and again on a crash-recovery catch-up | `claim_id`, `committee_id`, `first_round_tally_id`, `agent_profile_ids`, `jury_seat_ids`, `transaction_digest`, `timing_ms` |
| `evidence_submitted` | one evidence submission is stored | `claim_id`, `evidence_id`, `source_class` |
| `evidence_retrieved` | an evidence fetch finishes, success or not | `evidence_id`, `status`, `latency_ms`, `bytes` |
| `evidence_frozen` | the phase manifest is archived and frozen on chain | `claim_id`, `phase`, `evidence_bundle_id`, `root`, `manifest_blob_id`, `transaction_digest`, `timing_ms` |
| `inference_started` | a seat's inference is about to be issued | `run_id`, `agent_id`, `provider_id`, `model_id`, `attempt`. Internal only |
| `agent_activity` | coarse public seat status | `genericStage`, `status`, `latencyMs` |
| `research_step` | one recorded step of the research loop | `claim_id`, `jury_seat_id`, `agent_profile_id`, `run_id`, `phase`, `ordinal`, `kind`, and optionally `intent`, `query`, `urls`, `result_domains`, `page_count` |
| `RESEARCH_TICK` | the legacy twin of `research_step`, search and open only | `jurySeatId`, `kind`, `ordinal` |
| `output_repaired` | the validator dropped unsupported claims from an output | `claim_id`, `jury_seat_id`, `agent_profile_id`, `run_id`, `phase`, `field`, `dropped` |
| `inference_failed` | a seat produced no valid inference | `run_id`, `category`, `retry_count` |
| `run_approved` | the sealed run hash is approved on chain | `run_id`, `agent_profile_id`, `jury_seat_id`, `run_approval_id`, `run_hash`, `transaction_digest`, `timing_ms` |
| `vote_committed` | a commitment lands on chain | `claim_id`, `phase`, `agent_profile_id`, `jury_seat_id`, `transaction_digest`, `timing_ms` |
| `vote_revealed` | a reveal lands and enters the tally | `claim_id`, `phase`, `round_tally_id`, `agent_profile_id`, `jury_seat_id`, `revealed_vote_id`, `outcome`, `confidence_bps`, `valid`, `transaction_digest`, `timing_ms` |
| `inference_completed` | right after that reveal, publishing the model output | `run_id`, `gonka_request_id`, `model_id`, `latency_ms`, `schema_status`, `token_usage`, `output` |
| `argument_published` | right after that reveal, publishing the reasoning | `claim_id`, `phase`, `agent_id`, `gonka_request_id`, `argument_hash`, `reasoning_trace_hash`, `evidence_ids`, `reasoning`, `public_reasoning_trace` |
| `DELIBERATION_TURN` | one public debate turn is persisted | the whole public turn: `claimId`, `jurySeatId`, `agentProfileId`, `modelId`, `ordinal`, `exchange`, `stance`, `confidenceBps`, `specVersion`, `answering`, `theirPoint`, `analysis`, `question`, `position`, `argument`, `citations`, `status`, `failureStatus`, `atMs` |
| `debate_converged` | the debate stopped moving after an exchange | `claim_id`, `exchange` |
| `phase_changed` | the claim advances to a new state | `claim_id`, `previous_phase`, `new_phase`, `checkpoint`, `transaction_digest` |
| `claim_finalized` | the certificate settles | `claim_id`, `certificate_id`, `outcome`, `reviewed`, `truth_score_bps`, `transaction_digest`, `timing_ms` |
| `verification_voided` | an attempt is voided | `claim_id`, `verification_id`, `attempt`, `reason`, `message`, `jury_seat_id`, `model_id`, `phase` |
| `verification_relaunched` | attempt 2 or 3 starts and links to the voided one | `claim_id`, `verification_id`, `attempt`, `relaunched_as`, `next_attempt` |
| `verification_gave_up` | the chain gives up | `claim_id`, `verification_id`, `attempt`, `reason` |

Every kind above is emitted through one helper, `Engine.emit`
(`lib/engine/engine.ts:4810-4845`), which drops payload keys whose value is
undefined before storing. The route reference below documents the transport and
the envelope at `docs/API.md` lines 303 to 366; its list of kinds is an
open-ended example rather than a catalogue, so this table is the complete one.

Two notes for an indexer. `payout_withdrawn` exists in the chain-reader's
vocabulary but no live code path emits it. And `tool_call_started` and
`tool_call_completed` appear in the reveal-gate set but are never emitted
either, so do not wait on them.

---

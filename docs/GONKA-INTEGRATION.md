# GonkaRouter integration

How OpenVerdict runs every piece of AI reasoning on the Gonka Network
through the official gateway (gonkarouter.io), and how a judge can verify
that claim independently in about two minutes.

## The short version

Every juror inference in every verification runs on GonkaRouter. There is
no other inference path in the codebase: no OpenAI, no Anthropic, no local
model, no fallback provider. The jury is five seats drawn across three
Gonka-hosted model families (DeepSeek, Kimi, MiniMax), each seat votes
independently under commit-reveal, and every single model turn's gateway
request id is recorded, sealed, revealed and shown in the UI.

## Where the integration lives

| Piece | Path |
| --- | --- |
| Gateway adapter (OpenAI-compatible client for gonkarouter.io) | `lib/gonka/adapter.ts` |
| Prompt specs and tool policies (hashed into on-chain juror manifests) | `lib/gonka/promptSpec.ts` |
| Juror research loop (search, open pages, cite, two-sided checks) | `lib/research/` |
| Engine orchestration (seats, hedging, sealing, commit-reveal) | `lib/engine/engine.ts` |
| Receipts cross-check relay | `app/api/gateway-receipts/[requestId]/route.ts` |
| Claim extraction from a pasted URL (Gonka-powered input assist) | `app/api/extract-claim/route.ts` |

## What the adapter guarantees

- **Model pinning.** Every request sends `X-Gonka-No-Fallback: true`, so a
  saturated model returns a real 429 instead of silently substituting a
  different model. Our retry and hedging logic absorbs the 429; a
  substitution can never be recorded as the requested juror. If the
  gateway ever reports a fallback via `X-Gonka-Fallback`, that notice is
  captured into the run's audit record.
- **Identity capture.** For every completion the adapter records the
  gateway `x-request-id`, the `x-devshard-id`, the completion id (the
  `devshard-<n>-<seq>` shape, kept verbatim as the Gonka request id) and
  the node `system_fingerprint`. These land in the sealed run bundle and
  on the public run view, per turn, not just per run.
- **Neutrality by prompt and by protocol.** The system prompts require
  evidence for and against from primary sources with mandatory citations;
  the prompt text is hashed over canonical JSON and bound into each
  juror's on-chain manifest, so the exact instructions are provable and
  immutable. A verdict without a verifiable citation fails closed and is
  never counted.
- **Models never fetch.** All web research is executed by the engine
  (SSRF-guarded, size-capped) and recorded; the models only read recorded
  content. Salts and seal keys never leave the engine.

## Multi-model consensus

Five seats across at least three model families are drawn with Sui native
randomness. Each seat researches independently and commits a sealed
blake2b-256 vote on-chain before any vote is revealed, so no model can see
or anchor on another's answer. A 4-of-5 supermajority settles; a split
jury triggers a discussion round and a second sealed vote; a still-split
jury settles as UNRESOLVED rather than forcing an answer. The Truth Score
(0 to 100) is the confidence-weighted aggregate of the revealed votes and
is minted into the on-chain resolution certificate.

## How to verify our Gonka usage yourself

1. Open any finalized claim and click a juror, then "Open proof". The run
   provenance shows the requested model, served model, devshard, system
   fingerprint and gateway request id; the research trail repeats them per
   turn.
2. Press "Check with GonkaRouter". The page cross-checks the recorded
   request id against GonkaRouter's public receipts endpoint
   (`GET https://api.gonkarouter.io/v1/receipts/<x-request-id>`, no auth)
   and prints the direct URL so you can bypass our server entirely. The
   receipt confirms model, devshard, timing and outcome for that exact
   request: proof the inference ran on the Gonka network, not on a
   centralized server we control.
3. Open the claim's full report for the on-chain record (claim, committee,
   certificate and revealed-vote objects on Suiscan; sealed and revealed
   bundles on Walrus), or use the Audit page to recompute every hash in
   your own browser.

## Claim extraction (URL input)

Pasting a page URL into the verify bar calls `POST /api/extract-claim`:
the engine fetches the page through its SSRF-guarded evidence fetcher,
sends the text to a Gonka-hosted model at temperature 0, and returns the
single most check-worthy claim as one falsifiable sentence together with
the Gonka request id of the extraction call itself. The user confirms or
edits the claim and submits it through the normal statement-only path; the
jurors then research it from scratch, so the submitter's page never
becomes privileged evidence.

Live example (2026-08-31, production): posting
`{"url":"https://simple.wikipedia.org/wiki/Bitcoin"}` returned
"In June 2021, El Salvador became the first country in the world to make
Bitcoin a legal tender." with modelId `deepseek-ai/DeepSeek-V4-Flash-0731`,
gonkaRequestId `devshard-67806-387` and gatewayRequestId
`req-1788185908680461519-129576`, both checkable against GonkaRouter's
public receipts endpoint.

# Attested inference: closing the last trust gap

Date: 2026-08-30 evening. Status: design decided by the acting lead; the
re-execution check is being built now; the enclave is the next milestone;
the signed receipt is a request to the network.

## The gap, stated precisely

Every artifact of a juror run is anchored: the prompt spec hash sits in the
juror's on-chain profile, the run hash (input, output, transcript, policy)
is written on chain by `approve_run` before any vote is revealed, and the
sealed bundle on Walrus opens at reveal to the full message list, the raw
replies, the page hashes and the router ids of every turn. A reader can
prove the record is internally consistent and was fixed before the vote.

What no reader can prove today is that the bytes in the record are the
bytes the model received, or that the pages in the record are the pages
the web returned. Both are attested only by the operator's engine, which
is the party that built them. GonkaRouter's replies carry `x-request-id`,
`x-devshard-id`, `id` (devshard-<n>-<seq>) and `system_fingerprint`, all
recorded, but nothing signed (checked 2026-08-30 21:00: the body also has
an empty `prompt_text` field, which a node could echo but which would not
be a signature). Gonka's network verifies a random sample of inference
tasks internally (its Randomized Task Verification), which protects the
network's own rewards, not a client's audit trail.

## Four measures, in order of practicality

1. Signed inference receipt (network side, no code on our side except a
   slot). Ask GonkaRouter to return, per request, a signature by the
   serving node over `{requestHash, responseHash, model, requestId,
   timestamp}` plus the node's public key or its identity on Gonka's
   chain. The bundle gets an optional `gateway.receipt` field carrying the
   signed statement; the verifier recomputes the request hash from
   `request.messages` and the response hash from the raw reply, checks the
   signature against the node key, and adds a "node receipt" check. Until
   the network provides it the check reads "not offered by the provider".
   Draft request to send to the GonkaRouter team is at the end.

2. Re-execution check (built 2026-08-30 evening, commit `9e2dd98`; the run
   view and /verify show it as "Re-run this juror"). `POST /api/claims/<id>/runs/<runId>/reexecute`
   resends the recorded messages to the recorded model at temperature 0 and
   the recorded settings, and reports the fresh verdict, output hash, node
   ids and served model next to the recorded ones. A matching verdict is
   strong corroboration; a differing one is a reason to look closer, not
   proof of tampering, because machines on a decentralized network are not
   bit-for-bit identical. Public, rate limited, only for revealed runs.

3. Attested engine (next milestone; owner deferred it on 2026-08-30).
   Hosting, confirmed from docs.sui.io/sui-stack/nautilus on 2026-08-30
   23:20: Nautilus supports self-managed AWS Nitro Enclaves and, through
   the community tool Marlin Oyster, Dockerized Nautilus apps deployed
   with only a Docker image, the Oyster CLI and Sui: Oyster operators
   provision the Nitro enclave and the attestation, jobs are paid in
   stablecoin, no AWS account is needed, and the cryptographic guarantees
   are the same (Sui documents the workflow and a reference app,
   github.com/marlinprotocol/sui-oyster-demo). Nautilus-Ops is a CLI for
   the self-managed path (build and deploy enclave images, register on
   chain, verify signatures). Run the request path inside a trusted
   enclave using Sui's Nautilus pattern (AWS Nitro Enclave; the enclave's
   attestation document is verified on chain and its signing key
   registered). The smallest useful enclave is a "prompt forwarder": the
   engine hands it the message list and the target model; the enclave
   hashes the messages, sends the request to GonkaRouter itself, hashes the
   reply, and returns `{requestHash, responseHash, model, requestId,
   devshardId, fingerprint, timestamp}` signed by the enclave key. The
   bundle carries the signature; the verifier checks it against the key
   registered on Sui. This proves our side (the recorded messages are what
   the audited code sent) without any help from the network. Extending the
   same forwarder to the Firecrawl calls attests the pages as well. Scope:
   a Rust or Node enclave app, the Nautilus Move verification, an EC2
   Nitro-capable instance (about $30 to $60 a month), and a policy version
   whose bundles require the signature. Estimate: two to four days.

4. Independent operators (the protocol's direction). When several parties
   each run their own engine for the same committee, a single dishonest
   record disagrees with the others. This needs the multi-owner seat model
   already described in the PRD and is not a near-term item.

## What each measure proves

| Measure | Proves the model got these bytes | Proves the pages are real | Who must act |
|---|---|---|---|
| Signed receipt | yes (node-signed) | no | GonkaRouter / Gonka |
| Re-execution | soft (same verdict on rerun) | no | nobody (built) |
| Attested engine | yes (enclave-signed) | yes, if the forwarder also fetches pages | us |
| Independent operators | yes, by disagreement | yes | protocol |

## Draft request to GonkaRouter

"We run an audited fact-checking jury on GonkaRouter and publish every
run's request hash, response hash, request id and devshard id on Sui and
Walrus. To make the record independently verifiable we need a per-request
receipt signed by the serving node: the hash of the request body, the hash
of the response body, the model, the request id and a timestamp, signed by
a key that can be matched to the node's identity on Gonka's chain (or by a
router key with a published rotation). A response header or a field in the
completion body both work. Is this available or planned?"


## Update 2026-08-31: request lookup is live

The GonkaRouter team shipped the public lookup the same day it was asked
for: `GET https://api.gonkarouter.io/v1/receipts/{x-request-id}` (no auth,
metadata only: model, devshard, created_at, outcome, status, combined
total_tokens, ttft, duration; rate limited per IP). The run view now
cross-checks every revealed run's recorded request id against it
(`components/claim/run-proof-receipt.tsx`, relay route
`app/api/gateway-receipts/[requestId]`), and prints the direct URL so a
third party can bypass us. Signed receipts remain on their roadmap (they
will propose a format; streaming needs a trailer design); Kimi capacity
improvements are planned with judging days in mind.

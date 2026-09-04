---
title: Trust model
description: What lives on chain, on Walrus and in the operator's database, what an audit recomputes, and the exact limits of what it proves.
order: 3
---

OpenVerdict certifies a process, not universal truth. This page says exactly
which parts of that process anyone can check from public data, which parts rest
on the operator, and where the boundary between the two runs.

## Where each fact lives

### On Sui

Every object below is created by the deployed Move package. Objects marked
frozen are immutable once written.

| Object | Ownership | What it carries |
| --- | --- | --- |
| `Claim<T>` | shared | protocol version, mode, creator, `content_hash`, statement and criteria blob ids, links to the evidence bundles, committee, tallies and certificate, the seven deadlines, proposer and challenger, result, state and five budget vaults |
| `EvidenceBundle` | frozen | claim id, phase, 32-byte root, manifest blob id and object id, source count, policy id, Walrus end epoch |
| `Committee` | shared | claim id, the five profile ids and owners, the two reserves, selection time, locked flag |
| `JurySeat` | owned by the seat's operational key | claim id, committee id, profile id, owner, phase, bound evidence root, commitment, run hash, status |
| `RoundTally` | shared | claim id, committee id, phase, evidence root, expected seat ids, committed count, revealed seats and votes, YES / NO / UNSURE counts, truth probability sum and count, closed flag |
| `RunApproval` | owned, consumed once | claim id, committee id, seat id, profile id, owner, run hash, run and tool blob ids and object ids, Walrus end epoch, phase |
| `RevealedVote` | frozen | claim id, committee id, seat id, profile id, phase, outcome, confidence, evidence root, output hash, run hash, argument blob id and object id, reveal time |
| `ResolutionCertificate` | frozen | claim id, package version, result, Truth Score, committee id, evidence bundle ids, revealed vote ids, finalize time |
| `AgentProfile` | shared | operational owner, manifest hash and blob id, staker hash, model hash, role hash, bond, active flag, reputation |
| `StakePosition` | owned by the staker | profile id, staker address, amount |
| `PayoutTicket<T>` | owned by the recipient | claim id, recipient, amount, reason |

The events are the audit trail: `ClaimCreated`, `OutcomeProposed`,
`OutcomeChallenged`, `EvidenceFrozen`, `CommitteeSelected`, `RunApproved`,
`VoteCommitted`, `VoteRevealed`, `ClaimFinalized`, `ClaimUnresolved`,
`PayoutTicketCreated`, `PayoutWithdrawn`, `AgentRegistered`,
`AgentManifestUpdated`, `AgentStaked`, `UnstakeRequested` and `Unstaked`.

One indexing note: `CommitteeSelected` is emitted twice per two-round claim,
once for each round, and in the second emission the `first_round_tally_id`
field carries the second-round tally id. An indexer has to disambiguate by
phase.

### On Walrus

| Blob | Referenced from chain by |
| --- | --- |
| Claim statement text | `Claim.statement_blob_id` |
| Resolution criteria text | `Claim.criteria_blob_id` |
| Raw and canonical copies of every page a juror opened | hashed into the manifest, not individually on chain |
| Evidence manifest, the Merkle leaves behind a frozen root | `EvidenceBundle.manifest_blob_id` |
| Sealed run bundle, published before the commit | `RunApproval.run_blob_id` and `tool_blob_id` |
| Revealed run bundle, the plaintext record | `RevealedVote.argument_blob_id` |
| Debate transcript | inside the phase-two evidence root |
| Round-one public record | inside the phase-two evidence root |
| Failure record for a seat that failed closed | public, with no chain object |
| Juror manifest document | `AgentProfile.manifest_blob_id`, hashed into `manifest_hash` |

Blob ids are base64url and any of them can be fetched from the public
aggregator at
`https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>`.

Every hash in the system is blake2b-256, and the TypeScript and Move
implementations are held byte-identical by parity vectors in both test suites.

### In the operator's database

The engine keeps a Postgres projection of everything above, plus its own
bookkeeping. The dashboard is a read-only projection: stop it and the CLI keeps
working, because the auditor reads only Sui, Walrus and the public API.

Four things are genuinely operator-only:

1. **Salts, in plaintext.** Vote salts sit in a plain text column on testnet.
   This is disclosed and must be encrypted at rest before any mainnet use.
2. **Reveal keys before publication.** The engine holds each run's AES key
   until the reveal. The Seal escrow below is the mitigation.
3. **The weather probe history and the submission queue.** Both have public
   read endpoints but no chain or Walrus backing.
4. **Stake reservations.** Pre-transaction bookkeeping only.

Everything else in the database is re-derivable from Sui objects and events
plus Walrus blobs, which is exactly what the auditor does with no database
access at all.

## What an audit recomputes

The auditor lives at `lib/audit/audit-claim.ts` with the run-level
recomputation in `lib/verify/run-proof.ts`. It reads only public sources: the
app's public API, Sui JSON-RPC, the Walrus aggregator and GonkaRouter's public
receipts. It needs no key, no wallet and no database.

Each check reports `PASS`, `FAIL`, `UNAVAILABLE` or `SKIPPED`. **Only `FAIL` is
blocking.** A public source that does not answer marks a check `UNAVAILABLE`
with a manual URL and never fails the audit. A check that does not apply to
this run is `SKIPPED`.

### C1 to C3, one set per vote per phase

| Id | Check |
| --- | --- |
| C1 | The commitment on chain equals the record. The `VoteCommitted` event's bytes match the commitment the audit bundle carries. |
| C2 | The commitment recomputes from the reveal. Rebuilding the preimage from the reveal transaction's own inputs, plus the claim, profile, seat, phase and evidence root, and hashing it, reproduces C1. This is the check no human can do by hand. |
| C3 | The reveal matches the report. The outcome and confidence in the reveal transaction equal the ones the public report shows. |

All three are `SKIPPED` for a seat that never committed, with a detail naming
the failure status that stopped it.

### R1 to R18, one set per juror run

R1 to R15 come from the run proof recomputation; R16 to R18 are added by the
claim-level auditor.

| Id | Check |
| --- | --- |
| R1 | Prompt hash: the canonical hash of the prompt spec equals the recorded prompt hash in the proof, the bundle and the audit block. |
| R2 | Tool policy hash: the canonical hash of the tool policy equals the recorded one. Research runs only. |
| R3 | System prompt: the composed system prompt hashes to the hash of the first message actually sent. |
| R4 | Input hash: the canonical hash of the juror input equals the recorded one. |
| R5 | Output hash: the canonical hash of the validated output equals the recorded one. |
| R6 | Tool transcript hash: the canonical hash of the research transcript equals the recorded one. On a table vote the expected value is the empty-transcript constant. |
| R7 | Citations: every citation references a page the run opened, the quotes were found in that page's archived text, and they independently support a YES or a NO. On a table vote, every evidence id is one frozen in the phase-two manifest. |
| R8 | Challenge search present, for a YES or a NO. |
| R9 | Both sides opened, at least `minOpensPerSide` per side. |
| R10 | Citations span at least `minCitationDomains` distinct sites. |
| R11 | Counter-evidence summary present for a YES or a NO. |
| R12 | Opens per turn within the policy's `maxOpensPerTurn`. |
| R13 | Run hash: the BCS of the run record hashes to the recorded run hash. |
| R14 | Seal escrow binds this run: the identity decodes to this claim, seat and phase, its deadline equals the claim's reveal deadline for that phase, the additional authenticated data names the run id, and the package id, threshold and key servers match the release manifest. |
| R15 | Sealed core: decrypting the sealed blob with the revealed key reproduces the recorded core hash and the revealed bundle. |
| R16 | The run hash was approved on chain before the commitment, and equals the reveal transaction's run hash. |
| R17 | Provider receipt: GonkaRouter's public receipt for the recorded request id exists, its model equals the served model, its devshard matches, and its timestamp falls inside the run window. |
| R18 | The revealed blob (or the sealed blob for an unrevealed seat) is reachable on the Walrus aggregator. |

Two details worth knowing. When a run has no proof at all, because the seat
failed closed or its bundle is still sealed, the auditor emits one umbrella row
with the id `R1-R18` rather than eighteen empty rows; when the recomputation
throws, it emits `R1-R15` as a single `FAIL`. And a table-vote run does not
emit R2 at all, while R8 to R12 come back `SKIPPED`, because those five checks
only mean something for a run that used tools.

### S1 to S4, claim level

| Id | Check |
| --- | --- |
| S1 | The Truth Score recomputes from the valid final-round reveals and equals the certificate and the report. |
| S2 | The certificate object exists on Sui and its `result` and `truth_score_bps` fields equal the report. |
| S3 | The quorum rule holds: four matching valid reveals settle YES or NO, otherwise UNRESOLVED. |
| S4 | Per phase, the evidence root agrees across the `EvidenceFrozen` event, the seats' bound root and the record, and the manifest blob is reachable on Walrus with the root recomputing from it where the format allows. |

S4 is two rows per phase, one for the root agreement and one for the manifest.

### D1 to D3, two-round claims only

| Id | Check |
| --- | --- |
| D1 | The debate transcript exists, with every turn listed by seat, exchange, stance, confidence and whether it was spoken or skipped. |
| D2 | The transcript is frozen inside the phase-two evidence root. |
| D3 | Every table-vote run binds the pinned table-vote prompt hash. |

## What the audit proves

Quoting the auditor's own summary, printed under the heading "What this audit
proves and what it does not":

> This audit proves, from public data only:
>
> - every counted vote was committed on Sui as a hash before any reveal, and
>   the hash recomputes from the revealed vote, so no vote was changed after
>   the fact;
> - each juror run is bound to its prompt, input, output, tool transcript and
>   evidence root by the run hash the chain approved before the vote;
> - the provider's own receipt confirms the model and shard for each run;
> - the score is plain arithmetic over the reveals;
> - the certificate on Sui carries that result.
>
> It does not prove:
>
> - that the model's reasoning is correct; that is what the evidence trail and
>   the sealed research are for, read them;
> - that the web sources are true;
> - that the operator could not have withheld a claim from the jury; a
>   withheld claim simply has no certificate.

## What it does not prove: the receipt gap

The honest gap is stated in `docs/superpowers/specs/2026-08-30-attested-inference-design.md`:

> What no reader can prove today is that the bytes in the record are the bytes
> the model received, or that the pages in the record are the pages the web
> returned. Both are attested only by the operator's engine, which is the party
> that built them.

A gateway-signed receipt would close half of that. It would be a per-request
signature by the serving node over the request hash, the response hash, the
model, the request id and the timestamp, verifiable against the node's public
key. The verifier would recompute both hashes from the recorded messages and
the raw reply and check the signature. GonkaRouter's replies today carry
`x-request-id`, `x-devshard-id`, an `id` and a `system_fingerprint`, all
recorded, but nothing signed. Signed receipts are on the gateway's roadmap.

Three things stand in for it in the meantime:

1. **The public request lookup.** `GET https://api.gonkarouter.io/v1/receipts/{x-request-id}`
   needs no auth and returns metadata only: model, devshard, creation time,
   outcome, status, total tokens, time to first token and duration. The auditor
   cross-checks it as R17 on every revealed run.
2. **Re-execution.** `POST /api/claims/<id>/runs/<runId>/reexecute` resends the
   recorded messages to the recorded model at temperature 0 and the recorded
   settings, and reports the fresh verdict, output hash, node ids and served
   model next to the recorded ones. A matching verdict is strong corroboration;
   a differing one is a reason to look closer, not proof of tampering, because
   machines on a decentralized network are not bit-for-bit identical. The audit
   does not run it, and the repository calls it soft corroboration everywhere
   it appears.
3. **An attested forwarder.** Running the engine inside a Sui Nautilus enclave
   would close both halves, including the pages. It is the next milestone and
   it is not built.

## What the operator can and cannot do

The operator **cannot**, without breaking a hash anyone can recompute:

- pick the jurors: the draw is on-chain randomness inside one transaction;
- change a vote after its commitment: the reveal must rebuild the same hash;
- swap evidence after the freeze: the bundle is a frozen object;
- edit the result or the score: the certificate is frozen and the score is
  arithmetic over public reveals;
- invent a vote for a failed seat: a seat with no reveal has no `RevealedVote`;
- substitute a model: the served model is in the sealed bundle and in the
  gateway's own receipt;
- rewrite a bundle or a page: both are content-addressed on Walrus;
- keep a sealed bundle closed after the deadline: the Seal escrow opens it;
- steer a seat's prompt: the prompt hash is pinned in the on-chain manifest and
  bound into the run hash.

The operator **can**, and this is disclosed rather than defended:

- run the whole pipeline upstream of the commitment, because the run attestor
  and evidence freezer capabilities are single and team-held;
- decide when claims launch, through the queue and the weather gate, and pause,
  deploy or simply fail to run;
- hold Seal keys and salts in plaintext in the testnet database.

The repository's own summary: inference re-execution is corroboration rather
than cryptographic proof until gateway-signed receipts land, and the operator
is detectable rather than impossible, unable to forge the record without
breaking hashes anyone can check.

## The Seal escrow

Each run's AES key is the reveal key. At commit time it is encrypted under
Mysten's Seal and the escrow record rides inside the sealed bundle on Walrus,
which the chain already cites through `RunApproval`.

The policy is the whole of `openverdict_seal::reveal_lock`:

```move
entry fun seal_approve(id: vector<u8>, clock: &Clock) {
    let deadline_ms = identity_deadline_ms(id);
    assert!(clock.timestamp_ms() >= deadline_ms, ENotYetOpen);
}
```

The identity is 73 BCS bytes:
`claim id (address) || jury seat id (address) || phase (u8) || reveal deadline ms (u64)`.
The deadline is the claim's first or second reveal deadline for that phase, and
the additional authenticated data is the run id.

After the reveal deadline anyone can open a sealed bundle with a throwaway
keypair, no wallet and no gas, because the policy ignores the caller entirely.
Before the deadline the key servers refuse, which is the point. If the seat did
reveal, the recovered key must equal the published one, and that equality is
shown as a check.

**Escrow is insurance, never a gate.** If Seal encryption fails because the key
servers are unreachable, the engine logs it and seals without escrow. The
escrow is the single place in the protocol that fails open; everything else
fails closed. A bundle without an escrow verifies exactly as before, minus R14.

## Fail-closed rules

Malformed or unverifiable output becomes no vote, never a vote. The governing
invariant: models never fetch, never hold keys and never hold transaction
authority; every URL they see or open is engine-executed and recorded in the
sealed transcript; salts and seal keys never leave the engine.

1. **Unverifiable citation.** A juror may cite only pages it opened in that run
   or evidence ids from the frozen manifest. A quote must be an exact sentence
   from the archived page text; one the engine cannot find is blanked and
   recorded as not found. A YES or NO without a valid citation fails closed.
2. **Strict schema.** Outputs are validated against a strict JSON schema with
   at most two repair rounds. Still invalid means the seat fails in public and
   the attempt is voided.
3. **Unsupported claims repair.** Prose written where an evidence id belongs is
   dropped, recorded in the transcript and emitted as a public event. The vote,
   the confidence and every other evidence array still fail closed.
4. **The two-site rule.** A YES or NO needs citations from at least two
   different sites, at least one found by the juror's own search, plus a
   completed challenge search whose most credible result was opened. Otherwise
   the juror must answer UNSURE.
5. **No model substitution.** Every call carries a no-fallback header and the
   served model must equal the manifest model. A mismatch is a provider error,
   never a vote.
6. **No provider fallback.** The adapter refuses any base URL outside
   gonkarouter.io. A seat that cannot reach the gateway fails closed.
7. **Manifest mismatch.** A run refuses to start unless every seat's manifest
   hashes equal its published document.
8. **Commitment mismatch.** The reveal rebuilds the preimage and aborts unless
   the recomputed hash equals the stored commitment.
9. **All or nothing.** Any juror error at a binding step voids the whole
   attempt. Nothing partial is finalized.
10. **Debate turns.** A turn that breaks the contract is skipped with the
    reason named. A skipped turn is a silent seat, never a repaired one, and it
    does not void the attempt.
11. **The frozen record.** A turn citing anything outside the frozen record is
    rejected, and a table vote may reference only evidence ids frozen in the
    phase-two manifest.
12. **Container restarts.** A restart drops in-flight research and those seats
    fail closed, so deployments happen between claims.

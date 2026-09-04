---
title: How a verdict happens
description: The full lifecycle from claim creation to Resolution Certificate, with the constants and entry functions that govern each step.
order: 2
---

Every stage below names the file and the identifier that implements it. Where
the specification in `docs/PRD.md` and the code disagree, this page follows the
code.

## 1. Claim creation and deadlines

A claim is created by one Sui transaction. Two entry points exist:

- `claim::create_claim<T>` is the general path. It splits the creator's budget
  into three vaults (creation, committee, evidence) and shares a `Claim<T>` in
  state `CREATED`.
- `demo_fact_checker::start_fact_check<T>` is the public fact-check path. It
  creates the claim, marks direct review requested and shares it in one
  transaction, so the claim is born in `REVIEW_REQUESTED`. Its budget is capped
  at `MAX_DIRECT_REVIEW_BUDGET`, one SUI.

The public HTTP entry is `POST /api/fact-checks`. It accepts a statement of 5
to 1000 characters, up to 20000 characters of context text, up to five URLs and
up to 2000 characters of resolution criteria. When no criteria are given the
engine supplies a default public rubric: decide whether the statement is true
as written as of the claim's evidence cutoff, weigh evidence for and against
from primary sources found by the juror's own research, and answer YES or NO
only when credible sources agree.

The claim statement itself never goes on chain as text. What goes on chain is
`content_hash`, the blake2b-256 of the canonical JSON of the statement and the
resolution criteria, plus the Walrus blob ids of both.

### The deadline ladder

A claim carries seven deadlines on chain, and `claim::validate_params` requires
them to be strictly increasing and strictly after now:

```
proposal < challenge < first_commit < first_reveal
        < discussion < second_commit < second_reveal
```

The whole ladder is capped by `MAX_TOTAL_DURATION_MS`, thirty days. The hosted
offsets the engine uses, measured from the create transaction, are set in
`defaultDeadlines`:

| Deadline | Offset from creation |
| --- | --- |
| Evidence cutoff (engine only, never on chain) | 60 s |
| Proposal | 65 s |
| Challenge | 70 s |
| First commit | 600 s |
| First reveal | 720 s |
| Discussion | 1560 s |
| Second commit | 1800 s |
| Second reveal | 1920 s |

A one-round verdict lands about twelve minutes after the submission, a
two-round claim about thirty-two minutes. The ladder is computed after the
statement and criteria are written to Walrus, not at request start, because
those writes take roughly thirty-five seconds on testnet.

### The acceptance window

`ACCEPTANCE_WINDOW_MS` is 20000 ms in `jury.move`. A drawn seat has twenty
seconds from selection, clamped so it never exceeds the first commit deadline,
to accept or decline. `lock_committee` refuses before that deadline passes and
after the first commit deadline. Round two has no acceptance window: those
seats are created already accepted.

## 2. The evidence freeze

`evidence::freeze_evidence<T>` is gated by an `EvidenceCap`, builds an
`EvidenceBundle`, links it to the claim, emits `EvidenceFrozen` and freezes the
object so it can never change. A second freeze for the same phase aborts with
`E_ALREADY_LINKED`.

**What Sui stores.** The bundle holds the claim id, the phase, a 32-byte
`root`, the manifest blob id and object id, the source count, the evidence
policy id and the Walrus end epoch. Nothing about an individual evidence item
reaches the chain.

**What Walrus stores.** The manifest JSON as
`evidence-<claimId>-<phase>.json`, plus the raw bytes and the canonical text of
every artifact, each referenced from the manifest by blob id and object id. A
page a juror discovered and opened is stored the same way, with
`sourceClass: "DISCOVERED"`.

**The evidence root.** `computeEvidenceRoot` is a binary Merkle tree over
blake2b-256 with 32-byte digests. A leaf is
`blake2b256(BCS(EvidenceLeafV1 { evidence_id, content_hash, canonical_hash }))`
and an internal node is `blake2b256(left || right)`, with an odd node at a
level duplicated. Items are sorted by the UTF-8 bytes of their evidence id
before hashing, and a duplicate evidence id, content hash or canonical hash is
a hard error. The manifest records
`{ version: 1, hashAlgorithm: "blake2b-256", leafEncoding: "bcs::EvidenceLeafV1", items: [...] }`.

HTML is canonicalized to inert text before hashing, under
`HTML_CANONICALIZER_VERSION = "htmlparser2@12"`. Script, style, noscript,
iframe, object, embed and svg elements are dropped entirely.

**Two freezes per claim.** Phase one freezes the submitter's artifacts with the
claim statement placed first. Phase two runs the debate to completion, then
adds two synthetic artifacts on top of the phase-one set: the round-one public
record and the deliberation transcript. An empty artifact set is an error, not
an empty freeze.

`DEFAULT_EVIDENCE_FREEZE_LEAD_MS` is 30000 ms, overridable by
`OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS`. It is only a fallback bound now: a
debate that converges or finishes its last exchange freezes immediately, and
the lead bites only when the discussion window runs out mid-debate.

## 3. The committee draw

`jury::select_committee<T>` draws the jury. It takes `&Random`, so the Move
compiler requires it to be a private `entry fun` and the builder keeps it as
the last command in its transaction. The draw, the `Committee`, the
`RoundTally` and the five owned `JurySeat` objects are all created inside that
one call, so nobody sees a partial jury.

| Constant | Value |
| --- | --- |
| `COMMITTEE_SIZE` | 5 |
| `RESERVE_COUNT` | 2 |
| `REQUIRED_MATCHING` | 4 |
| `MAX_SELECTION_DRAWS` | 160 |
| `RESTART_AFTER_STALLS` | 8 |
| `MAX_ELIGIBLE_SNAPSHOT` | 32 |

The registry must hold at least seven active records and at most thirty-two,
otherwise the draw aborts with `E_INSUFFICIENT_DIVERSE_AGENTS`. Every record
registers with a flat weight of 10000, so selection weight is equal in v1.

### The diversity rules

`can_add_selected` accepts a candidate only when it is active, carries non-zero
weight, is not already selected, does not share an owner with a selected seat,
holds fewer than two seats for its model family, and holds fewer than three
seats for its role. In words: **one seat per operational signing key, at most
two seats per model family, at most three seats per role.**

**There is no cap per staker.** The staker-hash uniqueness rule was removed on
2026-09-04. `CommitteePolicy` still stores the staker hash vectors for layout
stability, but nothing reads them as a constraint, and
`replacement_preserves_diversity` states it outright. Any account may stake on
as many seats as it likes. The draw rules are a model and key diversity rule,
never a claim about who is behind an account.

After the draw, `selected_diversity_valid` requires at least three distinct
model families among the five seats, at least one seat with the SKEPTIC role
and at least one with the SOURCE_AUTHENTICITY role. Role hashes are fixed
strings: `blake2b256(b"OPENVERDICT_ROLE_SKEPTIC")` and
`blake2b256(b"OPENVERDICT_ROLE_SOURCE_AUTHENTICITY")`.

A candidate whose owner is the claim creator, the proposer or the challenger is
never drawn. The two reserves must not share a profile or an owner with any
selected seat or with each other, must hold exactly the SKEPTIC or the
SOURCE_AUTHENTICITY role, and must not share a role with each other. Reserves
carry no model cap.

### Restarts and the feasibility guard

The draw is greedy and never backtracks. Every rejected candidate increments a
stall counter; after eight consecutive stalls the partial selection is cleared
and sampling continues from scratch. The same restart applies independently to
the reserve loop. Both loops share one attempt counter bounded by
`MAX_SELECTION_DRAWS`, and running out aborts.

`lib/engine/draw-feasibility.ts` mirrors these rules off chain so a stake can
be refused before any money moves. `rosterAdmitsDraw` searches exhaustively for
any valid five-seat committee; `rosterCanSeat` searches for a valid committee
that seats a specific candidate, and returns a plain-English reason when none
exists.

If a seat declines, `replace_declined_seat` swaps in a reserve, but only while
the committee is unlocked, in phase one, before the first commit deadline, and
only if the replacement preserves the model cap, the three distinct families
and both required roles.

## 4. The research loop

Each seat runs an engine-executed loop. The model never fetches anything: it
emits one JSON action per turn, and the engine performs it and hands back the
result.

The three actions are `search`, `open` and `answer`. Since prompt spec v3 a
search must carry an intent of `"support"` or `"challenge"`; a search without
one is refused. Since v4 an open may name several URLs in one turn, fetched in
parallel and returned as a single tool result.

### The tool policy

The tool policy is hashed into the juror's on-chain manifest, so the budgets a
run obeyed are part of the record.

| Field | v2 | v3 | v4 |
| --- | --- | --- | --- |
| `maxSearches` | 3 | 4 | 4 |
| `maxOpens` | 4 | 5 | 5 |
| `maxTurns` | 8 | 10 | 10 |
| `resultsPerSearch` | 5 | 5 | 5 |
| `snippetChars` | 200 | 200 | 200 |
| `pageSliceChars` | 4000 | 4000 | 4000 |
| `maxPageChars` | 60000 | 60000 | 60000 |
| `maxLoopMs` | 600000 | 600000 | 600000 |
| `requireChallengeSearch` | absent | true | true |
| `minCitationDomains` | absent | 2 | 2 |
| `minOpensPerSide` | absent | 1 | 1 |
| `maxOpensPerTurn` | absent | absent | 3 |

Every spec runs at temperature 0 with a 4096-token output cap and a JSON object
response format. The engine refuses to run a seat whose stored manifest hashes
differ from its published document.

### The two-sided rules

Four rules stand between a model and a YES or a NO. Each may be enforced by at
most two refusals, and none applies to UNSURE.

1. **Research required.** A YES or NO before any search-origin page was opened
   is refused.
2. **Challenge required.** A YES or NO needs at least one completed challenge
   search, and when that search returned results, one of those results opened.
3. **Corroboration required.** Found, search-origin citations must span at
   least `minCitationDomains` distinct sites, which is two under v3 and v4.
4. **Counter-evidence summary.** A non-empty counter-evidence summary is
   required for a YES or a NO. This one is a validation error, not a nudge.

A quote is checked by normalizing both sides and testing for a substring, and
the auditor recomputes the same function. A seat that cannot produce a valid
citation after two answer repairs fails closed with status `CITATION_INVALID`.
The other failure statuses are `INVALID_SCHEMA`, `TIMEOUT` and
`PROVIDER_ERROR`.

### The sealed run bundle

The bundle is built by `buildRunBundleCore` and carries the run id, the claim
id, the phase, the agent profile id, the jury seat id, the prompt spec and its
hash, the tool policy and its hash, the full research transcript, the juror
input and its hash, the exact message list sent to the gateway, every visible
provider attempt including hedges, the raw response, the gateway metadata
(request ids, devshard, fingerprint), the validated output and its hash, the
audit block, the run hash, and a `verify` recipe naming each formula literally.

The bundle is sealed with AES-256-GCM under a fresh 32-byte key and a 12-byte
IV, with the run id as additional authenticated data. Before the commit only
the ciphertext is on Walrus, and `approve_run` cites it. At the reveal the
plaintext core and the key are published as the reveal argument blob.

A seat that fails still leaves a public record: an `InferenceFailureV1`
document with its status, message, failure time, the transcript at that moment
and every attempt.

### What the run hash covers

`computeRunHash` is `blake2b256(BCS(RunRecordV1))`, and the BCS field order is
the contract:

```
run_id, claim_object_id, agent_profile_id, jury_seat_id,
phase (u8), attempt (u16), provider_id, model_id, gonka_request_id,
prompt_hash, input_hash, output_hash, tool_transcript_hash,
evidence_root, requested_at_ms (u64), completed_at_ms (u64)
```

Because the prompt hash sits inside the run hash, and the prompt hash is pinned
in the on-chain juror manifest, the prompt spec and, through the transcript's
policy hash, the tool policy are both bound to the vote that lands on chain.

## 5. Commit and reveal

### The commitment preimage

The Move struct `VotePreimageV1` and the TypeScript BCS schema must stay
byte-identical. BCS is positional, so the order is the contract:

| # | Field | BCS type |
| --- | --- | --- |
| 1 | `claim_id` | address (32 bytes) |
| 2 | `agent_profile_id` | address |
| 3 | `jury_seat_id` | address |
| 4 | `phase` | u8 |
| 5 | `outcome` | u8 |
| 6 | `confidence_bps` | u16 |
| 7 | `evidence_root` | vector&lt;u8&gt; |
| 8 | `output_hash` | vector&lt;u8&gt; |
| 9 | `run_hash` | vector&lt;u8&gt; |
| 10 | `salt` | vector&lt;u8&gt; |

The commitment is `blake2b256` of the BCS bytes, that is BLAKE2b with a 32-byte
digest, matching `sui::hash::blake2b256` on the Move side and
`blake2b(bytes, { dkLen: 32 })` on the TypeScript side. The chain requires the
submitted commitment to be exactly 32 bytes. The salt is 32 random bytes
generated by the engine and never leaves it until the reveal.

Because the run hash is itself the hash of the run record, a commitment
transitively binds the prompt hash, the input hash, the tool transcript hash,
the model id and the gateway request id.

**Parity is enforced, not assumed.** Six pinned vectors are asserted
byte-identical by both `lib/protocol/parity.test.ts` and
`move/openverdict/tests/parity_tests.move`. A serialization change on either
side breaks exactly one suite.

### On chain

`commit_vote` consumes a matching `RunApproval`, copies its run hash onto the
seat, stores only the commitment, and moves the seat to `SEAT_COMMITTED`. It
requires an accepted seat, a bound non-empty evidence root, and a time at or
before the seat's commit deadline.

`reveal_vote` requires the seat capability, the sender to be the seat's agent
owner, a committed seat, a valid outcome, a confidence at most 10000 basis
points, 32-byte output and run hashes, a non-empty salt and argument blob id,
an unexpired Walrus epoch, and an open reveal window. It then rebuilds the
preimage from the seat's own stored claim id, profile id, seat id, phase and
evidence root, and aborts with `E_COMMITMENT_MISMATCH` unless the recomputed
hash equals the stored commitment. A changed vote simply cannot land.

The reveal window opens as soon as every seat has committed, not only at the
commit deadline.

## 6. Quorum

**Four matching reveals out of five.** `REQUIRED_MATCHING` is 4 and
`COMMITTEE_SIZE` is 5. `jury::threshold_outcome` returns YES, NO or UNSURE when
that outcome has at least four reveals, and zero otherwise.

Three places consume the rule. `settlement::finalize_claim` aborts with
`E_FIRST_ROUND_NO_CONSENSUS` when a phase-one tally has no threshold, so a
split first round cannot be finalized and must go to the table.
`jury::open_discussion` and `jury::create_second_round_seats` both require that
round one reached no threshold, so a settled claim can never be dragged into a
debate.

## 7. The debate

A split first round opens a debate. It is deliberation spec V4 by default, and
`selectedDeliberationSpec` returns V3 only when
`OPENVERDICT_DELIBERATION_SPEC` is set to `"3"`.

`MAX_DELIBERATION_EXCHANGES` is 3. Every debater speaks exactly once per
exchange, with a per-turn budget of 60000 ms. The debaters are the seats that
actually revealed in round one.

### Convergence

`debateConvergedAfterExchange` walks exchanges 1, 2 and 3 and compares each
seat's stance in that exchange against its previous stance, using the
round-one outcome as the baseline for exchange 1. The first complete exchange
in which every comparable seat kept its stance is the convergence point. When
that equals the exchange just finished, the loop emits `debate_converged` once
and stops. The transcript is then frozen immediately, not at the discussion
deadline.

### The V4 conversation format

The output contract is exactly eight keys and no others.

| Field | Rule | Bound |
| --- | --- | --- |
| `answering` | The seat index this turn answers. Null only when the turn opens the debate. | |
| `theirPoint` | One sentence restating that seat's specific claim, citation or inference. Empty exactly when `answering` is null, never empty otherwise. | 240 chars |
| `analysis` | Non-empty plain text, no markdown: what the speaker makes of that point against the record, conceding what holds and disputing what does not, naming the citations meant. | 900 chars |
| `question` | One pointed question to a named seat, as `{seat, text}`, or null. Never the speaker's own seat. | 240 chars |
| `position` | Non-empty, and it comes after the analysis: hold, raise, lower or change, and why. | 240 chars |
| `stance` | YES, NO or UNSURE. Public and non-binding. | |
| `confidenceBps` | Integer 0 to 10000. | |
| `citations` | Copied exactly from `allowedCitations`. | at most 8 unique |

The spec runs at temperature 0 with a 1100-token output cap. The stored turn
also keeps an `argument` field composed as the analysis and the position joined
by a space, so transcripts from earlier spec versions keep hashing identically.

A turn that breaks the contract is recorded as `SKIPPED` with the reason
naming the broken part: `INVALID_OUTPUT`, `INVALID_LENGTH`,
`INVALID_ANSWERING`, `INVALID_QUESTION`, `INVALID_CITATIONS`, plus
`PROVIDER_ERROR`, `TIMEOUT` and `WINDOW_EXHAUSTED`. A skipped turn is a silent
seat, never a repaired one, and it is not a binding step: it never voids the
attempt.

### The speaking order

`lib/engine/debateOrder.ts` is a pure function of the seats and the turns
already persisted, so a restarted worker rebuilds the identical conversation.

1. **Sides.** A seat's effective stance entering an exchange is its last spoken
   stance, falling back to its round-one outcome. Seats with no known stance
   form their own side.
2. **Dissenters open.** Sides are sorted by size and then by lowest seat index,
   and the smallest side opens.
3. **A unanimous jury.** With only one side, the SKEPTIC seat opens, or the
   lowest seat index when there is no SKEPTIC.
4. **Sides alternate.** Minority, majority, minority, majority, each by
   ascending seat index, then whatever remains in seat index order.
5. **A questioned seat speaks next.** If the last spoken turn asked a question
   of a seat that has not yet spoken this exchange, that seat is pulled to the
   front.
6. **Carried questions.** A question aimed at a seat that already spoke is
   delivered on that seat's next turn.
7. **Who you answer.** `answering` resolves in this order: the asker of a
   pending question, else the last other speaker in this exchange, else the
   last other speaker on the opposing side, else the last other speaker at all,
   else the lowest-index opposing seat, else null.
8. **Race safety.** If a sibling process spoke for the same seat or ordinal
   while the model was running, the turn is dropped and the order re-planned.

## 8. The table vote

Round two is not a second research pass. It is one sealed, no-tools vote per
juror over what is already on the table.

- The prompt is `TABLE_VOTE_PROMPT_SPEC_V1`, temperature 0, 2048 output tokens,
  JSON object response. Its system prompt says plainly not to request or use
  tools, not to search, open pages or fetch URLs.
- The message list is exactly the system prompt and the canonical JSON input.
  No budget block is appended, unlike a research run.
- The output contract has nine keys and no `citations` key. Evidence is
  referenced by evidence id only, from the phase-two manifest.
- The input carries the phase-two evidence manifest, the round-one public
  record, the full debate with every seat's stance, and the juror's own
  round-one output.
- The bundle is version 6: no tool policy, no transcript, and a fixed
  `tool_transcript_hash` of `blake2b256(0x00)`.
- The seat's manifest document must be version 6 and its table-vote prompt hash
  must equal the pinned hash.

| | Round one | Round two |
| --- | --- | --- |
| Tools | search and open, budgets 4 / 5 / 10 | none |
| New research | yes, engine-executed | none |
| Prompt spec | research v2 to v4 | table vote v1 |
| Bundle core version | 3, 4 or 5 | 6 |
| Transcript | full research transcript | absent |
| `citations` key | required | forbidden |
| Seat status at creation | offered, must accept | already accepted |
| Output tokens | 4096 | 2048 |

On chain the round is identical: `create_second_round_seats` mints five
phase-two seats for the same profiles, then the same commit, reveal and
four-of-five threshold apply. Round two opens on the phase-two evidence bundle
being linked, which is the frozen transcript, not at the discussion deadline.

## 9. The certificate and the Truth Score

### The formula

The Truth Score is the mean of each valid reveal's truth probability, in basis
points, rounded half up:

```
per vote:  YES     -> confidence_bps
           NO      -> 10000 - confidence_bps
           UNSURE  -> 5000

score_bps = (sum + count / 2) / count      integer division
```

Votes are unweighted, one per seat. The range is 0 to 10000 basis points, and
the display value is the score divided by one hundred. Zero valid reveals
yields no score at all rather than a fabricated one. Only the terminal valid
round is scored, and an unchallenged optimistic finalization carries no score.

The TypeScript mirror in `lib/protocol/truthScore.ts` implements the same
mapping and the same rounding.

### The Resolution Certificate

`ResolutionCertificate` is created and immediately frozen, so it is immutable:

| Field | Type |
| --- | --- |
| `claim_id` | ID |
| `package_version` | u64 |
| `result` | u8: 1 YES, 2 NO, 4 UNRESOLVED |
| `truth_score_bps` | Option&lt;u16&gt; |
| `committee_id` | Option&lt;ID&gt; |
| `evidence_bundle_ids` | vector&lt;ID&gt;, phase one then phase two |
| `revealed_vote_ids` | vector&lt;ID&gt; from the terminal tally |
| `finalized_at_ms` | u64 |

A threshold of UNSURE, or phase two with no threshold at all, both become
`RESULT_UNRESOLVED`. Otherwise the result is the threshold outcome. Finalizing
requires the right reveal state, a passed reveal deadline or all seats
revealed, a locked committee, a tally that matches the committee, the claim and
the evidence bundle, and an unexpired Walrus retention.

Payout tickets are minted at the same time, one per reason:
creator refund, jury reward, proposer win, challenger win, proposer refund,
challenger refund, cancelled, protocol fee. A jury reward goes to the seat's
recorded staker, falling back to the operational owner for a seat that predates
staking.

## 10. Attempts

### All or nothing

Any seat failing a binding step voids the whole verification attempt. Nothing
partial is ever finalized, and no vote is ever invented for a failed seat.

| Void reason | Trigger |
| --- | --- |
| `MISSING_COMMITTEE` | The claim was still in `REVIEW_REQUESTED` at the first commit deadline, so no committee can ever be drawn. |
| `MISSING_COMMIT` | Not all expected seats committed by the phase's commit deadline. |
| `MISSING_REVEAL` | Not all expected seats revealed by the phase's reveal deadline. |
| `INVALID_SCHEMA` | A run produced no valid output. |
| `CITATION_INVALID` | Citation rules unmet after the nudges and repairs. |
| `TIMEOUT` | The run did not finish in its budget. |
| `PROVIDER_ERROR` | The gateway failed the run. |

Voiding is idempotent and writes the reason, the message, the seat, the model
and the phase, then emits `verification_voided` publicly. A voided attempt
simply lapses on chain without a certificate: there is no mid-flight cancel,
since `settlement::cancel_claim` only accepts a claim still in `CREATED`.

Attempt statuses are `ACTIVE`, `VOIDED`, `SETTLED` and `GAVE_UP`.

### The weather gate and relaunch

The engine probes the model families and the research provider together,
because a jury with no web search answers UNSURE on everything. A report is
marked stale after five minutes, and it is clear only when it is fresh and
every family answered.

A submission arriving under clear or stale weather launches immediately.
Otherwise it is queued with a hold reason of `WEATHER` and a six-hour lifetime,
and the queue launches at most one jury every ten minutes. That spacing exists
because three concurrent juries drew a rate-limit storm from the shared gateway
on 2026-09-03.

After a void, `relaunchTick` runs on every resolution worker tick:

1. Adopt an already-created next attempt if a previous tick crashed after
   creating it.
2. Give up with `ATTEMPTS_EXHAUSTED` when the attempt number has reached
   `MAX_VERIFICATION_ATTEMPTS`, which is 3.
3. Give up with `WEATHER_TIMEOUT` when more than six hours have passed since
   the void.
4. Probe every model family, reusing a cache younger than two minutes. Every
   probe must be healthy.
5. Respect the ten-minute launch spacing shared with the public queue.
6. Relaunch as a new claim with the same statement, text, URLs and criteria,
   link it to the parent, and emit `verification_relaunched`.

So a verification gets three attempts in total, one original and at most two
relaunches, and a relaunch only happens when the models are demonstrably
answering.

## 11. Every timing constant

| Constant | Value | Where |
| --- | --- | --- |
| `ACCEPTANCE_WINDOW_MS` | 20000 ms | `jury.move` |
| `MAX_TOTAL_DURATION_MS` | 2592000000 ms (30 days) | `claim.move` |
| `WITHDRAWAL_DELAY_MS` | 86400000 ms (24 hours) | `agent_registry.move` |
| `DEFAULT_EVIDENCE_FREEZE_LEAD_MS` | 30000 ms | `lib/engine/engine.ts` |
| `PER_TURN_BUDGET_MS` | 60000 ms | `lib/engine/engine.ts` |
| `SEAT_COMMIT_MARGIN_MS` | 60000 ms | `lib/engine/engine.ts` |
| `COMMIT_PUMP_INTERVAL_MS` | 5000 ms | `lib/engine/engine.ts` |
| `RELAUNCH_GIVE_UP_MS` | 21600000 ms (6 hours) | `lib/engine/engine.ts` |
| `RELAUNCH_PROBE_TIMEOUT_MS` | 60000 ms | `lib/engine/engine.ts` |
| `RELAUNCH_WEATHER_CACHE_MS` | 120000 ms | `lib/engine/engine.ts` |
| `WEATHER_PROBE_INTERVAL_MS` | 120000 ms | `lib/engine/engine.ts` |
| `WEATHER_STALE_MS` | 300000 ms | `lib/engine/engine.ts` |
| `QUEUE_TTL_MS` | 21600000 ms (6 hours) | `lib/engine/engine.ts` |
| `QUEUE_LAUNCH_SPACING_MS` | 600000 ms (10 minutes) | `lib/engine/engine.ts` |
| `RESEARCH_PROBE_TIMEOUT_MS` | 15000 ms | `lib/engine/engine.ts` |
| `STAKE_RESERVATION_TTL_MS` | 900000 ms (15 minutes) | `lib/engine/engine.ts` |
| `maxLoopMs` | 600000 ms | `lib/gonka/promptSpec.ts` |
| `MIN_RETRY_CALL_MS` | 20000 ms | `lib/research/loop.ts` |
| `NO_EVIDENCE_GRACE_MS` | 60000 ms | `workers/evidence-worker.ts` |

## Where the code corrects the specification

Four numbers in `docs/PRD.md` and in the older design specs are out of date.
The code is the truth:

- The hosted deadline ladder is 600 / 720 / 1560 / 1800 / 1920 seconds, not the
  450 / 570 / 1410 / 1650 / 1770 the specs describe.
- The evidence freeze lead is 30 seconds, not 120, and it is a fallback rather
  than the normal path.
- The acceptance window is 20 seconds, not 60 and not the midpoint of the
  commit window.
- The draw has no per-staker cap. `docs/PRD.md` contradicts itself here, and
  the later addendum item is the accurate one.

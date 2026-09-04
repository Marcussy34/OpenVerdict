---
title: Contracts on Sui
description: The deployed package: its ids, modules, entry functions, objects and events, read live from the release manifest.
order: 9
---

Every id on this page is read from `config/release.testnet.json` when the page
is served, so it is whatever the current release says, not a number typed into
prose.

## The deployment

| Setting | Value |
| --- | --- |
| Network | `{{network}}` |
| Package id (call target) | [`{{packageId}}`]({{packageUrl}}) |
| Original package id (type addresses) | [`{{originalPackageId}}`]({{originalPackageUrl}}) |
| Registry object | [`{{registryObjectId}}`]({{registryUrl}}) |
| Coin type | `{{coinType}}` |
| Clock | `{{clockObjectId}}` |
| Randomness | `{{randomObjectId}}` |
| Sui RPC | `{{suiRpcUrl}}` |
| Seal policy package | [`{{sealPackageId}}`]({{sealPackageUrl}}) |
| Seal threshold | {{sealThreshold}} of {{sealKeyServers}} key servers |
| Gonka gateway | `{{gonkaBaseUrl}}` |
| Model families | `{{gonkaModels}}` |
| Walrus mode | `{{walrusMode}}` |
| Committee | size {{committeeSize}}, threshold {{committeeThreshold}}, at most {{maxSeatsPerModel}} per model, at least {{minDistinctModels}} distinct models |

**The two package ids are not interchangeable.** Move calls target
`packageId`, the newest upgrade. Object **types** keep the address the package
was first published at, so a type string is built from `originalPackageId`. The
gateway picks between them for exactly this reason, and an indexer filtering on
type strings must use the original.

The manifest is loaded from the path in `OPENVERDICT_RELEASE_MANIFEST`, which
defaults to the localnet file, so a testnet deployment sets it explicitly. Four
capability object ids also live in that file for the deploy scripts; the schema
strips them, so they never reach the running engine.

## The modules

| Module | Purpose |
| --- | --- |
| `agent_registry` | Agent registration, stake and bonds, the eligibility snapshot, capabilities, treasury policy and the emergency pause |
| `claim` | Claim creation, the optimistic propose and challenge flow, the phase state machine, deadlines and the fund vaults |
| `evidence` | Immutable per-phase evidence bundles with Walrus retention metadata |
| `jury` | Random committee selection, seat lifecycle, run approvals, commit-reveal voting, tallies and resolution certificates |
| `settlement` | Terminal results, recipient-bound payout tickets and withdrawals |
| `demo_fact_checker` | The capped direct-review entry point for public fact checks with no market |
| `demo_binary_pool` | A low-cap YES/NO demo prediction pool that settles on a certificate |
| `display_meta` | Claims the publisher at init and registers Sui Object Display templates |

`openverdict_seal::reveal_lock` is a **separate package** with its own id. It is
the Seal time-lock policy that releases a reveal key only after the deadline
encoded in the identity.

## Entry functions

### agent_registry

| Function | What it does |
| --- | --- |
| `register_agent` | The legacy free-seat path: shares a profile, pushes an eligibility record, sends the `AgentCap` to the sender |
| `register_staked_agent` | The real-stake path: the stake becomes the bond, the sender is recorded as payout recipient, the operational owner receives the `AgentCap`, the sender receives the `StakePosition` |
| `request_unstake` | Staker only. Deactivates the profile and its registry record, and starts the 24-hour withdrawal of the whole current bond |
| `complete_unstake` | Staker only, after maturity. Consumes the position and pays what is left. Never blocked by pause |
| `update_agent_manifest` | Rotates the manifest pointers and bumps the manifest version |
| `deprecate_agent` | Marks the profile and its eligibility record inactive atomically |
| `set_agent_eligibility` | Admin only. Sets selection weight and the active flag |
| `set_treasury_policy` | Admin only. Sets the treasury address and the protocol fee, capped at 2000 bps |
| `deposit_agent_bond` | Adds to the bond. Requires the `AgentCap` |
| `request_agent_bond_withdrawal` | The legacy bond exit. Requires the profile and its record to be inactive |
| `complete_agent_bond_withdrawal` | Pays a matured legacy withdrawal to the profile owner |
| `pause` / `unpause` | Emergency stop, held by the `PauseCap` |

### claim

| Function | What it does |
| --- | --- |
| `create_claim<T>` | Splits the budget into three vaults and shares a claim in `CREATED` |
| `start_direct_review<T>` | `CREATED` to `REVIEW_REQUESTED` for a direct-review claim |
| `propose_outcome<T>` | Binds a proposer bond to an optimistic answer, `CREATED` to `PROPOSED` |
| `challenge_outcome<T>` | Requires an equal bond and a different sender, `PROPOSED` to `CHALLENGED` |
| `start_challenged_review<T>` | `CHALLENGED` to `REVIEW_REQUESTED` |
| `advance_phase<T>` | Consumes a tally-bound readiness receipt to move commit to reveal in either round |

### evidence

| Function | What it does |
| --- | --- |
| `freeze_evidence<T>` | Builds, links, emits and freezes one phase bundle in a single call, gated by the `EvidenceCap` |

### jury

| Function | What it does |
| --- | --- |
| `select_committee<T>` | **Private entry**, because it takes `&Random`. Weighted draw of five seats and two reserves, then the committee, the tally and the five owned seats, all in one transaction |
| `accept_jury_seat` | Offered to accepted, before the commit deadline |
| `decline_jury_seat` | Marks the seat declined and hands it back as proof for a replacement |
| `replace_declined_seat<T>` | Swaps in a reserve only when diversity survives, and moves the payout recipient with it |
| `lock_committee<T>` | Locks membership after the acceptance window and before the commit deadline |
| `bind_jury_seat_evidence` | Binds the frozen evidence root to the seat and the phase tally, idempotently |
| `approve_run` | Mints a one-time `RunApproval` fixing the run hash before any commitment. Gated by the `RunAttestorCap` |
| `commit_vote` | Consumes the matching approval, stores the 32-byte commitment and the fixed run hash |
| `reveal_vote` | Rebuilds the BCS preimage, checks the hash against the commitment, freezes a `RevealedVote`, updates the tally and destroys the seat |
| `open_discussion<T>` | Only when round one reached no threshold. Closes tally one and opens the debate |
| `create_second_round_seats<T>` | Requires the phase-two bundle to be linked. Mints five already-accepted phase-two seats and a new tally |

`select_committee` is the only function in the codebase that takes `&Random`.
Move forbids a `public fun` from taking it, so it is a private `entry fun` and
the builder keeps it as the last command in its transaction.

### settlement

| Function | What it does |
| --- | --- |
| `finalize_unchallenged<T>` | After the challenge deadline on a proposed claim: a certificate with no score and no committee, and refunds |
| `finalize_claim<T>` | Reads the threshold from the bounded tally, mints the certificate, closes the tally and mints every payout ticket |
| `cancel_claim<T>` | Creator only, before the proposal deadline, only in `CREATED` |
| `withdraw_payout<T>` | Consumes a recipient-bound ticket exactly once |

## The objects

| Struct | Ownership |
| --- | --- |
| `Registry` | shared |
| `AgentProfile` | shared |
| `AgentCap` | owned by the operational owner |
| `AdminCap`, `PauseCap`, `EvidenceCap`, `RunAttestorCap` | owned by the publisher |
| `StakePosition` | owned by the staker |
| `Claim<T>` | shared |
| `PhaseReadiness` | created and consumed inside one transaction |
| `EvidenceBundle` | frozen |
| `Committee` | shared |
| `JurySeat` | owned by the seat's operational key |
| `RoundTally` | shared |
| `RunApproval` | owned, consumed by the commit |
| `RevealedVote` | frozen |
| `ResolutionCertificate` | frozen |
| `PayoutTicket<T>` | owned by the recipient |
| `DemoBinaryPool<T>` / `Position<T>` | shared / owned |

`Claim<T>` sits at exactly the validator's 32-field limit, which is why the
challenge reason, the treasury address and the protocol fee are packed into one
sub-struct.

Several extension points are dynamic fields rather than struct fields, so the
layout stays stable across upgrades: per-seat deadlines on `JurySeat`, the
diversity metadata and the payout snapshot on `Committee`, the manifest
version, the withdrawal request, the stake record and the unstake request on
`AgentProfile`, and the payout recipient on `Registry`.

## The events

| Event | Fields |
| --- | --- |
| `ClaimCreated` | claim id, creator, mode, content hash, coin type hash |
| `OutcomeProposed` | claim id, proposer, outcome, amount |
| `OutcomeChallenged` | claim id, challenger, reason hash, amount |
| `EvidenceFrozen` | claim id, phase, bundle id, root |
| `CommitteeSelected` | claim id, committee id, round tally id, profile ids, seat ids |
| `RunApproved` | claim id, seat id, approval id, run hash |
| `VoteCommitted` | claim id, seat id, phase, commitment |
| `VoteRevealed` | claim id, tally id, seat id, revealed vote id, phase, outcome, confidence, output hash, run hash |
| `ClaimFinalized` | claim id, certificate id, outcome, reviewed, truth score, finalize time |
| `ClaimUnresolved` | claim id, certificate id, truth score, finalize time |
| `PayoutTicketCreated` | claim id, ticket id, recipient, amount, reason |
| `PayoutWithdrawn` | claim id, ticket id, recipient, amount |
| `AgentRegistered` | profile id, owner, manifest hash |
| `AgentManifestUpdated` | profile id, manifest hash, version |
| `AgentStaked` | profile id, staker, operational owner, amount |
| `UnstakeRequested` | profile id, staker, amount, available at |
| `Unstaked` | profile id, staker, amount |

**`CommitteeSelected` is emitted twice on a two-round claim**, once per round,
and in the second emission the round tally field carries the second-round tally
id. Disambiguate by phase.

Payout reasons are 1 creator refund, 2 jury reward, 3 proposer win, 4
challenger win, 5 proposer refund, 6 challenger refund, 7 cancelled, 8 protocol
fee.

## State and outcome codes

These `u8` codes are a shared wire contract between the Move modules and
`lib/protocol/constants.ts`. Neither side may be renumbered alone.

**Claim states:** 0 CREATED, 1 PROPOSED, 2 CHALLENGED, 3 REVIEW_REQUESTED,
4 COMMIT_1, 5 REVEAL_1, 6 DISCUSSION, 7 COMMIT_2, 8 REVEAL_2,
9 FINALIZED_UNCHALLENGED, 10 FINALIZED_REVIEWED, 11 UNRESOLVED, 12 CANCELLED.

**Outcomes:** 0 NONE, 1 YES, 2 NO, 3 UNSURE. Claim results add 4 UNRESOLVED.

**Claim modes:** 1 DIRECT_REVIEW, 2 OPTIMISTIC_SETTLEMENT.

**Seat statuses:** 0 offered, 1 accepted, 2 committed, 3 declined.

## Explorer links

`lib/web/explorer.ts` builds every link from `NEXT_PUBLIC_SUI_NETWORK`, and
anything other than the exact string `mainnet` resolves to testnet.

| Target | Shape |
| --- | --- |
| Object, including a package | `https://suiscan.xyz/{{network}}/object/<id>` |
| Address | `https://suiscan.xyz/{{network}}/account/<address>` |
| Transaction | `https://suiscan.xyz/{{network}}/tx/<digest>` |
| Walrus blob | `https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>` |

A Sui package is an object, so a package link uses the object shape.

## Upgrades

The package was published once on 2026-08-27 and upgraded several times since,
most recently for real stake, for the draw resample after repeated stalls, and
for the twenty-second acceptance window. Object types stayed at the original
address throughout. The only record of the id history is the git history of
`config/release.testnet.json`; the upgrade capability is held by the single
operator key. The Seal policy package has never been upgraded.

---
title: Contracts and deployment
navTitle: Contracts
description: Every Move module, entry function, struct, event and abort code, plus the release manifest, the environment variables and the host routing.
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
gateway picks between them for exactly this reason
(`lib/sui/gateway.ts:722`), and an indexer filtering on type strings must use
the original.

The manifest is loaded from the path in `OPENVERDICT_RELEASE_MANIFEST`, which
defaults to the localnet file, so a testnet deployment sets it explicitly. Four
capability object ids also live in that file for the deploy scripts; the Zod
schema strips them, so they never reach the running engine
(`lib/sui/manifest.ts:83`).

### Release manifest keys

| Key | Type | Names |
| --- | --- | --- |
| `network` | `"localnet" \| "testnet" \| "mainnet"` | which chain this release targets |
| `suiRpcUrl` | URL | primary Sui full node RPC |
| `suiRpcFallbackUrl` | URL, optional | secondary RPC |
| `suiFaucetUrl` | URL, optional | testnet faucet |
| `packageId` | `0x` hex | the package every Move call targets |
| `originalPackageId` | `0x` hex, optional | the address every object type keeps |
| `registryObjectId` | `0x` hex | the shared `agent_registry::Registry` |
| `demoPoolObjectId` | `0x` hex, optional | the demo pool, empty on testnet today |
| `clockObjectId` | literal `"0x6"` | Sui `Clock` |
| `randomObjectId` | literal `"0x8"` | Sui `Random` |
| `coinType` | `0x…::mod::Type` | the type argument for `Claim<T>` |
| `walrus` | `{ mode, localDir?, epochs? }` | blob store configuration |
| `gonka` | `{ mode, baseUrl, models[] }` | gateway and model catalogue |
| `committee` | `{ size, threshold, maxSeatsPerModel, minDistinctModels }` | mirrored from `jury.move` |
| `seal` | `{ packageId, threshold, keyServers[] }`, optional | the reveal-key escrow policy |
| `explorerTxTemplate` | string | e.g. `https://testnet.suivision.xyz/txblock/{digest}` |

Source: the schema at `lib/sui/manifest.ts:13-83`. Cross-field validation at
`:96-116` requires a local Walrus mode to name a directory, `walrus.mode` to
equal `network` off localnet, and the distinct model count to be at least
`committee.minDistinctModels`.

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
the builder keeps it as the last command in its transaction
(`lib/sui/builders.ts:377-394`).

### settlement

| Function | What it does |
| --- | --- |
| `finalize_unchallenged<T>` | After the challenge deadline on a proposed claim: a certificate with no score and no committee, and refunds |
| `finalize_claim<T>` | Reads the threshold from the bounded tally, mints the certificate, closes the tally and mints every payout ticket |
| `cancel_claim<T>` | Creator only, before the proposal deadline, only in `CREATED` |
| `withdraw_payout<T>` | Consumes a recipient-bound ticket exactly once |

### demo_fact_checker and demo_binary_pool

`start_fact_check<T>` creates, advances and shares a direct-review claim in one
transaction, capped at `MAX_DIRECT_REVIEW_BUDGET`, one SUI. The pool exposes
`create_pool<T>`, `enter<T>`, `settle_pool<T>` and `redeem<T>`, capped at
`MAX_POOL_VALUE`, one SUI.

## The objects

| Struct | Abilities | Ownership | Key fields |
| --- | --- | --- | --- |
| `Registry` | `key` | shared | `version`, `treasury`, `protocol_fee_bps`, `eligible_agents`, `paused` |
| `EligibilityRecord` | `copy, drop, store` | value inside `Registry` | `agent_profile_id`, `owner`, `human_backing_hash` (the staker hash), `model_hash`, `role_hash`, `weight`, `active` |
| `AgentProfile` | `key, store` | shared | `owner`, `manifest_hash`, `manifest_blob_id`, `human_backing_hash`, `model_hash`, `role_hash`, `bond: Balance<SUI>`, `active`, `reputation` |
| `AgentCap` | `key, store` | owned by the operational owner | `agent_profile_id` |
| `AdminCap`, `PauseCap`, `EvidenceCap`, `RunAttestorCap` | `key, store` | owned by the publisher | `id` only |
| `StakePosition` | `key, store` | owned by the staker | `agent_profile_id`, `staker`, `amount` |
| `Claim<phantom T>` | `key` | shared | 32 fields: protocol version, mode, creator, `content_hash`, blob ids, five `Option<ID>` links, seven deadlines, proposer, challenger, `challenge_reason`, proposal, result, state, five `Balance<T>` vaults |
| `PhaseReadiness` | `key`, no `store` | created and consumed in one transaction | `claim_id`, `tally_id`, `phase`, `all_seats_committed` |
| `EvidenceBundle` | `key, store` | frozen | `claim_id`, `phase`, `root`, `manifest_blob_id`, `manifest_blob_object_id`, `source_count`, `policy_id`, `walrus_end_epoch` |
| `Committee` | `key, store` | shared | `claim_id`, `agent_profile_ids`, `agent_owners`, `reserve_profile_ids`, `reserve_owners`, `selected_at_ms`, `locked` |
| `JurySeat` | `key, store` | owned by `agent_owner` | `claim_id`, `committee_id`, `agent_profile_id`, `agent_owner`, `phase`, `evidence_root`, `commitment`, `run_hash`, `status` |
| `RoundTally` | `key` | shared | `claim_id`, `committee_id`, `phase`, `evidence_root`, `expected_jury_seat_ids`, `committed_count`, `revealed_jury_seat_ids`, `revealed_vote_ids`, `yes_count`, `no_count`, `unsure_count`, `truth_probability_sum_bps`, `truth_probability_count`, `closed` |
| `RunApproval` | `key, store` | owned, destroyed by `commit_vote` | `claim_id`, `committee_id`, `jury_seat_id`, `agent_profile_id`, `agent_owner`, `run_hash`, `run_blob_id`, `run_blob_object_id`, `tool_blob_id`, `tool_blob_object_id`, `walrus_end_epoch`, `phase` |
| `RevealedVote` | `key, store` | frozen | `claim_id`, `committee_id`, `jury_seat_id`, `agent_profile_id`, `phase`, `outcome`, `confidence_bps`, `evidence_root`, `output_hash`, `run_hash`, `argument_blob_id`, `argument_blob_object_id`, `argument_walrus_end_epoch`, `revealed_at_ms` |
| `ResolutionCertificate` | `key, store` | frozen | `claim_id`, `package_version`, `result`, `truth_score_bps`, `committee_id`, `evidence_bundle_ids`, `revealed_vote_ids`, `finalized_at_ms` |
| `VotePreimageV1` | `copy, drop, store` | not an object | the ten commitment fields |
| `PayoutTicket<phantom T>` | `key, store` | owned by the recipient | `claim_id`, `recipient`, `amount`, `reason` |

`Claim<T>` sits at exactly the validator's 32-field limit, which is why the
challenge reason, the treasury address and the protocol fee are packed into one
sub-struct.

### Dynamic fields

Several extension points are dynamic fields rather than struct fields, so the
layout stays stable across upgrades.

| Parent | Key | Value | Meaning |
| --- | --- | --- | --- |
| `AgentProfile` | `ManifestVersionKey` | `ManifestVersion { value }` | monotonic manifest version |
| `AgentProfile` | `WithdrawalKey` | `WithdrawalRequest { amount, available_at_ms }` | legacy bond withdrawal in flight |
| `AgentProfile` | `StakeKey` | `StakeRecord { staker, amount }` | who staked and how much |
| `AgentProfile` | `UnstakeKey` | `UnstakeRequest { amount, available_at_ms }` | unstake maturing |
| `Registry` | `PayoutRecipientKey { agent_profile_id }` | `address` | where that seat's jury rewards go |
| `JurySeat` | `SeatTimingKey` | `SeatTiming { commit_deadline_ms, reveal_deadline_ms }` | per-seat deadlines |
| `Committee` | `CommitteePolicyKey` | `CommitteePolicy { hash vectors, acceptance_deadline_ms }` | private diversity metadata |
| `Committee` | `CommitteePayoutsKey` | `CommitteePayouts { selected, reserves }` | payout recipients, snapshotted at draw time |

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
id (`jury.move:716-719`). Disambiguate by phase.

Payout reasons are 1 creator refund, 2 jury reward, 3 proposer win, 4
challenger win, 5 proposer refund, 6 challenger refund, 7 cancelled, 8 protocol
fee (`settlement.move:26-33`).

## Abort codes

A Move abort aborts the whole transaction, so a violated precondition is never
a partial write. These are the exact numeric codes.

### agent_registry

| Code | Value | Raised when |
| --- | --- | --- |
| `E_PAUSED` | 0 | the registry is paused |
| `E_NOT_PAUSED` | 1 | `unpause` while not paused |
| `E_INVALID_MANIFEST` | 2 | a manifest hash is not 32 bytes, or the blob id is empty |
| `E_INVALID_BOND` | 3 | bond below the minimum, zero deposit, or a withdrawal above the bond |
| `E_REGISTRY_FULL` | 4 | already at `MAX_ELIGIBLE_AGENTS`, 32 |
| `E_CAP_MISMATCH` | 5 | the `AgentCap` names another profile |
| `E_AGENT_ACTIVE` | 6 | bond withdrawal requested while still active |
| `E_WITHDRAWAL_EXISTS` | 7 | a withdrawal is already pending |
| `E_WITHDRAWAL_MISSING` | 8 | no withdrawal to complete |
| `E_WITHDRAWAL_NOT_READY` | 9 | the 24-hour delay has not elapsed |
| `E_NOT_AGENT_OWNER` | 10 | the sender is not the profile owner |
| `E_AGENT_NOT_FOUND` | 11 | no eligibility record for that profile |
| `E_INVALID_WEIGHT` | 12 | weight zero or above `MAX_SELECTION_WEIGHT` |
| `E_INVALID_PROTOCOL_FEE` | 13 | fee above `MAX_PROTOCOL_FEE_BPS`, 2000 |
| `E_STAKE_TOO_SMALL` | 14 | stake below `MIN_STAKE_MIST`, 0.1 SUI |
| `E_NOT_STAKER` | 15 | the sender is not the position's staker |
| `E_POSITION_MISMATCH` | 16 | the position names another profile |
| `E_UNSTAKE_EXISTS` | 17 | an unstake is already pending |
| `E_UNSTAKE_MISSING` | 18 | no unstake to complete |
| `E_UNSTAKE_NOT_READY` | 19 | the 24-hour delay has not elapsed |

### claim

| Code | Value | Raised when |
| --- | --- | --- |
| `E_INVALID_MODE` | 0 | the mode is not 1 or 2, or the entry does not match the mode |
| `E_INVALID_CONTENT` | 1 | the content hash is not 32 bytes, or a required blob id is empty |
| `E_INVALID_DEADLINES` | 2 | the seven deadlines are not strictly increasing after now |
| `E_DURATION_TOO_LONG` | 3 | the ladder spans more than `MAX_TOTAL_DURATION_MS`, 30 days |
| `E_INVALID_BUDGET` | 4 | a budget is over the cap, overflows, or the coin does not equal the total |
| `E_INVALID_STATE` | 5 | wrong claim state for the operation |
| `E_DEADLINE_PASSED` | 6 | the action window has closed |
| `E_DEADLINE_NOT_REACHED` | 7 | `advance_phase` before the deadline with seats still uncommitted |
| `E_INVALID_OUTCOME` | 8 | the proposed outcome is not YES, NO or UNSURE |
| `E_BOND_MISMATCH` | 9 | the challenger bond is zero or unequal to the proposer bond |
| `E_ALREADY_LINKED` | 10 | the committee, tally or evidence bundle is already linked |
| `E_NOT_CREATOR` | 11 | the sender is not the claim creator |
| `E_PARTY_CONFLICT` | 12 | the challenger equals the proposer, or none is set |

### evidence

| Code | Value | Raised when |
| --- | --- | --- |
| `E_INVALID_PHASE` | 0 | the phase is not 1 or 2, or the bundle names another phase |
| `E_INVALID_ROOT` | 1 | the root is not 32 bytes |
| `E_INVALID_MANIFEST` | 2 | the manifest blob id is empty |
| `E_INVALID_POLICY` | 3 | the policy id is empty or does not match the claim |
| `E_RETENTION_EXPIRED` | 4 | the Walrus end epoch is already in the past |
| `E_CLAIM_MISMATCH` | 5 | the bundle names another claim |

### jury

| Code | Value | Raised when |
| --- | --- | --- |
| `E_INSUFFICIENT_DIVERSE_AGENTS` | 0 | the roster is too small or large, the draw ran out of attempts, or diversity failed |
| `E_INVALID_CLAIM_STATE` | 1 | the claim is not in the state this call requires |
| `E_COMMITTEE_MISMATCH` | 2 | the committee and the claim do not name each other |
| `E_TALLY_MISMATCH` | 3 | the tally does not bind the same claim, committee, phase or root |
| `E_SEAT_MISMATCH` | 4 | the seat does not bind the claim, committee or phase |
| `E_CAP_MISMATCH` | 5 | the `AgentCap` names another profile |
| `E_INVALID_SEAT_STATUS` | 6 | the seat is not in the status this call requires |
| `E_DEADLINE_PASSED` | 7 | the commit or acceptance deadline has passed |
| `E_REVEAL_NOT_OPEN` | 8 | a reveal before the commit deadline while seats are still uncommitted |
| `E_INVALID_PHASE` | 9 | a phase is not 1 or 2, or two objects disagree on it |
| `E_INVALID_HASH` | 10 | a hash is not 32 bytes, or a blob id is empty |
| `E_INVALID_OUTCOME` | 11 | the outcome is not YES, NO or UNSURE |
| `E_INVALID_CONFIDENCE` | 12 | `confidence_bps` above 10000 |
| `E_COMMITMENT_MISMATCH` | 13 | **the revealed vote does not reproduce the commitment** |
| `E_UNEXPECTED_SEAT` | 14 | the seat is not one of the expected seats |
| `E_DUPLICATE_REVEAL` | 15 | that seat has already revealed |
| `E_TALLY_CLOSED` | 16 | the tally is closed |
| `E_COMMITTEE_LOCKED` | 17 | the committee is already locked |
| `E_COMMITTEE_NOT_LOCKED` | 18 | round two needs a locked committee |
| `E_INVALID_RESERVE` | 19 | the reserve index is out of range, or the swap breaks diversity |
| `E_DEADLINE_NOT_REACHED` | 20 | a lock before the acceptance deadline, or a discussion before the reveal deadline |
| `E_EVIDENCE_NOT_BOUND` | 21 | the evidence root is unbound or bound to a different value |
| `E_CONSENSUS_REACHED` | 22 | round one already reached a threshold, so there is no second round |
| `E_RETENTION_EXPIRED` | 23 | a Walrus end epoch is already in the past |
| `E_NOT_AGENT_OWNER` | 24 | the sender is not the seat's agent owner |

### settlement

| Code | Value | Raised when |
| --- | --- | --- |
| `E_INVALID_STATE` | 0 | the claim, tally phase or committee lock is wrong for this call |
| `E_DEADLINE_NOT_REACHED` | 1 | the challenge or reveal window is still open |
| `E_FIRST_ROUND_NO_CONSENSUS` | 2 | **a split first round cannot be finalized**; it must go to the table |
| `E_INVALID_RESULT` | 3 | the result is not YES, NO or UNRESOLVED |
| `E_TICKET_CLAIM_MISMATCH` | 4 | the ticket names another claim |
| `E_NOT_RECIPIENT` | 5 | the sender is not the ticket's recipient |
| `E_NOT_TERMINAL` | 6 | a withdrawal on a claim that has not settled |
| `E_RETENTION_EXPIRED` | 7 | the evidence Walrus epoch is already in the past |
| `E_PAYOUT_OVERFLOW` | 8 | the allocated payouts exceed the budget |

### demo_fact_checker

`E_NOT_DIRECT_REVIEW` 0, `E_BUDGET_TOO_LARGE` 1, `E_BUDGET_MISMATCH` 2.

### reveal_lock

This module uses Sui `#[error]` string constants rather than numeric codes:

| Constant | Value |
| --- | --- |
| `ENotYetOpen` | `the reveal deadline in this identity has not passed` |
| `EMalformedIdentity` | `identity must be claim, seat, phase, deadline` |

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
anything other than the exact string `mainnet` resolves to testnet. SuiVision
keeps the network in the host, so the base is `https://testnet.suivision.xyz`
on testnet and `https://suivision.xyz` on mainnet.

| Target | Shape |
| --- | --- |
| Object, including a package | `<base>/object/<id>` |
| Address | `<base>/account/<address>` |
| Transaction | `<base>/txblock/<digest>` |
| Walrus blob | `https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>` |

A Sui package is an object, so a package link uses the object shape.
SuiVision also serves `<base>/package/<packageId>`, but the object page is
the one the app links to.

## Upgrades

The package was published once on 2026-08-27 and upgraded several times since,
most recently for real stake, for the draw resample after repeated stalls, and
for the twenty-second acceptance window. Object types stayed at the original
address throughout. The only record of the id history is the git history of
`config/release.testnet.json`; the upgrade capability is held by the single
operator key. The Seal policy package has never been upgraded.

## Hosts and routing

One deployment serves three hostnames. The rules live in
`lib/web/host-routing.ts` and are applied by `proxy.ts`.

```mermaid
flowchart TB
    R["request arrives<br/>host from x-forwarded-host, else host"] --> D{"host starts<br/>with docs. ?"}
    D -->|"yes"| D1{"path already<br/>starts with /docs ?"}
    D1 -->|"yes"| PASS["serve as requested<br/>no double prefix"]
    D1 -->|"no, path is /"| DR["rewrite to /docs"]
    D1 -->|"no, path is /x"| DX["rewrite to /docs/x"]
    D -->|"no"| W{"host is<br/>www.&lt;apex&gt; ?"}
    W -->|"yes"| WR["308 redirect to the apex,<br/>path and query preserved"]
    W -->|"no"| A{"host is the apex<br/>and the path is a console path?"}
    A -->|"yes"| AR["308 redirect to the app host<br/>(/app becomes /)"]
    A -->|"no"| AP{"host starts<br/>with app. and path is / ?"}
    AP -->|"yes"| APR["rewrite to /app"]
    AP -->|"no"| PASS
```

Host routing. Redirects need `NEXT_PUBLIC_APP_URL` and are no-ops without it;
the docs rewrite fires on the hostname alone. Source:
`lib/web/host-routing.ts`, `proxy.ts`.

Two consequences worth stating. `/docs/*` keeps working on every host, so a
link copied from the console never breaks. And the proxy matcher skips `/api/`,
`/_next/` and any path containing a dot, so API calls, assets and the diagram
images on this site are never rewritten.

## Environment variables

The release manifest is the source of truth for chain ids, networks and model
catalogues. The environment wires the process. Anything marked SECRET must
never be printed, logged or committed.

### Chain and signing

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `SUI_OPERATOR_SECRET_KEY` | **yes**, SECRET | none, hard failure | The bech32 operator key that signs every lifecycle transaction and every Walrus register and certify. Missing, the engine never builds and every route returns 503 |
| `SUI_CHALLENGER_SECRET_KEY` | optional, SECRET | derived from the agent seed | A distinct challenger signer |
| `OPENVERDICT_RELEASE_MANIFEST` | effectively yes off localnet | `config/release.localnet.json` | Path to the release manifest. Point it at the wrong network and the app writes to the wrong chain |
| `OPENVERDICT_SUI_GRPC_URL` | optional | the manifest's `suiRpcUrl` | gRPC full node override for Walrus writes. An override, not a fallback |
| `SHINAMI_GAS_ACCESS_KEY` | optional, SECRET | none, sponsorship off | Gas station key. Unset, users pay their own gas |
| `SHINAMI_GAS_ENDPOINT` | optional | `https://api.us1.shinami.com/sui/gas/v1` | Regional endpoint override |

### Inference and research

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `GONKA_ROUTER_API_KEY` | yes in live mode, SECRET | none, hard failure | Bearer credential for every juror call. It doubles as a redaction needle so it can never leak into a client error |
| `GONKA_ROUTER_BASE_URL` | optional | the manifest's `gonka.baseUrl` | Gateway base URL. Re-execution refuses any host outside gonkarouter.io |
| `GONKA_REQUEST_TIMEOUT_MS` | optional | `120000` | Per-call inference timeout. Too low turns healthy calls into `TIMEOUT` failures |
| `GONKA_RESEARCH_TIMEOUT_MS` | optional | `90000` in code | Timeout for the research loop, which carries a growing conversation |
| `GONKA_HEDGE_AFTER_MS` | optional | `25000` | Repeat a call to the same model after this long to hedge a slow node. `0` disables it |
| `GONKA_MAX_RETRIES` | optional | `1` | Retry budget per inference attempt |
| `FIRECRAWL_API_KEY` | yes in live mode, SECRET | none, hard failure | The search and open provider for juror research |
| `FIRECRAWL_API_URL` | optional | the provider's cloud default | Point at a self-hosted instance to run without credits |

### Storage and workers

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | production yes, SECRET | embedded PGlite | Postgres connection string. **It also switches on worker tick locking:** with no `DATABASE_URL` the workers take no advisory lock and two replicas can tick the same claim |
| `PGLITE_DATA_DIR` | optional | `.pglite` | Writable directory for embedded PGlite. Only read when `DATABASE_URL` is unset |
| `OPENVERDICT_WORKER_POLL_MS` | optional | `2000` | Poll interval while a claim is live |
| `OPENVERDICT_WORKER_IDLE_POLL_MS` | optional | `15000` | Poll interval between claims |
| `OPENVERDICT_WAKE_FILE` | optional | `<tmpdir>/openverdict-wake` | The file whose mtime wakes idle workers. Web and workers must agree on the path |
| `OPENVERDICT_OPERATOR_GAS_SLOT` | optional | none | Pins which operator coin this process pays with, so four processes never equivocate one coin |
| `OPENVERDICT_TICK_LOCK_NAME` | optional | the worker's own name | Advisory lock name, so each role ticks independently while two replicas of one role exclude each other |

### Web

| Variable | Client-visible | Default | What it does |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUI_NETWORK` | yes | `testnet` for anything but `mainnet` | Selects the wallet network, the explorer path, the Walrus aggregator and the Seal key servers |
| `NEXT_PUBLIC_APP_URL` | yes | `<site>/app` | The console origin. Set it and the header hands visitors across and the proxy redirects console paths there |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://openverdict.info` | Canonical landing origin for metadata, robots and the sitemap |
| `NEXT_PUBLIC_DOCS_URL` | yes | `/docs` | The documentation origin. Unset, doc links stay in-app |
| `NEXT_PUBLIC_ENOKI_API_KEY` | yes | none, social login hidden | Enables Enoki social sign-in, testnet and mainnet only |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | yes | none | The Google OAuth client for Enoki. Required together with the key |

Every `NEXT_PUBLIC_` value is inlined at build time, so each one must also be a
Dockerfile build ARG or it never reaches the client bundle.

### Guards and protocol behaviour

These do not merely point at infrastructure. They change what the protocol
does, what it costs, or who may act.

| Variable | Accepted values | Behaviour |
| --- | --- | --- |
| `OPENVERDICT_PUBLIC_WRITES` | exactly `enabled` | Gates every public write route. Anything else returns 403 `writes_disabled` |
| `OPENVERDICT_OPERATOR_TOKEN` | at least 16 characters, SECRET | Bearer token for operator routes. Compared as SHA-256 digests in constant time, with one uniform 403 on failure |
| `OPENVERDICT_TRUST_PROXY` | exactly `1` | Enables per-IP rate limiting. **Only set it behind a genuinely trusted proxy**, or `x-forwarded-for` becomes attacker-controlled |
| `OPENVERDICT_FREE_SEATS` | exactly `enabled` | Re-opens the legacy path where the operator posts the bond. Off by default |
| `OPENVERDICT_DELIBERATION_SPEC` | exactly `3` selects V3, anything else V4 | Chooses the live deliberation contract, and therefore the prompt hash jurors bind to |
| `OPENVERDICT_PROPOSER_BOND` | decimal string, default `1` | The bond posted on a proposal and on a challenge |
| `OPENVERDICT_DEFAULT_COMMITTEE_BUDGET` | MIST string, default `10000000` | The juror payment budget on every public fact check |
| `OPENVERDICT_DEFAULT_EVIDENCE_BUDGET` | MIST string, default `0` | The evidence bounty on public claims |
| `OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS` | non-negative number, default `30000` | The fallback lead before the discussion deadline for the phase-two freeze |
| `OPENVERDICT_AGENT_SEED` | non-empty, SECRET | none, hard failure | Derives every demo agent address, the fallback challenger key and every Walrus writer. **Changing it relocates all of them** |
| `OPENVERDICT_AGENT_SLOTS` | integer at least 7, default `16` | Sizes the derived signing-slot pool. Lowering it can orphan a staked seat's owner address |
| `OPENVERDICT_WALRUS_WRITERS` | non-negative integer, default `4` | Independent Walrus write lanes. `0` routes every write through the operator |
| `OPENVERDICT_ROLE` | exactly `workers` | Runs only the three workers and skips Next.js. Anything else runs both |

Four entries in `.env.example` are inert: `SUI_NETWORK`, `SUI_RPC_URL` and
`WALRUS_NETWORK` are superseded by the release manifest, and
`NEXT_PUBLIC_WRITE_MODE` is superseded by `OPENVERDICT_PUBLIC_WRITES`. Setting
them has no effect.

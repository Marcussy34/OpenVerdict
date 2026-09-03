# Real stake on juror seats (design, 2026-09-04)

Owner decisions (chat, 2026-09-04 01:20 to 01:40): "we can make code changes,
its fine", "ok we can do that", both steps approved, minimum stake 0.1 SUI
(lead's suggestion, unchallenged). Companion to 2026-09-03-ov-cli-design.md
and the stake vocabulary decision of 2026-09-03.

## Why

Stake never touches a verdict: a seat's vote comes from a pinned model with
pinned prompts and tools, run by the operator pipeline, bound to frozen
evidence, sealed and revealed on Sui. Stake decides who earns a seat's
rewards and who loses its bond. Today three things are wrong:

1. The committee draw refuses two seats with the same staker hash per jury.
   That protects nothing (an address is free, and a staker cannot influence
   a vote) and forces at least seven distinct staker hashes among active
   agents.
2. The bond minimum is one MIST and the operator posts it, so "staking" is a
   signature: anyone creates seats for free that cost the operator Gonka
   money on every draw.
3. Nothing records who should be paid for a seat, so a staker could never
   receive that seat's jury rewards.

## What changes (summary)

- Draw caps become: two seats per model family (three families per jury),
  one seat per operational signing key. No cap per staker.
- A seat is registered by its staker in one wallet transaction that posts
  the stake (0.1 SUI minimum) and names the operational owner (an engine
  signing slot). The staker is recorded as the seat's payout recipient; jury
  reward tickets for that seat go to the staker. Unstaking deactivates the
  seat and returns the bond after the existing 24 hour delay.
- The transaction is gas-sponsored through Shinami (the sponsor allowlist
  gains this one target); Google sign-in users can stake with 0.1 SUI and no
  gas.
- The old signed-message registration (operator pays, no money at risk) is
  gated behind OPENVERDICT_FREE_SEATS=enabled and off by default.
- Existing seats and committees are untouched: payout routing falls back to
  today's behaviour (the seat's owner) wherever no staker is recorded.

Everything is additive and compatible with a Sui package upgrade: no
existing struct layout changes, no existing entry signature changes; new
entry functions, new structs, dynamic fields, one new constant.

## Move: agent_registry

Constants and types (new):

```move
const MIN_STAKE_MIST: u64 = 100_000_000; // 0.1 SUI

/// Owned by the staker; the only way to unstake.
public struct StakePosition has key, store {
    id: UID,
    agent_profile_id: ID,
    staker: address,
    amount: u64,
}
/// Dynamic field on AgentProfile: who staked and how much.
public struct StakeKey has copy, drop, store {}
public struct StakeRecord has store { staker: address, amount: u64 }
/// Dynamic field on Registry keyed by profile id: where jury rewards go.
public struct PayoutRecipientKey has copy, drop, store { agent_profile_id: ID }
/// Dynamic field on AgentProfile while an unstake matures.
public struct UnstakeKey has copy, drop, store {}
public struct UnstakeRequest has store { amount: u64, available_at_ms: u64 }

public struct AgentStaked has copy, drop {
    agent_profile_id: ID, staker: address, operational_owner: address, amount: u64,
}
public struct UnstakeRequested has copy, drop {
    agent_profile_id: ID, staker: address, amount: u64, available_at_ms: u64,
}
public struct Unstaked has copy, drop { agent_profile_id: ID, staker: address, amount: u64 }
```

Entry functions (new; `register_agent` and every existing function stay):

```move
/// The sender stakes on a standardized seat: the stake becomes the seat's
/// bond, the sender becomes its payout recipient, the operational owner runs
/// it and receives the AgentCap. Same manifest checks and registry cap as
/// register_agent. Emits AgentRegistered (owner = operational_owner) and
/// AgentStaked. The StakePosition goes to the sender.
public entry fun register_staked_agent(
    registry: &mut Registry,
    stake: Coin<SUI>,
    manifest_hash: vector<u8>,
    manifest_blob_id: vector<u8>,
    model_hash: vector<u8>,
    role_hash: vector<u8>,
    staker_hash: vector<u8>,        // stored in human_backing_hash (field name is historical)
    operational_owner: address,
    _clock: &Clock,
    ctx: &mut TxContext,
)
/// Staker only. Deactivates the seat (profile and registry record, like
/// deprecate_agent) and starts the 24 h withdrawal of the whole bond.
public entry fun request_unstake(
    registry: &mut Registry, profile: &mut AgentProfile, position: &StakePosition,
    clock: &Clock, ctx: &mut TxContext,
)
/// Staker only, after the delay. Pays the bond to the staker, consumes the
/// position. Pausing never blocks this exit.
public entry fun complete_unstake(
    profile: &mut AgentProfile, position: StakePosition, clock: &Clock, ctx: &mut TxContext,
)
```

Readers (new): `min_stake_mist(): u64`, `payout_recipient(registry: &Registry,
agent_profile_id: ID, fallback: address): address` (dynamic field or the
fallback), `profile_staker(profile: &AgentProfile): Option<address>`,
`profile_stake_amount`, `stake_position_profile_id`, `stake_position_staker`,
`stake_position_amount`, `has_unstake_request`.

Errors (new codes after 13): `E_STAKE_TOO_SMALL`, `E_NOT_STAKER`,
`E_POSITION_MISMATCH`, `E_UNSTAKE_EXISTS`, `E_UNSTAKE_MISSING`,
`E_UNSTAKE_NOT_READY`.

## Move: jury and settlement

- Draw: `can_add_selected` and `can_add_reserve` drop the staker hash
  check (`contains_human_hash`); `replacement_preserves_diversity` drops the
  `all_unique_hashes(&humans)` term. Model caps (two per model, three
  families), role rules, one seat per owner, profile uniqueness stay. The
  CommitteePolicy struct keeps its human hash vectors (layout unchanged);
  they are simply no longer a constraint.
- `create_first_round` receives `registry: &Registry` from
  `select_committee` and adds a dynamic field on the committee:

```move
public struct CommitteePayoutsKey has copy, drop, store {}
public struct CommitteePayouts has store { selected: vector<address>, reserves: vector<address> }
```

  filled with `agent_registry::payout_recipient(registry, profile_id, owner)`
  for every seat and reserve. `replace_declined_seat` swaps and removes the
  matching entries when the field exists.
- `public(package) fun payout_recipient_for_expected_index(committee, index):
  address` returns the dynamic field entry when present, else
  `agent_owners[index]`. `settlement::create_reviewed_payouts` uses it for
  REASON_JURY_REWARD tickets. Committees created before the upgrade have no
  field and behave exactly as today.

Move tests (extend the existing files, same style): draw succeeds with only
four distinct staker hashes among seven records; staked registration stores
the position, the stake record and the payout recipient; MIN_STAKE enforced;
non-staker cannot unstake; unstake request deactivates and the completion
respects the delay and pays the staker; a settlement with a staked seat
routes that seat's reward ticket to the staker while the other seats' tickets
go to their owners; a committee without the payout field routes to owners;
replacement keeps the routing aligned. `sui move test` must stay green
(currently 76 plus the new ones). `pnpm test:move`.

## Engine and API

Slots: the engine's operational signing slots come from
`OPENVERDICT_AGENT_SLOTS` (env, default 16; server.ts currently hardcodes
7). Slots 0 to 6 belong to the demo agents on testnet. Used owners = owners of
stored manifests plus owners of live stake reservations.

Repository: table `stake_reservations` (migrate.ts + schema.ts + types.ts):
reservation_id (uuid), staker_address, slot_index, operational_owner,
model_id, role, manifest_hash, manifest_blob_id, document_version,
prompt_hash, tool_policy_hash, table_vote_prompt_hash, evidence_policy_hash,
staker_hash, status (PENDING | CONFIRMED | EXPIRED), created_at, expires_at
(15 minutes), digest, agent_profile_id. Records are stored as record_json like
agent_manifests, keyed by reservation_id.

`AgentManifest` (lib/protocol/types.ts) gains optional `stakerAddress?:
HexString` and `stakeMist?: string`. `humanVerificationProvider` for staked
seats is `"sui-wallet-stake"`; `agentBackingStatus` maps it to kind
`"WALLET"`. `AgentDirectoryEntry` gains `staker?: string` and `stakeMist?:
string`; `earnedMist` sums REASON_JURY_REWARD tickets whose recipient is the
owner or the staker.

Engine methods (contract.ts, implemented in engine.ts):

```ts
prepareStake(input: { stakerAddress: string; modelId: string; role: string }): Promise<StakePreparation>
// validates model (manifest catalog) and role (ZKLOGIN_AGENT_ROLES), allocates
// the first free slot, builds the manifest document (backingKind WALLET_STAKED,
// humanBackingHash = blake2b256(stakerAddress), operationalOwner = slot),
// uploads it to Walrus, stores the reservation.
type StakePreparation = {
  reservationId: string; expiresAt: string;
  target: { packageId: string; registryObjectId: string; clockObjectId: string };
  args: { manifestHash: Hex; manifestBlobId: string; modelHash: Hex; roleHash: Hex; stakerHash: Hex; operationalOwner: Hex };
  minStakeMist: string; // "100000000"
};
confirmStake(input: { reservationId: string; digest: string }): Promise<StakeConfirmation>
// waits for the transaction (effects, events, object types), checks the
// AgentStaked event (operational_owner and amount >= min) and the
// AgentRegistered event (manifest hash equals the reservation), finds the
// AgentCap created for the operational owner, binds the slot
// (signers.bindAgentProfile), saves the AgentManifest record (stakerAddress,
// stakeMist, provider sui-wallet-stake), marks the reservation CONFIRMED,
// then tops up the slot's gas float, and returns:
type StakeConfirmation = {
  agentProfileId: string; staker: string; stakeMist: string; digest: string;
  backingKind: "WALLET_STAKED"; operationalOwner: string;
};
```

Gas float: a staked seat's operational key signs its own commits and
reveals, so on confirm the engine transfers `SEAT_GAS_FLOAT_MIST` (300,000,000
= 0.3 SUI) from the operator to the slot when its balance is below
200,000,000. New gateway method `fundAddress({ address, amountMist })`
(operator keypair, `tx.transferObjects([tx.splitCoins(tx.gas, [amount])],
address)`). Failure to fund is logged and reported in the confirmation as
`gasFloat: "funded" | "skipped" | "failed"`; it never fails the confirm.

Routes (public write guards: requirePublicWritesEnabled, rateLimitPublic):
- `POST /api/agents/stake/prepare` body `{ address, modelId, role }` ->
  200 StakePreparation; 400 validation; 409 `{ error: "slots_exhausted" }`;
  503 engine_not_wired.
- `POST /api/agents/stake/confirm` body `{ reservationId, digest }` -> 200
  StakeConfirmation; 400 when the transaction does not match the
  reservation; 404 unknown or expired reservation; 502 when the chain read
  fails; idempotent for a CONFIRMED reservation (returns the stored result).
- `POST /api/agents/register` (signed message, operator pays) answers 403
  `{ error: "free_seats_disabled", message: "stake on a seat through /agents" }`
  unless `OPENVERDICT_FREE_SEATS=enabled`. Tests set the flag.
- Sponsor allowlist (lib/sui/sponsor-policy.ts): app targets are
  `demo_binary_pool::enter` and `agent_registry::register_staked_agent` in
  the deployed package; a kind must contain at least one app target; the
  coin helpers and every other rule stay.

Builders (lib/sui/builders.ts): `buildRegisterStakedAgentTransaction(manifest,
input)` for scripts and the E2E (the browser builds its own PTB from the
preparation, same argument order).

Script `scripts/stake-seat.ts` (`pnpm stake:seat --base <url> --model <id>
--role SKEPTIC [--key <bech32 secret>] [--no-sponsor]`): prepare through the
API, build the PTB, sponsor through `POST /api/sponsor` (or pay gas with the
key when `--no-sponsor` or 503), sign, execute, confirm through the API,
print the profile id, the position id and the digest. Without `--key` on
testnet it derives a throwaway key and funds it with 0.2 SUI from the
operator (SUI_OPERATOR_SECRET_KEY in .env). This is the lead's live check and
the "ov stake" of the future.

E2E (scripts/localnet-e2e.ts): after `registerAgents`, one staked
registration by the harness user keypair through
`buildRegisterStakedAgentTransaction`, gas sponsored by the operator coins
(`sponsorAndExecute`), asserting the eighth registry record, the
StakePosition owned by the user, and `payout_recipient` == user (read the
dynamic field). Then `request_unstake` and assert the record is inactive
and the profile carries the unstake request. The direct-review and
split-vote lifecycles must still pass. The E2E signer registry needs eight
slots (the staked seat's operational owner is slot seven).

## UI and docs

Registration card (`components/agents/zklogin-registration-card.tsx`,
rename to `stake-seat-card.tsx` with the import updated): "Stake 0.1 SUI on
a juror seat". Flow: connect (any wallet or Google) -> choose model and role
-> Prepare (POST prepare; shows "seat prepared, manifest on Walrus") ->
Stake: build the PTB from the preparation with `tx.coin({ balance:
minStakeMist, type: "0x2::sui::SUI", useGasCoin: false })`, POST
/api/sponsor, `dAppKit.signTransaction` with the returned bytes, execute with
both signatures; on 503/403/429/502 from the sponsor route fall back to
`signAndExecuteTransaction` (wallet pays gas) -> Confirm (POST confirm) ->
success: profile id, stake, "gas paid by OpenVerdict" or "by your wallet",
"unstake any time; the bond returns 24 hours later". Errors in plain words
(not enough SUI: "You need 0.1 SUI for the stake" plus "and a little for
gas" when sponsorship is off; expired reservation: "Start again").
Iconsax icons, shadcn components, no em dashes.

Agents page and agent detail: stake kind label, "Staked 0.10 SUI by
0x12ab…cd34" for staked seats, earned rewards routed to the staker.

Copy (README stake paragraph, PRD §14.4 / §32.3 / glossary, learn page,
skill reference and faq): stake is real money (0.1 SUI minimum) posted by
the staker, who receives the seat's jury rewards and loses the bond when the
seat is slashed; the draw caps are two per model family and one per
operational key; no cap per staker; unstake returns the bond after 24 hours.
The old "gate on that faucet" sentence is replaced.

## Rollout

1. Move tests green, then the full localnet E2E green on the new bytecode.
2. Testnet package upgrade (`sui move build --dump-bytecode-as-base64
   --build-env testnet --no-tree-shaking`, `pnpm tsx
   scripts/upgrade-openverdict-bytecode.ts <bytecode.json>`, writes the new
   packageId into config/release.testnet.json).
3. App deploy at a free window with OPENVERDICT_AGENT_SLOTS=16, seeder paused.
4. Live check with `pnpm stake:seat` against production, then the agents
   page shows the staked seat.

## Out of scope (later rungs)

Several stakers per seat with pro-rata payouts; stake-weighted draws with a
cap; slashing rules beyond the existing bond mechanics; independent
operators with their own keys; the on-chain Display string.

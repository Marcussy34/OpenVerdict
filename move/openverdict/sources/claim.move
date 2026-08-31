/// Claim creation, optimistic dispute flow, phase state, and fund vaults.
module openverdict::claim {
    use openverdict::agent_registry::{Self, Registry};
    use std::type_name;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::hash;

    // === Errors ===

    const E_INVALID_MODE: u64 = 0;
    const E_INVALID_CONTENT: u64 = 1;
    const E_INVALID_DEADLINES: u64 = 2;
    const E_DURATION_TOO_LONG: u64 = 3;
    const E_INVALID_BUDGET: u64 = 4;
    const E_INVALID_STATE: u64 = 5;
    const E_DEADLINE_PASSED: u64 = 6;
    const E_DEADLINE_NOT_REACHED: u64 = 7;
    const E_INVALID_OUTCOME: u64 = 8;
    const E_BOND_MISMATCH: u64 = 9;
    const E_ALREADY_LINKED: u64 = 10;
    const E_NOT_CREATOR: u64 = 11;
    const E_PARTY_CONFLICT: u64 = 12;

    const PROTOCOL_VERSION: u64 = 1;
    const MAX_TOTAL_DURATION_MS: u64 = 2_592_000_000;
    const MAX_COMPONENT_BUDGET: u64 = 1_000_000_000_000;
    const HASH_LENGTH: u64 = 32;

    const CLAIM_MODE_DIRECT_REVIEW: u8 = 1;
    const CLAIM_MODE_OPTIMISTIC_SETTLEMENT: u8 = 2;

    const OUTCOME_NONE: u8 = 0;
    const OUTCOME_YES: u8 = 1;
    const OUTCOME_NO: u8 = 2;
    const OUTCOME_UNSURE: u8 = 3;
    const RESULT_UNRESOLVED: u8 = 4;

    const STATE_CREATED: u8 = 0;
    const STATE_PROPOSED: u8 = 1;
    const STATE_CHALLENGED: u8 = 2;
    const STATE_REVIEW_REQUESTED: u8 = 3;
    const STATE_COMMIT_1: u8 = 4;
    const STATE_REVEAL_1: u8 = 5;
    const STATE_DISCUSSION: u8 = 6;
    const STATE_COMMIT_2: u8 = 7;
    const STATE_REVEAL_2: u8 = 8;
    const STATE_FINALIZED_UNCHALLENGED: u8 = 9;
    const STATE_FINALIZED_REVIEWED: u8 = 10;
    const STATE_UNRESOLVED: u8 = 11;
    const STATE_CANCELLED: u8 = 12;

    /// Pure creation parameters shared with transaction builders.
    public struct ClaimParams has copy, drop, store {
        claim_mode: u8,
        proposal_deadline_ms: u64,
        challenge_deadline_ms: u64,
        first_commit_deadline_ms: u64,
        first_reveal_deadline_ms: u64,
        discussion_deadline_ms: u64,
        second_commit_deadline_ms: u64,
        second_reveal_deadline_ms: u64,
        creation_budget_amount: u64,
        committee_budget_amount: u64,
        evidence_budget_amount: u64,
    }

    /// Tally-bound proof used to advance a commit phase safely.
    public struct PhaseReadiness has key {
        id: UID,
        claim_id: ID,
        tally_id: ID,
        phase: u8,
        all_seats_committed: bool,
    }

    /// Packs challenge audit pointers AND the fee policy snapshot together:
    /// the Claim struct sits exactly at the validator's 32-field limit, so
    /// new scalar state must live inside this sub-struct, never on Claim.
    public struct ChallengeReason has store, drop {
        hash: vector<u8>,
        blob_id: vector<u8>,
        treasury: address,
        protocol_fee_bps: u64,
    }

    /// Shared claim object. All deposited value remains in these vaults until withdrawal.
    public struct Claim<phantom T> has key {
        id: UID,
        protocol_version: u64,
        claim_mode: u8,
        creator: address,
        content_hash: vector<u8>,
        statement_blob_id: vector<u8>,
        criteria_blob_id: vector<u8>,
        evidence_policy_id: vector<u8>,
        first_evidence_bundle_id: Option<ID>,
        second_evidence_bundle_id: Option<ID>,
        committee_id: Option<ID>,
        first_round_tally_id: Option<ID>,
        second_round_tally_id: Option<ID>,
        resolution_certificate_id: Option<ID>,
        proposal_deadline_ms: u64,
        challenge_deadline_ms: u64,
        first_commit_deadline_ms: u64,
        first_reveal_deadline_ms: u64,
        discussion_deadline_ms: u64,
        second_commit_deadline_ms: u64,
        second_reveal_deadline_ms: u64,
        proposer: Option<address>,
        challenger: Option<address>,
        challenge_reason: ChallengeReason,
        proposal: u8,
        result: u8,
        state: u8,
        creation_budget: Balance<T>,
        proposer_bond: Balance<T>,
        challenger_bond: Balance<T>,
        committee_budget: Balance<T>,
        evidence_budget: Balance<T>,
    }

    public struct ClaimCreated has copy, drop {
        claim_id: ID,
        creator: address,
        claim_mode: u8,
        content_hash: vector<u8>,
        coin_type_hash: vector<u8>,
    }

    public struct OutcomeProposed has copy, drop {
        claim_id: ID,
        proposer: address,
        outcome: u8,
        amount: u64,
    }

    public struct OutcomeChallenged has copy, drop {
        claim_id: ID,
        challenger: address,
        reason_hash: vector<u8>,
        amount: u64,
    }

    /// Construct creation parameters without relying on struct-literal access off module.
    public fun new_claim_params(
        claim_mode: u8,
        proposal_deadline_ms: u64,
        challenge_deadline_ms: u64,
        first_commit_deadline_ms: u64,
        first_reveal_deadline_ms: u64,
        discussion_deadline_ms: u64,
        second_commit_deadline_ms: u64,
        second_reveal_deadline_ms: u64,
        creation_budget_amount: u64,
        committee_budget_amount: u64,
        evidence_budget_amount: u64,
    ): ClaimParams {
        ClaimParams {
            claim_mode,
            proposal_deadline_ms,
            challenge_deadline_ms,
            first_commit_deadline_ms,
            first_reveal_deadline_ms,
            discussion_deadline_ms,
            second_commit_deadline_ms,
            second_reveal_deadline_ms,
            creation_budget_amount,
            committee_budget_amount,
            evidence_budget_amount,
        }
    }

    /// Create and share a claim in CREATED state from entry-safe primitive arguments.
    public entry fun create_claim<T>(
        registry: &Registry,
        creator_budget: Coin<T>,
        claim_mode: u8,
        proposal_deadline_ms: u64,
        challenge_deadline_ms: u64,
        first_commit_deadline_ms: u64,
        first_reveal_deadline_ms: u64,
        discussion_deadline_ms: u64,
        second_commit_deadline_ms: u64,
        second_reveal_deadline_ms: u64,
        creation_budget_amount: u64,
        committee_budget_amount: u64,
        evidence_budget_amount: u64,
        content_hash: vector<u8>,
        statement_blob_id: vector<u8>,
        criteria_blob_id: vector<u8>,
        evidence_policy_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let params = new_claim_params(
            claim_mode,
            proposal_deadline_ms,
            challenge_deadline_ms,
            first_commit_deadline_ms,
            first_reveal_deadline_ms,
            discussion_deadline_ms,
            second_commit_deadline_ms,
            second_reveal_deadline_ms,
            creation_budget_amount,
            committee_budget_amount,
            evidence_budget_amount,
        );
        create_claim_with_params(
            registry,
            creator_budget,
            params,
            content_hash,
            statement_blob_id,
            criteria_blob_id,
            evidence_policy_id,
            clock,
            ctx,
        );
    }

    /// Composable constructor for package modules and Move callers.
    public fun create_claim_with_params<T>(
        registry: &Registry,
        creator_budget: Coin<T>,
        params: ClaimParams,
        content_hash: vector<u8>,
        statement_blob_id: vector<u8>,
        criteria_blob_id: vector<u8>,
        evidence_policy_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let claim = new_claim(
            registry,
            creator_budget,
            params,
            content_hash,
            statement_blob_id,
            criteria_blob_id,
            evidence_policy_id,
            clock,
            ctx,
        );
        share_claim(claim);
    }

    /// Move a direct claim into review without proposer or challenger state.
    public entry fun start_direct_review<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        clock: &Clock,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(claim.claim_mode == CLAIM_MODE_DIRECT_REVIEW, E_INVALID_MODE);
        assert!(claim.state == STATE_CREATED, E_INVALID_STATE);
        assert!(clock::timestamp_ms(clock) <= claim.first_commit_deadline_ms, E_DEADLINE_PASSED);
        claim.state = STATE_REVIEW_REQUESTED;
    }

    /// Record an optimistic answer and bind the proposer bond.
    public entry fun propose_outcome<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        proposer_bond: Coin<T>,
        outcome: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(claim.claim_mode == CLAIM_MODE_OPTIMISTIC_SETTLEMENT, E_INVALID_MODE);
        assert!(claim.state == STATE_CREATED, E_INVALID_STATE);
        assert_valid_vote_outcome(outcome);
        assert!(clock::timestamp_ms(clock) <= claim.proposal_deadline_ms, E_DEADLINE_PASSED);
        let amount = coin::value(&proposer_bond);
        assert!(amount > 0 && amount <= MAX_COMPONENT_BUDGET, E_INVALID_BUDGET);
        balance::join(&mut claim.proposer_bond, coin::into_balance(proposer_bond));
        claim.proposer = option::some(ctx.sender());
        claim.proposal = outcome;
        claim.state = STATE_PROPOSED;
        event::emit(OutcomeProposed {
            claim_id: object::id(claim),
            proposer: ctx.sender(),
            outcome,
            amount,
        });
    }

    /// Challenge an answer with an equal bond and enter CHALLENGED state.
    public entry fun challenge_outcome<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        challenger_bond: Coin<T>,
        reason_hash: vector<u8>,
        reason_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(claim.state == STATE_PROPOSED, E_INVALID_STATE);
        assert!(clock::timestamp_ms(clock) <= claim.challenge_deadline_ms, E_DEADLINE_PASSED);
        assert!(reason_hash.length() == HASH_LENGTH && !reason_blob_id.is_empty(), E_INVALID_CONTENT);
        assert!(claim.proposer.is_some() && *claim.proposer.borrow() != ctx.sender(), E_PARTY_CONFLICT);
        let amount = coin::value(&challenger_bond);
        assert!(amount > 0 && amount == balance::value(&claim.proposer_bond), E_BOND_MISMATCH);
        balance::join(&mut claim.challenger_bond, coin::into_balance(challenger_bond));
        claim.challenger = option::some(ctx.sender());
        claim.challenge_reason.hash = reason_hash;
        claim.challenge_reason.blob_id = reason_blob_id;
        claim.state = STATE_CHALLENGED;
        event::emit(OutcomeChallenged {
            claim_id: object::id(claim),
            challenger: ctx.sender(),
            reason_hash: claim.challenge_reason.hash,
            amount,
        });
    }

    /// Move a funded challenge into the common jury-review path.
    public entry fun start_challenged_review<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        clock: &Clock,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(claim.state == STATE_CHALLENGED, E_INVALID_STATE);
        assert!(clock::timestamp_ms(clock) <= claim.first_commit_deadline_ms, E_DEADLINE_PASSED);
        claim.state = STATE_REVIEW_REQUESTED;
    }

    public(package) fun new_phase_readiness(
        claim_id: ID,
        tally_id: ID,
        phase: u8,
        all_seats_committed: bool,
        ctx: &mut TxContext,
    ): PhaseReadiness {
        PhaseReadiness {
            id: object::new(ctx),
            claim_id,
            tally_id,
            phase,
            all_seats_committed,
        }
    }

    /// Advance when every seat committed, or when the action window has closed.
    public entry fun advance_phase<T>(
        claim: &mut Claim<T>,
        readiness: PhaseReadiness,
        clock: &Clock,
    ) {
        let PhaseReadiness {
            id,
            claim_id,
            tally_id,
            phase,
            all_seats_committed,
        } = readiness;
        id.delete();
        assert!(claim_id == object::id(claim), E_INVALID_STATE);
        let now = clock::timestamp_ms(clock);
        if (claim.state == STATE_COMMIT_1) {
            assert!(
                phase == 1 &&
                    claim.first_round_tally_id.is_some() &&
                    *claim.first_round_tally_id.borrow() == tally_id,
                E_INVALID_STATE,
            );
            assert!(
                now > claim.first_commit_deadline_ms || all_seats_committed,
                E_DEADLINE_NOT_REACHED,
            );
            claim.state = STATE_REVEAL_1;
        } else if (claim.state == STATE_COMMIT_2) {
            assert!(
                phase == 2 &&
                    claim.second_round_tally_id.is_some() &&
                    *claim.second_round_tally_id.borrow() == tally_id,
                E_INVALID_STATE,
            );
            assert!(
                now > claim.second_commit_deadline_ms || all_seats_committed,
                E_DEADLINE_NOT_REACHED,
            );
            claim.state = STATE_REVEAL_2;
        } else {
            abort E_INVALID_STATE
        };
    }

    public fun claim_mode_direct_review(): u8 { CLAIM_MODE_DIRECT_REVIEW }
    public fun claim_mode_optimistic_settlement(): u8 { CLAIM_MODE_OPTIMISTIC_SETTLEMENT }
    public fun outcome_none(): u8 { OUTCOME_NONE }
    public fun outcome_yes(): u8 { OUTCOME_YES }
    public fun outcome_no(): u8 { OUTCOME_NO }
    public fun outcome_unsure(): u8 { OUTCOME_UNSURE }
    public fun result_unresolved(): u8 { RESULT_UNRESOLVED }
    public fun state_created(): u8 { STATE_CREATED }
    public fun state_proposed(): u8 { STATE_PROPOSED }
    public fun state_challenged(): u8 { STATE_CHALLENGED }
    public fun state_review_requested(): u8 { STATE_REVIEW_REQUESTED }
    public fun state_commit_1(): u8 { STATE_COMMIT_1 }
    public fun state_reveal_1(): u8 { STATE_REVEAL_1 }
    public fun state_discussion(): u8 { STATE_DISCUSSION }
    public fun state_commit_2(): u8 { STATE_COMMIT_2 }
    public fun state_reveal_2(): u8 { STATE_REVEAL_2 }
    public fun state_finalized_unchallenged(): u8 { STATE_FINALIZED_UNCHALLENGED }
    public fun state_finalized_reviewed(): u8 { STATE_FINALIZED_REVIEWED }
    public fun state_unresolved(): u8 { STATE_UNRESOLVED }
    public fun state_cancelled(): u8 { STATE_CANCELLED }

    public fun claim_id<T>(claim: &Claim<T>): ID { object::id(claim) }
    public fun claim_params_mode(params: &ClaimParams): u8 { params.claim_mode }
    public fun claim_params_total_budget(params: &ClaimParams): u64 { checked_budget_total(params) }
    public fun protocol_version<T>(claim: &Claim<T>): u64 { claim.protocol_version }
    public fun mode<T>(claim: &Claim<T>): u8 { claim.claim_mode }
    public fun creator<T>(claim: &Claim<T>): address { claim.creator }
    public fun state<T>(claim: &Claim<T>): u8 { claim.state }
    public fun proposal<T>(claim: &Claim<T>): u8 { claim.proposal }
    public fun result<T>(claim: &Claim<T>): u8 { claim.result }
    public fun proposer<T>(claim: &Claim<T>): &Option<address> { &claim.proposer }
    public fun challenger<T>(claim: &Claim<T>): &Option<address> { &claim.challenger }
    public fun first_commit_deadline_ms<T>(claim: &Claim<T>): u64 { claim.first_commit_deadline_ms }
    public fun first_reveal_deadline_ms<T>(claim: &Claim<T>): u64 { claim.first_reveal_deadline_ms }
    public fun discussion_deadline_ms<T>(claim: &Claim<T>): u64 { claim.discussion_deadline_ms }
    public fun second_commit_deadline_ms<T>(claim: &Claim<T>): u64 { claim.second_commit_deadline_ms }
    public fun second_reveal_deadline_ms<T>(claim: &Claim<T>): u64 { claim.second_reveal_deadline_ms }
    public fun challenge_deadline_ms<T>(claim: &Claim<T>): u64 { claim.challenge_deadline_ms }
    public fun proposal_deadline_ms<T>(claim: &Claim<T>): u64 { claim.proposal_deadline_ms }

    public fun total_balance<T>(claim: &Claim<T>): u64 {
        balance::value(&claim.creation_budget) +
            balance::value(&claim.proposer_bond) +
            balance::value(&claim.challenger_bond) +
            balance::value(&claim.committee_budget) +
            balance::value(&claim.evidence_budget)
    }

    public(package) fun new_claim<T>(
        registry: &Registry,
        creator_budget: Coin<T>,
        params: ClaimParams,
        content_hash: vector<u8>,
        statement_blob_id: vector<u8>,
        criteria_blob_id: vector<u8>,
        evidence_policy_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Claim<T> {
        agent_registry::assert_not_paused(registry);
        validate_params(&params, clock);
        assert!(
            content_hash.length() == HASH_LENGTH &&
                !statement_blob_id.is_empty() &&
                !criteria_blob_id.is_empty() &&
                !evidence_policy_id.is_empty(),
            E_INVALID_CONTENT,
        );

        let expected = checked_budget_total(&params);
        assert!(coin::value(&creator_budget) == expected, E_INVALID_BUDGET);
        let mut source = coin::into_balance(creator_budget);
        let creation_budget = balance::split(&mut source, params.creation_budget_amount);
        let committee_budget = balance::split(&mut source, params.committee_budget_amount);
        let evidence_budget = balance::split(&mut source, params.evidence_budget_amount);
        balance::destroy_zero(source);

        Claim {
            id: object::new(ctx),
            protocol_version: PROTOCOL_VERSION,
            claim_mode: params.claim_mode,
            creator: ctx.sender(),
            content_hash,
            statement_blob_id,
            criteria_blob_id,
            evidence_policy_id,
            first_evidence_bundle_id: option::none(),
            second_evidence_bundle_id: option::none(),
            committee_id: option::none(),
            first_round_tally_id: option::none(),
            second_round_tally_id: option::none(),
            resolution_certificate_id: option::none(),
            proposal_deadline_ms: params.proposal_deadline_ms,
            challenge_deadline_ms: params.challenge_deadline_ms,
            first_commit_deadline_ms: params.first_commit_deadline_ms,
            first_reveal_deadline_ms: params.first_reveal_deadline_ms,
            discussion_deadline_ms: params.discussion_deadline_ms,
            second_commit_deadline_ms: params.second_commit_deadline_ms,
            second_reveal_deadline_ms: params.second_reveal_deadline_ms,
            proposer: option::none(),
            challenger: option::none(),
            challenge_reason: ChallengeReason {
                hash: vector[],
                blob_id: vector[],
                treasury: agent_registry::treasury(registry),
                protocol_fee_bps: agent_registry::protocol_fee_bps(registry),
            },
            proposal: OUTCOME_NONE,
            result: OUTCOME_NONE,
            state: STATE_CREATED,
            creation_budget,
            proposer_bond: balance::zero(),
            challenger_bond: balance::zero(),
            committee_budget,
            evidence_budget,
        }
    }

    public(package) fun set_direct_review_requested<T>(claim: &mut Claim<T>) {
        assert!(claim.claim_mode == CLAIM_MODE_DIRECT_REVIEW, E_INVALID_MODE);
        assert!(claim.state == STATE_CREATED, E_INVALID_STATE);
        claim.state = STATE_REVIEW_REQUESTED;
    }

    public(package) fun share_claim<T>(claim: Claim<T>) {
        let coin_type_bytes = type_name::into_string(type_name::get<T>()).into_bytes();
        event::emit(ClaimCreated {
            claim_id: object::id(&claim),
            creator: claim.creator,
            claim_mode: claim.claim_mode,
            content_hash: claim.content_hash,
            coin_type_hash: hash::blake2b256(&coin_type_bytes),
        });
        transfer::share_object(claim);
    }

    public(package) fun link_committee<T>(
        claim: &mut Claim<T>,
        committee_id: ID,
        first_round_tally_id: ID,
    ) {
        assert!(claim.state == STATE_REVIEW_REQUESTED, E_INVALID_STATE);
        assert!(claim.committee_id.is_none() && claim.first_round_tally_id.is_none(), E_ALREADY_LINKED);
        claim.committee_id = option::some(committee_id);
        claim.first_round_tally_id = option::some(first_round_tally_id);
        claim.state = STATE_COMMIT_1;
    }

    public(package) fun link_second_round_tally<T>(claim: &mut Claim<T>, tally_id: ID) {
        assert!(claim.state == STATE_DISCUSSION, E_INVALID_STATE);
        assert!(claim.second_round_tally_id.is_none(), E_ALREADY_LINKED);
        claim.second_round_tally_id = option::some(tally_id);
        claim.state = STATE_COMMIT_2;
    }

    public(package) fun set_discussion<T>(claim: &mut Claim<T>) {
        assert!(claim.state == STATE_REVEAL_1, E_INVALID_STATE);
        claim.state = STATE_DISCUSSION;
    }

    public(package) fun link_evidence_bundle<T>(claim: &mut Claim<T>, phase: u8, bundle_id: ID) {
        if (phase == 1) {
            assert!(claim.first_evidence_bundle_id.is_none(), E_ALREADY_LINKED);
            claim.first_evidence_bundle_id = option::some(bundle_id);
        } else if (phase == 2) {
            assert!(claim.second_evidence_bundle_id.is_none(), E_ALREADY_LINKED);
            claim.second_evidence_bundle_id = option::some(bundle_id);
        } else {
            abort E_INVALID_STATE
        };
    }

    public(package) fun assert_can_freeze_evidence<T>(claim: &Claim<T>, phase: u8, now: u64) {
        if (phase == 1) {
            assert!(claim.state == STATE_REVIEW_REQUESTED || claim.state == STATE_COMMIT_1, E_INVALID_STATE);
            assert!(now <= claim.first_commit_deadline_ms, E_DEADLINE_PASSED);
            assert!(claim.first_evidence_bundle_id.is_none(), E_ALREADY_LINKED);
        } else if (phase == 2) {
            assert!(claim.state == STATE_DISCUSSION, E_INVALID_STATE);
            assert!(now <= claim.discussion_deadline_ms, E_DEADLINE_PASSED);
            assert!(claim.second_evidence_bundle_id.is_none(), E_ALREADY_LINKED);
        } else {
            abort E_INVALID_STATE
        };
    }

    public(package) fun assert_active_evidence_bundle<T>(
        claim: &Claim<T>,
        phase: u8,
        bundle_id: ID,
    ) {
        if (phase == 1) {
            assert!(claim.first_evidence_bundle_id.is_some(), E_INVALID_STATE);
            assert!(*claim.first_evidence_bundle_id.borrow() == bundle_id, E_INVALID_STATE);
        } else if (phase == 2) {
            assert!(claim.second_evidence_bundle_id.is_some(), E_INVALID_STATE);
            assert!(*claim.second_evidence_bundle_id.borrow() == bundle_id, E_INVALID_STATE);
        } else {
            abort E_INVALID_STATE
        };
    }

    public(package) fun assert_active_tally<T>(claim: &Claim<T>, phase: u8, tally_id: ID) {
        if (phase == 1) {
            assert!(claim.first_round_tally_id.is_some(), E_INVALID_STATE);
            assert!(*claim.first_round_tally_id.borrow() == tally_id, E_INVALID_STATE);
        } else if (phase == 2) {
            assert!(claim.second_round_tally_id.is_some(), E_INVALID_STATE);
            assert!(*claim.second_round_tally_id.borrow() == tally_id, E_INVALID_STATE);
        } else {
            abort E_INVALID_STATE
        };
    }

    public(package) fun assert_evidence_linked<T>(claim: &Claim<T>, phase: u8) {
        if (phase == 1) {
            assert!(claim.first_evidence_bundle_id.is_some(), E_INVALID_STATE);
        } else if (phase == 2) {
            assert!(claim.second_evidence_bundle_id.is_some(), E_INVALID_STATE);
        } else {
            abort E_INVALID_STATE
        };
    }

    public(package) fun committee_id<T>(claim: &Claim<T>): Option<ID> { claim.committee_id }
    public(package) fun first_tally_id<T>(claim: &Claim<T>): Option<ID> { claim.first_round_tally_id }
    public(package) fun second_tally_id<T>(claim: &Claim<T>): Option<ID> { claim.second_round_tally_id }
    public(package) fun first_bundle_id<T>(claim: &Claim<T>): Option<ID> { claim.first_evidence_bundle_id }
    public(package) fun second_bundle_id<T>(claim: &Claim<T>): Option<ID> { claim.second_evidence_bundle_id }
    public(package) fun proposer_address<T>(claim: &Claim<T>): Option<address> { claim.proposer }
    public(package) fun challenger_address<T>(claim: &Claim<T>): Option<address> { claim.challenger }
    public(package) fun proposal_value<T>(claim: &Claim<T>): u8 { claim.proposal }
    public(package) fun committee_budget_value<T>(claim: &Claim<T>): u64 { balance::value(&claim.committee_budget) }
    public(package) fun proposer_bond_value<T>(claim: &Claim<T>): u64 { balance::value(&claim.proposer_bond) }
    public(package) fun challenger_bond_value<T>(claim: &Claim<T>): u64 { balance::value(&claim.challenger_bond) }
    public(package) fun evidence_policy_id<T>(claim: &Claim<T>): &vector<u8> { &claim.evidence_policy_id }
    public(package) fun treasury<T>(claim: &Claim<T>): address { claim.challenge_reason.treasury }
    public(package) fun protocol_fee_bps<T>(claim: &Claim<T>): u64 { claim.challenge_reason.protocol_fee_bps }

    public(package) fun set_terminal<T>(claim: &mut Claim<T>, result: u8, reviewed: bool, certificate_id: ID) {
        assert!(!is_terminal_state(claim.state), E_INVALID_STATE);
        claim.result = result;
        claim.resolution_certificate_id = option::some(certificate_id);
        claim.state = if (result == RESULT_UNRESOLVED) {
            STATE_UNRESOLVED
        } else if (reviewed) {
            STATE_FINALIZED_REVIEWED
        } else {
            STATE_FINALIZED_UNCHALLENGED
        };
    }

    public(package) fun set_cancelled<T>(claim: &mut Claim<T>) {
        assert!(claim.state == STATE_CREATED, E_INVALID_STATE);
        claim.state = STATE_CANCELLED;
    }

    public(package) fun consolidate_for_payout<T>(claim: &mut Claim<T>): u64 {
        let proposer = balance::withdraw_all(&mut claim.proposer_bond);
        let challenger = balance::withdraw_all(&mut claim.challenger_bond);
        let committee = balance::withdraw_all(&mut claim.committee_budget);
        let evidence = balance::withdraw_all(&mut claim.evidence_budget);
        balance::join(&mut claim.creation_budget, proposer);
        balance::join(&mut claim.creation_budget, challenger);
        balance::join(&mut claim.creation_budget, committee);
        balance::join(&mut claim.creation_budget, evidence);
        balance::value(&claim.creation_budget)
    }

    public(package) fun take_payout<T>(claim: &mut Claim<T>, amount: u64): Balance<T> {
        balance::split(&mut claim.creation_budget, amount)
    }

    public(package) fun assert_creator<T>(claim: &Claim<T>, sender: address) {
        assert!(claim.creator == sender, E_NOT_CREATOR);
    }

    public(package) fun is_terminal<T>(claim: &Claim<T>): bool { is_terminal_state(claim.state) }

    fun validate_params(params: &ClaimParams, clock: &Clock) {
        assert!(
            params.claim_mode == CLAIM_MODE_DIRECT_REVIEW ||
                params.claim_mode == CLAIM_MODE_OPTIMISTIC_SETTLEMENT,
            E_INVALID_MODE,
        );
        let now = clock::timestamp_ms(clock);
        assert!(
            now < params.proposal_deadline_ms &&
                params.proposal_deadline_ms < params.challenge_deadline_ms &&
                params.challenge_deadline_ms < params.first_commit_deadline_ms &&
                params.first_commit_deadline_ms < params.first_reveal_deadline_ms &&
                params.first_reveal_deadline_ms < params.discussion_deadline_ms &&
                params.discussion_deadline_ms < params.second_commit_deadline_ms &&
                params.second_commit_deadline_ms < params.second_reveal_deadline_ms,
            E_INVALID_DEADLINES,
        );
        assert!(params.second_reveal_deadline_ms - now <= MAX_TOTAL_DURATION_MS, E_DURATION_TOO_LONG);
        checked_budget_total(params);
        if (params.claim_mode == CLAIM_MODE_DIRECT_REVIEW) {
            assert!(params.committee_budget_amount > 0, E_INVALID_BUDGET);
        };
    }

    fun checked_budget_total(params: &ClaimParams): u64 {
        assert!(
            params.creation_budget_amount <= MAX_COMPONENT_BUDGET &&
                params.committee_budget_amount <= MAX_COMPONENT_BUDGET &&
                params.evidence_budget_amount <= MAX_COMPONENT_BUDGET,
            E_INVALID_BUDGET,
        );
        assert!(
            params.creation_budget_amount <= 0xffffffffffffffff - params.committee_budget_amount,
            E_INVALID_BUDGET,
        );
        let partial = params.creation_budget_amount + params.committee_budget_amount;
        assert!(partial <= 0xffffffffffffffff - params.evidence_budget_amount, E_INVALID_BUDGET);
        partial + params.evidence_budget_amount
    }

    fun assert_valid_vote_outcome(outcome: u8) {
        assert!(outcome == OUTCOME_YES || outcome == OUTCOME_NO || outcome == OUTCOME_UNSURE, E_INVALID_OUTCOME);
    }

    fun is_terminal_state(state: u8): bool {
        state == STATE_FINALIZED_UNCHALLENGED ||
            state == STATE_FINALIZED_REVIEWED ||
            state == STATE_UNRESOLVED ||
            state == STATE_CANCELLED
    }

    #[test_only]
    public(package) fun new_claim_for_testing<T>(
        registry: &Registry,
        budget: Coin<T>,
        params: ClaimParams,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Claim<T> {
        new_claim(
            registry,
            budget,
            params,
            vector::tabulate!(HASH_LENGTH, |_| 7),
            b"statement",
            b"criteria",
            b"policy",
            clock,
            ctx,
        )
    }

    #[test_only]
    public(package) fun set_state_for_testing<T>(claim: &mut Claim<T>, new_state: u8) {
        claim.state = new_state;
    }

    #[test_only]
    public(package) fun destroy_claim_for_testing<T>(claim: Claim<T>): u64 {
        let Claim {
            id,
            protocol_version: _,
            claim_mode: _,
            creator: _,
            content_hash: _,
            statement_blob_id: _,
            criteria_blob_id: _,
            evidence_policy_id: _,
            first_evidence_bundle_id: _,
            second_evidence_bundle_id: _,
            committee_id: _,
            first_round_tally_id: _,
            second_round_tally_id: _,
            resolution_certificate_id: _,
            proposal_deadline_ms: _,
            challenge_deadline_ms: _,
            first_commit_deadline_ms: _,
            first_reveal_deadline_ms: _,
            discussion_deadline_ms: _,
            second_commit_deadline_ms: _,
            second_reveal_deadline_ms: _,
            proposer: _,
            challenger: _,
            challenge_reason: _,
            proposal: _,
            result: _,
            state: _,
            creation_budget,
            proposer_bond,
            challenger_bond,
            committee_budget,
            evidence_budget,
        } = claim;
        id.delete();
        balance::destroy_for_testing(creation_budget) +
            balance::destroy_for_testing(proposer_bond) +
            balance::destroy_for_testing(challenger_bond) +
            balance::destroy_for_testing(committee_budget) +
            balance::destroy_for_testing(evidence_budget)
    }
}

/// Random committee selection, run approvals, commit-reveal voting, and certificates.
module openverdict::jury {
    use openverdict::agent_registry::{Self, AgentCap, EligibilityRecord, Registry, RunAttestorCap};
    use openverdict::claim::{Self, Claim};
    use openverdict::evidence::{Self, EvidenceBundle};
    use std::bcs;
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;
    use sui::hash;
    use sui::random::{Self, Random};

    // === Errors ===

    const E_INSUFFICIENT_DIVERSE_AGENTS: u64 = 0;
    const E_INVALID_CLAIM_STATE: u64 = 1;
    const E_COMMITTEE_MISMATCH: u64 = 2;
    const E_TALLY_MISMATCH: u64 = 3;
    const E_SEAT_MISMATCH: u64 = 4;
    const E_CAP_MISMATCH: u64 = 5;
    const E_INVALID_SEAT_STATUS: u64 = 6;
    const E_DEADLINE_PASSED: u64 = 7;
    const E_REVEAL_NOT_OPEN: u64 = 8;
    const E_INVALID_PHASE: u64 = 9;
    const E_INVALID_HASH: u64 = 10;
    const E_INVALID_OUTCOME: u64 = 11;
    const E_INVALID_CONFIDENCE: u64 = 12;
    const E_COMMITMENT_MISMATCH: u64 = 13;
    const E_UNEXPECTED_SEAT: u64 = 14;
    const E_DUPLICATE_REVEAL: u64 = 15;
    const E_TALLY_CLOSED: u64 = 16;
    const E_COMMITTEE_LOCKED: u64 = 17;
    const E_COMMITTEE_NOT_LOCKED: u64 = 18;
    const E_INVALID_RESERVE: u64 = 19;
    const E_DEADLINE_NOT_REACHED: u64 = 20;
    /// How long offered seats have to accept or decline before the committee can lock.
    const ACCEPTANCE_WINDOW_MS: u64 = 20_000;
    const E_EVIDENCE_NOT_BOUND: u64 = 21;
    const E_CONSENSUS_REACHED: u64 = 22;
    const E_RETENTION_EXPIRED: u64 = 23;
    const E_NOT_AGENT_OWNER: u64 = 24;

    const COMMITTEE_SIZE: u64 = 5;
    const RESERVE_COUNT: u64 = 2;
    const REQUIRED_MATCHING: u8 = 4;
    const MAX_SELECTION_DRAWS: u64 = 160;
    /// Rejected draws in a row that clear a stalled partial pick and resample.
    const RESTART_AFTER_STALLS: u64 = 8;
    const MAX_ELIGIBLE_SNAPSHOT: u64 = 32;
    const HASH_LENGTH: u64 = 32;

    const PHASE_ONE: u8 = 1;
    const PHASE_TWO: u8 = 2;

    const OUTCOME_YES: u8 = 1;
    const OUTCOME_NO: u8 = 2;
    const OUTCOME_UNSURE: u8 = 3;

    const SEAT_OFFERED: u8 = 0;
    const SEAT_ACCEPTED: u8 = 1;
    const SEAT_COMMITTED: u8 = 2;
    const SEAT_DECLINED: u8 = 3;
    #[test_only]
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    /// Selected profiles and reserves for one claim.
    public struct Committee has key, store {
        id: UID,
        claim_id: ID,
        agent_profile_ids: vector<ID>,
        agent_owners: vector<address>,
        reserve_profile_ids: vector<ID>,
        reserve_owners: vector<address>,
        selected_at_ms: u64,
        locked: bool,
    }

    /// One address-owned vote capability for one agent and phase.
    public struct JurySeat has key, store {
        id: UID,
        claim_id: ID,
        committee_id: ID,
        agent_profile_id: ID,
        agent_owner: address,
        phase: u8,
        evidence_root: vector<u8>,
        commitment: vector<u8>,
        run_hash: vector<u8>,
        status: u8,
    }

    /// Bounded authoritative tally for exactly five expected seats.
    public struct RoundTally has key {
        id: UID,
        claim_id: ID,
        committee_id: ID,
        phase: u8,
        evidence_root: vector<u8>,
        expected_jury_seat_ids: vector<ID>,
        committed_count: u8,
        revealed_jury_seat_ids: vector<ID>,
        revealed_vote_ids: vector<ID>,
        yes_count: u8,
        no_count: u8,
        unsure_count: u8,
        truth_probability_sum_bps: u64,
        truth_probability_count: u8,
        closed: bool,
    }

    /// One-time attestation that fixes the run hash before commitment.
    public struct RunApproval has key, store {
        id: UID,
        claim_id: ID,
        committee_id: ID,
        jury_seat_id: ID,
        agent_profile_id: ID,
        agent_owner: address,
        run_hash: vector<u8>,
        run_blob_id: vector<u8>,
        run_blob_object_id: ID,
        tool_blob_id: vector<u8>,
        tool_blob_object_id: ID,
        walrus_end_epoch: u64,
        phase: u8,
    }

    /// Immutable valid reveal.
    public struct RevealedVote has key, store {
        id: UID,
        claim_id: ID,
        committee_id: ID,
        jury_seat_id: ID,
        agent_profile_id: ID,
        phase: u8,
        outcome: u8,
        confidence_bps: u16,
        evidence_root: vector<u8>,
        output_hash: vector<u8>,
        run_hash: vector<u8>,
        argument_blob_id: vector<u8>,
        argument_blob_object_id: ID,
        argument_walrus_end_epoch: u64,
        revealed_at_ms: u64,
    }

    /// Immutable terminal result consumed by independent applications.
    public struct ResolutionCertificate has key, store {
        id: UID,
        claim_id: ID,
        package_version: u64,
        result: u8,
        truth_score_bps: Option<u16>,
        committee_id: Option<ID>,
        evidence_bundle_ids: vector<ID>,
        revealed_vote_ids: vector<ID>,
        finalized_at_ms: u64,
    }

    /// Exact BCS preimage shared with TypeScript.
    public struct VotePreimageV1 has copy, drop, store {
        claim_id: ID,
        agent_profile_id: ID,
        jury_seat_id: ID,
        phase: u8,
        outcome: u8,
        confidence_bps: u16,
        evidence_root: vector<u8>,
        output_hash: vector<u8>,
        run_hash: vector<u8>,
        salt: vector<u8>,
    }

    /// Dynamic seat timing preserves the binding public JurySeat layout.
    public struct SeatTimingKey has copy, drop, store {}
    public struct SeatTiming has store { commit_deadline_ms: u64, reveal_deadline_ms: u64 }

    /// Private diversity metadata keeps the public Committee fields stable.
    public struct CommitteePolicyKey has copy, drop, store {}
    public struct CommitteePolicy has store {
        selected_human_hashes: vector<vector<u8>>,
        selected_model_hashes: vector<vector<u8>>,
        selected_role_hashes: vector<vector<u8>>,
        reserve_human_hashes: vector<vector<u8>>,
        reserve_model_hashes: vector<vector<u8>>,
        reserve_role_hashes: vector<vector<u8>>,
        acceptance_deadline_ms: u64,
    }

    /// Where each seat's jury reward goes, resolved once at selection time.
    /// Committees created before the upgrade carry no such field and pay owners.
    public struct CommitteePayoutsKey has copy, drop, store {}
    public struct CommitteePayouts has store {
        selected: vector<address>,
        reserves: vector<address>,
    }

    public struct CommitteeSelected has copy, drop {
        claim_id: ID,
        committee_id: ID,
        first_round_tally_id: ID,
        agent_profile_ids: vector<ID>,
        jury_seat_ids: vector<ID>,
    }

    public struct RunApproved has copy, drop {
        claim_id: ID,
        jury_seat_id: ID,
        run_approval_id: ID,
        run_hash: vector<u8>,
    }

    public struct VoteCommitted has copy, drop {
        claim_id: ID,
        jury_seat_id: ID,
        phase: u8,
        commitment: vector<u8>,
    }

    public struct VoteRevealed has copy, drop {
        claim_id: ID,
        round_tally_id: ID,
        jury_seat_id: ID,
        revealed_vote_id: ID,
        phase: u8,
        outcome: u8,
        confidence_bps: u16,
        output_hash: vector<u8>,
        run_hash: vector<u8>,
    }

    /// Select five seats and two reserves in the Random-dependent call itself.
    entry fun select_committee<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        r: &Random,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(claim::state(claim) == claim::state_review_requested(), E_INVALID_CLAIM_STATE);
        let records = agent_registry::eligibility_records(registry);
        let record_count = records.length();
        assert!(
            record_count >= COMMITTEE_SIZE + RESERVE_COUNT && record_count <= MAX_ELIGIBLE_SNAPSHOT,
            E_INSUFFICIENT_DIVERSE_AGENTS,
        );

        let mut total_weight = 0;
        let mut weight_index = 0;
        while (weight_index < record_count) {
            let record = &records[weight_index];
            if (agent_registry::eligibility_active(record)) {
                total_weight = total_weight + agent_registry::eligibility_weight(record);
            };
            weight_index = weight_index + 1;
        };
        assert!(total_weight > 0, E_INSUFFICIENT_DIVERSE_AGENTS);
        let mut generator = random::new_generator(r, ctx);
        let mut selected = vector[];
        let mut reserves = vector[];
        let mut attempts = 0;
        // The draw is greedy and never backtracks, so an unlucky prefix can
        // strand it: a model whose two seats are spent before its role partner
        // is seated leaves every remaining record capped out. A restart drops
        // the partial pick and takes a fresh random sample. The caps admit a
        // valid committee whenever the roster does, so resampling finds one.
        let mut stalls = 0;
        while (selected.length() < COMMITTEE_SIZE && attempts < MAX_SELECTION_DRAWS) {
            let ticket = random::generate_u64_in_range(&mut generator, 0, total_weight - 1);
            let index = weighted_record_index(records, ticket);
            let candidate = records[index];
            if (!agent_conflicts_with_claim(claim, &candidate) && can_add_selected(&selected, &candidate)) {
                selected.push_back(candidate);
                stalls = 0;
            } else {
                stalls = stalls + 1;
                if (stalls == RESTART_AFTER_STALLS) {
                    selected = vector[];
                    stalls = 0;
                };
            };
            attempts = attempts + 1;
        };
        assert!(selected.length() == COMMITTEE_SIZE, E_INSUFFICIENT_DIVERSE_AGENTS);
        assert!(selected_diversity_valid(&selected), E_INSUFFICIENT_DIVERSE_AGENTS);

        // Reserves stall the same way (both must carry different roles), so
        // the same restart applies; the committee above is already fixed.
        stalls = 0;
        while (reserves.length() < RESERVE_COUNT && attempts < MAX_SELECTION_DRAWS) {
            let ticket = random::generate_u64_in_range(&mut generator, 0, total_weight - 1);
            let index = weighted_record_index(records, ticket);
            let candidate = records[index];
            if (!agent_conflicts_with_claim(claim, &candidate) &&
                can_add_reserve(&selected, &reserves, &candidate)) {
                reserves.push_back(candidate);
                stalls = 0;
            } else {
                stalls = stalls + 1;
                if (stalls == RESTART_AFTER_STALLS) {
                    reserves = vector[];
                    stalls = 0;
                };
            };
            attempts = attempts + 1;
        };
        assert!(reserves.length() == RESERVE_COUNT, E_INSUFFICIENT_DIVERSE_AGENTS);

        create_first_round(registry, claim, selected, reserves, clock, ctx);
    }

    /// Accept one offered seat before its commit deadline.
    public entry fun accept_jury_seat(seat: &mut JurySeat, cap: &AgentCap, clock: &Clock) {
        assert_seat_cap(seat, cap);
        assert!(seat.status == SEAT_OFFERED, E_INVALID_SEAT_STATUS);
        let timing = df::borrow<SeatTimingKey, SeatTiming>(&seat.id, SeatTimingKey {});
        assert!(clock::timestamp_ms(clock) <= timing.commit_deadline_ms, E_DEADLINE_PASSED);
        seat.status = SEAT_ACCEPTED;
    }

    /// Mark an offered seat declined so the object proves a later reserve replacement.
    public entry fun decline_jury_seat(seat: JurySeat, cap: &AgentCap, clock: &Clock) {
        assert_seat_cap(&seat, cap);
        assert!(seat.status == SEAT_OFFERED, E_INVALID_SEAT_STATUS);
        let timing = df::borrow<SeatTimingKey, SeatTiming>(&seat.id, SeatTimingKey {});
        assert!(clock::timestamp_ms(clock) <= timing.commit_deadline_ms, E_DEADLINE_PASSED);
        let mut seat = seat;
        seat.status = SEAT_DECLINED;
        let owner = seat.agent_owner;
        transfer::public_transfer(seat, owner);
    }

    /// Replace one declined expected ID with a diversity-safe reserve seat.
    public entry fun replace_declined_seat<T>(
        claim: &Claim<T>,
        committee: &mut Committee,
        tally: &mut RoundTally,
        declined_seat: JurySeat,
        reserve_index: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!committee.locked, E_COMMITTEE_LOCKED);
        assert!(declined_seat.status == SEAT_DECLINED, E_INVALID_SEAT_STATUS);
        assert!(
            declined_seat.claim_id == claim::claim_id(claim) &&
                declined_seat.committee_id == object::id(committee) &&
                declined_seat.phase == PHASE_ONE,
            E_SEAT_MISMATCH,
        );
        let declined_seat_id = object::id(&declined_seat);
        assert_committee_claim(claim, committee);
        assert_tally_committee(tally, committee);
        claim::assert_active_tally(claim, tally.phase, object::id(tally));
        assert!(tally.phase == PHASE_ONE && !tally.closed, E_INVALID_PHASE);
        assert!(clock::timestamp_ms(clock) <= claim::first_commit_deadline_ms(claim), E_DEADLINE_PASSED);
        assert!(reserve_index < committee.reserve_profile_ids.length(), E_INVALID_RESERVE);
        let (found, seat_index) = vector::index_of(&tally.expected_jury_seat_ids, &declined_seat_id);
        assert!(found, E_UNEXPECTED_SEAT);
        assert!(!vector::contains(&tally.revealed_jury_seat_ids, &declined_seat_id), E_DUPLICATE_REVEAL);

        let policy = df::borrow_mut<CommitteePolicyKey, CommitteePolicy>(
            &mut committee.id,
            CommitteePolicyKey {},
        );
        assert!(replacement_preserves_diversity(policy, seat_index, reserve_index), E_INVALID_RESERVE);

        let profile_id = committee.reserve_profile_ids[reserve_index];
        let owner = committee.reserve_owners[reserve_index];
        *vector::borrow_mut(&mut committee.agent_profile_ids, seat_index) = profile_id;
        *vector::borrow_mut(&mut committee.agent_owners, seat_index) = owner;
        *vector::borrow_mut(&mut policy.selected_human_hashes, seat_index) =
            policy.reserve_human_hashes[reserve_index];
        *vector::borrow_mut(&mut policy.selected_model_hashes, seat_index) =
            policy.reserve_model_hashes[reserve_index];
        *vector::borrow_mut(&mut policy.selected_role_hashes, seat_index) =
            policy.reserve_role_hashes[reserve_index];
        committee.reserve_profile_ids.remove(reserve_index);
        committee.reserve_owners.remove(reserve_index);
        policy.reserve_human_hashes.remove(reserve_index);
        policy.reserve_model_hashes.remove(reserve_index);
        policy.reserve_role_hashes.remove(reserve_index);

        // The reserve brings its own payout recipient into the seat it takes.
        if (df::exists_<CommitteePayoutsKey>(&committee.id, CommitteePayoutsKey {})) {
            let payouts = df::borrow_mut<CommitteePayoutsKey, CommitteePayouts>(
                &mut committee.id,
                CommitteePayoutsKey {},
            );
            *vector::borrow_mut(&mut payouts.selected, seat_index) =
                payouts.reserves[reserve_index];
            payouts.reserves.remove(reserve_index);
        };

        let seat = new_seat(
            claim::claim_id(claim),
            object::id(committee),
            profile_id,
            owner,
            PHASE_ONE,
            tally.evidence_root,
            SEAT_OFFERED,
            claim::first_commit_deadline_ms(claim),
            claim::first_reveal_deadline_ms(claim),
            ctx,
        );
        let new_id = object::id(&seat);
        *vector::borrow_mut(&mut tally.expected_jury_seat_ids, seat_index) = new_id;
        destroy_seat(declined_seat);
        transfer::transfer(seat, owner);
    }

    /// Lock membership after the acceptance window and before commit closes.
    public entry fun lock_committee<T>(
        claim: &Claim<T>,
        committee: &mut Committee,
        tally: &RoundTally,
        clock: &Clock,
    ) {
        assert!(!committee.locked, E_COMMITTEE_LOCKED);
        assert_committee_claim(claim, committee);
        assert_tally_committee(tally, committee);
        claim::assert_active_tally(claim, tally.phase, object::id(tally));
        let policy = df::borrow<CommitteePolicyKey, CommitteePolicy>(
            &committee.id,
            CommitteePolicyKey {},
        );
        let now = clock::timestamp_ms(clock);
        assert!(now >= policy.acceptance_deadline_ms, E_DEADLINE_NOT_REACHED);
        assert!(now <= claim::first_commit_deadline_ms(claim), E_DEADLINE_PASSED);
        committee.locked = true;
    }

    /// Bind one frozen evidence root to a seat and its bounded phase tally.
    public entry fun bind_jury_seat_evidence(
        seat: &mut JurySeat,
        tally: &mut RoundTally,
        bundle: &EvidenceBundle,
        cap: &AgentCap,
    ) {
        assert_seat_cap(seat, cap);
        assert!(!tally.closed, E_TALLY_CLOSED);
        assert!(seat.claim_id == evidence::evidence_claim_id(bundle), E_SEAT_MISMATCH);
        assert!(seat.phase == evidence::evidence_phase(bundle), E_INVALID_PHASE);
        assert!(tally.claim_id == seat.claim_id && tally.committee_id == seat.committee_id, E_TALLY_MISMATCH);
        assert!(tally.phase == seat.phase, E_INVALID_PHASE);
        assert!(vector::contains(&tally.expected_jury_seat_ids, &object::id(seat)), E_UNEXPECTED_SEAT);
        let root = evidence::evidence_root(bundle);
        if (seat.evidence_root.is_empty()) {
            seat.evidence_root = *root;
        } else {
            assert!(seat.evidence_root == *root, E_EVIDENCE_NOT_BOUND);
        };
        if (tally.evidence_root.is_empty()) {
            tally.evidence_root = *root;
        } else {
            assert!(tally.evidence_root == *root, E_EVIDENCE_NOT_BOUND);
        };
    }

    /// Create a recipient-owned, one-time run approval.
    public entry fun approve_run(
        _run_attestor_cap: &RunAttestorCap,
        claim_id: ID,
        committee_id: ID,
        jury_seat_id: ID,
        agent_profile_id: ID,
        agent_owner: address,
        phase: u8,
        run_hash: vector<u8>,
        run_blob_id: vector<u8>,
        run_blob_object_id: ID,
        tool_blob_id: vector<u8>,
        tool_blob_object_id: ID,
        walrus_end_epoch: u64,
        _clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(phase == PHASE_ONE || phase == PHASE_TWO, E_INVALID_PHASE);
        assert!(run_hash.length() == HASH_LENGTH, E_INVALID_HASH);
        assert!(!run_blob_id.is_empty() && !tool_blob_id.is_empty(), E_INVALID_HASH);
        assert!(walrus_end_epoch >= ctx.epoch(), E_RETENTION_EXPIRED);
        let approval = RunApproval {
            id: object::new(ctx),
            claim_id,
            committee_id,
            jury_seat_id,
            agent_profile_id,
            agent_owner,
            run_hash,
            run_blob_id,
            run_blob_object_id,
            tool_blob_id,
            tool_blob_object_id,
            walrus_end_epoch,
            phase,
        };
        let run_approval_id = object::id(&approval);
        event::emit(RunApproved { claim_id, jury_seat_id, run_approval_id, run_hash: approval.run_hash });
        transfer::transfer(approval, agent_owner);
    }

    /// Consume a matching approval and store only the hidden commitment and fixed run hash.
    public entry fun commit_vote(
        seat: &mut JurySeat,
        tally: &mut RoundTally,
        cap: &AgentCap,
        approval: RunApproval,
        commitment: vector<u8>,
        clock: &Clock,
    ) {
        assert_seat_cap(seat, cap);
        assert!(seat.status == SEAT_ACCEPTED, E_INVALID_SEAT_STATUS);
        assert!(commitment.length() == HASH_LENGTH, E_INVALID_HASH);
        assert!(!seat.evidence_root.is_empty(), E_EVIDENCE_NOT_BOUND);
        assert_tally_seat(tally, seat);
        assert!(
            (tally.committed_count as u64) < tally.expected_jury_seat_ids.length(),
            E_TALLY_MISMATCH,
        );
        let timing = df::borrow<SeatTimingKey, SeatTiming>(&seat.id, SeatTimingKey {});
        assert!(clock::timestamp_ms(clock) <= timing.commit_deadline_ms, E_DEADLINE_PASSED);
        assert_approval_matches(seat, &approval);

        let RunApproval {
            id,
            claim_id: _,
            committee_id: _,
            jury_seat_id: _,
            agent_profile_id: _,
            agent_owner: _,
            run_hash,
            run_blob_id: _,
            run_blob_object_id: _,
            tool_blob_id: _,
            tool_blob_object_id: _,
            walrus_end_epoch: _,
            phase: _,
        } = approval;
        id.delete();
        seat.run_hash = run_hash;
        seat.commitment = commitment;
        seat.status = SEAT_COMMITTED;
        tally.committed_count = tally.committed_count + 1;
        event::emit(VoteCommitted {
            claim_id: seat.claim_id,
            jury_seat_id: object::id(seat),
            phase: seat.phase,
            commitment: seat.commitment,
        });
    }

    /// Consume a seat, verify its exact BCS preimage, freeze the vote, and update the tally.
    public entry fun reveal_vote(
        seat: JurySeat,
        tally: &mut RoundTally,
        cap: &AgentCap,
        outcome: u8,
        confidence_bps: u16,
        output_hash: vector<u8>,
        run_hash: vector<u8>,
        salt: vector<u8>,
        argument_blob_id: vector<u8>,
        argument_blob_object_id: ID,
        argument_walrus_end_epoch: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_seat_cap(&seat, cap);
        assert!(ctx.sender() == seat.agent_owner, E_NOT_AGENT_OWNER);
        assert!(seat.status == SEAT_COMMITTED, E_INVALID_SEAT_STATUS);
        assert_valid_outcome(outcome);
        assert!(confidence_bps <= 10_000, E_INVALID_CONFIDENCE);
        assert!(output_hash.length() == HASH_LENGTH && run_hash.length() == HASH_LENGTH, E_INVALID_HASH);
        assert!(!salt.is_empty() && !argument_blob_id.is_empty(), E_INVALID_HASH);
        assert!(argument_walrus_end_epoch >= ctx.epoch(), E_RETENTION_EXPIRED);

        let timing = df::borrow<SeatTimingKey, SeatTiming>(&seat.id, SeatTimingKey {});
        let now = clock::timestamp_ms(clock);
        assert!(now > timing.commit_deadline_ms || all_seats_committed(tally), E_REVEAL_NOT_OPEN);
        assert!(now <= timing.reveal_deadline_ms, E_DEADLINE_PASSED);
        assert!(run_hash == seat.run_hash, E_INVALID_HASH);
        assert_tally_seat(tally, &seat);

        let preimage = new_vote_preimage(
            seat.claim_id,
            seat.agent_profile_id,
            object::id(&seat),
            seat.phase,
            outcome,
            confidence_bps,
            seat.evidence_root,
            output_hash,
            run_hash,
            salt,
        );
        assert!(compute_commitment(&preimage) == seat.commitment, E_COMMITMENT_MISMATCH);

        let jury_seat_id = object::id(&seat);
        let vote = RevealedVote {
            id: object::new(ctx),
            claim_id: seat.claim_id,
            committee_id: seat.committee_id,
            jury_seat_id,
            agent_profile_id: seat.agent_profile_id,
            phase: seat.phase,
            outcome,
            confidence_bps,
            evidence_root: seat.evidence_root,
            output_hash,
            run_hash,
            argument_blob_id,
            argument_blob_object_id,
            argument_walrus_end_epoch,
            revealed_at_ms: now,
        };
        let revealed_vote_id = object::id(&vote);
        record_reveal(tally, jury_seat_id, revealed_vote_id, outcome, confidence_bps);
        event::emit(VoteRevealed {
            claim_id: vote.claim_id,
            round_tally_id: object::id(tally),
            jury_seat_id,
            revealed_vote_id,
            phase: vote.phase,
            outcome,
            confidence_bps,
            output_hash: vote.output_hash,
            run_hash: vote.run_hash,
        });
        destroy_seat(seat);
        transfer::public_freeze_object(vote);
    }

    /// Enter discussion only when the completed first round has no threshold.
    public entry fun open_discussion<T>(
        claim: &mut Claim<T>,
        first_tally: &mut RoundTally,
        clock: &Clock,
    ) {
        assert!(claim::state(claim) == claim::state_reveal_1(), E_INVALID_CLAIM_STATE);
        assert!(first_tally.phase == PHASE_ONE && !first_tally.closed, E_INVALID_PHASE);
        claim::assert_active_tally(claim, PHASE_ONE, object::id(first_tally));
        // The debate opens the moment the last reveal lands (or at the
        // deadline when a seat never reveals); waiting out the window held
        // split rounds for up to five minutes.
        assert!(
            clock::timestamp_ms(clock) > claim::first_reveal_deadline_ms(claim) ||
                all_seats_revealed(first_tally),
            E_DEADLINE_NOT_REACHED,
        );
        assert!(threshold_outcome(first_tally) == 0, E_CONSENSUS_REACHED);
        first_tally.closed = true;
        claim::set_discussion(claim);
    }

    /// Create phase-two seats for the same profiles only after a no-threshold first round.
    public entry fun create_second_round_seats<T>(
        claim: &mut Claim<T>,
        committee: &Committee,
        first_tally: &mut RoundTally,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(claim::state(claim) == claim::state_discussion(), E_INVALID_CLAIM_STATE);
        assert!(committee.locked, E_COMMITTEE_NOT_LOCKED);
        assert_committee_claim(claim, committee);
        assert_tally_committee(first_tally, committee);
        claim::assert_active_tally(claim, PHASE_ONE, object::id(first_tally));
        claim::assert_evidence_linked(claim, PHASE_TWO);
        assert!(first_tally.phase == PHASE_ONE && first_tally.closed, E_INVALID_PHASE);
        assert!(threshold_outcome(first_tally) == 0, E_CONSENSUS_REACHED);
        // The phase-two evidence bundle (asserted linked above) carries the
        // frozen debate transcript, so its presence is the end of the debate:
        // round two opens right then instead of at the discussion deadline.
        let now = clock::timestamp_ms(clock);
        assert!(now <= claim::second_commit_deadline_ms(claim), E_DEADLINE_PASSED);
        let mut tally = RoundTally {
            id: object::new(ctx),
            claim_id: claim::claim_id(claim),
            committee_id: object::id(committee),
            phase: PHASE_TWO,
            evidence_root: vector[],
            expected_jury_seat_ids: vector[],
            committed_count: 0,
            revealed_jury_seat_ids: vector[],
            revealed_vote_ids: vector[],
            yes_count: 0,
            no_count: 0,
            unsure_count: 0,
            truth_probability_sum_bps: 0,
            truth_probability_count: 0,
            closed: false,
        };
        let tally_id = object::id(&tally);
        let mut i = 0;
        while (i < COMMITTEE_SIZE) {
            let owner = committee.agent_owners[i];
            let seat = new_seat(
                claim::claim_id(claim),
                object::id(committee),
                committee.agent_profile_ids[i],
                owner,
                PHASE_TWO,
                vector[],
                SEAT_ACCEPTED,
                claim::second_commit_deadline_ms(claim),
                claim::second_reveal_deadline_ms(claim),
                ctx,
            );
            tally.expected_jury_seat_ids.push_back(object::id(&seat));
            transfer::transfer(seat, owner);
            i = i + 1;
        };
        claim::link_second_round_tally(claim, tally_id);
        event::emit(CommitteeSelected {
            claim_id: claim::claim_id(claim),
            committee_id: object::id(committee),
            first_round_tally_id: tally_id,
            agent_profile_ids: committee.agent_profile_ids,
            jury_seat_ids: tally.expected_jury_seat_ids,
        });
        transfer::share_object(tally);
    }

    /// Build the exact commitment preimage without exposing struct literals.
    public fun new_vote_preimage(
        claim_id: ID,
        agent_profile_id: ID,
        jury_seat_id: ID,
        phase: u8,
        outcome: u8,
        confidence_bps: u16,
        evidence_root: vector<u8>,
        output_hash: vector<u8>,
        run_hash: vector<u8>,
        salt: vector<u8>,
    ): VotePreimageV1 {
        VotePreimageV1 {
            claim_id,
            agent_profile_id,
            jury_seat_id,
            phase,
            outcome,
            confidence_bps,
            evidence_root,
            output_hash,
            run_hash,
            salt,
        }
    }

    /// Blake2b-256 over BCS(VotePreimageV1).
    public fun compute_commitment(preimage: &VotePreimageV1): vector<u8> {
        hash::blake2b256(&bcs::to_bytes(preimage))
    }

    public fun threshold_outcome(tally: &RoundTally): u8 {
        if (tally.yes_count >= REQUIRED_MATCHING) {
            OUTCOME_YES
        } else if (tally.no_count >= REQUIRED_MATCHING) {
            OUTCOME_NO
        } else if (tally.unsure_count >= REQUIRED_MATCHING) {
            OUTCOME_UNSURE
        } else {
            0
        }
    }

    /// Final-round truth score with integer half-up rounding.
    public fun truth_score_bps(tally: &RoundTally): Option<u16> {
        let count = tally.truth_probability_count;
        if (count == 0) {
            option::none()
        } else {
            let count_u64 = count as u64;
            option::some(((tally.truth_probability_sum_bps + count_u64 / 2) / count_u64) as u16)
        }
    }

    public fun committee_id(committee: &Committee): ID { object::id(committee) }
    public fun committee_claim_id(committee: &Committee): ID { committee.claim_id }
    public fun committee_locked(committee: &Committee): bool { committee.locked }
    public fun committee_profiles(committee: &Committee): &vector<ID> { &committee.agent_profile_ids }
    public fun committee_owners(committee: &Committee): &vector<address> { &committee.agent_owners }
    public fun committee_reserve_count(committee: &Committee): u64 { committee.reserve_profile_ids.length() }
    public fun jury_seat_id(seat: &JurySeat): ID { object::id(seat) }
    public fun jury_seat_profile_id(seat: &JurySeat): ID { seat.agent_profile_id }
    public fun jury_seat_phase(seat: &JurySeat): u8 { seat.phase }
    public fun jury_seat_status(seat: &JurySeat): u8 { seat.status }
    public fun tally_id(tally: &RoundTally): ID { object::id(tally) }
    public fun tally_phase(tally: &RoundTally): u8 { tally.phase }
    public fun tally_commit_count(tally: &RoundTally): u8 { tally.committed_count }
    public fun tally_reveal_count(tally: &RoundTally): u8 { tally.truth_probability_count }
    public fun tally_yes_count(tally: &RoundTally): u8 { tally.yes_count }
    public fun tally_no_count(tally: &RoundTally): u8 { tally.no_count }
    public fun tally_unsure_count(tally: &RoundTally): u8 { tally.unsure_count }
    public fun tally_closed(tally: &RoundTally): bool { tally.closed }
    public fun tally_revealed_vote_ids(tally: &RoundTally): &vector<ID> { &tally.revealed_vote_ids }
    public fun revealed_vote_outcome(vote: &RevealedVote): u8 { vote.outcome }
    public fun revealed_vote_confidence_bps(vote: &RevealedVote): u16 { vote.confidence_bps }
    public fun certificate_claim_id(certificate: &ResolutionCertificate): ID { certificate.claim_id }
    public fun certificate_result(certificate: &ResolutionCertificate): u8 { certificate.result }
    public fun certificate_package_version(certificate: &ResolutionCertificate): u64 { certificate.package_version }
    public fun certificate_truth_score_bps(certificate: &ResolutionCertificate): &Option<u16> {
        &certificate.truth_score_bps
    }

    public(package) fun assert_tally_for_finalization<T>(
        claim: &Claim<T>,
        committee: &Committee,
        tally: &RoundTally,
        bundle: &EvidenceBundle,
    ) {
        assert_committee_claim(claim, committee);
        assert_tally_committee(tally, committee);
        claim::assert_active_tally(claim, tally.phase, object::id(tally));
        evidence::assert_bundle_matches(claim, bundle, tally.phase);
        assert!(tally.evidence_root == *evidence::evidence_root(bundle), E_EVIDENCE_NOT_BOUND);
        assert!(!tally.closed, E_TALLY_CLOSED);
    }

    public(package) fun close_tally(tally: &mut RoundTally) {
        assert!(!tally.closed, E_TALLY_CLOSED);
        tally.closed = true;
    }

    public(package) fun expected_seat_ids(tally: &RoundTally): &vector<ID> {
        &tally.expected_jury_seat_ids
    }

    public(package) fun revealed_seat_ids(tally: &RoundTally): &vector<ID> {
        &tally.revealed_jury_seat_ids
    }

    public(package) fun all_seats_committed(tally: &RoundTally): bool {
        let committed = tally.committed_count as u64;
        let expected = tally.expected_jury_seat_ids.length();
        assert!(committed <= expected, E_TALLY_MISMATCH);
        committed == expected
    }

    public(package) fun all_seats_revealed(tally: &RoundTally): bool {
        let revealed = tally.revealed_jury_seat_ids.length();
        let expected = tally.expected_jury_seat_ids.length();
        assert!(revealed <= expected, E_TALLY_MISMATCH);
        revealed == expected
    }

    /// Produce a tally-bound receipt for claim phase advancement.
    public fun phase_readiness(tally: &RoundTally, ctx: &mut TxContext): claim::PhaseReadiness {
        assert!(!tally.closed, E_TALLY_CLOSED);
        assert!(tally.phase == PHASE_ONE || tally.phase == PHASE_TWO, E_INVALID_PHASE);
        claim::new_phase_readiness(
            tally.claim_id,
            object::id(tally),
            tally.phase,
            all_seats_committed(tally),
            ctx,
        )
    }

    public(package) fun owner_for_expected_index(committee: &Committee, index: u64): address {
        committee.agent_owners[index]
    }

    /// Who this seat's jury reward belongs to: the recorded staker, or the
    /// owner for committees drawn before staked seats existed.
    public(package) fun payout_recipient_for_expected_index(
        committee: &Committee,
        index: u64,
    ): address {
        if (df::exists_<CommitteePayoutsKey>(&committee.id, CommitteePayoutsKey {})) {
            let payouts = df::borrow<CommitteePayoutsKey, CommitteePayouts>(
                &committee.id,
                CommitteePayoutsKey {},
            );
            if (index < payouts.selected.length()) return payouts.selected[index];
        };
        committee.agent_owners[index]
    }

    public(package) fun create_resolution_certificate(
        claim_id: ID,
        package_version: u64,
        result: u8,
        truth_score_bps: Option<u16>,
        committee_id: Option<ID>,
        evidence_bundle_ids: vector<ID>,
        revealed_vote_ids: vector<ID>,
        finalized_at_ms: u64,
        ctx: &mut TxContext,
    ): ID {
        let certificate = ResolutionCertificate {
            id: object::new(ctx),
            claim_id,
            package_version,
            result,
            truth_score_bps,
            committee_id,
            evidence_bundle_ids,
            revealed_vote_ids,
            finalized_at_ms,
        };
        let id = object::id(&certificate);
        transfer::public_freeze_object(certificate);
        id
    }

    fun create_first_round<T>(
        registry: &Registry,
        claim: &mut Claim<T>,
        selected: vector<EligibilityRecord>,
        reserves: vector<EligibilityRecord>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        let commit_deadline = claim::first_commit_deadline_ms(claim);
        assert!(now <= commit_deadline, E_DEADLINE_PASSED);
        // Seats have twenty seconds to accept or decline; the lock, and with it
        // the commits and the certificate, can follow as soon as the jurors
        // finish. The window used to run to the midpoint of the commit
        // window, which held every fast round for minutes.
        let acceptance_deadline_ms = acceptance_deadline(now, commit_deadline);

        let mut committee = Committee {
            id: object::new(ctx),
            claim_id: claim::claim_id(claim),
            agent_profile_ids: vector[],
            agent_owners: vector[],
            reserve_profile_ids: vector[],
            reserve_owners: vector[],
            selected_at_ms: now,
            locked: false,
        };
        let committee_id = object::id(&committee);
        let mut tally = RoundTally {
            id: object::new(ctx),
            claim_id: claim::claim_id(claim),
            committee_id,
            phase: PHASE_ONE,
            evidence_root: vector[],
            expected_jury_seat_ids: vector[],
            committed_count: 0,
            revealed_jury_seat_ids: vector[],
            revealed_vote_ids: vector[],
            yes_count: 0,
            no_count: 0,
            unsure_count: 0,
            truth_probability_sum_bps: 0,
            truth_probability_count: 0,
            closed: false,
        };
        let tally_id = object::id(&tally);
        let mut selected_human_hashes = vector[];
        let mut selected_model_hashes = vector[];
        let mut selected_role_hashes = vector[];
        let mut reserve_human_hashes = vector[];
        let mut reserve_model_hashes = vector[];
        let mut reserve_role_hashes = vector[];
        let mut selected_payouts = vector[];
        let mut reserve_payouts = vector[];

        let mut i = 0;
        while (i < selected.length()) {
            let record = selected[i];
            let owner = agent_registry::eligibility_owner(&record);
            let profile_id = agent_registry::eligibility_profile_id(&record);
            committee.agent_profile_ids.push_back(profile_id);
            committee.agent_owners.push_back(owner);
            // A staked seat pays its staker; every other seat pays its owner.
            selected_payouts.push_back(
                agent_registry::payout_recipient(registry, profile_id, owner),
            );
            selected_human_hashes.push_back(*agent_registry::eligibility_human_hash(&record));
            selected_model_hashes.push_back(*agent_registry::eligibility_model_hash(&record));
            selected_role_hashes.push_back(*agent_registry::eligibility_role_hash(&record));
            let seat = new_seat(
                claim::claim_id(claim),
                committee_id,
                profile_id,
                owner,
                PHASE_ONE,
                vector[],
                SEAT_OFFERED,
                commit_deadline,
                claim::first_reveal_deadline_ms(claim),
                ctx,
            );
            tally.expected_jury_seat_ids.push_back(object::id(&seat));
            transfer::transfer(seat, owner);
            i = i + 1;
        };

        i = 0;
        while (i < reserves.length()) {
            let record = reserves[i];
            let reserve_owner = agent_registry::eligibility_owner(&record);
            let reserve_profile_id = agent_registry::eligibility_profile_id(&record);
            committee.reserve_profile_ids.push_back(reserve_profile_id);
            committee.reserve_owners.push_back(reserve_owner);
            reserve_payouts.push_back(
                agent_registry::payout_recipient(registry, reserve_profile_id, reserve_owner),
            );
            reserve_human_hashes.push_back(*agent_registry::eligibility_human_hash(&record));
            reserve_model_hashes.push_back(*agent_registry::eligibility_model_hash(&record));
            reserve_role_hashes.push_back(*agent_registry::eligibility_role_hash(&record));
            i = i + 1;
        };
        df::add(
            &mut committee.id,
            CommitteePayoutsKey {},
            CommitteePayouts { selected: selected_payouts, reserves: reserve_payouts },
        );
        df::add(
            &mut committee.id,
            CommitteePolicyKey {},
            CommitteePolicy {
                selected_human_hashes,
                selected_model_hashes,
                selected_role_hashes,
                reserve_human_hashes,
                reserve_model_hashes,
                reserve_role_hashes,
                acceptance_deadline_ms,
            },
        );

        claim::link_committee(claim, committee_id, tally_id);
        event::emit(CommitteeSelected {
            claim_id: claim::claim_id(claim),
            committee_id,
            first_round_tally_id: tally_id,
            agent_profile_ids: committee.agent_profile_ids,
            jury_seat_ids: tally.expected_jury_seat_ids,
        });
        transfer::share_object(committee);
        transfer::share_object(tally);
    }

    fun new_seat(
        claim_id: ID,
        committee_id: ID,
        agent_profile_id: ID,
        agent_owner: address,
        phase: u8,
        evidence_root: vector<u8>,
        status: u8,
        commit_deadline_ms: u64,
        reveal_deadline_ms: u64,
        ctx: &mut TxContext,
    ): JurySeat {
        let mut seat = JurySeat {
            id: object::new(ctx),
            claim_id,
            committee_id,
            agent_profile_id,
            agent_owner,
            phase,
            evidence_root,
            commitment: vector[],
            run_hash: vector[],
            status,
        };
        df::add(
            &mut seat.id,
            SeatTimingKey {},
            SeatTiming { commit_deadline_ms, reveal_deadline_ms },
        );
        seat
    }

    fun destroy_seat(seat: JurySeat) {
        let mut seat = seat;
        let SeatTiming { commit_deadline_ms: _, reveal_deadline_ms: _ } =
            df::remove(&mut seat.id, SeatTimingKey {});
        let JurySeat {
            id,
            claim_id: _,
            committee_id: _,
            agent_profile_id: _,
            agent_owner: _,
            phase: _,
            evidence_root: _,
            commitment: _,
            run_hash: _,
            status: _,
        } = seat;
        id.delete();
    }

    fun record_reveal(
        tally: &mut RoundTally,
        seat_id: ID,
        vote_id: ID,
        outcome: u8,
        confidence_bps: u16,
    ) {
        assert!(!tally.closed, E_TALLY_CLOSED);
        assert!(vector::contains(&tally.expected_jury_seat_ids, &seat_id), E_UNEXPECTED_SEAT);
        assert!(!vector::contains(&tally.revealed_jury_seat_ids, &seat_id), E_DUPLICATE_REVEAL);
        assert!(tally.revealed_jury_seat_ids.length() < COMMITTEE_SIZE, E_UNEXPECTED_SEAT);
        tally.revealed_jury_seat_ids.push_back(seat_id);
        tally.revealed_vote_ids.push_back(vote_id);
        if (outcome == OUTCOME_YES) {
            tally.yes_count = tally.yes_count + 1;
            tally.truth_probability_sum_bps = tally.truth_probability_sum_bps + (confidence_bps as u64);
        } else if (outcome == OUTCOME_NO) {
            tally.no_count = tally.no_count + 1;
            tally.truth_probability_sum_bps =
                tally.truth_probability_sum_bps + 10_000 - (confidence_bps as u64);
        } else if (outcome == OUTCOME_UNSURE) {
            tally.unsure_count = tally.unsure_count + 1;
            tally.truth_probability_sum_bps = tally.truth_probability_sum_bps + 5_000;
        } else {
            abort E_INVALID_OUTCOME
        };
        tally.truth_probability_count = tally.truth_probability_count + 1;
        assert!(
            tally.revealed_vote_ids.length() == tally.truth_probability_count as u64 &&
                tally.yes_count + tally.no_count + tally.unsure_count == tally.truth_probability_count,
            E_TALLY_MISMATCH,
        );
    }

    fun assert_seat_cap(seat: &JurySeat, cap: &AgentCap) {
        assert!(seat.agent_profile_id == agent_registry::cap_agent_profile_id(cap), E_CAP_MISMATCH);
    }

    fun assert_approval_matches(seat: &JurySeat, approval: &RunApproval) {
        assert!(
            approval.claim_id == seat.claim_id &&
                approval.committee_id == seat.committee_id &&
                approval.jury_seat_id == object::id(seat) &&
                approval.agent_profile_id == seat.agent_profile_id &&
                approval.agent_owner == seat.agent_owner &&
                approval.phase == seat.phase,
            E_SEAT_MISMATCH,
        );
        assert!(approval.run_hash.length() == HASH_LENGTH, E_INVALID_HASH);
    }

    fun assert_committee_claim<T>(claim: &Claim<T>, committee: &Committee) {
        assert!(committee.claim_id == claim::claim_id(claim), E_COMMITTEE_MISMATCH);
        let linked = claim::committee_id(claim);
        assert!(linked.is_some() && *linked.borrow() == object::id(committee), E_COMMITTEE_MISMATCH);
    }

    fun assert_tally_committee(tally: &RoundTally, committee: &Committee) {
        assert!(
            tally.claim_id == committee.claim_id && tally.committee_id == object::id(committee),
            E_TALLY_MISMATCH,
        );
        assert!(tally.expected_jury_seat_ids.length() == COMMITTEE_SIZE, E_TALLY_MISMATCH);
    }

    fun assert_tally_seat(tally: &RoundTally, seat: &JurySeat) {
        assert!(!tally.closed, E_TALLY_CLOSED);
        assert!(
            tally.claim_id == seat.claim_id &&
                tally.committee_id == seat.committee_id &&
                tally.phase == seat.phase &&
                tally.evidence_root == seat.evidence_root,
            E_TALLY_MISMATCH,
        );
        let seat_id = object::id(seat);
        assert!(vector::contains(&tally.expected_jury_seat_ids, &seat_id), E_UNEXPECTED_SEAT);
        assert!(!vector::contains(&tally.revealed_jury_seat_ids, &seat_id), E_DUPLICATE_REVEAL);
    }

    fun assert_valid_outcome(outcome: u8) {
        assert!(outcome == OUTCOME_YES || outcome == OUTCOME_NO || outcome == OUTCOME_UNSURE, E_INVALID_OUTCOME);
    }

    fun can_add_selected(selected: &vector<EligibilityRecord>, candidate: &EligibilityRecord): bool {
        if (!agent_registry::eligibility_active(candidate) || agent_registry::eligibility_weight(candidate) == 0) {
            return false
        };
        if (contains_profile(selected, agent_registry::eligibility_profile_id(candidate))) return false;
        // One seat per operational key, two per model. Stakers are uncapped:
        // an address is free and a staker cannot influence a vote.
        if (contains_owner(selected, agent_registry::eligibility_owner(candidate))) return false;
        count_model(selected, agent_registry::eligibility_model_hash(candidate)) < 2 &&
            count_role(selected, agent_registry::eligibility_role_hash(candidate)) < 3
    }

    fun agent_conflicts_with_claim<T>(claim: &Claim<T>, candidate: &EligibilityRecord): bool {
        let owner = agent_registry::eligibility_owner(candidate);
        if (owner == claim::creator(claim)) return true;
        let proposer = claim::proposer_address(claim);
        if (proposer.is_some() && *proposer.borrow() == owner) return true;
        let challenger = claim::challenger_address(claim);
        if (challenger.is_some() && *challenger.borrow() == owner) return true;
        false
    }

    fun can_add_reserve(
        selected: &vector<EligibilityRecord>,
        reserves: &vector<EligibilityRecord>,
        candidate: &EligibilityRecord,
    ): bool {
        if (!agent_registry::eligibility_active(candidate) || agent_registry::eligibility_weight(candidate) == 0) {
            return false
        };
        if (contains_profile(selected, agent_registry::eligibility_profile_id(candidate)) ||
            contains_profile(reserves, agent_registry::eligibility_profile_id(candidate))) return false;
        if (contains_owner(selected, agent_registry::eligibility_owner(candidate)) ||
            contains_owner(reserves, agent_registry::eligibility_owner(candidate))) return false;
        let role = agent_registry::eligibility_role_hash(candidate);
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        if (role != &skeptic && role != &source) return false;
        if (count_role(reserves, role) > 0) return false;
        true
    }

    fun selected_diversity_valid(selected: &vector<EligibilityRecord>): bool {
        if (selected.length() != COMMITTEE_SIZE) return false;
        let mut models: vector<vector<u8>> = vector[];
        let mut has_skeptic = false;
        let mut has_source = false;
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        let mut i = 0;
        while (i < selected.length()) {
            let record = &selected[i];
            let model = agent_registry::eligibility_model_hash(record);
            if (!vector::contains(&models, model)) models.push_back(*model);
            let role = agent_registry::eligibility_role_hash(record);
            if (role == &skeptic) has_skeptic = true;
            if (role == &source) has_source = true;
            i = i + 1;
        };
        models.length() >= 3 && has_skeptic && has_source
    }

    fun replacement_preserves_diversity(
        policy: &CommitteePolicy,
        seat_index: u64,
        reserve_index: u64,
    ): bool {
        let mut models = policy.selected_model_hashes;
        let mut roles = policy.selected_role_hashes;
        *vector::borrow_mut(&mut models, seat_index) = policy.reserve_model_hashes[reserve_index];
        *vector::borrow_mut(&mut roles, seat_index) = policy.reserve_role_hashes[reserve_index];
        // Staker hashes are no longer a constraint, only models and roles are.
        model_caps_valid(&models) &&
            distinct_hash_count(&models) >= 3 &&
            vector::contains(&roles, &agent_registry::skeptic_role_hash()) &&
            vector::contains(&roles, &agent_registry::source_authenticity_role_hash())
    }

    fun contains_profile(records: &vector<EligibilityRecord>, profile_id: ID): bool {
        let mut i = 0;
        while (i < records.length()) {
            if (agent_registry::eligibility_profile_id(&records[i]) == profile_id) return true;
            i = i + 1;
        };
        false
    }

    fun contains_owner(records: &vector<EligibilityRecord>, owner: address): bool {
        let mut i = 0;
        while (i < records.length()) {
            if (agent_registry::eligibility_owner(&records[i]) == owner) return true;
            i = i + 1;
        };
        false
    }

    fun count_model(records: &vector<EligibilityRecord>, hash: &vector<u8>): u64 {
        let mut count = 0;
        let mut i = 0;
        while (i < records.length()) {
            if (agent_registry::eligibility_model_hash(&records[i]) == hash) count = count + 1;
            i = i + 1;
        };
        count
    }

    fun count_role(records: &vector<EligibilityRecord>, hash: &vector<u8>): u64 {
        let mut count = 0;
        let mut i = 0;
        while (i < records.length()) {
            if (agent_registry::eligibility_role_hash(&records[i]) == hash) count = count + 1;
            i = i + 1;
        };
        count
    }

    fun weighted_record_index(records: &vector<EligibilityRecord>, ticket: u64): u64 {
        let mut cumulative = 0;
        let mut i = 0;
        while (i < records.length()) {
            let record = &records[i];
            if (agent_registry::eligibility_active(record)) {
                cumulative = cumulative + agent_registry::eligibility_weight(record);
                if (ticket < cumulative) return i;
            };
            i = i + 1;
        };
        abort E_INSUFFICIENT_DIVERSE_AGENTS
    }

    fun model_caps_valid(models: &vector<vector<u8>>): bool {
        let mut i = 0;
        while (i < models.length()) {
            let mut count = 0;
            let mut j = 0;
            while (j < models.length()) {
                if (models[i] == models[j]) count = count + 1;
                j = j + 1;
            };
            if (count > 2) return false;
            i = i + 1;
        };
        true
    }

    fun distinct_hash_count(values: &vector<vector<u8>>): u64 {
        let mut distinct: vector<vector<u8>> = vector[];
        let mut i = 0;
        while (i < values.length()) {
            if (!vector::contains(&distinct, &values[i])) distinct.push_back(values[i]);
            i = i + 1;
        };
        distinct.length()
    }

    #[test_only]
    public(package) fun new_seat_for_testing(
        claim_id: ID,
        committee_id: ID,
        agent_profile_id: ID,
        agent_owner: address,
        phase: u8,
        evidence_root: vector<u8>,
        accepted: bool,
        commit_deadline_ms: u64,
        reveal_deadline_ms: u64,
        ctx: &mut TxContext,
    ): JurySeat {
        new_seat(
            claim_id,
            committee_id,
            agent_profile_id,
            agent_owner,
            phase,
            evidence_root,
            if (accepted) SEAT_ACCEPTED else SEAT_OFFERED,
            commit_deadline_ms,
            reveal_deadline_ms,
            ctx,
        )
    }

    #[test_only]
    public(package) fun new_tally_for_testing(
        claim_id: ID,
        committee_id: ID,
        phase: u8,
        evidence_root: vector<u8>,
        expected_jury_seat_ids: vector<ID>,
        ctx: &mut TxContext,
    ): RoundTally {
        RoundTally {
            id: object::new(ctx),
            claim_id,
            committee_id,
            phase,
            evidence_root,
            expected_jury_seat_ids,
            committed_count: 0,
            revealed_jury_seat_ids: vector[],
            revealed_vote_ids: vector[],
            yes_count: 0,
            no_count: 0,
            unsure_count: 0,
            truth_probability_sum_bps: 0,
            truth_probability_count: 0,
            closed: false,
        }
    }

    #[test_only]
    public(package) fun new_run_approval_for_testing(
        seat: &JurySeat,
        run_hash: vector<u8>,
        ctx: &mut TxContext,
    ): RunApproval {
        RunApproval {
            id: object::new(ctx),
            claim_id: seat.claim_id,
            committee_id: seat.committee_id,
            jury_seat_id: object::id(seat),
            agent_profile_id: seat.agent_profile_id,
            agent_owner: seat.agent_owner,
            run_hash,
            run_blob_id: b"run",
            run_blob_object_id: object::id_from_address(@0x710),
            tool_blob_id: b"tool",
            tool_blob_object_id: object::id_from_address(@0x7001),
            walrus_end_epoch: 100,
            phase: seat.phase,
        }
    }

    #[test_only]
    public(package) fun record_reveal_for_testing(
        tally: &mut RoundTally,
        seat_id: ID,
        vote_id: ID,
        outcome: u8,
        confidence_bps: u16,
    ) {
        record_reveal(tally, seat_id, vote_id, outcome, confidence_bps)
    }

    #[test_only]
    public(package) fun destroy_seat_for_testing(seat: JurySeat) { destroy_seat(seat) }

    #[test_only]
    public(package) fun destroy_tally_for_testing(tally: RoundTally) {
        let RoundTally {
            id,
            claim_id: _,
            committee_id: _,
            phase: _,
            evidence_root: _,
            expected_jury_seat_ids: _,
            committed_count: _,
            revealed_jury_seat_ids: _,
            revealed_vote_ids: _,
            yes_count: _,
            no_count: _,
            unsure_count: _,
            truth_probability_sum_bps: _,
            truth_probability_count: _,
            closed: _,
        } = tally;
        id.delete();
    }

    /// Twenty seconds after selection, never past the commit deadline.
    fun acceptance_deadline(now: u64, commit_deadline: u64): u64 {
        if (now + ACCEPTANCE_WINDOW_MS < commit_deadline) {
            now + ACCEPTANCE_WINDOW_MS
        } else {
            commit_deadline
        }
    }

    #[test_only]
    public(package) fun acceptance_deadline_for_testing(now: u64, commit_deadline: u64): u64 {
        acceptance_deadline(now, commit_deadline)
    }

    #[test_only]
    public(package) fun new_committee_for_testing(
        claim_id: ID,
        profiles: vector<ID>,
        owners: vector<address>,
        locked: bool,
        ctx: &mut TxContext,
    ): Committee {
        assert!(profiles.length() == owners.length());
        let count = profiles.length();
        let mut committee = Committee {
            id: object::new(ctx),
            claim_id,
            agent_profile_ids: profiles,
            agent_owners: owners,
            reserve_profile_ids: vector[
                object::id_from_address(@0x9001),
                object::id_from_address(@0x9002),
            ],
            reserve_owners: vector[@0xA6, @0xA7],
            selected_at_ms: 0,
            locked,
        };
        let mut humans = vector[];
        let mut models = vector[];
        let mut roles = vector[];
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        let mut i = 0;
        while (i < count) {
            humans.push_back(vector::tabulate!(32, |_| (i + 1) as u8));
            models.push_back(vector::tabulate!(32, |_| (i % 3 + 1) as u8));
            roles.push_back(if (i % 2 == 0) skeptic else source);
            i = i + 1;
        };
        df::add(
            &mut committee.id,
            CommitteePolicyKey {},
            CommitteePolicy {
                selected_human_hashes: humans,
                selected_model_hashes: models,
                selected_role_hashes: roles,
                reserve_human_hashes: vector[
                    vector::tabulate!(32, |_| 6),
                    vector::tabulate!(32, |_| 7),
                ],
                reserve_model_hashes: vector[
                    vector::tabulate!(32, |_| 3),
                    vector::tabulate!(32, |_| 3),
                ],
                reserve_role_hashes: vector[source, skeptic],
                acceptance_deadline_ms: 0,
            },
        );
        committee
    }

    #[test_only]
    /// Route the given seats and reserves to explicit payout recipients.
    public(package) fun set_committee_payouts_for_testing(
        committee: &mut Committee,
        selected: vector<address>,
        reserves: vector<address>,
    ) {
        df::add(
            &mut committee.id,
            CommitteePayoutsKey {},
            CommitteePayouts { selected, reserves },
        );
    }

    #[test_only]
    public(package) fun destroy_committee_for_testing(committee: Committee) {
        let mut committee = committee;
        let payouts = df::remove_if_exists<CommitteePayoutsKey, CommitteePayouts>(
            &mut committee.id,
            CommitteePayoutsKey {},
        );
        if (payouts.is_some()) {
            let CommitteePayouts { selected: _, reserves: _ } = payouts.destroy_some();
        } else {
            payouts.destroy_none();
        };
        let CommitteePolicy {
            selected_human_hashes: _,
            selected_model_hashes: _,
            selected_role_hashes: _,
            reserve_human_hashes: _,
            reserve_model_hashes: _,
            reserve_role_hashes: _,
            acceptance_deadline_ms: _,
        } = df::remove(&mut committee.id, CommitteePolicyKey {});
        let Committee {
            id,
            claim_id: _,
            agent_profile_ids: _,
            agent_owners: _,
            reserve_profile_ids: _,
            reserve_owners: _,
            selected_at_ms: _,
            locked: _,
        } = committee;
        id.delete();
    }

    #[test_only]
    public struct JuryTestCoin has drop {}

    #[test_only]
    fun selection_params(): claim::ClaimParams {
        claim::new_claim_params(
            claim::claim_mode_direct_review(),
            100,
            200,
            300,
            400,
            500,
            600,
            700,
            10,
            80,
            10,
        )
    }

    #[test_only]
    /// The same seven seats as add_diverse_selection_records, but sharing four
    /// staker hashes: staking no longer constrains the draw.
    fun add_repeated_staker_hash_records(registry: &mut Registry) {
        let profiles = vector[@0x101, @0x102, @0x103, @0x104, @0x105, @0x106, @0x107];
        let owners = vector[@0xA1, @0xA2, @0xA3, @0xA4, @0xA5, @0xA6, @0xA7];
        let models = vector[11u8, 11, 12, 12, 13, 13, 14];
        let stakers = vector[1u8, 1, 2, 2, 3, 3, 4];
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        let mut i = 0;
        while (i < profiles.length()) {
            let staker_byte = stakers[i];
            let model_byte = models[i];
            agent_registry::add_eligibility_for_testing(
                registry,
                object::id_from_address(profiles[i]),
                owners[i],
                vector::tabulate!(32, |_| staker_byte),
                vector::tabulate!(32, |_| model_byte),
                if (i % 2 == 0) skeptic else source,
            );
            i = i + 1;
        };
    }

    #[test_only]
    /// The 2026-09-04 testnet roster: three sources on one model family, four
    /// skeptics on two others, plus the staked skeptic on the source family
    /// that stalled two draws in three before the restart existed.
    fun add_stalling_selection_records(registry: &mut Registry) {
        let profiles = vector[@0x301, @0x302, @0x303, @0x304, @0x305, @0x306, @0x307, @0x308];
        let owners = vector[@0xC1, @0xC2, @0xC3, @0xC4, @0xC5, @0xC6, @0xC7, @0xC8];
        // 21 is the source family, 22 and 23 the two skeptic-only families.
        let models = vector[21u8, 21, 21, 22, 22, 23, 23, 21];
        // Staker hashes repeat: one account may stake on several seats.
        let stakers = vector[1u8, 1, 2, 2, 3, 3, 4, 4];
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        let mut i = 0;
        while (i < profiles.length()) {
            let staker_byte = stakers[i];
            let model_byte = models[i];
            agent_registry::add_eligibility_for_testing(
                registry,
                object::id_from_address(profiles[i]),
                owners[i],
                vector::tabulate!(32, |_| staker_byte),
                vector::tabulate!(32, |_| model_byte),
                if (i < 3) source else skeptic,
            );
            i = i + 1;
        };
    }

    #[test_only]
    fun add_diverse_selection_records(registry: &mut Registry) {
        let skeptic = agent_registry::skeptic_role_hash();
        let source = agent_registry::source_authenticity_role_hash();
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x101),
            @0xA1,
            vector::tabulate!(32, |_| 1),
            vector::tabulate!(32, |_| 11),
            skeptic,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x102),
            @0xA2,
            vector::tabulate!(32, |_| 2),
            vector::tabulate!(32, |_| 11),
            source,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x103),
            @0xA3,
            vector::tabulate!(32, |_| 3),
            vector::tabulate!(32, |_| 12),
            skeptic,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x104),
            @0xA4,
            vector::tabulate!(32, |_| 4),
            vector::tabulate!(32, |_| 12),
            source,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x105),
            @0xA5,
            vector::tabulate!(32, |_| 5),
            vector::tabulate!(32, |_| 13),
            skeptic,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x106),
            @0xA6,
            vector::tabulate!(32, |_| 6),
            vector::tabulate!(32, |_| 13),
            source,
        );
        agent_registry::add_eligibility_for_testing(
            registry,
            object::id_from_address(@0x107),
            @0xA7,
            vector::tabulate!(32, |_| 7),
            vector::tabulate!(32, |_| 14),
            skeptic,
        );
    }

    #[test]
    fun native_random_selection_creates_five_seats_and_reserves() {
        use sui::coin;
        use sui::test_scenario;

        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, @0x0);
        let mut randomness = test_scenario::take_shared<Random>(&scenario);
        random::update_randomness_state_for_testing(
            &mut randomness,
            0,
            vector::tabulate!(32, |i| i as u8),
            scenario.ctx(),
        );
        test_scenario::return_shared(randomness);

        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        add_diverse_selection_records(&mut registry);
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<JuryTestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            selection_params(),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let randomness = test_scenario::take_shared<Random>(&scenario);
        select_committee(&registry, &mut claim, &randomness, &clock, scenario.ctx());
        test_scenario::return_shared(randomness);
        assert!(claim::state(&claim) == claim::state_commit_1());

        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let committee = test_scenario::take_shared<Committee>(&scenario);
        assert!(committee.agent_profile_ids.length() == COMMITTEE_SIZE);
        assert!(committee.reserve_profile_ids.length() == RESERVE_COUNT);
        test_scenario::return_shared(committee);
        claim::destroy_claim_for_testing(claim);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun native_random_selection_accepts_repeated_staker_hashes() {
        use sui::coin;
        use sui::test_scenario;

        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, @0x0);
        let mut randomness = test_scenario::take_shared<Random>(&scenario);
        random::update_randomness_state_for_testing(
            &mut randomness,
            0,
            vector::tabulate!(32, |i| i as u8),
            scenario.ctx(),
        );
        test_scenario::return_shared(randomness);

        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        add_repeated_staker_hash_records(&mut registry);
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<JuryTestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            selection_params(),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let randomness = test_scenario::take_shared<Random>(&scenario);
        select_committee(&registry, &mut claim, &randomness, &clock, scenario.ctx());
        test_scenario::return_shared(randomness);
        assert!(claim::state(&claim) == claim::state_commit_1());

        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let committee = test_scenario::take_shared<Committee>(&scenario);
        assert!(committee.agent_profile_ids.length() == COMMITTEE_SIZE);
        assert!(committee.reserve_profile_ids.length() == RESERVE_COUNT);
        // No seat is staked here, so every reward still belongs to its owner.
        let mut i = 0;
        while (i < COMMITTEE_SIZE) {
            assert!(
                payout_recipient_for_expected_index(&committee, i) == committee.agent_owners[i],
            );
            i = i + 1;
        };
        test_scenario::return_shared(committee);
        claim::destroy_claim_for_testing(claim);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun stalled_selection_restarts_and_seats_the_incident_roster() {
        use sui::coin;
        use sui::test_scenario;

        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        add_stalling_selection_records(&mut registry);
        let clock = clock::create_for_testing(scenario.ctx());

        // Five randomness states over the roster that aborted on testnet: the
        // greedy draw alone stranded roughly two draws in three, the restart
        // has to seat a full committee under every one of them.
        let mut round = 0;
        while (round < 5) {
            test_scenario::next_tx(&mut scenario, @0x0);
            let mut randomness = test_scenario::take_shared<Random>(&scenario);
            random::update_randomness_state_for_testing(
                &mut randomness,
                round,
                vector::tabulate!(32, |i| ((i * 5 + round * 31 + 1) % 251) as u8),
                scenario.ctx(),
            );
            test_scenario::return_shared(randomness);

            test_scenario::next_tx(&mut scenario, @0xCAFE);
            let budget = coin::mint_for_testing<JuryTestCoin>(100, scenario.ctx());
            let mut claim = claim::new_claim_for_testing(
                &registry,
                budget,
                selection_params(),
                &clock,
                scenario.ctx(),
            );
            claim::start_direct_review(&registry, &mut claim, &clock);
            let randomness = test_scenario::take_shared<Random>(&scenario);
            select_committee(&registry, &mut claim, &randomness, &clock, scenario.ctx());
            test_scenario::return_shared(randomness);
            assert!(claim::state(&claim) == claim::state_commit_1());
            claim::destroy_claim_for_testing(claim);

            test_scenario::next_tx(&mut scenario, @0xCAFE);
            let committee = test_scenario::take_shared<Committee>(&scenario);
            assert!(committee.agent_profile_ids.length() == COMMITTEE_SIZE);
            assert!(committee.reserve_profile_ids.length() == RESERVE_COUNT);
            // Every cap the restart could have corrupted, checked on the result.
            let mut a = 0;
            while (a < COMMITTEE_SIZE) {
                let mut b = a + 1;
                while (b < COMMITTEE_SIZE) {
                    assert!(committee.agent_owners[a] != committee.agent_owners[b]);
                    b = b + 1;
                };
                a = a + 1;
            };
            let policy = df::borrow<CommitteePolicyKey, CommitteePolicy>(
                &committee.id,
                CommitteePolicyKey {},
            );
            assert!(model_caps_valid(&policy.selected_model_hashes));
            assert!(distinct_hash_count(&policy.selected_model_hashes) >= 3);
            assert!(vector::contains(
                &policy.selected_role_hashes,
                &agent_registry::skeptic_role_hash(),
            ));
            assert!(vector::contains(
                &policy.selected_role_hashes,
                &agent_registry::source_authenticity_role_hash(),
            ));
            // The two reserves always carry one skeptic and one source.
            assert!(distinct_hash_count(&policy.reserve_role_hashes) == RESERVE_COUNT);
            destroy_committee_for_testing(committee);
            round = round + 1;
        };

        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_INSUFFICIENT_DIVERSE_AGENTS)]
    fun native_random_selection_aborts_without_model_diversity() {
        use sui::coin;
        use sui::test_scenario;

        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, @0x0);
        let mut randomness = test_scenario::take_shared<Random>(&scenario);
        random::update_randomness_state_for_testing(
            &mut randomness,
            0,
            vector::tabulate!(32, |_| 1),
            scenario.ctx(),
        );
        test_scenario::return_shared(randomness);

        test_scenario::next_tx(&mut scenario, @0xCAFE);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let model = vector::tabulate!(32, |_| 9);
        let skeptic = agent_registry::skeptic_role_hash();
        let mut i = 1;
        while (i <= 7) {
            agent_registry::add_eligibility_for_testing(
                &mut registry,
                object::id_from_address(if (i == 1) @0x201 else if (i == 2) @0x202 else if (i == 3) @0x203 else if (i == 4) @0x204 else if (i == 5) @0x205 else if (i == 6) @0x206 else @0x207),
                if (i == 1) @0xB1 else if (i == 2) @0xB2 else if (i == 3) @0xB3 else if (i == 4) @0xB4 else if (i == 5) @0xB5 else if (i == 6) @0xB6 else @0xB7,
                vector::tabulate!(32, |_| i as u8),
                model,
                skeptic,
            );
            i = i + 1;
        };
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<JuryTestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            selection_params(),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let randomness = test_scenario::take_shared<Random>(&scenario);
        select_committee(&registry, &mut claim, &randomness, &clock, scenario.ctx());
        abort E_UNEXPECTED_SUCCESS
    }
}

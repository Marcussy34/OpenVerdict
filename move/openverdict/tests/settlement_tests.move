#[test_only]
module openverdict::settlement_tests {
    use openverdict::agent_registry;
    use openverdict::claim;
    use openverdict::evidence;
    use openverdict::jury;
    use openverdict::settlement;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::test_scenario;

    const CREATOR: address = @0xC0FFEE;
    const PROPOSER: address = @0xB0B;
    const CHALLENGER: address = @0xC4A11;
    const AGENT_1: address = @0xA1;
    const AGENT_2: address = @0xA2;
    const AGENT_3: address = @0xA3;
    const AGENT_4: address = @0xA4;
    const AGENT_5: address = @0xA5;
    const TREASURY: address = @0x7EA5;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    public struct TestCoin has drop {}

    fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    fun params(mode: u8): claim::ClaimParams {
        claim::new_claim_params(mode, 10, 20, 30, 40, 50, 60, 70, 10, 80, 10)
    }

    fun profiles(): vector<ID> {
        vector[
            object::id_from_address(@0x101),
            object::id_from_address(@0x102),
            object::id_from_address(@0x103),
            object::id_from_address(@0x104),
            object::id_from_address(@0x105),
        ]
    }

    fun owners(): vector<address> { vector[AGENT_1, AGENT_2, AGENT_3, AGENT_4, AGENT_5] }

    fun seat_ids(): vector<ID> {
        vector[
            object::id_from_address(@0x201),
            object::id_from_address(@0x202),
            object::id_from_address(@0x203),
            object::id_from_address(@0x204),
            object::id_from_address(@0x205),
        ]
    }

    fun freeze_phase_one<T>(
        claim: &mut claim::Claim<T>,
        cap: &agent_registry::EvidenceCap,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        evidence::freeze_evidence(
            claim,
            cap,
            1,
            hash(7),
            b"phase-one-manifest",
            object::id_from_address(@0xB101),
            3,
            b"policy",
            100,
            clock,
            ctx,
        );
    }

    fun finalize_four_of_five(
        registry: &agent_registry::Registry,
        scenario: &mut test_scenario::Scenario,
    ): (
        claim::Claim<TestCoin>,
        jury::Committee,
        jury::RoundTally,
        agent_registry::EvidenceCap,
        Clock,
    ) {
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0x311 else if (i == 1) @0x312 else if (i == 2) @0x313 else @0x314),
                claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 41);
        test_scenario::next_tx(scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_immutable(bundle);
        (claim, committee, tally, evidence_cap, clock)
    }

    #[test]
    fun reviewed_settlement_mints_default_protocol_fee_and_splits_remainder() {
        let mut scenario = test_scenario::begin(TREASURY);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let (claim, committee, tally, evidence_cap, clock) =
            finalize_four_of_five(&registry, &mut scenario);

        test_scenario::next_tx(&mut scenario, TREASURY);
        let fee_ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_recipient(&fee_ticket) == TREASURY);
        assert!(settlement::ticket_amount(&fee_ticket) == 4);
        assert!(settlement::ticket_reason(&fee_ticket) == settlement::reason_protocol_fee());
        test_scenario::return_to_sender(&scenario, fee_ticket);

        let payout_owners = owners();
        let mut i = 0;
        while (i < 4) {
            test_scenario::next_tx(&mut scenario, payout_owners[i]);
            let ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
            assert!(settlement::ticket_amount(&ticket) == 19);
            assert!(settlement::ticket_reason(&ticket) == settlement::reason_jury_reward());
            test_scenario::return_to_sender(&scenario, ticket);
            i = i + 1;
        };
        test_scenario::next_tx(&mut scenario, AGENT_5);
        assert!(!test_scenario::has_most_recent_for_sender<settlement::PayoutTicket<TestCoin>>(&scenario));
        test_scenario::next_tx(&mut scenario, CREATOR);
        let refund = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&refund) == 20);
        assert!(settlement::ticket_reason(&refund) == settlement::reason_creator_refund());
        test_scenario::return_to_sender(&scenario, refund);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun zero_protocol_fee_mints_no_treasury_ticket_and_splits_full_budget() {
        let mut scenario = test_scenario::begin(TREASURY);
        agent_registry::init_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, TREASURY);
        let mut registry = test_scenario::take_shared<agent_registry::Registry>(&scenario);
        let admin_cap = test_scenario::take_from_sender<agent_registry::AdminCap>(&scenario);
        agent_registry::set_treasury_policy(&mut registry, &admin_cap, TREASURY, 0);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let (claim, committee, tally, evidence_cap, clock) =
            finalize_four_of_five(&registry, &mut scenario);

        test_scenario::next_tx(&mut scenario, TREASURY);
        assert!(!test_scenario::has_most_recent_for_sender<settlement::PayoutTicket<TestCoin>>(&scenario));
        let payout_owners = owners();
        let mut i = 0;
        while (i < 4) {
            test_scenario::next_tx(&mut scenario, payout_owners[i]);
            let ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
            assert!(settlement::ticket_amount(&ticket) == 20);
            assert!(settlement::ticket_reason(&ticket) == settlement::reason_jury_reward());
            test_scenario::return_to_sender(&scenario, ticket);
            i = i + 1;
        };
        test_scenario::next_tx(&mut scenario, CREATOR);
        let refund = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&refund) == 20);
        assert!(settlement::ticket_reason(&refund) == settlement::reason_creator_refund());
        test_scenario::return_to_sender(&scenario, refund);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        clock::destroy_for_testing(clock);
        test_scenario::return_to_address(TREASURY, admin_cap);
        test_scenario::return_shared(registry);
        scenario.end();
    }

    #[test]
    fun four_of_five_finalizes_and_all_tickets_conserve_balance_while_paused() {
        let mut scenario = test_scenario::begin(CREATOR);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0x301 else if (i == 1) @0x302 else if (i == 2) @0x303 else @0x304),
                claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 41);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_immutable(bundle);
        assert!(claim::state(&claim) == claim::state_finalized_reviewed());
        assert!(claim::result(&claim) == claim::outcome_yes());
        assert!(claim::total_balance(&claim) == 100);
        agent_registry::pause(&mut registry, &pause_cap);

        let payout_owners = owners();
        let mut withdrawn = 0;
        i = 0;
        while (i < 4) {
            let owner = payout_owners[i];
            test_scenario::next_tx(&mut scenario, owner);
            let ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
            assert!(settlement::ticket_amount(&ticket) == 19);
            settlement::withdraw_payout(&mut claim, ticket, &clock, scenario.ctx());
            assert!(!test_scenario::has_most_recent_for_sender<settlement::PayoutTicket<TestCoin>>(&scenario));
            test_scenario::next_tx(&mut scenario, owner);
            let payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
            withdrawn = withdrawn + coin::burn_for_testing(payout);
            i = i + 1;
        };
        test_scenario::next_tx(&mut scenario, CREATOR);
        let creator_ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&creator_ticket) == 20);
        settlement::withdraw_payout(&mut claim, creator_ticket, &clock, scenario.ctx());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let creator_payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        withdrawn = withdrawn + coin::burn_for_testing(creator_payout);
        let fee_ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&fee_ticket) == 4);
        assert!(settlement::ticket_reason(&fee_ticket) == settlement::reason_protocol_fee());
        settlement::withdraw_payout(&mut claim, fee_ticket, &clock, scenario.ctx());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let fee_payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        withdrawn = withdrawn + coin::burn_for_testing(fee_payout);
        assert!(withdrawn == 100);
        assert!(claim::total_balance(&claim) == 0);

        assert!(claim::destroy_claim_for_testing(claim) == 0);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_pause_cap_for_testing(pause_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun unchallenged_certificate_has_no_truth_score() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_optimistic_settlement()),
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, PROPOSER);
        let bond = coin::mint_for_testing<TestCoin>(25, scenario.ctx());
        claim::propose_outcome(
            &registry,
            &mut claim,
            bond,
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        clock::set_for_testing(&mut clock, 21);
        settlement::finalize_unchallenged(&mut claim, &clock, scenario.ctx());
        assert!(claim::state(&claim) == claim::state_finalized_unchallenged());
        test_scenario::next_tx(&mut scenario, PROPOSER);
        let certificate = test_scenario::take_immutable<jury::ResolutionCertificate>(&scenario);
        assert!(jury::certificate_result(&certificate) == claim::outcome_yes());
        assert!(jury::certificate_truth_score_bps(&certificate).is_none());
        test_scenario::return_immutable(certificate);
        assert!(claim::destroy_claim_for_testing(claim) == 125);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun unsure_threshold_is_unresolved_and_refunds_both_bonds() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_optimistic_settlement()),
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, PROPOSER);
        claim::propose_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, CHALLENGER);
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            hash(8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        claim::start_challenged_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0x401 else if (i == 1) @0x402 else if (i == 2) @0x403 else @0x404),
                claim::outcome_unsure(),
                10_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 41);
        test_scenario::next_tx(&mut scenario, CHALLENGER);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_immutable(bundle);
        assert!(claim::state(&claim) == claim::state_unresolved());
        assert!(*jury::truth_score_bps(&tally).borrow() == 5_000);
        test_scenario::next_tx(&mut scenario, PROPOSER);
        let proposer_ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&proposer_ticket) == 25);
        test_scenario::return_to_sender(&scenario, proposer_ticket);
        test_scenario::next_tx(&mut scenario, CHALLENGER);
        let challenger_ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&challenger_ticket) == 25);
        test_scenario::return_to_sender(&scenario, challenger_ticket);

        assert!(claim::destroy_claim_for_testing(claim) == 150);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun committee_acceptance_window_is_one_minute_capped_at_the_commit_deadline() {
        assert!(jury::acceptance_deadline_for_testing(1_000, 1_000_000) == 61_000);
        assert!(jury::acceptance_deadline_for_testing(990_000, 1_000_000) == 1_000_000);
        assert!(jury::acceptance_deadline_for_testing(940_000, 1_000_000) == 1_000_000);
    }

    #[test]
    fun split_round_opens_discussion_and_round_two_as_soon_as_the_record_is_complete() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut first_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(
            &mut claim,
            jury::committee_id(&committee),
            jury::tally_id(&first_tally),
        );
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let first_expected = *jury::expected_seat_ids(&first_tally);
        let mut i = 0;
        while (i < 5) {
            jury::record_reveal_for_testing(
                &mut first_tally,
                first_expected[i],
                object::id_from_address(if (i == 0) @0x701 else if (i == 1) @0x702 else if (i == 2) @0x703 else if (i == 3) @0x704 else @0x705),
                if (i < 3) claim::outcome_yes() else claim::outcome_no(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        // Every seat revealed at 35, well before the reveal deadline (40):
        // the debate opens now instead of at the deadline.
        clock::set_for_testing(&mut clock, 35);
        jury::open_discussion(&mut claim, &mut first_tally, &clock);
        assert!(claim::state(&claim) == claim::state_discussion());

        // The frozen debate transcript (phase-two evidence) ends the debate:
        // round two opens at 42, before the discussion deadline (50).
        evidence::freeze_evidence(
            &mut claim,
            &evidence_cap,
            2,
            hash(8),
            b"phase-two-manifest",
            object::id_from_address(@0xB202),
            4,
            b"policy",
            100,
            &clock,
            scenario.ctx(),
        );
        clock::set_for_testing(&mut clock, 42);
        jury::create_second_round_seats(
            &mut claim,
            &committee,
            &mut first_tally,
            &clock,
            scenario.ctx(),
        );
        assert!(jury::tally_closed(&first_tally));
        assert!(claim::state(&claim) == claim::state_commit_2());

        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        let second_tally = test_scenario::take_shared<jury::RoundTally>(&scenario);
        test_scenario::return_shared(second_tally);
        test_scenario::return_immutable(bundle);
        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(first_tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_DEADLINE_NOT_REACHED)]
    fun discussion_waits_for_the_deadline_while_a_seat_has_not_revealed() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut first_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(
            &mut claim,
            jury::committee_id(&committee),
            jury::tally_id(&first_tally),
        );
        let first_expected = *jury::expected_seat_ids(&first_tally);
        // Four of five revealed and split: one seat is still out, so the
        // debate must wait for the reveal deadline.
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut first_tally,
                first_expected[i],
                object::id_from_address(if (i == 0) @0x801 else if (i == 1) @0x802 else if (i == 2) @0x803 else @0x804),
                if (i < 2) claim::outcome_yes() else claim::outcome_no(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 35);
        jury::open_discussion(&mut claim, &mut first_tally, &clock);
        abort 0
    }

    #[test]
    fun three_two_escalates_to_second_round_and_four_one_finalizes() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut first_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(
            &mut claim,
            jury::committee_id(&committee),
            jury::tally_id(&first_tally),
        );
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let first_expected = *jury::expected_seat_ids(&first_tally);
        let mut i = 0;
        while (i < 5) {
            jury::record_reveal_for_testing(
                &mut first_tally,
                first_expected[i],
                object::id_from_address(if (i == 0) @0x501 else if (i == 1) @0x502 else if (i == 2) @0x503 else if (i == 3) @0x504 else @0x505),
                if (i < 3) claim::outcome_yes() else claim::outcome_no(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 41);
        jury::open_discussion(&mut claim, &mut first_tally, &clock);
        assert!(claim::state(&claim) == claim::state_discussion());

        evidence::freeze_evidence(
            &mut claim,
            &evidence_cap,
            2,
            hash(8),
            b"phase-two-manifest",
            object::id_from_address(@0xB102),
            4,
            b"policy",
            100,
            &clock,
            scenario.ctx(),
        );
        clock::set_for_testing(&mut clock, 51);
        jury::create_second_round_seats(
            &mut claim,
            &committee,
            &mut first_tally,
            &clock,
            scenario.ctx(),
        );
        assert!(jury::tally_closed(&first_tally));
        assert!(claim::state(&claim) == claim::state_commit_2());

        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        let mut second_tally = test_scenario::take_shared<jury::RoundTally>(&scenario);
        let mut first_seat = test_scenario::take_from_address<jury::JurySeat>(&scenario, AGENT_1);
        let first_cap = agent_registry::new_agent_cap_for_testing(
            jury::jury_seat_profile_id(&first_seat),
            scenario.ctx(),
        );
        jury::bind_jury_seat_evidence(&mut first_seat, &mut second_tally, &bundle, &first_cap);
        test_scenario::return_to_address(AGENT_1, first_seat);
        agent_registry::destroy_agent_cap_for_testing(first_cap);
        let second_expected = *jury::expected_seat_ids(&second_tally);
        i = 0;
        while (i < 5) {
            jury::record_reveal_for_testing(
                &mut second_tally,
                second_expected[i],
                object::id_from_address(if (i == 0) @0x601 else if (i == 1) @0x602 else if (i == 2) @0x603 else if (i == 3) @0x604 else @0x605),
                if (i < 4) claim::outcome_no() else claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        clock::set_for_testing(&mut clock, 61);
        let readiness = jury::phase_readiness(&second_tally, scenario.ctx());
        claim::advance_phase(&mut claim, readiness, &clock);
        clock::set_for_testing(&mut clock, 71);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut second_tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        assert!(claim::state(&claim) == claim::state_finalized_reviewed());
        assert!(claim::result(&claim) == claim::outcome_no());
        assert!(*jury::truth_score_bps(&second_tally).borrow() == 2_600);
        test_scenario::return_shared(second_tally);
        test_scenario::return_immutable(bundle);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(first_tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::settlement::E_NOT_RECIPIENT)]
    fun payout_ticket_rejects_wrong_recipient() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::set_state_for_testing(&mut claim, claim::state_cancelled());
        let ticket = settlement::new_ticket_for_testing<TestCoin>(
            claim::claim_id(&claim),
            CREATOR,
            10,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, @0xBAD);
        settlement::withdraw_payout(&mut claim, ticket, &clock, scenario.ctx());
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun second_round_without_any_threshold_is_unresolved_with_none_score() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let first_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(
            &mut claim,
            jury::committee_id(&committee),
            jury::tally_id(&first_tally),
        );
        claim::set_state_for_testing(&mut claim, claim::state_discussion());
        evidence::freeze_evidence(
            &mut claim,
            &evidence_cap,
            2,
            hash(8),
            b"phase-two-manifest",
            object::id_from_address(@0xB202),
            1,
            b"policy",
            100,
            &clock,
            scenario.ctx(),
        );
        let mut second_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            2,
            hash(8),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_second_round_tally(&mut claim, jury::tally_id(&second_tally));
        claim::set_state_for_testing(&mut claim, claim::state_reveal_2());
        clock::set_for_testing(&mut clock, 71);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut second_tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_immutable(bundle);
        assert!(claim::state(&claim) == claim::state_unresolved());
        assert!(claim::result(&claim) == claim::result_unresolved());
        assert!(jury::truth_score_bps(&second_tally).is_none());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let certificate = test_scenario::take_immutable<jury::ResolutionCertificate>(&scenario);
        assert!(jury::certificate_truth_score_bps(&certificate).is_none());
        test_scenario::return_immutable(certificate);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(first_tally);
        jury::destroy_tally_for_testing(second_tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::settlement::E_DEADLINE_NOT_REACHED)]
    fun reviewed_finalization_at_exact_reveal_deadline_aborts() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles(),
            owners(),
            true,
            scenario.ctx(),
        );
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            hash(7),
            seat_ids(),
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0x801 else if (i == 1) @0x802 else if (i == 2) @0x803 else @0x804),
                claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 40);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::settlement::E_INVALID_STATE)]
    fun terminal_claim_cannot_be_finalized_again() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_optimistic_settlement()),
            &clock,
            scenario.ctx(),
        );
        claim::propose_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        clock::set_for_testing(&mut clock, 21);
        settlement::finalize_unchallenged(&mut claim, &clock, scenario.ctx());
        settlement::finalize_unchallenged(&mut claim, &clock, scenario.ctx());
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun full_five_agent_commit_reveal_finalizes_early_and_creates_all_entitlements() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let evidence_cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let profiles = profiles();
        let owners = owners();
        let committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles,
            owners,
            true,
            scenario.ctx(),
        );
        let mut expected = vector[];
        let mut i = 0;
        while (i < 5) {
            let seat = jury::new_seat_for_testing(
                claim::claim_id(&claim),
                jury::committee_id(&committee),
                profiles[i],
                owners[i],
                1,
                vector[],
                true,
                30,
                40,
                scenario.ctx(),
            );
            expected.push_back(jury::jury_seat_id(&seat));
            transfer::public_transfer(seat, owners[i]);
            i = i + 1;
        };
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            vector[],
            expected,
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        freeze_phase_one(&mut claim, &evidence_cap, &clock, scenario.ctx());

        i = 0;
        while (i < 5) {
            test_scenario::next_tx(&mut scenario, owners[i]);
            let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
            let mut seat = test_scenario::take_from_sender<jury::JurySeat>(&scenario);
            let cap = agent_registry::new_agent_cap_for_testing(profiles[i], scenario.ctx());
            jury::bind_jury_seat_evidence(&mut seat, &mut tally, &bundle, &cap);
            let preimage = jury::new_vote_preimage(
                claim::claim_id(&claim),
                profiles[i],
                jury::jury_seat_id(&seat),
                1,
                claim::outcome_yes(),
                9_000,
                hash(7),
                hash(2),
                hash(3),
                b"salt",
            );
            let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
            jury::commit_vote(
                &mut seat,
                &mut tally,
                &cap,
                approval,
                jury::compute_commitment(&preimage),
                &clock,
            );
            test_scenario::return_immutable(bundle);
            test_scenario::return_to_sender(&scenario, seat);
            agent_registry::destroy_agent_cap_for_testing(cap);
            i = i + 1;
        };

        clock::set_for_testing(&mut clock, 29);
        let readiness = jury::phase_readiness(&tally, scenario.ctx());
        claim::advance_phase(&mut claim, readiness, &clock);
        i = 0;
        while (i < 5) {
            test_scenario::next_tx(&mut scenario, owners[i]);
            let seat = test_scenario::take_from_sender<jury::JurySeat>(&scenario);
            let cap = agent_registry::new_agent_cap_for_testing(profiles[i], scenario.ctx());
            jury::reveal_vote(
                seat,
                &mut tally,
                &cap,
                claim::outcome_yes(),
                9_000,
                hash(2),
                hash(3),
                b"salt",
                b"argument",
                object::id_from_address(@0xA46),
                10,
                &clock,
                scenario.ctx(),
            );
            agent_registry::destroy_agent_cap_for_testing(cap);
            i = i + 1;
        };
        assert!(jury::threshold_outcome(&tally) == claim::outcome_yes());
        assert!(jury::tally_reveal_count(&tally) == 5);

        clock::set_for_testing(&mut clock, 30);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let bundle = test_scenario::take_immutable<evidence::EvidenceBundle>(&scenario);
        settlement::finalize_claim(
            &mut claim,
            &committee,
            &mut tally,
            &bundle,
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_immutable(bundle);
        assert!(claim::state(&claim) == claim::state_finalized_reviewed());
        assert!(claim::result(&claim) == claim::outcome_yes());
        assert!(*jury::truth_score_bps(&tally).borrow() == 9_000);

        test_scenario::next_tx(&mut scenario, AGENT_1);
        let certificate = test_scenario::take_immutable<jury::ResolutionCertificate>(&scenario);
        assert!(*jury::certificate_truth_score_bps(&certificate).borrow() == 9_000);
        test_scenario::return_immutable(certificate);
        let reward = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&reward) == 15);
        assert!(settlement::ticket_reason(&reward) == settlement::reason_jury_reward());
        test_scenario::return_to_sender(&scenario, reward);
        test_scenario::next_tx(&mut scenario, CREATOR);
        let refund = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&refund) == 21);
        assert!(settlement::ticket_reason(&refund) == settlement::reason_creator_refund());
        test_scenario::return_to_sender(&scenario, refund);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_evidence_cap_for_testing(evidence_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun creator_can_cancel_before_proposal_and_withdraw_full_budget() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_optimistic_settlement()),
            &clock,
            scenario.ctx(),
        );
        settlement::cancel_claim(&mut claim, &clock, scenario.ctx());
        assert!(claim::state(&claim) == claim::state_cancelled());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let ticket = test_scenario::take_from_sender<settlement::PayoutTicket<TestCoin>>(&scenario);
        assert!(settlement::ticket_amount(&ticket) == 100);
        settlement::withdraw_payout(&mut claim, ticket, &clock, scenario.ctx());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let refund = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        assert!(coin::burn_for_testing(refund) == 100);
        assert!(claim::total_balance(&claim) == 0);
        assert!(claim::destroy_claim_for_testing(claim) == 0);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
}

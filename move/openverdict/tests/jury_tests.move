#[test_only]
module openverdict::jury_tests {
    use openverdict::agent_registry;
    use openverdict::claim;
    use openverdict::jury;
    use sui::clock;
    use sui::coin;
    use sui::test_scenario;

    const OWNER: address = @0xA11CE;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    fun make_seat_and_tally(
        ctx: &mut TxContext,
    ): (jury::JurySeat, jury::RoundTally, agent_registry::AgentCap) {
        let claim_id = object::id_from_address(@0xC1A1);
        let committee_id = object::id_from_address(@0xC011);
        let profile_id = object::id_from_address(@0xA6317);
        let seat = jury::new_seat_for_testing(
            claim_id,
            committee_id,
            profile_id,
            OWNER,
            1,
            hash(1),
            true,
            10,
            20,
            ctx,
        );
        let tally = jury::new_tally_for_testing(
            claim_id,
            committee_id,
            1,
            hash(1),
            vector[jury::jury_seat_id(&seat)],
            ctx,
        );
        let cap = agent_registry::new_agent_cap_for_testing(profile_id, ctx);
        (seat, tally, cap)
    }

    fun commitment_for(
        seat: &jury::JurySeat,
        outcome: u8,
        confidence: u16,
    ): vector<u8> {
        let preimage = jury::new_vote_preimage(
            object::id_from_address(@0xC1A1),
            jury::jury_seat_profile_id(seat),
            jury::jury_seat_id(seat),
            1,
            outcome,
            confidence,
            hash(1),
            hash(2),
            hash(3),
            b"salt",
        );
        jury::compute_commitment(&preimage)
    }

    #[test]
    fun commitment_is_blake2b_32_bytes() {
        let preimage = jury::new_vote_preimage(
            object::id_from_address(@0x1),
            object::id_from_address(@0x2),
            object::id_from_address(@0x3),
            1,
            claim::outcome_yes(),
            9_001,
            hash(1),
            hash(2),
            hash(3),
            b"salt",
        );
        let commitment = jury::compute_commitment(&preimage);
        assert!(commitment.length() == 32);
    }

    #[test]
    fun commit_reveal_match_freezes_vote_and_updates_tally() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        assert!(jury::tally_commit_count(&tally) == 1);
        clock::set_for_testing(&mut clock, 1);
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
        assert!(jury::tally_reveal_count(&tally) == 1);
        assert!(jury::tally_yes_count(&tally) == 1);
        assert!(*jury::truth_score_bps(&tally).borrow() == 9_000);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_COMMITMENT_MISMATCH)]
    fun reveal_mismatch_aborts() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        clock::set_for_testing(&mut clock, 11);
        jury::reveal_vote(
            seat,
            &mut tally,
            &cap,
            claim::outcome_no(),
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
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_CAP_MISMATCH)]
    fun unauthorized_cap_aborts() {
        let mut scenario = test_scenario::begin(OWNER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, tally, cap) = make_seat_and_tally(scenario.ctx());
        let wrong = agent_registry::new_agent_cap_for_testing(
            object::id_from_address(@0xBAD),
            scenario.ctx(),
        );
        jury::accept_jury_seat(&mut seat, &wrong, &clock);
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        agent_registry::destroy_agent_cap_for_testing(wrong);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_DUPLICATE_REVEAL)]
    fun duplicate_seat_is_rejected() {
        let mut scenario = test_scenario::begin(OWNER);
        let (seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let seat_id = *jury::expected_seat_ids(&tally).borrow(0);
        jury::record_reveal_for_testing(
            &mut tally,
            seat_id,
            object::id_from_address(@0x701),
            claim::outcome_yes(),
            8_000,
        );
        jury::record_reveal_for_testing(
            &mut tally,
            seat_id,
            object::id_from_address(@0x702),
            claim::outcome_yes(),
            8_000,
        );
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_SEAT_MISMATCH)]
    fun run_approval_is_bound_to_one_seat() {
        let mut scenario = test_scenario::begin(OWNER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let other = jury::new_seat_for_testing(
            object::id_from_address(@0xC1A1),
            object::id_from_address(@0xC011),
            jury::jury_seat_profile_id(&seat),
            OWNER,
            1,
            hash(1),
            true,
            10,
            20,
            scenario.ctx(),
        );
        let approval = jury::new_run_approval_for_testing(&other, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, hash(9), &clock);
        jury::destroy_seat_for_testing(seat);
        jury::destroy_seat_for_testing(other);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun all_committed_reveal_at_commit_deadline_succeeds() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        assert!(jury::all_seats_committed(&tally));
        clock::set_for_testing(&mut clock, 10);
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
        assert!(jury::tally_reveal_count(&tally) == 1);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_REVEAL_NOT_OPEN)]
    fun partial_commit_reveal_at_commit_deadline_aborts() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, tally, cap) = make_seat_and_tally(scenario.ctx());
        jury::destroy_tally_for_testing(tally);
        let mut tally = jury::new_tally_for_testing(
            object::id_from_address(@0xC1A1),
            object::id_from_address(@0xC011),
            1,
            hash(1),
            vector[jury::jury_seat_id(&seat), object::id_from_address(@0x5EA7)],
            scenario.ctx(),
        );
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        assert!(jury::tally_commit_count(&tally) == 1);
        assert!(!jury::all_seats_committed(&tally));
        clock::set_for_testing(&mut clock, 10);
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
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun commit_deadline_fallback_opens_reveal_with_uncommitted_seat() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, tally, cap) = make_seat_and_tally(scenario.ctx());
        jury::destroy_tally_for_testing(tally);
        let mut tally = jury::new_tally_for_testing(
            object::id_from_address(@0xC1A1),
            object::id_from_address(@0xC011),
            1,
            hash(1),
            vector[jury::jury_seat_id(&seat), object::id_from_address(@0x5EA7)],
            scenario.ctx(),
        );
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        clock::set_for_testing(&mut clock, 11);
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
        assert!(jury::tally_reveal_count(&tally) == 1);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_DEADLINE_PASSED)]
    fun reveal_one_ms_late_aborts() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        clock::set_for_testing(&mut clock, 21);
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
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun threshold_requires_four_of_five() {
        let mut scenario = test_scenario::begin(OWNER);
        let ids = vector[
            object::id_from_address(@0x11),
            object::id_from_address(@0x12),
            object::id_from_address(@0x13),
            object::id_from_address(@0x14),
            object::id_from_address(@0x15),
        ];
        let mut tally = jury::new_tally_for_testing(
            object::id_from_address(@0xC1),
            object::id_from_address(@0xC2),
            1,
            hash(1),
            ids,
            scenario.ctx(),
        );
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 3) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0x21 else if (i == 1) @0x22 else @0x23),
                claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        assert!(jury::threshold_outcome(&tally) == claim::outcome_none());
        jury::record_reveal_for_testing(
            &mut tally,
            expected[3],
            object::id_from_address(@0x24),
            claim::outcome_yes(),
            9_000,
        );
        assert!(jury::threshold_outcome(&tally) == claim::outcome_yes());
        jury::destroy_tally_for_testing(tally);
        scenario.end();
    }

    #[test]
    fun truth_score_vectors_and_half_up_rounding() {
        let mut scenario = test_scenario::begin(OWNER);
        let ids = vector[
            object::id_from_address(@0x31),
            object::id_from_address(@0x32),
            object::id_from_address(@0x33),
            object::id_from_address(@0x34),
            object::id_from_address(@0x35),
        ];
        let mut tally = jury::new_tally_for_testing(
            object::id_from_address(@0xC3),
            object::id_from_address(@0xC4),
            1,
            hash(1),
            ids,
            scenario.ctx(),
        );
        assert!(jury::truth_score_bps(&tally).is_none());
        let expected = *jury::expected_seat_ids(&tally);
        jury::record_reveal_for_testing(
            &mut tally,
            expected[0],
            object::id_from_address(@0x41),
            claim::outcome_yes(),
            5_000,
        );
        jury::record_reveal_for_testing(
            &mut tally,
            expected[1],
            object::id_from_address(@0x42),
            claim::outcome_yes(),
            5_001,
        );
        assert!(*jury::truth_score_bps(&tally).borrow() == 5_001);
        jury::record_reveal_for_testing(
            &mut tally,
            expected[2],
            object::id_from_address(@0x43),
            claim::outcome_no(),
            8_000,
        );
        jury::record_reveal_for_testing(
            &mut tally,
            expected[3],
            object::id_from_address(@0x44),
            claim::outcome_unsure(),
            10_000,
        );
        // (5000 + 5001 + 2000 + 5000 + 2) / 4 = 4250.
        assert!(*jury::truth_score_bps(&tally).borrow() == 4_250);
        jury::destroy_tally_for_testing(tally);
        scenario.end();
    }

    #[test]
    fun commitment_matches_typescript_parity_vector() {
        let preimage = jury::new_vote_preimage(
            object::id_from_address(@0x1),
            object::id_from_address(@0x2),
            object::id_from_address(@0x3),
            1,
            claim::outcome_yes(),
            9_001,
            hash(1),
            hash(2),
            hash(3),
            b"salt",
        );
        let expected = vector[
            174, 207, 59, 12, 142, 92, 199, 12,
            229, 251, 203, 168, 192, 10, 22, 186,
            64, 48, 139, 3, 205, 156, 237, 155,
            118, 169, 240, 141, 247, 8, 101, 206,
        ];
        assert!(jury::compute_commitment(&preimage) == expected);
    }

    #[test]
    fun commit_and_reveal_deadlines_are_inclusive_at_exact_end() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let commitment = commitment_for(&seat, claim::outcome_yes(), 9_000);
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        clock::set_for_testing(&mut clock, 10);
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, commitment, &clock);
        clock::set_for_testing(&mut clock, 20);
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
        assert!(jury::tally_reveal_count(&tally) == 1);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_DEADLINE_PASSED)]
    fun commit_one_ms_late_aborts() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let approval = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        clock::set_for_testing(&mut clock, 11);
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, hash(9), &clock);
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_UNEXPECTED_SEAT)]
    fun tally_rejects_unexpected_seat_id() {
        let mut scenario = test_scenario::begin(OWNER);
        let (seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        jury::record_reveal_for_testing(
            &mut tally,
            object::id_from_address(@0xBAD),
            object::id_from_address(@0x701),
            claim::outcome_yes(),
            8_000,
        );
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_INVALID_SEAT_STATUS)]
    fun second_run_approval_cannot_recommit_same_seat() {
        let mut scenario = test_scenario::begin(OWNER);
        let clock = clock::create_for_testing(scenario.ctx());
        let (mut seat, mut tally, cap) = make_seat_and_tally(scenario.ctx());
        let first = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        let second = jury::new_run_approval_for_testing(&seat, hash(3), scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, first, hash(9), &clock);
        jury::commit_vote(&mut seat, &mut tally, &cap, second, hash(8), &clock);
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun five_real_commit_reveals_produce_four_one_threshold() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut clock = clock::create_for_testing(scenario.ctx());
        let claim_id = object::id_from_address(@0xD1);
        let committee_id = object::id_from_address(@0xD2);
        let minority_profile = object::id_from_address(@0xD15);
        let mut seats = vector[];
        let mut expected = vector[];
        let mut i = 0;
        while (i < 5) {
            let profile_id = object::id_from_address(
                if (i == 0) @0xD11 else if (i == 1) @0xD12 else if (i == 2) @0xD13 else if (i == 3) @0xD14 else @0xD15,
            );
            let seat = jury::new_seat_for_testing(
                claim_id,
                committee_id,
                profile_id,
                OWNER,
                1,
                hash(1),
                true,
                10,
                20,
                scenario.ctx(),
            );
            expected.push_back(jury::jury_seat_id(&seat));
            seats.push_back(seat);
            i = i + 1;
        };
        let mut tally = jury::new_tally_for_testing(
            claim_id,
            committee_id,
            1,
            hash(1),
            expected,
            scenario.ctx(),
        );
        let mut committed = vector[];
        while (!seats.is_empty()) {
            let mut seat = seats.pop_back();
            let cap = agent_registry::new_agent_cap_for_testing(
                jury::jury_seat_profile_id(&seat),
                scenario.ctx(),
            );
            let outcome = if (jury::jury_seat_profile_id(&seat) == minority_profile) {
                claim::outcome_no()
            } else {
                claim::outcome_yes()
            };
            let preimage = jury::new_vote_preimage(
                claim_id,
                jury::jury_seat_profile_id(&seat),
                jury::jury_seat_id(&seat),
                1,
                outcome,
                9_000,
                hash(1),
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
            agent_registry::destroy_agent_cap_for_testing(cap);
            committed.push_back(seat);
        };

        clock::set_for_testing(&mut clock, 11);
        while (!committed.is_empty()) {
            let seat = committed.pop_back();
            let cap = agent_registry::new_agent_cap_for_testing(
                jury::jury_seat_profile_id(&seat),
                scenario.ctx(),
            );
            let outcome = if (jury::jury_seat_profile_id(&seat) == minority_profile) {
                claim::outcome_no()
            } else {
                claim::outcome_yes()
            };
            jury::reveal_vote(
                seat,
                &mut tally,
                &cap,
                outcome,
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
        };
        assert!(jury::threshold_outcome(&tally) == claim::outcome_yes());
        assert!(jury::tally_yes_count(&tally) == 4);
        assert!(jury::tally_no_count(&tally) == 1);
        assert!(*jury::truth_score_bps(&tally).borrow() == 7_400);
        seats.destroy_empty();
        committed.destroy_empty();
        jury::destroy_tally_for_testing(tally);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun truth_score_all_yes_all_no_unsure_and_missing_vectors() {
        let mut scenario = test_scenario::begin(OWNER);
        let expected = vector[
            object::id_from_address(@0xE1),
            object::id_from_address(@0xE2),
            object::id_from_address(@0xE3),
            object::id_from_address(@0xE4),
            object::id_from_address(@0xE5),
        ];
        let mut all_yes = jury::new_tally_for_testing(
            object::id_from_address(@0xE10),
            object::id_from_address(@0xE11),
            1,
            hash(1),
            expected,
            scenario.ctx(),
        );
        let mut all_no = jury::new_tally_for_testing(
            object::id_from_address(@0xE20),
            object::id_from_address(@0xE21),
            1,
            hash(1),
            expected,
            scenario.ctx(),
        );
        let mut all_unsure = jury::new_tally_for_testing(
            object::id_from_address(@0xE30),
            object::id_from_address(@0xE31),
            1,
            hash(1),
            expected,
            scenario.ctx(),
        );
        let mut i = 0;
        while (i < 5) {
            jury::record_reveal_for_testing(
                &mut all_yes,
                expected[i],
                object::id_from_address(if (i == 0) @0xF1 else if (i == 1) @0xF2 else if (i == 2) @0xF3 else if (i == 3) @0xF4 else @0xF5),
                claim::outcome_yes(),
                10_000,
            );
            jury::record_reveal_for_testing(
                &mut all_no,
                expected[i],
                object::id_from_address(if (i == 0) @0xF11 else if (i == 1) @0xF12 else if (i == 2) @0xF13 else if (i == 3) @0xF14 else @0xF15),
                claim::outcome_no(),
                10_000,
            );
            jury::record_reveal_for_testing(
                &mut all_unsure,
                expected[i],
                object::id_from_address(if (i == 0) @0xF21 else if (i == 1) @0xF22 else if (i == 2) @0xF23 else if (i == 3) @0xF24 else @0xF25),
                claim::outcome_unsure(),
                0,
            );
            i = i + 1;
        };
        assert!(*jury::truth_score_bps(&all_yes).borrow() == 10_000);
        assert!(*jury::truth_score_bps(&all_no).borrow() == 0);
        assert!(*jury::truth_score_bps(&all_unsure).borrow() == 5_000);

        let mut missing = jury::new_tally_for_testing(
            object::id_from_address(@0xE40),
            object::id_from_address(@0xE41),
            1,
            hash(1),
            expected,
            scenario.ctx(),
        );
        jury::record_reveal_for_testing(
            &mut missing,
            expected[0],
            object::id_from_address(@0xF31),
            claim::outcome_yes(),
            7_500,
        );
        assert!(*jury::truth_score_bps(&missing).borrow() == 7_500);
        jury::destroy_tally_for_testing(all_yes);
        jury::destroy_tally_for_testing(all_no);
        jury::destroy_tally_for_testing(all_unsure);
        jury::destroy_tally_for_testing(missing);
        scenario.end();
    }

    #[test]
    fun declined_seat_is_consumed_by_diversity_safe_reserve_replacement() {
        let mut scenario = test_scenario::begin(OWNER);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let params = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            10,
            20,
            30,
            40,
            50,
            60,
            70,
            10,
            80,
            10,
        );
        let mut claim = claim::new_claim_for_testing(
            &registry,
            coin::mint_for_testing<jury::JuryTestCoin>(100, scenario.ctx()),
            params,
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let profiles = vector[
            object::id_from_address(@0x101),
            object::id_from_address(@0x102),
            object::id_from_address(@0x103),
            object::id_from_address(@0x104),
            object::id_from_address(@0x105),
        ];
        let owners = vector[OWNER, @0xA2, @0xA3, @0xA4, @0xA5];
        let mut committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles,
            owners,
            false,
            scenario.ctx(),
        );
        let seat = jury::new_seat_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            profiles[0],
            OWNER,
            1,
            vector[],
            false,
            30,
            40,
            scenario.ctx(),
        );
        let declined_id = jury::jury_seat_id(&seat);
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            vector[],
            vector[
                declined_id,
                object::id_from_address(@0x202),
                object::id_from_address(@0x203),
                object::id_from_address(@0x204),
                object::id_from_address(@0x205),
            ],
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        let cap = agent_registry::new_agent_cap_for_testing(profiles[0], scenario.ctx());
        jury::decline_jury_seat(seat, &cap, &clock);
        agent_registry::destroy_agent_cap_for_testing(cap);

        test_scenario::next_tx(&mut scenario, OWNER);
        let declined = test_scenario::take_from_sender<jury::JurySeat>(&scenario);
        jury::replace_declined_seat(
            &claim,
            &mut committee,
            &mut tally,
            declined,
            0,
            &clock,
            scenario.ctx(),
        );
        assert!(jury::committee_reserve_count(&committee) == 1);
        assert!(jury::expected_seat_ids(&tally)[0] != declined_id);
        assert!(jury::committee_profiles(&committee)[0] == object::id_from_address(@0x9001));
        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun reserve_replacement_carries_its_payout_recipient_into_the_seat() {
        let mut scenario = test_scenario::begin(OWNER);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let params = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            10,
            20,
            30,
            40,
            50,
            60,
            70,
            10,
            80,
            10,
        );
        let mut claim = claim::new_claim_for_testing(
            &registry,
            coin::mint_for_testing<jury::JuryTestCoin>(100, scenario.ctx()),
            params,
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let profiles = vector[
            object::id_from_address(@0x101),
            object::id_from_address(@0x102),
            object::id_from_address(@0x103),
            object::id_from_address(@0x104),
            object::id_from_address(@0x105),
        ];
        let owners = vector[OWNER, @0xA2, @0xA3, @0xA4, @0xA5];
        let mut committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            profiles,
            owners,
            false,
            scenario.ctx(),
        );
        // Seat one and reserve one are staked seats; the rest pay their owners.
        jury::set_committee_payouts_for_testing(
            &mut committee,
            vector[@0x57A6E, @0xA2, @0xA3, @0xA4, @0xA5],
            vector[@0x57A6F, @0xA7],
        );
        let seat = jury::new_seat_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            profiles[0],
            OWNER,
            1,
            vector[],
            false,
            30,
            40,
            scenario.ctx(),
        );
        let declined_id = jury::jury_seat_id(&seat);
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            vector[],
            vector[
                declined_id,
                object::id_from_address(@0x202),
                object::id_from_address(@0x203),
                object::id_from_address(@0x204),
                object::id_from_address(@0x205),
            ],
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        let cap = agent_registry::new_agent_cap_for_testing(profiles[0], scenario.ctx());
        jury::decline_jury_seat(seat, &cap, &clock);
        agent_registry::destroy_agent_cap_for_testing(cap);
        assert!(jury::payout_recipient_for_expected_index(&committee, 0) == @0x57A6E);

        test_scenario::next_tx(&mut scenario, OWNER);
        let declined = test_scenario::take_from_sender<jury::JurySeat>(&scenario);
        jury::replace_declined_seat(
            &claim,
            &mut committee,
            &mut tally,
            declined,
            0,
            &clock,
            scenario.ctx(),
        );
        // The seat now belongs to the reserve, and so does its reward.
        assert!(jury::owner_for_expected_index(&committee, 0) == @0xA6);
        assert!(jury::payout_recipient_for_expected_index(&committee, 0) == @0x57A6F);
        let mut i = 1;
        while (i < 5) {
            assert!(
                jury::payout_recipient_for_expected_index(&committee, i)
                    == jury::owner_for_expected_index(&committee, i),
            );
            i = i + 1;
        };
        assert!(claim::destroy_claim_for_testing(claim) == 100);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun committee_lock_is_one_way() {
        let mut scenario = test_scenario::begin(OWNER);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let params = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            10,
            20,
            30,
            40,
            50,
            60,
            70,
            10,
            80,
            10,
        );
        let mut claim = claim::new_claim_for_testing(
            &registry,
            coin::mint_for_testing<jury::JuryTestCoin>(100, scenario.ctx()),
            params,
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let mut committee = jury::new_committee_for_testing(
            claim::claim_id(&claim),
            vector[
                object::id_from_address(@0x101),
                object::id_from_address(@0x102),
                object::id_from_address(@0x103),
                object::id_from_address(@0x104),
                object::id_from_address(@0x105),
            ],
            vector[OWNER, @0xA2, @0xA3, @0xA4, @0xA5],
            false,
            scenario.ctx(),
        );
        let tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            jury::committee_id(&committee),
            1,
            vector[],
            vector[
                object::id_from_address(@0x201),
                object::id_from_address(@0x202),
                object::id_from_address(@0x203),
                object::id_from_address(@0x204),
                object::id_from_address(@0x205),
            ],
            scenario.ctx(),
        );
        claim::link_committee(&mut claim, jury::committee_id(&committee), jury::tally_id(&tally));
        jury::lock_committee(&claim, &mut committee, &tally, &clock);
        assert!(jury::committee_locked(&committee));
        claim::destroy_claim_for_testing(claim);
        jury::destroy_tally_for_testing(tally);
        jury::destroy_committee_for_testing(committee);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::jury::E_CONSENSUS_REACHED)]
    fun threshold_round_cannot_be_forced_into_discussion() {
        let mut scenario = test_scenario::begin(OWNER);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let params = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            10,
            20,
            30,
            40,
            50,
            60,
            70,
            10,
            80,
            10,
        );
        let mut claim = claim::new_claim_for_testing(
            &registry,
            coin::mint_for_testing<jury::JuryTestCoin>(100, scenario.ctx()),
            params,
            &clock,
            scenario.ctx(),
        );
        claim::start_direct_review(&registry, &mut claim, &clock);
        let mut tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            object::id_from_address(@0xF01),
            1,
            hash(1),
            vector[
                object::id_from_address(@0xF11),
                object::id_from_address(@0xF12),
                object::id_from_address(@0xF13),
                object::id_from_address(@0xF14),
                object::id_from_address(@0xF15),
            ],
            scenario.ctx(),
        );
        claim::link_committee(
            &mut claim,
            object::id_from_address(@0xF01),
            jury::tally_id(&tally),
        );
        let expected = *jury::expected_seat_ids(&tally);
        let mut i = 0;
        while (i < 4) {
            jury::record_reveal_for_testing(
                &mut tally,
                expected[i],
                object::id_from_address(if (i == 0) @0xF21 else if (i == 1) @0xF22 else if (i == 2) @0xF23 else @0xF24),
                claim::outcome_yes(),
                9_000,
            );
            i = i + 1;
        };
        claim::set_state_for_testing(&mut claim, claim::state_reveal_1());
        clock::set_for_testing(&mut clock, 41);
        jury::open_discussion(&mut claim, &mut tally, &clock);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun attestor_approval_is_transferred_then_consumed_by_matching_commit() {
        let mut scenario = test_scenario::begin(OWNER);
        let clock = clock::create_for_testing(scenario.ctx());
        let attestor = agent_registry::new_run_attestor_cap_for_testing(scenario.ctx());
        let profile_id = object::id_from_address(@0xAA01);
        let mut seat = jury::new_seat_for_testing(
            object::id_from_address(@0xAA02),
            object::id_from_address(@0xAA03),
            profile_id,
            OWNER,
            1,
            hash(1),
            true,
            10,
            20,
            scenario.ctx(),
        );
        let mut tally = jury::new_tally_for_testing(
            object::id_from_address(@0xAA02),
            object::id_from_address(@0xAA03),
            1,
            hash(1),
            vector[jury::jury_seat_id(&seat)],
            scenario.ctx(),
        );
        jury::approve_run(
            &attestor,
            object::id_from_address(@0xAA02),
            object::id_from_address(@0xAA03),
            jury::jury_seat_id(&seat),
            profile_id,
            OWNER,
            1,
            hash(3),
            b"run",
            object::id_from_address(@0xAA04),
            b"tool",
            object::id_from_address(@0xAA05),
            10,
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, OWNER);
        let approval = test_scenario::take_from_sender<jury::RunApproval>(&scenario);
        let cap = agent_registry::new_agent_cap_for_testing(profile_id, scenario.ctx());
        jury::commit_vote(&mut seat, &mut tally, &cap, approval, hash(9), &clock);
        assert!(jury::jury_seat_status(&seat) == 2);
        jury::destroy_seat_for_testing(seat);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_agent_cap_for_testing(cap);
        agent_registry::destroy_run_attestor_cap_for_testing(attestor);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
}

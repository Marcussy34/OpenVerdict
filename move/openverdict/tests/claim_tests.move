#[test_only]
module openverdict::claim_tests {
    use openverdict::agent_registry;
    use openverdict::claim;
    use openverdict::jury;
    use sui::clock;
    use sui::coin;
    use sui::test_scenario;

    const CREATOR: address = @0xA11CE;
    const PROPOSER: address = @0xB0B;
    const TREASURY: address = @0x7EA5;
    const UPDATED_TREASURY: address = @0x7EA6;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    public struct TestCoin has drop {}

    fun params(mode: u8): claim::ClaimParams {
        claim::new_claim_params(mode, 10, 20, 30, 40, 50, 60, 70, 10, 80, 10)
    }

    fun link_phase_one_tally<T>(
        claim: &mut claim::Claim<T>,
        ctx: &mut TxContext,
    ): jury::RoundTally {
        let committee_id = object::id_from_address(@0xC011);
        let tally = jury::new_tally_for_testing(
            claim::claim_id(claim),
            committee_id,
            1,
            vector[],
            vector[object::id_from_address(@0x5EA7)],
            ctx,
        );
        claim::link_committee(claim, committee_id, jury::tally_id(&tally));
        tally
    }

    #[test]
    fun creation_validates_and_preserves_balance() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );

        assert!(claim::state(&claim) == claim::state_created());
        assert!(claim::total_balance(&claim) == 100);
        assert!(claim::destroy_claim_for_testing(claim) == 100);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun claim_snapshots_treasury_policy_at_creation() {
        let mut scenario = test_scenario::begin(CREATOR);
        agent_registry::init_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, CREATOR);
        let mut registry = test_scenario::take_shared<agent_registry::Registry>(&scenario);
        let admin_cap = test_scenario::take_from_sender<agent_registry::AdminCap>(&scenario);
        agent_registry::set_treasury_policy(&mut registry, &admin_cap, TREASURY, 1_000);
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );

        agent_registry::set_treasury_policy(
            &mut registry,
            &admin_cap,
            UPDATED_TREASURY,
            0,
        );
        assert!(claim::treasury(&claim) == TREASURY);
        assert!(claim::protocol_fee_bps(&claim) == 1_000);
        assert!(agent_registry::treasury(&registry) == UPDATED_TREASURY);
        assert!(agent_registry::protocol_fee_bps(&registry) == 0);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, admin_cap);
        test_scenario::return_shared(registry);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_INVALID_DEADLINES)]
    fun creation_rejects_unsorted_deadlines() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let bad = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            10,
            20,
            20,
            40,
            50,
            60,
            70,
            10,
            80,
            10,
        );
        let claim = claim::new_claim_for_testing(&registry, budget, bad, &clock, scenario.ctx());
        claim::destroy_claim_for_testing(claim);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun direct_review_has_no_parties() {
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
        claim::start_direct_review(&registry, &mut claim, &clock);
        assert!(claim::state(&claim) == claim::state_review_requested());
        assert!(claim::proposer(&claim).is_none());
        assert!(claim::challenger(&claim).is_none());
        claim::destroy_claim_for_testing(claim);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun proposal_deadline_is_inclusive() {
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
        clock::set_for_testing(&mut clock, 10);
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
        assert!(claim::state(&claim) == claim::state_proposed());
        assert!(claim::total_balance(&claim) == 125);
        claim::destroy_claim_for_testing(claim);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_DEADLINE_PASSED)]
    fun proposal_rejects_one_ms_late() {
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
        clock::set_for_testing(&mut clock, 11);
        let bond = coin::mint_for_testing<TestCoin>(25, scenario.ctx());
        claim::propose_outcome(
            &registry,
            &mut claim,
            bond,
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_INVALID_STATE)]
    fun illegal_transition_rejects_second_direct_start() {
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
        claim::start_direct_review(&registry, &mut claim, &clock);
        claim::start_direct_review(&registry, &mut claim, &clock);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun challenge_one_ms_before_deadline_succeeds() {
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
        clock::set_for_testing(&mut clock, 9);
        claim::propose_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, PROPOSER);
        clock::set_for_testing(&mut clock, 19);
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            vector::tabulate!(32, |_| 8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        assert!(claim::state(&claim) == claim::state_challenged());
        assert!(claim::destroy_claim_for_testing(claim) == 150);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun challenge_at_exact_deadline_succeeds() {
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
        test_scenario::next_tx(&mut scenario, PROPOSER);
        clock::set_for_testing(&mut clock, 20);
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            vector::tabulate!(32, |_| 8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        assert!(claim::state(&claim) == claim::state_challenged());
        assert!(claim::destroy_claim_for_testing(claim) == 150);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_DEADLINE_PASSED)]
    fun challenge_one_ms_late_aborts() {
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
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            vector::tabulate!(32, |_| 8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_INVALID_STATE)]
    fun challenge_before_proposal_aborts() {
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
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            vector::tabulate!(32, |_| 8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_DEADLINE_NOT_REACHED)]
    fun phase_advance_at_exact_commit_deadline_aborts() {
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
        let tally = link_phase_one_tally(&mut claim, scenario.ctx());
        clock::set_for_testing(&mut clock, 30);
        let readiness = jury::phase_readiness(&tally, scenario.ctx());
        claim::advance_phase(&mut claim, readiness, &clock);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun phase_advance_one_ms_after_commit_deadline_succeeds() {
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
        let tally = link_phase_one_tally(&mut claim, scenario.ctx());
        clock::set_for_testing(&mut clock, 31);
        let readiness = jury::phase_readiness(&tally, scenario.ctx());
        claim::advance_phase(&mut claim, readiness, &clock);
        assert!(claim::state(&claim) == claim::state_reveal_1());
        claim::destroy_claim_for_testing(claim);
        jury::destroy_tally_for_testing(tally);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_INVALID_STATE)]
    fun phase_advance_rejects_readiness_for_another_tally() {
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
        claim::start_direct_review(&registry, &mut claim, &clock);
        let active_tally = link_phase_one_tally(&mut claim, scenario.ctx());
        let other_tally = jury::new_tally_for_testing(
            claim::claim_id(&claim),
            object::id_from_address(@0xC011),
            1,
            vector[],
            vector[object::id_from_address(@0x5EA8)],
            scenario.ctx(),
        );
        let readiness = jury::phase_readiness(&other_tally, scenario.ctx());
        claim::advance_phase(&mut claim, readiness, &clock);
        jury::destroy_tally_for_testing(active_tally);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_INVALID_BUDGET)]
    fun creation_rejects_budget_partition_mismatch() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(99, scenario.ctx());
        let claim = claim::new_claim_for_testing(
            &registry,
            budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        claim::destroy_claim_for_testing(claim);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_PARTY_CONFLICT)]
    fun proposer_cannot_self_challenge() {
        let mut scenario = test_scenario::begin(PROPOSER);
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
        claim::propose_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        claim::challenge_outcome(
            &registry,
            &mut claim,
            coin::mint_for_testing<TestCoin>(25, scenario.ctx()),
            vector::tabulate!(32, |_| 8),
            b"reason",
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }
}

#[test_only]
module openverdict::demo_tests {
    use openverdict::agent_registry;
    use openverdict::claim;
    use openverdict::demo_binary_pool;
    use openverdict::demo_fact_checker;
    use openverdict::jury;
    use sui::clock;
    use sui::coin::{Self, Coin};
    use sui::test_scenario;

    const CREATOR: address = @0xC0FFEE;
    const YES_USER: address = @0xA11CE;
    const NO_USER: address = @0xB0B;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    public struct TestCoin has drop {}

    fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    fun params(mode: u8): claim::ClaimParams {
        claim::new_claim_params(mode, 10, 20, 30, 40, 50, 60, 70, 10, 80, 10)
    }

    #[test]
    fun direct_fact_checker_shares_review_requested_claim_without_parties() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        demo_fact_checker::start_fact_check(
            &registry,
            budget,
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
            hash(1),
            b"statement",
            b"criteria",
            b"policy",
            &clock,
            scenario.ctx(),
        );
        test_scenario::next_tx(&mut scenario, CREATOR);
        let fact_check = test_scenario::take_shared<claim::Claim<TestCoin>>(&scenario);
        assert!(claim::mode(&fact_check) == claim::claim_mode_direct_review());
        assert!(claim::state(&fact_check) == claim::state_review_requested());
        assert!(claim::proposer(&fact_check).is_none());
        assert!(claim::challenger(&fact_check).is_none());
        assert!(claim::total_balance(&fact_check) == 100);
        test_scenario::return_shared(fact_check);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_PAUSED)]
    fun pause_blocks_new_direct_fact_check() {
        let mut scenario = test_scenario::begin(CREATOR);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        agent_registry::pause(&mut registry, &pause_cap);
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        demo_fact_checker::start_fact_check(
            &registry,
            budget,
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
            hash(1),
            b"statement",
            b"criteria",
            b"policy",
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun binary_pool_yes_winner_receives_full_pool() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let claim_budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let claim = claim::new_claim_for_testing(
            &registry,
            claim_budget,
            params(claim::claim_mode_optimistic_settlement()),
            &clock,
            scenario.ctx(),
        );
        demo_binary_pool::create_pool(
            &registry,
            &claim,
            claim::protocol_version(&claim),
            10,
            &clock,
            scenario.ctx(),
        );

        test_scenario::next_tx(&mut scenario, YES_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        demo_binary_pool::enter(
            &registry,
            &mut pool,
            coin::mint_for_testing<TestCoin>(40, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_shared(pool);

        test_scenario::next_tx(&mut scenario, NO_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        clock::set_for_testing(&mut clock, 10);
        demo_binary_pool::enter(
            &registry,
            &mut pool,
            coin::mint_for_testing<TestCoin>(60, scenario.ctx()),
            claim::outcome_no(),
            &clock,
            scenario.ctx(),
        );
        jury::create_resolution_certificate(
            claim::claim_id(&claim),
            claim::protocol_version(&claim),
            claim::outcome_yes(),
            option::some(7_500),
            option::none(),
            vector[],
            vector[],
            11,
            scenario.ctx(),
        );
        test_scenario::return_shared(pool);

        test_scenario::next_tx(&mut scenario, CREATOR);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let certificate = test_scenario::take_immutable<jury::ResolutionCertificate>(&scenario);
        clock::set_for_testing(&mut clock, 11);
        demo_binary_pool::settle_pool(&mut pool, &certificate, &clock);
        assert!(demo_binary_pool::pool_settled(&pool));
        test_scenario::return_immutable(certificate);
        test_scenario::return_shared(pool);

        test_scenario::next_tx(&mut scenario, YES_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let yes_position = test_scenario::take_from_sender<demo_binary_pool::Position<TestCoin>>(&scenario);
        demo_binary_pool::redeem(&mut pool, yes_position, scenario.ctx());
        test_scenario::return_shared(pool);
        test_scenario::next_tx(&mut scenario, YES_USER);
        let yes_payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        assert!(coin::burn_for_testing(yes_payout) == 100);

        test_scenario::next_tx(&mut scenario, NO_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let no_position = test_scenario::take_from_sender<demo_binary_pool::Position<TestCoin>>(&scenario);
        demo_binary_pool::redeem(&mut pool, no_position, scenario.ctx());
        assert!(demo_binary_pool::pool_balance(&pool) == 0);
        test_scenario::return_shared(pool);
        test_scenario::next_tx(&mut scenario, NO_USER);
        let no_payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        assert!(coin::burn_for_testing(no_payout) == 0);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun binary_pool_unresolved_refunds_each_position() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let claim_budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let claim = claim::new_claim_for_testing(
            &registry,
            claim_budget,
            params(claim::claim_mode_direct_review()),
            &clock,
            scenario.ctx(),
        );
        demo_binary_pool::create_pool(
            &registry,
            &claim,
            claim::protocol_version(&claim),
            10,
            &clock,
            scenario.ctx(),
        );

        test_scenario::next_tx(&mut scenario, YES_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        demo_binary_pool::enter(
            &registry,
            &mut pool,
            coin::mint_for_testing<TestCoin>(40, scenario.ctx()),
            claim::outcome_yes(),
            &clock,
            scenario.ctx(),
        );
        test_scenario::return_shared(pool);
        test_scenario::next_tx(&mut scenario, NO_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        demo_binary_pool::enter(
            &registry,
            &mut pool,
            coin::mint_for_testing<TestCoin>(60, scenario.ctx()),
            claim::outcome_no(),
            &clock,
            scenario.ctx(),
        );
        jury::create_resolution_certificate(
            claim::claim_id(&claim),
            claim::protocol_version(&claim),
            claim::result_unresolved(),
            option::some(5_000),
            option::none(),
            vector[],
            vector[],
            11,
            scenario.ctx(),
        );
        test_scenario::return_shared(pool);

        test_scenario::next_tx(&mut scenario, CREATOR);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let certificate = test_scenario::take_immutable<jury::ResolutionCertificate>(&scenario);
        clock::set_for_testing(&mut clock, 11);
        demo_binary_pool::settle_pool(&mut pool, &certificate, &clock);
        test_scenario::return_immutable(certificate);
        test_scenario::return_shared(pool);

        test_scenario::next_tx(&mut scenario, YES_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let position = test_scenario::take_from_sender<demo_binary_pool::Position<TestCoin>>(&scenario);
        demo_binary_pool::redeem(&mut pool, position, scenario.ctx());
        test_scenario::return_shared(pool);
        test_scenario::next_tx(&mut scenario, YES_USER);
        let payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        assert!(coin::burn_for_testing(payout) == 40);

        test_scenario::next_tx(&mut scenario, NO_USER);
        let mut pool = test_scenario::take_shared<demo_binary_pool::DemoBinaryPool<TestCoin>>(&scenario);
        let position = test_scenario::take_from_sender<demo_binary_pool::Position<TestCoin>>(&scenario);
        demo_binary_pool::redeem(&mut pool, position, scenario.ctx());
        assert!(demo_binary_pool::pool_balance(&pool) == 0);
        test_scenario::return_shared(pool);
        test_scenario::next_tx(&mut scenario, NO_USER);
        let payout = test_scenario::take_from_sender<Coin<TestCoin>>(&scenario);
        assert!(coin::burn_for_testing(payout) == 60);

        assert!(claim::destroy_claim_for_testing(claim) == 100);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
}

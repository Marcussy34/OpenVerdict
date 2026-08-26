#[test_only]
module openverdict::evidence_tests {
    use openverdict::agent_registry;
    use openverdict::claim;
    use openverdict::evidence;
    use sui::clock;
    use sui::coin;
    use sui::test_scenario;

    const CREATOR: address = @0xA11CE;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    public struct TestCoin has drop {}

    fun params(): claim::ClaimParams {
        claim::new_claim_params(
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
        )
    }

    #[test]
    fun freeze_links_bundle_once() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(&registry, budget, params(), &clock, scenario.ctx());
        claim::start_direct_review(&registry, &mut claim, &clock);
        evidence::freeze_evidence(
            &mut claim,
            &cap,
            1,
            vector::tabulate!(32, |_| 9),
            b"manifest",
            object::id_from_address(@0xB10B),
            2,
            b"policy",
            10,
            &clock,
            scenario.ctx(),
        );

        let effects = test_scenario::next_tx(&mut scenario, CREATOR);
        assert!(test_scenario::frozen(&effects).length() == 1);
        claim::destroy_claim_for_testing(claim);
        agent_registry::destroy_evidence_cap_for_testing(cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::evidence::E_INVALID_ROOT)]
    fun bundle_rejects_non_hash_root() {
        let mut scenario = test_scenario::begin(CREATOR);
        let cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let bundle = evidence::new_evidence_bundle(
            &cap,
            object::id_from_address(@0xCA11),
            1,
            b"short",
            b"manifest",
            object::id_from_address(@0xB10B),
            1,
            b"policy",
            1,
            scenario.ctx(),
        );
        evidence::destroy_bundle_for_testing(bundle);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::claim::E_ALREADY_LINKED)]
    fun second_phase_one_freeze_aborts() {
        let mut scenario = test_scenario::begin(CREATOR);
        let registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let cap = agent_registry::new_evidence_cap_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        let budget = coin::mint_for_testing<TestCoin>(100, scenario.ctx());
        let mut claim = claim::new_claim_for_testing(&registry, budget, params(), &clock, scenario.ctx());
        claim::start_direct_review(&registry, &mut claim, &clock);
        evidence::freeze_evidence(
            &mut claim,
            &cap,
            1,
            vector::tabulate!(32, |_| 1),
            b"one",
            object::id_from_address(@0xB101),
            1,
            b"policy",
            10,
            &clock,
            scenario.ctx(),
        );
        evidence::freeze_evidence(
            &mut claim,
            &cap,
            1,
            vector::tabulate!(32, |_| 2),
            b"two",
            object::id_from_address(@0xB102),
            1,
            b"policy",
            10,
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }
}

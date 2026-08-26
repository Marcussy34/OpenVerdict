#[test_only]
module openverdict::agent_registry_tests {
    use openverdict::agent_registry;
    use sui::clock;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario;

    const OWNER: address = @0xA11CE;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    #[test]
    fun init_creates_registry_and_all_operational_caps() {
        let mut scenario = test_scenario::begin(OWNER);
        agent_registry::init_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, OWNER);
        let registry = test_scenario::take_shared<agent_registry::Registry>(&scenario);
        assert!(agent_registry::registry_version(&registry) == 1);
        assert!(!agent_registry::registry_paused(&registry));
        assert!(test_scenario::has_most_recent_for_sender<agent_registry::AdminCap>(&scenario));
        assert!(test_scenario::has_most_recent_for_sender<agent_registry::PauseCap>(&scenario));
        assert!(test_scenario::has_most_recent_for_sender<agent_registry::EvidenceCap>(&scenario));
        assert!(test_scenario::has_most_recent_for_sender<agent_registry::RunAttestorCap>(&scenario));
        test_scenario::return_shared(registry);
        scenario.end();
    }

    #[test]
    fun registration_creates_profile_cap_and_bond() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        agent_registry::register_agent(
            &mut registry,
            coin::mint_for_testing<SUI>(10, scenario.ctx()),
            hash(1),
            b"manifest",
            hash(2),
            agent_registry::skeptic_role_hash(),
            hash(3),
            &clock,
            scenario.ctx(),
        );
        assert!(agent_registry::eligible_agent_count(&registry) == 1);
        test_scenario::next_tx(&mut scenario, OWNER);
        let cap = test_scenario::take_from_sender<agent_registry::AgentCap>(&scenario);
        let profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        assert!(agent_registry::cap_agent_profile_id(&cap) == agent_registry::agent_profile_id(&profile));
        assert!(agent_registry::agent_owner(&profile) == OWNER);
        assert!(agent_registry::agent_bond_value(&profile) == 10);
        test_scenario::return_to_sender(&scenario, cap);
        test_scenario::return_shared(profile);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_PAUSED)]
    fun pause_blocks_registration() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        agent_registry::pause(&mut registry, &pause_cap);
        agent_registry::register_agent(
            &mut registry,
            coin::mint_for_testing<SUI>(10, scenario.ctx()),
            hash(1),
            b"manifest",
            hash(2),
            agent_registry::skeptic_role_hash(),
            hash(3),
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_CAP_MISMATCH)]
    fun agent_cap_cannot_manage_another_profile() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let mut profile = agent_registry::new_agent_profile_for_testing(OWNER, 10, scenario.ctx());
        let wrong_cap = agent_registry::new_agent_cap_for_testing(
            object::id_from_address(@0xBAD),
            scenario.ctx(),
        );
        agent_registry::deprecate_agent(&mut registry, &mut profile, &wrong_cap);
        agent_registry::destroy_agent_profile_for_testing(profile);
        agent_registry::destroy_agent_cap_for_testing(wrong_cap);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun matured_bond_withdrawal_remains_available_while_paused() {
        let mut scenario = test_scenario::begin(OWNER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        let mut profile = agent_registry::new_agent_profile_for_testing(OWNER, 10, scenario.ctx());
        agent_registry::add_eligibility_for_testing(
            &mut registry,
            agent_registry::agent_profile_id(&profile),
            OWNER,
            hash(2),
            hash(3),
            agent_registry::skeptic_role_hash(),
        );
        let cap = agent_registry::new_agent_cap_for_testing(
            agent_registry::agent_profile_id(&profile),
            scenario.ctx(),
        );
        agent_registry::deprecate_agent(&mut registry, &mut profile, &cap);
        agent_registry::request_agent_bond_withdrawal(&registry, &mut profile, &cap, 4, &clock);
        agent_registry::pause(&mut registry, &pause_cap);
        clock::set_for_testing(&mut clock, 86_400_000);
        agent_registry::complete_agent_bond_withdrawal(
            &mut profile,
            &cap,
            &clock,
            scenario.ctx(),
        );
        assert!(agent_registry::agent_bond_value(&profile) == 6);
        test_scenario::next_tx(&mut scenario, OWNER);
        let withdrawn = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
        assert!(coin::burn_for_testing(withdrawn) == 4);
        assert!(agent_registry::destroy_agent_profile_for_testing(profile) == 6);
        agent_registry::destroy_agent_cap_for_testing(cap);
        agent_registry::destroy_pause_cap_for_testing(pause_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
}

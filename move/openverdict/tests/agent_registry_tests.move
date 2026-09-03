#[test_only]
module openverdict::agent_registry_tests {
    use openverdict::agent_registry;
    use sui::clock;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario;

    const OWNER: address = @0xA11CE;
    const STAKER: address = @0x57A6E;
    const OPERATOR: address = @0x0FE7A;
    const MIN_STAKE: u64 = 100_000_000;
    const E_UNEXPECTED_SUCCESS: u64 = 99;

    fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    /// One staked seat: STAKER posts the bond, OPERATOR runs the seat.
    fun stake_seat(
        registry: &mut agent_registry::Registry,
        clock: &clock::Clock,
        amount: u64,
        operational_owner: address,
        scenario: &mut test_scenario::Scenario,
    ) {
        agent_registry::register_staked_agent(
            registry,
            coin::mint_for_testing<SUI>(amount, scenario.ctx()),
            hash(1),
            b"manifest",
            hash(2),
            agent_registry::skeptic_role_hash(),
            hash(3),
            operational_owner,
            clock,
            scenario.ctx(),
        );
    }

    #[test]
    fun init_creates_registry_and_all_operational_caps() {
        let mut scenario = test_scenario::begin(OWNER);
        agent_registry::init_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, OWNER);
        let registry = test_scenario::take_shared<agent_registry::Registry>(&scenario);
        assert!(agent_registry::registry_version(&registry) == 1);
        assert!(!agent_registry::registry_paused(&registry));
        assert!(agent_registry::treasury(&registry) == OWNER);
        assert!(agent_registry::protocol_fee_bps(&registry) == 500);
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

    #[test]
    fun staked_registration_records_the_position_stake_and_payout_recipient() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);
        assert!(agent_registry::eligible_agent_count(&registry) == 1);
        assert!(agent_registry::min_stake_mist() == MIN_STAKE);

        test_scenario::next_tx(&mut scenario, STAKER);
        let position = test_scenario::take_from_sender<agent_registry::StakePosition>(&scenario);
        let profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        let profile_id = agent_registry::agent_profile_id(&profile);
        // The operational key runs the seat; the staker owns the money.
        assert!(agent_registry::agent_owner(&profile) == OPERATOR);
        assert!(agent_registry::agent_bond_value(&profile) == MIN_STAKE);
        assert!(agent_registry::profile_staker(&profile) == option::some(STAKER));
        assert!(agent_registry::profile_stake_amount(&profile) == MIN_STAKE);
        assert!(agent_registry::stake_position_profile_id(&position) == profile_id);
        assert!(agent_registry::stake_position_staker(&position) == STAKER);
        assert!(agent_registry::stake_position_amount(&position) == MIN_STAKE);
        assert!(agent_registry::payout_recipient(&registry, profile_id, OPERATOR) == STAKER);
        assert!(!agent_registry::has_unstake_request(&profile));
        let records = agent_registry::eligibility_records(&registry);
        assert!(agent_registry::eligibility_owner(&records[0]) == OPERATOR);
        assert!(agent_registry::eligibility_weight(&records[0]) == 10_000);
        assert!(agent_registry::eligibility_active(&records[0]));

        test_scenario::next_tx(&mut scenario, OPERATOR);
        let cap = test_scenario::take_from_sender<agent_registry::AgentCap>(&scenario);
        assert!(agent_registry::cap_agent_profile_id(&cap) == profile_id);
        test_scenario::return_to_sender(&scenario, cap);
        test_scenario::return_to_address(STAKER, position);
        test_scenario::return_shared(profile);
        agent_registry::remove_payout_recipient_for_testing(&mut registry, profile_id);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_STAKE_TOO_SMALL)]
    fun stake_below_the_minimum_is_rejected() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE - 1, OPERATOR, &mut scenario);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_NOT_STAKER)]
    fun only_the_staker_can_request_an_unstake() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);

        test_scenario::next_tx(&mut scenario, OPERATOR);
        let position = test_scenario::take_from_address<agent_registry::StakePosition>(
            &scenario,
            STAKER,
        );
        let mut profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        agent_registry::request_unstake(
            &mut registry,
            &mut profile,
            &position,
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_POSITION_MISMATCH)]
    fun a_position_cannot_unstake_another_seat() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);
        test_scenario::next_tx(&mut scenario, STAKER);
        let position = test_scenario::take_from_sender<agent_registry::StakePosition>(&scenario);
        stake_seat(&mut registry, &clock, MIN_STAKE, OWNER, &mut scenario);

        test_scenario::next_tx(&mut scenario, STAKER);
        let mut other = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        assert!(agent_registry::agent_profile_id(&other) != agent_registry::stake_position_profile_id(&position));
        agent_registry::request_unstake(
            &mut registry,
            &mut other,
            &position,
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun unstake_deactivates_the_seat_and_pays_the_staker_after_the_delay() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let mut clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);

        test_scenario::next_tx(&mut scenario, STAKER);
        let position = test_scenario::take_from_sender<agent_registry::StakePosition>(&scenario);
        let mut profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        let profile_id = agent_registry::agent_profile_id(&profile);
        agent_registry::request_unstake(
            &mut registry,
            &mut profile,
            &position,
            &clock,
            scenario.ctx(),
        );
        assert!(!agent_registry::agent_active(&profile));
        assert!(agent_registry::has_unstake_request(&profile));
        let records = agent_registry::eligibility_records(&registry);
        assert!(!agent_registry::eligibility_active(&records[0]));

        // Pausing must never trap a matured exit.
        agent_registry::pause(&mut registry, &pause_cap);
        clock::set_for_testing(&mut clock, 86_400_000);
        agent_registry::complete_unstake(&mut profile, position, &clock, scenario.ctx());
        assert!(agent_registry::agent_bond_value(&profile) == 0);
        assert!(!agent_registry::has_unstake_request(&profile));
        assert!(agent_registry::profile_staker(&profile) == option::none());
        assert!(agent_registry::profile_stake_amount(&profile) == 0);

        test_scenario::next_tx(&mut scenario, STAKER);
        let returned = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
        assert!(coin::burn_for_testing(returned) == MIN_STAKE);
        assert!(!test_scenario::has_most_recent_for_sender<agent_registry::StakePosition>(&scenario));
        test_scenario::return_shared(profile);
        agent_registry::remove_payout_recipient_for_testing(&mut registry, profile_id);
        agent_registry::destroy_pause_cap_for_testing(pause_cap);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_UNSTAKE_NOT_READY)]
    fun unstake_before_the_delay_aborts() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);

        test_scenario::next_tx(&mut scenario, STAKER);
        let position = test_scenario::take_from_sender<agent_registry::StakePosition>(&scenario);
        let mut profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        agent_registry::request_unstake(
            &mut registry,
            &mut profile,
            &position,
            &clock,
            scenario.ctx(),
        );
        agent_registry::complete_unstake(&mut profile, position, &clock, scenario.ctx());
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_UNSTAKE_EXISTS)]
    fun a_second_unstake_request_is_rejected() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);

        test_scenario::next_tx(&mut scenario, STAKER);
        let position = test_scenario::take_from_sender<agent_registry::StakePosition>(&scenario);
        let mut profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        agent_registry::request_unstake(
            &mut registry,
            &mut profile,
            &position,
            &clock,
            scenario.ctx(),
        );
        agent_registry::request_unstake(
            &mut registry,
            &mut profile,
            &position,
            &clock,
            scenario.ctx(),
        );
        abort E_UNEXPECTED_SUCCESS
    }

    #[test]
    fun payout_recipient_falls_back_to_the_owner_without_a_stake() {
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
        test_scenario::next_tx(&mut scenario, OWNER);
        let profile = test_scenario::take_shared<agent_registry::AgentProfile>(&scenario);
        let profile_id = agent_registry::agent_profile_id(&profile);
        assert!(agent_registry::payout_recipient(&registry, profile_id, OWNER) == OWNER);
        assert!(agent_registry::profile_staker(&profile) == option::none());
        assert!(agent_registry::profile_stake_amount(&profile) == 0);
        test_scenario::return_shared(profile);
        agent_registry::destroy_registry_for_testing(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_PAUSED)]
    fun pause_blocks_staked_registration() {
        let mut scenario = test_scenario::begin(STAKER);
        let mut registry = agent_registry::new_registry_for_testing(scenario.ctx());
        let pause_cap = agent_registry::new_pause_cap_for_testing(scenario.ctx());
        let clock = clock::create_for_testing(scenario.ctx());
        agent_registry::pause(&mut registry, &pause_cap);
        stake_seat(&mut registry, &clock, MIN_STAKE, OPERATOR, &mut scenario);
        abort E_UNEXPECTED_SUCCESS
    }

    #[test, expected_failure(abort_code = openverdict::agent_registry::E_INVALID_PROTOCOL_FEE)]
    fun treasury_policy_rejects_fee_above_cap() {
        let mut scenario = test_scenario::begin(OWNER);
        agent_registry::init_for_testing(scenario.ctx());
        test_scenario::next_tx(&mut scenario, OWNER);
        let mut registry = test_scenario::take_shared<agent_registry::Registry>(&scenario);
        let admin_cap = test_scenario::take_from_sender<agent_registry::AdminCap>(&scenario);
        agent_registry::set_treasury_policy(&mut registry, &admin_cap, OWNER, 2_001);
        abort E_UNEXPECTED_SUCCESS
    }
}

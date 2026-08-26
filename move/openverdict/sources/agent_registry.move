/// Agent registration, capabilities, eligibility, and emergency pause state.
module openverdict::agent_registry {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::dynamic_field as df;
    use sui::event;
    use sui::hash;
    use sui::sui::SUI;

    // === Errors ===

    const E_PAUSED: u64 = 0;
    const E_NOT_PAUSED: u64 = 1;
    const E_INVALID_MANIFEST: u64 = 2;
    const E_INVALID_BOND: u64 = 3;
    const E_REGISTRY_FULL: u64 = 4;
    const E_CAP_MISMATCH: u64 = 5;
    const E_AGENT_ACTIVE: u64 = 6;
    const E_WITHDRAWAL_EXISTS: u64 = 7;
    const E_WITHDRAWAL_MISSING: u64 = 8;
    const E_WITHDRAWAL_NOT_READY: u64 = 9;
    const E_NOT_AGENT_OWNER: u64 = 10;
    const E_AGENT_NOT_FOUND: u64 = 11;
    const E_INVALID_WEIGHT: u64 = 12;

    const PROTOCOL_VERSION: u64 = 1;
    const MIN_AGENT_BOND: u64 = 1;
    const MAX_ELIGIBLE_AGENTS: u64 = 32;
    const MAX_SELECTION_WEIGHT: u64 = 1_000_000;
    const WITHDRAWAL_DELAY_MS: u64 = 86_400_000;
    const HASH_LENGTH: u64 = 32;

    /// Shared registry used as the bounded committee-selection snapshot.
    public struct Registry has key {
        id: UID,
        version: u64,
        eligible_agents: vector<EligibilityRecord>,
        paused: bool,
    }

    /// Copyable selection data kept inside the registry.
    public struct EligibilityRecord has copy, drop, store {
        agent_profile_id: ID,
        owner: address,
        human_backing_hash: vector<u8>,
        model_hash: vector<u8>,
        role_hash: vector<u8>,
        weight: u64,
        active: bool,
    }

    /// Public reputation counters. Consensus agreement is not a selection weight.
    public struct Reputation has copy, drop, store {
        liveness_bps: u64,
        valid_output_bps: u64,
        valid_reveal_bps: u64,
        evidence_quality_bps: u64,
        consensus_reliability_bps: u64,
        resolved_runs: u64,
        proven_violations: u64,
    }

    /// Shared agent profile with an owner-controlled bond.
    public struct AgentProfile has key, store {
        id: UID,
        owner: address,
        manifest_hash: vector<u8>,
        manifest_blob_id: vector<u8>,
        human_backing_hash: vector<u8>,
        model_hash: vector<u8>,
        role_hash: vector<u8>,
        bond: Balance<SUI>,
        active: bool,
        reputation: Reputation,
    }

    public struct AgentCap has key, store { id: UID, agent_profile_id: ID }
    public struct AdminCap has key, store { id: UID }
    public struct PauseCap has key, store { id: UID }
    public struct EvidenceCap has key, store { id: UID }
    public struct RunAttestorCap has key, store { id: UID }

    /// Discovery event for a newly registered agent.
    public struct AgentRegistered has copy, drop {
        agent_profile_id: ID,
        owner: address,
        manifest_hash: vector<u8>,
    }

    /// Discovery event for a versioned manifest update.
    public struct AgentManifestUpdated has copy, drop {
        agent_profile_id: ID,
        manifest_hash: vector<u8>,
        version: u64,
    }

    public struct ManifestVersionKey has copy, drop, store {}
    public struct WithdrawalKey has copy, drop, store {}

    public struct ManifestVersion has store { value: u64 }
    public struct WithdrawalRequest has store { amount: u64, available_at_ms: u64 }

    /// Package initialization creates operational caps and the shared registry.
    fun init(ctx: &mut TxContext) {
        let publisher = ctx.sender();
        transfer::transfer(AdminCap { id: object::new(ctx) }, publisher);
        transfer::transfer(PauseCap { id: object::new(ctx) }, publisher);
        transfer::transfer(EvidenceCap { id: object::new(ctx) }, publisher);
        transfer::transfer(RunAttestorCap { id: object::new(ctx) }, publisher);
        transfer::share_object(Registry {
            id: object::new(ctx),
            version: PROTOCOL_VERSION,
            eligible_agents: vector[],
            paused: false,
        });
    }

    /// Register one versioned agent and transfer its management cap to the owner.
    public entry fun register_agent(
        registry: &mut Registry,
        bond: Coin<SUI>,
        manifest_hash: vector<u8>,
        manifest_blob_id: vector<u8>,
        model_hash: vector<u8>,
        role_hash: vector<u8>,
        human_backing_hash: vector<u8>,
        _clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_not_paused(registry);
        assert_manifest_fields(
            &manifest_hash,
            &manifest_blob_id,
            &model_hash,
            &role_hash,
            &human_backing_hash,
        );
        assert!(coin::value(&bond) >= MIN_AGENT_BOND, E_INVALID_BOND);
        assert!(registry.eligible_agents.length() < MAX_ELIGIBLE_AGENTS, E_REGISTRY_FULL);

        let owner = ctx.sender();
        let mut profile = AgentProfile {
            id: object::new(ctx),
            owner,
            manifest_hash,
            manifest_blob_id,
            human_backing_hash,
            model_hash,
            role_hash,
            bond: coin::into_balance(bond),
            active: true,
            reputation: initial_reputation(),
        };
        let agent_profile_id = object::id(&profile);
        df::add(&mut profile.id, ManifestVersionKey {}, ManifestVersion { value: 1 });

        registry.eligible_agents.push_back(EligibilityRecord {
            agent_profile_id,
            owner,
            human_backing_hash: profile.human_backing_hash,
            model_hash: profile.model_hash,
            role_hash: profile.role_hash,
            weight: 10_000,
            active: true,
        });

        transfer::transfer(AgentCap { id: object::new(ctx), agent_profile_id }, owner);
        event::emit(AgentRegistered { agent_profile_id, owner, manifest_hash: profile.manifest_hash });
        transfer::share_object(profile);
    }

    /// Replace mutable manifest pointers while preserving prior event history.
    public entry fun update_agent_manifest(
        registry: &mut Registry,
        profile: &mut AgentProfile,
        cap: &AgentCap,
        manifest_hash: vector<u8>,
        manifest_blob_id: vector<u8>,
        model_hash: vector<u8>,
        role_hash: vector<u8>,
        _clock: &Clock,
    ) {
        assert_agent_cap(profile, cap);
        assert_manifest_fields(
            &manifest_hash,
            &manifest_blob_id,
            &model_hash,
            &role_hash,
            &profile.human_backing_hash,
        );
        profile.manifest_hash = manifest_hash;
        profile.manifest_blob_id = manifest_blob_id;
        profile.model_hash = model_hash;
        profile.role_hash = role_hash;

        let new_version = {
            let version = df::borrow_mut<ManifestVersionKey, ManifestVersion>(
                &mut profile.id,
                ManifestVersionKey {},
            );
            version.value = version.value + 1;
            version.value
        };
        event::emit(AgentManifestUpdated {
            agent_profile_id: object::id(profile),
            manifest_hash: profile.manifest_hash,
            version: new_version,
        });
        let profile_id = object::id(profile);
        let (found, index) = find_record_index(&registry.eligible_agents, profile_id);
        assert!(found, E_AGENT_NOT_FOUND);
        let record = &mut registry.eligible_agents[index];
        record.owner = profile.owner;
        record.human_backing_hash = profile.human_backing_hash;
        record.model_hash = profile.model_hash;
        record.role_hash = profile.role_hash;
    }

    /// Mark a profile and its authoritative eligibility record inactive atomically.
    public entry fun deprecate_agent(
        registry: &mut Registry,
        profile: &mut AgentProfile,
        cap: &AgentCap,
    ) {
        assert_agent_cap(profile, cap);
        profile.active = false;
        let profile_id = object::id(profile);
        let (found, index) = find_record_index(&registry.eligible_agents, profile_id);
        assert!(found, E_AGENT_NOT_FOUND);
        vector::borrow_mut(&mut registry.eligible_agents, index).active = false;
    }

    /// Synchronize the bounded registry record after a profile change.
    public entry fun set_agent_eligibility(
        registry: &mut Registry,
        _admin_cap: &AdminCap,
        profile: &AgentProfile,
        active: bool,
        weight: u64,
    ) {
        assert!(weight > 0 && weight <= MAX_SELECTION_WEIGHT, E_INVALID_WEIGHT);
        let profile_id = object::id(profile);
        let (found, index) = find_record_index(&registry.eligible_agents, profile_id);
        assert!(found, E_AGENT_NOT_FOUND);
        let record = &mut registry.eligible_agents[index];
        record.owner = profile.owner;
        record.human_backing_hash = profile.human_backing_hash;
        record.model_hash = profile.model_hash;
        record.role_hash = profile.role_hash;
        record.weight = weight;
        record.active = active && profile.active;
    }

    /// Add bond while active economic writes are enabled.
    public entry fun deposit_agent_bond(
        registry: &Registry,
        profile: &mut AgentProfile,
        cap: &AgentCap,
        bond: Coin<SUI>,
    ) {
        assert_not_paused(registry);
        assert_agent_cap(profile, cap);
        assert!(coin::value(&bond) > 0, E_INVALID_BOND);
        balance::join(&mut profile.bond, coin::into_balance(bond));
    }

    /// Start a delayed withdrawal only after the agent is inactive.
    public entry fun request_agent_bond_withdrawal(
        registry: &Registry,
        profile: &mut AgentProfile,
        cap: &AgentCap,
        amount: u64,
        clock: &Clock,
    ) {
        assert_agent_cap(profile, cap);
        assert!(!profile.active, E_AGENT_ACTIVE);
        let (found, index) = find_record_index(&registry.eligible_agents, object::id(profile));
        assert!(found && !registry.eligible_agents[index].active, E_AGENT_ACTIVE);
        assert!(amount > 0 && amount <= balance::value(&profile.bond), E_INVALID_BOND);
        assert!(!df::exists_<WithdrawalKey>(&profile.id, WithdrawalKey {}), E_WITHDRAWAL_EXISTS);
        let now = clock::timestamp_ms(clock);
        assert!(now <= 0xffffffffffffffff - WITHDRAWAL_DELAY_MS, E_INVALID_BOND);
        df::add(
            &mut profile.id,
            WithdrawalKey {},
            WithdrawalRequest { amount, available_at_ms: now + WITHDRAWAL_DELAY_MS },
        );
    }

    /// Complete a matured withdrawal. Pausing never blocks this safe exit.
    public entry fun complete_agent_bond_withdrawal(
        profile: &mut AgentProfile,
        cap: &AgentCap,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_agent_cap(profile, cap);
        assert!(profile.owner == ctx.sender(), E_NOT_AGENT_OWNER);
        assert!(df::exists_<WithdrawalKey>(&profile.id, WithdrawalKey {}), E_WITHDRAWAL_MISSING);
        let WithdrawalRequest { amount, available_at_ms } =
            df::remove(&mut profile.id, WithdrawalKey {});
        assert!(clock::timestamp_ms(clock) >= available_at_ms, E_WITHDRAWAL_NOT_READY);
        let withdrawn = balance::split(&mut profile.bond, amount);
        transfer::public_transfer(coin::from_balance(withdrawn, ctx), profile.owner);
    }

    /// Pause new registrations and economic writes.
    public entry fun pause(registry: &mut Registry, _pause_cap: &PauseCap) {
        assert!(!registry.paused, E_PAUSED);
        registry.paused = true;
    }

    /// Re-enable new registrations and economic writes.
    public entry fun unpause(registry: &mut Registry, _pause_cap: &PauseCap) {
        assert!(registry.paused, E_NOT_PAUSED);
        registry.paused = false;
    }

    /// Hash identifier reserved for the required skeptic committee role.
    public fun skeptic_role_hash(): vector<u8> {
        hash::blake2b256(&b"OPENVERDICT_ROLE_SKEPTIC")
    }

    /// Hash identifier reserved for the required source-authenticity role.
    public fun source_authenticity_role_hash(): vector<u8> {
        hash::blake2b256(&b"OPENVERDICT_ROLE_SOURCE_AUTHENTICITY")
    }

    public fun registry_version(registry: &Registry): u64 { registry.version }
    public fun registry_paused(registry: &Registry): bool { registry.paused }
    public fun eligible_agent_count(registry: &Registry): u64 { registry.eligible_agents.length() }
    public fun agent_profile_id(profile: &AgentProfile): ID { object::id(profile) }
    public fun agent_owner(profile: &AgentProfile): address { profile.owner }
    public fun agent_active(profile: &AgentProfile): bool { profile.active }
    public fun agent_bond_value(profile: &AgentProfile): u64 { balance::value(&profile.bond) }
    public fun cap_agent_profile_id(cap: &AgentCap): ID { cap.agent_profile_id }

    public(package) fun assert_not_paused(registry: &Registry) {
        assert!(!registry.paused, E_PAUSED);
    }

    public(package) fun eligibility_records(registry: &Registry): &vector<EligibilityRecord> {
        &registry.eligible_agents
    }

    public(package) fun eligibility_profile_id(record: &EligibilityRecord): ID {
        record.agent_profile_id
    }

    public(package) fun eligibility_owner(record: &EligibilityRecord): address { record.owner }

    public(package) fun eligibility_human_hash(record: &EligibilityRecord): &vector<u8> {
        &record.human_backing_hash
    }

    public(package) fun eligibility_model_hash(record: &EligibilityRecord): &vector<u8> {
        &record.model_hash
    }

    public(package) fun eligibility_role_hash(record: &EligibilityRecord): &vector<u8> {
        &record.role_hash
    }

    public(package) fun eligibility_weight(record: &EligibilityRecord): u64 { record.weight }
    public(package) fun eligibility_active(record: &EligibilityRecord): bool { record.active }

    fun initial_reputation(): Reputation {
        Reputation {
            liveness_bps: 10_000,
            valid_output_bps: 10_000,
            valid_reveal_bps: 10_000,
            evidence_quality_bps: 10_000,
            consensus_reliability_bps: 10_000,
            resolved_runs: 0,
            proven_violations: 0,
        }
    }

    fun assert_agent_cap(profile: &AgentProfile, cap: &AgentCap) {
        assert!(object::id(profile) == cap.agent_profile_id, E_CAP_MISMATCH);
    }

    fun assert_manifest_fields(
        manifest_hash: &vector<u8>,
        manifest_blob_id: &vector<u8>,
        model_hash: &vector<u8>,
        role_hash: &vector<u8>,
        human_backing_hash: &vector<u8>,
    ) {
        assert!(
            manifest_hash.length() == HASH_LENGTH &&
                !manifest_blob_id.is_empty() &&
                model_hash.length() == HASH_LENGTH &&
                role_hash.length() == HASH_LENGTH &&
                human_backing_hash.length() == HASH_LENGTH,
            E_INVALID_MANIFEST,
        );
    }

    fun find_record_index(records: &vector<EligibilityRecord>, profile_id: ID): (bool, u64) {
        let mut i = 0;
        while (i < records.length()) {
            if (records[i].agent_profile_id == profile_id) return (true, i);
            i = i + 1;
        };
        (false, 0)
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

    #[test_only]
    public(package) fun new_registry_for_testing(ctx: &mut TxContext): Registry {
        Registry {
            id: object::new(ctx),
            version: PROTOCOL_VERSION,
            eligible_agents: vector[],
            paused: false,
        }
    }

    #[test_only]
    public(package) fun add_eligibility_for_testing(
        registry: &mut Registry,
        agent_profile_id: ID,
        owner: address,
        human_backing_hash: vector<u8>,
        model_hash: vector<u8>,
        role_hash: vector<u8>,
    ) {
        registry.eligible_agents.push_back(EligibilityRecord {
            agent_profile_id,
            owner,
            human_backing_hash,
            model_hash,
            role_hash,
            weight: 10_000,
            active: true,
        });
    }

    #[test_only]
    public(package) fun destroy_registry_for_testing(registry: Registry) {
        let Registry { id, version: _, eligible_agents: _, paused: _ } = registry;
        id.delete();
    }

    #[test_only]
    public(package) fun new_agent_cap_for_testing(agent_profile_id: ID, ctx: &mut TxContext): AgentCap {
        AgentCap { id: object::new(ctx), agent_profile_id }
    }

    #[test_only]
    public(package) fun new_evidence_cap_for_testing(ctx: &mut TxContext): EvidenceCap {
        EvidenceCap { id: object::new(ctx) }
    }

    #[test_only]
    public(package) fun new_run_attestor_cap_for_testing(ctx: &mut TxContext): RunAttestorCap {
        RunAttestorCap { id: object::new(ctx) }
    }

    #[test_only]
    public(package) fun new_pause_cap_for_testing(ctx: &mut TxContext): PauseCap {
        PauseCap { id: object::new(ctx) }
    }

    #[test_only]
    public(package) fun destroy_agent_cap_for_testing(cap: AgentCap) {
        let AgentCap { id, agent_profile_id: _ } = cap;
        id.delete();
    }

    #[test_only]
    public(package) fun destroy_evidence_cap_for_testing(cap: EvidenceCap) {
        let EvidenceCap { id } = cap;
        id.delete();
    }

    #[test_only]
    public(package) fun destroy_run_attestor_cap_for_testing(cap: RunAttestorCap) {
        let RunAttestorCap { id } = cap;
        id.delete();
    }

    #[test_only]
    public(package) fun destroy_pause_cap_for_testing(cap: PauseCap) {
        let PauseCap { id } = cap;
        id.delete();
    }

    #[test_only]
    public(package) fun new_agent_profile_for_testing(
        owner: address,
        bond_value: u64,
        ctx: &mut TxContext,
    ): AgentProfile {
        let mut profile = AgentProfile {
            id: object::new(ctx),
            owner,
            manifest_hash: vector::tabulate!(HASH_LENGTH, |_| 1),
            manifest_blob_id: b"manifest",
            human_backing_hash: vector::tabulate!(HASH_LENGTH, |_| 2),
            model_hash: vector::tabulate!(HASH_LENGTH, |_| 3),
            role_hash: skeptic_role_hash(),
            bond: balance::create_for_testing<SUI>(bond_value),
            active: true,
            reputation: initial_reputation(),
        };
        df::add(&mut profile.id, ManifestVersionKey {}, ManifestVersion { value: 1 });
        profile
    }

    #[test_only]
    public(package) fun destroy_agent_profile_for_testing(profile: AgentProfile): u64 {
        let mut profile = profile;
        let ManifestVersion { value: _ } =
            df::remove(&mut profile.id, ManifestVersionKey {});
        let withdrawal = df::remove_if_exists<WithdrawalKey, WithdrawalRequest>(
            &mut profile.id,
            WithdrawalKey {},
        );
        if (withdrawal.is_some()) {
            let WithdrawalRequest { amount: _, available_at_ms: _ } = withdrawal.destroy_some();
        } else {
            withdrawal.destroy_none();
        };
        let AgentProfile {
            id,
            owner: _,
            manifest_hash: _,
            manifest_blob_id: _,
            human_backing_hash: _,
            model_hash: _,
            role_hash: _,
            bond,
            active: _,
            reputation: _,
        } = profile;
        id.delete();
        balance::destroy_for_testing(bond)
    }
}

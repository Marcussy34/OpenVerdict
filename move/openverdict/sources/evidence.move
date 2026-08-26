/// Immutable evidence bundles linked once per claim phase.
module openverdict::evidence {
    use openverdict::agent_registry::EvidenceCap;
    use openverdict::claim::{Self, Claim};
    use sui::clock::{Self, Clock};
    use sui::event;

    // === Errors ===

    const E_INVALID_PHASE: u64 = 0;
    const E_INVALID_ROOT: u64 = 1;
    const E_INVALID_MANIFEST: u64 = 2;
    const E_INVALID_POLICY: u64 = 3;
    const E_RETENTION_EXPIRED: u64 = 4;
    const E_CLAIM_MISMATCH: u64 = 5;

    const HASH_LENGTH: u64 = 32;

    /// Frozen evidence manifest and its Walrus retention metadata.
    public struct EvidenceBundle has key, store {
        id: UID,
        claim_id: ID,
        phase: u8,
        root: vector<u8>,
        manifest_blob_id: vector<u8>,
        manifest_blob_object_id: ID,
        source_count: u32,
        policy_id: vector<u8>,
        walrus_end_epoch: u64,
    }

    public struct EvidenceFrozen has copy, drop {
        claim_id: ID,
        phase: u8,
        evidence_bundle_id: ID,
        root: vector<u8>,
    }

    /// Create an owned bundle so a PTB can link and freeze it atomically.
    public(package) fun new_evidence_bundle(
        _evidence_cap: &EvidenceCap,
        claim_id: ID,
        phase: u8,
        root: vector<u8>,
        manifest_blob_id: vector<u8>,
        manifest_blob_object_id: ID,
        source_count: u32,
        policy_id: vector<u8>,
        walrus_end_epoch: u64,
        ctx: &mut TxContext,
    ): EvidenceBundle {
        assert!(phase == 1 || phase == 2, E_INVALID_PHASE);
        assert!(root.length() == HASH_LENGTH, E_INVALID_ROOT);
        assert!(!manifest_blob_id.is_empty(), E_INVALID_MANIFEST);
        assert!(!policy_id.is_empty(), E_INVALID_POLICY);
        assert!(walrus_end_epoch >= ctx.epoch(), E_RETENTION_EXPIRED);
        EvidenceBundle {
            id: object::new(ctx),
            claim_id,
            phase,
            root,
            manifest_blob_id,
            manifest_blob_object_id,
            source_count,
            policy_id,
            walrus_end_epoch,
        }
    }

    /// Construct, link, and freeze one phase bundle atomically.
    public entry fun freeze_evidence<T>(
        claim: &mut Claim<T>,
        evidence_cap: &EvidenceCap,
        phase: u8,
        root: vector<u8>,
        manifest_blob_id: vector<u8>,
        manifest_blob_object_id: ID,
        source_count: u32,
        policy_id: vector<u8>,
        walrus_end_epoch: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let bundle = new_evidence_bundle(
            evidence_cap,
            claim::claim_id(claim),
            phase,
            root,
            manifest_blob_id,
            manifest_blob_object_id,
            source_count,
            policy_id,
            walrus_end_epoch,
            ctx,
        );
        freeze_evidence_bundle(claim, evidence_cap, phase, bundle, clock);
    }

    /// Package composition helper for an already-created bundle.
    public(package) fun freeze_evidence_bundle<T>(
        claim: &mut Claim<T>,
        _evidence_cap: &EvidenceCap,
        phase: u8,
        bundle: EvidenceBundle,
        clock: &Clock,
    ) {
        assert!(bundle.claim_id == claim::claim_id(claim), E_CLAIM_MISMATCH);
        assert!(bundle.phase == phase, E_INVALID_PHASE);
        assert!(bundle.policy_id == *claim::evidence_policy_id(claim), E_INVALID_POLICY);
        claim::assert_can_freeze_evidence(claim, phase, clock::timestamp_ms(clock));
        let bundle_id = object::id(&bundle);
        claim::link_evidence_bundle(claim, phase, bundle_id);
        event::emit(EvidenceFrozen {
            claim_id: bundle.claim_id,
            phase,
            evidence_bundle_id: bundle_id,
            root: bundle.root,
        });
        transfer::public_freeze_object(bundle);
    }

    public fun evidence_bundle_id(bundle: &EvidenceBundle): ID { object::id(bundle) }
    public fun evidence_claim_id(bundle: &EvidenceBundle): ID { bundle.claim_id }
    public fun evidence_phase(bundle: &EvidenceBundle): u8 { bundle.phase }
    public fun evidence_root(bundle: &EvidenceBundle): &vector<u8> { &bundle.root }
    public fun evidence_walrus_end_epoch(bundle: &EvidenceBundle): u64 { bundle.walrus_end_epoch }
    public fun evidence_source_count(bundle: &EvidenceBundle): u32 { bundle.source_count }

    public(package) fun assert_bundle_matches<T>(
        claim: &Claim<T>,
        bundle: &EvidenceBundle,
        phase: u8,
    ) {
        assert!(bundle.claim_id == claim::claim_id(claim), E_CLAIM_MISMATCH);
        assert!(bundle.phase == phase, E_INVALID_PHASE);
        claim::assert_active_evidence_bundle(claim, phase, object::id(bundle));
    }

    #[test_only]
    public(package) fun destroy_bundle_for_testing(bundle: EvidenceBundle) {
        let EvidenceBundle {
            id,
            claim_id: _,
            phase: _,
            root: _,
            manifest_blob_id: _,
            manifest_blob_object_id: _,
            source_count: _,
            policy_id: _,
            walrus_end_epoch: _,
        } = bundle;
        id.delete();
    }
}

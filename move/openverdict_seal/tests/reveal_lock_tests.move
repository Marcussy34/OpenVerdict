#[test_only]
module openverdict_seal::reveal_lock_tests;

use openverdict_seal::reveal_lock;
use std::unit_test::assert_eq;
use sui::bcs;
use sui::clock;

const CLAIM_ID: address = @0xC1A1;
const JURY_SEAT_ID: address = @0x5EA7;
const PHASE: u8 = 2;
const DEADLINE_MS: u64 = 1_234_567;

// Keep this builder byte-for-byte aligned with the Seal identity.
fun identity(deadline_ms: u64): vector<u8> {
    let claim_id = CLAIM_ID;
    let jury_seat_id = JURY_SEAT_ID;
    let phase = PHASE;
    let mut id = bcs::to_bytes(&claim_id);
    id.append(bcs::to_bytes(&jury_seat_id));
    id.append(bcs::to_bytes(&phase));
    id.append(bcs::to_bytes(&deadline_ms));
    id
}

#[test]
fun approves_at_and_after_deadline_and_decodes_identity() {
    let mut ctx = tx_context::dummy();
    let mut clock = clock::create_for_testing(&mut ctx);

    assert_eq!(reveal_lock::identity_deadline_ms(identity(DEADLINE_MS)), DEADLINE_MS);
    clock.set_for_testing(DEADLINE_MS);
    reveal_lock::seal_approve_for_testing(identity(DEADLINE_MS), &clock);
    clock.set_for_testing(DEADLINE_MS + 1);
    reveal_lock::seal_approve_for_testing(identity(DEADLINE_MS), &clock);

    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = openverdict_seal::reveal_lock::ENotYetOpen)]
fun rejects_before_deadline() {
    let mut ctx = tx_context::dummy();
    let mut clock = clock::create_for_testing(&mut ctx);
    clock.set_for_testing(DEADLINE_MS - 1);

    reveal_lock::seal_approve_for_testing(identity(DEADLINE_MS), &clock);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = openverdict_seal::reveal_lock::EMalformedIdentity)]
fun rejects_trailing_identity_bytes() {
    let mut id = identity(DEADLINE_MS);
    id.push_back(0);

    reveal_lock::identity_deadline_ms(id);
}

#[test, expected_failure(abort_code = openverdict_seal::reveal_lock::EMalformedIdentity)]
fun rejects_short_identity() {
    reveal_lock::identity_deadline_ms(vector[0]);
}

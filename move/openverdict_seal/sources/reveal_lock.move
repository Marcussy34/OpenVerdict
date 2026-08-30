module openverdict_seal::reveal_lock;

use sui::bcs;
use sui::clock::Clock;

const IDENTITY_LENGTH: u64 = 73;

#[error]
const ENotYetOpen: vector<u8> = b"the reveal deadline in this identity has not passed";

#[error]
const EMalformedIdentity: vector<u8> = b"identity must be claim, seat, phase, deadline";

/// Returns the reveal deadline encoded in a complete Seal identity.
public fun identity_deadline_ms(id: vector<u8>): u64 {
    // BCS peelers have their own abort, so reject truncation under our policy error first.
    assert!(id.length() >= IDENTITY_LENGTH, EMalformedIdentity);
    let mut cursor = bcs::new(id);
    let _claim_id = cursor.peel_address();
    let _jury_seat_id = cursor.peel_address();
    let _phase = cursor.peel_u8();
    let deadline_ms = cursor.peel_u64();
    assert!(cursor.into_remainder_bytes().length() == 0, EMalformedIdentity);
    deadline_ms
}

/// Allows Seal key release once the identity's reveal deadline has passed.
entry fun seal_approve(id: vector<u8>, clock: &Clock) {
    let deadline_ms = identity_deadline_ms(id);
    assert!(clock.timestamp_ms() >= deadline_ms, ENotYetOpen);
}

#[test_only]
/// Keeps the transaction-only policy private while exercising it in unit tests.
public fun seal_approve_for_testing(id: vector<u8>, clock: &Clock) {
    seal_approve(id, clock);
}

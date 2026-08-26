// TS↔Move commitment parity (plan Task 4).
// Every expected byte array below is generated INDEPENDENTLY by
// scripts/gen-parity-vectors.ts (@mysten/sui bcs + @noble blake2b) and must
// equal Move's blake2b256(bcs::to_bytes(VotePreimageV1)). If either side
// changes serialization, one of these tests fails.
#[test_only]
module openverdict::parity_tests {
    use openverdict::claim;
    use openverdict::jury;

    fun filled(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }

    fun assert_vector(
        claim_addr: address,
        profile_addr: address,
        seat_addr: address,
        phase: u8,
        outcome: u8,
        confidence_bps: u16,
        evidence_byte: u8,
        output_byte: u8,
        run_byte: u8,
        salt: vector<u8>,
        expected: vector<u8>,
    ) {
        let preimage = jury::new_vote_preimage(
            object::id_from_address(claim_addr),
            object::id_from_address(profile_addr),
            object::id_from_address(seat_addr),
            phase,
            outcome,
            confidence_bps,
            filled(evidence_byte),
            filled(output_byte),
            filled(run_byte),
            salt,
        );
        assert!(jury::compute_commitment(&preimage) == expected);
    }

    #[test]
    fun yes_high_confidence() {
        assert_vector(
            @0x1, @0x2, @0x3, 1, claim::outcome_yes(), 9_001, 1, 2, 3,
            b"salt",
            vector[
                174, 207, 59, 12, 142, 92, 199, 12,
                229, 251, 203, 168, 192, 10, 22, 186,
                64, 48, 139, 3, 205, 156, 237, 155,
                118, 169, 240, 141, 247, 8, 101, 206,
            ],
        );
    }

    #[test]
    fun no_low_confidence_phase2() {
        assert_vector(
            @0x11, @0x22, @0x33, 2, claim::outcome_no(), 250, 0xaa, 0xbb, 0xcc,
            b"second-round-salt",
            vector[
                127, 89, 150, 18, 5, 117, 34, 20,
                209, 138, 156, 51, 20, 41, 160, 161,
                190, 120, 97, 151, 216, 87, 121, 45,
                153, 242, 176, 137, 2, 34, 32, 16,
            ],
        );
    }

    #[test]
    fun unsure_mid_confidence() {
        assert_vector(
            @0x7f, @0x80, @0x81, 1, claim::outcome_unsure(), 5_000, 0x10, 0x20, 0x30,
            vector[0],
            vector[
                75, 94, 215, 188, 108, 34, 250, 185,
                198, 33, 121, 128, 135, 110, 38, 43,
                50, 174, 24, 232, 206, 38, 192, 235,
                27, 16, 49, 213, 106, 185, 103, 219,
            ],
        );
    }

    #[test]
    fun boundary_confidence_zero() {
        assert_vector(
            @0xff, @0xfe, @0xfd, 1, claim::outcome_no(), 0, 0, 0, 0,
            vector[],
            vector[
                234, 36, 123, 131, 84, 131, 181, 66,
                63, 129, 187, 11, 49, 126, 226, 248,
                124, 203, 27, 171, 21, 190, 76, 76,
                66, 99, 138, 11, 190, 233, 125, 135,
            ],
        );
    }

    #[test]
    fun boundary_confidence_max() {
        assert_vector(
            @0x4, @0x5, @0x6, 2, claim::outcome_yes(), 10_000, 0x5a, 0xa5, 0x0f,
            vector::tabulate!(32, |_| 0x77),
            vector[
                72, 1, 7, 8, 53, 113, 163, 74,
                189, 205, 144, 132, 45, 150, 135, 53,
                40, 68, 223, 204, 179, 224, 176, 37,
                112, 61, 162, 188, 196, 22, 94, 148,
            ],
        );
    }

    #[test]
    fun long_salt_128_bytes() {
        assert_vector(
            @0x0a, @0x0b, @0x0c, 1, claim::outcome_unsure(), 4_321, 0x99, 0x88, 0x66,
            vector::tabulate!(128, |i| ((i % 251) as u8)),
            vector[
                142, 120, 248, 109, 41, 183, 179, 156,
                166, 217, 99, 123, 215, 6, 204, 39,
                170, 74, 79, 180, 213, 247, 237, 68,
                79, 237, 93, 129, 126, 229, 136, 228,
            ],
        );
    }
}

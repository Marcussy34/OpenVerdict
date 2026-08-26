/// Human-readable metadata for OpenVerdict's flagship on-chain objects.
module openverdict::display_meta {
    use openverdict::agent_registry::AgentProfile;
    use openverdict::demo_binary_pool::Position;
    use openverdict::jury::ResolutionCertificate;
    use sui::display;
    use sui::package;
    use sui::sui::SUI;

    /// One-time witness used to claim this package's Publisher object.
    public struct DISPLAY_META has drop {}

    /// Sui 1.52.2 exposes only the V1 `sui::display` API in its bundled framework.
    fun init(witness: DISPLAY_META, ctx: &mut TxContext) {
        let recipient = ctx.sender();
        let publisher = package::claim(witness, ctx);

        // Every placeholder maps directly to a field on jury::ResolutionCertificate.
        let mut certificate = display::new_with_fields<ResolutionCertificate>(
            &publisher,
            vector[
                b"name".to_string(),
                b"description".to_string(),
                b"link".to_string(),
                b"project_url".to_string(),
            ],
            vector[
                b"OpenVerdict Resolution Certificate".to_string(),
                b"Final rule-bound verdict for claim {claim_id} - result code {result}, truth score {truth_score_bps} bps".to_string(),
                b"https://github.com/Marcussy34/OpenVerdict".to_string(),
                b"https://github.com/Marcussy34/OpenVerdict".to_string(),
            ],
            ctx,
        );
        display::update_version(&mut certificate);
        transfer::public_transfer(certificate, recipient);

        // AgentProfile exposes `active`, so the template remains renderable.
        let mut agent = display::new_with_fields<AgentProfile>(
            &publisher,
            vector[b"name".to_string(), b"description".to_string()],
            vector[
                b"OpenVerdict Jury Agent".to_string(),
                b"Human-backed AI oracle agent - active: {active}".to_string(),
            ],
            ctx,
        );
        display::update_version(&mut agent);
        transfer::public_transfer(agent, recipient);

        // V1 binds a concrete type; the flagship display targets SUI pool positions.
        let mut position = display::new_with_fields<Position<SUI>>(
            &publisher,
            vector[b"name".to_string(), b"description".to_string()],
            vector[
                b"OpenVerdict Demo Position".to_string(),
                b"Capped demo prediction-market position for claim-linked pool".to_string(),
            ],
            ctx,
        );
        display::update_version(&mut position);
        transfer::public_transfer(position, recipient);

        transfer::public_transfer(publisher, recipient);
    }

    #[test_only]
    /// Exercise package publication behavior in a test scenario.
    public fun init_for_testing(ctx: &mut TxContext) { init(DISPLAY_META {}, ctx) }
}

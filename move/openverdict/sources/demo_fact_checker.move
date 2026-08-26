/// Capped direct-review entry point for public fact checks without a market.
module openverdict::demo_fact_checker {
    use openverdict::agent_registry::Registry;
    use openverdict::claim;
    use sui::clock::Clock;
    use sui::coin::{Self, Coin};

    // === Errors ===

    const E_NOT_DIRECT_REVIEW: u64 = 0;
    const E_BUDGET_TOO_LARGE: u64 = 1;
    const E_BUDGET_MISMATCH: u64 = 2;

    const MAX_DIRECT_REVIEW_BUDGET: u64 = 1_000_000_000;

    /// Create, transition, and share a DIRECT_REVIEW claim in one transaction.
    public entry fun start_fact_check<T>(
        registry: &Registry,
        budget: Coin<T>,
        proposal_deadline_ms: u64,
        challenge_deadline_ms: u64,
        first_commit_deadline_ms: u64,
        first_reveal_deadline_ms: u64,
        discussion_deadline_ms: u64,
        second_commit_deadline_ms: u64,
        second_reveal_deadline_ms: u64,
        creation_budget_amount: u64,
        committee_budget_amount: u64,
        evidence_budget_amount: u64,
        content_hash: vector<u8>,
        statement_blob_id: vector<u8>,
        criteria_blob_id: vector<u8>,
        evidence_policy_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let params = claim::new_claim_params(
            claim::claim_mode_direct_review(),
            proposal_deadline_ms,
            challenge_deadline_ms,
            first_commit_deadline_ms,
            first_reveal_deadline_ms,
            discussion_deadline_ms,
            second_commit_deadline_ms,
            second_reveal_deadline_ms,
            creation_budget_amount,
            committee_budget_amount,
            evidence_budget_amount,
        );
        assert!(claim::claim_params_mode(&params) == claim::claim_mode_direct_review(), E_NOT_DIRECT_REVIEW);
        let amount = coin::value(&budget);
        assert!(amount <= MAX_DIRECT_REVIEW_BUDGET, E_BUDGET_TOO_LARGE);
        assert!(amount == claim::claim_params_total_budget(&params), E_BUDGET_MISMATCH);
        let mut claim = claim::new_claim(
            registry,
            budget,
            params,
            content_hash,
            statement_blob_id,
            criteria_blob_id,
            evidence_policy_id,
            clock,
            ctx,
        );
        claim::set_direct_review_requested(&mut claim);
        claim::share_claim(claim);
    }
}

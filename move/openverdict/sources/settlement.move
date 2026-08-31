/// Terminal result creation, recipient-bound payout tickets, and safe withdrawals.
module openverdict::settlement {
    use openverdict::claim::{Self, Claim};
    use openverdict::evidence::{Self, EvidenceBundle};
    use openverdict::jury::{Self, Committee, RoundTally};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::event;

    // === Errors ===

    const E_INVALID_STATE: u64 = 0;
    const E_DEADLINE_NOT_REACHED: u64 = 1;
    const E_FIRST_ROUND_NO_CONSENSUS: u64 = 2;
    const E_INVALID_RESULT: u64 = 3;
    const E_TICKET_CLAIM_MISMATCH: u64 = 4;
    const E_NOT_RECIPIENT: u64 = 5;
    const E_NOT_TERMINAL: u64 = 6;
    const E_RETENTION_EXPIRED: u64 = 7;
    const E_PAYOUT_OVERFLOW: u64 = 8;

    const RESULT_UNRESOLVED: u8 = 4;
    const PHASE_ONE: u8 = 1;
    const PHASE_TWO: u8 = 2;

    const REASON_CREATOR_REFUND: u8 = 1;
    const REASON_JURY_REWARD: u8 = 2;
    const REASON_PROPOSER_WIN: u8 = 3;
    const REASON_CHALLENGER_WIN: u8 = 4;
    const REASON_PROPOSER_REFUND: u8 = 5;
    const REASON_CHALLENGER_REFUND: u8 = 6;
    const REASON_CANCELLED: u8 = 7;
    const REASON_PROTOCOL_FEE: u8 = 8;

    /// One-time claim on value that remains inside its terminal Claim<T> vault.
    public struct PayoutTicket<phantom T> has key, store {
        id: UID,
        claim_id: ID,
        recipient: address,
        amount: u64,
        reason: u8,
    }

    public struct ClaimFinalized has copy, drop {
        claim_id: ID,
        certificate_id: ID,
        outcome: u8,
        reviewed: bool,
        truth_score_bps: Option<u16>,
        finalized_at_ms: u64,
    }

    public struct ClaimUnresolved has copy, drop {
        claim_id: ID,
        certificate_id: ID,
        truth_score_bps: Option<u16>,
        finalized_at_ms: u64,
    }

    public struct PayoutTicketCreated has copy, drop {
        claim_id: ID,
        ticket_id: ID,
        recipient: address,
        amount: u64,
        reason: u8,
    }

    public struct PayoutWithdrawn has copy, drop {
        claim_id: ID,
        ticket_id: ID,
        recipient: address,
        amount: u64,
    }

    /// Finalize an unchallenged optimistic proposal with no fabricated Truth Score.
    public entry fun finalize_unchallenged<T>(
        claim: &mut Claim<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(claim::state(claim) == claim::state_proposed(), E_INVALID_STATE);
        let now = clock::timestamp_ms(clock);
        assert!(now > claim::challenge_deadline_ms(claim), E_DEADLINE_NOT_REACHED);
        let proposal = claim::proposal_value(claim);
        let result = if (proposal == claim::outcome_unsure()) RESULT_UNRESOLVED else proposal;
        assert!(result == claim::outcome_yes() || result == claim::outcome_no() || result == RESULT_UNRESOLVED, E_INVALID_RESULT);

        let certificate_id = jury::create_resolution_certificate(
            claim::claim_id(claim),
            claim::protocol_version(claim),
            result,
            option::none(),
            option::none(),
            vector[],
            vector[],
            now,
            ctx,
        );
        claim::set_terminal(claim, result, false, certificate_id);
        create_unchallenged_payouts(claim, ctx);
        emit_terminal_event(claim, certificate_id, result, false, option::none(), now);
    }

    /// Finalize a closed jury window from the bounded tally only.
    public entry fun finalize_claim<T>(
        claim: &mut Claim<T>,
        committee: &Committee,
        tally: &mut RoundTally,
        evidence_bundle: &EvidenceBundle,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let phase = jury::tally_phase(tally);
        let now = clock::timestamp_ms(clock);
        if (phase == PHASE_ONE) {
            assert!(claim::state(claim) == claim::state_reveal_1(), E_INVALID_STATE);
            assert!(
                now > claim::first_reveal_deadline_ms(claim) || jury::all_seats_revealed(tally),
                E_DEADLINE_NOT_REACHED,
            );
        } else if (phase == PHASE_TWO) {
            assert!(claim::state(claim) == claim::state_reveal_2(), E_INVALID_STATE);
            assert!(
                now > claim::second_reveal_deadline_ms(claim) || jury::all_seats_revealed(tally),
                E_DEADLINE_NOT_REACHED,
            );
        } else {
            abort E_INVALID_STATE
        };
        assert!(jury::committee_locked(committee), E_INVALID_STATE);
        jury::assert_tally_for_finalization(claim, committee, tally, evidence_bundle);
        assert!(evidence::evidence_walrus_end_epoch(evidence_bundle) >= ctx.epoch(), E_RETENTION_EXPIRED);

        let threshold = jury::threshold_outcome(tally);
        if (phase == PHASE_ONE && threshold == claim::outcome_none()) {
            abort E_FIRST_ROUND_NO_CONSENSUS
        };
        let result = if (
            threshold == claim::outcome_unsure() ||
                (phase == PHASE_TWO && threshold == claim::outcome_none())
        ) {
            RESULT_UNRESOLVED
        } else {
            threshold
        };
        assert!(result == claim::outcome_yes() || result == claim::outcome_no() || result == RESULT_UNRESOLVED, E_INVALID_RESULT);
        let truth_score = jury::truth_score_bps(tally);

        let mut evidence_ids = vector[];
        let first = claim::first_bundle_id(claim);
        if (first.is_some()) evidence_ids.push_back(*first.borrow());
        let second = claim::second_bundle_id(claim);
        if (second.is_some()) evidence_ids.push_back(*second.borrow());
        let vote_ids = *jury::tally_revealed_vote_ids(tally);
        let certificate_id = jury::create_resolution_certificate(
            claim::claim_id(claim),
            claim::protocol_version(claim),
            result,
            truth_score,
            option::some(jury::committee_id(committee)),
            evidence_ids,
            vote_ids,
            now,
            ctx,
        );
        jury::close_tally(tally);
        claim::set_terminal(claim, result, true, certificate_id);
        create_reviewed_payouts(claim, committee, tally, result, ctx);
        emit_terminal_event(claim, certificate_id, result, true, truth_score, now);
    }

    /// Cancel only before a proposal and return all value through one ticket.
    public entry fun cancel_claim<T>(claim: &mut Claim<T>, clock: &Clock, ctx: &mut TxContext) {
        assert!(claim::state(claim) == claim::state_created(), E_INVALID_STATE);
        claim::assert_creator(claim, ctx.sender());
        assert!(clock::timestamp_ms(clock) <= claim::proposal_deadline_ms(claim), E_INVALID_STATE);
        claim::set_cancelled(claim);
        let total = claim::consolidate_for_payout(claim);
        create_ticket<T>(claim::claim_id(claim), claim::creator(claim), total, REASON_CANCELLED, ctx);
    }

    /// Consume the recipient-bound ticket exactly once and transfer its Coin<T>.
    public entry fun withdraw_payout<T>(
        claim: &mut Claim<T>,
        ticket: PayoutTicket<T>,
        _clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(claim::is_terminal(claim), E_NOT_TERMINAL);
        assert!(ticket.claim_id == claim::claim_id(claim), E_TICKET_CLAIM_MISMATCH);
        assert!(ticket.recipient == ctx.sender(), E_NOT_RECIPIENT);
        let PayoutTicket { id, claim_id, recipient, amount, reason: _ } = ticket;
        let ticket_id = object::uid_to_inner(&id);
        id.delete();
        let payout = claim::take_payout(claim, amount);
        transfer::public_transfer(coin::from_balance(payout, ctx), recipient);
        event::emit(PayoutWithdrawn { claim_id, ticket_id, recipient, amount });
    }

    public fun ticket_claim_id<T>(ticket: &PayoutTicket<T>): ID { ticket.claim_id }
    public fun ticket_recipient<T>(ticket: &PayoutTicket<T>): address { ticket.recipient }
    public fun ticket_amount<T>(ticket: &PayoutTicket<T>): u64 { ticket.amount }
    public fun ticket_reason<T>(ticket: &PayoutTicket<T>): u8 { ticket.reason }
    public fun reason_creator_refund(): u8 { REASON_CREATOR_REFUND }
    public fun reason_jury_reward(): u8 { REASON_JURY_REWARD }
    public fun reason_protocol_fee(): u8 { REASON_PROTOCOL_FEE }

    fun create_unchallenged_payouts<T>(claim: &mut Claim<T>, ctx: &mut TxContext) {
        let proposer_amount = claim::proposer_bond_value(claim);
        let total = claim::consolidate_for_payout(claim);
        let proposer = claim::proposer_address(claim);
        let mut allocated = 0;
        if (proposer.is_some() && proposer_amount > 0) {
            create_ticket<T>(
                claim::claim_id(claim),
                *proposer.borrow(),
                proposer_amount,
                REASON_PROPOSER_REFUND,
                ctx,
            );
            allocated = proposer_amount;
        };
        assert!(allocated <= total, E_PAYOUT_OVERFLOW);
        create_ticket<T>(
            claim::claim_id(claim),
            claim::creator(claim),
            total - allocated,
            REASON_CREATOR_REFUND,
            ctx,
        );
    }

    fun create_reviewed_payouts<T>(
        claim: &mut Claim<T>,
        committee: &Committee,
        tally: &RoundTally,
        result: u8,
        ctx: &mut TxContext,
    ) {
        let committee_budget = claim::committee_budget_value(claim);
        let proposer_bond = claim::proposer_bond_value(claim);
        let challenger_bond = claim::challenger_bond_value(claim);
        let total = claim::consolidate_for_payout(claim);
        let valid_count = jury::tally_reveal_count(tally) as u64;
        let fee = committee_budget * claim::protocol_fee_bps(claim) / 10_000;
        let juror_budget = committee_budget - fee;
        let reward = if (valid_count == 0) 0 else juror_budget / valid_count;
        let expected = *jury::expected_seat_ids(tally);
        let revealed = jury::revealed_seat_ids(tally);
        let mut allocated = 0;
        if (fee > 0) {
            create_ticket<T>(
                claim::claim_id(claim),
                claim::treasury(claim),
                fee,
                REASON_PROTOCOL_FEE,
                ctx,
            );
            allocated = fee;
        };
        let mut i = 0;
        while (i < expected.length()) {
            if (reward > 0 && vector::contains(revealed, &expected[i])) {
                create_ticket<T>(
                    claim::claim_id(claim),
                    jury::owner_for_expected_index(committee, i),
                    reward,
                    REASON_JURY_REWARD,
                    ctx,
                );
                allocated = allocated + reward;
            };
            i = i + 1;
        };

        let proposer = claim::proposer_address(claim);
        let challenger = claim::challenger_address(claim);
        if (result == RESULT_UNRESOLVED) {
            if (proposer.is_some() && proposer_bond > 0) {
                create_ticket<T>(
                    claim::claim_id(claim),
                    *proposer.borrow(),
                    proposer_bond,
                    REASON_PROPOSER_REFUND,
                    ctx,
                );
                allocated = allocated + proposer_bond;
            };
            if (challenger.is_some() && challenger_bond > 0) {
                create_ticket<T>(
                    claim::claim_id(claim),
                    *challenger.borrow(),
                    challenger_bond,
                    REASON_CHALLENGER_REFUND,
                    ctx,
                );
                allocated = allocated + challenger_bond;
            };
        } else if (proposer.is_some() && challenger.is_some()) {
            let bonds = proposer_bond + challenger_bond;
            if (result == claim::proposal_value(claim)) {
                create_ticket<T>(
                    claim::claim_id(claim),
                    *proposer.borrow(),
                    bonds,
                    REASON_PROPOSER_WIN,
                    ctx,
                );
            } else {
                create_ticket<T>(
                    claim::claim_id(claim),
                    *challenger.borrow(),
                    bonds,
                    REASON_CHALLENGER_WIN,
                    ctx,
                );
            };
            allocated = allocated + bonds;
        };

        assert!(allocated <= total, E_PAYOUT_OVERFLOW);
        create_ticket<T>(
            claim::claim_id(claim),
            claim::creator(claim),
            total - allocated,
            REASON_CREATOR_REFUND,
            ctx,
        );
    }

    fun create_ticket<T>(
        claim_id: ID,
        recipient: address,
        amount: u64,
        reason: u8,
        ctx: &mut TxContext,
    ) {
        if (amount == 0) return;
        let ticket = PayoutTicket<T> {
            id: object::new(ctx),
            claim_id,
            recipient,
            amount,
            reason,
        };
        let ticket_id = object::id(&ticket);
        event::emit(PayoutTicketCreated { claim_id, ticket_id, recipient, amount, reason });
        transfer::transfer(ticket, recipient);
    }

    fun emit_terminal_event<T>(
        claim: &Claim<T>,
        certificate_id: ID,
        result: u8,
        reviewed: bool,
        truth_score_bps: Option<u16>,
        finalized_at_ms: u64,
    ) {
        if (result == RESULT_UNRESOLVED) {
            event::emit(ClaimUnresolved {
                claim_id: claim::claim_id(claim),
                certificate_id,
                truth_score_bps,
                finalized_at_ms,
            });
        } else {
            event::emit(ClaimFinalized {
                claim_id: claim::claim_id(claim),
                certificate_id,
                outcome: result,
                reviewed,
                truth_score_bps,
                finalized_at_ms,
            });
        };
    }

    #[test_only]
    public(package) fun new_ticket_for_testing<T>(
        claim_id: ID,
        recipient: address,
        amount: u64,
        ctx: &mut TxContext,
    ): PayoutTicket<T> {
        PayoutTicket { id: object::new(ctx), claim_id, recipient, amount, reason: REASON_CREATOR_REFUND }
    }
}

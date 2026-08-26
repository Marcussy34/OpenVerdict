/// Demonstration-only low-cap YES/NO pool settled by an immutable OpenVerdict certificate.
module openverdict::demo_binary_pool {
    use openverdict::agent_registry::{Self, Registry};
    use openverdict::claim::{Self, Claim};
    use openverdict::jury::{Self, ResolutionCertificate};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;

    // === Errors ===

    const E_INVALID_CLOSE: u64 = 0;
    const E_INVALID_OUTCOME: u64 = 1;
    const E_POOL_CLOSED: u64 = 2;
    const E_POOL_SETTLED: u64 = 3;
    const E_POOL_NOT_SETTLED: u64 = 4;
    const E_CAP_EXCEEDED: u64 = 5;
    const E_CERTIFICATE_MISMATCH: u64 = 6;
    const E_POSITION_MISMATCH: u64 = 7;
    const E_NOT_POSITION_OWNER: u64 = 8;
    const E_INVALID_CERTIFICATE_RESULT: u64 = 9;
    const E_INVARIANT: u64 = 10;

    const OUTCOME_YES: u8 = 1;
    const OUTCOME_NO: u8 = 2;
    const RESULT_UNRESOLVED: u8 = 4;
    const MAX_POOL_VALUE: u64 = 1_000_000_000;

    public struct DemoBinaryPool<phantom T> has key {
        id: UID,
        claim_id: ID,
        accepted_package_version: u64,
        close_at_ms: u64,
        yes_pool: Balance<T>,
        no_pool: Balance<T>,
        payout_vault: Balance<T>,
        yes_stake: u64,
        no_stake: u64,
        result: u8,
        settled: bool,
        refund_mode: bool,
        remaining_winning_stake: u64,
    }

    public struct Position<phantom T> has key, store {
        id: UID,
        pool_id: ID,
        owner: address,
        outcome: u8,
        amount: u64,
    }

    public struct PoolCreated has copy, drop {
        pool_id: ID,
        claim_id: ID,
        accepted_package_version: u64,
        close_at_ms: u64,
    }

    public struct PositionOpened has copy, drop {
        pool_id: ID,
        position_id: ID,
        owner: address,
        outcome: u8,
        amount: u64,
    }

    public struct PoolSettled has copy, drop { pool_id: ID, claim_id: ID, result: u8, refund_mode: bool }
    public struct PositionRedeemed has copy, drop {
        pool_id: ID,
        position_id: ID,
        owner: address,
        amount: u64,
    }

    /// Link a new shared pool to one claim and its accepted package version.
    public entry fun create_pool<T>(
        registry: &Registry,
        claim: &Claim<T>,
        accepted_package_version: u64,
        close_at_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(accepted_package_version == claim::protocol_version(claim), E_CERTIFICATE_MISMATCH);
        assert!(
            clock::timestamp_ms(clock) < close_at_ms &&
                close_at_ms <= claim::challenge_deadline_ms(claim),
            E_INVALID_CLOSE,
        );
        let pool = DemoBinaryPool<T> {
            id: object::new(ctx),
            claim_id: claim::claim_id(claim),
            accepted_package_version,
            close_at_ms,
            yes_pool: balance::zero(),
            no_pool: balance::zero(),
            payout_vault: balance::zero(),
            yes_stake: 0,
            no_stake: 0,
            result: 0,
            settled: false,
            refund_mode: false,
            remaining_winning_stake: 0,
        };
        event::emit(PoolCreated {
            pool_id: object::id(&pool),
            claim_id: claim::claim_id(claim),
            accepted_package_version,
            close_at_ms,
        });
        transfer::share_object(pool);
    }

    /// Deposit before close and receive one address-bound position object.
    public entry fun enter<T>(
        registry: &Registry,
        pool: &mut DemoBinaryPool<T>,
        stake: Coin<T>,
        outcome: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        agent_registry::assert_not_paused(registry);
        assert!(!pool.settled, E_POOL_SETTLED);
        assert!(clock::timestamp_ms(clock) <= pool.close_at_ms, E_POOL_CLOSED);
        assert!(outcome == OUTCOME_YES || outcome == OUTCOME_NO, E_INVALID_OUTCOME);
        let amount = coin::value(&stake);
        assert!(amount > 0, E_CAP_EXCEEDED);
        let current = pool.yes_stake + pool.no_stake;
        assert!(current <= MAX_POOL_VALUE && amount <= MAX_POOL_VALUE - current, E_CAP_EXCEEDED);
        if (outcome == OUTCOME_YES) {
            balance::join(&mut pool.yes_pool, coin::into_balance(stake));
            pool.yes_stake = pool.yes_stake + amount;
        } else {
            balance::join(&mut pool.no_pool, coin::into_balance(stake));
            pool.no_stake = pool.no_stake + amount;
        };
        let owner = ctx.sender();
        let position = Position<T> {
            id: object::new(ctx),
            pool_id: object::id(pool),
            owner,
            outcome,
            amount,
        };
        event::emit(PositionOpened {
            pool_id: object::id(pool),
            position_id: object::id(&position),
            owner,
            outcome,
            amount,
        });
        transfer::transfer(position, owner);
    }

    /// Fix settlement from the certificate read boundary and prevent new entries.
    public entry fun settle_pool<T>(
        pool: &mut DemoBinaryPool<T>,
        certificate: &ResolutionCertificate,
        clock: &Clock,
    ) {
        assert!(!pool.settled, E_POOL_SETTLED);
        assert!(clock::timestamp_ms(clock) > pool.close_at_ms, E_POOL_CLOSED);
        assert!(jury::certificate_claim_id(certificate) == pool.claim_id, E_CERTIFICATE_MISMATCH);
        assert!(
            jury::certificate_package_version(certificate) == pool.accepted_package_version,
            E_CERTIFICATE_MISMATCH,
        );
        let result = jury::certificate_result(certificate);
        assert!(
            result == OUTCOME_YES || result == OUTCOME_NO || result == RESULT_UNRESOLVED,
            E_INVALID_CERTIFICATE_RESULT,
        );
        balance::join(&mut pool.payout_vault, balance::withdraw_all(&mut pool.yes_pool));
        balance::join(&mut pool.payout_vault, balance::withdraw_all(&mut pool.no_pool));
        let winning_stake = if (result == OUTCOME_YES) pool.yes_stake else pool.no_stake;
        pool.refund_mode = result == RESULT_UNRESOLVED || winning_stake == 0;
        pool.remaining_winning_stake = if (pool.refund_mode) {
            pool.yes_stake + pool.no_stake
        } else {
            winning_stake
        };
        pool.result = result;
        pool.settled = true;
        event::emit(PoolSettled {
            pool_id: object::id(pool),
            claim_id: pool.claim_id,
            result,
            refund_mode: pool.refund_mode,
        });
    }

    /// Consume a position and transfer its independent pro-rata payout or refund.
    public entry fun redeem<T>(
        pool: &mut DemoBinaryPool<T>,
        position: Position<T>,
        ctx: &mut TxContext,
    ) {
        assert!(pool.settled, E_POOL_NOT_SETTLED);
        assert!(position.pool_id == object::id(pool), E_POSITION_MISMATCH);
        assert!(position.owner == ctx.sender(), E_NOT_POSITION_OWNER);
        let eligible = pool.refund_mode || position.outcome == pool.result;
        let payout = if (!eligible) {
            0
        } else {
            assert!(
                position.amount <= pool.remaining_winning_stake && pool.remaining_winning_stake > 0,
                E_INVARIANT,
            );
            let vault = balance::value(&pool.payout_vault);
            let amount = if (position.amount == pool.remaining_winning_stake) {
                vault
            } else {
                (((position.amount as u128) * (vault as u128)) /
                    (pool.remaining_winning_stake as u128)) as u64
            };
            pool.remaining_winning_stake = pool.remaining_winning_stake - position.amount;
            amount
        };
        let Position { id, pool_id, owner, outcome: _, amount: _ } = position;
        let position_id = object::uid_to_inner(&id);
        id.delete();
        let balance = balance::split(&mut pool.payout_vault, payout);
        transfer::public_transfer(coin::from_balance(balance, ctx), owner);
        event::emit(PositionRedeemed { pool_id, position_id, owner, amount: payout });
    }

    public fun pool_claim_id<T>(pool: &DemoBinaryPool<T>): ID { pool.claim_id }
    public fun pool_settled<T>(pool: &DemoBinaryPool<T>): bool { pool.settled }
    public fun pool_result<T>(pool: &DemoBinaryPool<T>): u8 { pool.result }
    public fun pool_balance<T>(pool: &DemoBinaryPool<T>): u64 {
        balance::value(&pool.yes_pool) +
            balance::value(&pool.no_pool) +
            balance::value(&pool.payout_vault)
    }
    public fun position_amount<T>(position: &Position<T>): u64 { position.amount }
}

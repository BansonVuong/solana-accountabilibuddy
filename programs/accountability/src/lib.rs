pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("FV2FPehCpYdns2q4vGzF93cBfepiVXeww6ybQy7EmFju");

#[program]
pub mod accountability {
    use super::*;

    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
        oracle_pubkey: Pubkey,
        deadline: i64,
        failure_destination: Pubkey,
    ) -> Result<()> {
        stake::process_stake(ctx, amount, oracle_pubkey, deadline, failure_destination)
    }

    pub fn resolve(ctx: Context<Resolve>, did_succeed: bool) -> Result<()> {
        resolve::process_resolve(ctx, did_succeed)
    }

    pub fn timeout(ctx: Context<Timeout>) -> Result<()> {
        resolve::process_timeout(ctx)
    }

    // ── sports bets (ESPN-oracle settled, no witness needed) ──────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn create_bet(
        ctx: Context<CreateBet>,
        amount: u64,
        oracle_pubkey: Pubkey,
        sport: u8,
        game_id: [u8; 32],
        creator_backs_home: bool,
        start_time: i64,
        settle_after: i64,
    ) -> Result<()> {
        sports_bet::process_create_bet(
            ctx,
            amount,
            oracle_pubkey,
            sport,
            game_id,
            creator_backs_home,
            start_time,
            settle_after,
        )
    }

    pub fn accept_bet(ctx: Context<AcceptBet>) -> Result<()> {
        sports_bet::process_accept_bet(ctx)
    }

    pub fn cancel_bet(ctx: Context<CancelBet>) -> Result<()> {
        sports_bet::process_cancel_bet(ctx)
    }

    pub fn back_out(ctx: Context<BackOut>) -> Result<()> {
        sports_bet::process_back_out(ctx)
    }

    pub fn settle_bet(ctx: Context<SettleBet>, home_won: Option<bool>) -> Result<()> {
        sports_bet::process_settle_bet(ctx, home_won)
    }

    // ── social / witness bets (peer-judged, oracle-settled with a fallback) ───────

    #[allow(clippy::too_many_arguments)]
    pub fn escrow_bet(
        ctx: Context<EscrowBet>,
        amount: u64,
        oracle_pubkey: Pubkey,
        bet_id: [u8; 32],
        end_date: i64,
        fallback_kind: u8,
        fallback_dest: Pubkey,
    ) -> Result<()> {
        social_bet::process_escrow_bet(
            ctx,
            amount,
            oracle_pubkey,
            bet_id,
            end_date,
            fallback_kind,
            fallback_dest,
        )
    }

    pub fn settle_social(ctx: Context<SettleSocial>, outcome: u8) -> Result<()> {
        social_bet::process_settle_social(ctx, outcome)
    }
}

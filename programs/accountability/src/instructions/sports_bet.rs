use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    constants::{BACK_OUT_CUTOFF_SECS, SPORTS_BET_SEED, SPORTS_VAULT_SEED},
    error::ErrorCode,
    state::{SportsBet, SportsBetState, SportsVault},
};

// ── create ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(amount: u64, oracle_pubkey: Pubkey, sport: u8, game_id: [u8; 32])]
pub struct CreateBet<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = SportsBet::LEN,
        seeds = [SPORTS_BET_SEED, creator.key().as_ref(), game_id.as_ref()],
        bump
    )]
    pub sports_bet: Account<'info, SportsBet>,
    #[account(
        init,
        payer = creator,
        space = SportsVault::LEN,
        seeds = [SPORTS_VAULT_SEED, sports_bet.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, SportsVault>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn process_create_bet(
    ctx: Context<CreateBet>,
    amount: u64,
    oracle_pubkey: Pubkey,
    sport: u8,
    game_id: [u8; 32],
    creator_backs_home: bool,
    start_time: i64,
    settle_after: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(amount > 0, ErrorCode::ZeroBet);
    require!(sport <= 2, ErrorCode::InvalidSport);
    require!(start_time > now, ErrorCode::InvalidStartTime);
    require!(settle_after > start_time, ErrorCode::InvalidSettleTime);

    let bet = &mut ctx.accounts.sports_bet;
    bet.creator = ctx.accounts.creator.key();
    bet.opponent = None;
    bet.amount = amount;
    bet.oracle_pubkey = oracle_pubkey;
    bet.sport = sport;
    bet.game_id = game_id;
    bet.creator_backs_home = creator_backs_home;
    bet.start_time = start_time;
    bet.settle_after = settle_after;
    bet.state = SportsBetState::Open;
    bet.bump = ctx.bumps.sports_bet;

    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.creator,
        &ctx.accounts.vault,
        amount,
    )
}

// ── accept ───────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AcceptBet<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,
    #[account(
        mut,
        seeds = [SPORTS_BET_SEED, sports_bet.creator.as_ref(), sports_bet.game_id.as_ref()],
        bump = sports_bet.bump,
    )]
    pub sports_bet: Account<'info, SportsBet>,
    #[account(
        mut,
        seeds = [SPORTS_VAULT_SEED, sports_bet.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SportsVault>,
    pub system_program: Program<'info, System>,
}

pub fn process_accept_bet(ctx: Context<AcceptBet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &ctx.accounts.sports_bet;

    require!(bet.state == SportsBetState::Open, ErrorCode::BetNotOpen);
    require!(
        ctx.accounts.opponent.key() != bet.creator,
        ErrorCode::SelfBet
    );
    require!(now < bet.start_time, ErrorCode::GameStarted);

    let amount = bet.amount;
    fund_vault(
        &ctx.accounts.system_program,
        &ctx.accounts.opponent,
        &ctx.accounts.vault,
        amount,
    )?;

    let bet = &mut ctx.accounts.sports_bet;
    bet.opponent = Some(ctx.accounts.opponent.key());
    bet.state = SportsBetState::Locked;
    Ok(())
}

// ── cancel (open bet, no opponent yet) ─────────────────────────────────────────

#[derive(Accounts)]
pub struct CancelBet<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_BET_SEED, creator.key().as_ref(), sports_bet.game_id.as_ref()],
        bump = sports_bet.bump,
        has_one = creator,
    )]
    pub sports_bet: Account<'info, SportsBet>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_VAULT_SEED, sports_bet.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SportsVault>,
}

/// Creator reclaims their stake while the bet is still open (nobody else is at
/// risk). Allowed any time before an opponent joins.
pub fn process_cancel_bet(ctx: Context<CancelBet>) -> Result<()> {
    let bet = &mut ctx.accounts.sports_bet;
    require!(bet.state == SportsBetState::Open, ErrorCode::BetNotOpen);

    let amount = bet.amount;
    let vault = &ctx.accounts.vault;
    require!(
        vault.get_lamports() >= amount,
        ErrorCode::InsufficientVaultBalance
    );

    // Refund the stake; the `close = creator` constraints return the rent.
    ctx.accounts.vault.sub_lamports(amount)?;
    ctx.accounts.creator.add_lamports(amount)?;

    bet.state = SportsBetState::Settled;
    Ok(())
}

// ── back out (locked bet, before the 5-minute cutoff) ──────────────────────────

#[derive(Accounts)]
pub struct BackOut<'info> {
    /// Either participant may trigger the mutual back-out.
    pub backer: Signer<'info>,
    /// CHECK: validated against `sports_bet.creator`; only receives lamports.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: validated against `sports_bet.opponent`; only receives lamports.
    #[account(mut)]
    pub opponent: UncheckedAccount<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_BET_SEED, sports_bet.creator.as_ref(), sports_bet.game_id.as_ref()],
        bump = sports_bet.bump,
        has_one = creator,
    )]
    pub sports_bet: Account<'info, SportsBet>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_VAULT_SEED, sports_bet.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SportsVault>,
}

/// Mutually cancel a locked bet, refunding both stakes. Only allowed up to
/// 5 minutes before kickoff — never after the game is about to start.
pub fn process_back_out(ctx: Context<BackOut>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &ctx.accounts.sports_bet;

    require!(bet.state == SportsBetState::Locked, ErrorCode::BetNotLocked);
    require!(
        now < bet.start_time - BACK_OUT_CUTOFF_SECS,
        ErrorCode::BackOutWindowClosed
    );

    let bet_opponent = bet.opponent.ok_or(ErrorCode::BetNotLocked)?;
    require_keys_eq!(
        ctx.accounts.opponent.key(),
        bet_opponent,
        ErrorCode::InvalidOpponent
    );

    let backer = ctx.accounts.backer.key();
    require!(
        backer == bet.creator || backer == bet_opponent,
        ErrorCode::NotAParticipant
    );

    let amount = bet.amount;
    let vault = &ctx.accounts.vault;
    require!(
        vault.get_lamports() >= amount * 2,
        ErrorCode::InsufficientVaultBalance
    );

    // Refund each side their stake; `close = creator` returns the rent.
    ctx.accounts.vault.sub_lamports(amount * 2)?;
    ctx.accounts.creator.add_lamports(amount)?;
    ctx.accounts.opponent.add_lamports(amount)?;

    ctx.accounts.sports_bet.state = SportsBetState::Settled;
    Ok(())
}

// ── settle (oracle-only, after the game) ───────────────────────────────────────

#[derive(Accounts)]
pub struct SettleBet<'info> {
    pub oracle: Signer<'info>,
    /// CHECK: validated against `sports_bet.creator`; only receives lamports.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: validated against `sports_bet.opponent`; only receives lamports.
    #[account(mut)]
    pub opponent: UncheckedAccount<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_BET_SEED, sports_bet.creator.as_ref(), sports_bet.game_id.as_ref()],
        bump = sports_bet.bump,
        has_one = creator,
    )]
    pub sports_bet: Account<'info, SportsBet>,
    #[account(
        mut,
        close = creator,
        seeds = [SPORTS_VAULT_SEED, sports_bet.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SportsVault>,
}

/// Oracle pays out a locked bet from the scraped result.
///   - `home_won == Some(true)`  → home team won
///   - `home_won == Some(false)` → away team won
///   - `home_won == None`        → draw/tie, both sides refunded
pub fn process_settle_bet(ctx: Context<SettleBet>, home_won: Option<bool>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bet = &ctx.accounts.sports_bet;

    require_keys_eq!(
        ctx.accounts.oracle.key(),
        bet.oracle_pubkey,
        ErrorCode::UnauthorizedOracle
    );
    require!(bet.state == SportsBetState::Locked, ErrorCode::BetNotLocked);
    require!(now >= bet.settle_after, ErrorCode::SettleTooEarly);

    let bet_opponent = bet.opponent.ok_or(ErrorCode::BetNotLocked)?;
    require_keys_eq!(
        ctx.accounts.opponent.key(),
        bet_opponent,
        ErrorCode::InvalidOpponent
    );

    let amount = bet.amount;
    let pot = amount * 2;
    let vault = &ctx.accounts.vault;
    require!(
        vault.get_lamports() >= pot,
        ErrorCode::InsufficientVaultBalance
    );

    match home_won {
        // Draw / tie: refund both stakes.
        None => {
            ctx.accounts.vault.sub_lamports(pot)?;
            ctx.accounts.creator.add_lamports(amount)?;
            ctx.accounts.opponent.add_lamports(amount)?;
        }
        // Decisive result: the side that backed the winner takes the pot.
        Some(home) => {
            ctx.accounts.vault.sub_lamports(pot)?;
            if home == bet.creator_backs_home {
                ctx.accounts.creator.add_lamports(pot)?;
            } else {
                ctx.accounts.opponent.add_lamports(pot)?;
            }
        }
    }

    ctx.accounts.sports_bet.state = SportsBetState::Settled;
    Ok(())
}

// ── helpers ────────────────────────────────────────────────────────────────────

fn fund_vault<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    vault: &Account<'info, SportsVault>,
    amount: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.to_account_info(),
                to: vault.to_account_info(),
            },
        ),
        amount,
    )
}

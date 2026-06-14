use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    constants::{SOCIAL_BET_SEED, SOCIAL_VAULT_SEED},
    error::ErrorCode,
    state::{SocialBet, SocialBetState, SocialVault},
};

// ── escrow (both sides stake atomically at acceptance) ───────────────────────────

#[derive(Accounts)]
#[instruction(amount: u64, oracle_pubkey: Pubkey, bet_id: [u8; 32])]
pub struct EscrowBet<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,
    #[account(mut)]
    pub opponent: Signer<'info>,
    #[account(
        init,
        payer = challenger,
        space = SocialBet::LEN,
        seeds = [SOCIAL_BET_SEED, challenger.key().as_ref(), bet_id.as_ref()],
        bump
    )]
    pub social_bet: Account<'info, SocialBet>,
    #[account(
        init,
        payer = challenger,
        space = SocialVault::LEN,
        seeds = [SOCIAL_VAULT_SEED, social_bet.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, SocialVault>,
    pub system_program: Program<'info, System>,
}

/// Lock a witness bet: both participants stake `amount` into the vault in a single
/// transaction, and the precommitted fallback (kind + destination) is recorded.
#[allow(clippy::too_many_arguments)]
pub fn process_escrow_bet(
    ctx: Context<EscrowBet>,
    amount: u64,
    oracle_pubkey: Pubkey,
    bet_id: [u8; 32],
    end_date: i64,
    fallback_kind: u8,
    fallback_dest: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(amount > 0, ErrorCode::ZeroBet);
    require!(fallback_kind <= 2, ErrorCode::InvalidFallbackKind);
    require!(end_date > now, ErrorCode::InvalidEndDate);
    require!(
        ctx.accounts.challenger.key() != ctx.accounts.opponent.key(),
        ErrorCode::SelfBet
    );

    let _ = bet_id; // consumed only as a PDA seed

    let bet = &mut ctx.accounts.social_bet;
    bet.challenger = ctx.accounts.challenger.key();
    bet.opponent = ctx.accounts.opponent.key();
    bet.amount = amount;
    bet.oracle_pubkey = oracle_pubkey;
    bet.end_date = end_date;
    bet.fallback_kind = fallback_kind;
    bet.fallback_dest = fallback_dest;
    bet.state = SocialBetState::Locked;
    bet.bump = ctx.bumps.social_bet;

    transfer_in(
        &ctx.accounts.system_program,
        &ctx.accounts.challenger,
        &ctx.accounts.vault,
        amount,
    )?;
    transfer_in(
        &ctx.accounts.system_program,
        &ctx.accounts.opponent,
        &ctx.accounts.vault,
        amount,
    )
}

// ── settle (oracle-only: winner, or fallback after the resolve-by date) ──────────

#[derive(Accounts)]
pub struct SettleSocial<'info> {
    pub oracle: Signer<'info>,
    /// CHECK: validated against `social_bet.challenger`; only receives lamports.
    #[account(mut)]
    pub challenger: UncheckedAccount<'info>,
    /// CHECK: validated against `social_bet.opponent`; only receives lamports.
    #[account(mut)]
    pub opponent: UncheckedAccount<'info>,
    /// CHECK: validated against `social_bet.fallback_dest`; only receives lamports
    /// (used only for the burn/charity fallback).
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    #[account(
        mut,
        close = challenger,
        has_one = challenger,
        has_one = opponent,
        constraint = social_bet.state == SocialBetState::Locked @ ErrorCode::BetNotLocked,
    )]
    pub social_bet: Account<'info, SocialBet>,
    #[account(
        mut,
        close = challenger,
        seeds = [SOCIAL_VAULT_SEED, social_bet.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SocialVault>,
}

/// Oracle settles a locked witness bet.
///   - `outcome == 0` → challenger won; takes the pot.
///   - `outcome == 1` → opponent won; takes the pot.
///   - `outcome == 2` → fallback (only after `end_date`): refund both, or send the
///     whole pot to the precommitted burn/charity destination.
pub fn process_settle_social(ctx: Context<SettleSocial>, outcome: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let amount = ctx.accounts.social_bet.amount;
    let end_date = ctx.accounts.social_bet.end_date;
    let fallback_kind = ctx.accounts.social_bet.fallback_kind;
    let fallback_dest = ctx.accounts.social_bet.fallback_dest;
    let oracle_pubkey = ctx.accounts.social_bet.oracle_pubkey;

    require_keys_eq!(
        ctx.accounts.oracle.key(),
        oracle_pubkey,
        ErrorCode::UnauthorizedOracle
    );

    let pot = amount
        .checked_mul(2)
        .ok_or(ErrorCode::InsufficientVaultBalance)?;
    require!(
        ctx.accounts.vault.get_lamports() >= pot,
        ErrorCode::InsufficientVaultBalance
    );

    match outcome {
        0 => {
            ctx.accounts.vault.sub_lamports(pot)?;
            ctx.accounts.challenger.add_lamports(pot)?;
        }
        1 => {
            ctx.accounts.vault.sub_lamports(pot)?;
            ctx.accounts.opponent.add_lamports(pot)?;
        }
        2 => {
            require!(now >= end_date, ErrorCode::FallbackTooEarly);
            match fallback_kind {
                // return — refund both stakes
                0 => {
                    ctx.accounts.vault.sub_lamports(pot)?;
                    ctx.accounts.challenger.add_lamports(amount)?;
                    ctx.accounts.opponent.add_lamports(amount)?;
                }
                // burn / charity — whole pot to the precommitted destination
                _ => {
                    require_keys_eq!(
                        ctx.accounts.destination.key(),
                        fallback_dest,
                        ErrorCode::InvalidDestination
                    );
                    ctx.accounts.vault.sub_lamports(pot)?;
                    ctx.accounts.destination.add_lamports(pot)?;
                }
            }
        }
        _ => return err!(ErrorCode::InvalidOutcome),
    }

    ctx.accounts.social_bet.state = SocialBetState::Settled;
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────────

fn transfer_in<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    vault: &Account<'info, SocialVault>,
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

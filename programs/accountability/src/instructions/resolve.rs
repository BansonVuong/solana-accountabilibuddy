use anchor_lang::prelude::*;

use crate::{
    constants::{COMMITMENT_SEED, VAULT_SEED},
    error::ErrorCode,
    state::{Commitment, CommitmentState, Vault},
};

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub oracle: Signer<'info>,
    /// CHECK: Must match the staker recorded on the commitment and only receives lamports.
    #[account(mut)]
    pub staker: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [COMMITMENT_SEED, staker.key().as_ref()],
        bump = commitment.bump,
        has_one = staker,
        constraint = commitment.state == CommitmentState::Active
            @ ErrorCode::CommitmentAlreadyResolved
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(
        mut,
        close = staker,
        seeds = [VAULT_SEED, commitment.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: Must match the failure destination recorded on the commitment.
    #[account(
        mut,
        address = commitment.failure_destination @ ErrorCode::InvalidDestination,
        constraint = destination.key() != commitment.key() @ ErrorCode::InvalidDestination,
        constraint = destination.key() != vault.key() @ ErrorCode::InvalidDestination
    )]
    pub destination: UncheckedAccount<'info>,
}

pub fn process_resolve(ctx: Context<Resolve>, did_succeed: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.oracle.key(),
        ctx.accounts.commitment.oracle_pubkey,
        ErrorCode::UnauthorizedOracle
    );
    require!(
        Clock::get()?.unix_timestamp < ctx.accounts.commitment.deadline,
        ErrorCode::DeadlinePassed
    );

    settle(
        &mut ctx.accounts.commitment,
        &ctx.accounts.vault,
        &ctx.accounts.staker,
        &ctx.accounts.destination,
        did_succeed,
    )
}

#[derive(Accounts)]
pub struct Timeout<'info> {
    pub cranker: Signer<'info>,
    /// CHECK: Must match the staker recorded on the commitment and only receives lamports.
    #[account(mut)]
    pub staker: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [COMMITMENT_SEED, staker.key().as_ref()],
        bump = commitment.bump,
        has_one = staker,
        constraint = commitment.state == CommitmentState::Active
            @ ErrorCode::CommitmentAlreadyResolved
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(
        mut,
        close = staker,
        seeds = [VAULT_SEED, commitment.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: Must match the failure destination recorded on the commitment.
    #[account(
        mut,
        address = commitment.failure_destination @ ErrorCode::InvalidDestination,
        constraint = destination.key() != commitment.key() @ ErrorCode::InvalidDestination,
        constraint = destination.key() != vault.key() @ ErrorCode::InvalidDestination
    )]
    pub destination: UncheckedAccount<'info>,
}

pub fn process_timeout(ctx: Context<Timeout>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp >= ctx.accounts.commitment.deadline,
        ErrorCode::DeadlineNotReached
    );

    settle(
        &mut ctx.accounts.commitment,
        &ctx.accounts.vault,
        &ctx.accounts.staker,
        &ctx.accounts.destination,
        false,
    )
}

fn settle<'info>(
    commitment: &mut Account<'info, Commitment>,
    vault: &Account<'info, Vault>,
    staker: &UncheckedAccount<'info>,
    destination: &UncheckedAccount<'info>,
    did_succeed: bool,
) -> Result<()> {
    let amount = commitment.amount;
    require!(
        vault.get_lamports() >= amount,
        ErrorCode::InsufficientVaultBalance
    );

    vault.sub_lamports(amount)?;
    if did_succeed {
        staker.add_lamports(amount)?;
    } else {
        destination.add_lamports(amount)?;
    }

    commitment.state = CommitmentState::Resolved;
    Ok(())
}

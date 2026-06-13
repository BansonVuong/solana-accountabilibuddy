use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    constants::{COMMITMENT_SEED, VAULT_SEED},
    error::ErrorCode,
    state::{Commitment, CommitmentState, Vault},
};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    #[account(
        init,
        payer = staker,
        space = Commitment::LEN,
        seeds = [COMMITMENT_SEED, staker.key().as_ref()],
        bump
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(
        init,
        payer = staker,
        space = Vault::LEN,
        seeds = [VAULT_SEED, commitment.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn process_stake(
    ctx: Context<Stake>,
    amount: u64,
    oracle_pubkey: Pubkey,
    deadline: i64,
    failure_destination: Pubkey,
) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroStake);
    require!(
        deadline > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidDeadline
    );
    require!(
        failure_destination != ctx.accounts.commitment.key()
            && failure_destination != ctx.accounts.vault.key(),
        ErrorCode::InvalidDestination
    );

    let commitment = &mut ctx.accounts.commitment;
    commitment.staker = ctx.accounts.staker.key();
    commitment.amount = amount;
    commitment.state = CommitmentState::Active;
    commitment.bump = ctx.bumps.commitment;
    commitment.oracle_pubkey = oracle_pubkey;
    commitment.deadline = deadline;
    commitment.failure_destination = failure_destination;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.staker.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )
}

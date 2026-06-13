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
}

use anchor_lang::prelude::*;

#[account]
pub struct Commitment {
    pub staker: Pubkey,
    pub amount: u64,
    pub state: CommitmentState,
    pub bump: u8,
    pub oracle_pubkey: Pubkey,
    pub deadline: i64,
    pub failure_destination: Pubkey,
}

impl Commitment {
    pub const LEN: usize = 8 + 32 + 8 + 1 + 1 + 32 + 8 + 32;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitmentState {
    Active,
    Resolved,
}

#[account]
pub struct Vault {}

impl Vault {
    pub const LEN: usize = 8;
}

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Stake amount must be greater than zero")]
    ZeroStake,
    #[msg("Commitment has already been resolved")]
    CommitmentAlreadyResolved,
    #[msg("Vault does not contain the recorded stake")]
    InsufficientVaultBalance,
    #[msg("Destination cannot be an escrow account")]
    InvalidDestination,
    #[msg("Only the commitment oracle can resolve")]
    UnauthorizedOracle,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Commitment deadline has not passed")]
    DeadlineNotReached,
    #[msg("Commitment deadline has passed")]
    DeadlinePassed,
}

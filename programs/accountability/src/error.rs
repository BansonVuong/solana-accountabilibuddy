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

    // ── sports bets ──────────────────────────────────────────────────────────
    #[msg("Bet stake must be greater than zero")]
    ZeroBet,
    #[msg("Game must start in the future")]
    InvalidStartTime,
    #[msg("Settle time must be after kickoff")]
    InvalidSettleTime,
    #[msg("Unknown sport")]
    InvalidSport,
    #[msg("Bet is not open for an opponent")]
    BetNotOpen,
    #[msg("Bet is not locked")]
    BetNotLocked,
    #[msg("You cannot accept your own bet")]
    SelfBet,
    #[msg("The game has already started")]
    GameStarted,
    #[msg("Too late to back out — within 5 minutes of kickoff")]
    BackOutWindowClosed,
    #[msg("Only the creator or opponent may back out")]
    NotAParticipant,
    #[msg("It is too early to settle this bet")]
    SettleTooEarly,
    #[msg("Opponent account does not match the bet")]
    InvalidOpponent,

    // ── social/witness bets ────────────────────────────────────────────────────
    #[msg("Resolve-by date must be in the future")]
    InvalidEndDate,
    #[msg("Unknown fallback kind")]
    InvalidFallbackKind,
    #[msg("Unknown settlement outcome")]
    InvalidOutcome,
    #[msg("Fallback can only run after the resolve-by date")]
    FallbackTooEarly,
}

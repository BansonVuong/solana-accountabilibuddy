pub const COMMITMENT_SEED: &[u8] = b"commitment";
pub const VAULT_SEED: &[u8] = b"vault";

// Sports bets (1v1 / group-chat result wagers settled by the ESPN oracle crank).
pub const SPORTS_BET_SEED: &[u8] = b"sports_bet";
pub const SPORTS_VAULT_SEED: &[u8] = b"sports_vault";

/// You can back out of a locked bet up until 5 minutes before kickoff.
pub const BACK_OUT_CUTOFF_SECS: i64 = 5 * 60;

pub const COMMITMENT_SEED: &[u8] = b"commitment";
pub const VAULT_SEED: &[u8] = b"vault";

// Sports bets (1v1 / group-chat result wagers settled by the ESPN oracle crank).
pub const SPORTS_BET_SEED: &[u8] = b"sports_bet";
pub const SPORTS_VAULT_SEED: &[u8] = b"sports_vault";

// Social/witness bets (peer-judged wagers; both stakes escrowed at acceptance,
// settled by the oracle from a witness-vote quorum, or routed to a precommitted
// fallback once the resolve-by date passes without a quorum).
pub const SOCIAL_BET_SEED: &[u8] = b"social_bet";
pub const SOCIAL_VAULT_SEED: &[u8] = b"social_vault";

/// You can back out of a locked bet up until 5 minutes before kickoff.
pub const BACK_OUT_CUTOFF_SECS: i64 = 5 * 60;

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

// ── sports bets ────────────────────────────────────────────────────────────────

/// A 1v1 wager on the result of a real-world game. Either party stakes an equal
/// amount; the winner takes the pot once the ESPN oracle crank settles it. The
/// same account also backs "group chat" bets — those are just sports bets posted
/// inside a group conversation. No witness is required: the result is publicly
/// verifiable from the scoreboard.
#[account]
pub struct SportsBet {
    /// Wallet that opened the bet and staked first.
    pub creator: Pubkey,
    /// Wallet that matched the stake; `None` while the bet is still open.
    pub opponent: Option<Pubkey>,
    /// Per-side stake in lamports. The pot the winner collects is `2 * amount`.
    pub amount: u64,
    /// Oracle (relayer) authorized to settle from the scraped result.
    pub oracle_pubkey: Pubkey,
    /// Sport enum: 0 = soccer (incl. World Cup), 1 = nba, 2 = nfl.
    pub sport: u8,
    /// ESPN game id, UTF-8, zero-padded to 32 bytes.
    pub game_id: [u8; 32],
    /// True if the creator is backing the home team; the opponent gets the away
    /// side. (Draws refund both sides.)
    pub creator_backs_home: bool,
    /// Kickoff time (unix seconds). Gates the back-out window.
    pub start_time: i64,
    /// Earliest time the oracle may settle (unix seconds) — typically game end.
    pub settle_after: i64,
    pub state: SportsBetState,
    pub bump: u8,
}

impl SportsBet {
    // 8 disc + 32 creator + (1 + 32) opt opponent + 8 amount + 32 oracle
    // + 1 sport + 32 game_id + 1 backs_home + 8 start + 8 settle + 1 state + 1 bump
    pub const LEN: usize = 8 + 32 + (1 + 32) + 8 + 32 + 1 + 32 + 1 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SportsBetState {
    /// Created, waiting for an opponent to match the stake.
    Open,
    /// Both sides staked; settles after the game.
    Locked,
    /// Paid out (or refunded on a draw).
    Settled,
}

#[account]
pub struct SportsVault {}

impl SportsVault {
    pub const LEN: usize = 8;
}

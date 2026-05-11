use anchor_lang::prelude::*;

/// UserPosition — one PDA per (owner, market) pair.
///
/// Tracks locked collateral and realised P&L for a single user
/// in a single market.
///
/// Seeds: ["position", market.key, owner.key]
#[account]
pub struct UserPosition {
    /// The wallet that owns this position.
    pub owner: Pubkey,

    /// The market this position is in.
    pub market: Pubkey,

    /// Base token locked in open Ask orders.
    /// Released when ask orders are cancelled or filled.
    pub base_locked: u64,

    /// Quote token locked in open Bid orders.
    /// Calculated as sum(price_lots * remaining_lots) for all open bids.
    pub quote_locked: u64,

    /// Cumulative realised P&L in quote lots (can be negative).
    /// Updated after each fill involving this user.
    pub realized_pnl: i64,

    /// Total number of fills this user has participated in (both sides).
    pub fill_count: u32,

    /// PDA bump seed.
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 8   // discriminator
        + 32  // owner
        + 32  // market
        + 8   // base_locked
        + 8   // quote_locked
        + 8   // realized_pnl (i64)
        + 4   // fill_count
        + 1;  // bump
}

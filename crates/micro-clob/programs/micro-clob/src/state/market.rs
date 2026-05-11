use anchor_lang::prelude::*;

/// Market account — one PDA per trading pair.
///
/// Seeds: ["market", base_mint.key, quote_mint.key]
#[account]
pub struct Market {
    /// Authority that can toggle plugin_active, pause, and close the market.
    pub authority: Pubkey,

    /// The base token mint (e.g. wSOL).
    pub base_mint: Pubkey,

    /// The quote token mint (e.g. USDC).
    pub quote_mint: Pubkey,

    /// Minimum price tick in quote token native units.
    /// All order prices must be a multiple of tick_size.
    pub tick_size: u64,

    /// Minimum order size in base token native units.
    /// All order sizes must be >= lot_size.
    pub lot_size: u64,

    /// Whether MakerShield plugin is declared active for this market.
    ///
    /// When true:
    ///   - SpreadChanged events carry plugin_active = true
    ///   - MakerShield plugin knows to enforce ordering for this market
    ///   - Dashboard shows "Plugin ON" series in SpreadMonitor
    ///
    /// When false:
    ///   - Plugin still classifies txs but ordering is best-effort
    ///   - Dashboard shows "Plugin OFF" series
    pub plugin_active: bool,

    /// Whether the market is paused (no new orders or fills).
    pub paused: bool,

    /// Current best bid price in lots (0 if no bids).
    pub best_bid: u64,

    /// Current best ask price in lots (u64::MAX if no asks).
    pub best_ask: u64,

    /// Latest spread in basis points.
    /// Updated on every fill. Read by the dashboard SpreadMonitor.
    pub last_spread_bps: u16,

    /// Monotonically increasing order ID counter.
    /// Incremented on every place_order.
    pub next_order_id: u64,

    /// Total number of currently open orders.
    pub open_order_count: u32,

    /// Total volume traded through this market (in base lots).
    pub total_volume_lots: u64,

    /// Total number of fills (for stats display).
    pub total_fill_count: u32,

    /// PDA bump seed.
    pub bump: u8,
}

impl Market {
    pub const LEN: usize = 8  // discriminator
        + 32  // authority
        + 32  // base_mint
        + 32  // quote_mint
        + 8   // tick_size
        + 8   // lot_size
        + 1   // plugin_active
        + 1   // paused
        + 8   // best_bid
        + 8   // best_ask
        + 2   // last_spread_bps
        + 8   // next_order_id
        + 4   // open_order_count
        + 8   // total_volume_lots
        + 4   // total_fill_count
        + 1;  // bump

    /// Calculate spread in basis points from best_bid and best_ask.
    /// Returns 0 if either side is empty or the market is crossed.
    pub fn calculate_spread_bps(&self) -> u16 {
        // Guard: both sides must be populated and ask > bid
        if self.best_bid == 0
            || self.best_ask == 0
            || self.best_ask == u64::MAX
            || self.best_ask <= self.best_bid
        {
            return 0;
        }
        // Use u128 throughout to prevent overflow
        let bid = self.best_bid as u128;
        let ask = self.best_ask as u128;
        let mid = (bid + ask) / 2;
        if mid == 0 {
            return 0;
        }
        let spread_bps = ((ask - bid) * 10_000) / mid;
        // Clamp to u16 max (65535 bps = 655.35%) — anything above is meaningless
        spread_bps.min(u16::MAX as u128) as u16
    }
}

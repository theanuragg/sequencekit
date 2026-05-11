use anchor_lang::prelude::*;

/// Order — one PDA per open order.
///
/// Seeds: ["order", market.key, owner.key, order_id as [u8; 8]]
#[account]
pub struct Order {
    /// The market this order belongs to.
    pub market: Pubkey,

    /// The wallet that placed this order.
    /// Only this wallet can cancel or update the order.
    pub owner: Pubkey,

    /// Bid (buy base with quote) or Ask (sell base for quote).
    pub side: Side,

    /// Price in quote token lots.
    /// Must be a multiple of market.tick_size.
    pub price_lots: u64,

    /// Total order size in base token lots.
    pub size_lots: u64,

    /// How many lots have been filled so far.
    /// For a fresh order: filled_lots = 0.
    /// For a fully filled order: filled_lots == size_lots.
    pub filled_lots: u64,

    /// Current lifecycle status of this order.
    pub status: OrderStatus,

    /// Unix timestamp (seconds) when the order was placed.
    pub created_at: i64,

    /// Monotonically increasing ID within this market.
    /// Used to construct the order's PDA address.
    pub order_id: u64,

    /// PDA bump seed.
    pub bump: u8,
}

impl Order {
    pub const LEN: usize = 8   // discriminator
        + 32  // market
        + 32  // owner
        + 1   // side (enum)
        + 8   // price_lots
        + 8   // size_lots
        + 8   // filled_lots
        + 1   // status (enum)
        + 8   // created_at
        + 8   // order_id
        + 1;  // bump

    /// Remaining unfilled lots.
    pub fn remaining_lots(&self) -> u64 {
        self.size_lots.saturating_sub(self.filled_lots)
    }

    /// Whether this order can receive more fills.
    pub fn is_fillable(&self) -> bool {
        matches!(self.status, OrderStatus::Open | OrderStatus::PartiallyFilled)
            && self.remaining_lots() > 0
    }

    /// Whether this order can be cancelled.
    pub fn is_cancellable(&self) -> bool {
        matches!(self.status, OrderStatus::Open | OrderStatus::PartiallyFilled)
    }
}

/// Which side of the market this order is on.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    /// Bid: buyer wants to purchase base token using quote token.
    Bid,
    /// Ask: seller wants to sell base token for quote token.
    Ask,
}

/// Lifecycle status of an order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderStatus {
    /// Order is live and can be filled or cancelled.
    Open,
    /// Order has been partially filled and is still live.
    PartiallyFilled,
    /// Order has been fully filled. Terminal state.
    Filled,
    /// Order was cancelled before full fill. Terminal state.
    Cancelled,
}

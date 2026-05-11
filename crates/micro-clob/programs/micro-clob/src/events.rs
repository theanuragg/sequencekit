use anchor_lang::prelude::*;

/// Emitted when a new order is placed.
#[event]
pub struct OrderPlaced {
    pub market:    Pubkey,
    pub order_id:  u64,
    pub owner:     Pubkey,
    pub side:      u8,        // 0 = Bid, 1 = Ask
    pub price_lots: u64,
    pub size_lots:  u64,
    pub timestamp: i64,
}

/// Emitted when an order is cancelled (MAKER instruction).
/// In a BAM block with MakerShield active, this fires BEFORE any OrderFilled.
#[event]
pub struct OrderCancelled {
    pub market:         Pubkey,
    pub order_id:       u64,
    pub owner:          Pubkey,
    pub remaining_lots: u64,
    pub timestamp:      i64,
}

/// Emitted when a maker updates their quote price/size (MAKER instruction).
#[event]
pub struct QuoteUpdated {
    pub market:         Pubkey,
    pub order_id:       u64,
    pub old_price_lots: u64,
    pub new_price_lots: u64,
    pub old_size_lots:  u64,
    pub new_size_lots:  u64,
}

/// Emitted on every fill (TAKER instruction).
#[event]
pub struct OrderFilled {
    pub market:         Pubkey,
    pub maker_order_id: u64,
    pub maker:          Pubkey,
    pub taker:          Pubkey,
    pub price_lots:     u64,
    pub fill_size_lots: u64,
    pub timestamp:      i64,
}

/// ⭐ Primary dashboard signal — emitted on every fill AND on cancel.
///
/// SpreadMonitor chart subscribes to these events via connection.onLogs().
/// `plugin_active` tells the dashboard which series to update (ON vs OFF).
#[event]
pub struct SpreadChanged {
    pub market:        Pubkey,
    pub old_spread_bps: u16,
    pub new_spread_bps: u16,
    pub slot:           u64,
    /// Whether MakerShield was active when this event was emitted.
    pub plugin_active:  bool,
}

/// ⭐ Secondary dashboard signal — emitted on fills when MakerShield is active.
///
/// OrderingProof table subscribes to these. The BAM node populates
/// attestation_hash and maker_txs_count before publishing to BAM Explorer.
/// On-chain: attestation_hash is zeroed (32 bytes) as placeholder.
#[event]
pub struct OrderingProven {
    pub slot:             u64,
    pub market:           Pubkey,
    pub maker_txs_count:  u8,
    pub taker_txs_count:  u8,
    /// sha256 of final block ordering, signed by AMD SEV-SNP hardware.
    /// Zeroed on-chain — populated by BAM node plugin on_block_produced().
    pub attestation_hash: [u8; 32],
}

/// Emitted when the market authority toggles plugin_active.
#[event]
pub struct PluginToggled {
    pub market:    Pubkey,
    pub active:    bool,
    pub authority: Pubkey,
    pub slot:      u64,
}

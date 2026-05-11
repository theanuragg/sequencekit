//! # MicroCLOB — Minimal On-chain Order Book
//!
//! A minimal CLOB (Central Limit Order Book) Solana program demonstrating
//! MakerShield's cancel-before-fill ordering guarantee.
//!
//! ## Purpose
//!
//! This program is NOT designed to replace Drift or Phoenix.
//! It is designed to prove, with live on-chain evidence, that:
//!
//!   1. When MakerShield is OFF: fill_order can execute before cancel_order
//!      in the same block → maker suffers adverse selection → spread widens.
//!
//!   2. When MakerShield is ON: cancel_order always executes first → maker
//!      is protected → spread stays tight → TEE attestation proves it.
//!
//! ## Instructions
//!
//! - `initialize_market`  — create a new market (authority only)
//! - `place_order`        — any user places a bid or ask
//! - `cancel_order`       — maker removes an open order (MAKER instruction)
//! - `update_quote`       — maker modifies price/size (MAKER instruction)
//! - `fill_order`         — taker executes against a resting order (TAKER instruction)
//! - `toggle_plugin`      — authority toggles MakerShield on/off (for demo)

use anchor_lang::prelude::*;

pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("D2hmjC142DkGTZg8u8EXig3Kxci3nU7Qo8WLvwzrfoie");

#[program]
pub mod micro_clob {
    use super::*;

    /// Initialize a new market for a base/quote token pair.
    /// Only callable by the market authority.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        tick_size: u64,
        lot_size: u64,
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, tick_size, lot_size)
    }

    /// Create token vaults for an existing market.
    /// Must be called after initialize_market, before place_order.
    pub fn create_vaults(ctx: Context<CreateVaults>) -> Result<()> {
        instructions::create_vaults::handler(ctx)
    }

    /// Place a new bid or ask order.
    /// Locks collateral in the caller's UserPosition account.
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        price_lots: u64,
        size_lots: u64,
    ) -> Result<()> {
        instructions::place_order::handler(ctx, side, price_lots, size_lots)
    }

    /// Cancel an open order and return collateral to the owner.
    ///
    /// ⚠️  MAKER instruction — MakerShield tags this MAKER_PRIORITY.
    /// When MakerShield is active, this executes BEFORE any fill_order
    /// in the same block. This is the core of the protection guarantee.
    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        instructions::cancel_order::handler(ctx, order_id)
    }

    /// Modify price and/or size of an existing open order.
    ///
    /// ⚠️  MAKER instruction — MakerShield tags this MAKER_PRIORITY.
    /// Allows makers to update stale quotes without risk of being filled
    /// at the old price in the same block.
    pub fn update_quote(
        ctx: Context<UpdateQuote>,
        order_id: u64,
        new_price_lots: u64,
        new_size_lots: u64,
    ) -> Result<()> {
        instructions::update_quote::handler(ctx, order_id, new_price_lots, new_size_lots)
    }

    /// Execute a fill against a resting maker order.
    ///
    /// TAKER instruction — MakerShield places this AFTER all MAKER_PRIORITY txs.
    /// If a cancel_order and fill_order arrive in the same block:
    ///   - MakerShield ON:  cancel executes first → fill sees cancelled order → fails
    ///   - MakerShield OFF: random order → ~50% chance fill executes first → maker loss
    pub fn fill_order(
        ctx: Context<FillOrder>,
        maker_order_id: u64,
        fill_size_lots: u64,
    ) -> Result<()> {
        instructions::fill_order::handler(ctx, maker_order_id, fill_size_lots)
    }

    /// Toggle MakerShield plugin_active flag on the market.
    /// Used in the demo to show spread delta with plugin ON vs OFF.
    pub fn toggle_plugin(ctx: Context<TogglePlugin>, active: bool) -> Result<()> {
        instructions::toggle_plugin::handler(ctx, active)
    }
}

// ─── Error codes ──────────────────────────────────────────────────────────────

#[error_code]
pub enum MicroClobError {
    #[msg("Price must be a multiple of tick_size")]
    InvalidTick,
    #[msg("Size must be at least lot_size")]
    SizeTooSmall,
    #[msg("Only the order owner can cancel or update")]
    Unauthorized,
    #[msg("Order is not in a cancellable state")]
    OrderNotCancellable,
    #[msg("Order is not open — cannot update")]
    OrderNotOpen,
    #[msg("Fill size exceeds remaining order size")]
    FillTooLarge,
    #[msg("Order is not in a fillable state")]
    OrderNotFillable,
    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Arithmetic overflow")]
    Overflow,
}

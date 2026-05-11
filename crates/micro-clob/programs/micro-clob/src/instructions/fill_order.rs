//! fill_order — TAKER instruction.
//!
//! MakerShield sequences this AFTER cancel_order/update_quote in the same slot.
//! Performs real SPL token transfers via CPI.

use crate::{
    events::{OrderFilled, OrderingProven, SpreadChanged},
    state::{Market, Order, OrderStatus, Side, UserPosition},
    MicroClobError,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub fn handler(
    ctx: Context<FillOrder>,
    maker_order_id: u64,
    fill_size_lots: u64,
) -> Result<()> {
    require!(!ctx.accounts.market.paused, MicroClobError::MarketPaused);

    {
        let order = &ctx.accounts.maker_order;
        require!(order.is_fillable(), MicroClobError::OrderNotFillable);
        require!(fill_size_lots > 0, MicroClobError::SizeTooSmall);
        require!(
            fill_size_lots <= order.remaining_lots(),
            MicroClobError::FillTooLarge
        );
    }

    let fill_price = ctx.accounts.maker_order.price_lots;
    let order_side = ctx.accounts.maker_order.side;

    let market_seeds: &[&[u8]] = &[
        b"market",
        ctx.accounts.market.base_mint.as_ref(),
        ctx.accounts.market.quote_mint.as_ref(),
        &[ctx.accounts.market.bump],
    ];
    let signer_seeds = &[market_seeds];

    match order_side {
        Side::Ask => {
            // base_vault → taker_base, taker_quote → maker_quote
            let base_amount = fill_size_lots
                .checked_mul(ctx.accounts.market.lot_size)
                .ok_or(MicroClobError::Overflow)?;
            let quote_amount = fill_size_lots
                .checked_mul(fill_price)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(ctx.accounts.market.tick_size)
                .ok_or(MicroClobError::Overflow)?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.base_vault.to_account_info(),
                        to: ctx.accounts.taker_base_account.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                base_amount,
            )?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.taker_quote_account.to_account_info(),
                        to: ctx.accounts.maker_quote_account.to_account_info(),
                        authority: ctx.accounts.taker.to_account_info(),
                    },
                ),
                quote_amount,
            )?;
        }
        Side::Bid => {
            // quote_vault → taker_quote, taker_base → maker_base
            let base_amount = fill_size_lots
                .checked_mul(ctx.accounts.market.lot_size)
                .ok_or(MicroClobError::Overflow)?;
            let quote_amount = fill_size_lots
                .checked_mul(fill_price)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(ctx.accounts.market.tick_size)
                .ok_or(MicroClobError::Overflow)?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.quote_vault.to_account_info(),
                        to: ctx.accounts.taker_quote_account.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                quote_amount,
            )?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.taker_base_account.to_account_info(),
                        to: ctx.accounts.maker_base_account.to_account_info(),
                        authority: ctx.accounts.taker.to_account_info(),
                    },
                ),
                base_amount,
            )?;
        }
    }

    // Update order
    let order = &mut ctx.accounts.maker_order;
    order.filled_lots = order
        .filled_lots
        .checked_add(fill_size_lots)
        .ok_or(MicroClobError::Overflow)?;
    order.status = if order.filled_lots == order.size_lots {
        OrderStatus::Filled
    } else {
        OrderStatus::PartiallyFilled
    };
    let order_status = order.status;

    // Update maker position
    let maker_position = &mut ctx.accounts.maker_position;
    match order_side {
        Side::Ask => {
            maker_position.base_locked =
                maker_position.base_locked.saturating_sub(fill_size_lots);
        }
        Side::Bid => {
            let q = fill_size_lots
                .checked_mul(fill_price)
                .ok_or(MicroClobError::Overflow)?;
            maker_position.quote_locked = maker_position.quote_locked.saturating_sub(q);
        }
    }
    maker_position.fill_count = maker_position.fill_count.saturating_add(1);

    // Update taker position
    ctx.accounts.taker_position.fill_count =
        ctx.accounts.taker_position.fill_count.saturating_add(1);

    // Update market
    let market = &mut ctx.accounts.market;
    let old_spread = market.last_spread_bps;
    market.total_volume_lots = market
        .total_volume_lots
        .checked_add(fill_size_lots)
        .ok_or(MicroClobError::Overflow)?;
    market.total_fill_count = market.total_fill_count.saturating_add(1);

    if order_status == OrderStatus::Filled {
        market.open_order_count = market.open_order_count.saturating_sub(1);
        match order_side {
            Side::Bid => {
                if fill_price == market.best_bid {
                    market.best_bid = 0;
                }
            }
            Side::Ask => {
                if fill_price == market.best_ask {
                    market.best_ask = u64::MAX;
                }
            }
        }
    }

    market.last_spread_bps = market.calculate_spread_bps();
    let slot = Clock::get()?.slot;
    let plugin_active = market.plugin_active;
    let market_key = market.key();

    emit!(OrderFilled {
        market: market_key,
        maker_order_id,
        maker: ctx.accounts.maker_order_owner.key(),
        taker: ctx.accounts.taker.key(),
        price_lots: fill_price,
        fill_size_lots,
        timestamp: Clock::get()?.unix_timestamp,
    });

    emit!(SpreadChanged {
        market: market_key,
        old_spread_bps: old_spread,
        new_spread_bps: market.last_spread_bps,
        slot,
        plugin_active,
    });

    if plugin_active {
        emit!(OrderingProven {
            slot,
            market: market_key,
            maker_txs_count: 0,  // BAM node fills in from TxMetadata
            taker_txs_count: 1,
            attestation_hash: [0u8; 32], // BAM node populates from TEE
        });
    }

    msg!(
        "Fill: {} lots @ {} | spread {}→{} bps | plugin={}",
        fill_size_lots, fill_price, old_spread, market.last_spread_bps, plugin_active
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(maker_order_id: u64)]
pub struct FillOrder<'info> {
    #[account(
        mut,
        seeds = [b"market", market.base_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: verified by PDA constraint on maker_order
    pub maker_order_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"order",
            market.key().as_ref(),
            maker_order_owner.key().as_ref(),
            &maker_order_id.to_le_bytes()
        ],
        bump = maker_order.bump,
        constraint = maker_order.market == market.key() @ MicroClobError::Unauthorized,
        constraint = maker_order.owner  == maker_order_owner.key() @ MicroClobError::Unauthorized,
    )]
    pub maker_order: Box<Account<'info, Order>>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), maker_order_owner.key().as_ref()],
        bump = maker_position.bump
    )]
    pub maker_position: Box<Account<'info, UserPosition>>,

    #[account(
        init_if_needed,
        payer = taker,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), taker.key().as_ref()],
        bump
    )]
    pub taker_position: Box<Account<'info, UserPosition>>,

    #[account(mut, token::authority = market, token::mint = market.base_mint)]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = market, token::mint = market.quote_mint)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = taker, token::mint = market.base_mint)]
    pub taker_base_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = taker, token::mint = market.quote_mint)]
    pub taker_quote_account: Box<Account<'info, TokenAccount>>,

    /// Maker's base account (receives on Bid fill)
    #[account(mut)]
    pub maker_base_account: Box<Account<'info, TokenAccount>>,

    /// Maker's quote account (receives on Ask fill)
    #[account(mut)]
    pub maker_quote_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub taker: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

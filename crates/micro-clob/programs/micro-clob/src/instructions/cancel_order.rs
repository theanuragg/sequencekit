//! cancel_order — MAKER instruction.
//!
//! MakerShield guarantees this executes BEFORE any fill_order in the same slot.
//! Returns locked collateral from vault to owner via CPI.

use crate::{
    events::{OrderCancelled, SpreadChanged},
    state::{Market, Order, OrderStatus, Side, UserPosition},
    MicroClobError,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub fn handler(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
    let order = &ctx.accounts.maker_order;
    require!(order.owner == ctx.accounts.owner.key(), MicroClobError::Unauthorized);
    require!(order.is_cancellable(), MicroClobError::OrderNotCancellable);

    let remaining_lots = order.remaining_lots();
    let price_lots     = order.price_lots;
    let order_side     = order.side;

    // Market PDA signs for vault withdrawals
    let market_seeds: &[&[u8]] = &[
        b"market",
        ctx.accounts.market.base_mint.as_ref(),
        ctx.accounts.market.quote_mint.as_ref(),
        &[ctx.accounts.market.bump],
    ];
    let signer_seeds = &[market_seeds];

    match order_side {
        Side::Ask => {
            let base_amount = remaining_lots
                .checked_mul(ctx.accounts.market.lot_size)
                .ok_or(MicroClobError::Overflow)?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.base_vault.to_account_info(),
                        to: ctx.accounts.owner_base_account.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                base_amount,
            )?;
        }
        Side::Bid => {
            let quote_amount = remaining_lots
                .checked_mul(price_lots)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(ctx.accounts.market.tick_size)
                .ok_or(MicroClobError::Overflow)?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.quote_vault.to_account_info(),
                        to: ctx.accounts.owner_quote_account.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                quote_amount,
            )?;
        }
    }

    let order = &mut ctx.accounts.maker_order;
    order.status = OrderStatus::Cancelled;

    let position = &mut ctx.accounts.position;
    match order_side {
        Side::Ask => {
            position.base_locked = position.base_locked.saturating_sub(remaining_lots);
        }
        Side::Bid => {
            let q = remaining_lots
                .checked_mul(price_lots)
                .ok_or(MicroClobError::Overflow)?;
            position.quote_locked = position.quote_locked.saturating_sub(q);
        }
    }

    let market = &mut ctx.accounts.market;
    market.open_order_count = market.open_order_count.saturating_sub(1);
    match order_side {
        Side::Bid => {
            if price_lots >= market.best_bid {
                market.best_bid = 0;
            }
        }
        Side::Ask => {
            if price_lots <= market.best_ask {
                market.best_ask = u64::MAX;
            }
        }
    }

    let old_spread = market.last_spread_bps;
    market.last_spread_bps = market.calculate_spread_bps();
    let slot = Clock::get()?.slot;

    emit!(OrderCancelled {
        market: market.key(),
        order_id,
        owner: ctx.accounts.owner.key(),
        remaining_lots,
        timestamp: Clock::get()?.unix_timestamp,
    });

    if old_spread != market.last_spread_bps {
        emit!(SpreadChanged {
            market: market.key(),
            old_spread_bps: old_spread,
            new_spread_bps: market.last_spread_bps,
            slot,
            plugin_active: market.plugin_active,
        });
    }

    msg!(
        "CancelOrder id={} remaining={} spread={}→{}",
        order_id, remaining_lots, old_spread, market.last_spread_bps
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        seeds = [b"market", market.base_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [
            b"order",
            market.key().as_ref(),
            owner.key().as_ref(),
            &order_id.to_le_bytes()
        ],
        bump = maker_order.bump,
        constraint = maker_order.market == market.key() @ MicroClobError::Unauthorized,
        constraint = maker_order.owner  == owner.key()  @ MicroClobError::Unauthorized,
    )]
    pub maker_order: Account<'info, Order>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, UserPosition>,

    #[account(mut, token::authority = market, token::mint = market.base_mint)]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = market, token::mint = market.quote_mint)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = owner, token::mint = market.base_mint)]
    pub owner_base_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = owner, token::mint = market.quote_mint)]
    pub owner_quote_account: Box<Account<'info, TokenAccount>>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

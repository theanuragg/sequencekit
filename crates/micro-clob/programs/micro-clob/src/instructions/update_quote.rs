//! update_quote — MAKER instruction.
//!
//! Atomically updates price and/or size of an open order.
//! Rebalances vault collateral: deposits more if new requirement > old, withdraws if less.
//! MakerShield guarantees this executes before any fill in the same slot.

use crate::{
    events::QuoteUpdated,
    state::{Market, Order, OrderStatus, Side, UserPosition},
    MicroClobError,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub fn handler(
    ctx: Context<UpdateQuote>,
    order_id: u64,
    new_price_lots: u64,
    new_size_lots: u64,
) -> Result<()> {
    let market = &ctx.accounts.market;
    let order  = &ctx.accounts.order;

    require!(order.owner == ctx.accounts.owner.key(), MicroClobError::Unauthorized);
    require!(order.status == OrderStatus::Open, MicroClobError::OrderNotOpen);
    require!(new_price_lots % market.tick_size == 0, MicroClobError::InvalidTick);
    require!(new_size_lots >= market.lot_size, MicroClobError::SizeTooSmall);

    let old_price = order.price_lots;
    let old_size  = order.size_lots;
    let order_side = order.side;
    let tick_size = market.tick_size;
    let lot_size  = market.lot_size;

    let market_seeds: &[&[u8]] = &[
        b"market",
        ctx.accounts.market.base_mint.as_ref(),
        ctx.accounts.market.quote_mint.as_ref(),
        &[ctx.accounts.market.bump],
    ];
    let signer_seeds = &[market_seeds];

    match order_side {
        Side::Ask => {
            let old_col = old_size
                .checked_mul(lot_size)
                .ok_or(MicroClobError::Overflow)?;
            let new_col = new_size_lots
                .checked_mul(lot_size)
                .ok_or(MicroClobError::Overflow)?;

            if new_col > old_col {
                let delta = new_col - old_col;
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.owner_base_account.to_account_info(),
                            to: ctx.accounts.base_vault.to_account_info(),
                            authority: ctx.accounts.owner.to_account_info(),
                        },
                    ),
                    delta,
                )?;
                ctx.accounts.position.base_locked = ctx
                    .accounts
                    .position
                    .base_locked
                    .checked_add(delta)
                    .ok_or(MicroClobError::Overflow)?;
            } else if old_col > new_col {
                let delta = old_col - new_col;
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
                    delta,
                )?;
                ctx.accounts.position.base_locked =
                    ctx.accounts.position.base_locked.saturating_sub(delta);
            }
        }
        Side::Bid => {
            let old_col = old_price
                .checked_mul(old_size)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(tick_size)
                .ok_or(MicroClobError::Overflow)?;
            let new_col = new_price_lots
                .checked_mul(new_size_lots)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(tick_size)
                .ok_or(MicroClobError::Overflow)?;

            if new_col > old_col {
                let delta = new_col - old_col;
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.owner_quote_account.to_account_info(),
                            to: ctx.accounts.quote_vault.to_account_info(),
                            authority: ctx.accounts.owner.to_account_info(),
                        },
                    ),
                    delta,
                )?;
                ctx.accounts.position.quote_locked = ctx
                    .accounts
                    .position
                    .quote_locked
                    .checked_add(delta)
                    .ok_or(MicroClobError::Overflow)?;
            } else if old_col > new_col {
                let delta = old_col - new_col;
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
                    delta,
                )?;
                ctx.accounts.position.quote_locked =
                    ctx.accounts.position.quote_locked.saturating_sub(delta);
            }
        }
    }

    let order = &mut ctx.accounts.order;
    order.price_lots = new_price_lots;
    order.size_lots  = new_size_lots;

    let market = &mut ctx.accounts.market;
    match order_side {
        Side::Bid => {
            if old_price == market.best_bid || new_price_lots > market.best_bid {
                market.best_bid = new_price_lots;
            }
        }
        Side::Ask => {
            if old_price == market.best_ask || new_price_lots < market.best_ask {
                market.best_ask = new_price_lots;
            }
        }
    }

    emit!(QuoteUpdated {
        market: market.key(),
        order_id,
        old_price_lots: old_price,
        new_price_lots,
        old_size_lots: old_size,
        new_size_lots,
    });

    msg!(
        "UpdateQuote id={} price={}→{} size={}→{}",
        order_id, old_price, new_price_lots, old_size, new_size_lots
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct UpdateQuote<'info> {
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
        bump = order.bump,
        constraint = order.market == market.key() @ MicroClobError::Unauthorized,
        constraint = order.owner  == owner.key()  @ MicroClobError::Unauthorized,
    )]
    pub order: Account<'info, Order>,

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

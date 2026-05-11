use crate::{
    events::OrderPlaced,
    state::{Market, Order, OrderStatus, Side, UserPosition},
    MicroClobError,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub fn handler(
    ctx: Context<PlaceOrder>,
    side: Side,
    price_lots: u64,
    size_lots: u64,
) -> Result<()> {
    let market = &ctx.accounts.market;

    require!(!market.paused, MicroClobError::MarketPaused);
    require!(price_lots % market.tick_size == 0, MicroClobError::InvalidTick);
    require!(size_lots >= market.lot_size, MicroClobError::SizeTooSmall);

    // Deposit collateral into vault
    match side {
        Side::Ask => {
            let base_amount = size_lots
                .checked_mul(market.lot_size)
                .ok_or(MicroClobError::Overflow)?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.owner_base_account.to_account_info(),
                        to: ctx.accounts.base_vault.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                base_amount,
            )?;
        }
        Side::Bid => {
            let quote_amount = price_lots
                .checked_mul(size_lots)
                .ok_or(MicroClobError::Overflow)?
                .checked_mul(market.tick_size)
                .ok_or(MicroClobError::Overflow)?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.owner_quote_account.to_account_info(),
                        to: ctx.accounts.quote_vault.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                quote_amount,
            )?;
        }
    }

    // Update position
    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner  = ctx.accounts.owner.key();
        position.market = ctx.accounts.market.key();
        position.bump   = ctx.bumps.position;
    }
    match side {
        Side::Ask => {
            position.base_locked = position
                .base_locked
                .checked_add(size_lots)
                .ok_or(MicroClobError::Overflow)?;
        }
        Side::Bid => {
            let lock = price_lots
                .checked_mul(size_lots)
                .ok_or(MicroClobError::Overflow)?;
            position.quote_locked = position
                .quote_locked
                .checked_add(lock)
                .ok_or(MicroClobError::Overflow)?;
        }
    }

    // Update market
    let market = &mut ctx.accounts.market;
    let order_id = market.next_order_id;
    market.next_order_id = market
        .next_order_id
        .checked_add(1)
        .ok_or(MicroClobError::Overflow)?;
    market.open_order_count = market
        .open_order_count
        .checked_add(1)
        .ok_or(MicroClobError::Overflow)?;
    match side {
        Side::Bid => {
            if price_lots > market.best_bid {
                market.best_bid = price_lots;
            }
        }
        Side::Ask => {
            if price_lots < market.best_ask {
                market.best_ask = price_lots;
            }
        }
    }

    // Write order
    let order = &mut ctx.accounts.order;
    order.market     = ctx.accounts.market.key();
    order.owner      = ctx.accounts.owner.key();
    order.side       = side;
    order.price_lots = price_lots;
    order.size_lots  = size_lots;
    order.filled_lots = 0;
    order.status     = OrderStatus::Open;
    order.created_at = Clock::get()?.unix_timestamp;
    order.order_id   = order_id;
    order.bump       = ctx.bumps.order;

    emit!(OrderPlaced {
        market: ctx.accounts.market.key(),
        order_id,
        owner: ctx.accounts.owner.key(),
        side: side as u8,
        price_lots,
        size_lots,
        timestamp: order.created_at,
    });

    msg!(
        "PlaceOrder id={} side={:?} price={} size={}",
        order_id, side, price_lots, size_lots
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(side: Side, price_lots: u64, size_lots: u64)]
pub struct PlaceOrder<'info> {
    #[account(
        mut,
        seeds = [b"market", market.base_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// Order PDA — seed uses next_order_id before increment
    #[account(
        init,
        payer = owner,
        space = Order::LEN,
        seeds = [
            b"order",
            market.key().as_ref(),
            owner.key().as_ref(),
            &market.next_order_id.to_le_bytes()
        ],
        bump
    )]
    pub order: Box<Account<'info, Order>>,

    #[account(
        init_if_needed,
        payer = owner,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, UserPosition>>,

    /// Base token vault — verified via token authority (market PDA) and mint
    #[account(
        mut,
        token::authority = market,
        token::mint = market.base_mint,
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    /// Quote token vault — verified via token authority and mint
    #[account(
        mut,
        token::authority = market,
        token::mint = market.quote_mint,
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    /// Owner's base token account
    #[account(
        mut,
        token::authority = owner,
        token::mint = market.base_mint,
    )]
    pub owner_base_account: Box<Account<'info, TokenAccount>>,

    /// Owner's quote token account
    #[account(
        mut,
        token::authority = owner,
        token::mint = market.quote_mint,
    )]
    pub owner_quote_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

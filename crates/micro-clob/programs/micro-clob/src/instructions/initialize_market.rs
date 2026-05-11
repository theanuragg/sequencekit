use crate::state::Market;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

pub fn handler(ctx: Context<InitializeMarket>, tick_size: u64, lot_size: u64) -> Result<()> {
    require!(tick_size > 0, crate::MicroClobError::InvalidTick);
    require!(lot_size  > 0, crate::MicroClobError::SizeTooSmall);

    let market = &mut ctx.accounts.market;
    market.authority         = ctx.accounts.authority.key();
    market.base_mint         = ctx.accounts.base_mint.key();
    market.quote_mint        = ctx.accounts.quote_mint.key();
    market.tick_size         = tick_size;
    market.lot_size          = lot_size;
    market.plugin_active     = false;
    market.paused            = false;
    market.best_bid          = 0;
    market.best_ask          = u64::MAX;
    market.last_spread_bps   = 0;
    market.next_order_id     = 0;
    market.open_order_count  = 0;
    market.total_volume_lots = 0;
    market.total_fill_count  = 0;
    market.bump              = ctx.bumps.market;

    msg!("Market initialised: {} tick={} lot={}", ctx.accounts.market.key(), tick_size, lot_size);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", base_mint.key().as_ref(), quote_mint.key().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,

    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

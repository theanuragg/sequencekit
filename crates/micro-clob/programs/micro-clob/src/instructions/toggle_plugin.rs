use crate::{events::PluginToggled, state::Market};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<TogglePlugin>, active: bool) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.plugin_active = active;

    let slot = Clock::get()?.slot;

    emit!(PluginToggled {
        market: ctx.accounts.market.key(),
        active,
        authority: ctx.accounts.authority.key(),
        slot,
    });

    msg!("MakerShield plugin_active = {} for market {}", active, ctx.accounts.market.key());
    Ok(())
}

#[derive(Accounts)]
pub struct TogglePlugin<'info> {
    #[account(
        mut,
        seeds = [b"market", market.base_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump,
        constraint = market.authority == authority.key()
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

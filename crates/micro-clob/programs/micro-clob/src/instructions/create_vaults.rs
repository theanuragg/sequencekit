use crate::state::Market;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, InitializeAccount, Token, TokenAccount};

pub fn handler(ctx: Context<CreateVaults>) -> Result<()> {
    let market_key = ctx.accounts.market.key();
    let market_bump = ctx.accounts.market.bump;
    let vault_lamports = ctx.accounts.rent.minimum_balance(TokenAccount::LEN);

    let base_vault_seeds = &[b"base_vault", market_key.as_ref(), &[ctx.bumps.base_vault]];
    let quote_vault_seeds = &[b"quote_vault", market_key.as_ref(), &[ctx.bumps.quote_vault]];
    let base_vault_signer = &[&base_vault_seeds[..]];
    let quote_vault_signer = &[&quote_vault_seeds[..]];

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
            },
            base_vault_signer,
        ),
        vault_lamports,
        TokenAccount::LEN as u64,
        &anchor_spl::token::ID,
    )?;

    let market_seeds = &[b"market", ctx.accounts.market.base_mint.as_ref(), ctx.accounts.market.quote_mint.as_ref(), &[market_bump]];
    let market_signer = &[&market_seeds[..]];

    token::initialize_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            InitializeAccount {
                account: ctx.accounts.base_vault.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            market_signer,
        ),
    )?;

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
            },
            quote_vault_signer,
        ),
        vault_lamports,
        TokenAccount::LEN as u64,
        &anchor_spl::token::ID,
    )?;

    token::initialize_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            InitializeAccount {
                account: ctx.accounts.quote_vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            market_signer,
        ),
    )?;

    msg!("Vaults created for market {}", market_key);
    Ok(())
}

#[derive(Accounts)]
pub struct CreateVaults<'info> {
    #[account(
        mut,
        seeds = [b"market", market.base_mint.as_ref(), market.quote_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"base_vault", market.key().as_ref()],
        bump
    )]
    /// CHECK: PDA validated by seeds, created via system program CPI
    pub base_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"quote_vault", market.key().as_ref()],
        bump
    )]
    /// CHECK: PDA validated by seeds, created via system program CPI
    pub quote_vault: UncheckedAccount<'info>,

    /// CHECK: verified by initialize_account CPI
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: verified by initialize_account CPI
    pub quote_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

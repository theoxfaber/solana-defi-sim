use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct ConditionalTransfer<'info> {
    pub from: Signer<'info>,
    #[account(
        mut,
        constraint = from_token_account.owner == from.key() @ ErrorCode::InvalidTokenAccountOwner
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [b"allowlist"],
        bump,
    )]
    pub allowlist: Account<'info, Allowlist>,
    
    #[account(
        seeds = [b"wallet_entry", from.key().as_ref()],
        bump
    )]
    pub wallet_entry: Account<'info, WalletEntry>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ConditionalTransfer>, amount: u64) -> Result<()> {
    let allowlist = &ctx.accounts.allowlist;
    let wallet_entry = &ctx.accounts.wallet_entry;

    // Liquidity Gatekeeper Logic
    let is_allowed = !allowlist.is_enabled || (wallet_entry.is_allowed && wallet_entry.wallet == ctx.accounts.from.key());

    emit!(TransferChecked {
        from: ctx.accounts.from.key(),
        to: ctx.accounts.to_token_account.key(),
        amount,
        success: is_allowed,
    });

    require!(is_allowed, ErrorCode::TransferNotAllowed);

    // Perform CPI transfer
    let cpi_accounts = Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.from.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}

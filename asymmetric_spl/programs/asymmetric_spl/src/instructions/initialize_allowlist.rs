use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeAllowlist<'info> {
    #[account(
        init,
        payer = authority,
        space = Allowlist::LEN,
        seeds = [b"allowlist"],
        bump
    )]
    pub allowlist: Account<'info, Allowlist>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeAllowlist>) -> Result<()> {
    let allowlist = &mut ctx.accounts.allowlist;
    allowlist.authority = ctx.accounts.authority.key();
    allowlist.is_enabled = true;
    allowlist.bump = ctx.bumps.allowlist;

    emit!(AllowlistInitialized {
        authority: allowlist.authority,
    });

    Ok(())
}

use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct SetWalletStatus<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = WalletEntry::LEN,
        seeds = [b"wallet_entry", target_wallet.key().as_ref()],
        bump
    )]
    pub wallet_entry: Account<'info, WalletEntry>,
    /// CHECK: Target wallet pubkey
    pub target_wallet: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"allowlist"],
        bump,
        has_one = authority @ ErrorCode::InvalidAuthority
    )]
    pub allowlist: Account<'info, Allowlist>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetWalletStatus>, is_allowed: bool) -> Result<()> {
    let wallet_entry = &mut ctx.accounts.wallet_entry;
    wallet_entry.wallet = ctx.accounts.target_wallet.key();
    wallet_entry.is_allowed = is_allowed;
    wallet_entry.bump = ctx.bumps.wallet_entry;

    emit!(WalletStatusUpdated {
        wallet: wallet_entry.wallet,
        is_allowed,
    });

    Ok(())
}

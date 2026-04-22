use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK");

#[program]
pub mod asymmetric_spl {
    use super::*;

    pub fn initialize_allowlist(ctx: Context<InitializeAllowlist>) -> Result<()> {
        let allowlist = &mut ctx.accounts.allowlist;
        allowlist.authority = ctx.accounts.authority.key();
        allowlist.pending_authority = Pubkey::default();
        allowlist.is_enabled = true;
        allowlist.bump = ctx.bumps.allowlist;
        
        emit!(AllowlistInitialized {
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }

    pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
        let allowlist = &mut ctx.accounts.allowlist;
        allowlist.pending_authority = new_authority;

        emit!(AuthorityProposed {
            current: allowlist.authority,
            pending: new_authority,
        });
        Ok(())
    }

    pub fn claim_authority(ctx: Context<ClaimAuthority>) -> Result<()> {
        let allowlist = &mut ctx.accounts.allowlist;
        let old_authority = allowlist.authority;
        
        allowlist.authority = allowlist.pending_authority;
        allowlist.pending_authority = Pubkey::default();

        emit!(AuthorityClaimed {
            old: old_authority,
            new: allowlist.authority,
        });
        Ok(())
    }

    pub fn set_wallet_status(ctx: Context<SetWalletStatus>, is_allowed: bool) -> Result<()> {
        let wallet_entry = &mut ctx.accounts.wallet_entry;
        wallet_entry.wallet = ctx.accounts.target_wallet.key();
        wallet_entry.is_allowed = is_allowed;
        wallet_entry.bump = ctx.bumps.wallet_entry;

        emit!(WalletStatusUpdated {
            wallet: ctx.accounts.target_wallet.key(),
            is_allowed,
        });
        Ok(())
    }

    pub fn conditional_transfer(ctx: Context<ConditionalTransfer>, amount: u64) -> Result<()> {
        let allowlist = &ctx.accounts.allowlist;
        let wallet_entry = &ctx.accounts.wallet_entry;

        // Liquidity Gatekeeper Logic
        // 1. If allowlist is disabled, allow all.
        // 2. If enabled, the 'from' wallet must have a wallet_entry with is_allowed = true.
        let is_allowed = !allowlist.is_enabled || wallet_entry.is_allowed;

        // CRITICAL: Emit event BEFORE the require! check as requested.
        emit!(TransferChecked {
            from: ctx.accounts.from.key(),
            to: ctx.accounts.to_token_account.key(),
            amount,
            success: is_allowed,
        });

        require!(is_allowed, ErrorCode::TransferNotAllowed);

        // Perform CPI transfer using Anchor 1.0 / Modern syntax
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
}

#[derive(Accounts)]
pub struct InitializeAllowlist<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1 + 1, // Added 32 for pending_authority
        seeds = [b"allowlist"],
        bump
    )]
    pub allowlist: Account<'info, Allowlist>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::InvalidAuthority,
        seeds = [b"allowlist"],
        bump = allowlist.bump,
    )]
    pub allowlist: Account<'info, Allowlist>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimAuthority<'info> {
    #[account(
        mut,
        constraint = allowlist.pending_authority == pending_authority.key() @ ErrorCode::NotPendingAuthority,
        seeds = [b"allowlist"],
        bump = allowlist.bump,
    )]
    pub allowlist: Account<'info, Allowlist>,
    pub pending_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetWalletStatus<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 32 + 1 + 1,
        seeds = [b"wallet", allowlist.key().as_ref(), target_wallet.key().as_ref()],
        bump
    )]
    pub wallet_entry: Account<'info, WalletEntry>,
    /// CHECK: Target wallet being allowed/blocked
    pub target_wallet: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = authority @ ErrorCode::InvalidAuthority,
        seeds = [b"allowlist"],
        bump = allowlist.bump,
    )]
    pub allowlist: Account<'info, Allowlist>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

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
        bump = allowlist.bump,
    )]
    pub allowlist: Account<'info, Allowlist>,
    
    #[account(
        seeds = [b"wallet", allowlist.key().as_ref(), from.key().as_ref()],
        bump = wallet_entry.bump
    )]
    pub wallet_entry: Account<'info, WalletEntry>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Allowlist {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub is_enabled: bool,
    pub bump: u8,
}

#[account]
pub struct WalletEntry {
    pub wallet: Pubkey,
    pub is_allowed: bool,
    pub bump: u8,
}

#[event]
pub struct AllowlistInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct WalletStatusUpdated {
    pub wallet: Pubkey,
    pub is_allowed: bool,
}

#[event]
pub struct TransferChecked {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub success: bool,
}

#[event]
pub struct AuthorityProposed {
    pub current: Pubkey,
    pub pending: Pubkey,
}

#[event]
pub struct AuthorityClaimed {
    pub old: Pubkey,
    pub new: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The provided authority does not match the allowlist authority.")]
    InvalidAuthority,
    #[msg("Transfer not allowed due to Liquidity Gatekeeper restrictions.")]
    TransferNotAllowed,
    #[msg("Invalid token account owner.")]
    InvalidTokenAccountOwner,
    #[msg("Only the pending authority can claim this role.")]
    NotPendingAuthority,
}

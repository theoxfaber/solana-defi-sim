use anchor_lang::prelude::*;

#[account]
pub struct Allowlist {
    pub authority: Pubkey,
    pub is_enabled: bool,
    pub bump: u8,
}

impl Allowlist {
    pub const LEN: usize = 8 + 32 + 1 + 1;
}

#[account]
pub struct WalletEntry {
    pub wallet: Pubkey,
    pub is_allowed: bool,
    pub bump: u8,
}

impl WalletEntry {
    pub const LEN: usize = 8 + 32 + 1 + 1;
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

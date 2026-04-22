use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The provided authority does not match the allowlist authority.")]
    InvalidAuthority,
    #[msg("Transfer not allowed due to Liquidity Gatekeeper restrictions.")]
    TransferNotAllowed,
    #[msg("Numerical overflow in calculation.")]
    NumericalOverflow,
    #[msg("Invalid token account owner.")]
    InvalidTokenAccountOwner,
}

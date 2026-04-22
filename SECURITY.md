# Security Policy

## Supported Versions

The following versions of the Solana DeFi Stress Simulator are currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| v1.0.x  | :white_check_mark: |
| < v1.0  | :x:                |

## Reporting a Vulnerability

Security is a top priority for this project. As this is a research-focused simulator, we take the handling of private keys and on-chain logic very seriously.

If you discover a potential vulnerability, please do NOT create a public issue. Instead, follow these steps:

1.  **Direct Disclosure**: Contact the project maintainer directly via GitHub or the contact info provided in the repository bio.
2.  **Incident Lifecycle**: We will acknowledge your report within 48 hours and provide a timeline for a resolution.
3.  **Coordinated Release**: We will issue a security advisory along with a patch.

## Private Key Safety Model

This project uses a **Local-Only Identity Model**:
- **Zero-Committal**: The `.gitignore` is configured to block all `*-keypair.json` and `.env` files.
- **Ephemeral Keys**: It is recommended to use the generated `simulator_keypair.json` only for local stress testing and never fund it with mainnet assets.
- **On-Chain Gating**: The Authority Rotation pattern (Propose -> Claim) is designed to mitigate unauthorized access during administrative transfers.

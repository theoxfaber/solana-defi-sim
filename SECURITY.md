# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| v1.0.x  | :white_check_mark: |
| < v1.0  | :x:                |

## Reporting a Vulnerability

If you discover a potential vulnerability, please do NOT create a public issue. Instead:

1.  **Direct Disclosure**: Contact the project maintainer directly via GitHub.
2.  **Incident Lifecycle**: We will acknowledge your report within 48 hours and provide a timeline for a resolution.
3.  **Coordinated Release**: We will issue a security advisory along with a patch.

## Private Key Safety

This project uses a **Local-Only Identity Model**:
- **Git-Ignored Keys**: The `.gitignore` blocks all `*-keypair.json`, `.env`, and `simulation_config.json` files from being committed.
- **Fresh Key Generation**: Run `node create_env.js` to generate a new authority keypair. No private keys are hardcoded in source.
- **Ephemeral Keys**: Use the generated keypairs only for Localnet stress testing. Never fund them with mainnet assets.
- **Authority Rotation**: The on-chain Propose -> Claim pattern mitigates unauthorized access during administrative transfers.

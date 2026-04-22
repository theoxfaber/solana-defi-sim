# Contributing to Solana DeFi Stress Simulator

Thank you for your interest in contributing to the project! We welcome contributions from the community to make this simulator the most high-fidelity tool for Solana DeFi research.

## How Can I Contribute?

### Reporting Bugs
- Use the GitHub Issue tracker.
- Provide a clear description, steps to reproduce, and your environment (Anchor version, Solana CLI version).

### Suggesting Enhancements
- Open an issue with the [Enhancement] tag.
- Describe the use case and the technical feasibility within the current `asymmetric_spl` gating model.

### Pull Requests
1.  **Branching**: Create a feature branch from `main`.
2.  **Standards**: Ensure all Rust code passes `cargo check` and follow Anchor's latest security patterns.
3.  **Testing**: Any logic change in the Program MUST include a corresponding test in `asymmetric_spl/tests/asymmetric_spl.ts`.
4.  **Documentation**: Update the README if you add new modules or metrics.

## Development Setup
- Follow the **Quick Start** guide in the README.
- Use `anchor test` to verify the security of the gating logic.

## Code of Conduct
Please be respectful and professional in all interactions. We aim to foster a collaborative environment for quantitative analysts and blockchain engineers alike.

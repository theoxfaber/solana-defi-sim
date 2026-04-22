<div align="center">

# 🤝 Contributing to Solana DeFi Stress Simulator

Thank you for your interest in contributing!<br/>
We welcome contributions to make this simulator a better tool for Solana DeFi research.

</div>

<br />

## 📋 How to Contribute

### 🐛 Reporting Bugs

- Use the [GitHub Issue tracker](https://github.com/theoxfaber/solana-defi-sim/issues)
- Include: clear description, steps to reproduce, environment details (Anchor version, Solana CLI version, OS)
- Attach relevant logs if the issue is with the volatility agent or deployment scripts

### 💡 Suggesting Enhancements

- Open an issue with the `[Enhancement]` tag
- Describe the use case and how it fits within the existing architecture
- If proposing changes to the Anchor program, include the security implications

### 🔀 Pull Requests

| Step | Requirement |
|:---|:---|
| **Branch** | Create a feature branch from `main` |
| **Rust** | All program code must pass `anchor build` |
| **Tests** | Logic changes require corresponding tests in `asymmetric_spl/tests/` |
| **Docs** | Update the README if you add new modules, instructions, or metrics |
| **Style** | Follow existing code conventions in each module |

<br />

## 🛠 Development Setup

```bash
# 1. Clone and install
git clone https://github.com/theoxfaber/solana-defi-sim.git
cd solana-defi-sim

# 2. Start local validator
solana-test-validator --reset

# 3. Build & test the Anchor program
cd asymmetric_spl
anchor build
anchor test

# 4. Setup orchestrator
cd ../liquidity_manager
node create_env.js
npm install

# 5. Setup simulation agent
cd ../vol_sim_agent
pip3 install -r requirements.txt
```

<br />

## 📐 Project Structure

```
solana-defi-sim/
├── asymmetric_spl/           # Anchor program (Rust)
│   ├── programs/.../lib.rs   # Core program logic
│   └── tests/                # Integration + fuzz tests
├── liquidity_manager/        # Orchestration toolchain (Node.js)
│   ├── deploy_pool.js        # Mint + Allowlist deployment
│   ├── add_wallet.js         # Mid-simulation wallet injection
│   └── config_watcher.js     # Live config hot-reload
├── vol_sim_agent/            # Volatility engine (Python)
│   ├── main.py               # Async simulation agent
│   └── metrics.py            # Rich dashboard + telemetry
└── test_and_simulate.sh      # End-to-end harness
```

<br />

## 📜 Code of Conduct

Please be respectful and professional in all interactions. We aim to foster a collaborative environment for blockchain engineers and quantitative researchers alike.

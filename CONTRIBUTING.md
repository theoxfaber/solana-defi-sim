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
| **Pre-commit** | Install & run pre-commit hooks (see below) |
| **Rust** | All program code must pass `cargo fmt`, `cargo clippy`, and `anchor build` |
| **Python** | Code must pass `black`, `isort`, and `pylint` checks |
| **JavaScript** | Code must pass `prettier` and `eslint` checks |
| **Tests** | Logic changes require corresponding tests in `asymmetric_spl/tests/` |
| **Docs** | Update the README if you add new modules, instructions, or metrics |
| **CI** | All GitHub Actions workflows must pass before merge |

<br />

## 🛠 Development Setup

### Initial Setup

```bash
# 1. Clone and install
git clone https://github.com/theoxfaber/solana-defi-sim.git
cd solana-defi-sim

# 2. Install pre-commit hooks
pip install pre-commit
pre-commit install

# 3. Start local validator
solana-test-validator --reset
```

### Building & Testing Each Component

**Anchor Program:**
```bash
cd asymmetric_spl
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
anchor build
anchor test
```

**Node.js Orchestrator:**
```bash
cd liquidity_manager
npm install
prettier --check . --write
eslint . --fix
node create_env.js
```

**Python Agent:**
```bash
cd vol_sim_agent
pip install -r requirements.txt
black . --line-length 100
isort . --profile black
pylint *.py
pytest test_agent.py -v
```

<br />

## 🔍 Code Quality Standards

### Pre-commit Hooks

Before committing, the following hooks run automatically:

- **Trailing whitespace** removal
- **YAML validation**
- **JSON validation**
- **Large file detection** (>1MB)
- **Private key detection**
- **Merge conflict detection**

Plus language-specific checks:

- **Python**: black, isort, flake8
- **JavaScript**: prettier, eslint
- **Rust**: cargo fmt, clippy

To manually run all checks:

```bash
pre-commit run --all-files
```

### Formatting Rules

**Python:**
- Line length: 100 characters
- Style: Black
- Import order: isort with Black profile

**JavaScript:**
- Line length: 100 characters
- Formatter: Prettier
- Linter: ESLint with recommended config

**Rust:**
- Line length: 100 characters
- Formatter: rustfmt
- Linter: clippy (with `-D warnings`)

<br />

## 📐 Project Structure

```
solana-defi-sim/
├── asymmetric_spl/           # Anchor program (Rust)
│   ├── programs/.../lib.rs   # Core program logic
│   ├── tests/                # Integration + fuzz tests
│   ├── rustfmt.toml          # Rust formatting config
│   └── Cargo.toml            # Rust dependencies
├── liquidity_manager/        # Orchestration toolchain (Node.js)
│   ├── deploy_pool.js        # Mint + Allowlist deployment
│   ├── add_wallet.js         # Mid-simulation wallet injection
│   ├── config_watcher.js     # Live config hot-reload
│   └── package.json          # Node dependencies
├── vol_sim_agent/            # Volatility engine (Python)
│   ├── main.py               # Async simulation agent
│   ├── metrics.py            # Rich dashboard + telemetry
│   ├── test_agent.py         # Unit tests
│   └── requirements.txt       # Python dependencies
├── .github/workflows/        # GitHub Actions CI/CD
│   ├── test.yml              # Main CI pipeline
│   └── dependabot-automerge.yml
├── .pre-commit-config.yaml   # Pre-commit hooks config
├── .eslintrc.json            # JavaScript linting
├── .prettierrc.json          # Code formatting
├── pyproject.toml            # Python tooling config
└── test_and_simulate.sh      # End-to-end harness
```

<br />

## 🚀 CI/CD Pipeline

This project uses GitHub Actions for continuous integration. All PRs must pass:

1. **Linting & Formatting** - Rust (clippy), Python (pylint), JavaScript (eslint)
2. **Build & Tests** - Anchor build, Python pytest, Node.js validation
3. **Security Scanning** - Dependency vulnerabilities (Trivy, cargo audit)
4. **Type Checking** - Python mypy type hints
5. **Code Coverage** - Python test coverage reports

View the workflow status in the [Actions tab](https://github.com/theoxfaber/solana-defi-sim/actions).

<br />

## 📜 Code of Conduct

Please be respectful and professional in all interactions. We aim to foster a collaborative environment for blockchain engineers and quantitative researchers alike.

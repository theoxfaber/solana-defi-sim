# 🔄 CI/CD Pipeline Documentation

This document outlines the continuous integration and deployment pipeline for the Solana DeFi Simulator.

## Overview

The project uses **GitHub Actions** to automate testing, building, and security scanning across three main components:

- **Rust**: Anchor smart contract program
- **Python**: Volatility simulation agent
- **JavaScript/Node.js**: Liquidity manager orchestrator

## Workflow Architecture

### Primary Workflow: `test.yml`

Triggered on every push to `main`/`develop` and all pull requests.

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Event                         │
│          (push to main/develop, or PR to main/develop)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴───────────┐
                │                        │
           ┌────▼────┐            ┌─────▼──────┐
           │  Lint   │            │  Security  │
           │(Rust)   │            │  Scanning  │
           └────┬────┘            └─────┬──────┘
                │                       │
                │       ┌───────────────┘
                │       │
           ┌────▼───────▼────┐
           │  Anchor Tests   │
           │(needs: lint)    │
           └────┬────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼────┐  ┌──▼─────┐ ┌──▼──────────┐
│ Python │  │ Node.js │ │ Final Check │
│ Tests  │  │ Tests   │ │(needs: all) │
└────────┘  └────────┘ └─────────────┘
```

## Job Details

### 1. **Lint** (Code Quality)
- **Runs**: First (no dependencies)
- **Duration**: ~2 minutes
- **Actions**:
  - Rust formatting check (`cargo fmt --check`)
  - Clippy linter (`cargo clippy`)
- **Fails if**: Code doesn't conform to style or has clippy warnings

**Fix locally:**
```bash
cd asymmetric_spl
cargo fmt
cargo clippy --fix
```

### 2. **Anchor Tests** (Smart Contract)
- **Runs**: After lint passes
- **Duration**: ~7-8 minutes
- **Actions**:
  1. Setup Node.js 18
  2. Cache Solana CLI
  3. Install Solana v1.18.15
  4. Cache Rust toolchain
  5. Install Anchor 0.30.1
  6. Build Anchor program
  7. Run tests with `anchor test`
- **Fails if**: Build errors or test failures

**Fix locally:**
```bash
cd asymmetric_spl
solana-test-validator --reset  # in separate terminal
anchor build
anchor test
```

### 3. **Python Tests** (Agent)
- **Runs**: In parallel with Anchor tests
- **Duration**: ~2-3 minutes
- **Actions**:
  1. Setup Python 3.11
  2. Install dependencies
  3. Format check (`black --check`)
  4. Import order check (`isort`)
  5. Type checking (`mypy`)
  6. Linting (`pylint`)
  7. Run pytest with coverage
  8. Upload coverage to Codecov
- **Fails if**: Test failures, type errors, or coverage below threshold

**Fix locally:**
```bash
cd vol_sim_agent
black . --line-length 100
isort . --profile black
pytest test_agent.py -v
```

### 4. **Node.js Tests** (Orchestrator)
- **Runs**: In parallel with Python tests
- **Duration**: ~2 minutes
- **Actions**:
  1. Setup Node.js 18
  2. Format check (`prettier --check`)
  3. Lint check (`eslint`)
  4. Validate config schema
- **Fails if**: Formatting issues or config validation failure

**Fix locally:**
```bash
cd liquidity_manager
prettier --write .
eslint . --fix
node -e "const {validateConfig} = require('./config_schema'); ..."
```

### 5. **Security Scanning**
- **Runs**: In parallel with tests
- **Duration**: ~3-4 minutes
- **Tools**:
  - **Trivy**: Filesystem vulnerability scanner
  - **Cargo Audit**: Rust dependency audits
  - **SARIF Upload**: Results to GitHub Security tab
- **Fails if**: Critical vulnerabilities detected (configurable)

**Fix locally:**
```bash
cargo audit
# Review and update vulnerable dependencies
```

### 6. **Final Check** (Integration Gate)
- **Runs**: After all other jobs pass
- **Duration**: <1 minute
- **Purpose**: Ensures all checks passed before merge

## Caching Strategy

To minimize CI execution time, the workflow aggressively caches:

| Cache | Key | Restored From |
|-------|-----|---|
| **Rust/Cargo** | `cargo-anchor-0.30.1-linux-v2` | Registry, git index, compiled binaries |
| **Solana CLI** | `solana-1.18.15-linux-v4` | Pre-compiled CLI tarball |
| **Node.js** | `npm` lock file hash | `node_modules/` |
| **Python** | `requirements.txt` hash | pip cache |

**Cache Invalidation**: Bump the version suffix (`-v2`, `-v4`, etc.) in the cache key to force a fresh build.

## Branch Protection Rules

Recommended GitHub settings for this repository:

```
Settings > Branches > Branch Protection Rules (main):
- ✅ Require status checks to pass before merging
  - Lint
  - Anchor Tests
  - Python Tests
  - Node.js Tests
  - Security
  - Final Check
- ✅ Require branches to be up to date before merging
- ✅ Dismiss stale PR approvals when new commits are pushed
- ✅ Require code review (min 1 approval)
- ✅ Require conversation resolution
```

## Pre-commit Hooks

To catch issues locally before pushing to GitHub:

```bash
# Install
pip install pre-commit
pre-commit install

# Run manually
pre-commit run --all-files

# Skip on specific commits
git commit --no-verify
```

Configuration in `.pre-commit-config.yaml` includes:

- Trailing whitespace removal
- YAML/JSON validation
- Private key detection
- Black (Python formatter)
- isort (Python import sorter)
- Prettier (JavaScript formatter)
- ESLint (JavaScript linter)
- Cargo fmt (Rust formatter)
- Clippy (Rust linter)

## Troubleshooting

### Solana CLI Download Failures

**Error**: `SSL_ERROR_SYSCALL` during Solana install

**Solution**: Already fixed in the workflow — downloads directly from GitHub releases instead of release.solana.com

**Fallback**: Manually update the Solana version in `.github/workflows/test.yml`

```yaml
key: solana-1.18.15-linux-v4  # Bump v4 to clear cache
```

### Anchor Installation Issues

**Error**: `avm: command not found`

**Solution**: The workflow installs Anchor via avm (Anchor Version Manager). Ensure `$HOME/.avm/bin` is in PATH before running anchor commands.

**Debug**:
```bash
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
avm --version
```

### Python Import Errors

**Error**: `ModuleNotFoundError: No module named 'metrics'`

**Solution**: Ensure you're running pytest from the `vol_sim_agent` directory:

```bash
cd vol_sim_agent
pytest test_agent.py -v
```

### Pytest Coverage Threshold

**Error**: Coverage below 80% (or configured threshold)

**Solution**: Add tests for uncovered code paths:

```bash
pytest --cov=. --cov-report=html
# Open htmlcov/index.html to visualize coverage
```

## Environment Variables

The CI environment has these preset:

```bash
RUST_BACKTRACE=1          # Detailed Rust panic traces
CARGO_TERM_COLOR=always   # Colored cargo output
```

Add secrets to GitHub Settings > Secrets if needed for deployment steps.

## Monitoring & Alerts

- **GitHub Actions Dashboard**: https://github.com/theoxfaber/solana-defi-sim/actions
- **Status Badge**: [![Solana CI](https://github.com/theoxfaber/solana-defi-sim/actions/workflows/test.yml/badge.svg)](https://github.com/theoxfaber/solana-defi-sim/actions/workflows/test.yml)
- **Branch Protection**: Requires all CI checks to pass before merge

## Performance Metrics

**Expected Execution Times** (with caching):

| Job | Cached | Fresh |
|-----|--------|-------|
| Lint | 2 min | 2 min |
| Anchor Tests | 4 min | 8 min |
| Python Tests | 2 min | 2 min |
| Node.js Tests | 2 min | 2 min |
| Security | 3 min | 3 min |
| **Total** | **~8 min** | **~15 min** |

Most builds complete in 8-10 minutes with effective caching.

## Future Improvements

Potential enhancements to the pipeline:

- [ ] Docker image building and publishing
- [ ] Deployment to testnet on successful merge to `main`
- [ ] Automated releases with changelog generation
- [ ] Performance benchmarking comparisons
- [ ] Integration test environment setup
- [ ] Automated documentation generation

---

For questions or issues with the CI/CD pipeline, please open an issue on GitHub.

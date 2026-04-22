# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-22

### Added
- **Anchor Program**: `toggle_allowlist` instruction for enabling/disabling the allowlist
- **Anchor Program**: `set_max_transfer` instruction for per-transaction transfer limits
- **Anchor Program**: `close_wallet_entry` instruction for reclaiming rent
- **Anchor Program**: Amount validation (`amount > 0`) on `conditional_transfer`
- **Anchor Program**: `anchor-spl` dependency for proper token CPI
- **Python Agent**: Uses Anchor `conditional_transfer` instruction (not raw SPL transfers)
- **Python Agent**: Proper CLI with `argparse` (`--verify`, `--config`, `--export`, `--no-dashboard`)
- **Python Agent**: Graceful shutdown via `SIGINT`/`SIGTERM` signal handling
- **Python Agent**: Configurable phases read from `simulation_config.json`
- **Python Agent**: JSON results export with per-phase stats and latency data
- **Python Agent**: Type hints on all functions and methods
- **Python Agent**: Unit tests (`pytest test_agent.py`) — 14 test cases
- **Deploy Script**: Real on-chain operations (mint creation, ATA setup, allowlist init, wallet whitelisting)
- **Config Validation**: Schema validator (`config_schema.js`) with comprehensive field checks
- **Config Watcher**: Diff reporting on config changes with validation
- **Tests**: 15 Anchor integration tests organized into 5 describe blocks
- **Tests**: Happy-path conditional_transfer test (previously missing)
- **Tests**: Zero-amount transfer rejection test
- **Tests**: De-whitelist/re-whitelist toggle test
- **CI**: Three separate jobs (Anchor, Python, Node) with dependency caching
- **Docs**: Custom banner, feature grid, Mermaid diagrams, collapsible sections
- **CHANGELOG.md**: This file

### Changed
- Bumped Anchor program version to `1.0.0`
- Workspace `Cargo.toml` uses explicit member path (not glob)
- Metrics dashboard has health indicator, color-coded latency, phase markers

### Removed
- Vestigial `workspace` program (never compiled, dead scaffold)
- Dead module files (`state.rs`, `error.rs`, `instructions.rs`, `constants.rs`)
- 3,719 `node_modules` files from git tracking
- Hardcoded private key from `create_env.js`
- `.gitattributes` language stat gaming
- Scratch utility scripts from repo root

### Fixed
- `deploy_pool.js` was calling `main()` three times in parallel (race condition)
- Missing `rich` dependency in `requirements.txt`
- Empty test case with no assertions
- CI workflow failing on non-existent root `npm install`
- Test ordering (init now runs before rogue re-init test)

### Security
- Removed all hardcoded private keys from source
- `create_env.js` generates fresh keypairs at runtime
- Proper `.gitignore` coverage for all sensitive files

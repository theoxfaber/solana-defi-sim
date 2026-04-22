<div align="center">

# 🛡️ Security Policy

</div>

<br />

## Supported Versions

| Version | Status |
|:---|:---|
| v1.0.x | ✅ Supported |
| < v1.0 | ❌ End of life |

<br />

## 🔒 Reporting a Vulnerability

> **Do NOT open a public issue for security vulnerabilities.**

| Step | Action |
|:---|:---|
| **1. Disclose** | Contact the maintainer directly via GitHub |
| **2. Response** | We will acknowledge within 48 hours |
| **3. Resolution** | A patch and security advisory will be issued |

<br />

## 🔑 Private Key Safety Model

| Control | Details |
|:---|:---|
| **Git-Ignored Keys** | `.gitignore` blocks `*-keypair.json`, `.env`, and `simulation_config.json` |
| **Fresh Generation** | `create_env.js` generates new keypairs at runtime — zero hardcoded secrets |
| **Ephemeral Scope** | Generated keys are for Localnet stress testing only |
| **Authority Rotation** | On-chain `propose` → `claim` pattern prevents unauthorized admin transfers |

<br />

> ⚠️ **Never fund simulation keypairs with mainnet SOL or tokens.**

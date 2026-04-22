/**
 * config_schema.js — Configuration validation for simulation_config.json
 * 
 * Validates the structure, types, and formats of all required fields
 * before any deployment or simulation script runs.
 * 
 * Usage:
 *   node config_schema.js                           # Validate default config
 *   node config_schema.js /path/to/config.json      # Validate specific config
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = [
    { key: 'TOKEN_MINT', type: 'string', minLength: 32 },
    { key: 'POOL_WALLET_PUBLIC_KEY', type: 'string', minLength: 32 },
    { key: 'POOL_WALLET_PRIVATE_KEY', type: 'string', minLength: 64 },
    { key: 'AUTHORITY_PUBLIC_KEY', type: 'string', minLength: 32 },
    { key: 'ALLOWLIST_PDA', type: 'string', minLength: 32 },
    { key: 'CHILD_WALLETS', type: 'array', minLength: 1 },
    { key: 'DECIMALS', type: 'number' },
    { key: 'RPC_URL', type: 'string' },
];

const CHILD_WALLET_FIELDS = [
    { key: 'pubkey', type: 'string', minLength: 32 },
    { key: 'private_key', type: 'string', minLength: 64 },
];

function validateConfig(config) {
    const errors = [];

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
        if (!(field.key in config)) {
            errors.push(`Missing required field: ${field.key}`);
            continue;
        }

        const value = config[field.key];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (actualType !== field.type) {
            errors.push(`${field.key}: expected ${field.type}, got ${actualType}`);
            continue;
        }

        if (field.minLength && field.type === 'string' && value.length < field.minLength) {
            errors.push(`${field.key}: too short (${value.length} < ${field.minLength})`);
        }

        if (field.minLength && field.type === 'array' && value.length < field.minLength) {
            errors.push(`${field.key}: needs at least ${field.minLength} entries`);
        }
    }

    // Validate child wallets structure
    if (config.CHILD_WALLETS && Array.isArray(config.CHILD_WALLETS)) {
        config.CHILD_WALLETS.forEach((wallet, i) => {
            for (const field of CHILD_WALLET_FIELDS) {
                if (!(field.key in wallet)) {
                    errors.push(`CHILD_WALLETS[${i}]: missing ${field.key}`);
                } else if (typeof wallet[field.key] !== 'string') {
                    errors.push(`CHILD_WALLETS[${i}].${field.key}: must be string`);
                } else if (wallet[field.key].length < field.minLength) {
                    errors.push(`CHILD_WALLETS[${i}].${field.key}: too short`);
                }
            }
        });
    }

    // Validate phases if present
    if (config.PHASES) {
        if (!Array.isArray(config.PHASES)) {
            errors.push('PHASES: must be an array');
        } else {
            config.PHASES.forEach((phase, i) => {
                if (!phase.name) errors.push(`PHASES[${i}]: missing name`);
                if (typeof phase.duration_secs !== 'number' || phase.duration_secs <= 0) {
                    errors.push(`PHASES[${i}]: duration_secs must be positive number`);
                }
                if (typeof phase.num_trades !== 'number' || phase.num_trades <= 0) {
                    errors.push(`PHASES[${i}]: num_trades must be positive number`);
                }
                if (!['buy', 'sell'].includes(phase.action)) {
                    errors.push(`PHASES[${i}]: action must be 'buy' or 'sell'`);
                }
            });
        }
    }

    // Validate RPC URL format
    if (config.RPC_URL && !config.RPC_URL.startsWith('http')) {
        errors.push(`RPC_URL: must start with http:// or https://`);
    }

    // Validate decimals range
    if (typeof config.DECIMALS === 'number' && (config.DECIMALS < 0 || config.DECIMALS > 18)) {
        errors.push(`DECIMALS: must be between 0 and 18`);
    }

    return errors;
}

// CLI execution
if (require.main === module) {
    const configPath = process.argv[2] || path.resolve(__dirname, '../simulation_config.json');
    
    if (!fs.existsSync(configPath)) {
        console.error(`✗ Config not found: ${configPath}`);
        process.exit(1);
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const errors = validateConfig(config);

        if (errors.length > 0) {
            console.error('✗ Validation failed:');
            errors.forEach(e => console.error(`  - ${e}`));
            process.exit(1);
        }

        console.log('✓ Config is valid');
        console.log(`  Token Mint:    ${config.TOKEN_MINT}`);
        console.log(`  Authority:     ${config.AUTHORITY_PUBLIC_KEY}`);
        console.log(`  Child Wallets: ${config.CHILD_WALLETS.length}`);
        console.log(`  RPC:           ${config.RPC_URL}`);
        console.log(`  Mode:          ${config.MODE || 'LIVE'}`);
        if (config.PHASES) {
            console.log(`  Phases:        ${config.PHASES.map(p => p.name).join(' → ')}`);
        }
    } catch (e) {
        console.error(`✗ Invalid JSON: ${e.message}`);
        process.exit(1);
    }
}

module.exports = { validateConfig };

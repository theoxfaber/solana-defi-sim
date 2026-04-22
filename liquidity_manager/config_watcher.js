/**
 * config_watcher.js — Live configuration hot-reload bus
 * 
 * Watches simulation_config.json for changes and logs detected updates.
 * The Python volatility agent also watches this file independently,
 * but this tool provides a standalone monitor for observability.
 * 
 * Usage: node config_watcher.js
 */

const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./config_schema');

const CONFIG_PATH = path.resolve(__dirname, '../simulation_config.json');

console.log(`╔══════════════════════════════════════════════╗`);
console.log(`║  Config Bus — Watching for live changes      ║`);
console.log(`╚══════════════════════════════════════════════╝`);
console.log(`  Path: ${CONFIG_PATH}\n`);

let lastConfig = null;

function loadAndValidate() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(raw);
        const errors = validateConfig(config);

        if (errors.length > 0) {
            console.log(`  [${timestamp()}] ⚠️  Invalid config:`);
            errors.forEach(e => console.log(`    - ${e}`));
            return null;
        }
        return config;
    } catch (err) {
        // Ignore temporary locks during write
        return null;
    }
}

function timestamp() {
    return new Date().toLocaleTimeString();
}

function diffConfigs(oldCfg, newCfg) {
    const changes = [];
    if (oldCfg.RPC_URL !== newCfg.RPC_URL) {
        changes.push(`  RPC: ${oldCfg.RPC_URL} → ${newCfg.RPC_URL}`);
    }
    if (oldCfg.MODE !== newCfg.MODE) {
        changes.push(`  Mode: ${oldCfg.MODE} → ${newCfg.MODE}`);
    }
    if (oldCfg.CHILD_WALLETS?.length !== newCfg.CHILD_WALLETS?.length) {
        changes.push(`  Wallets: ${oldCfg.CHILD_WALLETS?.length} → ${newCfg.CHILD_WALLETS?.length}`);
    }
    if (JSON.stringify(oldCfg.PHASES) !== JSON.stringify(newCfg.PHASES)) {
        changes.push(`  Phases: ${newCfg.PHASES?.map(p => p.name).join(' → ') || 'default'}`);
    }
    return changes;
}

// Initial load
lastConfig = loadAndValidate();
if (lastConfig) {
    console.log(`  [${timestamp()}] ✓ Initial config loaded`);
    console.log(`    RPC:     ${lastConfig.RPC_URL}`);
    console.log(`    Mode:    ${lastConfig.MODE || 'LIVE'}`);
    console.log(`    Wallets: ${lastConfig.CHILD_WALLETS?.length || 0}`);
}

let lastMtime = fs.statSync(CONFIG_PATH).mtimeMs;

// Watch for changes
fs.watch(CONFIG_PATH, (eventType, filename) => {
    if (!filename || eventType !== 'change') return;

    try {
        const stats = fs.statSync(CONFIG_PATH);
        if (stats.mtimeMs <= lastMtime) return;
        lastMtime = stats.mtimeMs;

        const newConfig = loadAndValidate();
        if (!newConfig) return;

        console.log(`\n  [${timestamp()}] ♻️  Config change detected`);

        if (lastConfig) {
            const changes = diffConfigs(lastConfig, newConfig);
            if (changes.length > 0) {
                changes.forEach(c => console.log(`  ${c}`));
            } else {
                console.log(`    (no observable field changes)`);
            }
        }

        lastConfig = newConfig;
        console.log(`    ✓ Validated and ready for agent pickup\n`);
    } catch (err) {
        // Ignore transient errors
    }
});

console.log(`\n  Watching... (edit the config file to push updates)\n`);

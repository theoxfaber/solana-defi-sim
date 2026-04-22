const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../simulation_config.json');

console.log(`--- Resilient Config Bus: Watching ${CONFIG_PATH} ---`);

let lastMtime = 0;

fs.watch(CONFIG_PATH, (eventType, filename) => {
    if (filename && eventType === 'change') {
        try {
            const stats = fs.statSync(CONFIG_PATH);
            if (stats.mtimeMs > lastMtime) {
                lastMtime = stats.mtimeMs;
                const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
                console.log(`[${new Date().toLocaleTimeString()}] ♻️ Config Hot-Reload Detected:`);
                console.log(`  > RPC: ${config.RPC_URL}`);
                console.log(`  > Mode: ${config.MODE || 'LIVE'}`);
            }
        } catch (err) {
            // Ignore temporary locks during write
        }
    }
});

// Initial load check
lastMtime = fs.statSync(CONFIG_PATH).mtimeMs;
console.log("✓ Watcher Active. Edit the file to push updates to the Python agent.");

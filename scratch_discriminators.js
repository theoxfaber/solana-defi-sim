const crypto = require('crypto');

function sighash(name) {
    const preimage = `global:${name}`;
    return crypto.createHash('sha256').update(preimage).digest().slice(0, 8);
}

console.log('initialize_allowlist:', sighash('initialize_allowlist').toString('hex'));
console.log('set_wallet_status:', sighash('set_wallet_status').toString('hex'));

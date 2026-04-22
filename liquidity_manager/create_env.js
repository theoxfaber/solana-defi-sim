const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

// Generate a fresh keypair instead of using a hardcoded key
const wallet = Keypair.generate();
const privateKey = bs58.encode(wallet.secretKey);

console.log(`Generated new authority wallet: ${wallet.publicKey.toBase58()}`);

const envContent = `RPC_URL=http://127.0.0.1:8899\nPRIVATE_KEY=${privateKey}\n`;

fs.writeFileSync(path.join(__dirname, '.env'), envContent);
console.log('.env file created successfully with fresh keypair');

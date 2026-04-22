const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

const keyBytes = [235,142,252,92,67,184,152,201,63,73,56,235,212,56,153,21,29,200,10,52,123,151,100,150,229,208,202,236,112,52,13,22,63,142,179,109,201,120,214,185,255,56,243,41,115,107,163,204,209,57,36,155,122,49,65,181,31,90,181,173,186,108,77,114];
const privateKey = bs58.encode(Uint8Array.from(keyBytes));

const envContent = `RPC_URL=http://127.0.0.1:8899\nPRIVATE_KEY=${privateKey}\n`;

fs.writeFileSync(path.join(__dirname, '.env'), envContent);
console.log('.env file created successfully');

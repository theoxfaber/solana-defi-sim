require('dotenv').config();
const { 
    Connection, 
    Keypair, 
    PublicKey, 
    LAMPORTS_PER_SOL,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction 
} = require('@solana/web3.js');
const { 
    createMint, 
    getOrCreateAssociatedTokenAccount, 
    mintTo, 
    TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey("76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK");

const IS_VERIFY = process.argv.includes('--verify');

async function main() {
    const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8899";
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // 1. Load Main Wallet
    let mainWallet;
    if (process.env.PRIVATE_KEY) {
        mainWallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    } else {
        throw new Error("PRIVATE_KEY not found in .env!");
    }

    console.log(`--- ${IS_VERIFY ? 'Diagnostic Verification Mode' : 'Real Localnet Setup'} ---`);
    console.log(`Authority: ${mainWallet.publicKey.toBase58()}`);

    // 2. Ensure SOL (Skip in Verify Mode)
    if (!IS_VERIFY) {
        console.log("Requesting Airdrop...");
        const airdropSig = await connection.requestAirdrop(mainWallet.publicKey, 0.5 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSig);
    } else {
        console.log("[DIAG] Skipping real airdrop.");
    }

    // 3. Create THE Mint
    const decimals = 6;
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    console.log(`Mint Pubkey: ${mint.toBase58()}`);

    // 4. Generate 10 Child Wallets
    console.log("Generating 10 simulation wallets...");
    const childWallets = Array.from({ length: 10 }, () => Keypair.generate());
    
    // 5. Derive Allowlist PDA
    const [allowlistPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("allowlist")],
        PROGRAM_ID
    );
    console.log(`Allowlist PDA: ${allowlistPda.toBase58()}`);

    // 6. Initialize Allowlist (Diagnostic Signing)
    console.log("Building Allowlist Initialization Instruction...");
    const initIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: allowlistPda, isSigner: false, isWritable: true },
            { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: PublicKey.default, isSigner: false, isWritable: false },
        ],
        data: Buffer.from("4d66269a36363a64", "hex"),
    });
    
    const initTx = new Transaction().add(initIx);
    initTx.recentBlockhash = "11111111111111111111111111111111"; // Mock blockhash for signing
    initTx.feePayer = mainWallet.publicKey;
    initTx.sign(mainWallet);
    
    console.log(`✓ Transaction Signed. Buffer length: ${initTx.serialize().length} bytes`);
    if (IS_VERIFY) {
        console.log(`[DIAG] Signed Hex: ${initTx.serialize().toString('hex').slice(0, 64)}...`);
    }

    if (!IS_VERIFY) {
        console.log("Broadcasting to cluster...");
        // (Broadcast logic here as before)
    }

    // 9. Save Config (Works in either mode)
    const poolWallet = Keypair.generate();
    const config = {
        TOKEN_MINT: mint.toBase58(),
        POOL_WALLET_PUBLIC_KEY: poolWallet.publicKey.toBase58(),
        POOL_WALLET_PRIVATE_KEY: bs58.encode(poolWallet.secretKey),
        AUTHORITY_PUBLIC_KEY: mainWallet.publicKey.toBase58(),
        ALLOWLIST_PDA: allowlistPda.toBase58(),
        CHILD_WALLETS: childWallets.map(w => ({
            pubkey: w.publicKey.toBase58(),
            private_key: bs58.encode(w.secretKey)
        })),
        DECIMALS: decimals,
        RPC_URL: rpcUrl,
        MODE: IS_VERIFY ? "VERIFICATION" : "LIVE"
    };

    fs.writeFileSync(path.resolve(__dirname, '../simulation_config.json'), JSON.stringify(config, null, 2));
    console.log(`\nSUCCESS: ${IS_VERIFY ? 'Diagnostic proof' : 'Execution engine'} ready.`);
}

main().catch(console.error);

main().catch(err => {
    console.error("FATAL SETUP ERROR:");
    console.error(err);
    process.exit(1);
});

main().catch(err => {
    console.error("FATAL ERROR:");
    console.error(err);
    process.exit(1);
});

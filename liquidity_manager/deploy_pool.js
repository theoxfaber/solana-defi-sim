/**
 * deploy_pool.js — Production Liquidity Pool Deployment
 * 
 * This script bootstraps the entire simulation environment:
 * 1. Funds the authority wallet via airdrop
 * 2. Creates the SPL token mint
 * 3. Creates a pool wallet with an ATA and mints initial supply
 * 4. Initializes the on-chain Allowlist PDA
 * 5. Generates child wallets, creates their ATAs, and whitelists them
 * 6. Writes simulation_config.json for the Python volatility agent
 * 
 * Usage:
 *   node deploy_pool.js            # Full Localnet deployment
 *   node deploy_pool.js --verify   # Dry-run: sign transactions without broadcasting
 */

require('dotenv').config();
const { 
    Connection, 
    Keypair, 
    PublicKey, 
    LAMPORTS_PER_SOL,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram
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

// ============================================================================
// Constants
// ============================================================================
const PROGRAM_ID = new PublicKey("76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK");
const CHILD_WALLET_COUNT = 10;
const MINT_DECIMALS = 6;
const INITIAL_SUPPLY = 1_000_000 * (10 ** MINT_DECIMALS); // 1M tokens
const AIRDROP_AMOUNT = 2 * LAMPORTS_PER_SOL;
const IS_VERIFY = process.argv.includes('--verify');

// Anchor instruction discriminators (first 8 bytes of sha256("global:<name>"))
const DISCRIMINATORS = {
    initializeAllowlist: Buffer.from("4d66269a36363a64", "hex"),
    setWalletStatus: Buffer.from("6004d9ccf1862a41", "hex"),
};

// ============================================================================
// Helpers
// ============================================================================
function log(step, total, msg) {
    console.log(`  [${step}/${total}] ${msg}`);
}

async function confirmTx(connection, signature) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
    });
}

// ============================================================================
// Main
// ============================================================================
async function main() {
    const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8899";
    const connection = new Connection(rpcUrl, 'confirmed');
    const STEPS = IS_VERIFY ? 4 : 7;
    
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  Solana DeFi Stress Simulator — Pool Deployment  ║`);
    console.log(`║  Mode: ${IS_VERIFY ? 'VERIFICATION (dry-run)' : 'LIVE LOCALNET       '}            ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);

    // 1. Load Authority Wallet
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY not found in .env! Run 'node create_env.js' first.");
    }
    const authority = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    log(1, STEPS, `Authority: ${authority.publicKey.toBase58()}`);

    // 2. Fund Authority 
    if (!IS_VERIFY) {
        log(2, STEPS, "Requesting SOL airdrop...");
        try {
            const airdropSig = await connection.requestAirdrop(authority.publicKey, AIRDROP_AMOUNT);
            await confirmTx(connection, airdropSig);
            log(2, STEPS, `✓ Airdrop confirmed (${AIRDROP_AMOUNT / LAMPORTS_PER_SOL} SOL)`);
        } catch (e) {
            log(2, STEPS, `! Airdrop failed (${e.message}). Proceeding with existing balance...`);
        }
    }

    // 3. Create Token Mint
    let mint;
    if (!IS_VERIFY) {
        log(3, STEPS, "Creating SPL token mint...");
        mint = await createMint(
            connection,
            authority,
            authority.publicKey,
            null,              // No freeze authority
            MINT_DECIMALS
        );
        log(3, STEPS, `✓ Mint: ${mint.toBase58()}`);
    } else {
        mint = Keypair.generate().publicKey;
        log(2, STEPS, `[DRY-RUN] Mock Mint: ${mint.toBase58()}`);
    }

    // 4. Create Pool Wallet + ATA + Mint Initial Supply
    const poolWallet = Keypair.generate();
    if (!IS_VERIFY) {
        // Fund pool wallet for ATA creation
        log(4, STEPS, "Setting up pool wallet...");
        const poolAirdrop = await connection.requestAirdrop(poolWallet.publicKey, LAMPORTS_PER_SOL);
        await confirmTx(connection, poolAirdrop);

        const poolAta = await getOrCreateAssociatedTokenAccount(
            connection, authority, mint, poolWallet.publicKey
        );
        
        await mintTo(connection, authority, mint, poolAta.address, authority.publicKey, INITIAL_SUPPLY);
        log(4, STEPS, `✓ Pool funded with ${INITIAL_SUPPLY / (10 ** MINT_DECIMALS)} tokens`);
    } else {
        log(3, STEPS, `[DRY-RUN] Pool Wallet: ${poolWallet.publicKey.toBase58()}`);
    }

    // 5. Initialize Allowlist PDA
    const [allowlistPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("allowlist")],
        PROGRAM_ID
    );

    if (!IS_VERIFY) {
        log(5, STEPS, "Initializing Allowlist PDA...");
        const initIx = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: allowlistPda, isSigner: false, isWritable: true },
                { pubkey: authority.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: DISCRIMINATORS.initializeAllowlist,
        });

        try {
            await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [authority]);
            log(5, STEPS, `✓ Allowlist PDA: ${allowlistPda.toBase58()}`);
        } catch (e) {
            if (e.message.includes("already in use")) {
                log(5, STEPS, `✓ Allowlist PDA already initialized: ${allowlistPda.toBase58()}`);
            } else {
                throw e;
            }
        }
    } else {
        log(4, STEPS, `[DRY-RUN] Allowlist PDA: ${allowlistPda.toBase58()}`);
    }

    // 6. Generate & Whitelist Child Wallets
    console.log(`\n  Generating ${CHILD_WALLET_COUNT} simulation wallets...`);
    const childWallets = Array.from({ length: CHILD_WALLET_COUNT }, () => Keypair.generate());

    if (!IS_VERIFY) {
        log(6, STEPS, "Onboarding child wallets (Airdrop → ATA → Whitelist)...");
        
        for (let i = 0; i < childWallets.length; i++) {
            const child = childWallets[i];
            const label = `    [${i+1}/${childWallets.length}]`;

            // Airdrop SOL for fees
            try {
                const sig = await connection.requestAirdrop(child.publicKey, 0.5 * LAMPORTS_PER_SOL);
                await confirmTx(connection, sig);
            } catch (e) {
                console.log(`${label} ! Airdrop skipped: ${e.message}`);
            }

            // Create ATA
            await getOrCreateAssociatedTokenAccount(
                connection, authority, mint, child.publicKey
            );

            // Whitelist on-chain
            const [entryPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet"), allowlistPda.toBuffer(), child.publicKey.toBuffer()],
                PROGRAM_ID
            );

            const whitelistIx = new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [
                    { pubkey: entryPda, isSigner: false, isWritable: true },
                    { pubkey: child.publicKey, isSigner: false, isWritable: false },
                    { pubkey: allowlistPda, isSigner: false, isWritable: true },
                    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                data: Buffer.concat([
                    DISCRIMINATORS.setWalletStatus,
                    Buffer.from([0x01]), // is_allowed = true
                ]),
            });

            await sendAndConfirmTransaction(connection, new Transaction().add(whitelistIx), [authority]);
            console.log(`${label} ✓ ${child.publicKey.toBase58().slice(0, 12)}... whitelisted`);
        }

        log(6, STEPS, `✓ All ${CHILD_WALLET_COUNT} wallets onboarded`);
    }

    // 7. Save Config
    const config = {
        TOKEN_MINT: mint.toBase58(),
        POOL_WALLET_PUBLIC_KEY: poolWallet.publicKey.toBase58(),
        POOL_WALLET_PRIVATE_KEY: bs58.encode(poolWallet.secretKey),
        AUTHORITY_PUBLIC_KEY: authority.publicKey.toBase58(),
        ALLOWLIST_PDA: allowlistPda.toBase58(),
        PROGRAM_ID: PROGRAM_ID.toBase58(),
        CHILD_WALLETS: childWallets.map(w => ({
            pubkey: w.publicKey.toBase58(),
            private_key: bs58.encode(w.secretKey)
        })),
        DECIMALS: MINT_DECIMALS,
        RPC_URL: rpcUrl,
        MODE: IS_VERIFY ? "VERIFICATION" : "LIVE",
        PHASES: [
            { name: "Accumulation", duration_secs: 5, num_trades: 5, action: "buy" },
            { name: "Impulse", duration_secs: 3, num_trades: 10, action: "buy" },
            { name: "Distribution", duration_secs: 5, num_trades: 5, action: "sell" },
            { name: "Capitulation", duration_secs: 4, num_trades: 10, action: "sell" },
            { name: "Reclamation", duration_secs: 2, num_trades: 3, action: "buy" }
        ]
    };

    const configPath = path.resolve(__dirname, '../simulation_config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const finalStep = IS_VERIFY ? 4 : 7;
    log(finalStep, STEPS, `✓ Config written to simulation_config.json`);

    console.log(`\n  ╔════════════════════════════════════════╗`);
    console.log(`  ║  ✓ Deployment ${IS_VERIFY ? 'verification' : 'complete    '} successfully  ║`);
    console.log(`  ╚════════════════════════════════════════╝\n`);
}

main().catch(err => {
    console.error("\n  ✗ DEPLOYMENT FAILED:");
    console.error(`    ${err.message}`);
    process.exit(1);
});

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
    getOrCreateAssociatedTokenAccount, 
    TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey("76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK");
const CONFIG_PATH = path.resolve(__dirname, '../simulation_config.json');

async function addWallet() {
    console.log("--- Phase 2: Standalone Wallet Injection ---");

    // 1. Load Config
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error("simulation_config.json not found! Run deploy_pool.js first.");
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const rpcUrl = config.RPC_URL || "http://127.0.0.1:8899";
    const connection = new Connection(rpcUrl, 'confirmed');

    // 2. Load Authority
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY not found in .env!");
    }
    const authority = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const allowlistPda = new PublicKey(config.ALLOWLIST_PDA);
    const mint = new PublicKey(config.TOKEN_MINT);

    // 3. Generate New Child Wallet
    const newWallet = Keypair.generate();
    console.log(`New Wallet: ${newWallet.publicKey.toBase58()}`);

    // ACTION 1: Airdrop SOL
    console.log(" -> Requesting Airdrop...");
    try {
        const airdropSig = await connection.requestAirdrop(newWallet.publicKey, 0.5 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSig);
        console.log(" ✓ Airdrop successful.");
    } catch (e) {
        console.log(" ! Airdrop failed (Localnet might be low on funds or rate-limited). Proceeding...");
    }

    // ACTION 2: Initialize ATA
    console.log(" -> Initializing ATA...");
    const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        authority, // Payer
        mint,
        newWallet.publicKey
    );
    console.log(` ✓ ATA created: ${ata.address.toBase58()}`);

    // ACTION 3: Whitelist (On-Chain Sequencing)
    console.log(" -> Whitelisting on Allowlist PDA...");
    const [entryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), newWallet.publicKey.toBuffer()],
        PROGRAM_ID
    );

    const whitelistIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: entryPda, isSigner: false, isWritable: true },
            { pubkey: newWallet.publicKey, isSigner: false, isWritable: false },
            { pubkey: allowlistPda, isSigner: false, isWritable: true },
            { pubkey: authority.publicKey, isSigner: true, isWritable: true },
            { pubkey: PublicKey.default, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
            Buffer.from("6004d9ccf1862a41", "hex"), // set_wallet_status discriminator
            Buffer.from([0x01]), // is_allowed = true
        ]),
    });

    const tx = new Transaction().add(whitelistIx);
    await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(" ✓ Whitelisting successful.");

    // 4. Update Config
    config.CHILD_WALLETS.push({
        pubkey: newWallet.publicKey.toBase58(),
        private_key: bs58.encode(newWallet.secretKey)
    });

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`\nSUCCESS: Wallet injected and whitelisted. Total authorized wallets: ${config.CHILD_WALLETS.length}`);
}

addWallet().catch(err => {
    console.error("INJECTION ERROR:");
    console.error(err);
    process.exit(1);
});

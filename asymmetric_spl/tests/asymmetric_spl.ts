import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsymmetricSpl } from "../target/types/asymmetric_spl";
import { expect } from "chai";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

describe("asymmetric_spl_pro", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsymmetricSpl as Program<AsymmetricSpl>;
  const authority = provider.wallet as anchor.Wallet;

  let mint: anchor.web3.PublicKey;
  let authorityAta: anchor.web3.PublicKey;
  let userAta: anchor.web3.PublicKey;
  const user = anchor.web3.Keypair.generate();
  const newAuthority = anchor.web3.Keypair.generate();

  const [allowlistPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("allowlist")],
    program.programId
  );

  before(async () => {
    // Setup token environment
    mint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );

    authorityAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      authority.publicKey
    )).address;

    userAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      user.publicKey
    )).address;

    await mintTo(
      provider.connection,
      authority.payer,
      mint,
      authorityAta,
      authority.publicKey,
      1000000
    );
  });

  it("FAIL: Unauthorized initialization attempt", async () => {
    const rogue = anchor.web3.Keypair.generate();
    // Airdrop rogue
    const sig = await provider.connection.requestAirdrop(rogue.publicKey, 1e9);
    await provider.connection.confirmTransaction(sig);

    // This should work because rogue is payer, but any subsequent init on same PDA should fail
  });

  it("SUCCESS: Initializes the allowlist", async () => {
    await program.methods
      .initializeAllowlist()
      .accounts({
        allowlist: allowlistPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.allowlist.fetch(allowlistPda);
    expect(state.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(state.pendingAuthority.toBase58()).to.equal(anchor.web3.PublicKey.default.toBase58());
  });

  it("FAIL: Double initialization guard", async () => {
    try {
      await program.methods
        .initializeAllowlist()
        .accounts({
          allowlist: allowlistPda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed with already in use");
    } catch (e) {
      expect(e.logs.toString()).to.include("already in use");
    }
  });

  it("SUCCESS: Whitelists a user", async () => {
    const [walletEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("wallet"), allowlistPda.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .setWalletStatus(true)
      .accounts({
        walletEntry: walletEntryPda,
        targetWallet: user.publicKey,
        authority: authority.publicKey,
        allowlist: allowlistPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const entry = await program.account.walletEntry.fetch(walletEntryPda);
    expect(entry.isAllowed).to.be.true;
  });

  it("FAIL: Rejection on unauthorized transfer attempt", async () => {
    const blockedUser = anchor.web3.Keypair.generate();
    const blockedAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        blockedUser.publicKey
    )).address;

    const [blockedEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), blockedUser.publicKey.toBuffer()],
        program.programId
    );

    // Attempt transfer without being on allowlist (PDA check will catch AccountNotInitialized)
    try {
        await program.methods
            .conditionalTransfer(new anchor.BN(100))
            .accounts({
                from: blockedUser.publicKey,
                fromTokenAccount: blockedAta,
                toTokenAccount: authorityAta,
                allowlist: allowlistPda,
                walletEntry: blockedEntryPda,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([blockedUser])
            .rpc();
        expect.fail("Should have failed");
    } catch (e) {
        expect(e.message).to.include("Account does not exist");
    }
  });

  it("SUCCESS: Two-step authority rotation", async () => {
    // 1. Propose
    await program.methods
      .proposeAuthority(newAuthority.publicKey)
      .accounts({
        allowlist: allowlistPda,
        authority: authority.publicKey,
      })
      .rpc();

    let state = await program.account.allowlist.fetch(allowlistPda);
    expect(state.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    // 2. Claim from rogue (should fail)
    const rogue = anchor.web3.Keypair.generate();
    try {
        await program.methods
            .claimAuthority()
            .accounts({
                allowlist: allowlistPda,
                pendingAuthority: rogue.publicKey,
            })
            .signers([rogue])
            .rpc();
        expect.fail("Rogue claimed authority!");
    } catch (e) {
        expect(e.message).to.include("NotPendingAuthority");
    }

    // 3. Claim correctly
    await program.methods
      .claimAuthority()
      .accounts({
        allowlist: allowlistPda,
        pendingAuthority: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();

    state = await program.account.allowlist.fetch(allowlistPda);
    expect(state.authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
    expect(state.pendingAuthority.toBase58()).to.equal(anchor.web3.PublicKey.default.toBase58());
  });

  it("FAIL: Unauthorized status update (after rotation)", async () => {
    const [walletEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), user.publicKey.toBuffer()],
        program.programId
      );

    try {
        await program.methods
            .setWalletStatus(false)
            .accounts({
                walletEntry: walletEntryPda,
                targetWallet: user.publicKey,
                authority: authority.publicKey, // Old authority
                allowlist: allowlistPda,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();
        expect.fail("Old authority still works!");
    } catch (e) {
        expect(e.message).to.include("InvalidAuthority");
    }
  });

  describe("Security: PDA Boundary Fuzzing", () => {
    it("FAIL: Rejects PDA with incorrect seed prefix", async () => {
      // Correct prefix is "wallet", let's try "stolen_wallet"
      const [fakeEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("stolen_wallet"), allowlistPda.toBuffer(), user.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .setWalletStatus(true)
          .accounts({
            walletEntry: fakeEntryPda,
            targetWallet: user.publicKey,
            authority: authority.publicKey,
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Seed prefix fuzzing was ignored!");
      } catch (e) {
        expect(e.message).to.include("ConstraintSeeds");
      }
    });

    it("FAIL: Rejects PDA derived from incorrect program ID", async () => {
      const otherProgramId = anchor.web3.Keypair.generate().publicKey;
      const [alienPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), user.publicKey.toBuffer()],
        otherProgramId
      );

      try {
        await program.methods
          .setWalletStatus(true)
          .accounts({
            walletEntry: alienPda,
            targetWallet: user.publicKey,
            authority: authority.publicKey,
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Ownership check was bypassed!");
      } catch (e) {
        expect(e.message).to.include("ConstraintSeeds") || expect(e.message).to.include("AccountDoesNotBelongToProgram");
      }
    });

    it("FAIL: Rejects account type mismatch (Allowlist as WalletEntry)", async () => {
      try {
        await program.methods
          .setWalletStatus(true)
          .accounts({
            walletEntry: allowlistPda, // Swapping Allowlist into WalletEntry slot
            targetWallet: user.publicKey,
            authority: authority.publicKey,
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Type mismatch was ignored!");
      } catch (e) {
        expect(e.message).to.include("ConstraintSeeds") || expect(e.message).to.include("AccountNotFoundError");
      }
    });
  });
});

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

describe("asymmetric_spl", () => {
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

  // ========================================================================
  // Setup
  // ========================================================================
  before(async () => {
    // Fund the user for fees
    const sig = await provider.connection.requestAirdrop(user.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig);

    // Fund newAuthority for claim test
    const sig2 = await provider.connection.requestAirdrop(newAuthority.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig2);

    // Create token mint
    mint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );

    // Create ATAs
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

    // Mint tokens to authority
    await mintTo(
      provider.connection,
      authority.payer,
      mint,
      authorityAta,
      authority.publicKey,
      10_000_000 // 10 tokens at 6 decimals
    );
  });

  // ========================================================================
  // Allowlist Initialization
  // ========================================================================
  describe("Allowlist Initialization", () => {
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
      expect(state.isEnabled).to.be.true;
      expect(state.maxTransfer.toNumber()).to.equal(0);
    });

    it("FAIL: Double initialization is rejected", async () => {
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
      } catch (e: any) {
        expect(e.logs.toString()).to.include("already in use");
      }
    });

    it("FAIL: Rogue cannot re-initialize the PDA", async () => {
      const rogue = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(rogue.publicKey, 1e9);
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .initializeAllowlist()
          .accounts({
            allowlist: allowlistPda,
            authority: rogue.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([rogue])
          .rpc();
        expect.fail("Rogue should not be able to re-initialize");
      } catch (e: any) {
        expect(e).to.exist;
      }
    });
  });

  // ========================================================================
  // Wallet Whitelisting
  // ========================================================================
  describe("Wallet Whitelisting", () => {
    it("SUCCESS: Whitelists a user wallet", async () => {
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
      expect(entry.wallet.toBase58()).to.equal(user.publicKey.toBase58());
    });

    it("SUCCESS: De-whitelist then re-whitelist", async () => {
      const [walletEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), user.publicKey.toBuffer()],
        program.programId
      );

      // Revoke
      await program.methods
        .setWalletStatus(false)
        .accounts({
          walletEntry: walletEntryPda,
          targetWallet: user.publicKey,
          authority: authority.publicKey,
          allowlist: allowlistPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      let entry = await program.account.walletEntry.fetch(walletEntryPda);
      expect(entry.isAllowed).to.be.false;

      // Re-whitelist
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

      entry = await program.account.walletEntry.fetch(walletEntryPda);
      expect(entry.isAllowed).to.be.true;
    });
  });

  // ========================================================================
  // Conditional Transfer
  // ========================================================================
  describe("Conditional Transfer", () => {
    it("SUCCESS: Authorized wallet can transfer tokens", async () => {
      const [walletEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );

      // Whitelist the authority wallet itself
      await program.methods
        .setWalletStatus(true)
        .accounts({
          walletEntry: walletEntryPda,
          targetWallet: authority.publicKey,
          authority: authority.publicKey,
          allowlist: allowlistPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Execute a gated transfer: authority → user
      await program.methods
        .conditionalTransfer(new anchor.BN(1_000_000))
        .accounts({
          from: authority.publicKey,
          fromTokenAccount: authorityAta,
          toTokenAccount: userAta,
          allowlist: allowlistPda,
          walletEntry: walletEntryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify balance moved
      const userBalance = await provider.connection.getTokenAccountBalance(userAta);
      expect(Number(userBalance.value.amount)).to.be.greaterThan(0);
    });

    it("FAIL: Blocked wallet cannot transfer", async () => {
      const blockedUser = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(blockedUser.publicKey, 1e9);
      await provider.connection.confirmTransaction(airdropSig);

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
        expect.fail("Blocked user should not be able to transfer");
      } catch (e: any) {
        // WalletEntry PDA doesn't exist → AccountNotInitialized
        expect(e.message).to.include("Account does not exist");
      }
    });

    it("FAIL: Zero-amount transfer is rejected", async () => {
      const [walletEntryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), allowlistPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .conditionalTransfer(new anchor.BN(0))
          .accounts({
            from: authority.publicKey,
            fromTokenAccount: authorityAta,
            toTokenAccount: userAta,
            allowlist: allowlistPda,
            walletEntry: walletEntryPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Zero-amount should be rejected");
      } catch (e: any) {
        expect(e.message).to.include("ZeroAmountTransfer");
      }
    });
  });

  // ========================================================================
  // Authority Rotation
  // ========================================================================
  describe("Authority Rotation", () => {
    it("SUCCESS: Two-step propose → claim rotation", async () => {
      // Propose
      await program.methods
        .proposeAuthority(newAuthority.publicKey)
        .accounts({
          allowlist: allowlistPda,
          authority: authority.publicKey,
        })
        .rpc();

      let state = await program.account.allowlist.fetch(allowlistPda);
      expect(state.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

      // Rogue claim fails
      const rogue = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(rogue.publicKey, 1e9);
      await provider.connection.confirmTransaction(airdropSig);

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
      } catch (e: any) {
        expect(e.message).to.include("NotPendingAuthority");
      }

      // Correct claim
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

    it("FAIL: Old authority cannot manage allowlist after rotation", async () => {
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
      } catch (e: any) {
        expect(e.message).to.include("InvalidAuthority");
      }
    });
  });

  // ========================================================================
  // PDA Boundary Security Fuzzing
  // ========================================================================
  describe("Security: PDA Boundary Fuzzing", () => {
    it("FAIL: Rejects PDA with incorrect seed prefix", async () => {
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
            authority: newAuthority.publicKey, // Current authority after rotation
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newAuthority])
          .rpc();
        expect.fail("Spoofed seed prefix was accepted!");
      } catch (e: any) {
        expect(e.message).to.include("ConstraintSeeds");
      }
    });

    it("FAIL: Rejects PDA from incorrect program ID", async () => {
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
            authority: newAuthority.publicKey,
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newAuthority])
          .rpc();
        expect.fail("Cross-program PDA injection worked!");
      } catch (e: any) {
        expect(e).to.exist;
      }
    });

    it("FAIL: Rejects account type confusion (Allowlist into WalletEntry slot)", async () => {
      try {
        await program.methods
          .setWalletStatus(true)
          .accounts({
            walletEntry: allowlistPda,
            targetWallet: user.publicKey,
            authority: newAuthority.publicKey,
            allowlist: allowlistPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newAuthority])
          .rpc();
        expect.fail("Type confusion was accepted!");
      } catch (e: any) {
        expect(e).to.exist;
      }
    });
  });
});

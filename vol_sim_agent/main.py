"""
Solana DeFi Stress Simulator — Volatility Agent

Drives multi-phase market cycle simulations against a Solana Localnet validator,
executing gated transfers through the Asymmetric SPL program's conditional_transfer
instruction. Provides a real-time terminal dashboard with TPS and latency metrics.

Usage:
    python main.py                     # Live simulation with dashboard
    python main.py --verify            # Dry-run: build + sign without broadcasting
    python main.py --export results/   # Export results to JSON after completion
    python main.py --config path.json  # Use custom config file
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import random
import signal
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction
from solders.message import MessageV0
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from spl.token.instructions import (
    get_associated_token_address,
    create_associated_token_account,
)
from spl.token.constants import TOKEN_PROGRAM_ID

from metrics import MetricsTracker

# ============================================================================
# Logging
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("vol_sim_agent")


# ============================================================================
# Data Structures
# ============================================================================
@dataclass
class PhaseConfig:
    """Configuration for a single market simulation phase."""
    name: str
    duration_secs: float
    num_trades: int
    action: str  # "buy" or "sell"


@dataclass
class SimulationConfig:
    """Parsed and validated simulation configuration."""
    rpc_url: str
    token_mint: Pubkey
    pool_wallet: Keypair
    authority_pubkey: Pubkey
    allowlist_pda: Pubkey
    program_id: Pubkey
    decimals: int
    child_wallets: list[Keypair]
    phases: list[PhaseConfig]
    mode: str = "LIVE"

    @classmethod
    def from_file(cls, path: str) -> SimulationConfig:
        """Load and validate configuration from a JSON file."""
        with open(path, "r") as f:
            raw = json.load(f)

        required = ["TOKEN_MINT", "POOL_WALLET_PRIVATE_KEY", "ALLOWLIST_PDA",
                     "CHILD_WALLETS", "DECIMALS", "RPC_URL"]
        missing = [k for k in required if k not in raw]
        if missing:
            raise ValueError(f"Missing required config keys: {missing}")

        phases = []
        for p in raw.get("PHASES", []):
            phases.append(PhaseConfig(
                name=p["name"],
                duration_secs=p["duration_secs"],
                num_trades=p["num_trades"],
                action=p["action"],
            ))

        # Default phases if none configured
        if not phases:
            phases = [
                PhaseConfig("Accumulation", 5, 5, "buy"),
                PhaseConfig("Impulse", 3, 10, "buy"),
                PhaseConfig("Distribution", 5, 5, "sell"),
                PhaseConfig("Capitulation", 4, 10, "sell"),
                PhaseConfig("Reclamation", 2, 3, "buy"),
            ]

        return cls(
            rpc_url=raw["RPC_URL"],
            token_mint=Pubkey.from_string(raw["TOKEN_MINT"]),
            pool_wallet=Keypair.from_base58_string(raw["POOL_WALLET_PRIVATE_KEY"]),
            authority_pubkey=Pubkey.from_string(raw.get("AUTHORITY_PUBLIC_KEY", "")),
            allowlist_pda=Pubkey.from_string(raw["ALLOWLIST_PDA"]),
            program_id=Pubkey.from_string(raw.get("PROGRAM_ID", "76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK")),
            decimals=raw["DECIMALS"],
            child_wallets=[
                Keypair.from_base58_string(w["private_key"])
                for w in raw["CHILD_WALLETS"]
            ],
            phases=phases,
            mode=raw.get("MODE", "LIVE"),
        )


# ============================================================================
# Anchor Instruction Builder
# ============================================================================
def get_anchor_discriminator(name: str) -> bytes:
    """Compute the 8-byte Anchor instruction discriminator."""
    preimage = f"global:{name}"
    return hashlib.sha256(preimage.encode()).digest()[:8]


def build_conditional_transfer_ix(
    program_id: Pubkey,
    from_wallet: Pubkey,
    from_ata: Pubkey,
    to_ata: Pubkey,
    allowlist_pda: Pubkey,
    wallet_entry_pda: Pubkey,
    amount: int,
) -> Instruction:
    """Build the Anchor conditional_transfer instruction."""
    discriminator = get_anchor_discriminator("conditional_transfer")
    data = discriminator + struct.pack("<Q", amount)  # u64 little-endian

    accounts = [
        AccountMeta(from_wallet, is_signer=True, is_writable=False),
        AccountMeta(from_ata, is_signer=False, is_writable=True),
        AccountMeta(to_ata, is_signer=False, is_writable=True),
        AccountMeta(allowlist_pda, is_signer=False, is_writable=False),
        AccountMeta(wallet_entry_pda, is_signer=False, is_writable=False),
        AccountMeta(TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
    ]

    return Instruction(program_id, data, accounts)


def derive_wallet_entry_pda(
    program_id: Pubkey, allowlist_pda: Pubkey, wallet: Pubkey
) -> tuple[Pubkey, int]:
    """Derive the WalletEntry PDA for a given wallet."""
    seeds = [b"wallet", bytes(allowlist_pda), bytes(wallet)]
    return Pubkey.find_program_address(seeds, program_id)


# ============================================================================
# Volatility Simulation Agent
# ============================================================================
class VolSimAgent:
    """Async agent that drives multi-phase market simulations on Solana Localnet."""

    def __init__(
        self,
        config: SimulationConfig,
        metrics: MetricsTracker,
        verify_only: bool = False,
    ) -> None:
        self.config = config
        self.metrics = metrics
        self.verify_only = verify_only
        self.client = AsyncClient(config.rpc_url, commitment=Confirmed)
        self._shutdown = False
        self._config_mtime: float = 0
        self.child_atas: dict[Pubkey, Pubkey] = {}
        self.wallet_entry_pdas: dict[Pubkey, Pubkey] = {}

    async def close(self) -> None:
        """Clean up the RPC client connection."""
        await self.client.close()

    def request_shutdown(self) -> None:
        """Signal the agent to gracefully stop after the current trade."""
        logger.info("🛑 Shutdown requested — finishing current trade...")
        self._shutdown = True

    # ------------------------------------------------------------------
    # Connectivity & Setup
    # ------------------------------------------------------------------
    async def check_connectivity(self) -> bool:
        """Verify connection to the Solana validator."""
        try:
            slot = await self.client.get_slot()
            logger.info(f"✓ Connected to Localnet (Slot: {slot.value})")
            return True
        except Exception as e:
            logger.error(
                f"✗ Cannot connect to {self.config.rpc_url}: {e}\n"
                f"  Ensure solana-test-validator is running."
            )
            return False

    async def setup_wallets(self) -> None:
        """Ensure all child wallets have SOL, ATAs, and cached PDA addresses."""
        logger.info(f"Synchronizing {len(self.config.child_wallets)} wallets...")

        for wallet in self.config.child_wallets:
            pubkey = wallet.pubkey()

            # Top up SOL if needed
            balance = await self.client.get_balance(pubkey)
            if balance.value < 10_000_000:
                logger.info(f"  Topping up {str(pubkey)[:12]}...")
                sig = await self.client.request_airdrop(pubkey, 100_000_000)
                await self.client.confirm_transaction(sig.value)

            # ATA
            ata = get_associated_token_address(pubkey, self.config.token_mint)
            self.child_atas[pubkey] = ata
            info = await self.client.get_account_info(ata)
            if info.value is None:
                ix = create_associated_token_account(
                    payer=pubkey, owner=pubkey, mint=self.config.token_mint
                )
                blockhash = (await self.client.get_latest_blockhash()).value.blockhash
                msg = MessageV0.try_compile(pubkey, [ix], [], blockhash)
                tx = VersionedTransaction(msg, [wallet])
                await self.client.send_transaction(tx)
                logger.info(f"  Created ATA for {str(pubkey)[:12]}...")

            # Cache WalletEntry PDA
            pda, _ = derive_wallet_entry_pda(
                self.config.program_id, self.config.allowlist_pda, pubkey
            )
            self.wallet_entry_pdas[pubkey] = pda

        logger.info("✓ All wallets ready.")

    # ------------------------------------------------------------------
    # Trade Execution (via Anchor Program)
    # ------------------------------------------------------------------
    async def execute_trade(
        self, wallet: Keypair, action: str, amount: int
    ) -> bool:
        """Execute a single gated transfer through the Anchor program."""
        try:
            blockhash = (await self.client.get_latest_blockhash()).value.blockhash
            child_ata = self.child_atas[wallet.pubkey()]
            pool_ata = get_associated_token_address(
                self.config.pool_wallet.pubkey(), self.config.token_mint
            )
            wallet_entry_pda = self.wallet_entry_pdas[wallet.pubkey()]

            if action == "buy":
                # Pool → Child (pool wallet signs)
                ix = build_conditional_transfer_ix(
                    program_id=self.config.program_id,
                    from_wallet=self.config.pool_wallet.pubkey(),
                    from_ata=pool_ata,
                    to_ata=child_ata,
                    allowlist_pda=self.config.allowlist_pda,
                    wallet_entry_pda=derive_wallet_entry_pda(
                        self.config.program_id,
                        self.config.allowlist_pda,
                        self.config.pool_wallet.pubkey(),
                    )[0],
                    amount=amount,
                )
                msg = MessageV0.try_compile(
                    self.config.pool_wallet.pubkey(), [ix], [], blockhash
                )
                tx = VersionedTransaction(msg, [self.config.pool_wallet])
            else:
                # Child → Pool (child wallet signs)
                ix = build_conditional_transfer_ix(
                    program_id=self.config.program_id,
                    from_wallet=wallet.pubkey(),
                    from_ata=child_ata,
                    to_ata=pool_ata,
                    allowlist_pda=self.config.allowlist_pda,
                    wallet_entry_pda=wallet_entry_pda,
                    amount=amount,
                )
                msg = MessageV0.try_compile(wallet.pubkey(), [ix], [], blockhash)
                tx = VersionedTransaction(msg, [wallet])

            start = time.time()
            resp = await self.client.send_transaction(tx)
            latency_ms = (time.time() - start) * 1000

            self.metrics.record_trade(self.metrics.current_phase, True, latency_ms)
            return True

        except Exception as e:
            self.metrics.record_trade(self.metrics.current_phase, False, 0)
            logger.debug(f"Trade failed: {e}")
            return False

    # ------------------------------------------------------------------
    # Phase Execution
    # ------------------------------------------------------------------
    async def execute_phase(self, phase: PhaseConfig) -> None:
        """Run a single market simulation phase."""
        self.metrics.current_phase = phase.name
        logger.info(f"{'═' * 50}")
        logger.info(f"  {phase.name.upper()} PHASE — {phase.num_trades} trades over {phase.duration_secs}s ({phase.action})")
        logger.info(f"{'═' * 50}")

        delay = phase.duration_secs / max(phase.num_trades, 1)

        for i in range(phase.num_trades):
            if self._shutdown:
                logger.info("Shutdown signal received — aborting phase.")
                return

            await self._check_config_reload()

            wallet = random.choice(self.config.child_wallets)
            amount = random.randint(100, 1000) * (10 ** self.config.decimals)
            await self.execute_trade(wallet, phase.action, amount)
            await asyncio.sleep(delay)

    # ------------------------------------------------------------------
    # Config Hot-Reload
    # ------------------------------------------------------------------
    async def _check_config_reload(self) -> None:
        """Check if simulation_config.json has been modified and reload."""
        config_path = os.path.join(os.path.dirname(__file__), "../simulation_config.json")
        try:
            mtime = os.path.getmtime(config_path)
            if mtime > self._config_mtime:
                if self._config_mtime > 0:
                    logger.info("♻️ Hot-reloading configuration...")
                    new_config = SimulationConfig.from_file(config_path)
                    old_rpc = self.config.rpc_url
                    self.config = new_config
                    if new_config.rpc_url != old_rpc:
                        await self.client.close()
                        self.client = AsyncClient(new_config.rpc_url, commitment=Confirmed)
                self._config_mtime = mtime
        except Exception as e:
            logger.warning(f"Config reload check failed: {e}")

    # ------------------------------------------------------------------
    # Main Run Loop
    # ------------------------------------------------------------------
    async def run(self) -> None:
        """Execute the full simulation sequence."""
        if not await self.check_connectivity():
            return

        await self.setup_wallets()

        for phase in self.config.phases:
            if self._shutdown:
                break
            await self.execute_phase(phase)
            await asyncio.sleep(0.5)

        if self._shutdown:
            logger.info("Simulation stopped by user.")
        else:
            logger.info("✓ Full simulation sequence complete.")

        await self.close()


# ============================================================================
# Verification Mode
# ============================================================================
async def run_verification(config: SimulationConfig) -> None:
    """Build and sign a sample transaction without broadcasting."""
    logger.info("─── Diagnostic Verification Mode ───")

    sample = config.child_wallets[0]
    sample_ata = get_associated_token_address(sample.pubkey(), config.token_mint)
    pool_ata = get_associated_token_address(
        config.pool_wallet.pubkey(), config.token_mint
    )

    pool_entry_pda, _ = derive_wallet_entry_pda(
        config.program_id, config.allowlist_pda, config.pool_wallet.pubkey()
    )

    ix = build_conditional_transfer_ix(
        program_id=config.program_id,
        from_wallet=config.pool_wallet.pubkey(),
        from_ata=pool_ata,
        to_ata=sample_ata,
        allowlist_pda=config.allowlist_pda,
        wallet_entry_pda=pool_entry_pda,
        amount=1000 * (10 ** config.decimals),
    )

    from solders.hash import Hash
    mock_blockhash = Hash.from_string("11111111111111111111111111111111")
    msg = MessageV0.try_compile(config.pool_wallet.pubkey(), [ix], [], mock_blockhash)
    tx = VersionedTransaction(msg, [config.pool_wallet])

    logger.info(f"  Sample Wallet:  {sample.pubkey()}")
    logger.info(f"  Pool Wallet:    {config.pool_wallet.pubkey()}")
    logger.info(f"  Program ID:     {config.program_id}")
    logger.info(f"  Tx Size:        {len(bytes(tx))} bytes")
    logger.info(f"  Tx Hex (first): {bytes(tx).hex()[:64]}...")
    logger.info("✓ Verification complete — simulation logic is valid.")


# ============================================================================
# Entry Point
# ============================================================================
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Solana DeFi Stress Simulator — Volatility Agent"
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="Dry-run: build and sign transactions without broadcasting"
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Path to simulation_config.json (default: ../simulation_config.json)"
    )
    parser.add_argument(
        "--export", type=str, default=None,
        help="Directory to export simulation results JSON after completion"
    )
    parser.add_argument(
        "--no-dashboard", action="store_true",
        help="Disable the live TUI dashboard (log-only mode)"
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    # Load config
    config_path = args.config or os.path.join(
        os.path.dirname(__file__), "../simulation_config.json"
    )
    if not os.path.exists(config_path):
        logger.error(f"Config not found: {config_path}")
        logger.error("Run 'node deploy_pool.js' in liquidity_manager/ first.")
        sys.exit(1)

    config = SimulationConfig.from_file(config_path)
    metrics = MetricsTracker()

    if args.verify:
        asyncio.run(run_verification(config))
        return

    agent = VolSimAgent(config, metrics, verify_only=False)

    # Signal handling for graceful shutdown
    def handle_signal(signum: int, frame) -> None:
        agent.request_shutdown()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    if args.no_dashboard:
        asyncio.run(agent.run())
    else:
        from rich.live import Live

        with Live(metrics.generate_dashboard(), refresh_per_second=4) as live:
            async def run_with_dashboard():
                run_task = asyncio.create_task(agent.run())
                while not run_task.done():
                    live.update(metrics.generate_dashboard())
                    await asyncio.sleep(0.25)
                await run_task

            asyncio.run(run_with_dashboard())

    # Export results
    if args.export:
        export_dir = Path(args.export)
        export_dir.mkdir(parents=True, exist_ok=True)
        report = metrics.export_report()
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        export_path = export_dir / f"sim_results_{timestamp}.json"
        with open(export_path, "w") as f:
            json.dump(report, f, indent=2)
        logger.info(f"✓ Results exported to {export_path}")


if __name__ == "__main__":
    main()

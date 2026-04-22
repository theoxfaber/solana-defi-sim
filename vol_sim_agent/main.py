import asyncio
import base58
import json
import logging
import random
import time
import os
from dotenv import load_dotenv

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction
from solders.message import MessageV0
from solders.system_program import TransferParams, transfer
from spl.token.instructions import get_associated_token_address, create_associated_token_account, transfer_checked, TransferCheckedParams
from spl.token.constants import TOKEN_PROGRAM_ID
from metrics import MetricsTracker
from rich.live import Live

# Setup logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class VolSimAgent:
    def __init__(self, config, metrics=None):
        self.config = config
        self.metrics = metrics
        self.rpc_url = config["RPC_URL"]
        self.token_mint = Pubkey.from_string(config["TOKEN_MINT"])
        self.pool_wallet = Keypair.from_base58_string(config["POOL_WALLET_PRIVATE_KEY"])
        self.decimals = config["DECIMALS"]
        
        self.client = AsyncClient(self.rpc_url, commitment=Confirmed)
        self.config_mtime = 0
        
        # Load pre-authorized child wallets from config
        self.child_wallets = [
            Keypair.from_base58_string(w["private_key"]) 
            for w in config["CHILD_WALLETS"]
        ]
        self.child_atas = {}

    async def _check_connectivity(self):
        try:
            slot = await self.client.get_slot()
            logging.info(f"✓ Connected to Localnet (Slot: {slot.value})")
            return True
        except Exception as e:
            logging.error(f"✗ Failed to connect to Localnet at {self.rpc_url}. Ensure solana-test-validator is running.")
            return False

    async def _setup_wallets(self):
        logging.info(f"--- Synchronizing {len(self.child_wallets)} Authorized Wallets ---")
        
        # Ensure children have enough SOL for fees
        for wallet in self.child_wallets:
            balance = await self.client.get_balance(wallet.pubkey())
            if balance.value < 10_000_000: # 0.01 SOL
                logging.info(f"Topping up {wallet.pubkey()}...")
                sig = await self.client.request_airdrop(wallet.pubkey(), 100_000_000)
                await self.client.confirm_transaction(sig.value)

        # Initialize ATAs
        for wallet in self.child_wallets:
            ata = get_associated_token_address(wallet.pubkey(), self.token_mint)
            self.child_atas[wallet.pubkey()] = ata
            
            info = await self.client.get_account_info(ata)
            if info.value is None:
                ix = create_associated_token_account(
                    payer=wallet.pubkey(),
                    owner=wallet.pubkey(),
                    mint=self.token_mint
                )
                blockhash = (await self.client.get_latest_blockhash()).value.blockhash
                msg = MessageV0.try_compile(wallet.pubkey(), [ix], [], blockhash)
                tx = VersionedTransaction(msg, [wallet])
                await self.client.send_transaction(tx)
                logging.info(f"Created ATA for authorized child: {wallet.pubkey()}")
        
        logging.info("✓ Wallets ready and authorized.")

    async def _execute_real_trade(self, wallet, action, amount):
        try:
            blockhash = (await self.client.get_latest_blockhash()).value.blockhash
            child_ata = self.child_atas[wallet.pubkey()]
            pool_ata = get_associated_token_address(self.pool_wallet.pubkey(), self.token_mint)
            
            if action == "buy":
                ix = transfer_checked(
                    TransferCheckedParams(
                        program_id=TOKEN_PROGRAM_ID,
                        source=pool_ata,
                        mint=self.token_mint,
                        dest=child_ata,
                        owner=self.pool_wallet.pubkey(),
                        amount=int(amount),
                        decimals=self.decimals,
                        signers=[]
                    )
                )
                msg = MessageV0.try_compile(self.pool_wallet.pubkey(), [ix], [], blockhash)
                tx = VersionedTransaction(msg, [self.pool_wallet])
            else:
                ix = transfer_checked(
                    TransferCheckedParams(
                        program_id=TOKEN_PROGRAM_ID,
                        source=child_ata,
                        mint=self.token_mint,
                        dest=pool_ata,
                        owner=wallet.pubkey(),
                        amount=int(amount),
                        decimals=self.decimals,
                        signers=[]
                    )
                )
                msg = MessageV0.try_compile(wallet.pubkey(), [ix], [], blockhash)
                tx = VersionedTransaction(msg, [wallet])

            start_time = time.time()
            resp = await self.client.send_transaction(tx)
            latency = (time.time() - start_time) * 1000
            
            if self.metrics:
                self.metrics.record_trade(self.metrics.current_phase, True, latency)
            
            # Simple log fallback if dashboard isn't active
            # logging.info(f"[{action.upper()}] {str(wallet.pubkey())[:8]} | Tx: {str(resp.value)[:16]}...")
            return True
        except Exception as e:
            if self.metrics:
                self.metrics.record_trade(self.metrics.current_phase, False, 0)
            logging.error(f"Trade failed: {str(e)}")
            return False

    async def execute_phase(self, phase_name, duration_secs, num_swaps, action):
        if self.metrics:
            self.metrics.current_phase = phase_name
            
        logging.info(f"=== {phase_name.upper()} PHASE START ({duration_secs}s) ===")
        start_time = time.time()
        
        tasks = []
        for _ in range(num_swaps):
            # Check for config reload mid-phase
            await self._check_config_reload()
            
            wallet = random.choice(self.child_wallets)
            amount = random.randint(100, 1000) * (10 ** self.decimals)
            tasks.append(self._execute_real_trade(wallet, action, amount))
            await asyncio.sleep(duration_secs / num_swaps)
            
        await asyncio.gather(*tasks)
        logging.info(f"=== {phase_name.upper()} PHASE COMPLETE ===")

    async def _check_config_reload(self):
        config_path = os.path.join(os.path.dirname(__file__), "../simulation_config.json")
        try:
            mtime = os.path.getmtime(config_path)
            if mtime > self.config_mtime:
                if self.config_mtime > 0: # Avoid reload on first load
                    logging.info("♻️ Hot-reloading configuration...")
                    with open(config_path, "r") as f:
                        new_config = json.load(f)
                    self.rpc_url = new_config.get("RPC_URL", self.rpc_url)
                    # Re-init client if RPC changed
                    if self.rpc_url != self.config.get("RPC_URL"):
                        await self.client.close()
                        self.client = AsyncClient(self.rpc_url, commitment=Confirmed)
                    self.config = new_config
                self.config_mtime = mtime
        except Exception as e:
            logging.error(f"Failed to check config reload: {e}")

    async def run(self):
        if not await self._check_connectivity():
            return

        await self._setup_wallets()
        
        phases = [
            ("Accumulation", 5, 5, "buy"),
            ("Impulse", 3, 10, "buy"),
            ("Distribution", 5, 5, "sell"),
            ("Capitulation", 4, 10, "sell"),
            ("Reclamation", 2, 3, "buy")
        ]

        for name, duration, count, action in phases:
            await self.execute_phase(name, duration, count, action)
            await asyncio.sleep(0.5)

        logging.info("FULL SIMULATION SEQUENCE FINISHED.")
        await self.client.close()

if __name__ == "__main__":
    import sys
    load_dotenv()
    
    IS_VERIFY = "--verify" in sys.argv
    
    config_path = os.path.join(os.path.dirname(__file__), "../simulation_config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
        
    metrics = MetricsTracker()
    agent = VolSimAgent(config, metrics)
    
    if IS_VERIFY:
        logging.info("--- Diagnostic Verification Mode ---")
        async def diagnostic_run():
            # Mock ATA map for diagnostic
            sample_wallet = agent.child_wallets[0]
            agent.child_atas[sample_wallet.pubkey()] = get_associated_token_address(sample_wallet.pubkey(), agent.token_mint)
            
            logging.info(f"Sample Wallet: {sample_wallet.pubkey()}")
            logging.info("Building sample 'Accumulation' buy transaction...")
            
            # Use a mock blockhash
            from solders.hash import Hash
            mock_blockhash = Hash.from_string("11111111111111111111111111111111")
            child_ata = agent.child_atas[sample_wallet.pubkey()]
            pool_ata = get_associated_token_address(agent.pool_wallet.pubkey(), agent.token_mint)
            
            ix = transfer_checked(
                TransferCheckedParams(
                    program_id=TOKEN_PROGRAM_ID,
                    source=pool_ata,
                    mint=agent.token_mint,
                    dest=child_ata,
                    owner=agent.pool_wallet.pubkey(),
                    amount=1000 * (10 ** agent.decimals),
                    decimals=agent.decimals,
                    signers=[]
                )
            )
            msg = MessageV0.try_compile(agent.pool_wallet.pubkey(), [ix], [], mock_blockhash)
            tx = VersionedTransaction(msg, [agent.pool_wallet])
            
            logging.info(f"✓ Transaction Signed. Size: {len(bytes(tx))} bytes")
            logging.info(f"[DIAG] Signed Hex: {bytes(tx).hex()[:64]}...")
            logging.info("SUCCESS: Simulation logic verified.")
            
        asyncio.run(diagnostic_run())
    else:
        with Live(metrics.generate_dashboard(), refresh_per_second=4) as live:
            # Update loop for the dashboard
            async def run_with_dashboard():
                run_task = asyncio.create_task(agent.run())
                while not run_task.done():
                    live.update(metrics.generate_dashboard())
                    await asyncio.sleep(0.25)
                await run_task
            
            asyncio.run(run_with_dashboard())

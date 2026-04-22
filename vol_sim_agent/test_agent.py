"""
Unit tests for the volatility simulation agent.

Run with: pytest test_agent.py -v
"""

import json
import os
import tempfile
import time

import pytest
from metrics import MetricsTracker


# ============================================================================
# MetricsTracker Tests
# ============================================================================
class TestMetricsTracker:
    def test_initial_state(self):
        m = MetricsTracker()
        assert m.total_success == 0
        assert m.total_failure == 0
        assert m.current_phase == "Waiting"
        assert m.get_tps() == 0
        assert m.get_percentile(50) == 0.0

    def test_record_success(self):
        m = MetricsTracker()
        m.record_trade("Accumulation", True, 42.5)
        assert m.total_success == 1
        assert m.total_failure == 0
        assert m.phase_stats["Accumulation"]["success"] == 1

    def test_record_failure(self):
        m = MetricsTracker()
        m.record_trade("Impulse", False, 0)
        assert m.total_success == 0
        assert m.total_failure == 1
        assert m.phase_stats["Impulse"]["failure"] == 1

    def test_percentile_calculation(self):
        m = MetricsTracker()
        # Add known latencies
        for lat in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]:
            m.record_trade("Test", True, lat)
        
        p50 = m.get_percentile(50)
        p99 = m.get_percentile(99)
        assert 50 <= p50 <= 60  # Median should be around 50-60
        assert p99 >= 90  # p99 should be near the max

    def test_tps_window(self):
        m = MetricsTracker()
        # Record several trades at once
        for _ in range(5):
            m.record_trade("Test", True, 10)
        # TPS should be ~5 (all within last second)
        assert m.get_tps() >= 4

    def test_reset(self):
        m = MetricsTracker()
        m.record_trade("Test", True, 10)
        m.record_trade("Test", False, 0)
        m.reset()
        assert m.total_success == 0
        assert m.total_failure == 0
        assert len(m.phase_stats) == 0
        assert len(m.trade_log) == 0

    def test_export_report(self):
        m = MetricsTracker()
        m.record_trade("Accumulation", True, 42.5)
        m.record_trade("Accumulation", True, 55.0)
        m.record_trade("Accumulation", False, 0)

        report = m.export_report()
        assert report["summary"]["total_trades"] == 3
        assert report["summary"]["successful"] == 2
        assert report["summary"]["failed"] == 1
        assert "Accumulation" in report["phases"]
        assert report["latency"]["p50_ms"] > 0

    def test_multiple_phases(self):
        m = MetricsTracker()
        m.record_trade("Accumulation", True, 10)
        m.record_trade("Impulse", True, 20)
        m.record_trade("Distribution", False, 0)

        assert len(m.phase_stats) == 3
        assert m.phase_stats["Accumulation"]["success"] == 1
        assert m.phase_stats["Distribution"]["failure"] == 1

    def test_dashboard_generation(self):
        m = MetricsTracker()
        m.record_trade("Test", True, 42.0)
        # Should not raise
        dashboard = m.generate_dashboard()
        assert dashboard is not None


# ============================================================================
# SimulationConfig Tests
# ============================================================================
class TestSimulationConfig:
    def _make_config(self, overrides=None):
        """Create a minimal valid config dict."""
        from solders.keypair import Keypair
        import base58

        kp = Keypair()
        config = {
            "TOKEN_MINT": str(kp.pubkey()),
            "POOL_WALLET_PUBLIC_KEY": str(kp.pubkey()),
            "POOL_WALLET_PRIVATE_KEY": str(kp),
            "AUTHORITY_PUBLIC_KEY": str(kp.pubkey()),
            "ALLOWLIST_PDA": str(kp.pubkey()),
            "PROGRAM_ID": "76vuoVBk8VtxGHd2BVeTFq3n3aSAFtqzKUncrgrczSNK",
            "CHILD_WALLETS": [
                {"pubkey": str(Keypair().pubkey()), "private_key": str(Keypair())}
            ],
            "DECIMALS": 6,
            "RPC_URL": "http://127.0.0.1:8899",
            "MODE": "VERIFICATION",
        }
        if overrides:
            config.update(overrides)
        return config

    def test_loads_valid_config(self):
        from main import SimulationConfig
        
        config_dict = self._make_config()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(config_dict, f)
            f.flush()
            cfg = SimulationConfig.from_file(f.name)

        assert cfg.decimals == 6
        assert cfg.rpc_url == "http://127.0.0.1:8899"
        assert len(cfg.child_wallets) == 1
        assert len(cfg.phases) == 5  # Default phases
        os.unlink(f.name)

    def test_custom_phases(self):
        from main import SimulationConfig
        
        config_dict = self._make_config({
            "PHASES": [
                {"name": "Custom", "duration_secs": 1, "num_trades": 2, "action": "buy"}
            ]
        })
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(config_dict, f)
            f.flush()
            cfg = SimulationConfig.from_file(f.name)

        assert len(cfg.phases) == 1
        assert cfg.phases[0].name == "Custom"
        os.unlink(f.name)

    def test_missing_keys_raises(self):
        from main import SimulationConfig
        
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"RPC_URL": "localhost"}, f)
            f.flush()
            with pytest.raises(ValueError, match="Missing required config keys"):
                SimulationConfig.from_file(f.name)
        os.unlink(f.name)


# ============================================================================
# Anchor Discriminator Tests
# ============================================================================
class TestAnchorDiscriminator:
    def test_known_discriminators(self):
        from main import get_anchor_discriminator
        
        # These are the known Anchor discriminators for our program
        init_disc = get_anchor_discriminator("initialize_allowlist")
        assert len(init_disc) == 8
        assert init_disc.hex() == "4d66269a36363a64"

        status_disc = get_anchor_discriminator("set_wallet_status")
        assert len(status_disc) == 8
        assert status_disc.hex() == "6004d9ccf1862a41"

    def test_discriminator_uniqueness(self):
        from main import get_anchor_discriminator
        
        names = [
            "initialize_allowlist",
            "set_wallet_status",
            "conditional_transfer",
            "propose_authority",
            "claim_authority",
        ]
        discriminators = [get_anchor_discriminator(n) for n in names]
        assert len(set(d.hex() for d in discriminators)) == len(names)

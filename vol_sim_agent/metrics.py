"""
metrics.py — Real-time simulation metrics and terminal dashboard.

Tracks per-phase success/failure ratios, TPS throughput, and tail latency
percentiles (p50, p95, p99). Provides a Rich-based live dashboard and
JSON export for post-simulation analysis.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any

from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from rich.progress_bar import ProgressBar
from rich import box


class MetricsTracker:
    """Collects and aggregates simulation metrics in real-time."""

    def __init__(self) -> None:
        self.start_time: float = time.time()
        self.total_success: int = 0
        self.total_failure: int = 0
        self.phase_stats: dict[str, dict[str, int]] = {}
        self.latencies: deque[float] = deque(maxlen=1000)
        self.current_phase: str = "Waiting"
        self.tps_window: deque[float] = deque(maxlen=100)
        self.trade_log: list[dict[str, Any]] = []

    def record_trade(
        self, phase: str, success: bool, latency_ms: float
    ) -> None:
        """Record a trade result with its phase, outcome, and latency."""
        if phase not in self.phase_stats:
            self.phase_stats[phase] = {"success": 0, "failure": 0}

        if success:
            self.total_success += 1
            self.phase_stats[phase]["success"] += 1
        else:
            self.total_failure += 1
            self.phase_stats[phase]["failure"] += 1

        if latency_ms > 0:
            self.latencies.append(latency_ms)
        self.tps_window.append(time.time())

        self.trade_log.append({
            "timestamp": time.time(),
            "phase": phase,
            "success": success,
            "latency_ms": round(latency_ms, 2),
        })

    def get_percentile(self, p: float) -> float:
        """Get the p-th percentile of recorded latencies."""
        if not self.latencies:
            return 0.0
        sorted_lats = sorted(self.latencies)
        idx = int(len(sorted_lats) * p / 100)
        return sorted_lats[min(idx, len(sorted_lats) - 1)]

    def get_tps(self) -> int:
        """Get current transactions per second (1s sliding window)."""
        now = time.time()
        return sum(1 for t in self.tps_window if now - t <= 1.0)

    def reset(self) -> None:
        """Reset all counters for a fresh simulation run."""
        self.start_time = time.time()
        self.total_success = 0
        self.total_failure = 0
        self.phase_stats.clear()
        self.latencies.clear()
        self.current_phase = "Waiting"
        self.tps_window.clear()
        self.trade_log.clear()

    def export_report(self) -> dict[str, Any]:
        """Export a complete simulation report as a dictionary."""
        elapsed = time.time() - self.start_time
        total = self.total_success + self.total_failure

        return {
            "summary": {
                "duration_secs": round(elapsed, 2),
                "total_trades": total,
                "successful": self.total_success,
                "failed": self.total_failure,
                "success_rate": round(
                    (self.total_success / total * 100) if total > 0 else 0, 2
                ),
                "avg_tps": round(total / elapsed, 2) if elapsed > 0 else 0,
            },
            "latency": {
                "p50_ms": round(self.get_percentile(50), 2),
                "p95_ms": round(self.get_percentile(95), 2),
                "p99_ms": round(self.get_percentile(99), 2),
            },
            "phases": {
                name: {
                    "success": stats["success"],
                    "failure": stats["failure"],
                    "success_rate": round(
                        stats["success"] / max(stats["success"] + stats["failure"], 1) * 100, 2
                    ),
                }
                for name, stats in self.phase_stats.items()
            },
            "trade_log": self.trade_log[-100:],  # Last 100 trades
        }

    # ------------------------------------------------------------------
    # Rich Dashboard
    # ------------------------------------------------------------------
    def generate_dashboard(self) -> Layout:
        """Generate the Rich live dashboard layout."""
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="body"),
            Layout(name="footer", size=3),
        )
        layout["body"].split_row(
            Layout(name="stats", ratio=3),
            Layout(name="latency", ratio=2),
        )

        # --- Header ---
        elapsed = int(time.time() - self.start_time)
        total = self.total_success + self.total_failure
        header_text = (
            f"🚀 SOLANA STRESS SIMULATOR  │  "
            f"Phase: [bold cyan]{self.current_phase}[/]  │  "
            f"Uptime: {elapsed}s  │  "
            f"TPS: [bold green]{self.get_tps()}[/]  │  "
            f"Trades: [bold]{total}[/]"
        )
        layout["header"].update(
            Panel(header_text, style="white on #1a1a3e", box=box.HEAVY)
        )

        # --- Stats Table ---
        table = Table(
            title="[bold]Execution Health[/]",
            box=box.ROUNDED,
            border_style="dim",
            show_lines=True,
        )
        table.add_column("Phase", style="bold cyan", min_width=14)
        table.add_column("✓", style="green", justify="right")
        table.add_column("✗", style="red", justify="right")
        table.add_column("Rate", style="yellow", justify="right")

        for phase, stats in self.phase_stats.items():
            phase_total = stats["success"] + stats["failure"]
            rate = f"{stats['success'] / phase_total * 100:.0f}%" if phase_total > 0 else "—"
            is_current = "» " if phase == self.current_phase else "  "
            table.add_row(
                f"{is_current}{phase}",
                str(stats["success"]),
                str(stats["failure"]),
                rate,
            )

        layout["stats"].update(Panel(table, border_style="#7B2FBE"))

        # --- Latency Panel ---
        p50 = self.get_percentile(50)
        p95 = self.get_percentile(95)
        p99 = self.get_percentile(99)

        def color_latency(val: float) -> str:
            if val < 100:
                return f"[bold green]{val:.1f}ms[/]"
            elif val < 500:
                return f"[bold yellow]{val:.1f}ms[/]"
            else:
                return f"[bold red]{val:.1f}ms[/]"

        lats = (
            f"\n  p50  {color_latency(p50)}\n"
            f"  p95  {color_latency(p95)}\n"
            f"  p99  {color_latency(p99)}\n"
        )

        # Overall health
        if total > 0:
            rate = self.total_success / total * 100
            health = (
                f"[bold green]● HEALTHY ({rate:.0f}%)[/]" if rate >= 95
                else f"[bold yellow]● DEGRADED ({rate:.0f}%)[/]" if rate >= 80
                else f"[bold red]● UNHEALTHY ({rate:.0f}%)[/]"
            )
        else:
            health = "[dim]● IDLE[/]"

        latency_content = f"\n  {health}\n{lats}"
        layout["latency"].update(
            Panel(latency_content, title="[bold]Latency & Health[/]", border_style="#e06c60")
        )

        # --- Footer ---
        layout["footer"].update(
            Panel(
                "[dim]Press Ctrl+C to gracefully stop  │  Config changes are hot-reloaded automatically[/]",
                style="dim",
                box=box.SIMPLE,
            )
        )

        return layout

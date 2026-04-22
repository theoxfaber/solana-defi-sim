import time
from collections import deque
from rich.live import Live
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich import box

class MetricsTracker:
    def __init__(self):
        self.start_time = time.time()
        self.total_success = 0
        self.total_failure = 0
        self.phase_stats = {} # phase_name -> {"success": 0, "failure": 0}
        self.latencies = deque(maxlen=1000) # Sliding window for p50/p95/p99
        self.current_phase = "N/A"
        self.tps_window = deque(maxlen=10) # 10s sliding window for TPS

    def record_trade(self, phase, success, latency_ms):
        if phase not in self.phase_stats:
            self.phase_stats[phase] = {"success": 0, "failure": 0}
        
        if success:
            self.total_success += 1
            self.phase_stats[phase]["success"] += 1
        else:
            self.total_failure += 1
            self.phase_stats[phase]["failure"] += 1
        
        self.latencies.append(latency_ms)
        self.tps_window.append(time.time())

    def get_percentile(self, p):
        if not self.latencies:
            return 0
        sorted_lats = sorted(list(self.latencies))
        idx = int(len(sorted_lats) * p / 100)
        return sorted_lats[min(idx, len(sorted_lats) - 1)]

    def get_tps(self):
        now = time.time()
        # Filter window for last second
        valid_hits = [t for t in self.tps_window if now - t <= 1.0]
        return len(valid_hits)

    def generate_dashboard(self):
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="body")
        )
        layout["body"].split_row(
            Layout(name="stats"),
            Layout(name="latency")
        )

        # Header
        elapsed = int(time.time() - self.start_time)
        layout["header"].update(
            Panel(f"🚀 SOLANA STRESS TEST | Phase: [bold cyan]{self.current_phase}[/] | Uptime: {elapsed}s | TPS: [bold green]{self.get_tps()}[/]", 
                  style="white on blue", box=box.ROUNDED)
        )

        # Stats Table
        table = Table(title="Execution Health", box=box.SIMPLE)
        table.add_column("Phase", style="cyan")
        table.add_column("Success", style="green")
        table.add_column("Failure", style="red")
        table.add_column("Ratio", style="yellow")

        for phase, stats in self.phase_stats.items():
            total = stats["success"] + stats["failure"]
            ratio = f"{(stats['success']/total)*100:.1f}%" if total > 0 else "0%"
            table.add_row(phase, str(stats["success"]), str(stats["failure"]), ratio)

        layout["stats"].update(Panel(table, border_style="dim"))

        # Latency Panel
        lats = f"p50: [bold green]{self.get_percentile(50):.2f}ms[/]\n" \
               f"p95: [bold yellow]{self.get_percentile(95):.2f}ms[/]\n" \
               f"p99: [bold red]{self.get_percentile(99):.2f}ms[/]"
        
        layout["latency"].update(Panel(lats, title="Latency Histograms", border_style="magenta"))

        return layout

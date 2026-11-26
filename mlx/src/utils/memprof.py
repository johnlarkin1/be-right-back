"""Lightweight memory profiling utility for pipeline instrumentation.

Uses psutil for RSS tracking and optionally tracemalloc for Python-level allocation tracking.
Emits memory checkpoints as structured log messages for analysis.
"""

import os
import time
from dataclasses import dataclass, field

import psutil

from progress.base import log_info

_PROCESS = psutil.Process(os.getpid())


@dataclass
class MemorySnapshot:
    """A single memory measurement."""

    label: str
    rss_mb: float
    vms_mb: float
    timestamp: float
    rss_delta_mb: float = 0.0


@dataclass
class MemoryProfiler:
    """Tracks memory at labeled checkpoints throughout pipeline execution."""

    snapshots: list[MemorySnapshot] = field(default_factory=list)
    _baseline_rss: float = 0.0

    def snapshot(self, label: str) -> MemorySnapshot:
        """Take a memory snapshot and log it."""
        mem = _PROCESS.memory_info()
        rss_mb = mem.rss / (1024 * 1024)
        vms_mb = mem.vms / (1024 * 1024)

        delta = rss_mb - self._baseline_rss if self._baseline_rss > 0 else 0.0
        if not self._baseline_rss:
            self._baseline_rss = rss_mb

        snap = MemorySnapshot(
            label=label,
            rss_mb=rss_mb,
            vms_mb=vms_mb,
            timestamp=time.time(),
            rss_delta_mb=delta,
        )
        self.snapshots.append(snap)

        sign = "+" if delta >= 0 else ""
        log_info(
            f"[MEMPROF] {label}: RSS={rss_mb:.1f}MB (VMS={vms_mb:.1f}MB) "
            f"[{sign}{delta:.1f}MB from baseline]"
        )
        return snap

    def report(self) -> str:
        """Generate a summary report of all memory checkpoints."""
        if not self.snapshots:
            return "No memory snapshots recorded."

        lines = [
            "=" * 70,
            "MEMORY PROFILE REPORT",
            "=" * 70,
            f"{'Checkpoint':<45} {'RSS (MB)':>10} {'Delta (MB)':>12}",
            "-" * 70,
        ]

        peak_snap = max(self.snapshots, key=lambda s: s.rss_mb)

        for snap in self.snapshots:
            sign = "+" if snap.rss_delta_mb >= 0 else ""
            marker = " << PEAK" if snap is peak_snap else ""
            lines.append(
                f"{snap.label:<45} {snap.rss_mb:>10.1f} {sign}{snap.rss_delta_mb:>11.1f}{marker}"
            )

        lines.append("-" * 70)
        lines.append(f"Peak RSS: {peak_snap.rss_mb:.1f}MB at '{peak_snap.label}'")
        lines.append(f"Total growth: {self.snapshots[-1].rss_mb - self.snapshots[0].rss_mb:.1f}MB")

        # Identify biggest jumps
        lines.append("")
        lines.append("Top 5 memory jumps:")
        deltas = []
        for i in range(1, len(self.snapshots)):
            jump = self.snapshots[i].rss_mb - self.snapshots[i - 1].rss_mb
            deltas.append((jump, self.snapshots[i - 1].label, self.snapshots[i].label))

        deltas.sort(key=lambda x: abs(x[0]), reverse=True)
        for jump, from_label, to_label in deltas[:5]:
            sign = "+" if jump >= 0 else ""
            lines.append(f"  {sign}{jump:.1f}MB: {from_label} -> {to_label}")

        lines.append("=" * 70)
        return "\n".join(lines)

    def log_report(self):
        """Log the full memory report."""
        for line in self.report().split("\n"):
            log_info(f"[MEMPROF] {line}")

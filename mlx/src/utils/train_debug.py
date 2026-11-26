"""Crash-surviving debug log for LoRA training.

A Metal out-of-memory error aborts the process from C++. Python gets no
exception, and the app keeps only the last 20 stderr lines. This module
writes memory samples to `memory_log.jsonl` in the persona folder. Each
line is flushed and synced, so the file holds everything up to the crash.
`faulthandler` writes the Python stack of every thread to `crash_trace.txt`.
"""

import faulthandler
import os
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any

import psutil
import ujson as json

MEMORY_LOG_NAME = "memory_log.jsonl"
CRASH_TRACE_NAME = "crash_trace.txt"
DEFAULT_SAMPLE_SECONDS = 2.0
# Log the top processes every this many samples (about once a minute).
PROCESS_EVERY_SAMPLES = 30
TOP_PROCESSES = 8
# Substrings that mark a process as ours. Matched against the command line,
# but only the match flag is logged, never the command line itself.
BRB_MARKERS = ("be-right-back", "inference_daemon", "mlx-venv")

_GB = 1024**3


def _gb(value: float | int | None) -> float | None:
    return None if value is None else round(float(value) / _GB, 3)


def _mlx_call(name: str) -> Any:
    """Call an MLX memory function by name, or return None if it fails.

    MLX 0.29+ has `mx.get_active_memory()` etc. Older builds only have
    `mx.metal.*`. A failed probe must never stop training.
    """
    try:
        import mlx.core as mx

        fn = getattr(mx, name, None)
        if fn is None:
            fn = getattr(mx.metal, name, None)
        return None if fn is None else fn()
    except Exception:
        return None


def memory_snapshot() -> dict[str, Any]:
    """Return MLX, process and system memory in GB."""
    snap: dict[str, Any] = {
        "mlx_active_gb": _gb(_mlx_call("get_active_memory")),
        "mlx_cache_gb": _gb(_mlx_call("get_cache_memory")),
        "mlx_peak_gb": _gb(_mlx_call("get_peak_memory")),
    }
    try:
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()
        snap.update(
            {
                "rss_gb": _gb(psutil.Process(os.getpid()).memory_info().rss),
                "sys_available_gb": _gb(vm.available),
                "sys_used_pct": vm.percent,
                "swap_used_gb": _gb(swap.used),
            }
        )
    except Exception:
        pass
    return snap


def device_report() -> dict[str, Any]:
    """Return GPU limits and total memory. Logged once at startup."""
    report: dict[str, Any] = {}
    info = _mlx_call("device_info")
    if isinstance(info, dict):
        for key, value in info.items():
            if "size" in key or "memory" in key:
                report[f"device_{key}_gb"] = _gb(value)
            else:
                report[f"device_{key}"] = value
    report["mlx_memory_limit_gb"] = _gb(_mlx_call("get_memory_limit"))
    try:
        report["sys_total_gb"] = _gb(psutil.virtual_memory().total)
    except Exception:
        pass
    return report


def top_processes(limit: int = TOP_PROCESSES) -> list[dict[str, Any]]:
    """Return the largest processes by resident memory.

    This shows whether another model (the chat daemon, Casper, ingestion)
    holds unified memory while training runs. Only the process name is
    kept; the command line is checked for BRB markers and then dropped.
    """
    rows: list[dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "memory_info"]):
        try:
            mem = proc.info.get("memory_info")
            if mem is None:
                continue
            try:
                cmdline = " ".join(proc.cmdline())
            except (psutil.AccessDenied, psutil.ZombieProcess):
                cmdline = ""
            rows.append(
                {
                    "pid": proc.info["pid"],
                    "name": proc.info.get("name") or "?",
                    "rss_gb": _gb(mem.rss),
                    "brb": any(marker in cmdline for marker in BRB_MARKERS),
                    "self": proc.info["pid"] == os.getpid(),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    rows.sort(key=lambda row: row["rss_gb"] or 0.0, reverse=True)
    return rows[:limit]


class MemoryLog:
    """Append-only JSON-lines log that survives a hard abort.

    Callbacks set `phase` and `step`. A daemon thread samples memory every
    `interval` seconds, so the log also covers the steps between reports.
    """

    def __init__(self, path: Path, interval: float = DEFAULT_SAMPLE_SECONDS):
        self.path = path
        self.interval = interval
        self.phase = "startup"
        self.step = 0
        self._start = time.monotonic()
        self._lock = threading.Lock()
        self._file: IO[str] = open(path, "w", encoding="utf-8")  # noqa: SIM115
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # Token count of the newest example the trainer tokenized, and the
        # largest one since the last record.
        self.last_tokens: int | None = None
        self.max_tokens_since_record = 0

    def record(self, event: str, **fields: Any) -> None:
        row = {
            "t": round(time.monotonic() - self._start, 2),
            "wall": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "event": event,
            "phase": self.phase,
            "step": self.step,
            "last_tokens": self.last_tokens,
            "max_tokens_since_record": self.max_tokens_since_record,
            **memory_snapshot(),
            **fields,
        }
        self.max_tokens_since_record = 0
        line = json.dumps(row)
        with self._lock:
            if self._file.closed:
                return
            self._file.write(line + "\n")
            self._file.flush()
            os.fsync(self._file.fileno())

    def set_phase(self, phase: str, step: int | None = None) -> None:
        self.phase = phase
        if step is not None:
            self.step = step
        self.record("phase", note=phase)

    def note_item(self, tokens: int) -> None:
        """Record the token count of an example the trainer just tokenized."""
        self.last_tokens = tokens
        self.max_tokens_since_record = max(self.max_tokens_since_record, tokens)

    def start_sampler(self) -> None:
        if self._thread is not None:
            return

        def loop() -> None:
            count = 0
            while not self._stop.wait(self.interval):
                count += 1
                try:
                    if count % PROCESS_EVERY_SAMPLES == 0:
                        self.record("sample", top_processes=top_processes())
                    else:
                        self.record("sample")
                except Exception:
                    return

        self._thread = threading.Thread(target=loop, name="memory-log", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.interval + 1)
        with self._lock:
            if not self._file.closed:
                self._file.close()


class LoggedDataset:
    """Wrap an mlx-lm dataset and report each tokenized example to a MemoryLog.

    mlx-lm wraps datasets in `CacheDataset`, which calls `process()` once per
    example. Only the token count is logged, never the text.
    """

    def __init__(self, data: Any, log: MemoryLog):
        self._data = data
        self._log = log

    def __len__(self) -> int:
        return len(self._data)

    def __getitem__(self, idx: int) -> Any:
        return self._data[idx]

    def process(self, item: Any) -> Any:
        out = self._data.process(item)
        tokens = out[0] if isinstance(out, tuple) else out
        try:
            self._log.note_item(len(tokens))
        except Exception:
            pass
        return out


@contextmanager
def track_validation(log: MemoryLog) -> Iterator[None]:
    """Mark validation passes in the log.

    mlx-lm's `train()` calls the module-level `evaluate()` for each pass.
    This wraps it to log the phase and memory before and after. It also
    scores validation with the unweighted `default_loss`, so val loss and
    early stopping stay comparable when training weights some tokens.
    """
    from mlx_lm.tuner import trainer

    original = trainer.evaluate

    def evaluate(*args: Any, **kwargs: Any) -> Any:
        kwargs["loss"] = trainer.default_loss
        log.set_phase("validating")
        result = original(*args, **kwargs)
        log.set_phase("training")
        return result

    trainer.evaluate = evaluate
    try:
        yield
    finally:
        trainer.evaluate = original


_crash_file: IO[str] | None = None


def enable_crash_trace(path: Path) -> None:
    """Dump every thread's Python stack to `path` on SIGABRT or SIGSEGV."""
    global _crash_file
    _crash_file = open(path, "w", encoding="utf-8")  # noqa: SIM115
    _crash_file.write(f"pid {os.getpid()} started {time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
    _crash_file.flush()
    faulthandler.enable(file=_crash_file, all_threads=True)


def disable_crash_trace() -> None:
    global _crash_file
    faulthandler.disable()
    if _crash_file is not None:
        _crash_file.close()
        _crash_file = None
    # Re-enable on stderr so a later crash still prints a stack somewhere.
    faulthandler.enable(file=sys.stderr, all_threads=True)


def token_length_stats(lengths: list[int], max_seq_length: int) -> dict[str, Any]:
    """Summarize example lengths in tokens. Text is never logged."""
    if not lengths:
        return {"examples": 0}
    ordered = sorted(lengths)

    def pct(p: float) -> int:
        return ordered[min(len(ordered) - 1, int(p * (len(ordered) - 1)))]

    return {
        "examples": len(ordered),
        "tokens_p50": pct(0.5),
        "tokens_p95": pct(0.95),
        "tokens_p99": pct(0.99),
        "tokens_max": ordered[-1],
        "over_max_seq": sum(1 for n in ordered if n > max_seq_length),
        "max_seq_length": max_seq_length,
    }

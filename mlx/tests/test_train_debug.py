"""Tests for the crash-surviving training debug log."""

import json
from pathlib import Path

from core.callbacks import TrainingCallback
from utils.train_debug import (
    LoggedDataset,
    MemoryLog,
    memory_snapshot,
    token_length_stats,
    top_processes,
    track_validation,
)


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_record_writes_flushed_json_line(tmp_path: Path) -> None:
    log = MemoryLog(tmp_path / "m.jsonl")
    log.record("start", max_steps=5)
    # Read before close: the line must already be on disk.
    rows = _rows(tmp_path / "m.jsonl")
    log.close()
    assert rows[0]["event"] == "start"
    assert rows[0]["max_steps"] == 5
    assert "mlx_active_gb" in rows[0]
    assert "sys_available_gb" in rows[0]


def test_memory_snapshot_never_raises() -> None:
    snap = memory_snapshot()
    assert set(snap) >= {"mlx_active_gb", "mlx_cache_gb", "mlx_peak_gb"}


class _FakeDataset:
    def __init__(self, lengths: list[int]):
        self._lengths = lengths

    def __len__(self) -> int:
        return len(self._lengths)

    def __getitem__(self, idx: int) -> int:
        return self._lengths[idx]

    def process(self, n: int) -> tuple[list[int], int]:
        return list(range(n)), 0


def test_logged_dataset_records_tokens(tmp_path: Path) -> None:
    log = MemoryLog(tmp_path / "m.jsonl")
    train = LoggedDataset(_FakeDataset([3, 900]), log)

    train.process(train[1])
    train.process(train[0])
    assert log.last_tokens == 3
    log.record("sample")
    log.record("sample")
    log.close()

    rows = _rows(tmp_path / "m.jsonl")
    assert rows[0]["max_tokens_since_record"] == 900
    assert rows[1]["max_tokens_since_record"] == 0
    assert len(train) == 2


def test_track_validation_marks_phase(tmp_path: Path) -> None:
    from mlx_lm.tuner import trainer

    original = trainer.evaluate
    log = MemoryLog(tmp_path / "m.jsonl")
    seen: list[str] = []
    trainer.evaluate = lambda *a, **k: seen.append(log.phase) or 1.5
    try:
        with track_validation(log):
            assert trainer.evaluate() == 1.5
    finally:
        trainer.evaluate = original
    log.close()
    assert seen == ["validating"]
    assert log.phase == "training"


def test_sampler_writes_samples(tmp_path: Path) -> None:
    log = MemoryLog(tmp_path / "m.jsonl", interval=0.01)
    log.start_sampler()
    import time

    time.sleep(0.1)
    log.close()
    assert any(r["event"] == "sample" for r in _rows(tmp_path / "m.jsonl"))


def test_token_length_stats() -> None:
    stats = token_length_stats([10, 20, 30, 2000], max_seq_length=1024)
    assert stats["tokens_max"] == 2000
    assert stats["over_max_seq"] == 1
    assert token_length_stats([], 1024) == {"examples": 0}


def test_top_processes_has_no_command_line() -> None:
    rows = top_processes(limit=3)
    assert len(rows) <= 3
    for row in rows:
        assert set(row) == {"pid", "name", "rss_gb", "brb", "self"}


def test_callback_logs_reports(tmp_path: Path) -> None:
    from config.training import Config

    config = Config.default("/tmp/data", "/tmp/output", "test-model")
    log = MemoryLog(tmp_path / "m.jsonl")
    history: dict[str, list] = {
        k: []
        for k in (
            "train_losses",
            "train_iterations",
            "val_losses",
            "val_iterations",
            "learning_rates",
            "iterations_per_second",
            "tokens_per_second",
            "peak_memory",
        )
    }
    cb = TrainingCallback(config, history, log)
    cb.on_train_loss_report({"iteration": 10, "train_loss": 2.5, "peak_memory": 30.1})
    cb.on_val_loss_report({"iteration": 49, "val_loss": 2.1, "val_time": 7.0})
    log.close()
    rows = _rows(tmp_path / "m.jsonl")
    assert rows[0]["event"] == "train_report" and rows[0]["step"] == 10
    assert rows[1]["event"] == "val_report" and rows[1]["val_time"] == 7.0

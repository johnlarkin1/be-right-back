"""Tests for the TrainingCallback early stopping and progress reporting."""

import pytest
import ujson as json

from config.training import Config
from core.callbacks import TrainingCallback


def make_config(**overrides) -> Config:
    """Create a Config with sensible defaults for testing."""
    config = Config.default("/tmp/data", "/tmp/output", "test-model")
    for key, value in overrides.items():
        setattr(config.training, key, value)
    return config


def make_loss_history():
    """Create an empty loss history dict matching what core/train.py uses."""
    return {
        "train_losses": [],
        "train_iterations": [],
        "val_losses": [],
        "val_iterations": [],
        "learning_rates": [],
        "iterations_per_seconds": [],
        "tokens_per_seconds": [],
        "peak_memory": [],
    }


class TestTrainingCallbackProgress:
    """Tests for training progress emission."""

    def test_train_loss_recorded(self):
        config = make_config()
        history = make_loss_history()
        cb = TrainingCallback(config, history)

        cb.on_train_loss_report({"train_loss": 2.5, "iteration": 1})
        assert history["train_losses"] == [2.5]
        assert history["train_iterations"] == [1]

    def test_train_loss_emits_json(self, capsys):
        config = make_config()
        history = make_loss_history()
        cb = TrainingCallback(config, history)

        cb.on_train_loss_report({"train_loss": 1.5, "iteration": 10})
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["type"] == "training_progress"
        assert parsed["phase"] == "training"
        assert parsed["step"] == 10
        assert parsed["loss"] == 1.5

    def test_val_loss_recorded(self):
        config = make_config()
        history = make_loss_history()
        cb = TrainingCallback(config, history)

        cb.on_val_loss_report({"val_loss": 1.8, "iteration": 50})
        assert history["val_losses"] == [1.8]
        assert history["val_iterations"] == [50]

    def test_val_loss_emits_json(self, capsys):
        config = make_config()
        history = make_loss_history()
        cb = TrainingCallback(config, history)

        cb.on_val_loss_report({"val_loss": 1.8, "iteration": 50})
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["type"] == "training_progress"
        assert parsed["phase"] == "validating"
        assert parsed["val_loss"] == 1.8

    def test_missing_fields_ignored(self):
        config = make_config()
        history = make_loss_history()
        cb = TrainingCallback(config, history)

        # No crash on missing keys
        cb.on_train_loss_report({})
        cb.on_val_loss_report({})
        assert history["train_losses"] == []
        assert history["val_losses"] == []


class TestEarlyStopping:
    """Tests for early stopping logic."""

    def _make_cb(self, patience=3, threshold=0.001):
        config = make_config(
            early_stopping_patience=patience,
            early_stopping_threshold=threshold,
            max_steps=500,
        )
        history = make_loss_history()
        return TrainingCallback(config, history)

    def test_no_early_stop_when_improving(self):
        cb = self._make_cb(patience=3)
        # Each val loss improves
        cb.on_val_loss_report({"val_loss": 2.0, "iteration": 50})
        cb.on_val_loss_report({"val_loss": 1.5, "iteration": 100})
        cb.on_val_loss_report({"val_loss": 1.0, "iteration": 150})
        cb.on_val_loss_report({"val_loss": 0.5, "iteration": 200})
        assert cb.stopped_early is False

    def test_early_stop_after_patience_exhausted(self):
        cb = self._make_cb(patience=2)
        cb.on_val_loss_report({"val_loss": 1.0, "iteration": 50})
        cb.on_val_loss_report({"val_loss": 1.1, "iteration": 100})  # no improvement
        with pytest.raises(StopIteration):
            cb.on_val_loss_report({"val_loss": 1.2, "iteration": 150})  # patience=2 exhausted
        assert cb.stopped_early is True
        assert cb.stop_iteration == 150

    def test_improvement_resets_patience(self):
        cb = self._make_cb(patience=2)
        cb.on_val_loss_report({"val_loss": 2.0, "iteration": 50})
        cb.on_val_loss_report({"val_loss": 2.1, "iteration": 100})  # no improvement (count=1)
        cb.on_val_loss_report({"val_loss": 1.5, "iteration": 150})  # improvement, resets
        cb.on_val_loss_report({"val_loss": 1.6, "iteration": 200})  # no improvement (count=1)
        # Should NOT stop - patience was reset
        assert cb.stopped_early is False

    def test_no_early_stop_when_patience_none(self):
        cb = self._make_cb(patience=None)
        cb.on_val_loss_report({"val_loss": 2.0, "iteration": 50})
        cb.on_val_loss_report({"val_loss": 3.0, "iteration": 100})
        cb.on_val_loss_report({"val_loss": 4.0, "iteration": 150})
        cb.on_val_loss_report({"val_loss": 5.0, "iteration": 200})
        assert cb.stopped_early is False

    def test_no_early_stop_when_patience_zero(self):
        cb = self._make_cb(patience=0)
        cb.on_val_loss_report({"val_loss": 2.0, "iteration": 50})
        cb.on_val_loss_report({"val_loss": 3.0, "iteration": 100})
        assert cb.stopped_early is False

    def test_best_val_loss_tracked(self):
        cb = self._make_cb(patience=5)
        cb.on_val_loss_report({"val_loss": 2.0, "iteration": 50})
        assert cb.best_val_loss == 2.0
        cb.on_val_loss_report({"val_loss": 1.5, "iteration": 100})
        assert cb.best_val_loss == 1.5
        cb.on_val_loss_report({"val_loss": 1.8, "iteration": 150})
        assert cb.best_val_loss == 1.5  # unchanged
